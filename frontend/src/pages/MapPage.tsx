import { useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { AppShell, EmptyState, SummaryStrip } from "../components";
import { ParkingMap, SlotDetail } from "../ParkingMap";
import { summarize } from "../parking";
import { connectionLabels, useParkingMap } from "../useParkingMap";

export function MapPage() {
  const { data, error, busy, load, connection, updatedAt } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const cameras = [...new Set(data?.slots.map((s) => s.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : cameras[0] ?? 0;
  const slots = data?.slots.filter((s) => s.camera_id === activeCamera) ?? [];
  const selected = slots.find((s) => s.id === selectedId);
  return <AppShell title="Bản đồ bãi đỗ" eyebrow="Vận hành" connection={connectionLabels[connection]} connectionState={connection}
    actions={<button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={17} />{busy ? "Đang tải…" : "Làm mới"}</button>}>
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}
    <div className="camera-selector-bar"><div className="camera-tabs" aria-label="Chọn camera">{cameras.map((id) => <button key={id} aria-pressed={activeCamera === id} className={activeCamera === id ? "active" : ""} onClick={() => { setCamera(id); setSelectedId(undefined); }}><Camera size={16} />Camera #{id}<small>{data?.slots.filter((s) => s.camera_id === id).length} ô</small></button>)}</div><span>{updatedAt ? `Nhận dữ liệu lúc ${updatedAt.toLocaleTimeString("vi-VN")}` : "Đang chờ dữ liệu bãi đỗ"}</span></div>
    {data ? <><SummaryStrip summary={summarize(slots)} /><div className="operations-layout map-page-layout"><ParkingMap slots={slots} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} /><SlotDetail slot={selected} /></div></> : <EmptyState title={error ? "Chưa kết nối được bãi đỗ" : "Đang tải bản đồ"} text="Bản đồ dùng dữ liệu thật từ hệ thống, không tự thay bằng dữ liệu mẫu." />}
  </AppShell>;
}
