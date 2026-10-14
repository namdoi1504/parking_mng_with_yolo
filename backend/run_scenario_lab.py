"""Run locally: python backend/run_scenario_lab.py. No production credentials."""
import os

# Force dummy settings BEFORE importing any application modules.
os.environ.update(DATABASE_HOSTNAME="127.0.0.1", DATABASE_PORT="1", DATABASE_PASSWORD="unused",
    DATABASE_NAME="scenario_lab_unused", DATABASE_USERNAME="unused",
    SECRET_KEY="local-scenario-lab-only-not-for-login-0000",
    STATS_SCHEDULER_ENABLED="false", RESERVATION_SCHEDULER_ENABLED="false")

if __name__ == "__main__":
    import uvicorn
    from app.scenario_lab import create_lab_app
    uvicorn.run(create_lab_app(), host="127.0.0.1", port=8002)
