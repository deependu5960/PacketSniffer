import asyncio
import base64
import gzip
import json
import re
import zlib
from dataclasses import asdict


from traffic.storage import TrafficStorage


def decode_body(body: bytes, headers: list, label: str):
    """Decode HTTP Content-Encoding while preserving original bytes."""
    if not body:
        return body, None

    encoding_header = next(
        (
            value
            for key, value in (headers or [])
            if key.lower() == "content-encoding"
        ),
        "",
    )

    encodings = [
        item.strip().lower()
        for item in encoding_header.split(",")
        if item.strip() and item.strip().lower() != "identity"
    ]

    if not encodings:
        return body, None

    decoded = body

    try:
        for encoding in reversed(encodings):
            if encoding in ("gzip", "x-gzip"):
                decoded = gzip.decompress(decoded)

            elif encoding == "deflate":
                try:
                    decoded = zlib.decompress(decoded)
                except zlib.error:
                    decoded = zlib.decompress(
                        decoded, -zlib.MAX_WBITS
                    )

            elif encoding == "br":
                import brotli
                decoded = brotli.decompress(decoded)

            elif encoding == "zstd":
                import zstandard
                decoded = zstandard.ZstdDecompressor().decompress(
                    decoded
                )

            else:
                raise ValueError(
                    f"Unsupported Content-Encoding: {encoding}"
                )

        return decoded, None

    except Exception as exc:
        return body, f"{label} decoding failed: {exc}"


def get_header(headers: list, name: str) -> str:
    return next(
        (
            value
            for key, value in (headers or [])
            if key.lower() == name.lower()
        ),
        "",
    )


def detect_response(body: bytes, headers: list) -> dict:
    """
    Detect response format using headers and body signatures.
    Does not modify the response body.
    """
    declared_type = get_header(headers, "content-type")
    mime = declared_type.split(";")[0].strip().lower()

    result = {
        "declared_content_type": declared_type,
        "detected_content_type": mime or "application/octet-stream",
        "display_type": "binary",
        "is_text": False,
        "is_binary": True,
        "detection_method": "default",
    }

    if not body:
        result.update({
            "display_type": "empty",
            "is_text": True,
            "is_binary": False,
            "detection_method": "empty-body",
        })
        return result

    # Strong binary signatures.
    signatures = [
        (b"\x89PNG\r\n\x1a\n", "image/png", "image"),
        (b"\xff\xd8\xff", "image/jpeg", "image"),
        (b"GIF87a", "image/gif", "image"),
        (b"GIF89a", "image/gif", "image"),
        (b"%PDF-", "application/pdf", "pdf"),
        (b"RIFF", None, None),
        (b"wOFF", "font/woff", "binary"),
        (b"wOF2", "font/woff2", "binary"),
        (b"\x00\x01\x00\x00", "font/ttf", "binary"),
        (b"OTTO", "font/otf", "binary"),
    ]

    for signature, detected_mime, display_type in signatures:
        if body.startswith(signature):
            if signature == b"RIFF" and body[8:12] == b"WEBP":
                detected_mime = "image/webp"
                display_type = "image"
            elif signature == b"RIFF":
                continue

            result.update({
                "detected_content_type": detected_mime,
                "display_type": display_type,
                "is_text": False,
                "is_binary": True,
                "detection_method": "file-signature",
            })
            return result

    # SVG is text, but can be identified as an image format.
    sample = body[:4096].lstrip(b"\xef\xbb\xbf \t\r\n").lower()

    if sample.startswith(b"<svg") or (
        sample.startswith(b"<?xml") and b"<svg" in sample
    ):
        result.update({
            "detected_content_type": "image/svg+xml",
            "display_type": "image",
            "is_text": True,
            "is_binary": False,
            "detection_method": "content-sniffing",
        })
        return result

    # Attempt UTF-8 decoding. Invalid UTF-8 usually indicates binary data
    # or a different character encoding.
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError:
        result["detection_method"] = "invalid-utf8"
        return result

    # Reject text containing excessive control characters.
    if any(
        ord(char) < 32 and char not in "\t\n\r\f"
        for char in text
    ):
        result["detection_method"] = "binary-control-characters"
        return result

    stripped = text.lstrip()

    # Detect JSON even when Content-Type is missing.
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            json.loads(text)
            detected = "application/json"
        except (ValueError, TypeError):
            detected = None

        if detected:
            result.update({
                "detected_content_type": detected,
                "display_type": "json",
                "is_text": True,
                "is_binary": False,
                "detection_method": "json-sniffing",
            })
            return result

    # Detect HTML.
    if re.match(
        r"(?is)^(<!doctype\s+html|<html\b|<head\b|<body\b)",
        stripped[:500],
    ):
        result.update({
            "detected_content_type": "text/html",
            "display_type": "html",
            "is_text": True,
            "is_binary": False,
            "detection_method": "html-sniffing",
        })
        return result

    # Detect XML.
    if stripped.startswith("<?xml"):
        result.update({
            "detected_content_type": "application/xml",
            "display_type": "xml",
            "is_text": True,
            "is_binary": False,
            "detection_method": "xml-sniffing",
        })
        return result

    # Respect a declared textual media type.
    if (
        mime.startswith("text/")
        or mime in (
            "application/json",
            "application/xml",
            "application/javascript",
            "application/x-javascript",
            "application/x-www-form-urlencoded",
            "application/graphql",
        )
        or mime.endswith("+json")
        or mime.endswith("+xml")
    ):
        display_type = (
            "json" if "json" in mime
            else "html" if mime == "text/html"
            else "xml" if "xml" in mime
            else "text"
        )

        result.update({
            "detected_content_type": mime,
            "display_type": display_type,
            "is_text": True,
            "is_binary": False,
            "detection_method": "content-type-header",
        })
        return result

    # No useful Content-Type, but the body is valid UTF-8 text.
    if not mime or mime == "application/octet-stream":
        result.update({
            "detected_content_type": "text/plain",
            "display_type": "text",
            "is_text": True,
            "is_binary": False,
            "detection_method": "utf8-sniffing",
        })
        return result

    # Unknown declared media type: keep it classified as binary.
    result["detection_method"] = "unknown-content-type"
    return result


class TrafficManager:
    def __init__(self, storage: TrafficStorage):
        self.storage = storage
        self.lock = asyncio.Lock()
        self.subscribers: set[asyncio.Queue] = set()
        self.initialized = False

    async def initialize(self):
        async with self.lock:
            if not self.initialized:
                await self.storage.initialize()
                self.initialized = True

    async def close(self):
        async with self.lock:
            if self.initialized:
                await self.storage.close()
                self.initialized = False

    async def save(self, record):
        async with self.lock:
            await self.storage.save(record)

        self.publish({
            "type": "traffic.completed",
            "data": self.serialize(record),
        })

    async def get_recent(self, limit=100):
        async with self.lock:
            records = await self.storage.get_recent(limit)

        return [self.serialize(record) for record in records]

    async def get_by_id(self, record_id):
        async with self.lock:
            record = await self.storage.get_by_id(record_id)

        return self.serialize(record) if record else None

    async def clear(self):
        async with self.lock:
            if not self.initialized:
                raise RuntimeError("Traffic storage is not initialized")

            await self.storage.connection.execute(
                "DELETE FROM traffic"
            )
            await self.storage.connection.commit()

        self.publish({"type": "traffic.cleared", "data": {}})

    def subscribe(self):
        queue = asyncio.Queue(maxsize=500)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        self.subscribers.discard(queue)

    def publish(self, event):
        for queue in list(self.subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    @staticmethod
    def serialize(record):
        data = asdict(record)

        request_body = record.request_body or b""
        response_body = record.response_body or b""

        decoded_request, request_error = decode_body(
            request_body,
            record.request_headers,
            "Request",
        )

        decoded_response, response_error = decode_body(
            response_body,
            record.response_headers,
            "Response",
        )

        response_detection = detect_response(
            decoded_response,
            record.response_headers,
        )

        data["request_body"] = base64.b64encode(
            request_body
        ).decode("ascii")

        data["response_body"] = base64.b64encode(
            response_body
        ).decode("ascii")

        data["request_body_decoded"] = base64.b64encode(
            decoded_request
        ).decode("ascii")

        data["response_body_decoded"] = base64.b64encode(
            decoded_response
        ).decode("ascii")

        data["request_decode_error"] = request_error
        data["response_decode_error"] = response_error

        data.update(response_detection)

        data["response_size_original"] = len(response_body)
        data["response_size_decoded"] = len(decoded_response)

        # Serialize WebSocket frames (if any)
        serialized_frames = []
        for frame in record.frames or []:
            serialized_frames.append({
                "direction": frame.direction,
                "opcode": frame.opcode,
                "payload": base64.b64encode(
                    frame.payload or b""
                ).decode("ascii"),
                "timestamp": frame.timestamp,
                "edited": frame.edited,
            })
        data["frames"] = serialized_frames

        return data