// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MapPage } from "./MapPage";
import { MonitorPage } from "./MonitorPage";
import { LookupPage } from "./LookupPage";
import { ZoneStatisticsPage } from "./ZoneStatisticsPage";
import { demoMap } from "../services/demo";
import { summarize } from "../services/parking";
import App from "../App";
import { getAccessToken, getClaims } from "../services/api";
vi.mock("../services/api", () => ({ getAccessToken: vi.fn(() => "test-token"), getClaims: vi.fn(() => ({ role: "Operator", permissions: [], user_id: 1 })), isDemoMode: () => false, apiFetch: vi.fn(), clearTokens: vi.fn() }));
vi.mock("../hooks/useParkingMap", () => ({ connectionLabels: { polling: "Đang cập nhật" }, useParkingMap: () => ({ data: snapshot, error: "", busy: false, load: vi.fn(), connection: "polling", applySlot: vi.fn(), updatedAt: new Date(), events: [] }) }));
vi.mock("../components/CameraStream", () => ({ CameraStream: ({ cameraId }: { cameraId: number }) => <section aria-label={`Video Camera ${cameraId}`} /> }));
const slots = [
  { ...demoMap.slots[0], row: 0, col: 0 },
  { ...demoMap.slots[1], row: 5, col: 1, status: "EMPTY" as const },
  { ...demoMap.slots[2], row: 5, col: 1, status: "UNKNOWN" as const },
];
const snapshot = { slots, summary: summarize(slots) };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("zone views", () => {
  it("keeps monitoring focused on video and observed changes with a link to the map", () => {
    render(<MemoryRouter initialEntries={["/monitor"]}><MonitorPage /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "Video Camera 1" })).toBeTruthy();
    expect(screen.getByText("Thay đổi quan sát được")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở bản đồ" }).getAttribute("href")).toBe("/map");
    expect(screen.queryByLabelText("Bản đồ các ô đỗ")).toBeNull();
    expect(screen.queryByLabelText("Khu bãi đỗ")).toBeNull();
  });
  it("keeps lookup public even when the browser has a saved login", () => {
    render(<MemoryRouter initialEntries={["/lookup"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Tìm vị trí còn trống" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Điều hướng chính" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Khu bãi đỗ"), { target: { value: "1:column:2" } });
    fireEvent.click(screen.getByRole("button", { name: "Danh sách ô trống" }));
    expect(screen.getAllByRole("button", { name: /Camera 1: Còn trống/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Tìm ô trống" }));
    expect(document.querySelector(".map-slot.selected")?.getAttribute("data-slot-id")).toBe(String(slots[1].id));
  });
  it("keeps public lookup accessible without a sign-in", () => {
    vi.mocked(getAccessToken).mockReturnValueOnce(null);
    vi.mocked(getClaims).mockReturnValueOnce(null as never);
    render(<MemoryRouter initialEntries={["/lookup"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Tìm vị trí còn trống" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Điều hướng chính" })).toBeNull();
  });
  it("scopes the map summary while preserving every polygon", () => {
    render(<MemoryRouter initialEntries={["/map"]}><MapPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Khu bãi đỗ"), { target: { value: "1:column:2" } });
    expect(screen.getByText("Khu 2 · Camera #1")).toBeTruthy();
    expect(document.querySelector(".map-zone-outline")).not.toBeNull();
    expect(document.querySelectorAll(".map-slot")).toHaveLength(3); expect(document.querySelectorAll(".map-slot.dimmed")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ô A-01, Camera 1: Còn trống" }));
    expect((screen.getByLabelText("Khu bãi đỗ") as HTMLSelectElement).value).toBe("1:column:1");
  });
  it("only chooses an available space inside the selected lookup zone", () => {
    render(<MemoryRouter initialEntries={["/lookup"]}><LookupPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Khu bãi đỗ"), { target: { value: "1:column:2" } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm ô trống" }));
    expect(document.querySelector(".map-slot.selected")?.getAttribute("data-slot-id")).toBe(String(slots[1].id));
    expect(screen.getByRole("heading", { name: "A-02" })).toBeTruthy();
  });
  it("shows current zone counts independently of historical reports", () => {
    render(<MemoryRouter initialEntries={["/statistics"]}><ZoneStatisticsPage viewSwitcher={null} /></MemoryRouter>);
    const table = screen.getByRole("table"), rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); expect(within(rows[2]).getByText("50%")).toBeTruthy();
    expect(screen.getByText(/Đây là trạng thái hiện tại/)).toBeTruthy();
  });
  it("filters zone statistics by camera without mixing cameras", () => {
    render(<MemoryRouter initialEntries={["/statistics"]}><ZoneStatisticsPage viewSwitcher={null} /></MemoryRouter>);
    expect(screen.getByText("Khu 1")).toBeTruthy();
    expect(screen.getByText("Khu 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Camera thống kê khu"), { target: { value: "1" } });
    expect(screen.getByText("Khu 1")).toBeTruthy();
  });
});
