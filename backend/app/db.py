from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessiomaker
from urllib.parse import quote_plus

from config import settings

password = quote_plus(settings.DATABASE_PASSWORD)

SQLALCHEMY_DATABASE_URL = (
    f"postgresql://"
    f"{settings.DATABASE_USERNAME}:"
    f"{password}@"
    f"{settings.DATABASE_HOSTNAME}:"
    f"{settings.DATABASE_PORT}/"
    f"{settings.DATABASE_NAME}"
)

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessiomaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()