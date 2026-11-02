from fastapi import WebSocket
import asyncio
import json
from starlette.concurrency import run_in_threadpool


class ConnectionManager:
    def __init__(self, send_timeout_seconds=5):
        self.active_connections: list[WebSocket] = []
        self.authorizers = {}
        self.send_timeout_seconds = send_timeout_seconds

    async def connect(self, websocket: WebSocket, subprotocol=None, authorize=None):
        await websocket.accept(subprotocol=subprotocol)
        self.active_connections.append(websocket)
        self.authorizers[websocket] = authorize

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.authorizers.pop(websocket, None)

    async def broadcast(self, message: dict):
        await self.broadcast_many([message])

    async def broadcast_many(self, messages):
        texts = [json.dumps(message, default=str) for message in messages]
        if not texts:
            return

        async def send(conn):
            try:
                async with asyncio.timeout(self.send_timeout_seconds):
                    # Check current permissions once per committed update, rather
                    # than repeating database queries for every changed slot.
                    authorize = self.authorizers.get(conn)
                    if authorize is not None and not await run_in_threadpool(authorize):
                        await conn.close(code=1008)
                        self.disconnect(conn)
                        return
                    for text in texts:
                        await conn.send_text(text)
            except Exception:
                self.disconnect(conn)
                try:
                    async with asyncio.timeout(0.5):
                        await conn.close(code=1011)
                except Exception:
                    pass

        # A slow viewer must not delay delivery to all other viewers.
        await asyncio.gather(*(send(conn) for conn in list(self.active_connections)))

    @property
    def connection_count(self):
        return len(self.active_connections)


manager = ConnectionManager()
