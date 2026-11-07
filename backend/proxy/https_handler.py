import asyncio
import base64
import ssl
import time
from urllib.parse import urlsplit, urlunsplit

import h11
import wsproto
import wsproto.events

from config import MAX_BODY_SIZE, MAX_HEADER_SIZE
from certificates.certificates import get_host_certificate
from traffic.models import TrafficRecord, WebSocketFrame


READ_SIZE = 65536
HANDSHAKE_TIMEOUT = 10
UPSTREAM_TIMEOUT = 20
WEBSOCKET_IDLE_TIMEOUT = 300  # 5 minutes


class ProxyConnectionError(Exception):
    pass


def _decode(value: bytes) -> str:
    return value.decode("latin-1", errors="replace")


def _filter_headers(headers):
    """Remove connection-specific headers before forwarding."""

    connection_tokens = set()

    for name, value in headers:
        if name.lower() == b"connection":
            connection_tokens.update(
                token.strip().lower()
                for token in value.split(b",")
                if token.strip()
            )

    blocked = {
        b"connection",
        b"keep-alive",
        b"proxy-connection",
        b"proxy-authenticate",
        b"proxy-authorization",
        b"upgrade",
    } | connection_tokens

    return [
        (name, value)
        for name, value in headers
        if name.lower() not in blocked
    ]


def _is_websocket_upgrade(headers) -> bool:
    """Detect a WebSocket upgrade request from the client."""

    has_upgrade = False
    has_connection_upgrade = False

    for name, value in headers:
        lname = name.lower()
        lvalue = value.lower()

        if lname == b"upgrade" and b"websocket" in lvalue:
            has_upgrade = True

        if lname == b"connection" and b"upgrade" in lvalue:
            has_connection_upgrade = True

    return has_upgrade and has_connection_upgrade


async def _next_event(connection, reader):
    """Read from a stream until h11 produces an event."""

    while True:
        event = connection.next_event()

        if event is h11.NEED_DATA:
            data = await reader.read(READ_SIZE)
            if not data:
                return h11.ConnectionClosed
            connection.receive_data(data)
            continue

        return event


async def _read_message_body(connection, reader):
    """Read a complete HTTP message body with a size limit."""

    chunks = []
    total = 0

    while True:
        event = await _next_event(connection, reader)

        if isinstance(event, h11.Data):
            total += len(event.data)

            if total > MAX_BODY_SIZE:
                raise ProxyConnectionError(
                    "HTTP message body exceeds configured size limit"
                )

            chunks.append(event.data)

        elif isinstance(event, h11.EndOfMessage):
            return b"".join(chunks)

        else:
            raise ProxyConnectionError(
                f"Unexpected HTTP body event: {event!r}"
            )


def _make_server_ssl_context(cert_path, key_path):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2

    context.load_cert_chain(
        certfile=str(cert_path),
        keyfile=str(key_path),
    )

    context.set_alpn_protocols(["http/1.1"])

    return context


def _make_upstream_ssl_context():
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.set_alpn_protocols(["http/1.1"])
    return context


async def _send_error(connection, writer, status, reason):
    body = reason.encode("utf-8")

    response = h11.Response(
        status_code=status,
        headers=[
            (b"content-type", b"text/plain; charset=utf-8"),
            (b"content-length", str(len(body)).encode()),
            (b"connection", b"close"),
        ],
        reason=reason.encode("ascii", errors="replace"),
    )

    writer.write(connection.send(response))
    writer.write(connection.send(h11.Data(data=body)))
    writer.write(connection.send(h11.EndOfMessage()))
    await writer.drain()


def _prepare_intercepted_request(edited, original_host, original_port):
    """Validate and convert the request edited in the frontend."""

    method = str(edited.get("method", "GET")).strip().upper()
    url = str(edited.get("url", "")).strip()

    parsed = urlsplit(url)

    if parsed.scheme.lower() != "https":
        raise ProxyConnectionError(
            "Edited HTTPS request must use the https:// scheme"
        )

    if not parsed.hostname:
        raise ProxyConnectionError("Edited request URL has no hostname")

    edited_host = parsed.hostname.lower().rstrip(".")
    expected_host = original_host.lower().rstrip(".")
    edited_port = parsed.port or 443

    if edited_host != expected_host or edited_port != original_port:
        raise ProxyConnectionError(
            "Changing the destination host or port inside an HTTPS tunnel "
            "is not supported"
        )

    if parsed.username or parsed.password:
        raise ProxyConnectionError(
            "Credentials in the request URL are not supported"
        )

    target = parsed.path or "/"

    if parsed.query:
        target += "?" + parsed.query

    if parsed.fragment:
        raise ProxyConnectionError(
            "URL fragments are not sent in HTTP requests"
        )

    raw_headers = edited.get("headers", [])

    if not isinstance(raw_headers, list):
        raise ProxyConnectionError("Invalid edited headers")

    headers = []

    for item in raw_headers:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise ProxyConnectionError("Invalid edited header entry")

        name = str(item[0]).strip()
        value = str(item[1])

        if not name or "\r" in name or "\n" in name:
            raise ProxyConnectionError("Invalid header name")

        if "\r" in value or "\n" in value:
            raise ProxyConnectionError("Invalid header value")

        try:
            headers.append((
                name.encode("latin-1"),
                value.encode("latin-1"),
            ))
        except UnicodeEncodeError as exc:
            raise ProxyConnectionError(
                "Invalid characters in request headers"
            ) from exc

    body_encoded = edited.get("body_base64", "")

    try:
        body = base64.b64decode(body_encoded, validate=True)
    except Exception as exc:
        raise ProxyConnectionError(
            "Invalid Base64 request body"
        ) from exc

    if len(body) > MAX_BODY_SIZE:
        raise ProxyConnectionError(
            "Edited request body exceeds configured size limit"
        )

    if not method:
        raise ProxyConnectionError("Request method cannot be empty")

    try:
        method_bytes = method.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ProxyConnectionError("Invalid request method") from exc

    return method_bytes, target, headers, body


def _prepare_intercepted_response(edited):
    """Validate and convert a response edited in the frontend."""

    if not isinstance(edited, dict):
        raise ProxyConnectionError("Invalid edited response")

    status = edited.get("status_code")
    reason = edited.get("reason", "")
    raw_headers = edited.get("headers", [])
    body_encoded = edited.get("body_base64", "")

    if (
        not isinstance(status, int)
        or isinstance(status, bool)
        or not 200 <= status <= 599
    ):
        raise ProxyConnectionError("Invalid response status code")

    if not isinstance(reason, str):
        raise ProxyConnectionError("Invalid response reason")

    if "\r" in reason or "\n" in reason:
        raise ProxyConnectionError("Invalid response reason")

    if not isinstance(raw_headers, list):
        raise ProxyConnectionError("Invalid response headers")

    headers = []

    for item in raw_headers:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise ProxyConnectionError("Invalid response header entry")

        name = str(item[0]).strip()
        value = str(item[1])

        if not name or any(char in name for char in (":", "\r", "\n")):
            raise ProxyConnectionError("Invalid response header name")

        if "\r" in value or "\n" in value:
            raise ProxyConnectionError("Invalid response header value")

        try:
            headers.append((
                name.encode("ascii"),
                value.encode("latin-1"),
            ))
        except UnicodeEncodeError as exc:
            raise ProxyConnectionError(
                "Invalid characters in response headers"
            ) from exc

    try:
        body = base64.b64decode(body_encoded, validate=True)
    except Exception as exc:
        raise ProxyConnectionError(
            "Invalid Base64 response body"
        ) from exc

    if len(body) > MAX_BODY_SIZE:
        raise ProxyConnectionError(
            "Edited response body exceeds configured size limit"
        )

    return status, reason, headers, body


def _ws_opcode_name(opcode) -> str:
    """Convert wsproto opcode to a readable name."""
    try:
        return opcode.name.lower()
    except AttributeError:
        return str(opcode)


async def _handle_websocket(
    client_connection: h11.Connection,
    client_reader,
    client_writer,
    client_ws: wsproto.WSConnection,
    upstream_reader,
    upstream_writer,
    upstream_ws: wsproto.WSConnection,
    host: str,
    port: int,
    request,
    request_body: bytes,
    storage,
    started: float,
):
    """Bidirectional WebSocket frame forwarding."""

    frames: list[WebSocketFrame] = []
    error = None

    async def forward_client_to_upstream():
        nonlocal error
        try:
            # Send the initial CONNECT-upgraded request's body if any
            # (WebSocket handshake usually has no body)
            while True:
                data = await asyncio.wait_for(
                    client_reader.read(READ_SIZE),
                    timeout=WEBSOCKET_IDLE_TIMEOUT,
                )
                if not data:
                    break

                client_ws.receive_data(data)

                for event in client_ws.events():
                    if isinstance(event, wsproto.events.TextMessage):
                        payload = event.data.encode("utf-8")
                        frame = WebSocketFrame(
                            direction="client",
                            opcode="text",
                            payload=payload,
                            timestamp=time.time(),
                        )
                        frames.append(frame)
                        upstream_writer.write(
                            upstream_ws.send(
                                wsproto.events.TextMessage(data=event.data)
                            )
                        )

                    elif isinstance(event, wsproto.events.BytesMessage):
                        frame = WebSocketFrame(
                            direction="client",
                            opcode="binary",
                            payload=event.data,
                            timestamp=time.time(),
                        )
                        frames.append(frame)
                        upstream_writer.write(
                            upstream_ws.send(
                                wsproto.events.BytesMessage(data=event.data)
                            )
                        )

                    elif isinstance(event, wsproto.events.Ping):
                        upstream_writer.write(
                            upstream_ws.send(
                                wsproto.events.Ping(payload=event.payload)
                            )
                        )

                    elif isinstance(event, wsproto.events.Pong):
                        upstream_writer.write(
                            upstream_ws.send(
                                wsproto.events.Pong(payload=event.payload)
                            )
                        )

                    elif isinstance(event, wsproto.events.CloseConnection):
                        upstream_writer.write(
                            upstream_ws.send(
                                wsproto.events.CloseConnection(
                                    code=event.code, reason=event.reason
                                )
                            )
                        )
                        return

                await upstream_writer.drain()

        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            error = f"Client->Upstream WS error: {exc}"

    async def forward_upstream_to_client():
        nonlocal error
        try:
            while True:
                data = await asyncio.wait_for(
                    upstream_reader.read(READ_SIZE),
                    timeout=WEBSOCKET_IDLE_TIMEOUT,
                )
                if not data:
                    break

                upstream_ws.receive_data(data)

                for event in upstream_ws.events():
                    if isinstance(event, wsproto.events.TextMessage):
                        payload = event.data.encode("utf-8")
                        frames.append(WebSocketFrame(
                            direction="server",
                            opcode="text",
                            payload=payload,
                            timestamp=time.time(),
                        ))
                        client_writer.write(
                            client_ws.send(
                                wsproto.events.TextMessage(data=event.data)
                            )
                        )

                    elif isinstance(event, wsproto.events.BytesMessage):
                        frames.append(WebSocketFrame(
                            direction="server",
                            opcode="binary",
                            payload=event.data,
                            timestamp=time.time(),
                        ))
                        client_writer.write(
                            client_ws.send(
                                wsproto.events.BytesMessage(data=event.data)
                            )
                        )

                    elif isinstance(event, wsproto.events.Ping):
                        client_writer.write(
                            client_ws.send(
                                wsproto.events.Ping(payload=event.payload)
                            )
                        )

                    elif isinstance(event, wsproto.events.Pong):
                        client_writer.write(
                            client_ws.send(
                                wsproto.events.Pong(payload=event.payload)
                            )
                        )

                    elif isinstance(event, wsproto.events.CloseConnection):
                        client_writer.write(
                            client_ws.send(
                                wsproto.events.CloseConnection(
                                    code=event.code, reason=event.reason
                                )
                            )
                        )
                        return

                await client_writer.drain()

        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            error = f"Upstream->Client WS error: {exc}"

    try:
        await asyncio.gather(
            forward_client_to_upstream(),
            forward_upstream_to_client(),
        )
    except Exception as exc:
        error = f"WebSocket forwarding error: {exc}"
    finally:
        try:
            client_writer.close()
            await client_writer.wait_closed()
        except Exception:
            pass
        try:
            upstream_writer.close()
            await upstream_writer.wait_closed()
        except Exception:
            pass

    duration_ms = (time.perf_counter() - started) * 1000

    record = TrafficRecord(
        method=_decode(request.method),
        url=urlunsplit((
            "wss",
            host if port == 443 else f"{host}:{port}",
            _decode(request.target),
            "",
            "",
        )),
        scheme="wss",
        host=host,
        port=port,
        path=_decode(request.target),
        request_headers=[
            (_decode(name), _decode(value))
            for name, value in request.headers
        ],
        request_body=request_body,
        status_code=101,
        reason="Switching Protocols",
        response_headers=[],
        response_body=b"",
        is_websocket=True,
        frames=frames,
        duration_ms=duration_ms,
        error=error,
    )

    if storage is not None:
        await storage.save(record)

    return error


async def _forward_request(
    client_connection,
    client_reader,
    client_writer,
    request,
    host,
    port,
    storage,
    interceptor=None,
):
    started = time.perf_counter()

    original_method = _decode(request.method)
    original_target = _decode(request.target)

    request_body = await _read_message_body(
        client_connection,
        client_reader,
    )

    original_headers = list(request.headers)

    method = request.method
    target = original_target
    request_headers = original_headers

    user_edited = False

    # ---------------------------------------------------------
    # REQUEST INTERCEPTION
    # ---------------------------------------------------------

    if interceptor is not None:
        paused_request = {
            "method": original_method,
            "url": urlunsplit((
                "https",
                host if port == 443 else f"{host}:{port}",
                original_target,
                "",
                "",
            )),
            "scheme": "https",
            "host": host,
            "port": port,
            "path": original_target,
            "headers": [
                [_decode(name), _decode(value)]
                for name, value in original_headers
            ],
            "body_base64": base64.b64encode(
                request_body
            ).decode("ascii"),
        }

        edited = await interceptor.pause(paused_request)

        if edited is None:
            await _send_error(
                client_connection,
                client_writer,
                403,
                "Request dropped by PacketSniffer",
            )
            return "Request dropped by PacketSniffer"

        edited_headers_list = edited.get("headers", [])
        edited_method = str(edited.get("method", original_method)).strip().upper()
        edited_url = str(edited.get("url", "")).strip()
        edited_body_b64 = edited.get("body_base64", "")

        original_url = urlunsplit((
            "https",
            host if port == 443 else f"{host}:{port}",
            original_target,
            "",
            "",
        ))

        headers_changed = (
            [[_decode(n), _decode(v)] for n, v in original_headers]
            != edited_headers_list
        )
        method_changed = edited_method != original_method.upper()
        url_changed = edited_url != original_url
        body_changed = (
            edited_body_b64
            != base64.b64encode(request_body).decode("ascii")
        )

        if headers_changed or method_changed or url_changed or body_changed:
            user_edited = True
            method, target, request_headers, request_body = (
                _prepare_intercepted_request(
                    edited,
                    host,
                    port,
                )
            )

    if target.startswith(("http://", "https://")):
        raise ProxyConnectionError(
            "Unexpected absolute-form request inside HTTPS connection"
        )

    if not target.startswith("/"):
        target = "/" + target

    # ---------------------------------------------------------
    # WEBSOCKET UPGRADE DETECTION
    # ---------------------------------------------------------

    is_ws_upgrade = _is_websocket_upgrade(original_headers)

    # Build headers for upstream (same rules as plain HTTPS)
    if not user_edited:
        headers = list(original_headers)

        has_host = any(name.lower() == b"host" for name, _ in headers)
        if not has_host:
            host_header = host if port == 443 else f"{host}:{port}"
            headers.append((b"host", host_header.encode("idna")))
    else:
        headers = _filter_headers(request_headers)

        headers = [
            (name, value)
            for name, value in headers
            if name.lower() not in {
                b"content-length",
                b"transfer-encoding",
                b"host",
            }
        ]

        host_header = host if port == 443 else f"{host}:{port}"
        headers.append((b"host", host_header.encode("idna")))

        if request_body:
            headers.append((
                b"content-length",
                str(len(request_body)).encode(),
            ))

    upstream_writer = None

    response_status = None
    response_reason = ""
    response_headers = []
    response_body = b""
    error = None

    # ---------------------------------------------------------
    # UPSTREAM REQUEST + RESPONSE
    # ---------------------------------------------------------

    try:
        upstream_context = _make_upstream_ssl_context()

        async with asyncio.timeout(UPSTREAM_TIMEOUT):
            upstream_reader, upstream_writer = (
                await asyncio.open_connection(
                    host,
                    port,
                    ssl=upstream_context,
                    server_hostname=host,
                    ssl_handshake_timeout=HANDSHAKE_TIMEOUT,
                )
            )

            upstream_connection = h11.Connection(
                h11.CLIENT,
                max_incomplete_event_size=MAX_HEADER_SIZE,
            )

            outgoing_request = h11.Request(
                method=method,
                target=target.encode("latin-1"),
                headers=headers,
            )

            upstream_writer.write(
                upstream_connection.send(outgoing_request)
            )

            if request_body:
                upstream_writer.write(
                    upstream_connection.send(
                        h11.Data(data=request_body)
                    )
                )

            upstream_writer.write(
                upstream_connection.send(h11.EndOfMessage())
            )

            await upstream_writer.drain()

            while True:
                upstream_response = await _next_event(
                    upstream_connection,
                    upstream_reader,
                )

                if isinstance(
                    upstream_response,
                    h11.InformationalResponse,
                ):
                    interim = h11.InformationalResponse(
                        status_code=upstream_response.status_code,
                        headers=_filter_headers(
                            list(upstream_response.headers)
                        ),
                        reason=upstream_response.reason,
                    )

                    client_writer.write(
                        client_connection.send(interim)
                    )
                    await client_writer.drain()
                    continue

                if isinstance(upstream_response, h11.Response):
                    response_status = upstream_response.status_code
                    response_reason = _decode(
                        upstream_response.reason or b""
                    )
                    response_headers = list(
                        upstream_response.headers
                    )
                    break

                if upstream_response is h11.PAUSED:
                    # WebSocket upgrade — h11 stops parsing here.
                    # Retrieve trailing bytes and switch to wsproto.
                    if not is_ws_upgrade:
                        raise ProxyConnectionError(
                            "Upstream paused but request was not a "
                            "WebSocket upgrade"
                        )

                    trailing = upstream_connection.trailing_data[0]

                    client_ws = wsproto.WSConnection(
                        wsproto.ConnectionType.CLIENT,
                    )
                    client_ws.send(
                        wsproto.events.Request(
                            host=host,
                            target=target,
                        )
                    )

                    upstream_ws = wsproto.WSConnection(
                        wsproto.ConnectionType.SERVER,
                    )
                    upstream_ws.send(
                        wsproto.events.AcceptConnection()
                    )

                    # Pass any trailing bytes to wsproto
                    if trailing:
                        upstream_ws.receive_data(trailing)

                    await _handle_websocket(
                        client_connection,
                        client_reader,
                        client_writer,
                        client_ws,
                        upstream_reader,
                        upstream_writer,
                        upstream_ws,
                        host,
                        port,
                        request,
                        request_body,
                        storage,
                        started,
                    )

                    # Connection ended after WebSocket session
                    if upstream_writer is not None:
                        upstream_writer.close()
                        try:
                            await upstream_writer.wait_closed()
                        except Exception:
                            pass
                        upstream_writer = None

                    return None

                raise ProxyConnectionError(
                    f"Unexpected upstream response: {upstream_response!r}"
                )

            response_body = await _read_message_body(
                upstream_connection,
                upstream_reader,
            )

    except asyncio.TimeoutError:
        error = "Upstream connection timed out"

        if response_status is None:
            try:
                await _send_error(
                    client_connection,
                    client_writer,
                    504,
                    "Gateway Timeout",
                )
            except Exception:
                pass

    except ssl.SSLCertVerificationError as exc:
        error = f"Upstream TLS certificate verification failed: {exc}"

        if response_status is None:
            try:
                await _send_error(
                    client_connection,
                    client_writer,
                    502,
                    "Bad Gateway",
                )
            except Exception:
                pass

    except asyncio.CancelledError:
        raise

    except Exception as exc:
        error = str(exc)

        if response_status is None:
            try:
                await _send_error(
                    client_connection,
                    client_writer,
                    502,
                    "Bad Gateway",
                )
            except Exception:
                pass

    finally:
        if upstream_writer is not None:
            upstream_writer.close()

            try:
                await upstream_writer.wait_closed()
            except Exception:
                pass

    # ---------------------------------------------------------
    # RESPONSE INTERCEPTION (unchanged — only for non-WebSocket)
    # ---------------------------------------------------------

    if response_status is not None and error is None:

        if interceptor is not None:
            paused_response = {
                "status_code": response_status,
                "reason": response_reason,
                "headers": [
                    [_decode(name), _decode(value)]
                    for name, value in response_headers
                ],
                "body_base64": base64.b64encode(
                    response_body
                ).decode("ascii"),
                "request_method": _decode(method),
                "request_url": urlunsplit((
                    "https",
                    host if port == 443 else f"{host}:{port}",
                    target,
                    "",
                    "",
                )),
                "scheme": "https",
            }

            edited_response = await interceptor.pause_response(
                paused_response
            )

            if edited_response is None:
                error = "Response dropped by user"

            else:
                (
                    response_status,
                    response_reason,
                    response_headers,
                    response_body,
                ) = _prepare_intercepted_response(edited_response)

        if error is None:
            if (
                _decode(method).upper() == "HEAD"
                or response_status in (204, 304)
            ):
                response_body = b""

            client_headers = _filter_headers(response_headers)

            client_headers = [
                (name, value)
                for name, value in client_headers
                if name.lower() not in {
                    b"content-length",
                    b"transfer-encoding",
                }
            ]

            if response_status not in (204, 304):
                client_headers.append((
                    b"content-length",
                    str(len(response_body)).encode(),
                ))

            client_headers.append((b"connection", b"close"))

            outgoing_response = h11.Response(
                status_code=response_status,
                headers=client_headers,
                reason=response_reason.encode(
                    "latin-1",
                    errors="replace",
                ),
            )

            client_writer.write(
                client_connection.send(outgoing_response)
            )

            if response_body:
                client_writer.write(
                    client_connection.send(
                        h11.Data(data=response_body)
                    )
                )

            client_writer.write(
                client_connection.send(h11.EndOfMessage())
            )

            await client_writer.drain()

    duration_ms = (time.perf_counter() - started) * 1000

    record = TrafficRecord(
        method=_decode(method),
        url=urlunsplit((
            "https",
            host if port == 443 else f"{host}:{port}",
            target,
            "",
            "",
        )),
        scheme="https",
        host=host,
        port=port,
        path=target,
        request_headers=[
            (_decode(name), _decode(value))
            for name, value in request_headers
        ],
        request_body=request_body,
        status_code=response_status,
        reason=response_reason,
        response_headers=[
            (_decode(name), _decode(value))
            for name, value in response_headers
        ],
        response_body=response_body,
        duration_ms=duration_ms,
        error=error,
    )

    if storage is not None:
        await storage.save(record)

    return error


async def handle_https_connect(
    reader,
    writer,
    authority,
    storage,
    interceptor=None,
):
    """Handle one browser CONNECT connection and intercept HTTPS traffic."""

    client_connection = None

    try:
        if ":" not in authority:
            host = authority.strip("[]")
            port = 443
        else:
            host_part, port_part = authority.rsplit(":", 1)
            host = host_part.strip("[]")
            port = int(port_part)

        if not host or not 1 <= port <= 65535:
            raise ValueError("Invalid CONNECT authority")

        cert_path, key_path = get_host_certificate(host)

        ssl_context = _make_server_ssl_context(
            cert_path,
            key_path,
        )

        writer.write(
            b"HTTP/1.1 200 Connection Established\r\n"
            b"Proxy-Agent: PacketSniffer\r\n"
            b"\r\n"
        )
        await writer.drain()

        await writer.start_tls(
            ssl_context,
            ssl_handshake_timeout=HANDSHAKE_TIMEOUT,
        )

        client_connection = h11.Connection(
            h11.SERVER,
            max_incomplete_event_size=MAX_HEADER_SIZE,
        )

        while True:
            request = await _next_event(
                client_connection,
                reader,
            )

            if request is h11.PAUSED:
                break

            if request is h11.ConnectionClosed:
                break

            if not isinstance(request, h11.Request):
                raise ProxyConnectionError(
                    f"Unexpected browser HTTP event: {request!r}"
                )

            error = await _forward_request(
                client_connection,
                reader,
                writer,
                request,
                host,
                port,
                storage,
                interceptor,
            )

            if error:
                break

            client_state = client_connection.our_state
            peer_state = client_connection.their_state

            if (
                client_state is h11.MUST_CLOSE
                or peer_state is h11.MUST_CLOSE
            ):
                break

            client_connection.start_next_cycle()

    except asyncio.CancelledError:
        raise

    except Exception as exc:
        print(f"[HTTPS ERROR] {type(exc).__name__}: {exc}")

    finally:
        writer.close()

        try:
            await writer.wait_closed()
        except Exception:
            pass