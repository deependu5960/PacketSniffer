import base64
import re


MARKER_PATTERN = re.compile(r"§(.*?)§", re.DOTALL)


class RequestBuildError(Exception):
    pass


def find_payload_positions(raw_request: str) -> list[str]:
    if raw_request.count("§") % 2 != 0:
        raise RequestBuildError("Unmatched payload marker.")

    return MARKER_PATTERN.findall(raw_request)


def build_request_with_payload(
    raw_request: str,
    position_index: int,
    payload: str,
) -> str:

    positions = find_payload_positions(raw_request)

    if not positions:
        raise RequestBuildError("No payload positions found.")

    if position_index < 0 or position_index >= len(positions):
        raise RequestBuildError("Invalid payload position.")

    current_index = 0

    def replace_marker(match):
        nonlocal current_index

        original = match.group(1)

        if current_index == position_index:
            replacement = payload
        else:
            replacement = original

        current_index += 1
        return replacement

    return MARKER_PATTERN.sub(replace_marker, raw_request)


def build_request_with_payloads(
    raw_request: str,
    payloads: list[str],
) -> str:

    positions = find_payload_positions(raw_request)

    if len(positions) != len(payloads):
        raise RequestBuildError(
            "Payload count must match marked positions."
        )

    payload_index = 0

    def replace_marker(match):
        nonlocal payload_index

        replacement = payloads[payload_index]
        payload_index += 1

        return replacement

    return MARKER_PATTERN.sub(replace_marker, raw_request)


def parse_raw_request(
    raw_request: str,
    scheme: str = "https",
) -> dict:

    separator = None

    for candidate in ("\r\n\r\n", "\n\n"):
        if candidate in raw_request:
            separator = candidate
            break

    if separator:
        head, body = raw_request.split(separator, 1)
    else:
        head = raw_request
        body = ""

    lines = head.splitlines()

    if not lines:
        raise RequestBuildError("Request is empty.")

    parts = lines[0].strip().split(" ", 2)

    if len(parts) != 3:
        raise RequestBuildError("Invalid HTTP request line.")

    method, target, version = parts

    headers = []

    for line in lines[1:]:
        if not line.strip():
            continue

        if ":" not in line:
            raise RequestBuildError(f"Invalid HTTP header: {line}")

        name, value = line.split(":", 1)
        headers.append([name.strip(), value.strip()])

    if target.startswith(("http://", "https://")):
        url = target
    else:
        host = next(
            (
                value
                for name, value in headers
                if name.lower() == "host"
            ),
            None,
        )

        if not host:
            raise RequestBuildError("Host header is missing.")

        if scheme not in ("http", "https"):
            raise RequestBuildError("Unsupported URL scheme.")

        path = target if target.startswith("/") else f"/{target}"
        url = f"{scheme}://{host}{path}"

    try:
        body_bytes = body.encode("latin-1")
    except UnicodeEncodeError as exc:
        raise RequestBuildError(
            "Body cannot be encoded as Latin-1."
        ) from exc

    body_base64 = base64.b64encode(body_bytes).decode("ascii")

    return {
        "method": method.upper(),
        "url": url,
        "headers": headers,
        "body_base64": body_base64,
        "http_version": version,
    }


def build_sender_request(
    raw_request: str,
    scheme: str = "https",
) -> dict:

    if "§" in raw_request:
        raise RequestBuildError(
            "Unresolved payload markers remain."
        )

    return parse_raw_request(raw_request, scheme)