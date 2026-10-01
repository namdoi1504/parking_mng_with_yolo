import { useState } from "react";
import { ArrowRight, CarFront, Check, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound, Video, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch, isDemoMode, saveTokens } from "../api";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (isDemoMode()) { navigate("/monitor"); return; }
      const tokens = await apiFetch<{ access_token: string; refresh_token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      saveTokens(tokens.access_token, tokens.refresh_token, remember);
      navigate("/monitor");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đăng nhập"); }
    finally { setBusy(false); }
  }

  return <main className="login-page">
    <section className="login-story" aria-label="Giới thiệu hệ thống">
      <div className="login-brand"><span className="brand-mark"><CarFront /></span><span><b>ImperiaSmart Parking</b><small>Hệ thống Quản lý Bãi đỗ xe AI Vision</small></span></div>
      <div className="story-content"><p className="eyebrow">IMPERIA GARDEN · HÀ NỘI</p><h1>Giám sát bãi xe rõ ràng.<br />Điều hành theo thời gian thực.</h1><p>Theo dõi video nhận diện, xem bản đồ vị trí đỗ và quản lý hoạt động bãi xe trong một không gian làm việc.</p>
        <div className="feature-list">
          <article><Video /><span><b>Video AI &amp; bản đồ ô đỗ</b><small>Xem vị trí trống và trạng thái từng ô theo camera.</small></span></article>
          <article><Zap /><span><b>Cập nhật gần như tức thời</b><small>WebSocket đồng bộ thay đổi tới bảng điều khiển.</small></span></article>
          <article><ShieldCheck /><span><b>Kiểm soát truy cập theo vai trò</b><small>Giao diện tự thích ứng với quyền từ JWT.</small></span></article>
        </div>
      </div>
      <footer><b>TỔ HỢP CHUNG CƯ IMPERIA GARDEN</b><span>203 Nguyễn Huy Tưởng, Thanh Xuân, Hà Nội</span></footer>
    </section>
    <section className="login-workspace">
      <form className="login-card" onSubmit={submit} noValidate>
        <span className="soft-icon"><LockKeyhole /></span><h2>Đăng nhập hệ thống</h2><p>Nhập tài khoản đã được cấp để truy cập bảng điều hành.</p>
        <div className="form-note"><Check size={16} /> Quyền truy cập được xác định theo tài khoản.</div>
        <label htmlFor="username">Tên đăng nhập</label>
        <div className="input-wrap"><UserRound size={19} /><input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} /></div>
        <label htmlFor="password">Mật khẩu</label>
        <div className="input-wrap"><LockKeyhole size={18} /><input id="password" type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} /><button type="button" className="reveal" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{visible ? <EyeOff /> : <Eye />}</button></div>
        <div className="form-row"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span /> Ghi nhớ đăng nhập</label><span>Quên mật khẩu? Liên hệ quản trị viên.</span></div>
        {error && <div className="form-error" id="login-error" role="alert">{error}</div>}
        <button className="primary-button login-submit" disabled={busy || (!isDemoMode() && (!username || !password))}>{busy ? "Đang xác thực..." : "Đăng nhập vào hệ thống"}<ArrowRight size={18} /></button>
        {isDemoMode() && <p className="demo-hint">Chế độ xem mẫu đang bật — không cần nhập tài khoản.</p>}
        <div className="secure-note"><ShieldCheck size={16} /> Phiên đăng nhập dùng JWT và refresh token xoay vòng</div>
        <button className="secondary-button public-lookup-link" type="button" onClick={() => navigate("/lookup")}>Tra cứu vị trí trống không cần đăng nhập</button>
      </form>
    </section>
  </main>;
}
