
import asyncio
import base64
import time
from urllib.parse import urlsplit

import h11

from config import MAX_BODY_SIZE, MAX_HEADER_SIZE
from traffic.models import TrafficRecord


READ_SIZE = 65536
UPSTREAM_TIMEOUT = 20


class HTTPProxyError(Exception):
    pass


def decode(value):
    return value.decode("latin-1", errors="replace")


def filter_headers(headers):
    """Remove hop-by-hop and proxy-specific headers."""

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
        b"proxy-connection",
        b"proxy-authorization",
        b"proxy-authenticate",
        b"keep-alive",
        b"upgrade",
    } | connection_tokens

    return [
        (name, value)
        for name, value in headers
        if name.lower() not in blocked
    ]


async def next_event(connection, reader):
    while True:
        event = connection.next_event()

        if event is h11.NEED_DATA:
            data = await reader.read(READ_SIZE)
            connection.receive_data(data)
            continue

        return event


async def read_body(connection, reader):
    chunks = []
    total = 0

    while True:
        event = await next_event(connection, reader)

        if isinstance(event, h11.Data):
            total += len(event.data)

            if total > MAX_BODY_SIZE:
                raise HTTPProxyError("HTTP body exceeds configured limit")

            chunks.append(event.data)

        elif isinstance(event, h11.EndOfMessage):
            return b"".join(chunks)

        else:
            raise HTTPProxyError(
                f"Unexpected HTTP body event: {event!r}"
            )


async def send_error(writer, status, reason):
    body = reason.encode("utf-8")

    response = (
        f"HTTP/1.1 {status} {reason}\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Connection: close\r\n"
        "\r\n"
    ).encode("ascii") + body

    writer.write(response)
    await writer.drain()


def resolve_destination(request):
    """Resolve destination from absolute-form URL or Host header."""

    target = decode(request.target)

    if target.startswith(("http://", "https://")):
        parsed = urlsplit(target)

        if parsed.scheme.lower() != "http":
            raise HTTPProxyError(
                "HTTPS requests must use CONNECT"
            )

        if not parsed.hostname:
            raise HTTPProxyError("Missing destination hostname")

        host = parsed.hostname
        port = parsed.port or 80
        path = parsed.path or "/"

        if parsed.query:
            path += "?" + parsed.query

        return host, port, path

    host_header = None

    for name, value in request.headers:
        if name.lower() == b"host":
            host_header = decode(value).strip()
            break

    if not host_header:
        raise HTTPProxyError("Missing Host header")

    parsed_host = urlsplit("//" + host_header)

    if not parsed_host.hostname:
        raise HTTPProxyError("Invalid Host header")

    return (
        parsed_host.hostname,
        parsed_host.port or 80,
        target or "/",
    )


def prepare_edited_request(edited):
    """Validate and convert the edited request into proxy-ready values."""

    if not isinstance(edited, dict):
        raise HTTPProxyError("Invalid edited request")

    method = edited.get("method")
    url = edited.get("url")
    headers = edited.get("headers")
    body_base64 = edited.get("body_base64", "")

    if not isinstance(method, str) or not method:
        raise HTTPProxyError("Invalid request method")

    if not isinstance(url, str) or not url:
        raise HTTPProxyError("Invalid request URL")

    parsed = urlsplit(url)

    if parsed.scheme.lower() != "http" or not parsed.hostname:
        raise HTTPProxyError("Edited URL must be a valid HTTP URL")

    try:
        host = parsed.hostname
        port = parsed.port or 80
    except ValueError as exc:
        raise HTTPProxyError(f"Invalid destination port: {exc}")

    path = parsed.path or "/"

    if parsed.query:
        path += "?" + parsed.query

    if parsed.fragment:
        raise HTTPProxyError("URL fragments cannot be sent in HTTP requests")

    if not isinstance(headers, list):
        raise HTTPProxyError("Request headers must be a list")

    converted_headers = []

    for item in headers:
        if (
            not isinstance(item, (list, tuple))
            or len(item) != 2
            or not isinstance(item[0], str)
            or not isinstance(item[1], str)
        ):
            raise HTTPProxyError("Invalid request header")

        try:
            name = item[0].encode("ascii")
            value = item[1].encode("latin-1")
        except UnicodeEncodeError:
            raise HTTPProxyError("Invalid characters in request headers")

        if not name or any(c in name for c in (b":", b"\r", b"\n")):
            raise HTTPProxyError("Invalid request header name")

        if b"\r" in value or b"\n" in value:
            raise HTTPProxyError("Invalid request header value")

        converted_headers.append((name, value))

    if not isinstance(body_base64, str):
        raise HTTPProxyError("Request body must be Base64 text")

    try:
        body = base64.b64decode(body_base64, validate=True)
    except Exception:
        raise HTTPProxyError("Invalid Base64 request body")

    if len(body) > MAX_BODY_SIZE:
        raise HTTPProxyError("Edited request body exceeds configured limit")

    return (
        method.encode("ascii"),
        host,
        port,
        path,
        converted_headers,
        body,
    )


def prepare_edited_response(edited):
    """Validate an edited response returned by the response interceptor."""

    if not isinstance(edited, dict):
        raise HTTPProxyError("Invalid edited response")

    status_code = edited.get("status_code")
    reason = edited.get("reason", "")
    headers = edited.get("headers")
    body_base64 = edited.get("body_base64", "")

    if (
        not isinstance(status_code, int)
        or isinstance(status_code, bool)
        or not 200 <= status_code <= 599
    ):
        raise HTTPProxyError("Invalid response status code")

    if not isinstance(reason, str):
        raise HTTPProxyError("Invalid response reason")

    if "\r" in reason or "\n" in reason:
        raise HTTPProxyError("Invalid response reason")

    if not isinstance(headers, list):
        raise HTTPProxyError("Response headers must be a list")

    converted_headers = []

    for item in headers:
        if (
            not isinstance(item, (list, tuple))
            or len(item) != 2
            or not isinstance(item[0], str)
            or not isinstance(item[1], str)
        ):
            raise HTTPProxyError("Invalid response header")

        try:
            name = item[0].encode("ascii")
            value = item[1].encode("latin-1")
        except UnicodeEncodeError:
            raise HTTPProxyError("Invalid characters in response headers")

        if not name or any(c in name for c in (b":", b"\r", b"\n")):
            raise HTTPProxyError("Invalid response header name")

        if b"\r" in value or b"\n" in value:
            raise HTTPProxyError("Invalid response header value")

        converted_headers.append((name, value))

    if not isinstance(body_base64, str):
        raise HTTPProxyError("Response body must be Base64 text")

    try:
        body = base64.b64decode(body_base64, validate=True)
    except Exception:
        raise HTTPProxyError("Invalid Base64 response body")

    if len(body) > MAX_BODY_SIZE:
        raise HTTPProxyError("Edited response body exceeds configured limit")

    return status_code, reason, converted_headers, body


async def handle_http_connection(
    reader,
    writer,
    client_connection,
    request,
    storage,
    interceptor=None,
):
    started = time.perf_counter()

    method = decode(request.method)
    host = ""
    port = 80
    path = "/"

    request_headers = list(request.headers)
    request_body = b""

    response_status = None
    response_reason = ""
    response_headers = []
    response_body = b""
    error = None

    upstream_writer = None

    try:
        host, port, path = resolve_destination(request)

        if port != 80:
            raise HTTPProxyError(
                "Plain HTTP handler only supports port 80. "
                "Use CONNECT for HTTPS."
            )

        request_body = await read_body(client_connection, reader)

        outgoing_method = request.method
        outgoing_headers = list(request_headers)
        outgoing_body = request_body

        # Pause the complete request before opening an upstream connection.
        if interceptor is not None:
            original_url = f"http://{host}:{port}{path}"

            paused_request = {
                "method": method,
                "url": original_url,
                "scheme": "http",
                "host": host,
                "port": port,
                "path": path,
                "headers": [
                    [decode(name), decode(value)]
                    for name, value in request_headers
                ],
                "body_base64": base64.b64encode(
                    request_body
                ).decode("ascii"),
            }

            edited = await interceptor.pause(paused_request)

            # Dropped request: do not contact the upstream server.
            if edited is None:
                response_status = 403
                response_reason = "Request dropped by PacketSniffer"
                response_body = response_reason.encode("utf-8")
                error = "Request dropped by user"

                await send_error(
                    writer,
                    403,
                    response_reason,
                )
                return

            (
                outgoing_method,
                host,
                port,
                path,
                outgoing_headers,
                outgoing_body,
            ) = prepare_edited_request(edited)

            method = decode(outgoing_method)
            request_headers = list(outgoing_headers)
            request_body = outgoing_body

        if port != 80:
            raise HTTPProxyError(
                "Plain HTTP handler only supports port 80. "
                "Use CONNECT for HTTPS."
            )

        headers = filter_headers(outgoing_headers)

        if not any(name.lower() == b"host" for name, value in headers):
            headers.append((b"host", host.encode("idna")))

        headers = [
            (name, value)
            for name, value in headers
            if name.lower() not in (b"content-length", b"transfer-encoding")
        ]

        headers.append(
            (b"content-length", str(len(outgoing_body)).encode("ascii"))
        )
        headers.append((b"connection", b"close"))

        # Network operation: connect, send request and receive response.
        async with asyncio.timeout(UPSTREAM_TIMEOUT):
            upstream_reader, upstream_writer = await asyncio.open_connection(
                host,
                port,
            )

            upstream_connection = h11.Connection(
                h11.CLIENT,
                max_incomplete_event_size=MAX_HEADER_SIZE,
            )

            outgoing_request = h11.Request(
                method=outgoing_method,
                target=path.encode("latin-1"),
                headers=headers,
            )

            upstream_writer.write(
                upstream_connection.send(outgoing_request)
            )

            if outgoing_body:
                upstream_writer.write(
                    upstream_connection.send(
                        h11.Data(data=outgoing_body)
                    )
                )

            upstream_writer.write(
                upstream_connection.send(h11.EndOfMessage())
            )

            await upstream_writer.drain()

            # Forward informational responses, then wait for the final one.
            while True:
                upstream_response = await next_event(
                    upstream_connection,
                    upstream_reader,
                )

                if isinstance(
                    upstream_response,
                    h11.InformationalResponse,
                ):
                    interim = h11.InformationalResponse(
                        status_code=upstream_response.status_code,
                        headers=filter_headers(
                            list(upstream_response.headers)
                        ),
                        reason=upstream_response.reason,
                    )

                    writer.write(client_connection.send(interim))
                    await writer.drain()
                    continue

                if isinstance(upstream_response, h11.Response):
                    response_status = upstream_response.status_code
                    response_reason = decode(
                        upstream_response.reason or b""
                    )
                    response_headers = list(
                        upstream_response.headers
                    )
                    break

                raise HTTPProxyError(
                    f"Unexpected upstream response: {upstream_response!r}"
                )

            response_body = await read_body(
                upstream_connection,
                upstream_reader,
            )

        # ---------------------------------------------------------
        # RESPONSE INTERCEPTION
        # This happens after the upstream response is received,
        # but before any final response bytes reach the browser.
        # ---------------------------------------------------------

        if interceptor is not None:
            paused_response = {
                "status_code": response_status,
                "reason": response_reason,
                "headers": [
                    [decode(name), decode(value)]
                    for name, value in response_headers
                ],
                "body_base64": base64.b64encode(
                    response_body
                ).decode("ascii"),
                "request_method": method,
                "request_url": f"http://{host}:{port}{path}",
                "scheme": "http",
            }

            edited_response = await interceptor.pause_response(
                paused_response
            )

            # Dropped response: do not send the upstream response to browser.
            if edited_response is None:
                error = "Response dropped by user"
                return

            (
                response_status,
                response_reason,
                response_headers,
                response_body,
            ) = prepare_edited_response(edited_response)

        # A response to HEAD, or a 204/304 response, must not carry a body.
        if method.upper() == "HEAD" or response_status in (204, 304):
            response_body = b""

        # Remove stale framing headers and recalculate Content-Length.
        client_headers = filter_headers(response_headers)

        client_headers = [
            (name, value)
            for name, value in client_headers
            if name.lower() not in (b"content-length", b"transfer-encoding")
        ]

        if response_status not in (204, 304):
            client_headers.append(
                (b"content-length", str(len(response_body)).encode("ascii"))
            )

        client_headers.append((b"connection", b"close"))

        outgoing_response = h11.Response(
            status_code=response_status,
            headers=client_headers,
            reason=response_reason.encode("latin-1", errors="replace"),
        )

        writer.write(client_connection.send(outgoing_response))

        if response_body:
            writer.write(
                client_connection.send(
                    h11.Data(data=response_body)
                )
            )

        writer.write(
            client_connection.send(h11.EndOfMessage())
        )

        await writer.drain()

    except asyncio.TimeoutError:
        error = "Upstream connection timed out"

        if response_status is None:
            try:
                await send_error(writer, 504, "Gateway Timeout")
            except Exception:
                pass

    except asyncio.CancelledError:
        raise

    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

        if response_status is None:
            try:
                await send_error(writer, 502, "Bad Gateway")
            except Exception:
                pass

    finally:
        if upstream_writer is not None:
            upstream_writer.close()

            try:
                await upstream_writer.wait_closed()
            except Exception:
                pass

        duration_ms = (time.perf_counter() - started) * 1000

        record = TrafficRecord(
            method=method,
            url=f"http://{host}:{port}{path}" if host else path,
            scheme="http",
            host=host,
            port=port,
            path=path,
            request_headers=[
                (decode(name), decode(value))
                for name, value in request_headers
            ],
            request_body=request_body,
            status_code=response_status,
            reason=response_reason,
            response_headers=[
                (decode(name), decode(value))
                for name, value in response_headers
            ],
            response_body=response_body,
            duration_ms=duration_ms,
            error=error,
        )

        if storage is not None:
            await storage.save(record)
