from fastapi import WebSocket
import json


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.authorizers = {}

    async def connect(self, websocket: WebSocket, subprotocol=None, authorize=None):
        await websocket.accept(subprotocol=subprotocol)
        self.active_connections.append(websocket)
        self.authorizers[websocket] = authorize

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.authorizers.pop(websocket, None)

    async def broadcast(self, message: dict):
        text = json.dumps(message, default=str)
        for conn in list(self.active_connections):
            try:
                authorize = self.authorizers.get(conn)
                if authorize is not None and not authorize():
                    await conn.close(code=1008)
                    self.disconnect(conn)
                    continue
                await conn.send_text(text)
            except Exception:
                self.disconnect(conn)

    @property
    def connection_count(self):
        return len(self.active_connections)


manager = ConnectionManager()
