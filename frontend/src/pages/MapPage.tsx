import { ZoneOverview } from "../ZoneOverview";
import { buildZones } from "../zones";
import { useEffect, useState } from "react";
import { isScenarioMode } from "../scenarioMode";
import { ArrowRight, Camera, CarFront, List, Map, RefreshCw } from "lucide-react";
import { AppShell, EmptyState, ParkingGrid, SummaryStrip } from "../components";
import { ParkingMap, SlotDetail } from "../ParkingMap";
import { isAvailable, summarize } from "../parking";
import { connectionLabels, useParkingMap } from "../useParkingMap";
import { ReservationActions } from "../ReservationActions";

export function MapPage() {
  const { data, error, busy, load, connection, updatedAt, applySlot, sessionRevision } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [zoneId, setZoneId] = useState("");
  const [selectedId, setSelectedId] = useState<number>();
  const [view, setView] = useState("map");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [mapRevision, setMapRevision] = useState(0);
  const cameras = [...new Set(data?.slots.map((s) => s.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : cameras[0] ?? 0;
  const slots = data?.slots.filter((s) => s.camera_id === activeCamera) ?? [];
  const zones = buildZones(slots);
  const activeZone = zones.find((zone) => zone.id === zoneId);
  const scopedSlots = activeZone?.slots ?? slots;
  const selected = slots.find((s) => s.id === selectedId);
  useEffect(() => { if (isScenarioMode() && slots[0]) setSelectedId(slots[0].id); }, [slots[0]?.id]);
  useEffect(() => {
    if (!isScenarioMode()) return;
    const focus = () => { setSelectedId(1); setZoneId(""); setView("map"); setMapRevision((value) => value + 1); };
    window.addEventListener("scenario-focus", focus);
    return () => window.removeEventListener("scenario-focus", focus);
  }, []);
  const empty = scopedSlots.filter((slot) => isAvailable(slot) && slot.slot_code.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(empty.length / 60)), currentPage = Math.min(page, pages - 1);
  function chooseZone(id: string) { setZoneId(id); setSelectedId(undefined); setPage(0); }
  function findEmpty() {
    if (!empty.length) return;
    setSelectedId(empty[0].id);
    setMapRevision((revision) => revision + 1);
    setView("map");
  }
  function chooseSlot(slot: typeof slots[number]) {
    setSelectedId(slot.id);
    if (activeZone && !activeZone.slots.some((item) => item.id === slot.id)) setZoneId(zones.find((zone) => zone.slots.some((item) => item.id === slot.id))?.id ?? "");
  }
  return <AppShell title="Bản đồ bãi đỗ" eyebrow="Vận hành" connection={connectionLabels[connection]} connectionState={connection}
    actions={<button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={17} />Làm mới</button>}>
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}
    <div className="camera-selector-bar"><div className="camera-tabs" aria-label="Chọn camera">{cameras.map((id) => <button key={id} aria-pressed={activeCamera === id} className={activeCamera === id ? "active" : ""} onClick={() => { setCamera(id); setZoneId(""); setSelectedId(undefined); setPage(0); }}><Camera size={16} />Camera #{id}<small>{data?.slots.filter((s) => s.camera_id === id).length} ô</small></button>)}</div><span>{updatedAt ? `Nhận dữ liệu lúc ${updatedAt.toLocaleTimeString("vi-VN")}` : "Đang chờ dữ liệu bãi đỗ"}</span></div>
    {data ? <>
      <ZoneOverview slots={slots} selectedId={activeZone?.id ?? ""} onSelect={chooseZone} />
      <SummaryStrip summary={summarize(scopedSlots)} scopeLabel={activeZone ? `${activeZone.name} · Camera #${activeCamera}` : undefined} />
      <section className="lookup-quick-action" aria-label="Tìm ô trống nhanh">
        <div><CarFront size={28} aria-hidden="true" /><div><h2>{empty.length} ô trống{activeZone ? ` tại ${activeZone.name}` : " tại camera đang chọn"}{query && " phù hợp mã tìm kiếm"}</h2><p>Chọn ô để xem vị trí và đường vào. Nút tìm không giữ chỗ.</p></div></div>
        <button className="primary-button" disabled={busy || !!error || !empty.length} onClick={findEmpty}>Tìm ô trống<ArrowRight size={17} aria-hidden="true" /></button>
      </section>
      <div className="management-toolbar"><div className="tab-switch" aria-label="Chế độ xem ô đỗ">
        <button className={view === "map" ? "active" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}><Map size={17} aria-hidden="true" />Bản đồ</button>
        <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} aria-hidden="true" />Danh sách ô trống</button>
      </div></div>
      <div className="operations-layout map-page-layout">
        {view === "map" ? <ParkingMap key={mapRevision} slots={slots} scopeIds={activeZone?.slots.map((slot) => slot.id)} scopeLabel={activeZone?.name} selectedId={selectedId} onSelect={chooseSlot} /> : <section className="panel operations-map" aria-label="Danh sách ô trống">
          <div className="panel-title"><span>{empty.length} vị trí còn trống</span></div>
          <label className="search-field"><span className="sr-only">Tìm mã ô trống</span><input placeholder="Tìm mã ô…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
          <p className="supporting-text">Chỉ hiển thị ô trống có quan sát AI còn hiệu lực và không có phiên đang hoạt động.</p>
          {empty.length ? <ParkingGrid slots={empty.slice(currentPage * 60, (currentPage + 1) * 60)} selected={selectedId} onSelect={chooseSlot} /> : <EmptyState title="Không có ô trống phù hợp" text="Thử đổi camera, khu hoặc mã tìm kiếm." />}
          <div className="pagination"><span>Trang {currentPage + 1}/{pages}</span><button className="secondary-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Trước</button><button className="secondary-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</button></div>
        </section>}
        <SlotDetail zoneName={zones.find((zone) => zone.slots.some((slot) => slot.id === selectedId))?.name} slot={selected} actions={selected && <ReservationActions key={selected.id} slot={selected} sessionRevision={sessionRevision} disabled={!!error} onUpdated={applySlot} onReload={load} />} />
      </div>
    </> : <EmptyState title={error ? "Chưa kết nối được bãi đỗ" : "Đang tải bản đồ"} text="Bản đồ dùng dữ liệu thật từ hệ thống, không tự thay bằng dữ liệu mẫu." />}
  </AppShell>;
}
