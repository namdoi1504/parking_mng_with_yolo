// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReservationActions } from "./ReservationActions";
import { apiFetch, getClaims, isDemoMode } from "./api";
import { demoMap } from "./demo";

vi.mock("./api", () => ({ apiFetch: vi.fn(), getClaims: vi.fn(), isDemoMode: vi.fn() }));
const slot = demoMap.slots[0];
beforeEach(() => {
  vi.mocked(isDemoMode).mockReturnValue(false);
  vi.mocked(getClaims).mockReturnValue({ sub: "1", user_id: 1, role: "Administrator", permissions: [], exp: 9999999999 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("backend reservation transitions", () => {
  it("uses the response from reserve and prevents duplicate requests", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onUpdated = vi.fn();
    render(<ReservationActions slot={slot} onUpdated={onUpdated} onReload={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Giữ chỗ" });
    fireEvent.click(button); fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(`/parking-slots/${slot.id}/reserve`, { method: "POST" });
    expect(onUpdated).not.toHaveBeenCalled();
    const updated = { ...slot, status: "RESERVED" as const };
    resolve(updated);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  });
  it.each([['Hủy giữ chỗ', 'cancel-reservation'], ['Xác nhận xe đến', 'confirm-arrival']])("sends %s only for a reserved slot", async (label, action) => {
    vi.mocked(apiFetch).mockResolvedValue({ ...slot, status: "EMPTY" });
    render(<ReservationActions slot={{ ...slot, status: "RESERVED" }} onUpdated={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Giữ chỗ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/parking-slots/${slot.id}/${action}`, { method: "POST" }));
  });
  it("reloads on a stale-state conflict without claiming success", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Expected EMPTY, current status is OCCUPIED"));
    const onUpdated = vi.fn(), onReload = vi.fn().mockResolvedValue(undefined);
    render(<ReservationActions slot={slot} onUpdated={onUpdated} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Giữ chỗ" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled(); expect(onReload).toHaveBeenCalledOnce();
  });
  it("requires the exact backend admin role even with parking:manage", () => {
    vi.mocked(getClaims).mockReturnValue({ sub: "2", user_id: 2, role: "Operator", permissions: ["parking:manage"], exp: 9999999999 });
    render(<ReservationActions slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("never writes in demo mode or after cancelling confirmation", () => {
    vi.mocked(isDemoMode).mockReturnValue(true);
    const view = render(<ReservationActions slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Giữ chỗ" }));
    expect(apiFetch).not.toHaveBeenCalled();
    view.unmount(); vi.mocked(isDemoMode).mockReturnValue(false); vi.mocked(window.confirm).mockReturnValue(false);
    render(<ReservationActions slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Giữ chỗ" }));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
