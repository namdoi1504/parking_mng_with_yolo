import { useId, useRef, useState } from "react";
import { apiFetch, getClaims, isDemoMode } from "./api";
import { InlineNotice } from "./components";
import { isAvailable } from "./parking";
import { SessionDetail } from "./SessionDetail";
import type { ParkingCustomer, ParkingSlot } from "./types";

type Action = "reserve" | "check-in" | "cancel-reservation" | "reconcile";
const labels: Record<Action, string> = { reserve: "Giữ chỗ", "check-in": "Đăng ký xe đang đỗ", "cancel-reservation": "Hủy giữ chỗ", reconcile: "Đối soát ô cũ" };

export function ReservationActions({ slot, onUpdated, onReload, disabled = false, sessionRevision = 0 }: {
  slot: ParkingSlot; onUpdated: (slot: ParkingSlot) => void; onReload: () => Promise<void>; disabled?: boolean; sessionRevision?: number;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [failed, setFailed] = useState(false);
  const [customer, setCustomer] = useState<ParkingCustomer>({ customer_name: "", phone_number: "", license_plate: "" });
  const inFlight = useRef(false);
  if (!isDemoMode() && getClaims()?.role !== "Administrator") return null;
  const blocked = busy || disabled || slot.observation_ready !== true;
  const customerAction = isAvailable(slot) ? "reserve" : !slot.active_session_id && (slot.status === "UNKNOWN" || slot.needs_reconciliation) ? "check-in" : null;
  async function transition(action: Action) {
    if (inFlight.current || blocked) return;
    if (isDemoMode()) { setFailed(false); setNotice("Bản xem giao diện không thay đổi dữ liệu hệ thống."); return; }
    if (!window.confirm(`${labels[action]} cho ô ${slot.slot_code}?`)) return;
    let body: string | undefined;
    if (action === "reserve" || action === "check-in") {
      body = JSON.stringify({ customer_name: customer.customer_name.trim(), phone_number: customer.phone_number.trim(), license_plate: customer.license_plate.trim() });
    }
    inFlight.current = true; setBusy(true); setNotice(""); setFailed(false);
    try {
      const updated = await apiFetch<ParkingSlot>(`/parking-slots/${slot.id}/${action}`, { method: "POST", ...(body ? { body } : {}) });
      onUpdated(updated); setNotice(`Đã ${labels[action].toLowerCase()} cho ô ${slot.slot_code}.`);
    } catch (reason) {
      setFailed(true); setNotice(`${reason instanceof Error ? reason.message : "Không cập nhật được ô đỗ"}. Đang tải lại trạng thái mới nhất.`);
      try { await onReload(); } catch { /* Keep the action error visible. */ }
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="reservation-actions" aria-busy={busy}>
    <h3>Điều hành phiên gửi xe</h3>
    {!slot.observation_ready && <p className="supporting-text" role="status">Cần quan sát camera mới trước khi thao tác.</p>}
    {slot.active_session_id && <SessionDetail sessionId={slot.active_session_id} slot={slot} sessionRevision={sessionRevision} disabled={disabled || busy} onUpdated={onUpdated} onReload={onReload} />}
    {customerAction && <form className="customer-form" onSubmit={(event) => { event.preventDefault(); void transition(customerAction); }}>
      <label htmlFor={`${id}-name`}>Tên khách<input id={`${id}-name`} required maxLength={100} value={customer.customer_name} onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })} /></label>
      <label htmlFor={`${id}-phone`}>Số điện thoại<input id={`${id}-phone`} type="tel" required maxLength={30} value={customer.phone_number} onChange={(e) => setCustomer({ ...customer, phone_number: e.target.value })} /></label>
      <label htmlFor={`${id}-plate`}>Biển số xe<input id={`${id}-plate`} required maxLength={30} value={customer.license_plate} onChange={(e) => setCustomer({ ...customer, license_plate: e.target.value })} /></label>
      <p className="supporting-text">{customerAction === "reserve" ? "Giữ chỗ trong 10 phút. AI tự xác nhận khi xe đến; hạn giữ chỗ không gia hạn khi xe rời ô." : "Chỉ đăng ký khi camera xác nhận xe có mặt. Xe được quay lại ô trong 10 phút từ lúc tạo phiên; ra khỏi ô sau hạn sẽ kết thúc phiên."}</p>
      <button className="primary-button" disabled={blocked}>{busy ? "Đang cập nhật…" : labels[customerAction]}</button>
    </form>}
    <div className="reservation-buttons">
      {slot.needs_reconciliation && !slot.active_session_id && <button className="secondary-button" disabled={blocked} onClick={() => void transition("reconcile")}>Đối soát ô cũ</button>}
    </div>
    {notice && <InlineNotice tone={failed ? "error" : "success"}>{notice}</InlineNotice>}
  </div>;
}
