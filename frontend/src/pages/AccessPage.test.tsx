// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apiFetch, isDemoMode } from "../api";
import { demoPermissions, demoRoles } from "../demo";
import { AccessPage } from "./AccessPage";

vi.mock("../api", () => ({ apiFetch: vi.fn(), getClaims: () => ({ user_id: 99, role: "Administrator", permissions: ["role:manage"] }), isDemoMode: vi.fn(), clearTokens: vi.fn() }));
beforeEach(() => {
  vi.mocked(isDemoMode).mockReturnValue(false);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(apiFetch).mockImplementation(async (path) => path === "/roles/" ? demoRoles : demoPermissions as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
const mount = () => render(<MemoryRouter initialEntries={["/access"]}><AccessPage /></MemoryRouter>);
describe("role and permission administration", () => {
  it("edits roles using PUT and keeps permissions from the response", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method === "PUT" ? { ...demoRoles[0], name: "Admin mới" } : path === "/roles/" ? demoRoles : demoPermissions as never);
    mount(); await screen.findByText("Vai trò: Administrator");
    fireEvent.click(screen.getByRole("button", { name: "Sửa vai trò" }));
    fireEvent.change(screen.getByLabelText("Tên vai trò"), { target: { value: "Admin mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu vai trò" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/roles/1", { method: "PUT", body: JSON.stringify({ name: "Admin mới", description: demoRoles[0].description }) }));
    expect(await screen.findByText("Vai trò: Admin mới")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gỡ quyền Xem bãi đỗ" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("retains a role on an assigned-users conflict", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (init?.method === "DELETE") throw new Error("Role is assigned to users");
      return path === "/roles/" ? demoRoles : demoPermissions as never;
    });
    mount(); await screen.findByText("Vai trò: Administrator");
    fireEvent.click(screen.getByRole("button", { name: "Xóa vai trò" }));
    expect(await screen.findByText("Role is assigned to users")).toBeTruthy();
    expect(screen.getByText("Vai trò: Administrator")).toBeTruthy();
  });
  it("creates a permission using the exact backend schema", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method === "POST" ? { id: 9, code: "custom:view", name: "Quyền mới", module: "custom", description: null } : path === "/roles/" ? demoRoles : demoPermissions as never);
    mount(); await screen.findByText("Vai trò: Administrator");
    fireEvent.click(screen.getByRole("button", { name: "Thêm quyền" }));
    fireEvent.change(screen.getByLabelText("Tên quyền"), { target: { value: "Quyền mới" } });
    fireEvent.change(screen.getByLabelText("Mã quyền"), { target: { value: "custom:view" } });
    fireEvent.change(screen.getByLabelText("Nhóm quyền"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu quyền" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/permissions/", { method: "POST", body: JSON.stringify({ name: "Quyền mới", code: "custom:view", module: "custom", description: null }) }));
    expect(await screen.findByRole("button", { name: "Sửa quyền custom:view" })).toBeTruthy();
  });
  it("updates the catalog and assigned-role matrix after editing a permission", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method === "PUT" ? { ...demoPermissions[0], name: "Xem vị trí" } : path === "/roles/" ? demoRoles : demoPermissions as never);
    mount(); await screen.findByText("Vai trò: Administrator");
    fireEvent.click(screen.getByRole("button", { name: "Sửa quyền parking:view" }));
    fireEvent.change(screen.getByLabelText("Tên quyền"), { target: { value: "Xem vị trí" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu quyền" }));
    expect(await screen.findByRole("button", { name: "Gỡ quyền Xem vị trí" })).toBeTruthy();
    expect(screen.getAllByText("Xem vị trí")).toHaveLength(2);
  });
  it("blocks all backend writes in demo mode", () => {
    vi.mocked(isDemoMode).mockReturnValue(true);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Xóa vai trò" }));
    fireEvent.click(screen.getByRole("button", { name: "Gỡ quyền Xem bãi đỗ" }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Gỡ quyền Xem bãi đỗ" }).getAttribute("aria-pressed")).toBe("true");
  });
});
