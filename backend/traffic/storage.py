import json
from pathlib import Path

import aiosqlite

from config import DATABASE_PATH
from traffic.models import TrafficRecord, WebSocketFrame


class TrafficStorage:

    def __init__(self, database_path: Path = DATABASE_PATH):
        self.database_path = Path(database_path)
        self.connection = None

    async def initialize(self):
        """Create the database and traffic table."""

        self.database_path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        self.connection = await aiosqlite.connect(
            self.database_path
        )

        self.connection.row_factory = aiosqlite.Row

        await self.connection.execute("""
            CREATE TABLE IF NOT EXISTS traffic (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,

                method TEXT NOT NULL,
                url TEXT NOT NULL,
                scheme TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                path TEXT NOT NULL,

                request_headers TEXT NOT NULL,
                request_body BLOB,

                status_code INTEGER,
                reason TEXT,
                response_headers TEXT,
                response_body BLOB,

                is_websocket INTEGER NOT NULL DEFAULT 0,
                frames TEXT,

                duration_ms REAL,
                error TEXT
            )
        """)

        await self.connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_traffic_timestamp
            ON traffic(timestamp)
        """)

        # Migrate existing databases: add new columns if they don't exist.
        await self._ensure_column(
            "is_websocket", "INTEGER NOT NULL DEFAULT 0"
        )
        await self._ensure_column("frames", "TEXT")

        await self.connection.commit()

        print("[DB] Traffic storage initialized.")

    async def _ensure_column(self, name: str, definition: str):
        """Add a column if it does not already exist (SQLite migration)."""

        if self.connection is None:
            raise RuntimeError("Storage is not initialized")

        async with self.connection.execute(
            "PRAGMA table_info(traffic)"
        ) as cursor:
            rows = await cursor.fetchall()

        existing = {row["name"] for row in rows}

        if name not in existing:
            await self.connection.execute(
                f"ALTER TABLE traffic ADD COLUMN {name} {definition}"
            )
            print(f"[DB] Migrated: added column '{name}'")

    async def save(self, record: TrafficRecord):
        """Save one transaction (HTTP or WebSocket)."""

        if self.connection is None:
            raise RuntimeError("Storage is not initialized")

        frames_json = None

        if record.frames:
            frames_json = json.dumps([
                {
                    "direction": frame.direction,
                    "opcode": frame.opcode,
                    "payload": frame.payload.hex() if frame.payload else "",
                    "timestamp": frame.timestamp,
                    "edited": frame.edited,
                }
                for frame in record.frames
            ])

        await self.connection.execute("""
            INSERT OR REPLACE INTO traffic (
                id, timestamp,
                method, url, scheme, host, port, path,
                request_headers, request_body,
                status_code, reason,
                response_headers, response_body,
                is_websocket, frames,
                duration_ms, error
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        """, (
            record.id,
            record.timestamp,
            record.method,
            record.url,
            record.scheme,
            record.host,
            record.port,
            record.path,
            json.dumps(record.request_headers),
            record.request_body,
            record.status_code,
            record.reason,
            json.dumps(record.response_headers),
            record.response_body,
            1 if record.is_websocket else 0,
            frames_json,
            record.duration_ms,
            record.error
        ))

        await self.connection.commit()

    async def get_recent(self, limit: int = 100):
        """Return the most recent transactions."""

        if self.connection is None:
            raise RuntimeError("Storage is not initialized")

        limit = max(1, min(limit, 1000))

        async with self.connection.execute("""
            SELECT * FROM traffic
            ORDER BY timestamp DESC
            LIMIT ?
        """, (limit,)) as cursor:

            rows = await cursor.fetchall()

        return [self._row_to_record(row) for row in rows]

    async def get_by_id(self, record_id: str):
        """Retrieve one transaction by its ID."""

        if self.connection is None:
            raise RuntimeError("Storage is not initialized")

        async with self.connection.execute("""
            SELECT * FROM traffic WHERE id = ?
        """, (record_id,)) as cursor:

            row = await cursor.fetchone()

        if row is None:
            return None

        return self._row_to_record(row)

    @staticmethod
    def _row_to_record(row):
        """Convert a database row into a TrafficRecord."""

        frames: list[WebSocketFrame] = []

        raw_frames = row["frames"] if "frames" in row.keys() else None

        if raw_frames:
            try:
                for item in json.loads(raw_frames):
                    frames.append(WebSocketFrame(
                        direction=item.get("direction", "client"),
                        opcode=item.get("opcode", "text"),
                        payload=bytes.fromhex(
                            item.get("payload", "")
                        ),
                        timestamp=item.get("timestamp", 0.0),
                        edited=item.get("edited", False),
                    ))
            except Exception:
                frames = []

        is_websocket = bool(
            row["is_websocket"]
            if "is_websocket" in row.keys()
            else 0
        )

        return TrafficRecord(
            id=row["id"],
            timestamp=row["timestamp"],
            method=row["method"],
            url=row["url"],
            scheme=row["scheme"],
            host=row["host"],
            port=row["port"],
            path=row["path"],
            request_headers=json.loads(row["request_headers"]),
            request_body=bytes(row["request_body"] or b""),
            status_code=row["status_code"],
            reason=row["reason"] or "",
            response_headers=json.loads(
                row["response_headers"] or "[]"
            ),
            response_body=bytes(row["response_body"] or b""),
            is_websocket=is_websocket,
            frames=frames,
            duration_ms=row["duration_ms"],
            error=row["error"]
        )

    async def close(self):
        """Close the database connection."""

        if self.connection is not None:
            await self.connection.close()
            self.connection = None
            print("[DB] Traffic storage closed.")
