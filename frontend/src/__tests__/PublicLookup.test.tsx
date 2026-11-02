// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { clearTokens, getAccessToken, saveTokens } from "../services/api";
import { demoMap } from "../services/demo";

beforeEach(() => { clearTokens(); });
afterEach(() => { cleanup(); clearTokens(); vi.unstubAllGlobals(); });

describe("public parking lookup from login", () => {
  it.each([false, true])("opens read-only lookup with saved login = %s", async (savedLogin) => {
    if (savedLogin) saveTokens("expired-access", "saved-refresh", true);
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(demoMap)));
    const socketMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", socketMock);
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Tra cứu chỗ đỗ/ }));

    expect(await screen.findByRole("heading", { name: "Tìm vị trí còn trống" })).toBeTruthy();
    expect(await screen.findByText(/ô trống tại camera đang chọn/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Điều hướng chính" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Giữ chỗ|Check-in/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/map");
    const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(request.headers).has("Authorization")).toBe(false);
    expect(socketMock).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe(savedLogin ? "expired-access" : null);

    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(screen.getByRole("heading", { name: "Đăng nhập" })).toBeTruthy();
  });

  it("shows a public API failure without refreshing or removing a saved login", async () => {
    saveTokens("expired-access", "saved-refresh", true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "Không tải được bãi đỗ" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Tra cứu chỗ đỗ/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Không tải được bãi đỗ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("expired-access");
  });
});
