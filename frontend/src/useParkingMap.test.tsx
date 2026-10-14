// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { apiFetch, getAccessToken, getClaims } from "./api";
import { demoMap } from "./demo";
import { PARKING_POLL_MS, useParkingMap } from "./useParkingMap";
vi.mock("./api", () => ({ apiFetch: vi.fn(), getAccessToken: vi.fn(), getClaims: vi.fn(), isDemoMode: () => false }));
class TestSocket {
  static sockets: TestSocket[] = [];
  onopen?: () => void; onclose?: (event: { code: number }) => void; onmessage?: (event: { data: string }) => void;
  constructor(public url: string, public protocols: string[]) { TestSocket.sockets.push(this); }
  close() { this.onclose?.({ code: 1000 }); }
}
function Probe() {
  const { data, connection, error, events, sessionRevision } = useParkingMap();
  return <><span>{connection}</span><span>{data ? `${data.summary.total_slots} slots, ${data.summary.empty_slots} empty` : "No data"}</span><p>{error}</p><span>{events.length} observed changes</span><span>Session revision {sessionRevision}</span></>;
}
beforeEach(() => {
  TestSocket.sockets = []; vi.stubGlobal("WebSocket", TestSocket);
  vi.mocked(getAccessToken).mockReturnValue(null); vi.mocked(getClaims).mockReturnValue(null);
  vi.mocked(apiFetch).mockResolvedValue(demoMap);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("shared parking data", () => {
  it("keeps refresh controls stable during automatic snapshots and indicates manual requests", async () => {
    vi.useFakeTimers();
    function RefreshProbe() {
      const { busy, load } = useParkingMap();
      return <button disabled={busy} onClick={() => void load()}>Làm mới</button>;
    }
    render(<RefreshProbe />); await act(async () => {});
    const button = screen.getByRole("button", { name: "Làm mới" }) as HTMLButtonElement;
    let resolve!: (value: typeof demoMap) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(button.disabled).toBe(false);
    await act(async () => { resolve(demoMap); });
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    await act(async () => { resolve(demoMap); });
    expect(button.disabled).toBe(false);
  });
  it("preserves the backend availability summary rather than counting all empty slots as available", async () => {
    function AvailabilityProbe() { const { data } = useParkingMap(); return <span>{data?.summary.available_slots} usable slots</span>; }
    vi.mocked(apiFetch).mockResolvedValue({ ...demoMap, summary: { ...demoMap.summary, available_slots: 2 } });
    render(<AvailabilityProbe />); expect(await screen.findByText("2 usable slots")).toBeTruthy();
  });
  it("does not overwrite a successful reservation with an older in-flight snapshot", async () => {
    vi.useFakeTimers();
    function MutationProbe() {
      const { data, applySlot } = useParkingMap();
      return <><span>{data?.slots[0].status}</span><button onClick={() => applySlot({ ...demoMap.slots[0], status: "RESERVED" })}>Reserve</button></>;
    }
    render(<MutationProbe />); await act(async () => {});
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    fireEvent.click(screen.getByRole("button", { name: "Reserve" }));
    expect(screen.getByText("RESERVED")).toBeTruthy();
    await act(async () => { resolve(demoMap); });
    expect(screen.getByText("RESERVED")).toBeTruthy();
    expect(screen.queryByText("EMPTY")).toBeNull();
  });
  it("loads correctly after StrictMode cancels its first mount request", async () => {
    vi.mocked(apiFetch).mockImplementationOnce((_path, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    render(<StrictMode><Probe /></StrictMode>);
    expect(await screen.findByText("40 slots, 10 empty")).toBeTruthy();
    expect(screen.queryByText(/Không nhận được dữ liệu/)).toBeNull();
  });
  it("authenticates the socket without a URL token and refreshes snapshot and session details", async () => {
    vi.useFakeTimers();
    vi.mocked(getAccessToken).mockReturnValue("test-only-token");
    vi.mocked(getClaims).mockReturnValue({ sub: "test", role: "Operator", user_id: 1, exp: 9999999999, permissions: ["parking:view"] });
    render(<Probe />); await act(async () => {});
    const socket = TestSocket.sockets[0];
    expect(socket.url).not.toContain("test-only-token");
    expect(socket.protocols).toEqual(["parking", "bearer.test-only-token"]);
    await act(async () => { socket.onopen?.(); await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByText("Session revision 1")).toBeTruthy();
    await act(async () => { socket.onmessage?.({ data: JSON.stringify({ type: "PARKING_SESSION_CHANGED", session_id: 42 }) }); await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText("Session revision 2")).toBeTruthy();
    expect(screen.getByText("0 observed changes")).toBeTruthy();
  });
  it("recovers the snapshot on reconnect and stops sockets and timers on unmount", async () => {
    vi.useFakeTimers();
    vi.mocked(getAccessToken).mockReturnValue("test-only-token");
    vi.mocked(getClaims).mockReturnValue({ sub: "test", role: "Operator", user_id: 1, exp: 9999999999, permissions: ["parking:view"] });
    const { unmount } = render(<Probe />); await act(async () => {});
    await act(async () => { TestSocket.sockets[0].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(1000); });
    expect(TestSocket.sockets).toHaveLength(2);
    const before = vi.mocked(apiFetch).mock.calls.length;
    await act(async () => { TestSocket.sockets[1].onopen?.(); await vi.advanceTimersByTimeAsync(250); });
    expect(apiFetch).toHaveBeenCalledTimes(before + 1);
    unmount(); const after = vi.mocked(apiFetch).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(TestSocket.sockets).toHaveLength(2); expect(apiFetch).toHaveBeenCalledTimes(after);
  });
  it("does not open a socket for a public visitor", async () => {
    render(<Probe />); await screen.findByText("40 slots, 10 empty");
    expect(TestSocket.sockets).toHaveLength(0);
  });
  it("stops reconnecting after the backend rejects socket permissions", async () => {
    vi.useFakeTimers();
    vi.mocked(getAccessToken).mockReturnValue("test-only-token");
    vi.mocked(getClaims).mockReturnValue({ sub: "test", role: "Operator", user_id: 1, exp: 9999999999, permissions: ["parking:view"] });
    render(<Probe />); await act(async () => {});
    await act(async () => { TestSocket.sockets[0].onclose?.({ code: 1008 }); await vi.advanceTimersByTimeAsync(60000); });
    expect(TestSocket.sockets).toHaveLength(1);
    expect(screen.getByText("polling")).toBeTruthy();
  });
  it("shows API failure without inventing parking data", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Backend unavailable"));
    render(<Probe />); expect(await screen.findByText("Backend unavailable")).toBeTruthy();
    expect(screen.getByText("No data")).toBeTruthy();
  });
  it("records only changes observed between successive map snapshots", async () => {
    vi.useFakeTimers();
    render(<Probe />);
    await act(async () => {});
    const changed = { ...demoMap, summary: { ...demoMap.summary, empty_slots: 9, occupied_slots: 21, available_slots: 9 }, slots: demoMap.slots.map((s) => s.id === 1 ? { ...s, status: "OCCUPIED" as const } : s) };
    vi.mocked(apiFetch).mockResolvedValue(changed);
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(screen.getByText("40 slots, 9 empty")).toBeTruthy();
    expect(screen.getByText("1 observed changes")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(screen.getByText("1 observed changes")).toBeTruthy();
  });
  it("keeps the last snapshot on failure and clears the error on recovery", async () => {
    vi.useFakeTimers(); render(<Probe />); await act(async () => {});
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Temporary failure"));
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(screen.getByText("Temporary failure")).toBeTruthy();
    expect(screen.getByText("40 slots, 10 empty")).toBeTruthy();
    expect(screen.getByText("disconnected")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(screen.queryByText("Temporary failure")).toBeNull();
    expect(screen.getByText("polling")).toBeTruthy();
  });
  it("does not overlap requests and aborts the outstanding request on unmount", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.mocked(apiFetch).mockImplementationOnce((_path, init) => { signal = init?.signal; return new Promise(() => {}); });
    const { unmount } = render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(PARKING_POLL_MS); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
