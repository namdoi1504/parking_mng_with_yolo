// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apiFetch, getClaims } from "../api";
import { canVisit } from "../components";
import { SessionsPage } from "./SessionsPage";
import { demoMap } from "../demo";
vi.mock("../api", () => ({ apiFetch: vi.fn(), getClaims: vi.fn(() => ({ role: "Administrator", permissions: [] })), isDemoMode: () => false }));
vi.mock("../useParkingMap", () => ({ useParkingMap: () => ({ data: demoMap, error: "", load: vi.fn(), applySlot: vi.fn() }) }));
beforeEach(() => vi.mocked(apiFetch).mockResolvedValue({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("session lookup", () => {
  it("queries server filters with timezone-aware creation timestamps", async () => {
    render(<MemoryRouter initialEntries={["/sessions"]}><SessionsPage /></MemoryRouter>);
    await screen.findByText("Không có phiên phù hợp");
    fireEvent.change(screen.getByLabelText("Biển số xe"), { target: { value: "30A-123.45" } });
    fireEvent.change(screen.getByLabelText("Số điện thoại"), { target: { value: "0901234567" } });
    fireEvent.change(screen.getByLabelText("Trạng thái phiên"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("Tạo từ (giờ địa phương)"), { target: { value: "2026-10-14T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiên" }));
    await waitFor(() => {
      const call = vi.mocked(apiFetch).mock.calls.at(-1)!;
      const url = new URL(call[0], "http://localhost");
      expect(url.pathname).toBe("/parking-sessions"); expect(url.searchParams.get("license_plate")).toBe("30A-123.45");
      expect(url.searchParams.get("phone_number")).toBe("0901234567"); expect(url.searchParams.get("is_active")).toBe("false");
      expect(url.searchParams.get("created_from")).toBe(new Date("2026-10-14T10:00").toISOString());
    });
  });
  it.each(["true", "false"])("sends is_active=%s without the removed status filter", async value => {
    render(<MemoryRouter><SessionsPage /></MemoryRouter>); await screen.findByText("Không có phiên phù hợp");
    fireEvent.change(screen.getByLabelText("Trạng thái phiên"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiên" }));
    await waitFor(() => {
      const url = new URL(vi.mocked(apiFetch).mock.calls.at(-1)![0], "http://localhost");
      expect(url.searchParams.get("is_active")).toBe(value); expect(url.searchParams.has("status")).toBe(false);
    });
  });
  it("rejects reversed ranges before calling the backend", async () => {
    render(<MemoryRouter><SessionsPage /></MemoryRouter>); await screen.findByText("Không có phiên phù hợp");
    const initialCalls = vi.mocked(apiFetch).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Tạo từ (giờ địa phương)"), { target: { value: "2026-10-14T11:00" } });
    fireEvent.change(screen.getByLabelText("Tạo trước (giờ địa phương)"), { target: { value: "2026-10-14T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Tra cứu phiên" }));
    expect(screen.getByRole("alert").textContent).toContain("phải sau"); expect(apiFetch).toHaveBeenCalledTimes(initialCalls);
  });
  it("uses the administrator boundary for session navigation", () => {
    expect(canVisit("/sessions")).toBe(true);
    vi.mocked(getClaims).mockReturnValueOnce({ sub: "2", user_id: 2, role: "Operator", permissions: ["parking:manage"], exp: 9999999999 });
    expect(canVisit("/sessions")).toBe(false);
    vi.mocked(getClaims).mockReturnValueOnce(null);
    expect(canVisit("/sessions")).toBe(false);
  });
});
