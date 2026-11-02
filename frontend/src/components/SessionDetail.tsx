import { useEffect, useRef, useState } from "react";
import { apiFetch, isDemoMode } from "../services/api";
import { InlineNotice, statusMeta } from "./components";
import type { Page, ParkingSession, ParkingSlot, SessionEvent } from "../types";

export const sessionLabels = { true: "Đang hoạt động", false: "Đã đóng" };
export function canEndSession(session: ParkingSession, slot?: ParkingSlot) {
  return session.is_active && slot?.observation_ready === true && slot.active_session_id === session.id && slot.status === "RESERVED";
}
export const formatTime = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN") : "Chưa ghi nhận";

export function SessionDetail({ sessionId, slot, disabled = false, sessionRevision = 0, onUpdated, onReload }: {
  sessionId: number; slot?: ParkingSlot; disabled?: boolean; sessionRevision?: number; onUpdated: (slot: ParkingSlot) => void; onReload: () => Promise<void>;
}) {
  const [session, setSession] = useState<ParkingSession | null>(null), [events, setEvents] = useState<Page<SessionEvent> | null>(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState("");
  const inFlight = useRef(false);
  const loadedKey = useRef("");

  useEffect(() => { setPage(1); setNotice(""); }, [sessionId]);
  useEffect(() => {
    if (isDemoMode()) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${sessionId}:${page}`;
    setLoading(loadedKey.current !== key); setError("");
    if (isDemoMode()) { setSession(null); setEvents(null); setLoading(false); return; }
    void Promise.all([
      apiFetch<ParkingSession>(`/parking-sessions/${sessionId}`, { signal: controller.signal }),
      apiFetch<Page<SessionEvent>>(`/parking-sessions/${sessionId}/events?page=${page}&page_size=10`, { signal: controller.signal })
    ]).then(([value, history]) => { if (!controller.signal.aborted) { loadedKey.current = key; setSession(value); setEvents(history); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không tải được phiên gửi xe"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionId, page, revision, sessionRevision, slot?.updated_at, slot?.active_session_id]);

  async function transition(action: "check-out" | "cancel-reservation" | "confirm-arrival") {
    if (inFlight.current || disabled || loading || error || !session || session.id !== sessionId || !slot || !canEndSession(session, slot)) return;
    if (!window.confirm(action === "check-out" ? `Kết thúc phiên #${sessionId}? Camera phải xác nhận ô trống.` : action === "confirm-arrival" ? `Xác nhận xe đến cho phiên #${sessionId}?` : `Hủy giữ chỗ cho phiên #${sessionId}?`)) return;
    inFlight.current = true; setSaving(true); setNotice(""); setActionError("");
    try {
      const updated = await apiFetch<ParkingSlot>(action === "check-out" ? `/parking-sessions/${sessionId}/check-out` : `/parking-slots/${slot.id}/${action}`, { method: "POST" });
      onUpdated(updated); setNotice(action === "check-out" ? "Đã kết thúc phiên gửi xe." : action === "confirm-arrival" ? "Đã xác nhận xe đến." : "Đã hủy giữ chỗ.");
    } catch (reason) { setActionError(`${reason instanceof Error ? reason.message : "Không cập nhật được phiên"}. Đã yêu cầu tải lại trạng thái.`); }
    finally {
      try { await onReload(); } catch { /* Preserve checkout result. */ }
      setRevision((value) => value + 1); inFlight.current = false; setSaving(false);
    }
  }

  const current = session?.id === sessionId ? session : null;
  return <section className="session-detail" aria-label={`Phiên gửi xe ${sessionId}`} aria-busy={loading || saving}>
    <div className="session-detail-header">
      <h3>Phiên #{sessionId}</h3>
      {current && (
        <span className={`status-pill ${current.is_active ? "active" : "closed"}`}>
          <i className="status-dot" />
          {sessionLabels[current.is_active ? "true" : "false"]}
        </span>
      )}
    </div>
    {error && <InlineNotice tone="error">{error}</InlineNotice>}
    {loading ? <p role="status">Đang tải thông tin phiên…</p> : current && !error ? <>
      <dl className="detail-list">
        <div><dt>Khách hàng</dt><dd><b>{current.customer_name}</b></dd></div>
        <div><dt>Điện thoại</dt><dd>{current.phone_number}</dd></div>
        <div><dt>Biển số</dt><dd><span className="plate-badge">{current.license_plate}</span></dd></div>
        <div><dt>Tạo phiên lúc</dt><dd>{formatTime(current.created_at)}</dd></div>
        <div><dt>Người tạo</dt><dd>Tài khoản #{current.created_by}</dd></div>
        {slot?.active_session_id === current.id && slot.reservation_expires_at && <div><dt>Hạn giữ chỗ</dt><dd>{formatTime(slot.reservation_expires_at)}</dd></div>}
      </dl>
      {current.is_active && (
        <div className="session-action-group">
          <button className="primary-button checkout-btn" disabled={disabled || saving || !canEndSession(current, slot)} onClick={() => void transition("check-out")}>
            Kết thúc phiên gửi xe
          </button>
          <div className="secondary-actions">
            <button className="secondary-button" disabled={disabled || saving || !canEndSession(current, slot)} onClick={() => void transition("confirm-arrival")}>
              Xác nhận xe đến
            </button>
            <button className="secondary-button danger-outline" disabled={disabled || saving || !canEndSession(current, slot)} onClick={() => void transition("cancel-reservation")}>
              Hủy giữ chỗ
            </button>
          </div>
          <p className="supporting-text">Camera AI tự nhận diện xe ra/vào. Chỉ kết thúc phiên hoặc hủy khi ô đỗ đã trống.</p>
        </div>
      )}
      <h4>Lịch sử trạng thái</h4>
      {events?.data.length ? <ol className="session-events">{events.data.map((event) => <li key={event.id}><time>{formatTime(event.event_time)}</time><span>{statusMeta[event.old_status ?? "UNINITIALIZED"].label} → {statusMeta[event.new_status].label}</span><small>Nguồn: {event.source}</small></li>)}</ol> : <p className="supporting-text">Chưa có sự kiện đổi trạng thái ô.</p>}
      {events && events.meta.total_pages > 1 && <div className="pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sự kiện trước</button><span>{page}/{events.meta.total_pages}</span><button className="secondary-button" disabled={page >= events.meta.total_pages} onClick={() => setPage(page + 1)}>Sự kiện sau</button></div>}
    </> : isDemoMode() ? <p className="supporting-text">Dữ liệu phiên không có trong bản minh họa.</p> : null}
    {actionError && <InlineNotice tone="error">{actionError}</InlineNotice>}
    {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
    <button className="secondary-button refresh-session-btn" disabled={loading || saving} onClick={() => setRevision((value) => value + 1)}>Tải lại phiên</button>
  </section>;
}
