// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, clearTokens, getAccessToken, saveTokens } from "./api";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("authenticated logout", () => {
  it("refreshes an expired access token before retrying backend logout", async () => {
    saveTokens("expired-test-token", "test-refresh", false);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Invalid or expired credentials" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "rotated-test-token", refresh_token: "rotated-refresh" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/auth/logout", "/auth/refresh", "/auth/logout"]);
    expect(fetchMock.mock.calls[2][1].headers.get("Authorization")).toBe("Bearer rotated-test-token");
    expect(getAccessToken()).toBe("rotated-test-token");
  });
  it("does not retry refresh or claim logout succeeded if rotation is rejected", async () => {
    saveTokens("expired-test-token", "test-refresh", true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid or expired credentials" }), { status: 401 }));
    // Each invocation needs its own body stream.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ detail: "Invalid or expired credentials" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/auth/logout", { method: "POST" })).rejects.toThrow("Invalid or expired credentials");
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(getAccessToken()).toBeNull();
  });
});

describe("refresh session races", () => {
  it.each(["logout", "new login"])("does not restore an old session after %s", async (change) => {
    saveTokens("old-access", "old-refresh", false);
    let finishRefresh!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(async (path) => {
      if (path === "/auth/refresh") return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      return new Response(JSON.stringify({ detail: "Expired" }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = apiFetch("/users/").catch((error) => error);
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    if (change === "logout") clearTokens();
    else saveTokens("new-access", "new-refresh", true);
    finishRefresh(new Response(JSON.stringify({ access_token: "old-rotated", refresh_token: "old-rotated-refresh" })));
    expect(await pending).toBeInstanceOf(Error);
    expect(getAccessToken()).toBe(change === "logout" ? null : "new-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not clear a newer login if the old refresh is rejected", async () => {
    saveTokens("old-access", "old-refresh", false);
    let finishRefresh!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (path) => path === "/auth/refresh"
      ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
      : new Response(JSON.stringify({ detail: "Expired" }), { status: 401 })));
    const pending = apiFetch("/users/").catch((error) => error);
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    saveTokens("new-access", "new-refresh", true);
    finishRefresh(new Response(null, { status: 401 }));
    await pending;
    expect(getAccessToken()).toBe("new-access");
  });

  it("retains refresh credentials on a temporary server error", async () => {
    saveTokens("expired-access", "refresh", false);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (path) => new Response(null, { status: path === "/auth/refresh" ? 503 : 401 })));
    await expect(apiFetch("/users/")).rejects.toThrow();
    expect(getAccessToken()).toBe("expired-access");
    expect(sessionStorage.getItem("parking_refresh_token")).toBe("refresh");
  });

  it("shares one rotation and retries a delayed 401 with the rotated token", async () => {
    saveTokens("expired", "refresh", false);
    let finishDelayedRequest!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(async (path, init) => {
      if (path === "/auth/refresh") return new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh" }));
      if (init.headers.get("Authorization") === "Bearer rotated") return new Response(JSON.stringify({ ok: true }));
      if (path === "/delayed") return new Promise<Response>((resolve) => { finishDelayedRequest = resolve; });
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const delayed = apiFetch("/delayed");
    await Promise.all([apiFetch("/first"), apiFetch("/second")]);
    finishDelayedRequest(new Response(null, { status: 401 }));
    await expect(delayed).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.filter(([path]) => path === "/auth/refresh")).toHaveLength(1);
  });

  it("honors cancellation while waiting for a shared refresh", async () => {
    saveTokens("expired", "refresh", false);
    let finishRefresh!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (path) => path === "/auth/refresh"
      ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
      : new Response(null, { status: 401 })));
    const controller = new AbortController();
    const pending = apiFetch("/users/", { signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    controller.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
    clearTokens();
    finishRefresh(new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh" })));
    await vi.waitFor(() => expect(getAccessToken()).toBeNull());
  });
});
