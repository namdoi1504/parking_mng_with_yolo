import { useState } from "react";
import { ArrowUpRight, Camera, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { AppShell, EmptyState, statusMeta, SummaryStrip } from "../components";
import { CameraStream } from "../CameraStream";
import { ParkingMap, SlotDetail } from "../ParkingMap";
import { summarize } from "../parking";
import { connectionLabels, useParkingMap } from "../useParkingMap";

export function MonitorPage() {
  const { data, error, busy, load, connection, events } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const cameras = [...new Set(data?.slots.map((slot) => slot.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : cameras[0] ?? 0;
  const slots = data?.slots.filter((s) => s.camera_id === activeCamera) ?? [];
  const selected = slots.find((s) => s.id === selectedId);
  return <AppShell title="Trung tâm giám sát" eyebrow="Vận hành" connection={connectionLabels[connection]} connectionState={connection}
    actions={<><Link className="secondary-button" to="/map">Mở bản đồ<ArrowUpRight size={17} /></Link><button className="primary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={17} />{busy ? "Đang tải…" : "Làm mới"}</button></>}>
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}
    {data && <SummaryStrip summary={summarize(slots)} />}
    <div className="camera-selector-bar"><div className="camera-tabs" aria-label="Camera giám sát">{cameras.map((id) => <button key={id} aria-pressed={activeCamera === id} className={activeCamera === id ? "active" : ""} onClick={() => { setCamera(id); setSelectedId(undefined); }}><Camera size={16} />Camera #{id}</button>)}</div><span>Video AI và đồng bộ dữ liệu được theo dõi riêng</span></div>
    <div className="monitor-workspace"><CameraStream cameraId={activeCamera} /><section className="panel live-activity"><div className="panel-title"><span>Thay đổi quan sát được</span><small>{events.length} thay đổi</small></div><p className="supporting-text">So sánh dữ liệu mỗi 5 giây. Giờ hiển thị là lúc ghi nhận; có thể bỏ lỡ biến động giữa hai lần tải.</p>{events.length ? <div className="activity-list">{events.filter((e) => !e.camera || !activeCamera || e.camera === activeCamera).map((event, i) => <div key={i}><time>{new Date(event.time).toLocaleTimeString("vi-VN")}</time><b>Ô {event.code}</b><span className={`text-${event.status}`}>{statusMeta[event.status].label}</span></div>)}</div> : <EmptyState title="Chưa thấy thay đổi trạng thái" text="Các thay đổi xuất hiện khi lần tải sau khác với lần tải trước, không phải lịch sử sự kiện đầy đủ." />}</section></div>
    {data ? <div className="operations-layout"><ParkingMap compact slots={slots} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} /><SlotDetail slot={selected} /></div> : <section className="panel"><EmptyState title="Bản đồ đang chờ dữ liệu" text="Video vẫn có thể hoạt động khi backend chưa kết nối." /></section>}
  </AppShell>;
}
