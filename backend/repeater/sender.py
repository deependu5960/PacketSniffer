import asyncio
import base64
import re
import socket
import ssl
import time
import zlib
from urllib.parse import urlsplit

import h11

from config import MAX_BODY_SIZE, MAX_HEADER_SIZE


READ_SIZE = 65536
HANDSHAKE_TIMEOUT = 10
DECODE_LIMIT = 64 * 1024 * 1024

DEFAULT_PORTS = {"http": 80, "https": 443}
METHOD_RE = re.compile(r"^[A-Z0-9!#$%&'*+.^_`|~-]+$")

# Framing is recomputed by us, so these are never copied from the editor.
STRIPPED_HEADERS = {
    b"connection",
    b"keep-alive",
    b"proxy-connection",
    b"transfer-encoding",
    b"content-length",
    b"upgrade",
}

BODY_METHODS = {b"POST", b"PUT", b"PATCH"}


class RepeaterError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _text(value: bytes) -> str:
    return value.decode("latin-1", errors="replace")


# ---------------------------------------------------------
# Request preparation
# ---------------------------------------------------------

def _prepare(method, url, raw_headers, body_base64):
    method = str(method or "").strip().upper()

    if not method or not METHOD_RE.match(method):
        raise RepeaterError("Invalid request method", 400)

    parsed = urlsplit(str(url or "").strip())
    scheme = parsed.scheme.lower()

    if scheme not in DEFAULT_PORTS:
        raise RepeaterError("URL must start with http:// or https://", 400)

    host = parsed.hostname

    if not host:
        raise RepeaterError("URL has no hostname", 400)

    if parsed.username or parsed.password:
        raise RepeaterError("Credentials in the URL are not supported", 400)

    try:
        port = parsed.port or DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise RepeaterError("Invalid port in URL", 400) from exc

    target = parsed.path or "/"

    if parsed.query:
        target += "?" + parsed.query

    try:
        target_bytes = target.encode("latin-1")
    except UnicodeEncodeError as exc:
        raise RepeaterError(
            "The request path contains characters that must be "
            "percent-encoded",
            400,
        ) from exc

    headers = []
    has_host = False

    for item in raw_headers:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise RepeaterError("Invalid header entry", 400)

        name = str(item[0]).strip()
        value = str(item[1])

        if not name or any(char in name for char in (":", "\r", "\n", " ")):
            raise RepeaterError(f"Invalid header name: {name!r}", 400)

        if "\r" in value or "\n" in value:
            raise RepeaterError(f"Invalid value for header {name}", 400)

        try:
            name_bytes = name.encode("ascii")
            value_bytes = value.encode("latin-1")
        except UnicodeEncodeError as exc:
            raise RepeaterError(
                f"Invalid characters in header {name}", 400
            ) from exc

        lowered = name_bytes.lower()

        if lowered in STRIPPED_HEADERS:
            continue

        if lowered == b"host":
            has_host = True

        headers.append((name_bytes, value_bytes))

    if not has_host:
        display_host = f"[{host}]" if ":" in host else host

        if port != DEFAULT_PORTS[scheme]:
            display_host = f"{display_host}:{port}"

        try:
            headers.append((b"host", display_host.encode("idna")))
        except UnicodeError as exc:
            raise RepeaterError("Invalid hostname", 400) from exc

    try:
        body = base64.b64decode(body_base64 or "", validate=True)
    except Exception as exc:
        raise RepeaterError("Invalid Base64 request body", 400) from exc

    method_bytes = method.encode("ascii")

    if body or method_bytes in BODY_METHODS:
        headers.append((b"content-length", str(len(body)).encode()))

    headers.append((b"connection", b"close"))

    return scheme, host, port, method_bytes, target_bytes, headers, body


# ---------------------------------------------------------
# Network helpers
# ---------------------------------------------------------

def _make_ssl_context(verify: bool) -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.set_alpn_protocols(["http/1.1"])

    if not verify:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    return context


async def _next_event(connection, reader):
    while True:
        event = connection.next_event()

        if event is h11.NEED_DATA:
            data = await reader.read(READ_SIZE)
            connection.receive_data(data)
            continue

        return event


# ---------------------------------------------------------
# Body decoding (display only; raw bytes are always kept)
# ---------------------------------------------------------

def _inflate(data: bytes, wbits: int) -> bytes:
    decompressor = zlib.decompressobj(wbits)
    output = decompressor.decompress(data, DECODE_LIMIT + 1)

    if len(output) > DECODE_LIMIT:
        raise ValueError("Decoded body is larger than the safety limit")

    return output


def decode_body(body: bytes, content_encoding: str):
    """
    Returns (decoded_bytes_or_None, error_or_None).

    decoded_bytes is None when nothing had to be decoded or decoding
    failed, so callers fall back to the raw bytes.
    """

    encodings = [
        item.strip().lower()
        for item in content_encoding.split(",")
        if item.strip()
    ]

    encodings = [item for item in encodings if item != "identity"]

    if not encodings or not body:
        return None, None

    data = body

    try:
        # Encodings are applied in order, so undo them in reverse.
        for encoding in reversed(encodings):
            if encoding in ("gzip", "x-gzip"):
                data = _inflate(data, 16 + zlib.MAX_WBITS)

            elif encoding == "deflate":
                try:
                    data = _inflate(data, zlib.MAX_WBITS)
                except zlib.error:
                    data = _inflate(data, -zlib.MAX_WBITS)

            elif encoding == "br":
                import brotli

                data = brotli.decompress(data)

            elif encoding in ("zstd", "zstandard"):
                import zstandard

                data = zstandard.ZstdDecompressor().decompressobj().decompress(
                    data
                )

            else:
                return None, f"Unsupported Content-Encoding: {encoding}"

            if len(data) > DECODE_LIMIT:
                return None, "Decoded body is larger than the safety limit"

    except Exception as exc:
        return None, f"Could not decode body: {exc}"

    return data, None


# ---------------------------------------------------------
# Public API
# ---------------------------------------------------------

async def send_request(
    method,
    url,
    headers,
    body_base64,
    verify_tls=True,
    timeout=30.0,
):
    (
        scheme,
        host,
        port,
        method_bytes,
        target_bytes,
        request_headers,
        request_body,
    ) = _prepare(method, url, headers, body_base64)

    started = time.perf_counter()
    writer = None

    try:
        async with asyncio.timeout(timeout):
            ssl_context = (
                _make_ssl_context(bool(verify_tls))
                if scheme == "https"
                else None
            )

            reader, writer = await asyncio.open_connection(
                host,
                port,
                ssl=ssl_context,
                server_hostname=host if ssl_context else None,
                ssl_handshake_timeout=(
                    HANDSHAKE_TIMEOUT if ssl_context else None
                ),
            )

            connection = h11.Connection(
                h11.CLIENT,
                max_incomplete_event_size=MAX_HEADER_SIZE,
            )

            try:
                writer.write(
                    connection.send(
                        h11.Request(
                            method=method_bytes,
                            target=target_bytes,
                            headers=request_headers,
                        )
                    )
                )

                if request_body:
                    writer.write(
                        connection.send(h11.Data(data=request_body))
                    )

                writer.write(connection.send(h11.EndOfMessage()))
            except h11.LocalProtocolError as exc:
                raise RepeaterError(
                    f"The request could not be sent: {exc}", 400
                ) from exc

            await writer.drain()

            response = None

            while True:
                event = await _next_event(connection, reader)

                if isinstance(event, h11.InformationalResponse):
                    if event.status_code == 101:
                        raise RepeaterError(
                            "Protocol upgrades (101) are not supported "
                            "in Repeater"
                        )
                    continue

                if isinstance(event, h11.Response):
                    response = event
                    break

                raise RepeaterError(
                    f"Unexpected response from server: {event!r}"
                )

            chunks = []
            total = 0

            while True:
                event = await _next_event(connection, reader)

                if isinstance(event, h11.Data):
                    total += len(event.data)

                    if total > MAX_BODY_SIZE:
                        raise RepeaterError(
                            "Response body exceeds the configured size limit",
                            502,
                        )

                    chunks.append(event.data)

                elif isinstance(event, h11.EndOfMessage):
                    break

                else:
                    raise RepeaterError(
                        f"Unexpected response event: {event!r}"
                    )

            body = b"".join(chunks)

    except RepeaterError:
        raise

    except TimeoutError as exc:
        raise RepeaterError(
            f"The request timed out after {timeout:g} seconds", 504
        ) from exc

    except ssl.SSLCertVerificationError as exc:
        raise RepeaterError(
            "TLS certificate verification failed "
            f"({exc.verify_message or exc}). Turn off 'Verify TLS' to "
            "send anyway.",
            502,
        ) from exc

    except ssl.SSLError as exc:
        raise RepeaterError(f"TLS error: {exc}", 502) from exc

    except socket.gaierror as exc:
        raise RepeaterError(f"Could not resolve host '{host}'", 502) from exc

    except ConnectionRefusedError as exc:
        raise RepeaterError(
            f"Connection refused by {host}:{port}", 502
        ) from exc

    except h11.ProtocolError as exc:
        raise RepeaterError(
            f"The server sent an invalid HTTP response: {exc}", 502
        ) from exc

    except OSError as exc:
        raise RepeaterError(f"Connection error: {exc}", 502) from exc

    finally:
        if writer is not None:
            writer.close()

            try:
                await writer.wait_closed()
            except Exception:
                pass

    duration_ms = (time.perf_counter() - started) * 1000

    try:
        raw_items = list(response.headers.raw_items())
    except AttributeError:
        raw_items = list(response.headers)

    response_headers = [
        [_text(name), _text(value)] for name, value in raw_items
    ]

    content_encoding = ", ".join(
        value
        for name, value in response_headers
        if name.lower() == "content-encoding"
    )

    decoded, decode_error = decode_body(body, content_encoding)

    return {
        "url": str(url).strip(),
        "status_code": response.status_code,
        "reason": _text(response.reason or b""),
        "http_version": _text(response.http_version or b"1.1"),
        "headers": response_headers,
        # Exact bytes received from the server.
        "body_base64": base64.b64encode(body).decode("ascii"),
        # Decompressed copy for display. None when nothing was decoded.
        "body_decoded_base64": (
            base64.b64encode(decoded).decode("ascii")
            if decoded is not None
            else None
        ),
        "content_encoding": content_encoding,
        "decode_error": decode_error,
        "duration_ms": round(duration_ms, 1),
        "size_raw": len(body),
        "size_decoded": len(decoded) if decoded is not None else len(body),
    }
