from pydantic import BaseModel

class ParkingSlotStatus(BaseModel):
    slot_code: str
    status: str
    confidence: float | None = None

class AIparkingstatus(BaseModel):
    camera_id: str
    parking_slots: list[ParkingSlotStatus]