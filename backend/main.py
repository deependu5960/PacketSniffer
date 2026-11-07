
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from api.websocket import router as websocket_router
from api.ai_routes import router as ai_router

from ai.config import AIManager

from certificates.ca import generate_ca

from interceptor.controller import InterceptorController
from proxy.server import ProxyServer
from traffic.manager import TrafficManager
from traffic.storage import TrafficStorage


@asynccontextmanager
async def lifespan(app: FastAPI):

    # Generate or validate installation Root CA.
    generate_ca()

    storage = TrafficStorage()
    manager = TrafficManager(storage)

    await manager.initialize()

    interceptor = InterceptorController(
        event_publisher=manager.publish
    )

    app.state.traffic_manager = manager
    app.state.interceptor = interceptor

    app.state.proxy_server = ProxyServer(
        manager,
        interceptor,
    )

    # Initialize dynamic AI manager.
    ai_manager = AIManager()

    app.state.ai_manager = ai_manager

    try:
        await ai_manager.initialize()
        print("[AI] PacketSniffer AI manager initialized.")

        print("[API] PacketSniffer backend initialized.")

        yield

    finally:

        await app.state.proxy_server.stop()
        await manager.close()

        await ai_manager.close()

        print("[API] PacketSniffer backend stopped.")


app = FastAPI(
    title="PacketSniffer API",
    description="Local HTTP/HTTPS security testing proxy",
    version="1.0.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router)
app.include_router(websocket_router)
app.include_router(ai_router)


@app.get("/")
async def root():

    return {
        "name": "PacketSniffer",
        "status": "online",
        "docs": "/docs",
    }
