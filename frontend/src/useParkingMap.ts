import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, isDemoMode } from "./api";
import { demoMap } from "./demo";
import type { ConnectionState } from "./components";
import { summarize } from "./parking";
import type { ParkingMap, ParkingSlot, SlotStatus } from "./types";

export interface ParkingEvent { time: string; code: string; status: SlotStatus; camera: number }
export const PARKING_POLL_MS = 5000;

export function useParkingMap() {
  const [data, setData] = useState<ParkingMap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<ParkingEvent[]>([]);
  const request = useRef<AbortController | null>(null);
  const previous = useRef<ParkingMap | null>(null);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setBusy(true);
    try {
      const result = isDemoMode() ? demoMap : await apiFetch<ParkingMap>("/api/ai/map", { signal: controller.signal });
      if (!controller.signal.aborted && request.current === controller) {
        const observedAt = new Date();
        const oldSlots = new Map(previous.current?.slots.map((slot) => [slot.id, slot]) ?? []);
        const changes = result.slots.filter((slot) => oldSlots.has(slot.id) && oldSlots.get(slot.id)?.status !== slot.status)
          .map((slot) => ({ time: observedAt.toISOString(), code: slot.slot_code, status: slot.status, camera: slot.camera_id }));
        if (changes.length) setEvents((old) => [...changes, ...old].slice(0, 20));
        const next = { ...result, summary: summarize(result.slots) };
        previous.current = next;
        setData(next); setError(""); setUpdatedAt(observedAt);
        setConnection(isDemoMode() ? "demo" : "polling");
      }
    } catch (reason) {
      if (request.current === controller) {
        setConnection("disconnected");
        setError(controller.signal.aborted ? "API dữ liệu chưa phản hồi sau 10 giây. Tự thử lại theo chu kỳ; dữ liệu lần tải trước được giữ lại." : reason instanceof Error ? reason.message : "Không tải được bãi đỗ");
      }
    } finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, []);
  useEffect(() => {
    function cancel() { const current = request.current; request.current = null; current?.abort(); }
    void load();
    // load() skips overlapping requests; failures keep the last successful map.
    const poll = window.setInterval(() => void load(), PARKING_POLL_MS);
    return () => { window.clearInterval(poll); cancel(); };
  }, [load]);
  const applySlot = useCallback((slot: ParkingSlot) => {
    // Discard a snapshot started before the mutation completed.
    const pending = request.current;
    request.current = null;
    pending?.abort();
    setBusy(false);
    const current = previous.current;
    if (current) {
      const slots = current.slots.map((item) => item.id === slot.id ? slot : item);
      const next = { ...current, slots, summary: summarize(slots) };
      previous.current = next;
      setData(next);
      setUpdatedAt(new Date());
    }
  }, []);
  return { data, error, busy, updatedAt, connection, events, load, applySlot };
}

export const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Đang tải dữ liệu bãi đỗ", connected: "Cập nhật trực tiếp: đã kết nối",
  disconnected: "Lỗi tải dữ liệu · thử lại mỗi 5 giây", polling: "Trạng thái ô: cập nhật mỗi 5 giây", demo: "Dữ liệu minh họa",
};
