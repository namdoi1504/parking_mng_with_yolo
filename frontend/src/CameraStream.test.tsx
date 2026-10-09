// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraStream } from "./CameraStream";
import { apiFetch, apiResponse } from "./api";
import { receiveMjpeg } from "./mjpeg";
import { Profiler } from "react";
import { act } from "@testing-library/react";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiResponse: vi.fn() }));
vi.mock("./mjpeg", () => ({ receiveMjpeg: vi.fn() }));

const status = { camera_id: 1, source_name: "parking_car.mp4", ready: true, running: true,
  frame_id: 5, frame_age_seconds: 0.1, updated_at: Date.now() / 1000,
  fps: 3.6, media_seconds: 12, occupied: 282, empty: 188, sync_ok: true, sync_at: Date.now() / 1000 };
function mockStatus(overrides = {}) {
  vi.mocked(apiFetch).mockResolvedValue({ ...status, ...overrides });
}
beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test-frame"), revokeObjectURL: vi.fn() });
  vi.mocked(apiResponse).mockImplementation(async (_path, init) => ({ signal: init?.signal }) as unknown as Response);
  vi.mocked(receiveMjpeg).mockImplementation(async (response, onFrame) => {
    onFrame(new Uint8Array([255, 216, 255, 217]));
    const signal = (response as unknown as { signal: AbortSignal }).signal;
    await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("processed camera video", () => {
  it("distinguishes video throughput from AI throughput", async () => {
    mockStatus({ video_fps: 29.8, fps: 22, analysis_age_ms: 85, analysis_stale: false });
    render(<CameraStream cameraId={1} />);
    expect(await screen.findByText(/29.8 FPS video · 22 FPS AI · 85 ms/)).toBeTruthy();
  });
  it("does not present stale analysis as current parking counts", async () => {
    mockStatus({ analysis_stale: true }); render(<CameraStream cameraId={1} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Video đang chạy · kết quả AI chưa cập nhật"));
    expect(screen.queryByText("282")).toBeNull();
    expect(screen.getByRole("status").className).not.toContain("connection-connected");
  });
  it("shows the actual stream and its frame counts", async () => {
    mockStatus(); render(<CameraStream cameraId={1} />);
    const image = await screen.findByRole("img");
    expect(image.getAttribute("src")).toBe("blob:test-frame");
    expect(vi.mocked(apiResponse).mock.calls[0][0]).toBe("/ai-stream/video");
    expect(screen.getByRole("status").textContent).toBe("Đang nhận hình AI");
    expect(screen.getByText("282")).toBeTruthy();
  });
  it("does not show camera 1 as another camera's feed", async () => {
    mockStatus(); render(<CameraStream cameraId={2} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Camera này chưa có luồng hình"));
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not label a stale frame as live", async () => {
    mockStatus({ frame_age_seconds: 30 }); render(<CameraStream cameraId={1} />);
    await screen.findByRole("img");
    expect(screen.getByRole("status").className).not.toContain("connection-connected");
    expect(screen.getByText("Khung hình cũ · chưa nhận được cập nhật mới")).toBeTruthy();
    expect(screen.queryByText("282")).toBeNull();
    expect(screen.queryByText("Đã gửi trạng thái về hệ thống")).toBeNull();
  });
  it("reports the image transport failing independently of health polling", async () => {
    mockStatus(); render(<CameraStream cameraId={1} />);
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.getByRole("status").textContent).toBe("Luồng hình mất kết nối");
    expect(screen.queryByText("282")).toBeNull();
    expect(screen.queryByText("Đã gửi trạng thái về hệ thống")).toBeNull();
  });
  it("reports an unavailable AI service", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Offline"));
    render(<CameraStream cameraId={1} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Luồng hình mất kết nối"));
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not open video for a different camera", async () => {
    mockStatus(); render(<CameraStream cameraId={2} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Camera này chưa có luồng hình"));
    expect(apiResponse).not.toHaveBeenCalled();
  });
  it("aborts the stream and releases its frame when unmounted", async () => {
    mockStatus(); const { unmount } = render(<CameraStream cameraId={1} />);
    await screen.findByRole("img");
    const signal = vi.mocked(apiResponse).mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-frame");
  });
  it("updates successive JPEGs without committing the React panel each frame", async () => {
    let deliver: ((frame: Uint8Array) => void) | undefined;
    vi.mocked(receiveMjpeg).mockImplementation(async (response, onFrame) => {
      deliver = onFrame; onFrame(new Uint8Array([255, 216, 255, 217]));
      const signal = (response as unknown as { signal: AbortSignal }).signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const committed = vi.fn(); mockStatus();
    render(<Profiler id="video" onRender={committed}><CameraStream cameraId={1} /></Profiler>);
    await screen.findByRole("img");
    const initialCommits = committed.mock.calls.length;
    for (let i = 0; i < 20; i++) await act(async () => deliver?.(new Uint8Array([255, 216, 255, 217])));
    expect(committed).toHaveBeenCalledTimes(initialCommits);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(21);
  });
});
