import os
from pathlib import Path
from uuid import uuid4
import pytest
from sqlalchemy import create_engine, text, event
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.autogenerate import compare_metadata
from app.db import Base


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="Requires isolated PostgreSQL")
@pytest.mark.parametrize("precreated", [False, True])
def test_migrations_existing_data_and_model_parity(precreated):
    engine = create_engine(os.environ["TEST_POSTGRES_URL"])
    schema = "parking_migration_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    @event.listens_for(engine, "begin")
    def isolate(connection):
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        if connection.exec_driver_sql("SELECT current_schema()").scalar_one() != schema:
            raise RuntimeError("Refusing migration outside disposable schema")
    try:
        with engine.connect() as connection:
            config = Config()
            config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
            config.attributes["connection"] = connection
            command.upgrade(config, "693bb22b083f")
            connection.execute(text("INSERT INTO permissions (code, name) VALUES ('legacy:view', 'Legacy')"))
            connection.commit()
            command.upgrade(config, "b7c21a9e4d10")
            connection.execute(text("INSERT INTO cameras (id,name,source_url) VALUES (7,'Legacy camera','file://legacy')"))
            connection.execute(text("INSERT INTO parking_slots (id,camera_id,slot_code,roi_coordinates,status) "
                                    "VALUES (1,7,'legacy-slot','[]','RESERVED')"))
            if precreated:
                Base.metadata.tables["parking_sessions"].create(connection)
            connection.commit()
            command.upgrade(config, "head")
            assert connection.execute(text("SELECT status FROM parking_slots WHERE id=1")).scalar_one() == "RESERVED"
            assert connection.execute(text("SELECT needs_reconciliation FROM parking_slots WHERE id=1")).scalar_one() is True
            assert connection.execute(text("SELECT COUNT(*) FROM parking_sessions")).scalar_one() == 0
            assert connection.execute(text("SELECT COUNT(*) FROM permissions")).scalar_one() == 9
            assert connection.execute(text("SELECT module FROM permissions WHERE code='legacy:view'")).scalar_one() == "general"
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            assert compare_metadata(context, Base.metadata) == []
            connection.commit()
            command.downgrade(config, "95c1ce0e60fd")
            command.upgrade(config, "head")
            assert connection.execute(text("SELECT COUNT(*) FROM permissions")).scalar_one() == 9
    finally:
        event.remove(engine, "begin", isolate)
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


def test_migration_can_generate_offline_sql():
    import io
    output = io.StringIO()
    config = Config(stdout=output, output_buffer=output)
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    command.upgrade(config, "b7c21a9e4d10:head", sql=True)
    sql = output.getvalue()
    assert "CREATE TABLE parking_sessions" in sql and "uq_session_active_slot" in sql
