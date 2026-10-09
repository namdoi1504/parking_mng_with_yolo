// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ManagementPage } from "./ManagementPage";
import { apiFetch, getClaims } from "../api";
import { demoCameras, demoRoles, demoUsers } from "../demo";
vi.mock("../api", () => ({ apiFetch: vi.fn(), getClaims: vi.fn(), isDemoMode: () => false, clearTokens: vi.fn() }));
beforeEach(() => {
  vi.mocked(getClaims).mockReturnValue({ sub: "test", user_id: 99, role: "Admin", exp: 9999999999,
    permissions: ["user:view", "user:manage", "camera:view", "camera:manage", "role:manage"] });
  vi.mocked(apiFetch).mockImplementation(async (path) => path === "/roles/" ? demoRoles : { data: path.startsWith("/users") ? demoUsers : [], meta: { total: 18, total_pages: 1 } } as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mount = () => render(<MemoryRouter initialEntries={["/management"]}><ManagementPage /></MemoryRouter>);
describe("management forms against mocked API only", () => {
  it("does not revoke sessions when only profile fields are saved", async () => {
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: "Sửa tài khoản user1" }));
    fireEvent.change(screen.getByLabelText("Họ và tên"), { target: { value: "Tên mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/users/1", expect.objectContaining({ method: "PUT" })));
    const call = vi.mocked(apiFetch).mock.calls.find(([path, init]) => path === "/users/1" && init?.method === "PUT")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ username: "user1", full_name: "Tên mới" });
  });
  it("locks a user with the status endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: "Đổi trạng thái tài khoản user1" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/users/1/status", { method: "PATCH", body: JSON.stringify({ status: "INACTIVE" }) }));
    vi.restoreAllMocks();
  });
  it("preserves a camera when backend refuses deletion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (init?.method === "DELETE") throw new Error("Camera has parking slots or statistics");
      return path === "/roles/" ? demoRoles : { data: path.startsWith("/users") ? demoUsers : demoCameras, meta: { total: 1, total_pages: 1 } } as never;
    });
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: /^Camera$/ }));
    const remove = await screen.findByRole("button", { name: `Xóa camera ${demoCameras[0].name}` });
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(remove);
    expect(await screen.findByText("Camera has parking slots or statistics")).toBeTruthy();
    expect(screen.getByText(demoCameras[0].name)).toBeTruthy();
    vi.restoreAllMocks();
  });
  it("does not delete when confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: "Xóa tài khoản user1" }));
    expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    vi.restoreAllMocks();
  });
  it("creates camera configuration without claiming to start AI", async () => {
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: /^Camera$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Thêm camera" }));
    fireEvent.change(screen.getByLabelText("Tên camera"), { target: { value: "Test camera" } });
    fireEvent.change(screen.getByLabelText("Loại nguồn"), { target: { value: "VIDEO_FILE" } });
    fireEvent.change(screen.getByLabelText(/^Đường dẫn nguồn/), { target: { value: "file:///test.mp4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path, init]) => path === "/cameras/" && init?.method === "POST")).toBe(true));
    const call = vi.mocked(apiFetch).mock.calls.find(([path, init]) => path === "/cameras/" && init?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ name: "Test camera", source_type: "VIDEO_FILE", source_url: "file:///test.mp4", status: "DISCONNECTED" });
  });
  it("creates a user with the backend schema", async () => {
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: "Thêm tài khoản" }));
    fireEvent.change(screen.getByLabelText("Họ và tên"), { target: { value: "Test Operator" } });
    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: "test-operator" } });
    fireEvent.change(screen.getByLabelText(/^Mật khẩu/), { target: { value: "test-only-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path, init]) => path === "/users/" && init?.method === "POST")).toBe(true));
    const call = vi.mocked(apiFetch).mock.calls.find(([path, init]) => path === "/users/" && init?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ username: "test-operator", full_name: "Test Operator", password: "test-only-pass", role_id: 1, status: "ACTIVE" });
  });
  it("does not send a blank password when editing a user", async () => {
    mount(); await screen.findByText("Nguyễn Văn Admin");
    fireEvent.click(screen.getByRole("button", { name: "Sửa tài khoản user1" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path, init]) => path === "/users/1" && init?.method === "PUT")).toBe(true));
    const call = vi.mocked(apiFetch).mock.calls.find(([path, init]) => path === "/users/1" && init?.method === "PUT")!;
    expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty("password");
  });
  it("hides write actions for a read-only user", async () => {
    vi.mocked(getClaims).mockReturnValue({ sub: "test", user_id: 99, role: "Viewer", exp: 9999999999, permissions: ["user:view"] });
    mount(); await screen.findByText("Nguyễn Văn Admin");
    expect(screen.queryByRole("button", { name: "Thêm tài khoản" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sửa tài khoản user1" })).toBeNull();
  });
});
