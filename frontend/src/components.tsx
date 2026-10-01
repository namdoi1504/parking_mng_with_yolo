import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Camera, CarFront, ChevronRight, CircleGauge, Compass, LogOut, Map, Menu, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { clearTokens, getClaims, isDemoMode } from "./api";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
  useEffect(() => { if (menuOpen) closeButton.current?.focus(); else if (wasOpen.current) menuButton.current?.focus(); wasOpen.current = menuOpen; }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") setMenuOpen(false); }
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`} id="main-sidebar">
      {menuOpen && <button ref={closeButton} className="sidebar-close icon-button" aria-label="Đóng menu điều hướng" onClick={() => setMenuOpen(false)}><X /></button>}
      <div className="brand"><span className="brand-mark"><CarFront size={22} /></span><span><b>ImperiaSmart</b><small>Parking Platform</small></span></div>
      <nav aria-label="Điều hướng chính">
        <p className="nav-caption">Quản lý</p>
        {nav.filter((item) => canVisit(item.to)).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <Icon size={19} /><span>{label}</span><ChevronRight size={17} />
        </NavLink>)}
      </nav>
      <div className="sidebar-footer"><b>IMPERIA GARDEN</b><span>Quản trị bãi đỗ thông minh</span></div>
    </aside>
    <main className="main-content" inert={menuOpen || undefined}>
      <header className="topbar">
        <button ref={menuButton} className="icon-button mobile-menu" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} aria-expanded={menuOpen} aria-controls="main-sidebar" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button>
        <div className="breadcrumb"><b>{eyebrow}</b><span>/</span><span>{nav.find((item) => item.to === location.pathname)?.label ?? "Bảng điều khiển"}</span></div>
        <div className="topbar-right">
          {connection && <ConnectionBadge label={connection} state={connectionState} />}
          <div className="user-pill"><span className="avatar">{claims?.role?.slice(0, 1) ?? "K"}</span><span><b>{claims ? `Tài khoản #${claims.user_id}` : "Khách tra cứu"}</b><small>{claims?.role ?? "Chỉ xem vị trí trống"}</small></span></div>
          {claims ? <button className="icon-button" aria-label="Đăng xuất khỏi thiết bị này" onClick={() => { clearTokens(); navigate("/login"); }}><LogOut size={18} /></button> : <button className="secondary-button" onClick={() => navigate("/login")}>Đăng nhập</button>}
        </div>
      </header>
      <section className="page-head"><div><h1>{title}</h1><p>{subtitleFor(location.pathname)}</p></div><div className="page-actions">{actions}</div></section>
      {isDemoMode() && <InlineNotice tone="warning">Bản xem giao diện · dữ liệu minh họa, không phải trạng thái bãi đỗ thực tế.</InlineNotice>}
      {children}
      <footer className="workspace-footer"><span>ImperiaSmart / Parking Operations</span><span>Trạng thái nhận diện không thay thế kiểm tra thực tế</span></footer>
    </main>
    {menuOpen && <button className="sidebar-scrim visible" aria-label="Đóng menu" onClick={() => setMenuOpen(false)}><X /></button>}
  </div>;
}

function subtitleFor(path: string) {
  if (path === "/monitor") return "Theo dõi trạng thái ô đỗ và luồng cập nhật AI theo thời gian thực.";
  if (path === "/map") return "Xem toàn bộ vị trí đỗ, lọc trạng thái và kiểm tra từng ô theo camera.";
  if (path === "/statistics") return "Phân tích tỷ lệ lấp đầy theo giờ và xu hướng vận hành bãi xe.";
  if (path === "/lookup") return "Tra cứu các vị trí còn trống theo dữ liệu nhận diện mới nhất.";
  if (path === "/access") return "Quản lý vai trò và ma trận quyền truy cập hiện có của hệ thống.";
  return "Quản lý tài khoản và nguồn camera kết nối với hệ thống.";
}

export const statusMeta: Record<SlotStatus, { label: string; short: string }> = {
  EMPTY: { label: "Còn trống", short: "Trống" }, OCCUPIED: { label: "Đã đỗ", short: "Đã đỗ" },
  RESERVED: { label: "Đã giữ chỗ", short: "Giữ chỗ" }, UNKNOWN: { label: "Chưa xác định", short: "Chưa rõ" }
};

export function SummaryStrip({ summary }: { summary: ParkingSummary }) {
  const rows: [string, number, string][] = [
    ["Tổng vị trí", summary.total_slots, "total"], ["Trống", summary.empty_slots, "EMPTY"],
    ["Đã đỗ", summary.occupied_slots, "OCCUPIED"], ["Đã giữ chỗ", summary.reserved_slots, "RESERVED"],
    ["Chưa xác định", summary.unknown_slots, "UNKNOWN"]
  ];
  return <div className="summary-strip" aria-label="Tổng hợp trạng thái">
    {rows.map(([label, value, key]) => <div className={`summary-item status-${key}`} key={key}><i /><span>{label}</span><strong>{value}</strong>{key !== "total" && <small>({summary.total_slots ? Math.round(value / summary.total_slots * 100) : 0}%)</small>}</div>)}
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
  return <div className="empty-state"><CircleGauge size={28} /><b>{title}</b><span>{text}</span></div>;
}

export function InlineNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "error" | "success" }) {
  return <div className={`inline-notice ${tone}`} role={tone === "error" ? "alert" : "status"}><Sparkles size={18} />{children}</div>;
}
