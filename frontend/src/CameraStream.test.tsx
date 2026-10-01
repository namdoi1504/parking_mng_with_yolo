// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraStream } from "./CameraStream";

const status = { camera_id: 1, source_name: "parking_car.mp4", ready: true, running: true,
  frame_id: 5, frame_age_seconds: 0.1, updated_at: Date.now() / 1000,
  fps: 3.6, media_seconds: 12, occupied: 282, empty: 188, sync_ok: true, sync_at: Date.now() / 1000 };
function mockStatus(overrides = {}) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...status, ...overrides }) }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
    expect(image.getAttribute("src")).toBe("/ai-stream/video?attempt=0");
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
  });
  it("reports the image transport failing independently of health polling", async () => {
    mockStatus(); render(<CameraStream cameraId={1} />);
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.getByRole("status").textContent).toBe("Luồng hình mất kết nối");
  });
  it("reports an unavailable AI service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    render(<CameraStream cameraId={1} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Luồng hình mất kết nối"));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
