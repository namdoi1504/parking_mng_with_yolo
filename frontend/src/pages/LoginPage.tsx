import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Search, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch, isDemoMode, saveTokens } from "../api";
import "./LoginPage.css";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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

  return <main className="parking-login">
    <section className="parking-login__scene" aria-label="ImperiaSmart Parking">
      <img className="parking-login__image" src={`${import.meta.env.BASE_URL}images/parking-login-entrance.png`} alt="" width="1536" height="1024" />
      <div className="parking-login__wash" aria-hidden="true" />
      <div className="parking-login__scene-content">
        <a className="parking-login__brand" href="/lookup" aria-label="ImperiaSmart, tra cứu chỗ đỗ">
          <span className="parking-login__symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 25V8h9a6 6 0 0 1 0 12h-4" stroke="white" strokeWidth="4" strokeLinecap="round" /><path d="m20 25 4-4" stroke="#ffe2a5" strokeWidth="4" strokeLinecap="round" /></svg></span>
          <span>Imperia<span className="parking-login__accent">Smart</span><small>PARKING</small></span>
        </a>
        <div className="parking-login__intro"><h1>Quản lý<br />bãi đỗ xe</h1><p>Xem camera và trạng thái ô đỗ.</p></div>
        <span className="parking-login__caption">Ảnh minh họa · ImperiaSmart Parking</span>
      </div>
    </section>
    <section className="parking-login__workspace" aria-label="Đăng nhập hệ thống">
      <form className="parking-login__sheet" onSubmit={submit} noValidate aria-busy={busy}>
        <div className="parking-login__form-heading"><h2>Đăng nhập</h2><p>Sử dụng tài khoản đã được cấp.</p></div>
        <div className="parking-login__field">
          <UserRound aria-hidden="true" />
          <div><label htmlFor="username">Tên đăng nhập</label><input id="username" name="username" placeholder="Nhập tên đăng nhập" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} /></div>
        </div>
        <div className="parking-login__field">
          <LockKeyhole aria-hidden="true" />
          <div><label htmlFor="password">Mật khẩu</label><input id="password" name="password" placeholder="Nhập mật khẩu" type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} /></div>
          <button type="button" className="parking-login__reveal" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
        </div>
        <div className="parking-login__options">
          <label className="parking-login__remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Ghi nhớ đăng nhập</span></label>
          <button className="parking-login__help-link" type="button" aria-expanded={helpOpen} aria-controls="login-help" onClick={() => setHelpOpen((open) => !open)}>Quên mật khẩu?</button>
        </div>
        <p className="parking-login__help" id="login-help" role="status" hidden={!helpOpen}>Liên hệ quản trị viên bãi xe để được cấp tài khoản hoặc hỗ trợ đặt lại mật khẩu.</p>
        {error && <div className="parking-login__error" id="login-error" role="alert">{error}</div>}
        <button className="parking-login__submit" disabled={busy || (!isDemoMode() && (!username || !password))}>{busy ? "Đang xác thực..." : "Đăng nhập"}<ArrowRight size={18} aria-hidden="true" /></button>
        {isDemoMode() && <p className="parking-login__demo">Chế độ xem mẫu — không cần nhập tài khoản.</p>}
        <div className="parking-login__separator" aria-hidden="true">hoặc</div>
        <button className="parking-login__lookup" type="button" onClick={() => navigate("/lookup")}><Search aria-hidden="true" />Tra cứu chỗ đỗ<span className="sr-only"> không cần đăng nhập</span></button>
      </form>
      <p className="parking-login__account-help">Bạn cần tài khoản? <button className="parking-login__help-link" type="button" aria-expanded={helpOpen} aria-controls="login-help" onClick={() => setHelpOpen((open) => !open)}>Liên hệ quản trị viên</button></p>
    </section>
  </main>;
}
