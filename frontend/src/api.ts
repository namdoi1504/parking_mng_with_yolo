import type { AuthClaims } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const IS_NGROK_API = /^https?:\/\/[^/]+\.(?:ngrok-free\.dev|ngrok-free\.app|ngrok\.io|ngrok\.app)(?=[:/]|$)/i.test(API_BASE);
const ACCESS_KEY = "parking_access_token";
const REFRESH_KEY = "parking_refresh_token";
const STORAGE_KEY = "parking_token_storage";
let sessionRevision = 0;
let lastRotation: { from: string | null; to: string; fromRevision: number; toRevision: number } | null = null;

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
  sessionRevision++;
  lastRotation = null;
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(ACCESS_KEY); other.removeItem(REFRESH_KEY);
  localStorage.setItem(STORAGE_KEY, remember ? "local" : "session");
  target.setItem(ACCESS_KEY, access); target.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  sessionRevision++;
  lastRotation = null;
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

let refreshInFlight: { revision: number; promise: Promise<boolean> } | null = null;

async function refreshAccessToken() {
  if (refreshInFlight?.revision === sessionRevision) return refreshInFlight.promise;
  const request = { revision: sessionRevision, promise: rotateAccessToken() };
  refreshInFlight = request;
  try { return await request.promise; }
  finally { if (refreshInFlight === request) refreshInFlight = null; }
}

async function rotateAccessToken() {
  const storage = tokenStorage();
  const revision = sessionRevision;
  const accessToken = storage.getItem(ACCESS_KEY);
  const refreshToken = storage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const isCurrentSession = () => revision === sessionRevision && tokenStorage() === storage &&
    storage.getItem(REFRESH_KEY) === refreshToken && storage.getItem(ACCESS_KEY) === accessToken;
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST", headers: apiHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ refresh_token: refreshToken }), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    if (isCurrentSession() && [401, 403].includes(response.status)) clearTokens();
    return false;
  }
  const data = await response.json();
  // A response from an old login must not overwrite or restore a newer session.
  if (!isCurrentSession()) return false;
  if (typeof data.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw new Error("Phản hồi làm mới phiên không hợp lệ");
  }
  saveTokens(data.access_token, data.refresh_token, storage === localStorage);
  lastRotation = { from: accessToken, to: data.access_token, fromRevision: revision, toRevision: sessionRevision };
  return true;
}

async function waitForRefresh(pending: Promise<boolean>, signal?: AbortSignal | null) {
  if (!signal) return pending;
  signal.throwIfAborted();
  let onAbort!: () => void;
  const interrupted = new Promise<boolean>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([pending, interrupted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function apiResponse(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = apiHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  const revision = sessionRevision;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15000) });
  if (response.status === 401 && path !== "/auth/login" && path !== "/auth/refresh" && retry) {
    init.signal?.throwIfAborted();
    // Another request may have completed rotation while this 401 was in transit.
    const rotated = lastRotation?.from === token && lastRotation?.to === getAccessToken() &&
      lastRotation?.fromRevision === revision && lastRotation?.toRevision === sessionRevision;
    if (rotated || (revision === sessionRevision && token === getAccessToken() && await waitForRefresh(refreshAccessToken(), init.signal))) {
      return apiResponse(path, init, false);
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item: { loc?: string[]; msg?: string }) => `${item.loc?.slice(1).join(".") ?? "Dữ liệu"}: ${item.msg ?? "Không hợp lệ"}`).join("; ") : `Yêu cầu thất bại (${response.status})`);
  }
  return response;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiResponse(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function isDemoMode() { return import.meta.env.VITE_DEMO_MODE === "true"; }
