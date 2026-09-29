from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError


def get_or_404(db, model, item_id, *, lock=False):
    query = db.query(model).filter(model.id == item_id)
    if lock:
        query = query.with_for_update().populate_existing()
    item = query.first()
    if item is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return item


def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate value or resource still in use")


def apply_update(item, data, nullable=()):
    values = data.model_dump(mode="json", exclude_unset=True)
    for key, value in values.items():
        if value is None and key not in nullable:
            raise HTTPException(422, f"{key} cannot be null")
    for key, value in values.items():
        setattr(item, key, value)



def lock_camera_creation(db):
    # Sync supplies explicit IDs; serialize camera inserts before advancing the PG sequence.
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy import text
        db.execute(text("SELECT pg_advisory_xact_lock(73410291)"))


def advance_camera_sequence(db):
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy import text
        db.execute(text("SELECT setval(pg_get_serial_sequence('cameras', 'id'), "
                        "GREATEST((SELECT COALESCE(MAX(id), 1) FROM cameras), "
                        "nextval(pg_get_serial_sequence('cameras', 'id'))), true)"))
