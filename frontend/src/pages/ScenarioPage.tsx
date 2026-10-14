import { useEffect, useRef, useState } from "react";
import { FlaskConical, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Outlet } from "react-router-dom";
import type { SlotStatus } from "../types";

export interface ScenarioCatalog { id: string; title: string; description: string }
interface RunLog {
  index: number; label: string; time: string; before: SlotStatus; after: SlotStatus;
  expected: SlotStatus; passed: boolean; error: { status: number; detail: string } | null;
  notes: string[]; messages: unknown[];
}
export interface ScenarioState {
  scenario: string; run_id: string; cursor: number; time: string;
  slot: { slot_code: string; status: SlotStatus; observation_ready: boolean; reservation_expires_at: string | null };
  active_session: number | null;
  steps: { label: string; expected: SlotStatus }[];
  log: RunLog[];
  sessions: { id: number; customer_name: string; phone_number: string; license_plate: string; is_active: boolean; created_at: string }[];
  events: { id: number; old_status: SlotStatus | null; new_status: SlotStatus; event_time: string; source: string }[];
}

async function labFetch<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(`/scenario-lab/${path}`, {
    credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : "Chưa kết nối được bộ chạy tình huống demo.");
  }
  return response.json();
}
const time = (stamp: string) => new Date(stamp).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok" });

export function ScenarioPage() {
  const [catalog, setCatalog] = useState<ScenarioCatalog[]>([]);
  const [state, setState] = useState<ScenarioState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true), [auto, setAuto] = useState(false);
  const flight = useRef<AbortController | null>(null);
  const done = !!state && state.cursor >= state.steps.length;
  const failed = state?.log.some(item => !item.passed) ?? false;
  const current = catalog.find(item => item.id === state?.scenario);

  async function request(path: "initial" | "state" | "reset" | "next", body?: object) {
    if (flight.current) return;
    const controller = new AbortController(); flight.current = controller;
    if (path !== "state") setBusy(true); setError("");
    try {
      if (path === "initial") {
        const [items, snapshot] = await Promise.all([
          labFetch<ScenarioCatalog[]>("catalog", controller.signal), labFetch<ScenarioState>("state", controller.signal)
        ]);
        if (!controller.signal.aborted) { setCatalog(items); setState(snapshot); }
      } else {
        const snapshot = await labFetch<ScenarioState>(path, controller.signal, body);
        if (!controller.signal.aborted) { setState(snapshot); if (snapshot.log.some(item => !item.passed)) setAuto(false); if (path !== "state") { window.dispatchEvent(new Event("scenario-changed")); window.dispatchEvent(new Event("scenario-focus")); } }
      }
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Không chạy được tình huống."); setAuto(false); }
    } finally { if (flight.current === controller) { flight.current = null; setBusy(false); } }
  }
  function next() { if (state && !done) void request("next", { run_id: state.run_id, cursor: state.cursor }); }
  function reset(scenario: string) { setAuto(false); void request("reset", { scenario }); }
  useEffect(() => {
    void request("initial");
    const poll = window.setInterval(() => void request("state"), 2500);
    return () => { window.clearInterval(poll); flight.current?.abort(); flight.current = null; };
  }, []);
  useEffect(() => {
    if (!auto || busy || done || failed || !state) return;
    const timer = window.setTimeout(next, 2000);
    return () => window.clearTimeout(timer);
  }, [auto, busy, done, failed, state?.cursor, state?.run_id]);

  return <div className="scenario-production">
    <section className="scenario-control-bar" aria-label="Điều khiển demo production">
      <div className="scenario-control-row"><span className="scenario-lab-label"><FlaskConical size={17} aria-hidden="true" />Mô phỏng</span>
        <label className="sr-only" htmlFor="production-scenario">Tình huống</label>
        <select id="production-scenario" disabled={busy} value={state?.scenario ?? ''} onChange={event => reset(event.target.value)}>{catalog.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <button className="primary-button" disabled={busy || done || failed || !!error || auto || !state} onClick={next}><SkipForward size={16} aria-hidden="true" />Chạy bước tiếp</button>
        <button className="secondary-button" disabled={done || failed || !!error || !state || (busy && !auto)} onClick={() => setAuto(!auto)}>{auto && !done ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{auto && !done ? 'Tạm dừng' : 'Chạy tự động'}</button>
        <button className="secondary-button" disabled={busy || !state} onClick={() => state && reset(state.scenario)}><RotateCcw size={16} aria-hidden="true" />Đặt lại</button>
      </div>
      <div className="scenario-control-caption"><span>Ứng dụng vận hành · dữ liệu và tín hiệu demo riêng{state && ` · Ô ${state.slot.slot_code} · ${time(state.time)}`}</span><span role="status">{state ? `${state.cursor}/${state.steps.length} bước · ${failed ? 'Cần kiểm tra' : done ? 'Hoàn tất' : busy ? 'Đang xử lý…' : 'Sẵn sàng'}` : 'Đang kết nối…'}</span>
        <details className="scenario-control-evidence"><summary>Chi tiết</summary><div><p><b>MÔ PHỎNG TÍN HIỆU AI · DỮ LIỆU DEMO RIÊNG</b></p><p>{current?.description}</p><p>Các trang dùng cùng component và hợp đồng API với production. Database SQLite và khung hình tín hiệu chạy riêng; không phải YOLO nhận diện từ video.</p><p>Ô 001 là ô chạy kịch bản. Những ô còn lại là trạng thái nền minh họa. Thao tác bằng tay có thể thay đổi điều kiện kịch bản; Đặt lại trước khi chạy lại.</p>{state?.log.map(result => <p key={result.index}>{result.label}: {result.passed ? 'Đạt' : 'Không đạt'}{result.error && ` · ${result.error.status}: ${result.error.detail}`}</p>)}</div></details>
      </div>
    </section>
    {error && <div className="error-banner" role="alert"><p>{error}</p><button className="secondary-button" disabled={busy} onClick={() => void request('initial')}>Tải lại trạng thái demo</button></div>}
    {state ? <Outlet key={state.run_id} /> : !error && <p role="status">Đang kết nối bộ chạy tình huống…</p>}
  </div>;
}
