import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CarFront, Maximize, Minus, Plus, Search } from "lucide-react";
import { EmptyState, ParkingGrid, statusMeta } from "./components";
import type { ParkingSlot, SlotStatus } from "./types";
import { isAvailable } from "./parking";
import { SITE, LEFT_ACCESS_PROPOSAL, calibrated } from "./siteLayout";
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

export function ParkingMap({ slots, selectedId, onSelect, compact = false, defaultFilter = "ALL", availableOnly = false, scopeIds, scopeLabel }: {
  slots: ParkingSlot[]; selectedId?: number; onSelect: (slot: ParkingSlot) => void; compact?: boolean; defaultFilter?: SlotStatus | "UNINITIALIZED" | "ALL"; availableOnly?: boolean; scopeIds?: number[]; scopeLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SlotStatus | "UNINITIALIZED" | "ALL">(defaultFilter);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [fitHeight, setFitHeight] = useState<number>();
  const [direction, setDirection] = useState<"entry" | "exit">("entry");
  const [reference, setReference] = useState(false);
  const [proposedAccess, setProposedAccess] = useState(true);
  const showProposedAccess = proposedAccess && !reference;
  const markerId = useId().replace(/:/g, "");
  // Live status changes must not rebuild the image-space road graph.
  const layoutKey = JSON.stringify(slots.map((s) => [s.id, s.camera_id, s.slot_code, s.roi_coordinates]));
  const layout = useMemo<ParkingSlot[]>(() => JSON.parse(layoutKey).map(
    ([id, camera_id, slot_code, roi_coordinates]: [number, number, string, ParkingSlot["roi_coordinates"]]) =>
      ({ id, camera_id, slot_code, roi_coordinates, status: "UNKNOWN", col: 0, row: 0, updated_at: "" })
  ), [layoutKey]);
  const network = useMemo(() => calibrated(layout) ? buildRoadNetwork(layout, showProposedAccess) : null, [layout, showProposedAccess]);
  const selected = slots.find((s) => s.id === selectedId);
  const selectedLayout = layout.find((slot) => slot.id === selectedId);
  const selectedStatus = selected?.status;
  const route = useMemo(() => network && selectedLayout && selectedStatus && (direction === "exit" || (selected && isAvailable(selected))) ? slotRoute(network, { ...selectedLayout, status: selectedStatus }, direction) : null,
    [network, selectedLayout, selectedStatus, selected?.observation_ready, selected?.active_session_id, selected?.needs_reconciliation, direction]);
  const geometry = useMemo(() => mapGeometry(layout), [layout]);
  const currentSlots = new Map(slots.map((slot) => [slot.id, slot]));
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !network) { setFitHeight(undefined); return; }
    const update = () => { if (element.clientWidth) setFitHeight(element.clientWidth * SITE.height / (SITE.width - network.originX)); };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element); window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [network]);
  const zoomValue = useRef(1), renderedZoom = useRef(1);
  const anchor = useRef<{ x: number; y: number; left: number; top: number; ratio: number } | null>(null);
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function changeZoom(value: number, point?: { x: number; y: number }) {
    const next = Math.round(Math.max(1, Math.min(6, value)) * 10) / 10;
    if (next === zoomValue.current) return false;
    const element = viewport.current;
    if (element) anchor.current = { x: point?.x ?? element.clientWidth / 2, y: point?.y ?? element.clientHeight / 2,
      left: element.scrollLeft, top: element.scrollTop, ratio: next / renderedZoom.current };
    zoomValue.current = next; setZoom(next); return true;
  }
  function resetZoom() {
    anchor.current = null; zoomValue.current = 1; setZoom(1);
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; }
  }
  useLayoutEffect(() => {
    const point = anchor.current, element = viewport.current;
    if (point && element) { element.scrollLeft = (point.left + point.x) * point.ratio - point.x; element.scrollTop = (point.top + point.y) * point.ratio - point.y; }
    anchor.current = null; renderedZoom.current = zoom;
  }, [zoom]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Leave browser/page gestures alone when zooming would exceed the limits.
      if (!event.deltaY) return;
      const bounds = element.getBoundingClientRect();
      if (changeZoom(zoomValue.current + (event.deltaY < 0 ? .2 : -.2), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })) event.preventDefault();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [!!geometry, slots[0]?.camera_id]);
  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.button !== 0 || event.pointerType === "touch" || zoomValue.current <= 1) return;
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
  }
  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true; suppressClick.current = true; setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.currentTarget.scrollLeft = start.left - dx; event.currentTarget.scrollTop = start.top - dy;
  }
  function stopPan(event: React.PointerEvent<HTMLDivElement>) {
    pan.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const activeId = selectedId ?? slots[0]?.id;
  const activeOnMap = geometry?.valid.some((slot) => slot.id === activeId);
  useEffect(() => { resetZoom(); setQuery(""); setFilter(defaultFilter); }, [slots[0]?.camera_id, defaultFilter]);
  const scope = scopeIds ? new Set(scopeIds) : null;
  const scopePoints = scope ? geometry?.valid.filter((slot) => scope.has(slot.id)).flatMap((slot) => slot.roi_coordinates) ?? [] : [];
  const scopeBounds = scopePoints.length ? {
    x: Math.min(...scopePoints.map((p) => p.x)) - 8, y: Math.min(...scopePoints.map((p) => p.y)) - 8,
    width: Math.max(...scopePoints.map((p) => p.x)) - Math.min(...scopePoints.map((p) => p.x)) + 16,
    height: Math.max(...scopePoints.map((p) => p.y)) - Math.min(...scopePoints.map((p) => p.y)) + 16,
  } : null;
  const matches = (slot: ParkingSlot) => (!scope || scope.has(slot.id)) && (!availableOnly || isAvailable(slot)) && (filter === "ALL" || (filter === "UNINITIALIZED" ? slot.status === null : slot.status === filter)) && slot.slot_code.toLowerCase().includes(query.trim().toLowerCase());
  const filtered = slots.filter(matches);
  function keySelect(event: React.KeyboardEvent<SVGGElement>, index: number) {
    const list = geometry?.valid.map((slot) => currentSlots.get(slot.id)!) ?? [];
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
      <label><span className="sr-only">Lọc trạng thái bản đồ</span><select value={filter} onChange={(e) => setFilter(e.target.value as SlotStatus | "UNINITIALIZED" | "ALL")}><option value="ALL">Tất cả trạng thái</option>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label>
      <div className="map-zoom"><button aria-label="Thu nhỏ bản đồ" disabled={zoom <= 1} onClick={() => changeZoom(zoomValue.current - .5)}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Phóng to bản đồ" disabled={zoom >= 6} onClick={() => changeZoom(zoomValue.current + .5)}><Plus size={16} /></button><button aria-label="Đưa bản đồ về kích thước ban đầu" onClick={resetZoom}><Maximize size={16} /></button></div>
    </div>
    {network && <label className="map-reference-toggle"><input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} />Đối chiếu ảnh gốc <small>Ảnh tĩnh từ video, không phải luồng trực tiếp</small></label>}
    {network && <label className="map-reference-toggle"><input type="checkbox" checked={proposedAccess} disabled={reference} onChange={(event) => setProposedAccess(event.target.checked)} />Hiển thị lối đi bên trái</label>}
    {network && <div className="map-route-controls"><label>Hướng dẫn đường đi <select aria-label="Hướng chỉ đường" value={direction} onChange={(e) => setDirection(e.target.value as "entry" | "exit")}><option value="entry">Cổng vào → ô trống</option><option value="exit">Ô đỗ → cổng ra</option></select></label><span role="status">{!selected ? "Chọn một ô để hiện tuyến đường." : direction === "entry" && !isAvailable(selected) ? `Ô ${selected.slot_code} chưa đủ điều kiện sử dụng. Chọn ô khác hoặc xem đường ra.` : route ? `${direction === "entry" ? "Đường vào" : "Đường ra"} · Ô ${selected.slot_code} · nét xanh` : `Chưa xác định được đường tiếp cận ô ${selected.slot_code}.`}</span></div>}
    {slots.length ? geometry ? <div className={`parking-map-viewport ${network ? "calibrated-map" : ""} ${reference ? "reference-map" : ""} ${zoom > 1 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`} ref={viewport} style={{ height: fitHeight }} tabIndex={0} aria-label="Khu vực bản đồ có thể cuộn"
      onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}
      onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); if (event.key === "0") resetZoom(); else changeZoom(zoomValue.current + (event.key === "-" ? -.5 : .5)); }
      }}>
      <svg className="parking-map-svg" viewBox={network ? `${network.originX} 0 ${SITE.width - network.originX} ${SITE.height}` : geometry.viewBox} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} aria-label="Sơ đồ vị trí các ô đỗ">
        {network && <g aria-hidden="true" pointerEvents="none">
          <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" /></marker></defs>
          <rect x={network.originX} width={SITE.width - network.originX} height="1080" fill="#eef2f5" />
          {reference ? <image href="/parking-site-reference.jpg" width="1920" height="1080" /> : <>
          <polygon points={(showProposedAccess ? LEFT_ACCESS_PROPOSAL.pavement : SITE.pavement).map((p) => p.join(",")).join(" ")} fill="#cbd5df" />
          {SITE.gardens.map((g, i) => <polygon key={i} points={g.map((p) => p.join(",")).join(" ")} fill="#8cbba1" stroke="#f1f5f9" strokeWidth="3" />)}
          {SITE.crossings.map((g, i) => <polygon key={i} points={g.map((p) => p.join(",")).join(" ")} fill="#f0d6d0" stroke="#ffffff" strokeWidth="2" />)}
          <text x="740" y="80" fill="#64748b" fontSize="22" textAnchor="middle">KHU CÔNG TRÌNH</text>
          </>}
          {SITE.roadLines.map((r, i) => <polyline key={i} points={r.map((p) => p.join(",")).join(" ")} fill="none" stroke="#f8fafc" strokeWidth="3" strokeDasharray="16 14" />)}
          {showProposedAccess && <g className="map-left-access"><title>Lối đi bên trái</title>{LEFT_ACCESS_PROPOSAL.roadLines.map((line, i) => <polyline key={i} points={line.map(point => point.join(",")).join(" ")} fill="none" stroke="#f8fafc" strokeWidth="3" strokeDasharray="16 14" />)}</g>}
          <path d="M 1900 120 H 1750" stroke="#2563eb" strokeWidth="7" markerEnd={`url(#${markerId})`} />
          <text x="1770" y="100" fill="#173c79" fontSize="22" fontWeight="700">CỔNG VÀO</text>
          <path d="M 1750 224 H 1900" stroke="#2563eb" strokeWidth="7" markerEnd={`url(#${markerId})`} />
          <text x="1770" y="263" fill="#173c79" fontSize="22" fontWeight="700">CỔNG RA</text>
          {route && <><polyline points={route.map((p) => `${p.x},${p.y}`).join(" ")} className="map-route-halo" /><polyline points={route.map((p) => `${p.x},${p.y}`).join(" ")} className="map-route-line" markerEnd={`url(#${markerId})`} /><circle cx={route[direction === "entry" ? route.length - 1 : 0].x} cy={route[direction === "entry" ? route.length - 1 : 0].y} r="9" fill="#2563eb" stroke="white" strokeWidth="3" /></>}
        </g>}
        {scopeBounds && <g aria-hidden="true" pointerEvents="none"><rect className="map-zone-outline" {...scopeBounds} rx="8" /><text className="map-zone-label" x={scopeBounds.x + scopeBounds.width / 2} y={scopeBounds.y + 22} textAnchor="middle" fontSize={18}>{scopeLabel ?? "Khu đang chọn"}</text></g>}
        {geometry.valid.map((position, index) => {
          const slot = currentSlots.get(position.id)!;
          const points = slot.roi_coordinates;
          return <g key={slot.id} data-slot-id={slot.id} role="button" tabIndex={activeId === slot.id || (!activeOnMap && index === 0) ? 0 : -1}
            aria-label={`Ô ${slot.slot_code}, Camera ${slot.camera_id}: ${statusMeta[slot.status ?? "UNINITIALIZED"].label}`} aria-pressed={slot.id === selectedId}
            className={`map-slot status-${slot.status ?? "UNINITIALIZED"} ${selectedId === slot.id ? "selected" : ""} ${matches(slot) ? "" : "dimmed"}`}
            onClick={() => onSelect(slot)} onKeyDown={(e) => keySelect(e, index)}>
            <title>{slot.slot_code} · {statusMeta[slot.status ?? "UNINITIALIZED"].label}</title>
            <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
            <text x={points.reduce((a, p) => a + p.x, 0) / points.length} y={points.reduce((a, p) => a + p.y, 0) / points.length} fontSize={geometry.fontSize} textAnchor="middle" dominantBaseline="central">{slot.slot_code}</text>
          </g>;
        })}
      </svg>
    </div> : <ParkingGrid slots={filtered} selected={selectedId} onSelect={onSelect} /> : <EmptyState title="Chưa có vị trí đỗ" text="Các ô sẽ xuất hiện khi dữ liệu bãi đỗ được tải." />}
    <div className="map-legend">{Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i className={`status-${key}`} />{meta.label}</span>)}<small>{filtered.length}/{slots.length} ô phù hợp</small></div>
    {slots.length > 0 && !filtered.length && <p className="supporting-text" role="status">Không có ô phù hợp. Thử thay đổi mã tìm kiếm hoặc trạng thái.</p>}
    {geometry && geometry.valid.length < slots.length && <p className="supporting-text">{slots.length - geometry.valid.length} ô chưa có vị trí trên bản đồ.</p>}
    <p className="map-caption">Cuộn chuột để thu/phóng (100–600%), kéo để di chuyển khi phóng to. Trên điện thoại, dùng nút +/− và vuốt bản đồ. Khi vùng bản đồ có focus: +/− để zoom, 0 để về toàn cảnh. Dùng phím mũi tên để chuyển ô. {network ? "Sơ đồ bố trí bãi đỗ; tuyến chỉ chạy trong các lối xe đã khoanh, không dùng khe hẹp sát mép ảnh. 1 cổng vào, 1 cổng ra theo mũi tên đã đánh dấu. Chiều đi trong bãi chưa được xác minh; tuyến tham khảo, không có GPS hoặc khoảng cách thực tế." : "Sơ đồ từ vị trí đã lưu; camera này chưa được hiệu chỉnh đường đi."}</p>
  </section>;
}

export function SlotDetail({ slot, actions, zoneName }: { slot?: ParkingSlot; actions?: import("react").ReactNode; zoneName?: string }) {
  return <section className="panel inspector slot-inspector"><h2>Thông tin ô đỗ</h2>{slot ? <>
    <div className={`selected-slot-icon status-${slot.status ?? "UNINITIALIZED"}`}><CarFront size={32} /></div>
    <h3 className="slot-code-heading">{slot.slot_code}</h3><span className={`status-badge status-${slot.status ?? "UNINITIALIZED"}`}>{statusMeta[slot.status ?? "UNINITIALIZED"].label}</span>
    <dl className="detail-list">{zoneName && <div><dt>Khu bãi đỗ</dt><dd>{zoneName}</dd></div>}<div><dt>Camera phụ trách</dt><dd>Camera #{slot.camera_id}</dd></div><div><dt>Vị trí hàng / cột</dt><dd>{slot.row} / {slot.col} <small>(chỉ số từ 0)</small></dd></div><div><dt>Quan sát AI</dt><dd>{slot.observation_ready ? "Còn hiệu lực" : "Chưa có dữ liệu mới"}</dd></div>{slot.reservation_expires_at && <div><dt>Hạn giữ chỗ</dt><dd>{new Date(slot.reservation_expires_at).toLocaleString("vi-VN")}</dd></div>}{slot.needs_reconciliation && <div><dt>Đối soát</dt><dd>Cần xử lý dữ liệu cũ</dd></div>}<div><dt>Cập nhật gần nhất</dt><dd>{new Date(slot.updated_at).toLocaleString("vi-VN")}</dd></div></dl>
    {actions ?? <p className="supporting-text">Trạng thái do AI ghi nhận. Chọn ô để xem thông tin.</p>}
  </> : <EmptyState title="Chọn một vị trí" text="Chọn ô trên bản đồ để xem trạng thái và camera phụ trách." />}</section>;
}
