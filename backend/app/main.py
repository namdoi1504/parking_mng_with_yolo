from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from .config import settings
from .db import SessionLocal
from .oauth2 import authenticate_token
from .routers import auth, parking, users, roles, permissions, cameras, stats, stream, parking_slots
from .statistics import aggregate_stats
from .websocket_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    if settings.STATS_SCHEDULER_ENABLED:
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(aggregate_stats, "cron", minute="*/15", id="parking-stats",
                          max_instances=1, coalesce=True, misfire_grace_time=60)
        scheduler.start()
    app.state.scheduler = scheduler
    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)


app = FastAPI(title="Parking Management API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "ngrok-skip-browser-warning"],
)
for route in (auth, users, roles, permissions, cameras, parking, stats, stream, parking_slots):
    app.include_router(route.router)


@app.websocket("/ws/parking")
async def websocket_parking(websocket: WebSocket):
    # Non-browser clients can send a Bearer header; browsers can use subprotocols
    # ["parking", "bearer.<access_token>"] without putting credentials in the URL.
    header = websocket.headers.get("authorization", "")
    protocols = websocket.scope.get("subprotocols", [])
    token = header[7:] if header.lower().startswith("bearer ") else next(
        (p[7:] for p in protocols if p.startswith("bearer.")), "")

    def authorized():
        try:
            with SessionLocal() as db:
                user = authenticate_token(token, db)
                return "parking:view" in {p.code for p in user.role.permissions}
        except HTTPException:
            return False

    if not await run_in_threadpool(authorized):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket, subprotocol="parking" if "parking" in protocols else None,
                          authorize=authorized)
    try:
        while True:
            await websocket.receive_text()
            if not await run_in_threadpool(authorized):
                await websocket.close(code=1008)
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


@app.get("/")
def root():
    return {"message": "Parking Management API", "ws_endpoint": "/ws/parking", "docs": "/docs",
            "active_ws_connections": manager.connection_count}
