import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { apiFetch, getClaims, isDemoMode } from "../api";
import { AppShell, EmptyState } from "../components";
import { demoCameras, demoHourly } from "../demo";
import type { Camera, DailyStat, HourlyStat, Page, ParkingMap } from "../types";

export function StatisticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<"hourly" | "daily">("hourly");
  const [date, setDate] = useState(today), [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const [camera, setCamera] = useState(""), [cameras, setCameras] = useState<number[]>([]);
  const [result, setResult] = useState<{ key: string; rows: (HourlyStat | DailyStat)[] }>({ key: "", rows: [] });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [cameraError, setCameraError] = useState("");
  const rangeDays = (Date.parse(to) - Date.parse(from)) / 86400000;
  const validation = mode === "hourly" ? (!date ? "Chọn ngày báo cáo." : "") :
    (!from || !to || !Number.isFinite(rangeDays) ? "Chọn đầy đủ khoảng ngày." : rangeDays < 0 ? "Ngày kết thúc phải từ ngày bắt đầu trở đi." : rangeDays > 365 ? "Chọn khoảng tối đa 366 ngày." : "");
  const params = new URLSearchParams(mode === "hourly" ? { date } : { from, to });
  if (camera) params.set("camera_id", camera);
  const path = `/api/stats/${mode}?${params}`;
  const rows = !validation && result.key === path ? result.rows : [];

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function cameraIds() {
      if (isDemoMode()) return demoCameras.map((item) => item.id);
      const init = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) };
      if (getClaims()?.permissions.includes("camera:view")) {
        const ids: number[] = [];
        let page = 1, totalPages = 1;
        do {
          const result = await apiFetch<Page<Camera>>(`/cameras/?page=${page}&page_size=100`, init);
          ids.push(...result.data.map((item) => item.id)); totalPages = result.meta.total_pages; page++;
        } while (active && page <= totalPages);
        return ids;
      }
      const map = await apiFetch<ParkingMap>("/api/ai/map", init);
      return map.slots.map((slot) => slot.camera_id);
    }
    void cameraIds().then((ids) => { if (active) setCameras([...new Set(ids)].sort((a, b) => a - b)); })
      .catch(() => { if (active) setCameraError("Không tải được danh sách camera; vẫn có thể xem báo cáo toàn bãi."); });
    return () => { active = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (validation) { setBusy(false); return; }
    let active = true;
    const controller = new AbortController();
    setBusy(true); setError(""); setResult({ key: path, rows: [] });
    async function load() {
      try {
        const data = isDemoMode() ? mode === "hourly" ? demoHourly : Array.from({ length: rangeDays + 1 }, (_, index) => ({
          date: new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10), avg_utilization: 65, samples: 24
        })) : await apiFetch<(HourlyStat | DailyStat)[]>(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (active) setResult({ key: path, rows: data });
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Không tải được báo cáo"); }
      finally { if (active) setBusy(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [path, validation, refresh]);

  const points = rows.map((row) => "hour" in row ? { label: `${String(row.hour).padStart(2, "0")}:00`, value: row.utilization, samples: row.samples } : { label: row.date, value: row.avg_utilization, samples: row.samples });
  const valid = points.filter((point) => point.value != null);
  const peak = valid.reduce<typeof points[number] | null>((best, point) => !best || point.value! > best.value! ? point : best, null);
  const sampleCount = points.reduce((sum, point) => sum + point.samples, 0);
  const average = valid.length ? `${Math.round(valid.reduce((sum, point) => sum + point.value!, 0) / valid.length)}%` : "—";
  function exportCsv() {
    if (!rows.length || busy || validation || error) return;
    const csv = [mode === "hourly" ? "hour,occupied,available,utilization,samples" : "date,avg_utilization,samples",
      ...rows.map((row) => "hour" in row ? `${row.hour},${row.occupied},${row.available},${row.utilization ?? ""},${row.samples}` : `${row.date},${row.avg_utilization ?? ""},${row.samples}`)].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `parking-${mode}-${mode === "hourly" ? date : `${from}-${to}`}-${camera ? `camera-${camera}` : "all"}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }
  return <AppShell eyebrow="Thống kê" title="Thống kê bãi đỗ" actions={<>
    <button className="secondary-button" disabled={busy || !!validation} onClick={() => setRefresh((old) => old + 1)}><RefreshCw size={17} />Làm mới</button>
    <button className="primary-button" disabled={busy || !rows.length || !!error || !!validation} onClick={exportCsv}><Download size={17} />Xuất CSV</button>
  </>}>
    <div className="management-toolbar statistics-filters">
      <div className="tab-switch"><button aria-pressed={mode === "hourly"} className={mode === "hourly" ? "active" : ""} onClick={() => setMode("hourly")}>Theo giờ</button><button aria-pressed={mode === "daily"} className={mode === "daily" ? "active" : ""} onClick={() => setMode("daily")}>Theo ngày</button></div>
      {mode === "hourly" ? <label>Ngày báo cáo (UTC)<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label> : <>
        <label>Từ ngày (UTC)<input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Đến ngày (UTC)<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </>}
      <label>Camera báo cáo<select value={camera} onChange={(e) => setCamera(e.target.value)}><option value="">Toàn bãi</option>{cameras.map((id) => <option key={id} value={id}>Camera #{id}</option>)}</select></label>
    </div>
    {(validation || error) && <div className="error-banner" role="alert">{validation || error}</div>}
    {cameraError && <p className="supporting-text" role="status">{cameraError}</p>}
    <div className="metric-grid">
      <article><span>MẪU THỐNG KÊ</span><strong>{sampleCount}</strong><small>Không phải số lượt xe ra / vào</small></article>
      <article><span>LẤP ĐẦY CAO NHẤT</span><strong className="red">{peak ? `${peak.value}%` : "—"}</strong><small>{peak ? `${peak.label} UTC` : "Chưa có mẫu"}</small></article>
      <article><span>TRUNG BÌNH THEO {mode === "hourly" ? "GIỜ" : "NGÀY"}</span><strong className="violet">{average}</strong><small>Dựa trên {valid.length} khoảng có dữ liệu</small></article>
      <article><span>{mode === "hourly" ? "KHUNG GIỜ" : "NGÀY"} CAO ĐIỂM</span><strong className="green">{valid.filter((point) => point.value! >= 85).length}</strong><small>Ngưỡng từ 85% · múi giờ UTC</small></article>
    </div>
    <section className="panel chart-card" aria-busy={busy}>
      <div className="chart-heading"><div><h2>Tỷ lệ lấp đầy theo {mode === "hourly" ? "khung giờ" : "ngày"}</h2><p>{camera ? `Camera #${camera}` : "Toàn bãi"} · Ngưỡng cao điểm từ 85%</p></div></div>
      {points.length ? <div className={`bar-chart ${mode === "daily" ? "daily-chart" : ""}`}>{points.map((point) => <div className="bar-column" key={point.label} title={`${point.label}: ${point.value == null ? "Chưa có mẫu" : `${point.value}%`} · ${point.samples} mẫu`}>
        <div className={`bar ${point.value != null && point.value >= 85 ? "peak" : ""}`} style={{ height: `${Math.max(4, point.value ?? 0)}%` }}><strong>{point.value == null ? "—" : `${point.value}%`}</strong></div><time>{point.label}</time>
      </div>)}</div> : <EmptyState title={busy ? "Đang tải báo cáo" : "Chưa có dữ liệu báo cáo"} text="Chọn ngày và camera để xem thống kê." />}
    </section>
    <section className="panel data-table-wrap"><div className="table-heading"><b>Số liệu báo cáo</b><span>{sampleCount} mẫu · UTC</span></div>
      <table><caption className="sr-only">Thống kê bãi đỗ theo {mode === "hourly" ? "giờ" : "ngày"}</caption><thead><tr><th>{mode === "hourly" ? "Giờ (UTC)" : "Ngày (UTC)"}</th>{mode === "hourly" && <><th>Đã đỗ</th><th>Còn trống</th></>}<th>Tỷ lệ lấp đầy</th><th>Số mẫu</th></tr></thead><tbody>
        {rows.map((row) => <tr key={"hour" in row ? row.hour : row.date}><td>{"hour" in row ? `${String(row.hour).padStart(2, "0")}:00` : row.date}</td>{"hour" in row && <><td>{row.samples ? row.occupied : "—"}</td><td>{row.samples ? row.available : "—"}</td></>}<td>{("hour" in row ? row.utilization : row.avg_utilization) == null ? "—" : `${"hour" in row ? row.utilization : row.avg_utilization}%`}</td><td>{row.samples}</td></tr>)}
      </tbody></table>
    </section>
    <div className="stats-bottom"><section className="panel"><h2>Phân bố tải vận hành</h2>{[
      { label: "Thấp hơn 40%", min: 0, max: 40, color: "green" },
      { label: "Từ 40–69%", min: 40, max: 70, color: "blue" },
      { label: "Từ 70–84%", min: 70, max: 85, color: "amber" },
      { label: "Từ 85% trở lên", min: 85, max: 101, color: "red" }
    ].map((band) => {
      const count = valid.filter((point) => point.value! >= band.min && point.value! < band.max).length;
      return <div className="progress-row" key={band.label}><span>{band.label}</span><b>{count} {mode === "hourly" ? "giờ" : "ngày"}</b><div><i className={band.color} style={{ width: `${valid.length ? count / valid.length * 100 : 0}%` }} /></div></div>;
    })}</section><section className="panel insight-card"><span>ĐỘ PHỦ DỮ LIỆU</span><h2>{valid.length} / {mode === "hourly" ? 24 : validation ? "—" : rangeDays + 1} {mode === "hourly" ? "giờ" : "ngày"} có mẫu</h2><p>Dấu — nghĩa là chưa có dữ liệu. Trung bình trên giao diện tính theo các khoảng có mẫu; mẫu nhận diện không cung cấp số lượt ra vào hoặc thời gian gửi xe.</p></section></div>
  </AppShell>;
}
