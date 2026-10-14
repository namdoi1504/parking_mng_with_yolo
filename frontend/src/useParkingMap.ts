import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getAccessToken, getClaims, isDemoMode } from "./api";
import { demoMap } from "./demo";
import { isScenarioMode } from "./scenarioMode";
import type { ConnectionState } from "./components";
import { summarize } from "./parking";
import type { ParkingMap, ParkingSlot, SlotStatus } from "./types";

export interface ParkingEvent { time: string; code: string; status: SlotStatus | null; camera: number }
export const PARKING_POLL_MS = 5000;

export function useParkingMap() {
  const [data, setData] = useState<ParkingMap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [events, setEvents] = useState<ParkingEvent[]>([]);
  const [sessionRevision, setSessionRevision] = useState(0);
  const socketReady = useRef(false);
  const request = useRef<AbortController | null>(null);
  const previous = useRef<ParkingMap | null>(null);
  const load = useCallback(async (background = false) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    // Automatic snapshots must not flash or resize manual refresh controls.
    setBusy(!background || !previous.current);
    try {
      const result = isDemoMode() ? demoMap : await apiFetch<ParkingMap>("/api/ai/map", { signal: controller.signal });
      if (!controller.signal.aborted && request.current === controller) {
        const observedAt = new Date();
        const oldSlots = new Map(previous.current?.slots.map((slot) => [slot.id, slot]) ?? []);
        const changes = result.slots.filter((slot) => oldSlots.has(slot.id) && oldSlots.get(slot.id)?.status !== slot.status)
          .map((slot) => ({ time: observedAt.toISOString(), code: slot.slot_code, status: slot.status, camera: slot.camera_id }));
        if (changes.length) setEvents((old) => [...changes, ...old].slice(0, 20));
        const next = result;
        previous.current = next;
        setData(next); setError(""); setUpdatedAt(observedAt);
        setConnection(isDemoMode() ? "demo" : socketReady.current ? "connected" : "polling");
      }
    } catch (reason) {
      if (request.current === controller) {
        setConnection("disconnected");
        setError(controller.signal.aborted ? "API dữ liệu chưa phản hồi sau 10 giây. Tự thử lại theo chu kỳ; dữ liệu lần tải trước được giữ lại." : reason instanceof Error ? reason.message : "Không tải được bãi đỗ");
      }
    } finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, []);
  useEffect(() => {
    if (!isScenarioMode()) return;
    const refresh = () => {
      const pending = request.current; request.current = null; pending?.abort();
      void load(true).finally(() => setSessionRevision((value) => value + 1));
    };
    window.addEventListener("scenario-changed", refresh);
    return () => window.removeEventListener("scenario-changed", refresh);
  }, [load]);
  useEffect(() => {
    if (isScenarioMode() || isDemoMode() || !getAccessToken() || !getClaims()?.permissions.includes("parking:view")) return;
    let stopped = false, socket: WebSocket | undefined;
    let retry: number | undefined, refresh: number | undefined;
    let delay = 1000, sessionChanged = false;
    function scheduleSnapshot() {
      if (refresh !== undefined || stopped) return;
      refresh = window.setTimeout(async () => {
        refresh = undefined;
        if (request.current) { scheduleSnapshot(); return; }
        const refreshSession = sessionChanged;
        sessionChanged = false;
        await load(true);
        if (!stopped && refreshSession) setSessionRevision((value) => value + 1);
      }, 200);
    }
    function connect() {
      const token = getAccessToken();
      if (stopped || !token || !getClaims()?.permissions.includes("parking:view")) return;
      const base = import.meta.env.VITE_API_BASE_URL || window.location.origin;
      const url = new URL(`${base.replace(/\/$/, "")}/ws/parking`, window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      try { socket = new WebSocket(url.toString(), ["parking", `bearer.${token}`]); }
      catch { retry = window.setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); return; }
      socket.onopen = () => {
        if (stopped) return;
        socketReady.current = true; delay = 1000;
        sessionChanged = true; scheduleSnapshot();
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "PARKING_SESSION_CHANGED") sessionChanged = true;
          if (message.type === "PARKING_SESSION_CHANGED" || message.type === "SLOT_STATUS_CHANGED") scheduleSnapshot();
        } catch { /* Ignore messages outside the backend contract. */ }
      };
      socket.onclose = (event) => {
        socketReady.current = false;
        if (stopped) return;
        setConnection("polling");
        // Policy rejection must not cause an authentication retry loop.
        if (event.code !== 1008) { retry = window.setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); }
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    return () => { stopped = true; socketReady.current = false; window.clearTimeout(retry); window.clearTimeout(refresh); socket?.close(); };
  }, [load]);
  useEffect(() => {
    function cancel() { const current = request.current; request.current = null; current?.abort(); }
    void load(true);
    // load() skips overlapping requests; failures keep the last successful map.
    const poll = window.setInterval(() => void load(true), PARKING_POLL_MS);
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
  return { data, error, busy, updatedAt, connection, events, sessionRevision, load, applySlot };
}

export const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Đang tải dữ liệu bãi đỗ", connected: "Cập nhật trực tiếp: đã kết nối",
  disconnected: "Lỗi tải dữ liệu · thử lại mỗi 5 giây", polling: "Trạng thái ô: cập nhật mỗi 5 giây", demo: "Dữ liệu minh họa",
};
