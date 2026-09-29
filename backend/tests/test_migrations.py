import os
from pathlib import Path
from uuid import uuid4
import pytest
from sqlalchemy import create_engine, text
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.autogenerate import compare_metadata
from app.db import Base


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="Requires isolated PostgreSQL")
def test_migrations_existing_data_and_model_parity():
    engine = create_engine(os.environ["TEST_POSTGRES_URL"])
    schema = "parking_migration_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        with engine.connect() as connection:
            connection.execute(text(f'SET search_path TO "{schema}"'))
            connection.commit()
            config = Config()
            config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
            config.attributes["connection"] = connection
            command.upgrade(config, "693bb22b083f")
            connection.execute(text("INSERT INTO permissions (code, name) VALUES ('legacy:view', 'Legacy')"))
            connection.commit()
            command.upgrade(config, "head")
            assert connection.execute(text("SELECT COUNT(*) FROM permissions")).scalar_one() == 9
            assert connection.execute(text("SELECT module FROM permissions WHERE code='legacy:view'")).scalar_one() == "general"
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            assert compare_metadata(context, Base.metadata) == []
            connection.commit()
            command.downgrade(config, "95c1ce0e60fd")
            command.upgrade(config, "head")
            assert connection.execute(text("SELECT COUNT(*) FROM permissions")).scalar_one() == 9
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()
