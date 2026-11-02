import { summarize } from "./parking";
import { calibrated, centroid } from "./siteLayout";
import type { ParkingSlot, ParkingSummary } from "../types";

export interface ParkingZone {
  id: string;
  name: string;
  code?: string;
  cameraId: number;
  description: string;
  kind: "island" | "edge" | "gate" | "column" | "unassigned";
  slots: ParkingSlot[];
  summary: ParkingSummary;
  occupancyRate: number;
}

// Image-space boundaries follow the traced vehicle aisles in SITE. Only use
// them when the camera's complete ROI layout matches the known 1920x1080 scene.
export const AISLE_X = [145, 330, 540, 715, 895, 1075, 1255, 1440, 1620, 1800, 1920];

// Ordered from right to left: A1..A3 (East/Gate), B1..B3, C1..C3, D1..D2 (West/Left)
export const ZONE_ORDER = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2"];

export function sceneZone(slot: ParkingSlot) {
  if (slot.roi_coordinates.length < 3 || slot.roi_coordinates.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const { x, y } = centroid(slot.roi_coordinates);
  if (x < 0 || x >= 1920 || y < 0 || y > 1080) return null;

  // Merged Khu A1: Cụm cổng ra vào & Dãy sát mép phải (31 ô)
  // Horizontal gate bays (x >= 1440 and y < 363) OR rightmost edge column (x >= 1800)
  if ((x >= 1440 && y < 363) || x >= 1800) {
    return { code: "A1", kind: "gate" as const, description: "Cụm cổng ra vào & Dãy mép phải" };
  }

  const number = AISLE_X.findIndex((edge) => x < edge);

  // 10 island pairs ordered from right to left:
  // index 9 (col 20, 21) -> A2
  // index 8 (col 17, 18) -> A3
  // index 7 (col 15, 16) -> B1
  // index 6 (col 12, 13, 14) -> B2
  // index 5 (col 10, 11) -> B3
  // index 4 (col 8, 9)   -> C1
  // index 3 (col 6, 7)   -> C2
  // index 2 (col 4, 5)   -> C3
  // index 1 (col 2, 3)   -> D1
  // index 0 (col 0, 1)   -> D2
  const rightToLeftCodes = ["D2", "D1", "C3", "C2", "C1", "B3", "B2", "B1", "A3", "A2"];
  const code = rightToLeftCodes[number] ?? `Z${number}`;
  return {
    code,
    kind: "island" as const,
    description: "Hai dãy cùng đảo cây · toàn bộ chiều dài"
  };
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
      const code = isScene ? scene?.code : valid ? String(slot.col + 1) : undefined;
      const name = isScene && code ? `Khu ${code}` : valid ? `Khu ${slot.col + 1}` : "Chưa phân khu";
      const id = `${cameraId}:${isScene ? "site" : "column"}:${code ?? "unassigned"}`;
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          name,
          code,
          cameraId,
          description: kind === "unassigned" ? "Thiếu vị trí hợp lệ" : scene?.description ?? "Toàn bộ dãy · chưa hiệu chỉnh đảo cây",
          kind,
          slots: []
        });
      }
      groups.get(id)!.slots.push(slot);
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.cameraId !== b.cameraId) return a.cameraId - b.cameraId;
      if (a.kind === "unassigned") return 1;
      if (b.kind === "unassigned") return -1;
      const codeA = a.code ?? a.id.split(":").at(-1) ?? "";
      const codeB = b.code ?? b.id.split(":").at(-1) ?? "";
      const idxA = ZONE_ORDER.indexOf(codeA);
      const idxB = ZONE_ORDER.indexOf(codeB);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return codeA.localeCompare(codeB, undefined, { numeric: true });
    })
    .map((group) => {
      const summary = summarize(group.slots);
      return {
        ...group,
        summary,
        occupancyRate: (summary.occupied_slots + summary.unknown_slots) / summary.total_slots * 100
      };
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
