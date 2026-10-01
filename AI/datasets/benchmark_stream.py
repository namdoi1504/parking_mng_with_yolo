"""Read-only verification of received MJPEG FPS and live pipeline metrics."""
import json
import time
import urllib.request


def main() -> None:
    started = time.monotonic()
    count, tail = 0, b""
    marker = b"--frame\r\n"
    with urllib.request.urlopen("http://127.0.0.1:8001/video", timeout=10) as response:
        while time.monotonic() - started < 5:
            chunk = response.read(65536)
            if not chunk:
                raise RuntimeError("MJPEG stream ended")
            joined = tail + chunk
            count += joined.count(marker)
            tail = joined[-(len(marker) - 1):]
    print(json.dumps({"received_mjpeg_fps": round(count / (time.monotonic() - started), 1)}), flush=True)
    rows = []
    for _ in range(5):
        with urllib.request.urlopen("http://127.0.0.1:8001/status", timeout=5) as response:
            rows.append(json.load(response))
        time.sleep(3)
    fields = ["video_fps", "fps", "analysis_age_ms", "roi_ms", "inference_ms",
              "render_ms", "encode_ms", "analysis_stale"]
    print(json.dumps({key: [row.get(key) for row in rows] for key in fields}), flush=True)


if __name__ == "__main__":
    main()
