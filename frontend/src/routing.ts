import { SITE, asPoints, centroid } from "./siteLayout";
import type { ParkingSlot, Point } from "./types";

export function inside(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

export function boundaryPoint(point: Point, polygon: Point[]): Point {
  let closest = polygon[0], best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const projected = { x: a.x + fraction * dx, y: a.y + fraction * dy };
    const distance = (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2;
    if (distance < best) { best = distance; closest = projected; }
  }
  return closest;
}

export function allowedDirection(from: Point, to: Point): boolean {
  // Upper gate lane goes west into the site; lower gate lane goes east out.
  if ((from.x > 1650 && from.y < 165 || to.x > 1650 && to.y < 165) && to.x > from.x) return false;
  if ((from.x > 1650 && from.y >= 195 && from.y < 260 || to.x > 1650 && to.y >= 195 && to.y < 260) && to.x < from.x) return false;
  return true;
}

export function onRoad(point: Point): boolean {
  return SITE.roadLines.some((line) => line.slice(1).some((b, i) => {
    const a = line[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a[0] - t * dx, point.y - a[1] - t * dy) <= SITE.corridorRadius;
  }));
}

export interface RoadNetwork {
  columns: number; rows: number; free: Uint8Array;
  entryParents: Int32Array; exitParents: Int32Array;
  entryIndex: number; exitIndex: number;
  obstacles: { id?: number; points: Point[] }[];
}

export function gridPoint(index: number, columns: number): Point {
  return { x: (index % columns + .5) * SITE.step, y: (Math.floor(index / columns) + .5) * SITE.step };
}

export function buildRoadNetwork(slots: ParkingSlot[]): RoadNetwork {
  const columns = Math.floor(SITE.width / SITE.step), rows = Math.floor(SITE.height / SITE.step);
  const free = new Uint8Array(columns * rows), pavement = asPoints(SITE.pavement);
  for (let i = 0; i < free.length; i++) {
    const point = gridPoint(i, columns);
    free[i] = Number(inside(point, pavement) && onRoad(point));
  }
  // Block every parking polygon regardless of its current status. Empty bays
  // are not shortcuts. Margin includes half a cell's diagonal for segment safety.
  const margin = SITE.clearance + SITE.step * Math.SQRT2 / 2;
  const obstacles = [...slots.filter((s) => s.roi_coordinates.length >= 3).map((s) => s.roi_coordinates), ...SITE.gardens.map(asPoints)];
  for (const polygon of obstacles) {
    const minCol = Math.max(0, Math.floor((Math.min(...polygon.map((p) => p.x)) - margin) / SITE.step));
    const maxCol = Math.min(columns - 1, Math.ceil((Math.max(...polygon.map((p) => p.x)) + margin) / SITE.step));
    const minRow = Math.max(0, Math.floor((Math.min(...polygon.map((p) => p.y)) - margin) / SITE.step));
    const maxRow = Math.min(rows - 1, Math.ceil((Math.max(...polygon.map((p) => p.y)) + margin) / SITE.step));
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const index = row * columns + col;
      if (!free[index]) continue;
      const point = gridPoint(index, columns), edge = boundaryPoint(point, polygon);
      if (inside(point, polygon) || Math.hypot(point.x - edge.x, point.y - edge.y) <= margin) free[index] = 0;
    }
  }
  function nearest(point: Point) {
    let best = -1, distance = Infinity;
    for (let i = 0; i < free.length; i++) if (free[i]) {
      const p = gridPoint(i, columns), d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }
  function flood(start: number, reverse: boolean) {
    const parents = new Int32Array(free.length).fill(-1), queue = new Int32Array(free.length);
    if (start < 0) return parents;
    let head = 0, tail = 1; queue[0] = start; parents[start] = start;
    while (head < tail) {
      const index = queue[head++], col = index % columns, row = Math.floor(index / columns);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = col + dx, y = row + dy;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const next = y * columns + x;
        if (!free[next] || parents[next] !== -1) continue;
        const a = gridPoint(index, columns), b = gridPoint(next, columns);
        if (!(reverse ? allowedDirection(b, a) : allowedDirection(a, b))) continue;
        parents[next] = index; queue[tail++] = next;
      }
    }
    return parents;
  }
  const entryIndex = nearest(SITE.entry), exitIndex = nearest(SITE.exit);
  return { columns, rows, free, entryIndex, exitIndex,
    obstacles: [...slots.map((s) => ({ id: s.id, points: s.roi_coordinates })), ...SITE.gardens.map((g) => ({ points: asPoints(g) }))],
    entryParents: flood(entryIndex, false), exitParents: flood(exitIndex, true) };
}

export function slotRoute(network: RoadNetwork, slot: ParkingSlot, direction: "entry" | "exit"): Point[] | null {
  if (slot.roi_coordinates.length < 3) return null;
  if (direction === "entry" && slot.status !== "EMPTY") return null;
  const center = centroid(slot.roi_coordinates), parents = direction === "entry" ? network.entryParents : network.exitParents;
  let nearest = -1, best = Infinity;
  for (let i = 0; i < parents.length; i++) if (parents[i] >= 0) {
    const p = gridPoint(i, network.columns), distance = (p.x - center.x) ** 2 + (p.y - center.y) ** 2;
    if (distance < best && distance <= 100 ** 2) {
      const edge = boundaryPoint(p, slot.roi_coordinates);
      // Only attach to the drive-facing end of the bay, not its narrow side.
      const xs = slot.roi_coordinates.map((v) => v.x), ys = slot.roi_coordinates.map((v) => v.y);
      const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
      if (width > height ? Math.abs(edge.x - center.x) < width * .3 : Math.abs(edge.y - center.y) < height * .3) continue;
      const nearby = network.obstacles.filter((o) => o.id !== slot.id && o.points.length >= 3 &&
        Math.max(...o.points.map((v) => v.x)) >= Math.min(p.x, edge.x) && Math.min(...o.points.map((v) => v.x)) <= Math.max(p.x, edge.x) &&
        Math.max(...o.points.map((v) => v.y)) >= Math.min(p.y, edge.y) && Math.min(...o.points.map((v) => v.y)) <= Math.max(p.y, edge.y));
      const steps = Math.ceil(Math.hypot(p.x - edge.x, p.y - edge.y) / 2);
      let clear = true;
      for (let j = 0; j <= steps && clear; j++) {
        const t = steps ? j / steps : 0;
        clear = !nearby.some((o) => inside({ x: p.x + (edge.x - p.x) * t, y: p.y + (edge.y - p.y) * t }, o.points));
      }
      if (clear) { best = distance; nearest = i; }
    }
  }
  // Do not attach a disconnected bay to a distant unrelated road.
  if (nearest < 0 || best > 100 ** 2) return null;
  const route: Point[] = [];
  let index = nearest;
  while (true) {
    route.push(gridPoint(index, network.columns));
    if (parents[index] === index) break;
    index = parents[index];
  }
  if (direction === "entry") route.reverse();
  // Remove only collinear points: never cut corners across obstacles.
  return route.filter((point, i) => !i || i === route.length - 1 ||
    (point.x - route[i - 1].x) * (route[i + 1].y - point.y) !== (point.y - route[i - 1].y) * (route[i + 1].x - point.x));
}
