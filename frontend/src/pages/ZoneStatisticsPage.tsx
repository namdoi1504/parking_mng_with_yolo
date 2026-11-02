import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight, Map, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell, EmptyState, SummaryStrip } from "../components";
import { ZoneTable } from "../components/ZoneOverview";
import { buildZones } from "../services/zones";
import { summarize } from "../services/parking";
import { connectionLabels, useParkingMap } from "../hooks/useParkingMap";

export function ZoneStatisticsPage({ viewSwitcher }: { viewSwitcher: ReactNode }) {
  const cameraInputId = useId();
  const navigate = useNavigate();
  const { data, error, busy, load, connection, updatedAt } = useParkingMap();
  const [camera, setCamera] = useState(0);

  const cameras = [...new Set(data?.slots.map((slot) => slot.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : 0;
  const slots = data?.slots.filter((slot) => !activeCamera || slot.camera_id === activeCamera) ?? [];
  const zones = buildZones(slots);

  function handleSelectZone(zoneId: string) {
    navigate(`/map?zone=${encodeURIComponent(zoneId)}`);
  }

  return (
    <AppShell
      title="Thống kê trạng thái hiện tại"
      eyebrow="Thống kê"
      connection={connectionLabels[connection]}
      connectionState={connection}
      actions={
        <div className="zone-stat-top-actions">
          <Link to="/map" className="secondary-button">
            <Map size={16} />
            Mở toàn bộ bản đồ
            <ArrowUpRight size={14} />
          </Link>
          <button className="primary-button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Làm mới
          </button>
        </div>
      }
    >
      {viewSwitcher}
      {error && <div className="error-banner" role="alert">{error}{data && " Đang hiển thị dữ liệu lần tải trước."}</div>}

      <div className="stats-unified-toolbar">
        <div className="stats-control-group">
          <label htmlFor={cameraInputId}>Camera thống kê khu</label>
          <select
            id={cameraInputId}
            value={activeCamera}
            onChange={(e) => {
              setCamera(Number(e.target.value));
            }}
          >
            <option value={0}>Toàn bãi xe</option>
            {cameras.map((id) => (
              <option value={id} key={id}>Camera #{id}</option>
            ))}
          </select>
        </div>

        <div className="stats-live-indicator">
          <span className="live-dot" aria-hidden="true" />
          <span>{updatedAt ? `Nhận dữ liệu lúc ${updatedAt.toLocaleTimeString("vi-VN")}` : "Đang chờ dữ liệu"}</span>
        </div>
      </div>

      {data && (
        <div className="stats-kpi-container">
          <SummaryStrip summary={summarize(slots)} scopeLabel={activeCamera ? `Camera #${activeCamera}` : "Toàn bãi"} />
        </div>
      )}

      <section className="panel zone-overview-card">
        <div className="zone-overview-header">
          <div>
            <h2>So sánh các phân khu</h2>
            <p className="supporting-text">
              Thống kê tình trạng bãi đỗ theo từng phân khu (Khu A1 – D2). Đây là trạng thái hiện tại từ camera AI, tự động cập nhật liên tục theo thời gian thực. Bấm vào bất kỳ khu nào để chuyển sang xem trực tiếp vị trí trên sơ đồ bãi đỗ.
            </p>
          </div>
        </div>

        {zones.length ? (
          <ZoneTable
            zones={zones}
            onSelect={handleSelectZone}
          />
        ) : (
          <EmptyState
            title={error ? "Chưa tải được thống kê" : "Chưa có dữ liệu"}
            text="Các nhóm xuất hiện khi hệ thống có danh sách ô đỗ."
          />
        )}
      </section>
    </AppShell>
  );
}
