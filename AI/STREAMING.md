# Local processed-video preview

Put `parking_car.mp4` in `AI/datasets`, alongside `cars_best.pt` and the ROI JSON files.
The agent currently reads `parking_car_slow_05x.mp4`, a half-speed copy of the
original (about 147 seconds). Generate it without overwriting the original:

```powershell
ffmpeg -n -i AI/datasets/parking_car.mp4 -vf "setpts=2*PTS" -af "atempo=0.5" -c:v libx264 -preset fast -crf 20 -r 30000/1001 -c:a aac -b:a 128k -movflags +faststart AI/datasets/parking_car_slow_05x.mp4
```
Start the existing backend on port 8000, then from the project root:

```powershell
python -u AI/datasets/parking_agent.py --stream --no-window
```

Start the frontend with its usual `pnpm dev` command and sign in at
`http://localhost:5173/monitor`. The Vite development proxy forwards `/ai-stream`
to the separate AI preview service on `127.0.0.1:8001`.

The decoder, YOLO inference, and preview renderer run independently. Each keeps
only its latest frame/result. The renderer overlays the latest AI statuses onto
the current video frame and publishes JPEGs as MJPEG at `/video`. `/status`
reports freshness, video/AI throughput, video time, and backend status-send result.
`/frame.jpg` returns a snapshot for diagnostics. Viewers do not start extra YOLO
workers; old frames are dropped rather than queued. At most four viewers are
accepted. Stop with Ctrl+C in the AI terminal.

This is **a local development/demo preview**, not an authenticated production
video service. It binds only to loopback. Do not expose port 8001 or the Vite
proxy publicly without adding a separate authenticated gateway. The production
frontend needs an equivalent same-origin proxy; Vite's build does not include
its development server proxy.

For a standalone local preview without dashboard login, open
`http://127.0.0.1:8001/` (or `http://localhost:5173/ai-stream/` through Vite).

The file loops on a wall-clock playback timeline. Intervening frames are skipped
when inference cannot keep up; the stream shows only frames actually processed.
`fps` is actual AI processing throughput; `video_fps` is actual rendered/published
video throughput, not an assumed 30 FPS. `analysis_age_ms` measures how old the
source image used for the latest AI result is; the overlay can lag the video.
Vehicle boxes are hidden when this age exceeds 300 ms. Slot colors become
unknown and counts are withheld in the UI after two seconds without a fresh
result, or when the source loops and no result exists yet for the new loop.
`ai_frame_id` and `ai_media_seconds` identify the result's source frame.
Backend status notifications are sent every three seconds and may arrive later.
Backend source code is unchanged.
Running the agent uses the existing slot-sync/status APIs and therefore updates
the existing camera 1 parking data. Blue means occupied; green means empty,
matching the web interface.

YOLO and the batched per-slot ROI tests automatically use CUDA when available.
Polygon edges are cached on the GPU; only the final occupancy flags are copied
to the CPU. Without CUDA, the same tensor calculation falls back to the CPU.
Drawing overlays, video decoding, and JPEG encoding still use the CPU.
Polygons and label positions are cached; preview drawing happens at 1280px wide
instead of 1920px. YOLO input resolution, thresholds, and model are unchanged.
Boxes are transferred to the CPU once per result, not read individually by
`result.plot()`. `/status` includes `roi_device`, `roi_ms`, `inference_ms`,
`render_ms`, and `encode_ms` for verification.

To check accuracy and timing without sending any backend writes:

```powershell
python -m unittest discover -s AI/tests -v
python -u AI/datasets/benchmark_roi.py
python -u AI/datasets/benchmark_stream.py
```

On the local RTX 4060 Laptop GPU, five sampled video frames produced no status
differences across 470 slots compared with the original OpenCV implementation.
Median ROI time was 132.64 ms on the original CPU path versus 3.95 ms on CUDA,
including the final status transfer. These are ROI-only timings, not full-frame
FPS guarantees.

After separating playback/inference/rendering, a local live check received
about 30 MJPEG frames per second. Five status samples showed 24.1-26.1 AI FPS
and 65.9-102.6 ms result age. Before this change the coupled pipeline produced
about 8.5-8.7 video/AI FPS. These measurements depend on device load; video FPS
does not mean YOLO processes every frame. This check does not resolve backend
connectivity: video can play with `sync_ok=false`.
