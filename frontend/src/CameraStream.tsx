import { memo, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { ConnectionBadge, EmptyState } from "./components";
import { apiFetch, apiResponse } from "./api";
import { receiveMjpeg } from "./mjpeg";

interface StreamStatus {
  camera_id: number; source_name: string; ready: boolean; running: boolean;
  frame_id: number; frame_age_seconds: number | null; updated_at: number | null;
  fps: number; media_seconds: number; occupied: number; empty: number;
  sync_ok: boolean | null; sync_at: number | null;
  video_fps?: number; analysis_age_ms?: number | null; analysis_stale?: boolean;
}

export const CameraStream = memo(function CameraStream({ cameraId }: { cameraId: number }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const result = await apiFetch<StreamStatus>("/ai-stream/status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (!controller.signal.aborted) { setStatus(result); setOffline(false); }
      } catch { if (!controller.signal.aborted) setOffline(true); }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(poll, 2000); }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, []);
  const matches = !!status && (!cameraId || cameraId === status.camera_id);
  const active = !offline && matches && !!status?.running && !!status.ready && (status.frame_age_seconds ?? Infinity) < 10;
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
          cache: "no-store", signal: AbortSignal.any([controller.signal, transport.signal])
        });
        await receiveMjpeg(response, (frame) => {
          if (controller.signal.aborted) return;
          window.clearTimeout(watchdog);
          watchdog = window.setTimeout(() => transport.abort(), 10000);
          const next = URL.createObjectURL(new Blob([new Uint8Array(frame).buffer], { type: "image/jpeg" }));
          const previous = objectUrl;
          objectUrl = next;
          // Frames are transport updates, not React UI state. Keep metadata at 2s.
          if (image.current) image.current.src = next;
          if (firstFrame) { firstFrame = false; setHasFrame(true); }
          if (previous) URL.revokeObjectURL(previous);
        });
        if (!controller.signal.aborted) timer = window.setTimeout(connect, 250);
      } catch {
        if (!controller.signal.aborted) setImageError(true);
      } finally { window.clearTimeout(watchdog); }
    }
    setImageError(false);
    void connect();
    return () => {
      controller.abort(); window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setHasFrame(false);
    };
  }, [canStream, attempt]);
  useEffect(() => {
    if (!imageError || !active) return;
    const timer = window.setTimeout(() => { setAttempt((old) => old + 1); setImageError(false); }, 3000);
    return () => window.clearTimeout(timer);
  }, [imageError, active]);
  const live = active && hasFrame && !imageError;
  const currentCounts = live && !status?.analysis_stale;
  const synced = currentCounts && status?.sync_ok && status.sync_at != null && Date.now() / 1000 - status.sync_at < 30;
  const label = live ? status?.analysis_stale ? "Video đang chạy · kết quả AI chưa cập nhật" : "Đang nhận hình AI" : offline || imageError ? "Luồng hình mất kết nối" : status && !matches ? "Camera này chưa có luồng hình" : "Đang chờ khung hình AI";
  return <section className="panel ai-video-panel" aria-label="Video đã xử lý AI">
    <div className="panel-title"><span><Camera size={19} />Video nhận diện · {status && matches ? `Camera #${status.camera_id}` : "AI"}</span><ConnectionBadge state={live && !status?.analysis_stale ? "connected" : offline || imageError ? "disconnected" : "connecting"} label={label} /></div>
    <div className={`ai-video-stage ${!live ? "stale" : ""}`}>
      {canStream && <img ref={image} style={{ display: hasFrame && !imageError ? undefined : "none" }} alt="Khung hình video sau khi YOLO nhận diện xe và tô màu trạng thái các ô đỗ" onError={() => setImageError(true)} />}
      {(!canStream || !hasFrame || imageError) && <EmptyState title={label} text="Chưa nhận được hình từ camera. Thử nối lại hoặc kiểm tra nguồn hình." />}
      {!live && hasFrame && matches && !offline && !imageError && <span className="video-stale-label">Khung hình cũ · chưa nhận được cập nhật mới</span>}
    </div>
    <div className="video-meta"><span>Nguồn: {matches ? status?.source_name : "—"} · video mẫu lặp lại</span><span>{live ? `${status?.video_fps != null ? `${status.video_fps} FPS video · ` : ""}${status?.fps} FPS AI · ${status?.analysis_age_ms != null ? `${Math.round(status.analysis_age_ms)} ms tuổi kết quả · ` : ""}${status?.media_seconds.toFixed(1)}s trong video` : "Không phát video giả khi AI ngừng hoạt động"}</span><button className="secondary-button" onClick={() => { setAttempt((old) => old + 1); setImageError(false); }}><RefreshCw size={14} />Nối lại hình</button></div>
    {matches && status?.ready && <div className="video-counts"><span><i className="video-dot empty" />Trống trên hình: <b>{currentCounts ? status.empty : "—"}</b></span><span><i className="video-dot occupied" />Đã đỗ trên hình: <b>{currentCounts ? status.occupied : "—"}</b></span><span className={synced ? "text-EMPTY" : "video-sync-warning"}>{synced ? "Đã gửi trạng thái về hệ thống" : "Chưa xác nhận đồng bộ trạng thái"}</span></div>}
    <details className="video-details"><summary>Thông tin luồng và đồng bộ</summary><p className="supporting-text">Video dùng kết quả AI gần nhất. Khi AI quá 2 giây không cập nhật, màu trạng thái chuyển sang chưa xác định. Danh sách ô cập nhật qua backend theo chu kỳ gửi 3 giây và độ trễ mạng. Nếu mất hình, quản trị viên kiểm tra nguồn camera và tiến trình parking_agent.py với --stream --no-window.</p></details>
  </section>;
});
