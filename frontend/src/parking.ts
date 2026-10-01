import type { ParkingSlot, ParkingSummary } from "./types";
export function summarize(slots: ParkingSlot[]): ParkingSummary {
  const count = (status: ParkingSlot["status"]) => slots.filter((slot) => slot.status === status).length;
  return { total_slots: slots.length, empty_slots: count("EMPTY"), occupied_slots: count("OCCUPIED"), reserved_slots: count("RESERVED"), unknown_slots: count("UNKNOWN"), has_unknown_alert: count("UNKNOWN") > 0 };
}
