import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Camera, CarFront, Check, ChevronRight, CircleGauge, Compass, Info, LockKeyhole, LogOut, Map, Menu, ShieldCheck, TriangleAlert, Users, X } from "lucide-react";
import { apiFetch, clearTokens, getClaims, isDemoMode } from "./api";
import type { ParkingSlot, ParkingSummary, SlotStatus } from "./types";

const nav: { to: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { to: "/monitor", label: "Giám sát", icon: Camera },
  { to: "/map", label: "Bản đồ bãi đỗ", icon: Map },
  { to: "/statistics", label: "Thống kê", icon: BarChart3 },
  { to: "/lookup", label: "Tra cứu", icon: Compass },
  { to: "/access", label: "Phân quyền", icon: ShieldCheck },
  { to: "/management", label: "Quản lý", icon: Users }
];

export function canVisit(path: string) {
  if (isDemoMode()) return true;
  const claims = getClaims();
  if (!claims) return path === "/lookup";
  const required: Record<string, string[]> = { "/statistics": ["report:view"], "/access": ["role:manage"], "/management": ["user:view", "camera:view"] };
  return !required[path] || required[path].some((code) => claims.permissions.includes(code));
}

export type ConnectionState = "connecting" | "connected" | "disconnected" | "polling" | "demo";

export function ConnectionBadge({ label, state }: { label: string; state: ConnectionState }) {
  return <span className={`connection-pill connection-${state}`} role="status"><i aria-hidden="true" />{label}</span>;
}

export function AppShell({ children, title, eyebrow, actions, connection, connectionState = "connecting" }: { children: ReactNode; title: string; eyebrow: string; actions?: ReactNode; connection?: string; connectionState?: ConnectionState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const claims = getClaims();
  const publicLookup = location.pathname === "/lookup" && !claims && !isDemoMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false), [logoutError, setLogoutError] = useState("");
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true); setLogoutError("");
    try {
      if (!isDemoMode()) await apiFetch("/auth/logout", { method: "POST" });
      clearTokens(); navigate("/login", { replace: true });
    } catch (reason) { setLogoutError(`Chưa thu hồi được phiên đăng nhập: ${reason instanceof Error ? reason.message : "Không kết nối được backend"}. Thử đăng xuất lại.`); }
    finally { setLoggingOut(false); }
  }
  const menuButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
  useEffect(() => { if (menuOpen) closeButton.current?.focus(); else if (wasOpen.current) menuButton.current?.focus(); wasOpen.current = menuOpen; }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") setMenuOpen(false); }
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  return <div className={`app-shell workspace-${location.pathname.slice(1)}${publicLookup ? " public-shell" : ""}`}>
    {!publicLookup && <aside className={`sidebar ${menuOpen ? "open" : ""}`} id="main-sidebar">
      {menuOpen && <button ref={closeButton} className="sidebar-close icon-button" aria-label="Đóng menu điều hướng" onClick={() => setMenuOpen(false)}><X /></button>}
      <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 25V8h9a6 6 0 0 1 0 12h-4" stroke="white" strokeWidth="4" strokeLinecap="round" /><path d="m20 25 4-4" stroke="#ffe2a5" strokeWidth="4" strokeLinecap="round" /></svg></span><span><b>Imperia<span className="brand-accent">Smart</span></b><small>PARKING</small></span></div>
      <nav aria-label="Điều hướng chính">
        {[{ label: "Vận hành", paths: ["/monitor", "/map", "/lookup"] }, { label: "Báo cáo", paths: ["/statistics"] }, { label: "Quản trị", paths: ["/management", "/access"] }].map((group) => {
          const items = nav.filter((item) => group.paths.includes(item.to) && canVisit(item.to));
          return items.length > 0 && <div className="nav-group" key={group.label}><p className="nav-caption">{group.label}</p>{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <Icon size={19} /><span>{label}</span><ChevronRight size={17} />
        </NavLink>)}</div>;
        })}
      </nav>
      <div className="sidebar-footer"><b>IMPERIA GARDEN</b><span>Quản trị bãi đỗ thông minh</span></div>
    </aside>}
    <main className="main-content" inert={menuOpen || undefined}>
      <header className="topbar">
        {!publicLookup && <button ref={menuButton} className="icon-button mobile-menu" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} aria-expanded={menuOpen} aria-controls="main-sidebar" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button>}
        {publicLookup ? <div className="public-brand"><CarFront size={26} aria-hidden="true" /><b>Imperia<span>Smart</span></b></div> : <div className="breadcrumb"><b>{eyebrow}</b><span>/</span><span>{nav.find((item) => item.to === location.pathname)?.label ?? "Bảng điều khiển"}</span></div>}
        <div className="topbar-right">
          {connection && <ConnectionBadge label={connection} state={connectionState} />}
          <div className="user-pill"><span className="avatar">{claims?.role?.slice(0, 1) ?? "K"}</span><span><b>{claims ? `Tài khoản #${claims.user_id}` : "Khách tra cứu"}</b><small>{claims?.role ?? "Chỉ xem vị trí trống"}</small></span></div>
          {claims ? <button className="icon-button" disabled={loggingOut} aria-label="Đăng xuất và thu hồi phiên đăng nhập" onClick={() => void logout()}><LogOut size={18} /></button> : <button className="secondary-button" onClick={() => navigate("/login")}>Đăng nhập</button>}
        </div>
      </header>
      <section className="page-head">
        <div className="page-head-copy"><h1>{title}</h1><p>{subtitleFor(location.pathname)}</p></div>
        <div className="page-actions">{actions}</div>
      </section>
      {isDemoMode() && <InlineNotice tone="warning">Bản xem giao diện · dữ liệu minh họa, không phải trạng thái bãi đỗ thực tế.</InlineNotice>}
      {logoutError && <InlineNotice tone="error">{logoutError}<button className="secondary-button" onClick={() => { clearTokens(); navigate("/login", { replace: true }); }}>Chỉ xóa đăng nhập trên thiết bị này</button></InlineNotice>}
      {children}
      <footer className="workspace-footer"><span>ImperiaSmart / Parking Operations</span><span>Trạng thái nhận diện không thay thế kiểm tra thực tế</span></footer>
    </main>
    {menuOpen && <button className="sidebar-scrim visible" aria-label="Đóng menu" onClick={() => setMenuOpen(false)}><X /></button>}
  </div>;
}

function subtitleFor(path: string) {
  if (path === "/monitor") return "Xem camera, trạng thái ô đỗ và thay đổi mới nhất.";
  if (path === "/map") return "Chọn camera và ô đỗ để xem chi tiết hoặc giữ chỗ.";
  if (path === "/statistics") return "Xem tỷ lệ lấp đầy và xuất báo cáo theo ngày, giờ.";
  if (path === "/lookup") return "Chọn camera, tìm ô trống và xem vị trí trên bản đồ.";
  if (path === "/access") return "Chọn vai trò để xem và điều chỉnh quyền truy cập.";
  return "Quản lý tài khoản nhân viên và nguồn camera.";
}

export const statusMeta: Record<SlotStatus, { label: string; short: string }> = {
  EMPTY: { label: "Còn trống", short: "Trống" }, OCCUPIED: { label: "Đã đỗ", short: "Đã đỗ" },
  RESERVED: { label: "Đã giữ chỗ", short: "Giữ chỗ" }, UNKNOWN: { label: "Chưa xác định", short: "Chưa rõ" }
};

export function SummaryStrip({ summary }: { summary: ParkingSummary }) {
  const rows: [string, number, string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>][] = [
    ["Tổng vị trí", summary.total_slots, "total", Map], ["Trống", summary.empty_slots, "EMPTY", Check],
    ["Đã đỗ", summary.occupied_slots, "OCCUPIED", CarFront], ["Đã giữ chỗ", summary.reserved_slots, "RESERVED", LockKeyhole],
    ["Chưa xác định", summary.unknown_slots, "UNKNOWN", TriangleAlert]
  ];
  return <div className="summary-strip" aria-label="Tổng hợp trạng thái">
    {rows.map(([label, value, key, Icon]) => <div className={`summary-item status-${key}`} key={key}><span className="summary-icon"><Icon size={18} aria-hidden /></span><span className="summary-label">{label}</span><strong>{value}</strong><small>{key === "total" ? "Trong camera đang chọn" : `${summary.total_slots ? Math.round(value / summary.total_slots * 100) : 0}% tổng số ô`}</small></div>)}
  </div>;
}

export function ParkingGrid({ slots, selected, onSelect }: { slots: ParkingSlot[]; selected?: number; onSelect?: (slot: ParkingSlot) => void }) {
  return <div className="parking-grid" aria-label="Danh sách vị trí đỗ">
    {slots.map((slot) => onSelect ? <button type="button" key={slot.id} className={`parking-slot status-${slot.status} ${selected === slot.id ? "selected" : ""}`} onClick={() => onSelect(slot)} aria-pressed={selected === slot.id} aria-label={`${slot.slot_code}, Camera ${slot.camera_id}: ${statusMeta[slot.status].label}`}>
      <b>{slot.slot_code}</b><span /><small>{statusMeta[slot.status].short}</small>
    </button> : <div key={slot.id} className={`parking-slot status-${slot.status}`}><b>{slot.slot_code}</b><span /><small>Camera #{slot.camera_id}</small></div>)}
  </div>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><CircleGauge size={26} aria-hidden="true" /></span><b>{title}</b><span>{text}</span></div>;
}

export function InlineNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "error" | "success" }) {
  return <div className={`inline-notice ${tone}`} role={tone === "error" ? "alert" : "status"}><Info size={18} aria-hidden="true" />{children}</div>;
}
