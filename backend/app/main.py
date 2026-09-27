from fastapi import FastAPI
from .routers import ai, parking, users

app = FastAPI(
    title="Parking Mng API"
)

# app.include_router(ai.router)
app.include_router(users.router)
# app.include_router(parking.router)


@app.get("/")
def root():
    return {
        "message":"2 thang dan"
    }


