import { useId } from "react";
import { ArrowUpRight, Map } from "lucide-react";
import { buildZones, type ParkingZone } from "../services/zones";
import type { ParkingSlot } from "../types";

export function ZoneTable({
  zones,
  selectedId,
  onSelect
}: {
  zones: ParkingZone[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  axis?: "col" | "row";
}) {
  return (
    <div className="zone-table-scroll modern-table-container" tabIndex={0} aria-label="Bảng thống kê các khu có thể cuộn">
      <table className="zone-stat-table modern-data-table">
        <caption className="sr-only">
          Thống kê hiện tại theo phân khu bãi đỗ · tỷ lệ có xe gồm xe đã đỗ và xe chưa đăng ký
        </caption>
        <thead>
          <tr>
            <th scope="col">Phân khu / Camera</th>
            <th scope="col" className="text-center">Tổng chỗ</th>
            <th scope="col" className="text-center">Còn trống</th>
            <th scope="col" className="text-center">Khả dụng</th>
            <th scope="col" className="text-center">Đã đỗ</th>
            <th scope="col" className="text-center">Giữ chỗ</th>
            <th scope="col" className="text-center">Chưa ĐK</th>
            <th scope="col">Tỷ lệ có xe (%)</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((zone) => {
            const occupancy = Math.round(zone.occupancyRate);
            const loadLevel = occupancy >= 85 ? "high" : occupancy >= 60 ? "medium" : "low";

            return (
              <tr
                key={zone.id}
                className={`interactive-row ${selectedId === zone.id ? "zone-selected" : ""}`}
                onClick={() => onSelect?.(zone.id)}
                style={{ cursor: onSelect ? "pointer" : "default" }}
                title={onSelect ? `Bấm để chuyển sang sơ đồ bản đồ phân khu ${zone.name}` : undefined}
              >
                <td className="zone-identity-cell">
                  <div className="zone-title-box">
                    <b className="zone-title-text">{zone.name}</b>
                    {onSelect && (
                      <span className="zone-map-indicator-pill">
                        <Map size={11} aria-hidden="true" />
                        Mở bản đồ
                        <ArrowUpRight size={10} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <span className="zone-camera-tag">Camera #{zone.cameraId}</span>
                </td>
                <td className="text-center font-semibold">{zone.summary.total_slots}</td>
                <td className="text-center">
                  <span className={`stat-pill-empty ${zone.summary.empty_slots > 0 ? "has-empty" : "is-zero"}`}>
                    {zone.summary.empty_slots}
                  </span>
                </td>
                <td className={`text-center ${zone.summary.available_slots === 0 ? "stat-muted" : "text-EMPTY font-medium"}`}>
                  {zone.summary.available_slots}
                </td>
                <td className={`text-center ${zone.summary.occupied_slots === 0 ? "stat-muted" : "font-medium"}`}>
                  {zone.summary.occupied_slots}
                </td>
                <td className={`text-center ${zone.summary.reserved_slots === 0 ? "stat-muted" : "stat-reserved"}`}>
                  {zone.summary.reserved_slots}
                </td>
                <td className={`text-center ${zone.summary.unknown_slots === 0 ? "stat-muted" : "stat-warn"}`}>
                  {zone.summary.unknown_slots}
                </td>
                <td className="occupancy-col">
                  <div className="occupancy-cell">
                    <span className="occupancy-pct">{occupancy}%</span>
                    <div className="occupancy-track" aria-hidden="true">
                      <div
                        className={`occupancy-fill ${loadLevel}`}
                        style={{ width: `${Math.min(100, Math.max(0, zone.occupancyRate))}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ZoneOverview({
  slots,
  selectedId,
  onSelect
}: {
  slots: ParkingSlot[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const zones = buildZones(slots);
  if (!zones.length) return null;

  return (
    <div className="zone-picker-inline" aria-label="Phân khu bãi đỗ">
      <label htmlFor={id}>Khu bãi đỗ</label>
      <select id={id} value={selectedId} onChange={(e) => onSelect(e.target.value)}>
        <option value="">Tất cả khu ({slots.length} vị trí)</option>
        {zones.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name} ({zone.summary.empty_slots} trống / {zone.summary.total_slots} ô)
          </option>
        ))}
      </select>
    </div>
  );
}
