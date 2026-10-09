import { useEffect, useState } from "react";
import { Camera, Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch, clearTokens, getClaims, isDemoMode } from "../api";
import { AppShell, EmptyState, InlineNotice } from "../components";
import { demoCameras, demoRoles, demoUsers } from "../demo";
import type { Camera as CameraType, Page, Role, User } from "../types";

type Draft = { id?: number; full_name: string; username: string; password: string; role_id: number; status: string; name: string; source_type: string; source_url: string };
const blank: Draft = { full_name: "", username: "", password: "", role_id: 1, status: "ACTIVE", name: "", source_type: "RTSP", source_url: "" };

export function ManagementPage() {
  const navigate = useNavigate();
  const permissions = getClaims()?.permissions ?? [];
  const canUsers = isDemoMode() || permissions.includes("user:view"), canCameras = isDemoMode() || permissions.includes("camera:view");
  const [tab, setTab] = useState<"users" | "cameras">(canUsers ? "users" : "cameras");
  const canManage = isDemoMode() || permissions.includes(tab === "users" ? "user:manage" : "camera:manage");
  const [users, setUsers] = useState<User[]>([]), [cameras, setCameras] = useState<CameraType[]>([]), [roles, setRoles] = useState<Role[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [pages, setPages] = useState(1);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("");
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (isDemoMode()) { setRoles(demoRoles); return; }
    if (permissions.includes("role:manage")) void apiFetch<Role[]>("/roles/").then(setRoles).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setBusy(true); setLoadError("");
    async function load() {
      try {
        if (isDemoMode()) {
          const items = (tab === "users" ? demoUsers : demoCameras).filter((item) => !filter || item.status === filter);
          if (tab === "users") setUsers(items.slice((page - 1) * 20, page * 20) as User[]); else setCameras(items.slice((page - 1) * 20, page * 20) as CameraType[]);
          setTotal(items.length); setPages(Math.max(1, Math.ceil(items.length / 20)));
        } else {
          const result = await apiFetch<Page<User | CameraType>>(`/${tab}/?page=${page}&page_size=20${filter ? `&status=${filter}` : ""}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
          if (active) { if (tab === "users") setUsers(result.data as User[]); else setCameras(result.data as CameraType[]); setTotal(result.meta.total); setPages(Math.max(1, result.meta.total_pages)); }
        }
      } catch (e) { if (active) setLoadError(e instanceof Error ? e.message : "Không tải được danh sách"); }
      finally { if (active) setBusy(false); }
    }
    void load(); return () => { active = false; controller.abort(); };
  }, [tab, page, filter, refresh]);
  const filteredUsers = users.filter((u) => `${u.full_name} ${u.username}`.toLowerCase().includes(query.toLowerCase()));
  const filteredCameras = cameras.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  function switchTab(next: "users" | "cameras") { setTab(next); setPage(1); setQuery(""); setFilter(""); setDraft(null); }
  function field(key: keyof Draft, value: string | number) { setDraft((old) => old ? { ...old, [key]: value } : old); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !canManage || saving) return;
    if (tab === "users" && new TextEncoder().encode(draft.password).length > 72) { setNotice("Mật khẩu không được vượt quá 72 byte UTF-8."); return; }
    setSaving(true); setNotice("");
    try {
      const original = users.find((user) => user.id === draft.id);
      const payload = tab === "users" ? { username: draft.username.trim(), full_name: draft.full_name.trim(),
        ...(!draft.id || draft.role_id !== original?.role_id ? { role_id: draft.role_id } : {}),
        ...(!draft.id || draft.status !== original?.status ? { status: draft.status } : {}), ...(draft.password ? { password: draft.password } : {}) }
        : { name: draft.name.trim(), source_type: draft.source_type, source_url: draft.source_url.trim(), status: draft.status };
      if (isDemoMode()) { setNotice("Đây là bản xem giao diện; không ghi tài khoản hoặc camera vào hệ thống."); setDraft(null); return; }
      await apiFetch(`/${tab}/${draft.id ?? ""}`, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (tab === "users" && draft.id === getClaims()?.user_id && ("role_id" in payload || "status" in payload || draft.password)) { clearTokens(); navigate("/login", { replace: true }); return; }
      setDraft(null); setRefresh((old) => old + 1); setNotice("Đã lưu thay đổi.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Không lưu được thay đổi"); }
    finally { setSaving(false); }
  }
  async function act(item: User | CameraType, action: "status" | "delete") {
    if (!canManage || saving || busy || loadError) return;
    const label = "username" in item ? item.username : item.name;
    const nextStatus = tab === "users" ? item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" : item.status === "CONNECTED" ? "DISCONNECTED" : "CONNECTED";
    const warning = action === "delete" ? `Xóa ${label}? Thao tác này không thể hoàn tác.${tab === "cameras" ? " Camera có ô đỗ hoặc thống kê sẽ bị backend từ chối xóa." : " Các phiên đăng nhập của tài khoản sẽ bị thu hồi."}` : `Đổi trạng thái ${label} sang ${nextStatus}?${tab === "users" ? " Các phiên đăng nhập sẽ bị thu hồi." : " Thao tác chỉ cập nhật trạng thái đã lưu, không bật/tắt tiến trình AI."}`;
    if (!window.confirm(warning)) return;
    if (isDemoMode()) { setNotice("Bản xem giao diện không thay đổi tài khoản hoặc camera trong hệ thống."); return; }
    setSaving(true); setNotice("");
    try {
      await apiFetch(`/${tab}/${item.id}${action === "status" ? "/status" : ""}`, {
        method: action === "status" ? "PATCH" : "DELETE", body: action === "status" ? JSON.stringify({ status: nextStatus }) : undefined
      });
      if (tab === "users" && item.id === getClaims()?.user_id) { clearTokens(); navigate("/login", { replace: true }); return; }
      setDraft(null); setNotice(action === "delete" ? "Đã xóa bản ghi." : "Đã cập nhật trạng thái.");
      if (action === "delete" && (tab === "users" ? users : cameras).length === 1 && page > 1) setPage(page - 1);
      else setRefresh((old) => old + 1);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Không cập nhật được bản ghi"); }
    finally { setSaving(false); }
  }
  return <AppShell eyebrow="Quản lý" title="Tài khoản & nguồn camera" actions={<><button className="secondary-button" disabled={busy || saving} onClick={() => setRefresh((old) => old + 1)}><RefreshCw size={17} />Làm mới</button>{canManage && <button className="primary-button" disabled={saving} onClick={() => setDraft({ ...blank, role_id: roles[0]?.id ?? 1, status: tab === "users" ? "ACTIVE" : "DISCONNECTED" })}><Plus size={17} />{tab === "users" ? "Thêm tài khoản" : "Thêm camera"}</button>}</>}>
    {notice && <InlineNotice tone={notice.startsWith("Đã") ? "success" : "warning"}>{notice}</InlineNotice>}
    {loadError && <InlineNotice tone="error">{loadError} · Danh sách hiện tại có thể đã cũ.</InlineNotice>}
    <div className="management-toolbar"><div className="tab-switch">{canUsers && <button aria-pressed={tab === "users"} disabled={saving} className={tab === "users" ? "active" : ""} onClick={() => switchTab("users")}><Users size={17} />Tài khoản</button>}{canCameras && <button aria-pressed={tab === "cameras"} disabled={saving} className={tab === "cameras" ? "active" : ""} onClick={() => switchTab("cameras")}><Camera size={17} />Camera</button>}</div><label className="search-field"><Search size={17} /><span className="sr-only">Tìm trong trang hiện tại</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm trong trang này…" /></label><label className="management-status"><span className="sr-only">Lọc trạng thái quản lý</span><select disabled={saving} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="">Tất cả trạng thái</option>{(tab === "users" ? [["ACTIVE", "Hoạt động"], ["INACTIVE", "Ngừng hoạt động"]] : [["CONNECTED", "Đã kết nối"], ["DISCONNECTED", "Chưa kết nối"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {draft && <form className="panel management-form" onSubmit={save}><h2>{draft.id ? "Chỉnh sửa" : "Tạo mới"} {tab === "users" ? "tài khoản" : "nguồn camera"}</h2><fieldset disabled={saving} className="form-fields">{tab === "users" ? <>
      <label>Họ và tên<input autoFocus required maxLength={100} value={draft.full_name} onChange={(e) => field("full_name", e.target.value)} /></label><label>Tên đăng nhập<input required maxLength={50} autoComplete="off" value={draft.username} onChange={(e) => field("username", e.target.value)} /></label>
      <label>Mật khẩu{draft.id ? " mới (không đổi nếu để trống)" : ""}<input type="password" required={!draft.id} minLength={6} autoComplete="new-password" value={draft.password} onChange={(e) => field("password", e.target.value)} /><small>Tối thiểu 6 ký tự, tối đa 72 byte UTF-8.</small></label>
      <label>Vai trò{roles.length ? <select value={draft.role_id} onChange={(e) => field("role_id", Number(e.target.value))}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select> : <input type="number" min={1} required value={draft.role_id} onChange={(e) => field("role_id", Number(e.target.value))} />}<small>{roles.length ? "Vai trò quyết định quyền truy cập." : "Nhập Role ID có sẵn; cần quyền quản lý vai trò để xem tên."}</small></label>
    </> : <><label>Tên camera<input autoFocus required maxLength={100} value={draft.name} onChange={(e) => field("name", e.target.value)} /></label><label>Loại nguồn<select value={draft.source_type} onChange={(e) => field("source_type", e.target.value)}><option value="RTSP">Camera RTSP</option><option value="VIDEO_FILE">Tệp video</option></select></label><label className="full-width">Đường dẫn nguồn<input required maxLength={255} value={draft.source_url} onChange={(e) => field("source_url", e.target.value)} /><small>Lưu cấu hình camera không tự khởi động tiến trình AI hay phát video.</small></label></>}
      <label>Trạng thái<select value={draft.status} onChange={(e) => field("status", e.target.value)}>{(tab === "users" ? [["ACTIVE", "Hoạt động"], ["INACTIVE", "Ngừng hoạt động"]] : [["CONNECTED", "Đã kết nối"], ["DISCONNECTED", "Chưa kết nối"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></fieldset>
      {tab === "users" && draft.id && <p className="supporting-text">Đổi vai trò, mật khẩu hoặc trạng thái sẽ thu hồi phiên đăng nhập của tài khoản theo quy tắc backend.</p>}
      <div className="form-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setDraft(null)}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button></div></form>}
    <section className="panel data-table-wrap"><div className="table-heading"><b>{tab === "users" ? "Danh sách tài khoản" : "Nguồn camera"}</b><span>{total} bản ghi · {busy ? "Đang tải…" : `Trang ${page}/${pages}`}</span></div>{(tab === "users" ? filteredUsers.length : filteredCameras.length) ? <table><thead><tr>{(tab === "users" ? ["Họ tên", "Tên đăng nhập", "Vai trò", "Trạng thái"] : ["Camera", "Nguồn", "Cập nhật", "Trạng thái"]).map((label) => <th key={label}>{label}</th>)}{canManage && <th>Thao tác</th>}</tr></thead><tbody>{tab === "users" ? filteredUsers.map((u) => <tr key={u.id}><td><div className="record-identity"><span className="record-avatar" aria-hidden="true">{u.full_name.trim().slice(0, 1).toUpperCase()}</span><span><b>{u.full_name}</b><small className="table-sub">#{u.id}</small></span></div></td><td>{u.username}</td><td>{roles.find((r) => r.id === u.role_id)?.name ?? `Role #${u.role_id}`}</td><td><span className={`table-status ${u.status === "ACTIVE" ? "success" : "muted"}`}>{u.status === "ACTIVE" ? "Hoạt động" : "Ngừng hoạt động"}</span></td>{canManage && <td><div className="table-actions"><button disabled={saving || busy || !!loadError} aria-label={`Sửa tài khoản ${u.username}`} onClick={() => setDraft({ ...blank, ...u, password: "" })}><Pencil size={13} />Sửa</button><button disabled={saving || busy || !!loadError} aria-label={`Đổi trạng thái tài khoản ${u.username}`} onClick={() => void act(u, "status")}>{u.status === "ACTIVE" ? "Khóa" : "Mở khóa"}</button><button className="danger" disabled={saving || busy || !!loadError} aria-label={`Xóa tài khoản ${u.username}`} onClick={() => void act(u, "delete")}><Trash2 size={13} />Xóa</button></div></td>}</tr>) : filteredCameras.map((c) => <tr key={c.id}><td><div className="record-identity"><span className="record-avatar" aria-hidden="true"><Camera size={18} /></span><span><b>{c.name}</b><small className="table-sub">Camera #{c.id}</small></span></div></td><td>{c.source_type === "RTSP" ? "Camera RTSP" : "Tệp video"}</td><td>{new Date(c.updated_at).toLocaleString("vi-VN")}</td><td><span className={`table-status ${c.status === "CONNECTED" ? "success" : "muted"}`}>{c.status === "CONNECTED" ? "Đã kết nối" : "Chưa kết nối"}</span></td>{canManage && <td><div className="table-actions"><button disabled={saving || busy || !!loadError} aria-label={`Sửa camera ${c.name}`} onClick={() => setDraft({ ...blank, ...c })}><Pencil size={13} />Sửa</button><button disabled={saving || busy || !!loadError} aria-label={`Đổi trạng thái camera ${c.name}`} onClick={() => void act(c, "status")}>{c.status === "CONNECTED" ? "Đánh dấu mất kết nối" : "Đánh dấu đã kết nối"}</button><button className="danger" disabled={saving || busy || !!loadError} aria-label={`Xóa camera ${c.name}`} onClick={() => void act(c, "delete")}><Trash2 size={13} />Xóa</button></div></td>}</tr>)}</tbody></table> : <EmptyState title={busy ? "Đang tải danh sách" : "Không có bản ghi phù hợp"} text="Thử đổi bộ lọc hoặc làm mới dữ liệu." />}<div className="pagination management-pagination"><span>20 bản ghi / trang · tìm kiếm trong trang hiện tại</span><button className="secondary-button" disabled={page <= 1 || busy || saving} onClick={() => setPage(page - 1)}>Trước</button><button className="secondary-button" disabled={page >= pages || busy || saving} onClick={() => setPage(page + 1)}>Sau</button></div></section>
  </AppShell>;
}
