import { useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { apiFetch, isDemoMode } from "./api";
import { EmptyState, InlineNotice } from "./components";
import type { Permission } from "./types";

type Draft = { id?: number; name: string; code: string; module: string; description: string };
export function PermissionCatalog({ permissions, onSaved }: { permissions: Permission[]; onSaved: (permission: Permission) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || inFlight.current) return;
    const payload = { name: draft.name.trim(), code: draft.code.trim(), module: draft.module.trim(), description: draft.description.trim() || null };
    if (!payload.name || !payload.code || !payload.module) { setNotice("Tên, mã và nhóm quyền không được để trống."); return; }
    if (draft.id && !window.confirm(`Lưu thay đổi quyền ${draft.code}? Các vai trò đang dùng quyền này cũng bị ảnh hưởng.`)) return;
    if (isDemoMode()) { setNotice("Bản xem giao diện không lưu permission vào hệ thống."); setDraft(null); return; }
    setBusy(true); inFlight.current = true; setNotice("");
    try {
      const permission = await apiFetch<Permission>(`/permissions/${draft.id ?? ""}`, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      onSaved(permission); setDraft(null); setNotice("Đã lưu quyền.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Không lưu được quyền"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section className="panel permission-catalog">
    <div className="access-heading"><div><h2>Danh mục quyền</h2><p>Mã quyền cần khớp với quyền mà backend kiểm tra.</p></div><button className="secondary-button" disabled={busy} onClick={() => { setNotice(""); setDraft({ name: "", code: "", module: "", description: "" }); }}><Plus size={16} />Thêm quyền</button></div>
    {notice && <InlineNotice tone={notice.startsWith("Đã") ? "success" : "warning"}>{notice}</InlineNotice>}
    {draft && <form className="management-form" onSubmit={save} aria-busy={busy}><h3>{draft.id ? "Chỉnh sửa quyền" : "Tạo quyền mới"}</h3><fieldset disabled={busy} className="form-fields">
      <label>Tên quyền<input autoFocus required maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Mã quyền<input required maxLength={100} placeholder="parking:view" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></label>
      <label>Nhóm quyền<input required maxLength={50} value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })} /></label>
      <label>Mô tả quyền<input maxLength={255} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    </fieldset><div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(null)}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? "Đang lưu…" : "Lưu quyền"}</button></div></form>}
    <div className="data-table-wrap">{permissions.length ? <table><caption className="sr-only">Danh mục quyền truy cập</caption><thead><tr><th>Tên quyền</th><th>Mã quyền</th><th>Nhóm</th><th>Thao tác</th></tr></thead><tbody>{permissions.map((permission) => <tr key={permission.id}><td><b>{permission.name}</b><small className="table-sub">{permission.description}</small></td><td><code>{permission.code}</code></td><td>{permission.module}</td><td><div className="table-actions"><button disabled={busy} aria-label={`Sửa quyền ${permission.code}`} onClick={() => { setNotice(""); setDraft({ ...permission, description: permission.description ?? "" }); }}><Pencil size={13} />Sửa</button></div></td></tr>)}</tbody></table> : <EmptyState title="Chưa có quyền" text="Tạo quyền trước khi gán vào vai trò." />}</div>
  </section>;
}
