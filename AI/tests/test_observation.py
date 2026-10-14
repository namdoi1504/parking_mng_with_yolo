from AI.datasets.observation import ObservationStabilizer


def items(status):
    return [{"slot_code": "A1", "status": status, "confidence": None}]


def test_confirmation_uses_elapsed_time_and_discards_superseded_state():
    stable = ObservationStabilizer(occupied_seconds=.5, empty_seconds=1.5)
    assert stable.update(items("OCCUPIED"), 0) == []
    assert stable.update(items("OCCUPIED"), .49) == []
    assert stable.update(items("OCCUPIED"), .5) == items("OCCUPIED")
    assert stable.update(items("EMPTY"), .6) == []
    assert stable.update(items("OCCUPIED"), .7) == []
    assert stable.update(items("OCCUPIED"), 1.2) == items("OCCUPIED")
    assert stable.update(items("EMPTY"), 1.3) == []
    assert stable.update(items("EMPTY"), 2.8) == items("EMPTY")


def test_missing_slot_gap_loop_and_out_of_order_reset_confirmation():
    stable = ObservationStabilizer()
    assert stable.update(items("OCCUPIED"), 0) == []
    assert stable.update(items("OCCUPIED"), .6) == items("OCCUPIED")
    assert stable.update(items("OCCUPIED"), 3) == []  # gap
    assert stable.update(items("OCCUPIED"), 3.6) == items("OCCUPIED")
    assert stable.update(items("OCCUPIED"), 4, epoch=1) == []
    assert stable.update(items("OCCUPIED"), 4.6, epoch=1) == items("OCCUPIED")
    assert stable.update([], 4.7, epoch=1) == []
    assert stable.update(items("OCCUPIED"), 5, epoch=1) == []
    assert stable.update(items("OCCUPIED"), 4.9, epoch=1) == []
