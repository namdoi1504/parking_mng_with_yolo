from fastapi import WebSocket
import json


class ConnectionManager:
    """Quản lý WebSocket connections từ Frontend."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Gửi message đến tất cả FE đang kết nối."""
        text = json.dumps(message, default=str)
        disconnected = []
        for conn in self.active_connections:
            try:
                await conn.send_text(text)
            except Exception:
                disconnected.append(conn)
        for conn in disconnected:
            self.disconnect(conn)

    @property
    def connection_count(self) -> int:
        return len(self.active_connections)


# Singleton dùng chung toàn app
manager = ConnectionManager()
