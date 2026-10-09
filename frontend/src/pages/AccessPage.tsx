import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Search, ShieldCheck, Trash2, Users } from "lucide-react";
import { apiFetch, getClaims, isDemoMode } from "../api";
import { AppShell, EmptyState, InlineNotice } from "../components";
import { demoPermissions, demoRoles, demoUsers } from "../demo";
import type { Page, Permission, Role, User } from "../types";
import { PermissionCatalog } from "../PermissionCatalog";

export function AccessPage() {
  const [roles, setRoles] = useState<Role[]>(isDemoMode() ? demoRoles : []);
  const [permissions, setPermissions] = useState<Permission[]>(isDemoMode() ? demoPermissions : []);
  const [users, setUsers] = useState<User[]>(isDemoMode() ? demoUsers : []);
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? 0);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [newRole, setNewRole] = useState<{ id?: number; name: string; description: string } | null>(null);
  async function load() {
    if (isDemoMode()) return;
    try { const [r, p] = await Promise.all([apiFetch<Role[]>("/roles/"), apiFetch<Permission[]>("/permissions/")]); setRoles(r); setPermissions(p); setSelectedId((old) => old || r[0]?.id || 0); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Không tải được dữ liệu phân quyền"); }
  }
  useEffect(() => { void load(); if (!isDemoMode() && getClaims()?.permissions.includes("user:view")) void apiFetch<Page<User>>("/users/?page_size=100").then((page) => setUsers(page.data)).catch(() => setNotice("Không tải được danh sách tài khoản; ma trận quyền vẫn khả dụng.")); }, []);
  const selected = roles.find((role) => role.id === selectedId);
  async function createRole(event: React.FormEvent) {
    event.preventDefault(); if (!newRole || saving) return;
    setSaving(true);
    try {
      if (isDemoMode()) { setNotice("Bản xem giao diện không lưu vai trò vào hệ thống."); setNewRole(null); return; }
      if (!newRole.name.trim()) { setNotice("Tên vai trò không được để trống."); return; }
      const role = await apiFetch<Role>(`/roles/${newRole.id ?? ""}`, { method: newRole.id ? "PUT" : "POST", body: JSON.stringify({ name: newRole.name.trim(), description: newRole.description.trim() || null }) });
      setRoles((old) => newRole.id ? old.map((item) => item.id === role.id ? role : item) : [...old, role]); setSelectedId(role.id); setNewRole(null); setNotice("Đã lưu vai trò.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Không tạo được vai trò"); }
    finally { setSaving(false); }
  }
  const filtered = permissions.filter((p) => `${p.name} ${p.code} ${p.module}`.toLowerCase().includes(query.toLowerCase()));
  async function deleteRole() {
    if (!selected || saving || !window.confirm(`Xóa vai trò ${selected.name}? Vai trò đang gán cho tài khoản sẽ bị backend từ chối xóa.`)) return;
    if (isDemoMode()) { setNotice("Bản xem giao diện không xóa vai trò trong hệ thống."); return; }
    setSaving(true); setNotice("");
    try {
      await apiFetch(`/roles/${selected.id}`, { method: "DELETE" });
      const remaining = roles.filter((role) => role.id !== selected.id);
      setRoles(remaining); setSelectedId(remaining[0]?.id ?? 0); setNewRole(null); setNotice("Đã xóa vai trò.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Không xóa được vai trò"); }
    finally { setSaving(false); }
  }
  async function toggle(permission: Permission) {
    if (!selected || saving) return; const has = selected.permissions.some((p) => p.id === permission.id);
    if (!window.confirm(`${has ? "Gỡ" : "Gán"} quyền ${permission.name} cho vai trò ${selected.name}? Thay đổi ảnh hưởng tất cả tài khoản thuộc vai trò này.`)) return;
    setSaving(true);
    try {
      if (isDemoMode()) { setNotice("Bản xem giao diện không thay đổi quyền của vai trò trong hệ thống."); return; }
      const updated = await apiFetch<Role | undefined>(has ? `/roles/${selected.id}/permissions/${permission.id}` : `/roles/${selected.id}/permissions`, { method: has ? "DELETE" : "POST", body: has ? undefined : JSON.stringify({ permission_id: permission.id }) });
      setRoles((current) => current.map((role) => role.id === selected.id ? updated ?? { ...role, permissions: role.permissions.filter((p) => p.id !== permission.id) } : role));
      setNotice("Đã cập nhật quyền của vai trò.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Không cập nhật được quyền"); }
    finally { setSaving(false); }
  }
  const moduleGroups = useMemo(() => Object.entries(filtered.reduce<Record<string, Permission[]>>((acc, item) => { (acc[item.module] ??= []).push(item); return acc; }, {})), [filtered]);
  return <AppShell eyebrow="Quản lý" title="Phân quyền theo vai trò" actions={<button className="primary-button" disabled={saving} onClick={() => setNewRole({ name: "", description: "" })}><Plus size={17} />Thêm vai trò</button>}>
    {notice && <InlineNotice tone={notice.startsWith("Đã") ? "success" : "info"}>{notice}</InlineNotice>}
    {newRole && <form className="panel management-form" onSubmit={createRole}><h2>{newRole.id ? "Chỉnh sửa vai trò" : "Tạo vai trò mới"}</h2><fieldset disabled={saving} className="form-fields"><label>Tên vai trò<input autoFocus required maxLength={50} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} /></label><label>Mô tả<input maxLength={255} value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} /></label></fieldset>{roles.find((role) => role.id === newRole.id)?.name === "Administrator" && <p className="supporting-text">Tên vai trò Administrator được dùng để cấp quyền điều hành giữ chỗ. Đổi tên sẽ làm mất quyền này.</p>}<div className="form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setNewRole(null)}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? "Đang lưu…" : "Lưu vai trò"}</button></div></form>}
    <div className="metric-grid"><article><span>TỔNG SỐ VAI TRÒ</span><strong>{roles.length}</strong><small>Vai trò đã cấu hình</small></article><article><span>TÀI KHOẢN HOẠT ĐỘNG</span><strong>{isDemoMode() || getClaims()?.permissions.includes("user:view") ? users.filter((u) => u.status === "ACTIVE").length : "—"}</strong><small>Trong {users.length} tài khoản đã tải (tối đa 100)</small></article><article><span>QUYỀN HỆ THỐNG</span><strong>{permissions.length}</strong><small>Được backend công bố</small></article><article><span>PHẠM VI QUYỀN</span><strong>{selected ? Math.round(selected.permissions.length / Math.max(permissions.length, 1) * 100) : 0}%</strong><small>Vai trò đang chọn</small></article></div>
    <div className="role-actions"><span>{selected ? `Vai trò: ${selected.name}` : "Chọn vai trò để quản lý"}</span><button className="secondary-button" disabled={saving || !selected} onClick={() => selected && setNewRole({ id: selected.id, name: selected.name, description: selected.description ?? "" })}><Pencil size={16} />Sửa vai trò</button><button className="secondary-button danger-button" disabled={saving || !selected} onClick={() => void deleteRole()}><Trash2 size={16} />Xóa vai trò</button></div><section className="panel access-panel"><div className="access-heading"><div><h2>Quyền của vai trò</h2><p>Chọn vai trò bên trái, sau đó điều chỉnh quyền truy cập.</p></div><label className="search-field"><Search size={17} /><span className="sr-only">Tìm quyền</span><input placeholder="Tìm quyền, mã quyền..." value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
      <div className="access-layout"><div className="role-list">{roles.map((role, index) => <button disabled={saving} aria-pressed={role.id === selectedId} key={role.id} className={role.id === selectedId ? "active" : ""} onClick={() => setSelectedId(role.id)}><span className={`role-dot color-${index % 4}`}><ShieldCheck size={16} aria-hidden="true" /></span><span><b>{role.name}</b><small>{role.description ?? "Chưa có mô tả"}</small><em>{users.filter((u) => u.role_id === role.id).length} tài khoản</em></span></button>)}</div>
      <div className="permission-matrix">{selected ? moduleGroups.map(([module, items]) => <section key={module}><h3>{module.toUpperCase()}</h3>{items.map((permission) => { const enabled = selected.permissions.some((item) => item.id === permission.id); return <div className="permission-row" key={permission.id}><span className="permission-icon"><ShieldCheck size={18} /></span><span><b>{permission.name}</b><small>{permission.code}</small></span><button disabled={saving} className={`permission-toggle ${enabled ? "on" : ""}`} onClick={() => void toggle(permission)} aria-pressed={enabled} aria-label={`${enabled ? "Gỡ" : "Gán"} quyền ${permission.name}`}>{enabled && <Check size={15} />}</button></div>; })}</section>) : <EmptyState title="Chưa có vai trò" text="Tạo vai trò để bắt đầu gán quyền." />}</div></div>
    </section>
    <PermissionCatalog permissions={permissions} onSaved={(permission) => {
      setPermissions((old) => old.some((item) => item.id === permission.id) ? old.map((item) => item.id === permission.id ? permission : item) : [...old, permission]);
      setRoles((old) => old.map((role) => ({ ...role, permissions: role.permissions.map((item) => item.id === permission.id ? permission : item) })));
    }} />
    <div className="access-footer-cards"><article><Users /><span><b>Cấp tài khoản mới</b><small>Thêm nhân viên trong mục Quản lý</small></span></article><article><ShieldCheck /><span><b>Quyền được kiểm tra tại backend</b><small>Thay đổi có hiệu lực ngay với phiên JWT cũ</small></span></article></div>
  </AppShell>;
}
