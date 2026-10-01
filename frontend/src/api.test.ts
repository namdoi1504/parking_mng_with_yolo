// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  vi.stubEnv("VITE_API_BASE_URL", "https://example.ngrok-free.dev");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authenticated ngrok video requests", () => {
  it("sends ngrok and bearer headers while returning the unread video body", async () => {
    const response = new Response("stream bytes", { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } });
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
    const { apiResponse, saveTokens } = await import("./api");
    saveTokens("test-access", "test-refresh", false);
    expect(await apiResponse("/ai-stream/video")).toBe(response);
    expect(response.bodyUsed).toBe(false);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://example.ngrok-free.dev/ai-stream/video");
    expect(options.headers.get("Authorization")).toBe("Bearer test-access");
    expect(options.headers.get("ngrok-skip-browser-warning")).toBe("1");
  });
  it("refreshes only once when status and video credentials expire together", async () => {
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(new Headers(options.headers).get("ngrok-skip-browser-warning")).toBe("1");
        return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }));
      }
      return new Response("{}", { status: new Headers(options.headers).get("Authorization") === "Bearer old-access" ? 401 : 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const { apiResponse, saveTokens } = await import("./api");
    saveTokens("old-access", "old-refresh", false);
    const responses = await Promise.all([apiResponse("/ai-stream/video"), apiResponse("/ai-stream/status")]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
  });
});
