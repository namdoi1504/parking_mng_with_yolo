from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from .. import models, schemas
from ..db import get_db
from ..oauth2 import require_permission
from .common import apply_update, commit, get_or_404, lock_camera_creation

router = APIRouter(prefix="/cameras", tags=["Cameras"])
view = Depends(require_permission("camera:view"))
manage = Depends(require_permission("camera:manage"))


@router.get("/", response_model=schemas.CameraListResponse, dependencies=[view])
def list_cameras(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 status: schemas.CameraStatus | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Camera)
    if status:
        query = query.filter_by(status=status.value)
    total = query.count()
    return {"data": query.order_by(models.Camera.id).offset((page-1)*page_size).limit(page_size).all(),
            "meta": {"page": page, "page_size": page_size, "total": total,
                     "total_pages": (total + page_size - 1)//page_size}}


@router.post("/", response_model=schemas.CameraResponse, status_code=201, dependencies=[manage])
def create_camera(data: schemas.CameraCreate, db: Session = Depends(get_db)):
    lock_camera_creation(db)
    camera = models.Camera(**data.model_dump(mode="json"))
    db.add(camera)
    commit(db)
    return camera


@router.get("/{camera_id}", response_model=schemas.CameraResponse, dependencies=[view])
def get_camera(camera_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, models.Camera, camera_id)


@router.put("/{camera_id}", response_model=schemas.CameraResponse, dependencies=[manage])
def update_camera(camera_id: int, data: schemas.CameraUpdate, db: Session = Depends(get_db)):
    camera = get_or_404(db, models.Camera, camera_id)
    apply_update(camera, data)
    commit(db)
    return camera


@router.patch("/{camera_id}/status", response_model=schemas.CameraResponse, dependencies=[manage])
def update_status(camera_id: int, data: schemas.CameraStatusUpdate, db: Session = Depends(get_db)):
    camera = get_or_404(db, models.Camera, camera_id)
    camera.status = data.status.value
    commit(db)
    return camera


@router.delete("/{camera_id}", status_code=204, dependencies=[manage])
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    camera = get_or_404(db, models.Camera, camera_id)
    if (db.query(models.ParkingSlot.id).filter_by(camera_id=camera_id).first()
            or db.query(models.ParkingStatistic.id).filter_by(camera_id=camera_id).first()):
        raise HTTPException(409, "Camera has parking slots or statistics")
    db.delete(camera)
    commit(db)
    return Response(status_code=204)
