// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apiFetch, getClaims } from "../api";
import { StatisticsPage } from "./StatisticsPage";

vi.mock("../api", () => ({ apiFetch: vi.fn(), getClaims: vi.fn(), isDemoMode: () => false, clearTokens: vi.fn() }));
const mount = () => render(<MemoryRouter initialEntries={["/statistics"]}><StatisticsPage /></MemoryRouter>);
beforeEach(() => {
  vi.mocked(getClaims).mockReturnValue({ sub: "99", user_id: 99, role: "Reporter", permissions: ["report:view"], exp: 9999999999 });
  vi.mocked(apiFetch).mockImplementation(async (path) => path === "/api/ai/map" ? { slots: [{ camera_id: 7 }] } : path.startsWith("/api/stats/daily") ? [{ date: "2026-10-01", avg_utilization: null, samples: 0 }] : [{ hour: 0, utilization: 50, samples: 4, occupied: 5, available: 5 }] as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("hourly and daily report filters", () => {
  it("loads every camera page when camera:view is available, including cameras without current slots", async () => {
    vi.mocked(getClaims).mockReturnValue({ sub: "99", user_id: 99, role: "Reporter", permissions: ["report:view", "camera:view"], exp: 9999999999 });
    vi.mocked(apiFetch).mockImplementation(async (path) => path.startsWith("/cameras/") ? { data: [{ id: path.includes("page=1") ? 7 : 8 }], meta: { total_pages: 2 } } : [] as never);
    mount(); await screen.findByRole("option", { name: "Camera #8" });
    expect(apiFetch).toHaveBeenCalledWith("/cameras/?page=1&page_size=100", expect.anything());
    expect(apiFetch).toHaveBeenCalledWith("/cameras/?page=2&page_size=100", expect.anything());
    expect(screen.getByRole("option", { name: "Camera #7" })).toBeTruthy();
  });
  it("exports daily CSV with the selected camera/range and keeps missing values blank", async () => {
    let blob!: Blob;
    const createObjectURL = vi.fn((value: Blob) => { blob = value; return "blob:test-csv"; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    mount(); await screen.findByRole("option", { name: "Camera #7" });
    fireEvent.click(screen.getByRole("button", { name: "Theo ngày" }));
    fireEvent.change(screen.getByLabelText("Từ ngày (UTC)"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Đến ngày (UTC)"), { target: { value: "2026-10-07" } });
    fireEvent.change(screen.getByLabelText("Camera báo cáo"), { target: { value: "7" } });
    await screen.findByText("2026-10-01", { selector: "td" });
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(filename).toBe("parking-daily-2026-10-01-2026-10-07-camera-7.csv");
    const csv = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(csv).toBe("date,avg_utilization,samples\n2026-10-01,,0");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-csv");
  });
  it("requests daily reports with the backend aliases and optional camera", async () => {
    mount(); await screen.findByRole("option", { name: "Camera #7" });
    fireEvent.click(screen.getByRole("button", { name: "Theo ngày" }));
    fireEvent.change(screen.getByLabelText("Từ ngày (UTC)"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Đến ngày (UTC)"), { target: { value: "2026-10-07" } });
    fireEvent.change(screen.getByLabelText("Camera báo cáo"), { target: { value: "7" } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/stats/daily?from=2026-10-01&to=2026-10-07&camera_id=7", expect.anything()));
    expect(await screen.findByText("2026-10-01", { selector: "td" })).toBeTruthy();
    expect(screen.getByText("2026-10-01", { selector: "td" }).parentElement?.textContent).toContain("—0");
  });
  it("rejects reversed and overlong ranges before calling the API", async () => {
    mount(); await screen.findByRole("option", { name: "Camera #7" });
    fireEvent.click(screen.getByRole("button", { name: "Theo ngày" }));
    fireEvent.change(screen.getByLabelText("Từ ngày (UTC)"), { target: { value: "2026-10-07" } });
    fireEvent.change(screen.getByLabelText("Đến ngày (UTC)"), { target: { value: "2026-10-01" } });
    const count = vi.mocked(apiFetch).mock.calls.length;
    expect(screen.getByRole("alert").textContent).toContain("Ngày kết thúc");
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(apiFetch).toHaveBeenCalledTimes(count);
    fireEvent.change(screen.getByLabelText("Đến ngày (UTC)"), { target: { value: "2028-10-01" } });
    expect(screen.getByRole("alert").textContent).toContain("366 ngày");
    expect(apiFetch).toHaveBeenCalledTimes(count);
  });
  it("discards a late report from the previous camera filter", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === "/api/ai/map") return { slots: [{ camera_id: 7 }] } as never;
      if (!path.includes("camera_id")) return new Promise((done) => { resolve = done; });
      return [{ hour: 0, utilization: 70, samples: 4, occupied: 7, available: 3 }] as never;
    });
    mount(); await screen.findByRole("option", { name: "Camera #7" });
    fireEvent.change(screen.getByLabelText("Camera báo cáo"), { target: { value: "7" } });
    expect(await screen.findByText("70%", { selector: "td" })).toBeTruthy();
    resolve([{ hour: 0, utilization: 10, samples: 4, occupied: 1, available: 9 }]);
    await waitFor(() => expect(screen.queryByText("10%", { selector: "td" })).toBeNull());
  });
});
