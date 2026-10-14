import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch, isDemoMode } from "../api";
import { AppShell, EmptyState, InlineNotice } from "../components";
import { formatTime, SessionDetail, sessionLabels } from "../SessionDetail";
import { useParkingMap } from "../useParkingMap";
import type { Page, ParkingSession } from "../types";

type Filters = { is_active: string; license_plate: string; phone_number: string; parking_slot_id: string; created_from: string; created_to: string };
const blank: Filters = { is_active: "", license_plate: "", phone_number: "", parking_slot_id: "", created_from: "", created_to: "" };
export function SessionsPage() {
  const [draft, setDraft] = useState(blank), [filters, setFilters] = useState(blank);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [selected, setSelected] = useState<number>();
  const [result, setResult] = useState<Page<ParkingSession> | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(""), [validation, setValidation] = useState("");
  const map = useParkingMap();
  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, key.startsWith("created_") ? new Date(value).toISOString() : value.trim());
  const path = `/parking-sessions?${params}`;
  useEffect(() => {
    if (isDemoMode()) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setResult(null);
    if (isDemoMode()) { setResult({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } }); setBusy(false); return; }
    void apiFetch<Page<ParkingSession>>(path, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setResult(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không tải được phiên gửi xe"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, revision, map.sessionRevision]);
  async function reload() { setRevision((value) => value + 1); await map.load(); }
  const selectedSlot = map.data?.slots.find((slot) => slot.active_session_id === selected);
  const slotLabel = (id: number) => map.data?.slots.find((slot) => slot.id === id)?.slot_code ?? `#${id}`;
  function field(key: keyof Filters, value: string) { setDraft((old) => ({ ...old, [key]: value })); }
  function search(event: React.FormEvent) {
    event.preventDefault();
    if (draft.created_from && draft.created_to && new Date(draft.created_to) <= new Date(draft.created_from)) { setValidation("Thời điểm kết thúc phải sau thời điểm bắt đầu."); return; }
    setValidation(""); setFilters({ ...draft }); setPage(1); setSelected(undefined); setRevision((value) => value + 1);
  }
  return <AppShell title="Phiên gửi xe" eyebrow="Vận hành" actions={<button className="secondary-button" disabled={busy} onClick={() => void reload()}><RefreshCw size={17} />Làm mới</button>}>
    <form className="management-toolbar session-filters" onSubmit={search}>
      <label>Trạng thái phiên<select value={draft.is_active} onChange={(e) => field("is_active", e.target.value)}><option value="">Tất cả</option>{Object.entries(sessionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Biển số xe<input maxLength={30} value={draft.license_plate} onChange={(e) => field("license_plate", e.target.value)} /></label>
      <label>Số điện thoại<input type="tel" maxLength={30} value={draft.phone_number} onChange={(e) => field("phone_number", e.target.value)} /></label>
      <label>ID ô đỗ<input type="number" min={1} step={1} value={draft.parking_slot_id} onChange={(e) => field("parking_slot_id", e.target.value)} /></label>
      <label>Tạo từ (giờ địa phương)<input type="datetime-local" value={draft.created_from} onChange={(e) => field("created_from", e.target.value)} /></label>
      <label>Tạo trước (giờ địa phương)<input type="datetime-local" value={draft.created_to} onChange={(e) => field("created_to", e.target.value)} /></label>
      <button className="primary-button" disabled={busy}>Tra cứu phiên</button>
      <button type="button" className="secondary-button" onClick={() => { setDraft(blank); setFilters(blank); setPage(1); setValidation(""); setSelected(undefined); }}>Xóa bộ lọc</button>
    </form>
    <p className="supporting-text">Biển số và số điện thoại được tìm chính xác. Khoảng thời gian lọc theo ngày tạo phiên, không phải ngày xe đến.</p>
    {(error || validation) && <InlineNotice tone="error">{validation || error}</InlineNotice>}
    {map.error && <InlineNotice tone="warning">Chưa tải được trạng thái ô mới nhất. Thao tác kết thúc phiên tạm khóa.</InlineNotice>}
    <div className="operations-layout sessions-layout"><section className="panel data-table-wrap" aria-busy={busy}>
      <div className="panel-title"><span>{result?.meta.total ?? 0} phiên phù hợp</span><small>20 phiên / trang</small></div>
      {busy ? <p role="status">Đang tải danh sách…</p> : result?.data.length ? <div className="session-table-scroll"><table><thead><tr><th>Phiên / ô</th><th>Khách / liên hệ</th><th>Biển số</th><th>Trạng thái</th><th>Tạo phiên lúc</th><th>Chi tiết</th></tr></thead><tbody>{result.data.map((session) => <tr key={session.id}>
        <td>#{session.id}<small> · {slotLabel(session.parking_slot_id)}</small></td><td>{session.customer_name}<small className="session-phone">{session.phone_number}</small></td><td>{session.license_plate}</td><td>{sessionLabels[session.is_active ? "true" : "false"]}</td><td>{formatTime(session.created_at)}</td><td><button className="secondary-button" aria-pressed={selected === session.id} onClick={() => setSelected(session.id)}>Xem #{session.id}</button></td>
      </tr>)}</tbody></table></div> : !error && <EmptyState title="Không có phiên phù hợp" text={isDemoMode() ? "Bản minh họa chưa có dữ liệu lịch sử phiên." : "Thử đổi bộ lọc hoặc tạo phiên từ bản đồ bãi đỗ."} />}
      <div className="pagination"><span>Trang {page}/{Math.max(1, result?.meta.total_pages ?? 1)}</span><button className="secondary-button" disabled={busy || page <= 1} onClick={() => { setPage(page - 1); setSelected(undefined); }}>Trước</button><button className="secondary-button" disabled={busy || !result || page >= result.meta.total_pages} onClick={() => { setPage(page + 1); setSelected(undefined); }}>Sau</button></div>
    </section><aside className="panel inspector">{selected ? <SessionDetail key={selected} sessionId={selected} slot={selectedSlot} sessionRevision={map.sessionRevision} disabled={!!map.error || !!error || busy} onUpdated={map.applySlot} onReload={reload} /> : <EmptyState title="Chọn phiên gửi xe" text="Xem thông tin khách, thời gian và sự kiện; kết thúc phiên khi xe đã rời ô." />}</aside></div>
  </AppShell>;
}
