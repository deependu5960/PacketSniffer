
import asyncio

from config import (
    PROXY_HOST,
    PROXY_PORT,
    MAX_CONNECTIONS,
    MAX_HEADER_SIZE,
)

from proxy.connection import handle_client


class ProxyServer:
    def __init__(
        self,
        storage,
        interceptor=None,
        host=PROXY_HOST,
        port=PROXY_PORT,
    ):
        self.storage = storage
        self.interceptor = interceptor
        self.host = host
        self.port = port

        self.server = None
        self.semaphore = asyncio.Semaphore(MAX_CONNECTIONS)
        self.active_tasks = set()
        self.running = False

    async def _handle_client(self, reader, writer):
        task = asyncio.current_task()

        if task:
            self.active_tasks.add(task)

        try:
            async with self.semaphore:
                await handle_client(
                    reader,
                    writer,
                    self.storage,
                    self.interceptor,
                )

        finally:
            if task:
                self.active_tasks.discard(task)

    async def start(self):
        if self.running:
            return

        await self.storage.initialize()

        self.server = await asyncio.start_server(
            self._handle_client,
            host=self.host,
            port=self.port,
            limit=MAX_HEADER_SIZE + 65536,
        )

        self.running = True

        print("=" * 45)
        print("          PACKET SNIFF PROXY")
        print("=" * 45)
        print(f"[PROXY] Listening on {self.host}:{self.port}")
        print("[PROXY] HTTP/1.1 enabled")
        print("[PROXY] HTTPS MITM handler connected")
        print("[PROXY] Interceptor controller connected")
        print(f"[PROXY] Maximum connections: {MAX_CONNECTIONS}")
        print("=" * 45)

    async def stop(self):
        if not self.running:
            return

        self.running = False

        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.server = None

        tasks = list(self.active_tasks)

        for task in tasks:
            task.cancel()

        if tasks:
            await asyncio.gather(
                *tasks,
                return_exceptions=True,
            )

        print("[PROXY] Stopped.")

    def status(self):
        return {
            "running": self.running,
            "host": self.host,
            "port": self.port,
            "active_connections": len(self.active_tasks),
        }
