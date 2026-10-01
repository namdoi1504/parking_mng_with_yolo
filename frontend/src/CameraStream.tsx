import { useEffect, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { ConnectionBadge, EmptyState } from "./components";

interface StreamStatus {
  camera_id: number; source_name: string; ready: boolean; running: boolean;
  frame_id: number; frame_age_seconds: number | null; updated_at: number | null;
  fps: number; media_seconds: number; occupied: number; empty: number;
  sync_ok: boolean | null; sync_at: number | null;
  video_fps?: number; analysis_age_ms?: number | null; analysis_stale?: boolean;
}

export function CameraStream({ cameraId }: { cameraId: number }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const response = await fetch("/ai-stream/status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (!response.ok) throw new Error("Stream unavailable");
        const result: StreamStatus = await response.json();
        if (!controller.signal.aborted) { setStatus(result); setOffline(false); }
      } catch { if (!controller.signal.aborted) setOffline(true); }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(poll, 2000); }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, []);
  const matches = !!status && (!cameraId || cameraId === status.camera_id);
  const active = !offline && matches && !!status?.running && !!status.ready && (status.frame_age_seconds ?? Infinity) < 10;
  useEffect(() => {
    if (!imageError || !active) return;
    const timer = window.setTimeout(() => { setAttempt((old) => old + 1); setImageError(false); }, 3000);
    return () => window.clearTimeout(timer);
  }, [imageError, active]);
  const live = active && !imageError;
  const synced = status?.sync_ok && status.sync_at != null && Date.now() / 1000 - status.sync_at < 30;
  const label = live ? status?.analysis_stale ? "Video đang chạy · kết quả AI chưa cập nhật" : "Đang nhận hình AI" : offline || imageError ? "Luồng hình mất kết nối" : status && !matches ? "Camera này chưa có luồng hình" : "Đang chờ khung hình AI";
  return <section className="panel ai-video-panel" aria-label="Video đã xử lý AI">
    <div className="panel-title"><span><Camera size={19} />Video nhận diện · {status && matches ? `Camera #${status.camera_id}` : "AI"}</span><ConnectionBadge state={live && !status?.analysis_stale ? "connected" : offline || imageError ? "disconnected" : "connecting"} label={label} /></div>
    <div className={`ai-video-stage ${!live ? "stale" : ""}`}>
      {!offline && matches && status?.ready && !imageError ? <img key={attempt} src={`/ai-stream/video?attempt=${attempt}`} alt="Khung hình video sau khi YOLO nhận diện xe và tô màu trạng thái các ô đỗ" onError={() => setImageError(true)} /> : <EmptyState title={label} text="Chạy parking_agent.py với --stream --no-window để phát hình đã xử lý." />}
      {!live && status?.ready && matches && !offline && !imageError && <span className="video-stale-label">Khung hình cũ · chưa nhận được cập nhật mới</span>}
    </div>
    <div className="video-meta"><span>Nguồn: {matches ? status?.source_name : "—"} · video mẫu lặp lại</span><span>{live ? `${status?.video_fps != null ? `${status.video_fps} FPS video · ` : ""}${status?.fps} FPS AI · ${status?.analysis_age_ms != null ? `${Math.round(status.analysis_age_ms)} ms tuổi kết quả · ` : ""}${status?.media_seconds.toFixed(1)}s trong video` : "Không phát video giả khi AI ngừng hoạt động"}</span><button className="secondary-button" onClick={() => { setAttempt((old) => old + 1); setImageError(false); }}><RefreshCw size={14} />Nối lại hình</button></div>
    {matches && status?.ready && <div className="video-counts"><span><i className="video-dot empty" />Trống trên hình: <b>{status.analysis_stale ? "—" : status.empty}</b></span><span><i className="video-dot occupied" />Đã đỗ trên hình: <b>{status.analysis_stale ? "—" : status.occupied}</b></span><span className={synced ? "text-EMPTY" : "video-sync-warning"}>{synced ? "Đã gửi trạng thái về hệ thống" : "Chưa xác nhận đồng bộ trạng thái"}</span></div>}
    <p className="supporting-text">Video chạy độc lập; lớp phủ dùng kết quả AI gần nhất và có độ trễ theo tuổi kết quả hiển thị. Khi AI quá 2 giây không cập nhật, màu trạng thái được chuyển sang chưa xác định. Danh sách ô phía dưới cập nhật qua backend theo chu kỳ gửi 3 giây và độ trễ mạng.</p>
  </section>;
}
