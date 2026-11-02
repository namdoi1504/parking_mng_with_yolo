import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Car,
  CheckCircle2,
  ChevronDown,
  Filter,
  Hash,
  Layers,
  MapPin,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { apiFetch, isDemoMode } from "../services/api";
import { AppShell, EmptyState, InlineNotice } from "../components";
import { formatTime, SessionDetail, sessionLabels } from "../components/SessionDetail";
import { useParkingMap } from "../hooks/useParkingMap";
import type { Page, ParkingSession } from "../types";

type Filters = {
  is_active: string;
  license_plate: string;
  phone_number: string;
  parking_slot_id: string;
  created_from: string;
  created_to: string;
};

const blank: Filters = {
  is_active: "",
  license_plate: "",
  phone_number: "",
  parking_slot_id: "",
  created_from: "",
  created_to: "",
};

export function SessionsPage() {
  const [draft, setDraft] = useState(blank);
  const [filters, setFilters] = useState(blank);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [result, setResult] = useState<Page<ParkingSession> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const map = useParkingMap();

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, key.startsWith("created_") ? new Date(value).toISOString() : value.trim());
    }
  }
  const path = `/parking-sessions?${params}`;

  useEffect(() => {
    if (isDemoMode()) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(undefined);
      }
    }
    if (selected !== undefined) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (!result) {
      setBusy(true);
    }
    if (isDemoMode()) {
      setResult({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } });
      setBusy(false);
      return;
    }
    void apiFetch<Page<ParkingSession>>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Không tải được phiên gửi xe");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [path, revision, map.sessionRevision]);

  async function reload() {
    setRevision((value) => value + 1);
    await map.load(true);
  }

  const selectedSlot = map.data?.slots.find((slot) => slot.active_session_id === selected);
  const slotLabel = (id: number) => map.data?.slots.find((slot) => slot.id === id)?.slot_code ?? `#${id}`;

  function field(key: keyof Filters, value: string) {
    setDraft((old) => ({ ...old, [key]: value }));
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    if (draft.created_from && draft.created_to && new Date(draft.created_to) <= new Date(draft.created_from)) {
      setValidation("Thời điểm kết thúc phải sau thời điểm bắt đầu.");
      return;
    }
    setValidation("");
    setFilters({ ...draft });
    setPage(1);
    setSelected(undefined);
    setRevision((value) => value + 1);
  }

  function resetFilters() {
    setDraft(blank);
    setFilters(blank);
    setPage(1);
    setValidation("");
    setSelected(undefined);
  }

  function quickFilterStatus(status: string) {
    const next = { ...draft, is_active: status };
    setDraft(next);
    setFilters(next);
    setPage(1);
    setValidation("");
    setSelected(undefined);
  }

  const hasActiveFilters = Boolean(
    filters.license_plate ||
      filters.phone_number ||
      filters.is_active ||
      filters.parking_slot_id ||
      filters.created_from ||
      filters.created_to
  );

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <AppShell
      title="Phiên gửi xe"
      eyebrow="Vận hành"
      actions={
        <div className="session-page-actions">
          <Link to="/map" className="secondary-button session-nav-map-btn">
            <MapPin size={16} />
            Bản đồ bãi đỗ
          </Link>
          <button className="primary-button" disabled={busy} onClick={() => void reload()}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Làm mới
          </button>
        </div>
      }
    >
      {/* 1. MODERN SEARCH & FILTER HUB */}
      <form className="panel session-search-hub" onSubmit={search}>
        <div className="session-filter-top-bar">
          <div className="filter-title-group">
            <span className="filter-title-badge">
              <SlidersHorizontal size={15} />
            </span>
            <div>
              <h3 className="filter-title-text">Bộ lọc tra cứu phiên gửi xe</h3>
              <p className="filter-subtitle-text">
                Tra cứu nhanh theo biển số, số điện thoại khách hàng hoặc trạng thái phiên
              </p>
            </div>
          </div>

          <div className="filter-quick-pills" role="tablist" aria-label="Lọc nhanh trạng thái">
            <button
              type="button"
              className={`filter-pill-btn ${draft.is_active === "" ? "active" : ""}`}
              onClick={() => quickFilterStatus("")}
            >
              <Layers size={13} />
              Tất cả
              {result?.meta.total !== undefined && (
                <span className="pill-badge">{result.meta.total}</span>
              )}
            </button>
            <button
              type="button"
              className={`filter-pill-btn live-status-pill ${draft.is_active === "true" ? "active" : ""}`}
              onClick={() => quickFilterStatus("true")}
            >
              <span className="live-dot" aria-hidden="true" />
              Đang hoạt động
            </button>
            <button
              type="button"
              className={`filter-pill-btn ${draft.is_active === "false" ? "active" : ""}`}
              onClick={() => quickFilterStatus("false")}
            >
              <CheckCircle2 size={13} />
              Đã kết thúc
            </button>
          </div>
        </div>

        {/* PRIMARY FILTERS ROW */}
        <div className="search-primary-row">
          <label className="filter-field">
            <span className="field-label-text">
              <Car size={13} />
              Biển số xe
            </span>
            <div className="input-with-icon-wrap">
              <input
                maxLength={30}
                placeholder="VD: 30A-123.45"
                value={draft.license_plate}
                onChange={(e) => field("license_plate", e.target.value)}
              />
            </div>
          </label>

          <label className="filter-field">
            <span className="field-label-text">
              <Phone size={13} />
              Số điện thoại
            </span>
            <div className="input-with-icon-wrap">
              <input
                type="tel"
                maxLength={30}
                placeholder="VD: 0901234567"
                value={draft.phone_number}
                onChange={(e) => field("phone_number", e.target.value)}
              />
            </div>
          </label>

          <label className="filter-field">
            <span className="field-label-text">
              <Filter size={13} />
              Trạng thái phiên
            </span>
            <select
              value={draft.is_active}
              onChange={(e) => field("is_active", e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.entries(sessionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ACTION & ADVANCED DRAWER TOGGLE BAR */}
        <div className="search-action-bar">
          <button
            type="button"
            className={`advanced-toggle-btn ${showAdvanced ? "is-active" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
          >
            <Calendar size={14} />
            <span>{showAdvanced ? "Thu gọn bộ lọc" : "Lọc thời gian / Ô"}</span>
            <ChevronDown
              size={14}
              className={`chevron-icon ${showAdvanced ? "open" : ""}`}
            />
          </button>

          <div className="action-buttons-group">
            {hasActiveFilters && (
              <button
                type="button"
                className="secondary-button reset-filter-btn"
                onClick={resetFilters}
              >
                <RotateCcw size={14} />
                Xóa bộ lọc
                <span className="active-filter-badge">{activeCount}</span>
              </button>
            )}
            <button className="primary-button submit-search-btn" disabled={busy}>
              <Search size={15} />
              Tra cứu phiên
            </button>
          </div>
        </div>

        {/* ADVANCED FILTER DRAWER */}
        <div className={`search-advanced-row ${showAdvanced ? "expanded" : "collapsed"}`}>
          <label className="filter-field">
            <span className="field-label-text">
              <Hash size={13} />
              ID ô đỗ
            </span>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="VD: 423"
              value={draft.parking_slot_id}
              onChange={(e) => field("parking_slot_id", e.target.value)}
            />
          </label>
          <label className="filter-field">
            <span className="field-label-text">
              <Calendar size={13} />
              Tạo từ (giờ địa phương)
            </span>
            <input
              type="datetime-local"
              value={draft.created_from}
              onChange={(e) => field("created_from", e.target.value)}
            />
          </label>
          <label className="filter-field">
            <span className="field-label-text">
              <Calendar size={13} />
              Tạo trước (giờ địa phương)
            </span>
            <input
              type="datetime-local"
              value={draft.created_to}
              onChange={(e) => field("created_to", e.target.value)}
            />
          </label>
        </div>
      </form>

      {(error || validation) && (
        <InlineNotice tone="error">{validation || error}</InlineNotice>
      )}
      {map.error && (
        <InlineNotice tone="warning">
          Chưa tải được trạng thái ô mới nhất. Thao tác kết thúc phiên tạm khóa.
        </InlineNotice>
      )}

      {/* 2. FULL-WIDTH SESSIONS TABLE */}
      <div className="sessions-stage-container">
        <section className="panel data-table-wrap sessions-main-table" aria-busy={busy}>
          <div className="table-header-strip">
            <div className="table-heading-info">
              <h2>Danh sách phiên gửi xe</h2>
              <span className="count-pill">{result?.meta.total ?? 0} phiên</span>
              {hasActiveFilters && (
                <span className="filtering-indicator">Đang áp dụng bộ lọc</span>
              )}
            </div>
            <small className="supporting-text">
              20 phiên / trang · Nhấn vào dòng để xem chi tiết
            </small>
          </div>

          {busy && !result ? (
            <div className="loading-state">
              <RefreshCw size={24} className="spin" />
              <p role="status">Đang tải danh sách phiên gửi xe…</p>
            </div>
          ) : result?.data.length ? (
            <div className="session-table-scroll">
              <table className="clean-table session-styled-table">
                <thead>
                  <tr>
                    <th>Phiên / ô</th>
                    <th>Khách / liên hệ</th>
                    <th>Biển số</th>
                    <th>Trạng thái</th>
                    <th>Tạo phiên lúc</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((session) => (
                    <tr
                      key={session.id}
                      className={`interactive-row ${selected === session.id ? "row-selected" : ""}`}
                      onClick={() => setSelected(session.id)}
                    >
                      <td>
                        <div className="session-id-cell">
                          <b>#{session.id}</b>
                          <span className="slot-badge-sub">
                            Ô {slotLabel(session.parking_slot_id)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="customer-info-cell">
                          <div className="customer-avatar" aria-hidden="true">
                            {session.customer_name?.trim()?.slice(0, 1).toUpperCase() || "K"}
                          </div>
                          <div>
                            <b className="customer-name">{session.customer_name}</b>
                            <span className="session-phone">
                              <Phone size={11} />
                              {session.phone_number}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="plate-badge">
                          <Car size={13} />
                          {session.license_plate}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${session.is_active ? "active" : "closed"}`}
                        >
                          <i className="status-dot" />
                          {sessionLabels[session.is_active ? "true" : "false"]}
                        </span>
                      </td>
                      <td className="time-cell">
                        <span className="time-text">{formatTime(session.created_at)}</span>
                      </td>
                      <td>
                        <button
                          className={`secondary-button table-action-btn ${selected === session.id ? "active" : ""}`}
                          aria-pressed={selected === session.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(session.id);
                          }}
                        >
                          Xem #{session.id}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !error && (
              <div className="session-rich-empty-container">
                <EmptyState
                  title="Không có phiên phù hợp"
                  text={
                    isDemoMode()
                      ? "Bản minh họa chưa có dữ liệu lịch sử phiên."
                      : hasActiveFilters
                      ? "Không tìm thấy phiên gửi xe nào khớp với điều kiện lọc hiện tại. Hãy thử thay đổi tiêu chí tìm kiếm."
                      : "Chưa có phiên gửi xe nào được ghi nhận. Bạn có thể mở Bản đồ bãi đỗ để chọn ô trống và tạo phiên giữ chỗ mới."
                  }
                />
                <div className="empty-quick-actions">
                  <Link to="/map" className="primary-button empty-map-link">
                    <MapPin size={15} />
                    Mở bản đồ đặt chỗ ô trống
                  </Link>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={resetFilters}
                    >
                      <RotateCcw size={14} />
                      Xóa bộ lọc
                    </button>
                  )}
                </div>
              </div>
            )
          )}

          <div className="pagination">
            <span>
              Trang {page}/{Math.max(1, result?.meta.total_pages ?? 1)}
            </span>
            <button
              className="secondary-button"
              disabled={busy || page <= 1}
              onClick={() => {
                setPage(page - 1);
                setSelected(undefined);
              }}
            >
              Trước
            </button>
            <button
              className="secondary-button"
              disabled={busy || !result || page >= result.meta.total_pages}
              onClick={() => {
                setPage(page + 1);
                setSelected(undefined);
              }}
            >
              Sau
            </button>
          </div>
        </section>

        {/* 3. SLIDE-OVER OVERLAY DRAWER FOR SESSION DETAIL */}
        {selected !== undefined && (
          <div
            className="session-drawer-overlay"
            onClick={() => setSelected(undefined)}
          >
            <aside
              className="session-slideover-drawer is-open"
              role="dialog"
              aria-modal="true"
              aria-label={`Chi tiết phiên gửi xe #${selected}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drawer-inner-content">
                <div className="drawer-header">
                  <span className="drawer-title">Chi tiết phiên gửi xe</span>
                  <button
                    className="icon-button close-drawer-btn"
                    aria-label="Đóng chi tiết phiên"
                    onClick={() => setSelected(undefined)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <SessionDetail
                  key={selected}
                  sessionId={selected}
                  slot={selectedSlot}
                  sessionRevision={map.sessionRevision}
                  disabled={!!map.error || !!error || busy}
                  onUpdated={map.applySlot}
                  onReload={reload}
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
