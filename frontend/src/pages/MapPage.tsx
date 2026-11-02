import { ZoneOverview } from "../components/ZoneOverview";
import { buildZones } from "../services/zones";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isScenarioMode } from "../services/scenarioMode";
import { ArrowRight, Camera, CarFront, List, Map, RefreshCw } from "lucide-react";
import { AppShell, EmptyState, ParkingGrid, SummaryStrip } from "../components";
import { ParkingMap, SlotDetail } from "../components/ParkingMap";
import { isAvailable, summarize } from "../services/parking";
import { connectionLabels, useParkingMap } from "../hooks/useParkingMap";
import { ReservationActions } from "../components/ReservationActions";

export function MapPage() {
  const [searchParams] = useSearchParams();
  const queryZone = searchParams.get("zone");
  const { data, error, busy, load, connection, updatedAt, applySlot, sessionRevision } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [zoneId, setZoneId] = useState(queryZone || "");
  const [selectedId, setSelectedId] = useState<number>();
  const [view, setView] = useState("map");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [mapRevision, setMapRevision] = useState(0);

  useEffect(() => {
    const q = searchParams.get("zone");
    if (q) setZoneId(q);
  }, [searchParams]);

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
    if (activeZone && !activeZone.slots.some((item) => item.id === slot.id)) {
      setZoneId(zones.find((zone) => zone.slots.some((item) => item.id === slot.id))?.id ?? "");
    }
  }

  return <AppShell
    title="Bản đồ bãi đỗ"
    eyebrow="Vận hành"
    connection={connectionLabels[connection]}
    connectionState={connection}
    actions={
      <div className="map-page-top-actions">
        <button className="primary-button quick-find-btn" disabled={busy || !!error || !empty.length} onClick={findEmpty}>
          <CarFront size={16} aria-hidden="true" />
          Tìm ô trống
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <button className="secondary-button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} />Làm mới
        </button>
      </div>
    }
  >
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}

    {data ? (
      <div className="map-redesign-workspace">
        {/* UNIFIED TOP CONTROL BAR (Camera, Zone, View Switch) */}
        <div className="map-control-hub">
          <div className="hub-left">
            <div className="camera-tabs" aria-label="Chọn camera">
              {cameras.map((id) => (
                <button
                  key={id}
                  aria-pressed={activeCamera === id}
                  className={activeCamera === id ? "active" : ""}
                  onClick={() => { setCamera(id); setZoneId(""); setSelectedId(undefined); setPage(0); }}
                >
                  <Camera size={15} />Camera #{id}
                  <small>{data?.slots.filter((s) => s.camera_id === id).length} ô</small>
                </button>
              ))}
            </div>

            <div className="hub-divider" />

            <ZoneOverview slots={slots} selectedId={activeZone?.id ?? ""} onSelect={chooseZone} />
          </div>

          <div className="hub-right">
            <span className="hub-sync-time">{updatedAt ? `Cập nhật: ${updatedAt.toLocaleTimeString("vi-VN")}` : ""}</span>
            <div className="tab-switch" aria-label="Chế độ xem ô đỗ">
              <button className={view === "map" ? "active" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}>
                <Map size={15} aria-hidden="true" />Bản đồ
              </button>
              <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>
                <List size={15} aria-hidden="true" />Danh sách ô trống
              </button>
            </div>
          </div>
        </div>

        {/* COMPACT METRIC RIBBON */}
        <SummaryStrip summary={summarize(scopedSlots)} scopeLabel={activeZone ? `${activeZone.name} · Camera #${activeCamera}` : undefined} />

        {/* FULL-WIDTH WORKSPACE WITH SLIDE-OVER INSPECTOR */}
        <div className={`map-viewport-wrapper ${selectedId ? "drawer-open" : ""}`}>
          <div className="map-viewport-main">
            {view === "map" ? (
              <ParkingMap
                key={mapRevision}
                slots={slots}
                scopeIds={activeZone?.slots.map((slot) => slot.id)}
                scopeLabel={activeZone?.name}
                selectedId={selectedId}
                onSelect={chooseSlot}
              />
            ) : (
              <section className="panel operations-map" aria-label="Danh sách ô trống">
                <div className="panel-title">
                  <span>{empty.length} vị trí còn trống</span>
                </div>
                <label className="search-field">
                  <span className="sr-only">Tìm mã ô trống</span>
                  <input placeholder="Tìm mã ô trống…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
                </label>
                {empty.length ? (
                  <ParkingGrid slots={empty.slice(currentPage * 60, (currentPage + 1) * 60)} selected={selectedId} onSelect={chooseSlot} />
                ) : (
                  <EmptyState title="Không có ô trống phù hợp" text="Thử đổi camera, khu hoặc tìm với từ khóa khác." />
                )}
                <div className="pagination">
                  <span>Trang {currentPage + 1}/{pages}</span>
                  <button className="secondary-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Trước</button>
                  <button className="secondary-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</button>
                </div>
              </section>
            )}
          </div>

          {/* SLIDE-OVER DRAWER */}
          <aside className={`slot-slideover-drawer ${selectedId ? "is-open" : "is-collapsed"}`}>
            <SlotDetail
              zoneName={zones.find((zone) => zone.slots.some((slot) => slot.id === selectedId))?.name}
              slot={selected}
              onClose={() => setSelectedId(undefined)}
              actions={selected && <ReservationActions key={selected.id} slot={selected} sessionRevision={sessionRevision} disabled={!!error} onUpdated={applySlot} onReload={load} />}
            />
          </aside>
        </div>
      </div>
    ) : (
      <EmptyState title={error ? "Chưa kết nối được bãi đỗ" : "Đang tải bản đồ"} text="Vui lòng kiểm tra lại kết nối mạng hoặc thử làm mới dữ liệu." />
    )}
  </AppShell>;
}
