import asyncio

import pytest
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MAX_INSTANCES

from app import main


@pytest.mark.parametrize("fail_first", [False, True])
def test_slow_sweep_reschedules_after_completion(monkeypatch, fail_first):
    async def exercise():
        started = asyncio.Event()
        release = asyncio.Event()
        repeated = asyncio.Event()
        calls = 0
        events = []

        async def run_sweep(func, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                started.set()
                await release.wait()
                if fail_first:
                    raise RuntimeError("temporary database failure")
            else:
                repeated.set()
            return []

        monkeypatch.setattr(main.settings, "STATS_SCHEDULER_ENABLED", False)
        monkeypatch.setattr(main.settings, "RESERVATION_SCHEDULER_ENABLED", True)
        monkeypatch.setattr(main.settings, "RESERVATION_SWEEP_SECONDS", 0.01)
        monkeypatch.setattr(main, "run_in_threadpool", run_sweep)

        async with main.lifespan(main.app):
            scheduler = main.app.state.scheduler
            scheduler.add_listener(events.append, EVENT_JOB_ERROR | EVENT_JOB_MAX_INSTANCES)
            try:
                await asyncio.wait_for(started.wait(), timeout=2)
                # Leave the first run active for several polling intervals.
                await asyncio.sleep(0.08)
                assert calls == 1
                assert scheduler.get_job("reservation-expiry") is None
                release.set()
                await asyncio.wait_for(repeated.wait(), timeout=2)
                assert not any(event.code == EVENT_JOB_MAX_INSTANCES for event in events)
                assert sum(event.code == EVENT_JOB_ERROR for event in events) == int(fail_first)
            finally:
                release.set()

        await asyncio.sleep(0)
        assert not scheduler.running
        assert scheduler.get_job("reservation-expiry") is None

    asyncio.run(exercise())
