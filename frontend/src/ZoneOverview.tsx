import { useId } from "react";
import { buildZones, zoneRange, type ParkingZone } from "./zones";
import type { ParkingSlot } from "./types";

export function ZoneTable({ zones, selectedId, onSelect, axis }: { zones: ParkingZone[]; selectedId?: string; onSelect?: (id: string) => void; axis?: "col" | "row" }) {
  return <div className="zone-table-scroll" tabIndex={0} aria-label="Bảng thống kê các khu có thể cuộn"><table className="zone-stat-table">
    <caption>Thống kê hiện tại theo {axis === "col" ? "cột" : axis === "row" ? "hàng" : "khu"} · tỷ lệ có xe gồm xe đã đỗ và xe chưa đăng ký</caption>
    <thead><tr><th scope="col">Khu / camera</th><th scope="col">Cụm đỗ / cột</th><th scope="col">Tổng ô</th><th scope="col">Trống</th><th scope="col">Có thể giữ chỗ</th><th scope="col">Đã đỗ</th><th scope="col">Giữ chỗ</th><th scope="col">Xe chưa đăng ký</th><th scope="col">Chờ AI</th><th scope="col">Có xe (%)</th></tr></thead>
    <tbody>{zones.map((zone) => <tr key={zone.id} className={selectedId === zone.id ? "zone-selected" : ""}>
      <td>{onSelect ? <button className="secondary-button" aria-pressed={selectedId === zone.id} onClick={() => onSelect(zone.id)}>{zone.name}</button> : <b>{zone.name}</b>}<small>Camera #{zone.cameraId}</small></td>
      <td>{axis ? zone.description : zoneRange(zone)}</td><td>{zone.summary.total_slots}</td><td>{zone.summary.empty_slots}</td><td className="text-EMPTY">{zone.summary.available_slots}</td><td>{zone.summary.occupied_slots}</td><td>{zone.summary.reserved_slots}</td><td>{zone.summary.unknown_slots}</td><td>{zone.summary.uninitialized_slots}</td><td>{Math.round(zone.occupancyRate)}%</td>
    </tr>)}</tbody>
  </table></div>;
}

export function ZoneOverview({ slots, selectedId, onSelect }: { slots: ParkingSlot[]; selectedId: string; onSelect: (id: string) => void }) {
  const id = useId(), zones = buildZones(slots);
  if (!zones.length) return null;
  return <section className="panel zone-overview" aria-label="Phân khu bãi đỗ">
    <div className="zone-toolbar"><div className="zone-picker"><label htmlFor={id}>Khu bãi đỗ</label><select id={id} value={selectedId} onChange={(e) => onSelect(e.target.value)}><option value="">Tất cả khu</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {zoneRange(zone)} · {zone.summary.total_slots} ô</option>)}</select></div><span>{zones.length} khu · {zones.some((zone) => zone.kind === "island") ? "hai dãy cùng đảo cây; dãy mép/cổng riêng" : "theo dãy; chưa hiệu chỉnh đảo cây"}</span></div>
    <details><summary>So sánh thống kê các khu</summary><ZoneTable zones={zones} selectedId={selectedId} onSelect={onSelect} /></details>
  </section>;
}
