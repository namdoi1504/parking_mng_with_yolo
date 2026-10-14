import { describe, expect, it } from "vitest";
import config from "../../AI/datasets/slots_config.json";
import { buildAxisGroups, buildZones, zoneRange } from "./zones";
import { demoMap } from "./demo";
import type { ParkingSlot } from "./types";
const slot = (id: number, row: number, col: number, camera = 1): ParkingSlot => ({ ...demoMap.slots[0], id, row, col, camera_id: camera });
const actualSlots: ParkingSlot[] = config.map((item) => ({ ...slot(item.index + 1, item.row, item.col, item.camera_id), slot_code: item.slot_code, roi_coordinates: item.points.map(([x, y]) => ({ x, y })) }));
describe("physical parking zones", () => {
  it("counts raw columns separately for each camera and retains invalid coordinates", () => {
    const groups = buildAxisGroups([slot(1, 0, 2), { ...slot(2, 1, 2), status: "RESERVED" }, { ...slot(3, 1, 2, 2), status: "UNKNOWN" }, slot(4, 0, -1)], "col");
    expect(groups).toHaveLength(3);
    expect(groups[0].summary).toMatchObject({ total_slots: 2, empty_slots: 1, reserved_slots: 1 });
    expect(groups[1].name).toBe("Chưa có tọa độ");
    expect(groups[2].cameraId).toBe(2); expect(groups[2].occupancyRate).toBe(100);
    expect(groups.flatMap(group => group.slots)).toHaveLength(4);
    expect(buildAxisGroups([], "row")).toEqual([]);
  });
  it("keeps both complete rows around each island together without slicing row indices", () => {
    const zones = buildZones(actualSlots);
    expect(zones).toHaveLength(13);
    expect(zones.map((zone) => zone.slots.length)).toEqual([24, 33, 32, 38, 43, 58, 60, 56, 47, 48, 21, 3, 7]);
    for (const columns of [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13, 14], [15, 16]]) {
      const members = actualSlots.filter((item) => columns.includes(item.col));
      const group = zones.find((zone) => zone.slots.some((item) => item.id === members[0].id))!;
      expect(group.slots.map((item) => item.id).sort((a, b) => a - b)).toEqual(members.map((item) => item.id).sort((a, b) => a - b));
    }
    expect(zones[5].slots.some((item) => item.row === 30)).toBe(true);
    expect(zoneRange(zones[0])).toContain("Hai dãy cùng đảo cây");
  });
  it("keeps horizontal gate bays separate from island rows sharing the same col", () => {
    const zones = buildZones(actualSlots);
    const containing = (code: string) => zones.find((zone) => zone.slots.some((item) => item.slot_code === code))!;
    expect(containing("368").id).toBe("1:site:12"); expect(containing("370").id).toBe("1:site:9");
    expect(containing("395").id).toBe("1:site:13"); expect(containing("397").id).toBe("1:site:10");
    expect(containing("450").kind).toBe("edge"); expect(containing("449").kind).toBe("gate");
  });
  it("covers every real space once with stable IDs regardless of status or input order", () => {
    const zones = buildZones(actualSlots), ids = zones.flatMap((zone) => zone.slots.map((item) => item.id));
    expect(ids).toHaveLength(470); expect(new Set(ids).size).toBe(470);
    const updated = buildZones([...actualSlots].reverse().map((item) => ({ ...item, status: "UNKNOWN" as const })));
    expect(updated.map((zone) => [zone.id, zone.name])).toEqual(zones.map((zone) => [zone.id, zone.name]));
  });
  it("does not apply this scene's island geometry to another camera or uncalibrated layout", () => {
    const zones = buildZones([slot(1, 0, 0), slot(2, 30, 0), slot(3, 0, 1), slot(4, 0, 0, 2)]);
    expect(zones.map((zone) => [zone.id, zone.slots.length])).toEqual([["1:column:1", 2], ["1:column:2", 1], ["2:column:1", 1]]);
    expect(zones.every((zone) => zone.kind === "column")).toBe(true);
    expect(buildZones(actualSlots.map((item) => ({ ...item, camera_id: 2 }))).every((zone) => zone.kind === "column")).toBe(true);
  });
  it("keeps availability separate from empty status and counts unregistered vehicles", () => {
    const zones = buildZones([slot(1, 0, 0), { ...slot(2, 20, 0), observation_ready: false }, { ...slot(3, 21, 0), status: "UNKNOWN" }, { ...slot(4, 30, 0), status: null }] as ParkingSlot[]);
    expect(zones[0].summary).toMatchObject({ total_slots: 4, empty_slots: 2, available_slots: 1, unknown_slots: 1, uninitialized_slots: 1 });
    expect(zones[0].occupancyRate).toBe(25);
  });
  it("retains invalid positions in an unassigned group instead of losing spaces", () => {
    const zones = buildZones([slot(1, -1, 0), slot(2, 1.5, 1), slot(3, 0, 0)]);
    expect(zones[1].name).toBe("Chưa phân khu"); expect(zones[1].slots).toHaveLength(2);
    expect(buildZones([])).toEqual([]);
    const invalid = buildZones(actualSlots.map((item) => item.id === 2 ? { ...item, roi_coordinates: [] } : item));
    expect(invalid.find((zone) => zone.kind === "unassigned")?.slots[0].id).toBe(2);
  });
});
