import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CarFront, Maximize, Minus, Plus, Search } from "lucide-react";
import { EmptyState, ParkingGrid, statusMeta } from "./components";
import type { ParkingSlot, SlotStatus } from "./types";
import { SITE, calibrated } from "./siteLayout";
import { buildRoadNetwork, slotRoute } from "./routing";

export function mapGeometry(slots: ParkingSlot[]) {
  const valid = slots.filter((slot) => slot.roi_coordinates.length >= 3 && slot.roi_coordinates.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const points = valid.flatMap((s) => s.roi_coordinates);
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1, height = Math.max(...ys) - minY || 1;
  const padding = Math.max(width, height) * .025;
  const dimensions = valid.map((slot) => {
    const x = slot.roi_coordinates.map((p) => p.x), y = slot.roi_coordinates.map((p) => p.y);
    return Math.min(Math.max(...x) - Math.min(...x), Math.max(...y) - Math.min(...y));
  }).sort((a, b) => a - b);
  return { valid, viewBox: `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`,
    fontSize: Math.max(6, dimensions[Math.floor(dimensions.length / 2)] * .3) };
}

export function ParkingMap({ slots, selectedId, onSelect, compact = false, defaultFilter = "ALL" }: {
  slots: ParkingSlot[]; selectedId?: number; onSelect: (slot: ParkingSlot) => void; compact?: boolean; defaultFilter?: SlotStatus | "ALL";
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SlotStatus | "ALL">(defaultFilter);
  const [zoom, setZoom] = useState(1);
  const [direction, setDirection] = useState<"entry" | "exit">("entry");
  const [reference, setReference] = useState(false);
  const markerId = useId().replace(/:/g, "");
  // Live status changes must not rebuild the image-space road graph.
  const layoutKey = JSON.stringify(slots.map((s) => [s.id, s.camera_id, s.slot_code, s.roi_coordinates]));
  const network = useMemo(() => {
    const layout: ParkingSlot[] = JSON.parse(layoutKey).map(([id, camera_id, slot_code, roi_coordinates]: [number, number, string, ParkingSlot["roi_coordinates"]]) => ({ id, camera_id, slot_code, roi_coordinates, status: "UNKNOWN", col: 0, row: 0, updated_at: "" }));
    return calibrated(layout) ? buildRoadNetwork(layout) : null;
  }, [layoutKey]);
  const selected = slots.find((s) => s.id === selectedId);
  const route = useMemo(() => network && selected ? slotRoute(network, selected, direction) : null, [network, selected, direction]);
  const geometry = useMemo(() => mapGeometry(slots), [slots]);
  const viewport = useRef<HTMLDivElement>(null);
  const activeId = selectedId ?? slots[0]?.id;
  useEffect(() => { setZoom(1); setQuery(""); setFilter(defaultFilter); viewport.current?.scrollTo?.(0, 0); }, [slots[0]?.camera_id, defaultFilter]);
  const matches = (slot: ParkingSlot) => (filter === "ALL" || slot.status === filter) && slot.slot_code.toLowerCase().includes(query.trim().toLowerCase());
  const filtered = slots.filter(matches);
  function keySelect(event: React.KeyboardEvent<SVGGElement>, index: number) {
    const list = geometry?.valid ?? [];
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(list[index]); }
    const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
    if (step && list.length) {
      event.preventDefault();
      const next = list[(index + step + list.length) % list.length];
      onSelect(next);
      viewport.current?.querySelector<SVGGElement>(`[data-slot-id="${next.id}"]`)?.focus();
    }
  }
  return <section className={`panel parking-map-panel ${compact ? "compact" : ""}`} aria-label="Bản đồ các ô đỗ">
    <div className="panel-title"><span><CarFront size={18} />Bản đồ vị trí đỗ</span><small>{slots.length} vị trí</small></div>
    <div className="map-controls"><label className="search-field"><Search size={16} /><span className="sr-only">Tìm ô trên bản đồ</span><input placeholder="Tìm mã ô…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label><span className="sr-only">Lọc trạng thái bản đồ</span><select value={filter} onChange={(e) => setFilter(e.target.value as SlotStatus | "ALL")}><option value="ALL">Tất cả trạng thái</option>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label>
      <div className="map-zoom"><button aria-label="Thu nhỏ bản đồ" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - .5))}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Phóng to bản đồ" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + .5))}><Plus size={16} /></button><button aria-label="Đưa bản đồ về kích thước ban đầu" onClick={() => { setZoom(1); viewport.current?.scrollTo?.(0, 0); }}><Maximize size={16} /></button></div>
    </div>
    {network && <label className="map-reference-toggle"><input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} />Đối chiếu ảnh gốc <small>Ảnh tĩnh từ video, không phải luồng trực tiếp</small></label>}
    {network && <div className="map-route-controls"><label>Hướng dẫn đường đi <select aria-label="Hướng chỉ đường" value={direction} onChange={(e) => setDirection(e.target.value as "entry" | "exit")}><option value="entry">Cổng vào → ô trống</option><option value="exit">Ô đỗ → cổng ra</option></select></label><span role="status">{!selected ? "Chọn một ô để hiện tuyến đường." : direction === "entry" && selected.status !== "EMPTY" ? `Ô ${selected.slot_code} không trống. Chọn ô khác hoặc xem đường ra.` : route ? `${direction === "entry" ? "Đường vào" : "Đường ra"} · Ô ${selected.slot_code} · nét xanh` : `Chưa xác định được đường tiếp cận ô ${selected.slot_code}.`}</span></div>}
    {slots.length ? geometry ? <div className={`parking-map-viewport ${network ? "calibrated-map" : ""} ${reference ? "reference-map" : ""}`} ref={viewport} tabIndex={0} aria-label="Khu vực bản đồ có thể cuộn">
      <svg className="parking-map-svg" viewBox={network ? "0 0 1920 1080" : geometry.viewBox} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} aria-label="Sơ đồ vị trí các ô đỗ">
        {network && <g aria-hidden="true" pointerEvents="none">
          <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" /></marker></defs>
          <rect width="1920" height="1080" fill="#eef2f5" />
          {reference ? <image href="/parking-site-reference.jpg" width="1920" height="1080" /> : <>
          <polygon points={SITE.pavement.map((p) => p.join(",")).join(" ")} fill="#cbd5df" />
          {SITE.gardens.map((g, i) => <polygon key={i} points={g.map((p) => p.join(",")).join(" ")} fill="#8cbba1" stroke="#f1f5f9" strokeWidth="3" />)}
          {SITE.crossings.map((g, i) => <polygon key={i} points={g.map((p) => p.join(",")).join(" ")} fill="#f0d6d0" stroke="#ffffff" strokeWidth="2" />)}
          <text x="740" y="80" fill="#64748b" fontSize="22" textAnchor="middle">KHU CÔNG TRÌNH</text>
          </>}
          {SITE.roadLines.map((r, i) => <polyline key={i} points={r.map((p) => p.join(",")).join(" ")} fill="none" stroke="#f8fafc" strokeWidth="3" strokeDasharray="16 14" />)}
          <path d="M 1900 120 H 1750" stroke="#2563eb" strokeWidth="7" markerEnd={`url(#${markerId})`} />
          <text x="1770" y="100" fill="#173c79" fontSize="22" fontWeight="700">CỔNG VÀO</text>
          <path d="M 1750 224 H 1900" stroke="#2563eb" strokeWidth="7" markerEnd={`url(#${markerId})`} />
          <text x="1770" y="263" fill="#173c79" fontSize="22" fontWeight="700">CỔNG RA</text>
          {route && <><polyline points={route.map((p) => `${p.x},${p.y}`).join(" ")} className="map-route-halo" /><polyline points={route.map((p) => `${p.x},${p.y}`).join(" ")} className="map-route-line" markerEnd={`url(#${markerId})`} /><circle cx={route[direction === "entry" ? route.length - 1 : 0].x} cy={route[direction === "entry" ? route.length - 1 : 0].y} r="9" fill="#2563eb" stroke="white" strokeWidth="3" /></>}
        </g>}
        {geometry.valid.map((slot, index) => {
          const points = slot.roi_coordinates;
          return <g key={slot.id} data-slot-id={slot.id} role="button" tabIndex={activeId === slot.id || (!geometry.valid.some((s) => s.id === activeId) && index === 0) ? 0 : -1}
            aria-label={`Ô ${slot.slot_code}, Camera ${slot.camera_id}: ${statusMeta[slot.status].label}`} aria-pressed={slot.id === selectedId}
            className={`map-slot status-${slot.status} ${selectedId === slot.id ? "selected" : ""} ${matches(slot) ? "" : "dimmed"}`}
            onClick={() => onSelect(slot)} onKeyDown={(e) => keySelect(e, index)}>
            <title>{slot.slot_code} · {statusMeta[slot.status].label}</title>
            <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
            <text x={points.reduce((a, p) => a + p.x, 0) / points.length} y={points.reduce((a, p) => a + p.y, 0) / points.length} fontSize={geometry.fontSize} textAnchor="middle" dominantBaseline="central">{slot.slot_code}</text>
          </g>;
        })}
      </svg>
    </div> : <ParkingGrid slots={filtered} selected={selectedId} onSelect={onSelect} /> : <EmptyState title="Chưa có vị trí đỗ" text="Các ô sẽ xuất hiện khi dữ liệu bãi đỗ được tải." />}
    <div className="map-legend">{Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i className={`status-${key}`} />{meta.label}</span>)}<small>{filtered.length}/{slots.length} ô phù hợp</small></div>
    {slots.length > 0 && !filtered.length && <p className="supporting-text" role="status">Không có ô phù hợp. Thử thay đổi mã tìm kiếm hoặc trạng thái.</p>}
    {geometry && geometry.valid.length < slots.length && <p className="supporting-text">{slots.length - geometry.valid.length} ô chưa có vị trí trên bản đồ.</p>}
    <p className="map-caption">{network ? "Sơ đồ bám theo ảnh gốc; tuyến chỉ chạy trong các lối xe đã khoanh, không dùng khe hẹp sát mép ảnh. 1 cổng vào, 1 cổng ra theo mũi tên đã đánh dấu. Chiều đi trong bãi chưa được xác minh; tuyến tham khảo, không có GPS hoặc khoảng cách thực tế." : "Sơ đồ từ vị trí đã lưu; camera này chưa được hiệu chỉnh đường đi."} Dùng phím mũi tên để chuyển ô.</p>
  </section>;
}

export function SlotDetail({ slot }: { slot?: ParkingSlot }) {
  return <section className="panel inspector slot-inspector"><h2>Thông tin ô đỗ</h2>{slot ? <>
    <div className={`selected-slot-icon status-${slot.status}`}><CarFront size={32} /></div>
    <h3 className="slot-code-heading">{slot.slot_code}</h3><span className={`status-badge status-${slot.status}`}>{statusMeta[slot.status].label}</span>
    <dl className="detail-list"><div><dt>Camera phụ trách</dt><dd>Camera #{slot.camera_id}</dd></div><div><dt>Vị trí hàng / cột</dt><dd>{slot.row} / {slot.col} <small>(chỉ số từ 0)</small></dd></div><div><dt>Cập nhật gần nhất</dt><dd>{new Date(slot.updated_at).toLocaleString("vi-VN")}</dd></div></dl>
    <p className="supporting-text">Trạng thái do AI ghi nhận. Chọn ô không giữ chỗ và không thay đổi dữ liệu hệ thống.</p>
  </> : <EmptyState title="Chọn một vị trí" text="Chọn ô trên bản đồ để xem trạng thái và camera phụ trách." />}</section>;
}
