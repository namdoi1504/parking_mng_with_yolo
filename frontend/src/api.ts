import type { AuthClaims } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const IS_NGROK_API = /^https?:\/\/[^/]+\.(?:ngrok-free\.dev|ngrok-free\.app|ngrok\.io|ngrok\.app)(?=[:/]|$)/i.test(API_BASE);
const ACCESS_KEY = "parking_access_token";
const REFRESH_KEY = "parking_refresh_token";
const STORAGE_KEY = "parking_token_storage";

function apiHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  // ngrok's browser warning response does not include the backend CORS headers.
  if (IS_NGROK_API) headers.set("ngrok-skip-browser-warning", "1");
  return headers;
}

function tokenStorage() {
  return localStorage.getItem(STORAGE_KEY) === "local" ? localStorage : sessionStorage;
}

export function saveTokens(access: string, refresh: string, remember: boolean) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(ACCESS_KEY); other.removeItem(REFRESH_KEY);
  localStorage.setItem(STORAGE_KEY, remember ? "local" : "session");
  target.setItem(ACCESS_KEY, access); target.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(ACCESS_KEY); sessionStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(STORAGE_KEY);
}

export const getAccessToken = () => tokenStorage().getItem(ACCESS_KEY);

export function getClaims(): AuthClaims | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const value = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(value).split("").map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
  } catch { return null; }
}

async function refreshAccessToken() {
  const refreshToken = tokenStorage().getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST", headers: apiHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) { clearTokens(); return false; }
  const data = await response.json();
  saveTokens(data.access_token, data.refresh_token, tokenStorage() === localStorage);
  return true;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = apiHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15000) });
  if (response.status === 401 && !path.startsWith("/auth/") && retry && await refreshAccessToken()) return apiFetch<T>(path, init, false);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item: { loc?: string[]; msg?: string }) => `${item.loc?.slice(1).join(".") ?? "Dữ liệu"}: ${item.msg ?? "Không hợp lệ"}`).join("; ") : `Yêu cầu thất bại (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function isDemoMode() { return import.meta.env.VITE_DEMO_MODE === "true"; }

export function websocketUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/parking`;
}
