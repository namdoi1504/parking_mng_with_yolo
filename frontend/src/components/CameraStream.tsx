import { memo, useEffect, useRef, useState } from "react";
import { Camera, FastForward, Loader2, Pause, Play, RefreshCw, Rewind, RotateCcw } from "lucide-react";
import { ConnectionBadge, EmptyState } from ".";
import { apiFetch, apiResponse, getClaims } from "../services/api";
import { receiveMjpeg } from "../services/mjpeg";
import { isScenarioMode } from "../services/scenarioMode";

interface StreamStatus {
  camera_id: number;
  source_name: string;
  ready: boolean;
  running: boolean;
  frame_id: number;
  frame_age_seconds: number | null;
  updated_at: number | null;
  fps: number;
  media_seconds: number;
  occupied: number;
  empty: number;
  sync_ok: boolean | null;
  sync_at: number | null;
  video_fps?: number;
  analysis_age_ms?: number | null;
  analysis_stale?: boolean;
  duration_seconds?: number;
  total_frames?: number;
  source_fps?: number;
  control_enabled?: boolean;
  playback_state?: "playing" | "pausing" | "paused" | "seeking";
  paused_at?: string | null;
  resumed_at?: string | null;
  demo_clock?: {
    enabled: boolean;
    paused: boolean;
    healthy: boolean;
    business_time: string;
    wall_time: string;
    seeking: boolean;
  };
}

function formatTime(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const CameraStream = memo(function CameraStream({ cameraId }: { cameraId: number }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);
  const image = useRef<HTMLImageElement>(null);

  // Playback control states
  const [controlBusy, setControlBusy] = useState(false);
  const [seekingSeconds, setSeekingSeconds] = useState<number | null>(null);
  const [controlMessage, setControlMessage] = useState<string | null>(null);

  const claims = getClaims();
  const isAdmin = claims?.role === "Administrator" || isScenarioMode();
  const canControl = isAdmin && !!status?.control_enabled;
  const isPaused = status?.playback_state === "paused" || !!status?.demo_clock?.paused;
  const isSeeking = status?.playback_state === "seeking" || !!status?.demo_clock?.seeking;
  const controlsDisabled = controlBusy || !canControl || offline || !status?.ready;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const result = await apiFetch<StreamStatus>("/ai-stream/status", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
        });
        if (!controller.signal.aborted) {
          setStatus(result);
          setOffline(false);
        }
      } catch {
        if (!controller.signal.aborted) setOffline(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const matches = !!status && (!cameraId || cameraId === status.camera_id);
  const active = !offline && matches && !!status?.running && !!status.ready && (isPaused || (status.frame_age_seconds ?? Infinity) < 10);
  const canStream = !offline && matches && !!status?.running && !!status.ready;

  useEffect(() => {
    if (!canStream) return;
    const controller = new AbortController();
    let objectUrl = "";
    let firstFrame = true;
    let timer: number;
    async function connect() {
      const transport = new AbortController();
      let watchdog = window.setTimeout(() => transport.abort(), 10000);
      try {
        const response = await apiResponse("/ai-stream/video", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, transport.signal])
        });
        await receiveMjpeg(response, (frame) => {
          if (controller.signal.aborted) return;
          window.clearTimeout(watchdog);
          watchdog = window.setTimeout(() => transport.abort(), 10000);
          const next = URL.createObjectURL(new Blob([new Uint8Array(frame).buffer], { type: "image/jpeg" }));
          const previous = objectUrl;
          objectUrl = next;
          if (image.current) image.current.src = next;
          if (firstFrame) {
            firstFrame = false;
            setHasFrame(true);
          }
          if (previous) URL.revokeObjectURL(previous);
        });
        if (!controller.signal.aborted) timer = window.setTimeout(connect, 250);
      } catch {
        if (!controller.signal.aborted) setImageError(true);
      } finally {
        window.clearTimeout(watchdog);
      }
    }
    setImageError(false);
    void connect();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setHasFrame(false);
    };
  }, [canStream, attempt]);

  useEffect(() => {
    if (!imageError || !active) return;
    const timer = window.setTimeout(() => {
      setAttempt((old) => old + 1);
      setImageError(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [imageError, active]);

  const live = active && hasFrame && !imageError;
  const currentCounts = (live || isPaused) && !status?.analysis_stale;
  const synced = currentCounts && status?.sync_ok && status.sync_at != null && Date.now() / 1000 - status.sync_at < 30;
  const label = isPaused
    ? "Video đang tạm dừng (Đóng băng trạng thái)"
    : live
    ? status?.analysis_stale
      ? "Video đang chạy · kết quả AI chưa cập nhật"
      : "Đang nhận hình AI"
    : offline || imageError
    ? "Luồng hình mất kết nối"
    : status && !matches
    ? "Camera này chưa có luồng hình"
    : "Đang chờ khung hình AI";

  const currentSeconds = status?.media_seconds ?? 0;
  const durationSeconds = status?.duration_seconds ?? 73.64;
  const displaySeconds = seekingSeconds ?? currentSeconds;

  async function handleTogglePlayback() {
    if (controlBusy) return;
    setControlBusy(true);
    setControlMessage(null);
    try {
      if (isPaused) {
        await apiFetch("/api/video-demo/resume", { method: "POST" });
        setControlMessage("Đã tiếp tục phát video");
      } else {
        await apiFetch("/api/video-demo/pause", { method: "POST" });
        setControlMessage("Đã tạm dừng video");
      }
      const refreshed = await apiFetch<StreamStatus>("/ai-stream/status", { cache: "no-store" });
      setStatus(refreshed);
    } catch (err) {
      setControlMessage(`Thao tác thất bại: ${err instanceof Error ? err.message : "Lỗi kết nối"}`);
    } finally {
      setControlBusy(false);
    }
  }

  async function handleSeek(targetSeconds: number) {
    if (controlBusy) return;
    const maxSec = status?.duration_seconds ?? 73.64;
    const clamped = Math.max(0, Math.min(targetSeconds, maxSec));
    setControlBusy(true);
    setControlMessage(`Đang tua đến ${formatTime(clamped)}...`);
    try {
      await apiFetch("/api/video-demo/seek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: clamped, request_id: generateRequestId() })
      });
      setControlMessage(`Đã tua đến ${formatTime(clamped)} (Hệ thống đã reset đồng bộ lại ô đỗ)`);
      const refreshed = await apiFetch<StreamStatus>("/ai-stream/status", { cache: "no-store" });
      setStatus(refreshed);
    } catch (err) {
      setControlMessage(`Tua video thất bại: ${err instanceof Error ? err.message : "Lỗi kết nối"}`);
    } finally {
      setControlBusy(false);
      setSeekingSeconds(null);
    }
  }

  return (
    <section className="panel ai-video-panel" aria-label="Video đã xử lý AI">
      <div className="panel-title">
        <span>
          <Camera size={19} />
          {isScenarioMode() ? "Khung tín hiệu mô phỏng" : "Video nhận diện"} · {status && matches ? `Camera #${status.camera_id}` : "AI"}
        </span>
        <ConnectionBadge
          state={isPaused ? "connected" : live && !status?.analysis_stale ? "connected" : offline || imageError ? "disconnected" : "connecting"}
          label={label}
        />
      </div>

      <div className={`ai-video-stage ${!live ? "stale" : ""}`}>
        {canStream && (
          <img
            ref={image}
            style={{ display: hasFrame && !imageError ? undefined : "none" }}
            alt={
              isScenarioMode()
                ? "Khung hình mô phỏng tín hiệu AI trên sơ đồ bãi đỗ, không phải nhận diện YOLO từ video"
                : "Khung hình video sau khi YOLO nhận diện xe và tô màu trạng thái các ô đỗ"
            }
            onError={() => setImageError(true)}
          />
        )}
        {(!canStream || !hasFrame || imageError) && (
          <EmptyState title={label} text="Chưa nhận được hình từ camera. Thử nối lại hoặc kiểm tra nguồn hình." />
        )}
        {!live && !isPaused && hasFrame && matches && !offline && !imageError && (
          <span className="video-stale-label">Khung hình cũ · chưa nhận được cập nhật mới</span>
        )}
      </div>

      {/* VIDEO DEMO CONTROLS (PAUSE / RESUME / SEEK) */}
      {canControl && matches && (
        <div className="video-player-bar" aria-label="Điều khiển video demo">
          <div className="video-player-timeline">
            <span className="video-player-time">{formatTime(displaySeconds)}</span>
            <input
              type="range"
              className="video-player-slider"
              min={0}
              max={durationSeconds}
              step={0.5}
              value={displaySeconds}
              disabled={controlsDisabled}
              onChange={(e) => setSeekingSeconds(Number(e.target.value))}
              onMouseUp={(e) => handleSeek(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => handleSeek(Number((e.target as HTMLInputElement).value))}
              aria-label="Thanh tua thời gian video"
            />
            <span className="video-player-time">{formatTime(durationSeconds)}</span>
          </div>

          <div className="video-player-controls">
            <div className="video-player-main-actions">
              <button
                type="button"
                className="video-player-btn primary"
                disabled={controlsDisabled}
                onClick={handleTogglePlayback}
                aria-label={isPaused ? "Tiếp tục phát video" : "Tạm dừng video"}
              >
                {controlBusy ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : isPaused ? (
                  <Play size={15} aria-hidden="true" />
                ) : (
                  <Pause size={15} aria-hidden="true" />
                )}
                <span>{controlBusy ? "Đang xử lý…" : isPaused ? "Tiếp tục" : "Tạm dừng"}</span>
              </button>

              <button
                type="button"
                className="video-player-btn"
                disabled={controlsDisabled}
                onClick={() => handleSeek(currentSeconds - 10)}
                title="Tua lùi 10 giây"
              >
                <Rewind size={14} aria-hidden="true" />
                <span>-10s</span>
              </button>

              <button
                type="button"
                className="video-player-btn"
                disabled={controlsDisabled}
                onClick={() => handleSeek(currentSeconds + 10)}
                title="Tua tới 10 giây"
              >
                <FastForward size={14} aria-hidden="true" />
                <span>+10s</span>
              </button>

              <button
                type="button"
                className="video-player-btn"
                disabled={controlsDisabled}
                onClick={() => handleSeek(0)}
                title="Tua về đầu video (00:00)"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Về đầu</span>
              </button>
            </div>

            <div className="video-player-status-group">
              <span className={`video-player-badge ${isSeeking ? "seeking" : isPaused ? "paused" : "live"}`}>
                <span className="live-dot" aria-hidden="true" />
                {isSeeking ? "Đang tua" : isPaused ? "Đang dừng" : "Đang phát live"}
              </span>
            </div>
          </div>

          {controlMessage && (
            <div className="video-player-feedback" role="status">
              {controlMessage}
            </div>
          )}
        </div>
      )}

      <div className="video-meta">
        <span>
          Nguồn: {matches ? status?.source_name : "—"} ·{" "}
          {isScenarioMode() ? "khung hình từ tín hiệu demo" : "video mẫu lặp lại"}
        </span>
        <span>
          {live
            ? isScenarioMode()
              ? "MJPEG mô phỏng · không nhận diện từ video"
              : `${status?.video_fps != null ? `${status.video_fps} FPS video · ` : ""}${status?.fps} FPS AI · ${
                  status?.analysis_age_ms != null ? `${Math.round(status.analysis_age_ms)} ms tuổi kết quả · ` : ""
                }${status?.media_seconds.toFixed(1)}s trong video`
            : "Không phát video giả khi AI ngừng hoạt động"}
        </span>
        <button
          className="secondary-button"
          onClick={() => {
            setAttempt((old) => old + 1);
            setImageError(false);
          }}
        >
          <RefreshCw size={14} />
          Nối lại hình
        </button>
      </div>

      {matches && status?.ready && (
        <div className="video-counts">
          <span>
            <i className="video-dot empty" />
            Trống trên hình: <b>{currentCounts ? status.empty : "—"}</b>
          </span>
          <span>
            <i className="video-dot occupied" />
            Đã đỗ trên hình: <b>{currentCounts ? status.occupied : "—"}</b>
          </span>
          <span className={synced ? "text-EMPTY" : "video-sync-warning"}>
            {synced ? "Đã gửi trạng thái về hệ thống" : "Chưa xác nhận đồng bộ trạng thái"}
          </span>
        </div>
      )}

      <details className="video-details">
        <summary>Thông tin luồng và đồng bộ</summary>
        <p className="supporting-text">
          Video đếm xe có mặt / ô trống từ nhận diện, không xác định khách hoặc phiên gửi xe. Bản đồ dùng trạng thái nghiệp vụ do backend đối chiếu với phiên: trống, đã đỗ, giữ chỗ, xe chưa đăng ký; ô chưa có quan sát hiển thị chờ nhận diện. Khi AI quá 2 giây không cập nhật, số đếm trên hình được ẩn. AI gửi quan sát ổn định mỗi 3 giây, giao diện tải bản đồ mỗi 5 giây.
        </p>
      </details>
    </section>
  );
});
