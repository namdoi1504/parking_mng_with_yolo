import { useState } from "react";
import { ArrowRight, CarFront, List, Map, RefreshCw } from "lucide-react";
import { AppShell, EmptyState, ParkingGrid } from "../components";
import { ParkingMap, SlotDetail } from "../ParkingMap";
import { connectionLabels, useParkingMap } from "../useParkingMap";

export function LookupPage() {
  const { data, error, busy, load, connection } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const [view, setView] = useState("map");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const cameras = [...new Set(data?.slots.map((s) => s.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : cameras[0] ?? 0;
  const slots = data?.slots.filter((s) => s.camera_id === activeCamera) ?? [];
  const empty = slots.filter((s) => s.status === "EMPTY" && s.slot_code.toLowerCase().includes(query.toLowerCase()));
  const selected = slots.find((s) => s.id === selectedId);
  function findEmpty() {
    if (!empty.length) return;
    setSelectedId(empty[0].id);
    setView("map");
  }
  const pages = Math.max(1, Math.ceil(empty.length / 60)), currentPage = Math.min(page, pages - 1);
  return <AppShell eyebrow="Tra cứu" title="Tìm vị trí còn trống" connection={connectionLabels[connection]} connectionState={connection}
    actions={<button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={17} />{busy ? "Đang tải…" : "Làm mới"}</button>}>
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}
    <div className="zone-cards">{cameras.map((id) => { const scoped = data!.slots.filter((s) => s.camera_id === id), free = scoped.filter((s) => s.status === "EMPTY").length; return <button key={id} aria-pressed={activeCamera === id} className={activeCamera === id ? "active" : ""} onClick={() => { setCamera(id); setPage(0); setSelectedId(undefined); }}><span>Camera #{id}</span><b>{free}<small> ô trống / {scoped.length}</small></b><div><i style={{ width: `${free / scoped.length * 100}%` }} /></div><small>{Math.round(free / scoped.length * 100)}% vị trí còn trống</small></button>; })}</div>
    {data && <section className="lookup-quick-action" aria-label="Tìm ô trống nhanh"><div><CarFront size={28} aria-hidden="true" /><div><h2>{empty.length ? `${empty.length} ô trống${query ? " phù hợp" : " tại camera đang chọn"}` : "Chưa có ô trống phù hợp"}</h2><p>Chọn một ô để xem vị trí. Thao tác này không giữ chỗ.</p></div></div><button className="primary-button" disabled={busy || !!error || !empty.length} onClick={findEmpty}>Tìm ô trống<ArrowRight size={17} aria-hidden="true" /></button></section>}
    <div className="management-toolbar"><div className="tab-switch"><button className={view === "map" ? "active" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}><Map size={17} />Bản đồ</button><button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} />Danh sách ô trống</button></div><span className="supporting-text">Chọn ô chỉ để xem, không phải thao tác giữ chỗ.</span></div>
    <div className="operations-layout">{view === "map" ? <ParkingMap slots={slots} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} defaultFilter="EMPTY" /> : <section className="panel operations-map"><div className="panel-title"><span>{empty.length} vị trí còn trống</span></div><label className="search-field"><span className="sr-only">Tìm mã ô trống</span><input placeholder="Tìm mã ô…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label><p className="supporting-text">Trạng thái có thể thay đổi trước khi bạn đến.</p>{empty.length ? <ParkingGrid slots={empty.slice(currentPage * 60, (currentPage + 1) * 60)} selected={selectedId} onSelect={(s) => setSelectedId(s.id)} /> : <EmptyState title="Không có ô trống phù hợp" text="Thử đổi camera hoặc làm mới dữ liệu." />}<div className="pagination"><span>Trang {currentPage + 1}/{pages}</span><button className="secondary-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Trước</button><button className="secondary-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sau</button></div></section>}<SlotDetail slot={selected} /></div>
  </AppShell>;
}
