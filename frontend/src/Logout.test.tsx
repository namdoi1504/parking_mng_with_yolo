// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { apiFetch, clearTokens } from "./api";
import { AppShell } from "./components";
vi.mock("./api", () => ({ apiFetch: vi.fn(), clearTokens: vi.fn(), getClaims: () => ({ user_id: 1, role: "Administrator", permissions: [] }), isDemoMode: () => false }));
beforeEach(() => vi.mocked(apiFetch).mockResolvedValue(undefined));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() {
  render(<MemoryRouter initialEntries={["/map"]}><Routes><Route path="/map" element={<AppShell eyebrow="Vận hành" title="Bản đồ">Bãi đỗ</AppShell>} /><Route path="/login" element={<p>Đã về đăng nhập</p>} /></Routes></MemoryRouter>);
}
describe("logout UI", () => {
  it("clears local credentials only after backend revocation succeeds", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Đăng xuất và thu hồi phiên đăng nhập" }));
    await screen.findByText("Đã về đăng nhập");
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/auth/logout", { method: "POST" });
    expect(clearTokens).toHaveBeenCalledOnce();
  });
  it("shows a failure and offers explicit local logout if backend is unavailable", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Offline"));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Đăng xuất và thu hồi phiên đăng nhập" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Chưa thu hồi"));
    expect(clearTokens).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chỉ xóa đăng nhập trên thiết bị này" }));
    await screen.findByText("Đã về đăng nhập"); expect(clearTokens).toHaveBeenCalledOnce();
  });
});
