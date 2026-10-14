import { describe, expect, it } from "vitest";
import { isAvailable, summarize } from "./parking";
import type { ParkingSlot, SlotStatus } from "./types";
const slot = (id: number, status: SlotStatus): ParkingSlot => ({ id, status, camera_id: 1, slot_code: String(id), row: 0, col: id, roi_coordinates: [], updated_at: "2026-09-30T00:00:00Z" });
describe("parking summaries", () => {
  it("counts all backend statuses independently", () => {
    expect(summarize([slot(1, "EMPTY"), slot(2, "EMPTY"), slot(3, "OCCUPIED"), slot(4, "RESERVED"), slot(5, "UNKNOWN")])).toEqual({ total_slots: 5, empty_slots: 2, occupied_slots: 1, reserved_slots: 1, unknown_slots: 1, has_unknown_alert: true, available_slots: 0, uninitialized_slots: 0 });
  });
  it("handles an empty camera without an unknown alert", () => {
    expect(summarize([])).toEqual({ total_slots: 0, empty_slots: 0, occupied_slots: 0, reserved_slots: 0, unknown_slots: 0, has_unknown_alert: false, available_slots: 0, uninitialized_slots: 0 });
  });
  it("recomputes counts after a slot changes status", () => {
    const slots = [slot(1, "UNKNOWN"), slot(2, "OCCUPIED")];
    const next = summarize(slots.map((s) => s.id === 1 ? { ...s, status: "EMPTY" } : s));
    expect(next.empty_slots).toBe(1); expect(next.occupied_slots).toBe(1); expect(next.has_unknown_alert).toBe(false); expect(slots[0].status).toBe("UNKNOWN");
  });
});

it("only advertises fresh empty slots without sessions or legacy holds", () => {
  const fresh = { ...slot(1, "EMPTY"), observation_ready: true };
  expect(isAvailable(fresh)).toBe(true);
  for (const metadata of [{ observation_ready: false }, { active_session_id: 9 }, { needs_reconciliation: true }, { status: null }]) {
    expect(isAvailable({ ...fresh, ...metadata })).toBe(false);
  }
  expect(summarize([{ ...fresh, status: null }, fresh]).uninitialized_slots).toBe(1);
});
