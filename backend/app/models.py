from sqlalchemy import Column, Integer, String, Float, DateTime
from .db import Base

class ParkingSlot(Base):
    __tablename__ = "Parking_slots"
    id = Column(Integer, primary_key=True, index=True)
    slot_code = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default="empty")
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, nullable=True)
    update_at = Column(DateTime, nullable=True)
