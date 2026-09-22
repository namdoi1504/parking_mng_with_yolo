from fastapi import FastAPI
from .routers import ai, parking

app = FastAPI(
    title="Parking Mng API"
)

app.include_router(ai.router)


@app.get("/")
def root():
    return {
        "message":"2 thang dan"
    }
