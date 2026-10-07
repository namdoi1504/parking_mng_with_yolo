import { useRef, useState } from "react";
import { apiFetch, getClaims, isDemoMode } from "./api";
import { InlineNotice } from "./components";
import type { ParkingSlot } from "./types";

type Action = "reserve" | "cancel-reservation" | "confirm-arrival";
const labels: Record<Action, string> = {
  reserve: "Giữ chỗ", "cancel-reservation": "Hủy giữ chỗ", "confirm-arrival": "Xác nhận xe đến"
};

export function ReservationActions({ slot, onUpdated, onReload, disabled = false }: {
  slot: ParkingSlot; onUpdated: (slot: ParkingSlot) => void; onReload: () => Promise<void>; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  if (!isDemoMode() && getClaims()?.role !== "Administrator") return null;

  async function transition(action: Action) {
    if (inFlight.current || disabled) return;
    if (isDemoMode()) { setFailed(false); setNotice("Bản xem giao diện không thay đổi giữ chỗ trong hệ thống."); return; }
    if (!window.confirm(`${labels[action]} cho ô ${slot.slot_code}?`)) return;
    inFlight.current = true; setBusy(true); setNotice(""); setFailed(false);
    try {
      const updated = await apiFetch<ParkingSlot>(`/parking-slots/${slot.id}/${action}`, { method: "POST" });
      onUpdated(updated);
      setNotice(`Đã ${labels[action].toLowerCase()} cho ô ${slot.slot_code}.`);
    } catch (reason) {
      setFailed(true);
      setNotice(`${reason instanceof Error ? reason.message : "Không cập nhật được ô đỗ"}. Đang tải lại trạng thái mới nhất.`);
      await onReload();
    } finally { inFlight.current = false; setBusy(false); }
  }
  const actions: Action[] = slot.status === "EMPTY" ? ["reserve"] : slot.status === "RESERVED" ? ["confirm-arrival", "cancel-reservation"] : [];
  return <div className="reservation-actions" aria-busy={busy}>
    <h3>Điều hành giữ chỗ</h3>
    <p className="supporting-text">Ô giữ chỗ được giữ nguyên trước cập nhật AI cho đến khi hủy hoặc xác nhận xe đến.</p>
    <div className="reservation-buttons">{actions.map((action) => <button key={action} className={action === "cancel-reservation" ? "secondary-button" : "primary-button"} disabled={busy || disabled} onClick={() => void transition(action)}>{busy ? "Đang cập nhật…" : labels[action]}</button>)}</div>
    {!actions.length && <p className="supporting-text">Chỉ giữ chỗ khi ô đang trống.</p>}
    {notice && <InlineNotice tone={failed ? "error" : "success"}>{notice}</InlineNotice>}
  </div>;
}
