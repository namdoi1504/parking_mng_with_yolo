from fastapi import APIRouter
from ..schemas import AIparkingstatus

router = APIRouter(
    prefix = "/api/ai",
    tags=["AI"]
)


@router.post("/parking_status")
def receive_parking_status(data: AIparkingstatus):
    print("Camera:", data.camera_id)
    for slot in data.parking_slots:
        print(
            slot.slot_code,
            slot.status,
            slot.confidence
        )
    return {
        "message":"AI result received"
    }