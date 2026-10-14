import { useId, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell, EmptyState, SummaryStrip } from "../components";
import { ZoneTable } from "../ZoneOverview";
import { buildAxisGroups, buildZones } from "../zones";
import { summarize } from "../parking";
import { connectionLabels, useParkingMap } from "../useParkingMap";

export function ZoneStatisticsPage({ viewSwitcher }: { viewSwitcher: ReactNode }) {
  const cameraInputId = useId();
  const { data, error, busy, load, connection, updatedAt } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [groupBy, setGroupBy] = useState<"zone" | "col" | "row">("zone");
  const groupInputId = useId();
  const cameras = [...new Set(data?.slots.map((slot) => slot.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : 0;
  const slots = data?.slots.filter((slot) => !activeCamera || slot.camera_id === activeCamera) ?? [];
  const zones = groupBy === "zone" ? buildZones(slots) : buildAxisGroups(slots, groupBy);
  return <AppShell title="Thống kê trạng thái hiện tại" eyebrow="Thống kê" connection={connectionLabels[connection]} connectionState={connection}
    actions={<button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={17} />Làm mới</button>}>
    {viewSwitcher}
    {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}
    <div className="management-toolbar zone-toolbar"><div className="zone-picker"><label htmlFor={cameraInputId}>Camera thống kê khu</label><select id={cameraInputId} value={activeCamera} onChange={(e) => setCamera(Number(e.target.value))}><option value={0}>Toàn bãi</option>{cameras.map((id) => <option value={id} key={id}>Camera #{id}</option>)}</select></div><span className="supporting-text">{updatedAt ? `Nhận dữ liệu lúc ${updatedAt.toLocaleTimeString("vi-VN")}` : "Đang chờ dữ liệu"}</span></div>
    {data && <SummaryStrip summary={summarize(slots)} scopeLabel={activeCamera ? `Camera #${activeCamera}` : "Toàn bãi"} />}
    <div className="management-toolbar zone-toolbar"><label htmlFor={groupInputId}>Thống kê theo</label><select id={groupInputId} value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}><option value="zone">Khu</option><option value="col">Cột (col)</option><option value="row">Hàng (row)</option></select></div>
    <section className="panel zone-overview"><h2>So sánh {groupBy === "zone" ? "các khu" : groupBy === "col" ? "các cột" : "các hàng"}</h2><p className="supporting-text">{groupBy === "zone" ? "Bãi đã hiệu chỉnh ghép hai dãy hai bên cùng đảo cây thành một khu; dãy mép và cụm cổng tách riêng. " : "Nhóm theo giá trị tọa độ backend, giữ nguyên chỉ số bắt đầu từ 0 và tách riêng từng camera. "}Đây là trạng thái hiện tại, nhận cập nhật trực tiếp khi có quyền và lấy snapshot dự phòng mỗi 5 giây. Tỷ lệ có xe tính cả xe chưa đăng ký; ô trống chỉ có thể giữ chỗ khi quan sát AI còn hiệu lực.</p>
      {zones.length ? <ZoneTable zones={zones} axis={groupBy === "zone" ? undefined : groupBy} /> : <EmptyState title={error ? "Chưa tải được thống kê" : "Chưa có dữ liệu"} text="Các nhóm xuất hiện khi hệ thống có danh sách ô đỗ." />}
    </section>
  </AppShell>;
}
