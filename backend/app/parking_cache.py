"""One bounded parking snapshot per process; database remains authoritative."""

from threading import Lock
from time import monotonic
from collections.abc import Callable

from .schemas import ParkingMapResponse


class ParkingSnapshotCache:
    def __init__(self):
        self._lock = Lock()
        self._snapshot: ParkingMapResponse | None = None
        self._expires_at = 0.0

    def get(self, loader: Callable[[], ParkingMapResponse], ttl: float) -> ParkingMapResponse:
        if ttl <= 0:
            return loader()
        # Serialize cache misses to avoid concurrent readers repeating the same query.
        # Invalidation shares this lock so an older load cannot overwrite it.
        with self._lock:
            if self._snapshot is None or monotonic() >= self._expires_at:
                snapshot = loader()
                self._snapshot = snapshot
                self._expires_at = monotonic() + ttl
            return self._snapshot

    def invalidate(self):
        with self._lock:
            self._snapshot = None
            self._expires_at = 0.0


parking_cache = ParkingSnapshotCache()
