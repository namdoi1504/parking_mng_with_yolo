// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ScenarioPage, type ScenarioState } from "./ScenarioPage";
import { apiResponse, saveTokens } from "../api";
import App from "../App";
import { demoMap } from "../demo";
import { summarize } from "../parking";

const initial: ScenarioState = {
  scenario: "arrival", run_id: "lab-run", cursor: 0, time: "2026-10-14T10:00:00Z",
  slot: { slot_code: "DEMO-01", status: "EMPTY", observation_ready: true, reservation_expires_at: null },
  active_session: null, sessions: [], events: [], log: [],
  steps: [{ label: "Giữ ô demo", expected: "RESERVED" }, { label: "Xe đến demo", expected: "OCCUPIED" }]
};
let snapshot: ScenarioState;
const fetchMock = vi.fn();
beforeEach(() => {
  snapshot = structuredClone(initial); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/scenario-lab/api/api/ai/map") {
      const slots = demoMap.slots.map(slot => slot.id === 1 ? { ...slot, status: snapshot.slot.status, active_session_id: snapshot.active_session } : slot);
      return { ok: true, json: async () => ({ slots, summary: summarize(slots) }) };
    }
    if (url.startsWith("/scenario-lab/api/parking-sessions/")) return { ok: true, json: async () => url.includes("/events") ? { data: [], meta: { total_pages: 0 } } : { id: 1, parking_slot_id: 1, customer_name: "Demo", phone_number: "0900000000", license_plate: "DEMO01", is_active: true, created_at: initial.time, created_by: 1 } };
    if (url.endsWith("catalog")) return { ok: true, json: async () => [{ id: "arrival", title: "Đặt trước → xe đến", description: "Kịch bản demo" }] };
    if (url.endsWith("reset")) snapshot = structuredClone(initial);
    if (url.endsWith("next")) {
      const command = JSON.parse(String(init?.body));
      expect(command).toEqual({ run_id: snapshot.run_id, cursor: snapshot.cursor });
      const cursor = snapshot.cursor + 1, status = cursor === 1 ? "RESERVED" : "OCCUPIED";
      snapshot = { ...snapshot, cursor, active_session: 1, slot: { ...snapshot.slot, status },
        log: [...snapshot.log, { index: cursor, label: snapshot.steps[cursor - 1].label, time: snapshot.time,
          before: snapshot.slot.status, after: status, expected: status, passed: true, error: null, notes: [], messages: [] }] };
    }
    return { ok: true, json: async () => structuredClone(snapshot) };
  });
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("scenario presenter", () => {
  it("uses the production map, customer form and scoped production navigation", async () => {
    window.history.replaceState({}, "", "/scenarios/map");
    render(<MemoryRouter initialEntries={["/scenarios/map"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Bản đồ bãi đỗ" })).toBeTruthy();
    expect(await screen.findByRole("textbox", { name: "Tên khách" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Phiên gửi xe" }).getAttribute("href")).toBe("/scenarios/sessions");
    fireEvent.click(screen.getByRole("button", { name: "Chạy bước tiếp" }));
    await screen.findByText(/1\/2 bước/);
    expect(await screen.findByText("DEMO01")).toBeTruthy();
    expect(document.querySelector('.map-slot[data-slot-id="1"]')?.getAttribute("aria-pressed")).toBe("true");
  });
  it("runs steps against the isolated lab and resets only the demo", async () => {
    render(<MemoryRouter><ScenarioPage /></MemoryRouter>);
    const next = await screen.findByRole("button", { name: "Chạy bước tiếp" });
    expect(await screen.findByText(/MÔ PHỎNG TÍN HIỆU AI/)).toBeTruthy();
    fireEvent.click(next);
    await screen.findByText(/1\/2 bước/);
    fireEvent.click(next); await screen.findByText(/Hoàn tất/);
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại" }));
    await screen.findByText(/0\/2 bước/);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/scenario-lab/"))).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === "omit")).toBe(true);
  });
  it("supports autoplay and pauses without advancing more steps", async () => {
    vi.useFakeTimers(); render(<MemoryRouter><ScenarioPage /></MemoryRouter>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Chạy tự động" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText(/1\/2 bước/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText(/1\/2 bước/)).toBeTruthy();
  });
  it("shows a concrete connection error instead of faking a successful run", async () => {
    fetchMock.mockRejectedValue(new Error("Lab offline"));
    render(<MemoryRouter><ScenarioPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Lab offline")).toBeTruthy();
    expect(screen.queryByText(/Hoàn tất/)).toBeNull();
    expect(screen.getByRole("button", { name: "Tải lại trạng thái demo" })).toBeTruthy();
  });
  it("routes production API calls exclusively to the lab without exposing real credentials", async () => {
    window.history.replaceState({}, "", "/scenarios/map");
    saveTokens("real-token-must-stay-private", "real-refresh", false);
    try {
      await apiResponse("/parking-slots/1/reserve", { method: "POST", headers: { Authorization: "Bearer must-not-send" }, body: JSON.stringify({ customer_name: "Demo" }) });
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe("/scenario-lab/api/parking-slots/1/reserve");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      expect(init.credentials).toBe("omit");
    } finally { window.history.replaceState({}, "", "/"); sessionStorage.clear(); localStorage.clear(); }
  });
});
