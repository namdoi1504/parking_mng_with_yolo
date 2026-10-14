// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReservationActions } from "./ReservationActions";
import { apiFetch, getClaims, isDemoMode } from "./api";
import { demoMap } from "./demo";
vi.mock("./api", () => ({ apiFetch: vi.fn(), getClaims: vi.fn(), isDemoMode: vi.fn() }));
const slot = demoMap.slots[0];
function fillCustomer() {
  fireEvent.change(screen.getByLabelText("Tên khách"), { target: { value: " Nguyễn An " } });
  fireEvent.change(screen.getByLabelText("Số điện thoại"), { target: { value: "0901234567" } });
  fireEvent.change(screen.getByLabelText("Biển số xe"), { target: { value: "30A-123.45" } });
}
beforeEach(() => {
  vi.mocked(isDemoMode).mockReturnValue(false);
  vi.mocked(getClaims).mockReturnValue({ sub: "1", user_id: 1, role: "Administrator", permissions: [], exp: 9999999999 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("session creation from a slot", () => {
  it("sends customer fields and prevents duplicate bookings", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onUpdated = vi.fn(); render(<ReservationActions slot={slot} onUpdated={onUpdated} onReload={vi.fn()} />);
    fillCustomer(); const button = screen.getByRole("button", { name: "Giữ chỗ" }); fireEvent.click(button); fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(`/parking-slots/${slot.id}/reserve`, { method: "POST", body: JSON.stringify({ customer_name: "Nguyễn An", phone_number: "0901234567", license_plate: "30A-123.45" }) });
    resolve({ ...slot, status: "RESERVED" }); await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  });
  it("registers an unknown vehicle without inventing arrival time", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...slot, status: "OCCUPIED" });
    render(<ReservationActions slot={{ ...slot, status: "UNKNOWN" }} onUpdated={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByLabelText(/Xe đến lúc/)).toBeNull();
    fillCustomer(); fireEvent.click(screen.getByRole("button", { name: "Đăng ký xe đang đỗ" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/parking-slots/${slot.id}/check-in`, { method: "POST", body: JSON.stringify({ customer_name: "Nguyễn An", phone_number: "0901234567", license_plate: "30A-123.45" }) }));
  });
  it.each([{ observation_ready: false }, { active_session_id: 10 }, { needs_reconciliation: true }])("does not offer booking for unavailable slots: %j", (metadata) => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    render(<ReservationActions slot={{ ...slot, ...metadata }} onUpdated={vi.fn()} onReload={vi.fn()} />); expect(screen.queryByRole("button", { name: "Giữ chỗ" })).toBeNull();
  });
  it("reconciles legacy slots", async () => {
    vi.mocked(apiFetch).mockResolvedValue(slot);
    render(<ReservationActions slot={{ ...slot, status: "RESERVED", needs_reconciliation: true }} onUpdated={vi.fn()} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Đối soát ô cũ" })); await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/parking-slots/${slot.id}/reconcile`, { method: "POST" }));
  });
  it("reloads on conflict without claiming success", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Slot already has an active session"));
    const onUpdated = vi.fn(), onReload = vi.fn().mockResolvedValue(undefined);
    render(<ReservationActions slot={slot} onUpdated={onUpdated} onReload={onReload} />); fillCustomer(); fireEvent.click(screen.getByRole("button", { name: "Giữ chỗ" }));
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(onUpdated).not.toHaveBeenCalled(); expect(onReload).toHaveBeenCalledOnce();
  });
  it("requires the exact backend admin role", () => {
    vi.mocked(getClaims).mockReturnValue({ sub: "2", user_id: 2, role: "Operator", permissions: ["parking:manage"], exp: 9999999999 });
    render(<ReservationActions slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />); expect(screen.queryByRole("button")).toBeNull();
  });
  it("never writes in demo mode", () => {
    vi.mocked(isDemoMode).mockReturnValue(true); render(<ReservationActions slot={slot} onUpdated={vi.fn()} onReload={vi.fn()} />);
    fillCustomer(); fireEvent.click(screen.getByRole("button", { name: "Giữ chỗ" })); expect(apiFetch).not.toHaveBeenCalled();
  });
});
