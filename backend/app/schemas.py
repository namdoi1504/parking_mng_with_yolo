from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class ORMBaseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class UserStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class CameraSourceType(str, Enum):
    RTSP = "RTSP"
    VIDEO_FILE = "VIDEO_FILE"


class CameraStatus(str, Enum):
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"


class ParkingSlotStatusEnum(str, Enum):
    EMPTY = "EMPTY"
    OCCUPIED = "OCCUPIED"
    RESERVED = "RESERVED"
    UNKNOWN = "UNKNOWN"


# au

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=255)


class TokenPayload(BaseModel):
    sub: str | None = None
    user_id: int | None = None
    role: str | None = None
    permissions: list[str] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# rôn

class RoleBase(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)


class RoleResponse(ORMBaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime


# permission 

class PermissionBase(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    module: str = Field(min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)


class PermissionCreate(PermissionBase):
    pass


class PermissionUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    module: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)


class PermissionResponse(ORMBaseModel):
    id: int
    code: str
    name: str
    module: str
    description: str | None



# role-permission
class RolePermissionCreate(BaseModel):
    role_id: int
    permission_id: int


class RolePermissionResponse(ORMBaseModel):
    role_id: int
    permission_id: int


class RoleWithPermissionsResponse(RoleResponse):
    permissions: list[PermissionResponse] = []


# users
class UserBase(BaseModel):
    role_id: int
    username: str = Field(min_length=1, max_length=50)
    full_name: str = Field(min_length=1, max_length=100)
    status: UserStatus = UserStatus.ACTIVE


class UserCreate(BaseModel):
    role_id: int
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6, max_length=255)
    full_name: str = Field(min_length=1, max_length=100)
    status: UserStatus = UserStatus.ACTIVE


class UserUpdate(BaseModel):
    role_id: int | None = None
    username: str | None = Field(default=None, min_length=1, max_length=50)
    password: str | None = Field(default=None, min_length=6, max_length=255)
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    status: UserStatus | None = None


class UserResponse(ORMBaseModel):
    id: int
    role_id: int
    username: str
    full_name: str
    status: UserStatus
    created_at: datetime


class UserDetailResponse(UserResponse):
    role: RoleResponse | None = None


# cam

class CameraBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source_type: CameraSourceType = CameraSourceType.RTSP
    source_url: str = Field(min_length=1, max_length=255)
    status: CameraStatus = CameraStatus.CONNECTED


class CameraCreate(CameraBase):
    pass


class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    source_type: CameraSourceType | None = None
    source_url: str | None = Field(default=None, min_length=1, max_length=255)
    status: CameraStatus | None = None


class CameraResponse(ORMBaseModel):
    id: int
    name: str
    source_type: CameraSourceType
    source_url: str
    status: CameraStatus
    created_at: datetime
    updated_at: datetime


# pắc kinh sờ lót

class ROICoordinate(BaseModel):
    x: float
    y: float


class ParkingSlotBase(BaseModel):
    camera_id: int
    slot_code: str = Field(min_length=1, max_length=50)
    roi_coordinates: list[ROICoordinate]
    status: ParkingSlotStatusEnum = ParkingSlotStatusEnum.EMPTY


class ParkingSlotCreate(ParkingSlotBase):
    pass


class ParkingSlotUpdate(BaseModel):
    camera_id: int | None = None
    slot_code: str | None = Field(default=None, min_length=1, max_length=50)
    roi_coordinates: list[ROICoordinate] | None = None
    status: ParkingSlotStatusEnum | None = None


class ParkingSlotResponse(ORMBaseModel):
    id: int
    camera_id: int
    slot_code: str
    roi_coordinates: list[ROICoordinate]
    status: ParkingSlotStatusEnum
    updated_at: datetime


class ParkingSlotWithCameraResponse(ParkingSlotResponse):
    camera: CameraResponse | None = None


# sự kiện đỗ

class ParkingEventCreate(BaseModel):
    parking_slot_id: int
    old_status: ParkingSlotStatusEnum
    new_status: ParkingSlotStatusEnum
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ParkingEventResponse(ORMBaseModel):
    id: int
    parking_slot_id: int
    old_status: ParkingSlotStatusEnum
    new_status: ParkingSlotStatusEnum
    confidence: float
    event_time: datetime


# thống kê đỗ xe

class ParkingStatisticBase(BaseModel):
    period_start: datetime
    period_end: datetime
    occupied_count: int = Field(default=0, ge=0)
    available_count: int = Field(default=0, ge=0)
    utilization_rate: float = Field(default=0.0, ge=0.0, le=100.0)


class ParkingStatisticCreate(ParkingStatisticBase):
    pass


class ParkingStatisticUpdate(BaseModel):
    period_start: datetime | None = None
    period_end: datetime | None = None
    occupied_count: int | None = Field(default=None, ge=0)
    available_count: int | None = Field(default=None, ge=0)
    utilization_rate: float | None = Field(default=None, ge=0.0, le=100.0)


class ParkingStatisticResponse(ORMBaseModel):
    id: int
    period_start: datetime
    period_end: datetime
    occupied_count: int
    available_count: int
    utilization_rate: float


# AI engine

class ParkingSlotDetection(BaseModel):
    slot_code: str = Field(min_length=1, max_length=50)
    status: ParkingSlotStatusEnum
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class AIParkingStatusRequest(BaseModel):
    camera_id: int
    parking_slots: list[ParkingSlotDetection]


class AIUpdateResult(BaseModel):
    camera_id: int
    received_slots: int
    changed_slots: int
    unchanged_slots: int
    unknown_slots: list[str] = []


# Dashboard / map

class ParkingSummary(BaseModel):
    total_slots: int = Field(ge=0)
    empty_slots: int = Field(ge=0)
    occupied_slots: int = Field(ge=0)
    reserved_slots: int = Field(ge=0)
    unknown_slots: int = Field(ge=0)


class ParkingMapResponse(BaseModel):
    summary: ParkingSummary
    slots: list[ParkingSlotResponse]


# websocket

class SlotStatusChangedEvent(BaseModel):
    type: str = "SLOT_STATUS_CHANGED"
    parking_slot_id: int
    slot_code: str
    camera_id: int
    old_status: ParkingSlotStatusEnum
    new_status: ParkingSlotStatusEnum
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    event_time: datetime


# pagination ( optional )

class PaginationMeta(BaseModel):
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class UserListResponse(BaseModel):
    data: list[UserResponse]
    meta: PaginationMeta


class CameraListResponse(BaseModel):
    data: list[CameraResponse]
    meta: PaginationMeta


class ParkingSlotListResponse(BaseModel):
    data: list[ParkingSlotResponse]
    meta: PaginationMeta


class ParkingEventListResponse(BaseModel):
    data: list[ParkingEventResponse]
    meta: PaginationMeta


class ParkingStatisticListResponse(BaseModel):
    data: list[ParkingStatisticResponse]
    meta: PaginationMeta
