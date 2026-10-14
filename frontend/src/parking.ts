import type { ParkingSlot, ParkingSummary } from "./types";
export function isAvailable(slot: ParkingSlot) {
  return slot.status === "EMPTY" && slot.observation_ready === true && !slot.active_session_id && !slot.needs_reconciliation;
}
export function summarize(slots: ParkingSlot[]): ParkingSummary {
  const count = (status: ParkingSlot["status"]) => slots.filter((slot) => slot.status === status).length;
  return { total_slots: slots.length, empty_slots: count("EMPTY"), occupied_slots: count("OCCUPIED"), reserved_slots: count("RESERVED"), unknown_slots: count("UNKNOWN"), has_unknown_alert: count("UNKNOWN") > 0, uninitialized_slots: count(null), available_slots: slots.filter(isAvailable).length };
}
