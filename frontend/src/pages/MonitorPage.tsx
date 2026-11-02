import { useState } from "react";
import { ArrowUpRight, Camera, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { AppShell, EmptyState, statusMeta, SummaryStrip } from "../components";
import { CameraStream } from "../components/CameraStream";
import { summarize } from "../services/parking";
import { connectionLabels, useParkingMap } from "../hooks/useParkingMap";
import { workspacePath } from "../services/scenarioMode";

export function MonitorPage() {
  const { data, error, busy, load, connection, events } = useParkingMap();
  const [camera, setCamera] = useState(0);
  const [eventPage, setEventPage] = useState(0);

  const cameras = [...new Set(data?.slots.map((slot) => slot.camera_id))].sort((a, b) => a - b);
  const activeCamera = cameras.includes(camera) ? camera : cameras[0] ?? 0;
  const slots = data?.slots.filter((s) => s.camera_id === activeCamera) ?? [];
  const scopedEvents = events.filter((event) => event.camera === activeCamera);

  const EVENTS_PER_PAGE = 8;
  const totalEventPages = Math.max(1, Math.ceil(scopedEvents.length / EVENTS_PER_PAGE));
  const currentEventPage = Math.min(eventPage, totalEventPages - 1);
  const pagedEvents = scopedEvents.slice(currentEventPage * EVENTS_PER_PAGE, (currentEventPage + 1) * EVENTS_PER_PAGE);

  return (
    <AppShell
      title="Trung tâm giám sát"
      eyebrow="Vận hành"
      connection={connectionLabels[connection]}
      connectionState={connection}
      actions={
        <div className="monitor-top-actions">
          <Link className="secondary-button" to={workspacePath("/map")}>
            Mở bản đồ
            <ArrowUpRight size={17} />
          </Link>
          <button className="primary-button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={17} />
            Làm mới
          </button>
        </div>
      }
    >
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {data && " Đang hiển thị dữ liệu lần tải trước."}
        </div>
      )}

      {/* INTEGRATED MONITOR CONTROL BAR */}
      <div className="monitor-hub-bar">
        <div className="camera-tabs" aria-label="Camera giám sát">
          {cameras.map((id) => (
            <button
              key={id}
              aria-pressed={activeCamera === id}
              className={activeCamera === id ? "active" : ""}
              onClick={() => {
                setCamera(id);
                setEventPage(0);
              }}
            >
              <Camera size={15} />
              Camera #{id}
            </button>
          ))}
        </div>
      </div>

      {data && <SummaryStrip summary={summarize(slots)} scopeLabel={`Camera #${activeCamera}`} />}

      {/* VIDEO & LIVE ACTIVITY STAGE */}
      <div className="monitor-workspace-stage">
        <div className="monitor-video-container">
          <CameraStream cameraId={activeCamera} />
        </div>

        <section className="panel live-activity-panel">
          <div className="panel-title">
            <span>Thay đổi quan sát được</span>
            <span className="count-pill">{scopedEvents.length}</span>
          </div>
          <p className="supporting-text">Ghi nhận biến động trạng thái ô đỗ theo thời gian thực.</p>
          {scopedEvents.length ? (
            <>
              <div className="activity-list">
                {pagedEvents.map((event, i) => (
                  <div key={i} className="activity-item">
                    <time>{new Date(event.time).toLocaleTimeString("vi-VN")}</time>
                    <span className="slot-badge">Ô {event.code}</span>
                    <span className={`status-pill status-${event.status}`}>
                      <i className="status-dot" />
                      {statusMeta[event.status ?? "UNINITIALIZED"].label}
                    </span>
                  </div>
                ))}
              </div>
              {totalEventPages > 1 && (
                <div className="activity-pagination">
                  <button
                    type="button"
                    className="secondary-button activity-page-btn"
                    disabled={currentEventPage === 0}
                    onClick={() => setEventPage((p) => Math.max(0, p - 1))}
                    aria-label="Trang trước"
                  >
                    <ChevronLeft size={14} /> Trước
                  </button>
                  <span className="activity-page-info">
                    {currentEventPage + 1} / {totalEventPages}
                  </span>
                  <button
                    type="button"
                    className="secondary-button activity-page-btn"
                    disabled={currentEventPage >= totalEventPages - 1}
                    onClick={() => setEventPage((p) => Math.min(totalEventPages - 1, p + 1))}
                    aria-label="Trang sau"
                  >
                    Sau <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="Chưa thấy thay đổi trạng thái"
              text="Các thay đổi xuất hiện khi lần tải sau khác với lần tải trước."
            />
          )}
        </section>
      </div>

      {!data && (
        <section className="panel">
          <EmptyState
            title="Đang chờ dữ liệu trạng thái"
            text="Video vẫn có thể hoạt động khi backend chưa kết nối."
          />
        </section>
      )}
    </AppShell>
  );
}
