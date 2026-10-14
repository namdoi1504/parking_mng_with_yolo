"""Confirm occupancy by elapsed capture time, without caching a superseded state."""
import math


class ObservationStabilizer:
    def __init__(self, occupied_seconds=0.5, empty_seconds=1.5, max_gap_seconds=2.0):
        if any(not math.isfinite(value) or value < 0 for value in (occupied_seconds, empty_seconds)):
            raise ValueError("Confirmation times must be finite and nonnegative")
        if not math.isfinite(max_gap_seconds) or max_gap_seconds <= 0:
            raise ValueError("max_gap_seconds must be finite and positive")
        self.durations = {"OCCUPIED": occupied_seconds, "EMPTY": empty_seconds}
        self.max_gap = max_gap_seconds
        self.candidates = {}
        self.epoch = None
        self.last_stamp = None

    def update(self, statuses, captured_at, epoch=0):
        if not math.isfinite(captured_at):
            raise ValueError("Capture timestamp must be finite")
        if (epoch != self.epoch or self.last_stamp is None or captured_at <= self.last_stamp
                or captured_at - self.last_stamp > self.max_gap):
            self.candidates.clear()
        self.epoch, self.last_stamp = epoch, captured_at
        present = {item["slot_code"] for item in statuses}
        self.candidates = {code: state for code, state in self.candidates.items() if code in present}
        confirmed = []
        for item in statuses:
            status, code = item["status"], item["slot_code"]
            if status not in self.durations:
                raise ValueError("Only EMPTY/OCCUPIED observations are supported")
            candidate = self.candidates.get(code)
            if candidate is None or candidate[0] != status:
                candidate = (status, captured_at)
                self.candidates[code] = candidate
            if captured_at - candidate[1] + 1e-9 >= self.durations[status]:
                confirmed.append(item.copy())
        return confirmed
