from datetime import date as Date, datetime, time, timedelta, timezone
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..db import get_db
from .. import models, schemas
from ..oauth2 import require_permission
from ..statistics import report_samples, summarize
from .common import get_or_404
from .parking import get_parking_summary

router = APIRouter(prefix="/api/stats", tags=["Statistics"], dependencies=[Depends(require_permission("report:view"))])


@router.get("/hourly")
def hourly(date: Date, camera_id: int | None = Query(None, gt=0),
           utc_offset_minutes: int = Query(0, ge=-840, le=840), db: Session = Depends(get_db)):
    if camera_id is not None:
        get_or_404(db, models.Camera, camera_id)
    report_zone = timezone(timedelta(minutes=utc_offset_minutes))
    start = datetime.combine(date, time(), tzinfo=report_zone).astimezone(timezone.utc)
    periods = report_samples(db, start, start + timedelta(days=1), camera_id)
    hours = defaultdict(list)
    for stamp, sample in periods.items():
        hours[stamp.astimezone(report_zone).hour].append(sample)
    return [{"hour": hour, **summarize(hours[hour])} for hour in range(24)]


@router.get("/daily")
def daily(from_date: Date = Query(alias="from"), to_date: Date = Query(alias="to"),
          camera_id: int | None = Query(None, gt=0), utc_offset_minutes: int = Query(0, ge=-840, le=840),
          db: Session = Depends(get_db)):
    days = (to_date - from_date).days
    if days < 0 or days > 365:
        raise HTTPException(422, "Date range must be ordered and at most 366 days")
    if camera_id is not None:
        get_or_404(db, models.Camera, camera_id)
    report_zone = timezone(timedelta(minutes=utc_offset_minutes))
    start = datetime.combine(from_date, time(), tzinfo=report_zone).astimezone(timezone.utc)
    periods = report_samples(db, start, start + timedelta(days=days+1), camera_id)
    grouped = defaultdict(list)
    for stamp, sample in periods.items():
        grouped[stamp.astimezone(report_zone).date()].append(sample)
    result = []
    for offset in range(days+1):
        day = from_date + timedelta(days=offset)
        stats = summarize(grouped[day])
        result.append({"date": day, "avg_utilization": stats["utilization"], "samples": stats["samples"],
                       "last_sample_at": stats["last_sample_at"]})
    return result


@router.get("/realtime", response_model=schemas.ParkingSummary)
def realtime(db: Session = Depends(get_db)):
    return get_parking_summary(db)
