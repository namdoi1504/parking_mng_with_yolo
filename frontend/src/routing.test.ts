import { describe, expect, it } from "vitest";
import config from "../../AI/datasets/slots_config.json";
import type { ParkingSlot } from "./types";
import { SITE, calibrated } from "./siteLayout";
import { allowedDirection, buildRoadNetwork, gridPoint, inside, onRoad, slotRoute } from "./routing";

const slots: ParkingSlot[] = config.map((s) => ({ id: s.index + 1, camera_id: 1, slot_code: s.slot_code, status: "EMPTY", row: s.row, col: s.col, updated_at: "", roi_coordinates: s.points.map(([x, y]) => ({ x, y })) }));
const network = buildRoadNetwork(slots);
describe("temporary site routing", () => {
  it("only enables the calibrated layout", () => {
    expect(calibrated(slots)).toBe(true);
    expect(calibrated(slots.map((s) => ({ ...s, camera_id: 2 })))).toBe(false);
  });
  it("respects the two gate arrows", () => {
    expect(allowedDirection({ x: 1800, y: 120 }, { x: 1808, y: 120 })).toBe(false);
    expect(allowedDirection({ x: 1800, y: 224 }, { x: 1792, y: 224 })).toBe(false);
    expect(Math.hypot(gridPoint(network.entryIndex, network.columns).x - SITE.entry.x, gridPoint(network.entryIndex, network.columns).y - SITE.entry.y)).toBeLessThan(12);
  });
  it("routes to representative bays and back without crossing parked bays or gardens", () => {
    for (const code of ["171", "289", "470"]) for (const direction of ["entry", "exit"] as const) {
      const route = slotRoute(network, slots.find((s) => s.slot_code === code)!, direction);
      expect(route, `${code} ${direction}`).not.toBeNull();
      const points = route!;
      expect(points[direction === "entry" ? 0 : points.length - 1]).toEqual(gridPoint(direction === "entry" ? network.entryIndex : network.exitIndex, network.columns));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
        for (let j = 0; j <= count; j++) {
          const p = { x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count };
          expect(network.obstacles.some((o) => inside(p, o.points))).toBe(false);
          expect(onRoad(p)).toBe(true);
        }
      }
    }
  });
  it("does not suggest occupied bays as entry destinations", () => {
    expect(slotRoute(network, { ...slots[0], status: "OCCUPIED" }, "entry")).toBeNull();
    expect(slotRoute(network, { ...slots.find((s) => s.slot_code === "171")!, status: "OCCUPIED" }, "exit")).not.toBeNull();
  });
  it("approaches the rightmost row from the left aisle, never the cropped outer edge", () => {
    const route = slotRoute(network, slots.find((s) => s.slot_code === "470")!, "entry")!;
    expect(route.at(-1)!.x).toBeLessThan(1822);
    expect(route.filter((p) => p.y > 350).every((p) => p.x < 1822)).toBe(true);
    expect(route.some((p) => p.x < 1464)).toBe(true);
    expect(onRoad({ x: 1908, y: 1044 })).toBe(false);
    expect(onRoad({ x: 440, y: 600 })).toBe(false);
  });
  it("does not fabricate access outside the image for the cropped leftmost bays", () => {
    expect(slotRoute(network, slots[0], "entry")).toBeNull();
  });
  it("connects the proposed outer aisle to every leftmost bay without crossing any other bay or garden", () => {
    const proposal = buildRoadNetwork(slots, true);
    for (const slot of slots.filter(item => item.col === 0)) for (const direction of ["entry", "exit"] as const) {
      const route = slotRoute(proposal, slot, direction);
      expect(route, `${slot.slot_code} ${direction}`).not.toBeNull();
      const approach = route![direction === "entry" ? route!.length - 1 : 0];
      expect(approach.x).toBeLessThan(0);
      for (let i = 1; i < route!.length; i++) {
        const a = route![i - 1], b = route![i], count = Math.ceil(Math.hypot(a.x-b.x, a.y-b.y)/4);
        for (let j = 0; j <= count; j++) {
          const point = { x: a.x+(b.x-a.x)*j/count, y: a.y+(b.y-a.y)*j/count };
          expect(onRoad(point, true)).toBe(true);
          expect(proposal.obstacles.some(obstacle => inside(point, obstacle.points))).toBe(false);
        }
      }
    }
    expect(onRoad({ x: -65, y: 550 })).toBe(false);
    expect(onRoad({ x: -65, y: 550 }, true)).toBe(true);
  });
});
