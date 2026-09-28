
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from .routers import ai, parking, users
from .websocket_manager import manager

app = FastAPI(
    title="Parking Management API",
    description="API cho hệ thống quản lý bãi đỗ xe với AI YOLO",
    version="1.0.0",
)


app.include_router(users.router)
app.include_router(parking.router)
# app.include_router(ai.router)   # enable khi cần


@app.websocket("/ws/parking")
async def websocket_parking(websocket: WebSocket):
    """WebSocket endpoint — FE kết nối vào đây để nhận update real-time."""
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive, chờ ping từ client
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/")
def root():
    return {
        "message": "Parking Management API",
        "ws_endpoint": "/ws/parking",
        "docs": "/docs",
        "active_ws_connections": manager.connection_count,
    }


