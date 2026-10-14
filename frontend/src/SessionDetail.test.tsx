// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionDetail } from "./SessionDetail";
import { apiFetch } from "./api";
import { demoMap } from "./demo";
import type { ParkingSession } from "./types";
vi.mock("./api", () => ({ apiFetch: vi.fn(), isDemoMode: () => false }));
const session: ParkingSession = { id: 42, parking_slot_id: 1, customer_name: "Nguyễn An", phone_number: "0901234567", license_plate: "30A12345", is_active: true, created_by: 1, created_at: "2026-10-14T09:00:00Z" };
const slot = { ...demoMap.slots[0], status: "RESERVED" as const, active_session_id: 42 };
beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (init?.method === "POST") return { ...slot, status: "EMPTY", active_session_id: null };
    if (path.includes("/events")) return { data: [], meta: { page: 1, page_size: 10, total: 0, total_pages: 0 } };
    return session;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("session lifecycle controls", () => {
  it("sends arrival confirmation to the protected slot endpoint", async () => {
    render(<SessionDetail sessionId={42} slot={slot} onUpdated={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận xe đến" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/parking-slots/1/confirm-arrival", { method: "POST" }));
  });
  it("reloads protected details when a session notification changes the revision", async () => {
    const props = { sessionId: 42, slot, onUpdated: vi.fn(), onReload: vi.fn() };
    const { rerender } = render(<SessionDetail {...props} sessionRevision={0} />);
    await screen.findByText("30A12345");
    vi.mocked(apiFetch).mockClear();
    rerender(<SessionDetail {...props} sessionRevision={1} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/parking-sessions/42", expect.anything()));
  });
  it("checks out by session ID only after an empty observation", async () => {
    const updated = vi.fn(), reload = vi.fn().mockResolvedValue(undefined);
    render(<SessionDetail sessionId={42} slot={slot} onUpdated={updated} onReload={reload} />);
    const button = await screen.findByRole("button", { name: "Kết thúc phiên gửi xe" });
    expect(screen.getByText("30A12345")).toBeTruthy(); expect(screen.getByRole("button", { name: "Hủy giữ chỗ" })).toBeTruthy();
    fireEvent.click(button); await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/parking-sessions/42/check-out", { method: "POST" }));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ status: "EMPTY", active_session_id: null })); expect(reload).toHaveBeenCalled();
  });
  it.each([{ status: "OCCUPIED" as const }, { observation_ready: false }, { active_session_id: 99 }])("blocks checkout for %j", async (metadata) => {
    render(<SessionDetail sessionId={42} slot={{ ...slot, ...metadata }} onUpdated={vi.fn()} onReload={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Kết thúc phiên gửi xe" }); expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button); expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("allows cancellation of an active session when its slot is held empty", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method === "POST" ? slot : path.includes("/events") ? { data: [], meta: { total_pages: 0 } } : { ...session, is_active: true });
    render(<SessionDetail sessionId={42} slot={slot} onUpdated={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hủy giữ chỗ" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/parking-slots/1/cancel-reservation", { method: "POST" }));
    expect(screen.getByRole("button", { name: "Kết thúc phiên gửi xe" })).toBeTruthy();
  });
  it("shows minimal session fields and no lifecycle controls for a closed session", async () => {
    vi.mocked(apiFetch).mockImplementation(async path => path.includes("/events") ? { data: [], meta: { total_pages: 0 } } : { ...session, is_active: false });
    render(<SessionDetail sessionId={42} slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />);
    expect(await screen.findByText("Đã đóng")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kết thúc phiên gửi xe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hủy giữ chỗ" })).toBeNull();
    expect(screen.getByText("Tạo phiên lúc")).toBeTruthy();
    for (const label of ["Xe đến", "Xe rời ô", "Kết thúc phiên", "Hạn quay lại ô"]) expect(screen.queryByText(label, { exact: true })).toBeNull();
  });
  it("keeps checkout conflicts visible after refreshing the session", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => { if (init?.method === "POST") throw new Error("This session is no longer active"); return path.includes("/events") ? { data: [], meta: { total_pages: 0 } } : session; });
    render(<SessionDetail sessionId={42} slot={slot} onUpdated={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Kết thúc phiên gửi xe" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("no longer active"));
  });
});
