import { summarize } from "./parking";
import { calibrated, centroid } from "./siteLayout";
import type { ParkingSlot, ParkingSummary } from "./types";

export interface ParkingZone {
  id: string; name: string; cameraId: number;
  description: string; kind: "island" | "edge" | "gate" | "column" | "unassigned";
  slots: ParkingSlot[]; summary: ParkingSummary; occupancyRate: number;
}

// Image-space boundaries follow the traced vehicle aisles in SITE. Only use
// them when the camera's complete ROI layout matches the known 1920x1080 scene.
const AISLE_X = [145, 330, 540, 715, 895, 1075, 1255, 1440, 1620, 1800, 1920];

function sceneZone(slot: ParkingSlot) {
  if (slot.roi_coordinates.length < 3 || slot.roi_coordinates.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const { x, y } = centroid(slot.roi_coordinates);
  if (x < 0 || x >= 1920 || y < 0 || y > 1080) return null;
  // The horizontal gate bays sit above the cross-aisle, independently of
  // the full-length island rows below them (even when they share a col index).
  if (x >= 1440 && y < 363) {
    return x < 1620 ? { number: 12, kind: "gate" as const, description: "Cụm cạnh cổng phía trái" }
      : { number: 13, kind: "gate" as const, description: "Dãy ngang gần cổng" };
  }
  const number = AISLE_X.findIndex((edge) => x < edge) + 1;
  return number === 11 ? { number, kind: "edge" as const, description: "Dãy sát mép phải" }
    : { number, kind: "island" as const, description: "Hai dãy cùng đảo cây · toàn bộ chiều dài" };
}

export function buildZones(slots: ParkingSlot[]): ParkingZone[] {
  const groups = new Map<string, Omit<ParkingZone, "summary" | "occupancyRate">>();
  const cameras = [...new Set(slots.map((slot) => slot.camera_id))].sort((a, b) => a - b);
  for (const cameraId of cameras) {
    const cameraSlots = slots.filter((slot) => slot.camera_id === cameraId);
    const isScene = calibrated(cameraSlots);
    for (const slot of cameraSlots) {
      const valid = Number.isInteger(slot.col) && slot.col >= 0 && Number.isInteger(slot.row) && slot.row >= 0;
      const scene = isScene && valid ? sceneZone(slot) : null;
      const kind = isScene ? scene?.kind ?? "unassigned" : valid ? "column" : "unassigned";
      const number = isScene ? scene?.number : valid ? slot.col + 1 : undefined;
      const id = `${cameraId}:${isScene ? "site" : "column"}:${number ?? "unassigned"}`;
      if (!groups.has(id)) groups.set(id, { id, name: number ? `Khu ${number}` : "Chưa phân khu", cameraId,
        description: kind === "unassigned" ? "Thiếu vị trí hợp lệ" : scene?.description ?? "Toàn bộ dãy · chưa hiệu chỉnh đảo cây", kind, slots: [] });
      groups.get(id)!.slots.push(slot);
    }
  }
  return [...groups.values()].sort((a, b) => a.cameraId - b.cameraId ||
    (a.kind === "unassigned" ? Infinity : Number(a.id.split(":").at(-1))) - (b.kind === "unassigned" ? Infinity : Number(b.id.split(":").at(-1))))
    .map((group) => {
      const summary = summarize(group.slots);
      return { ...group, summary, occupancyRate: (summary.occupied_slots + summary.unknown_slots) / summary.total_slots * 100 };
    });
}

export function zoneRange(zone: ParkingZone) {
  const columns = [...new Set(zone.slots.map((slot) => slot.col))].sort((a, b) => a - b);
  return zone.kind === "unassigned" ? zone.description : `${zone.description} · cột ${columns.join(", ")}`;
}

export function buildAxisGroups(slots: ParkingSlot[], axis: "col" | "row"): ParkingZone[] {
  const groups = new Map<string, ParkingSlot[]>();
  for (const slot of slots) {
    const coordinate = slot[axis];
    const valid = Number.isInteger(coordinate) && coordinate >= 0;
    const id = `${slot.camera_id}:${axis}:${valid ? coordinate : "unassigned"}`;
    const group = groups.get(id) ?? [];
    group.push(slot); groups.set(id, group);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const [cameraA, , coordinateA] = a.split(":"), [cameraB, , coordinateB] = b.split(":");
    return Number(cameraA) - Number(cameraB) || (coordinateA === "unassigned" ? Infinity : Number(coordinateA)) - (coordinateB === "unassigned" ? Infinity : Number(coordinateB));
  }).map(([id, items]) => {
    const coordinate = id.split(":")[2], summary = summarize(items);
    return { id, cameraId: items[0].camera_id, name: coordinate === "unassigned" ? "Chưa có tọa độ" : `${axis === "col" ? "Cột" : "Hàng"} ${coordinate}`,
      description: `${axis} = ${coordinate} · theo tọa độ backend`, kind: "column", slots: items, summary,
      occupancyRate: (summary.occupied_slots + summary.unknown_slots) / summary.total_slots * 100 };
  });
}
