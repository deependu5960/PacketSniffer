from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4


@dataclass
class WebSocketFrame:
    """A single WebSocket frame captured during a connection."""

    # "client" or "server" — which side sent this frame
    direction: str = "client"

    # "text", "binary", "ping", "pong", "close"
    opcode: str = "text"

    # Raw payload bytes (base64-encoded when serialized)
    payload: bytes = b""

    # Unix timestamp (seconds) when the frame was observed
    timestamp: float = 0.0

    # True if the frame was modified by the user in the frontend
    edited: bool = False


@dataclass
class TrafficRecord:
    # Unique transaction identifier
    id: str = field(default_factory=lambda: str(uuid4()))

    # Request information
    method: str = ""
    url: str = ""
    scheme: str = "http"
    host: str = ""
    port: int = 80
    path: str = "/"

    request_headers: list[tuple[str, str]] = field(default_factory=list)
    request_body: bytes = b""

    # Response information
    status_code: int | None = None
    reason: str = ""
    response_headers: list[tuple[str, str]] = field(default_factory=list)
    response_body: bytes = b""

    # WebSocket information (only populated when this record represents
    # a WebSocket connection that was upgraded from HTTPS)
    is_websocket: bool = False
    frames: list[WebSocketFrame] = field(default_factory=list)

    # Timing and error information
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    duration_ms: float | None = None
    error: str | None = None