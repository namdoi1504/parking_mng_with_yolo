import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { apiFetch, isDemoMode } from "../api";
import { AppShell, EmptyState } from "../components";
import { demoHourly } from "../demo";
import type { HourlyStat } from "../types";

export function StatisticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [stats, setStats] = useState<HourlyStat[]>(isDemoMode() ? demoHourly : []);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!isDemoMode()) { setStats([]); setError(""); void apiFetch<HourlyStat[]>(`/api/stats/hourly?date=${date}`).then((result) => { if (!cancelled) setStats(result); }).catch((e) => { if (!cancelled) setError(e.message); }); }
    return () => { cancelled = true; };
  }, [date]);
  const valid = stats.filter((item) => item.utilization != null);
  const peak = valid.reduce<HourlyStat | null>((best, item) => !best || (item.utilization ?? 0) > (best.utilization ?? 0) ? item : best, null);
  const totalFlow = stats.reduce((sum, item) => sum + item.samples, 0);
  const average = valid.length ? `${Math.round(valid.reduce((sum, item) => sum + (item.utilization ?? 0), 0) / valid.length)}%` : "—";
  const visible = useMemo(() => stats, [stats]);
  function exportCsv() { const csv = ["hour,occupied,available,utilization,samples", ...stats.map((s) => `${s.hour},${s.occupied},${s.available},${s.utilization ?? ""},${s.samples}`)].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `parking-statistics-${date}.csv`; link.click(); URL.revokeObjectURL(link.href); }
  return <AppShell eyebrow="Thống kê" title="Thống kê & Báo cáo Bãi xe" actions={<><label className="date-control"><CalendarDays size={17} /><span className="sr-only">Ngày thống kê</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button className="primary-button" onClick={exportCsv}><Download size={17} /> Xuất CSV</button></>}>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="metric-grid"><article><span>MẪU THỐNG KÊ</span><strong>{totalFlow}</strong><small>Không phải số lượt xe ra / vào</small></article><article><span>LẤP ĐẦY CAO NHẤT</span><strong className="red">{peak ? `${peak.utilization}%` : "—"}</strong><small>{peak ? `Đỉnh lúc ${String(peak.hour).padStart(2, "0")}:00 UTC` : "Chưa có mẫu"}</small></article><article><span>TRUNG BÌNH THEO GIỜ</span><strong className="violet">{average}</strong><small>Dựa trên {valid.length} khung giờ có dữ liệu</small></article><article><span>KHUNG GIỜ CAO ĐIỂM</span><strong className="green">{valid.filter((s) => (s.utilization ?? 0) >= 85).length}</strong><small>Ngưỡng từ 85% · múi giờ UTC</small></article></div>
    <section className="panel chart-card"><div className="chart-heading"><div><h2>Tỷ lệ lấp đầy theo khung giờ</h2><p>Dữ liệu tổng hợp từ endpoint thống kê hàng giờ của backend.</p></div><div className="legend"><span className="peak" /> Cao điểm ≥85% <span /> Bình thường</div></div>
      {visible.length ? <div className="bar-chart">{visible.map((item) => <div className="bar-column" key={item.hour}><div className={`bar ${item.utilization != null && item.utilization >= 85 ? "peak" : ""}`} style={{ height: `${Math.max(4, item.utilization ?? 0)}%` }}><strong>{item.utilization == null ? "—" : `${item.utilization}%`}</strong></div><time>{String(item.hour).padStart(2, "0")}:00</time></div>)}</div> : <EmptyState title="Không có dữ liệu" text="Chưa có bản ghi thống kê cho ngày đã chọn." />}
    </section>
    <div className="stats-bottom"><section className="panel"><h2>Phân bố tải vận hành</h2>{[["Thấp hơn 40%", valid.filter((s) => (s.utilization ?? 0) < 40).length, "green"], ["Từ 40–69%", valid.filter((s) => (s.utilization ?? 0) >= 40 && (s.utilization ?? 0) < 70).length, "blue"], ["Từ 70–84%", valid.filter((s) => (s.utilization ?? 0) >= 70 && (s.utilization ?? 0) < 85).length, "amber"], ["Từ 85% trở lên", valid.filter((s) => (s.utilization ?? 0) >= 85).length, "red"]].map(([label, count, color]) => <div className="progress-row" key={label as string}><span>{label}</span><b>{count} giờ</b><div><i className={color as string} style={{ width: `${valid.length ? Number(count) / valid.length * 100 : 0}%` }} /></div></div>)}</section><section className="panel insight-card"><span>ĐỘ PHỦ DỮ LIỆU</span><h2>{valid.length} / 24 giờ có mẫu</h2><p>Ngày báo cáo và các khung giờ dùng UTC. Dấu — nghĩa là chưa có dữ liệu, không phải bãi xe trống. Mẫu nhận diện không cung cấp số lượt ra vào hoặc thời gian gửi xe.</p></section></div>
  </AppShell>;
}
