
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/api/events")
async def traffic_events(websocket: WebSocket):
    manager = websocket.app.state.traffic_manager

    await websocket.accept()
    queue = manager.subscribe()

    try:
        await websocket.send_json({
            "type": "connection.ready",
            "data": {"message": "PacketSniff event stream connected"},
        })

        while True:
            event = await queue.get()
            await websocket.send_json(event)

    except WebSocketDisconnect:
        pass

    finally:
        manager.unsubscribe(queue)
