import argparse
import json
import time
import threading
import httpx
import cv2
import numpy as np
import torch
from pathlib import Path
from types import SimpleNamespace
from ultralytics import YOLO
from utils import draw_slot_overlay
from stream_server import FrameStore, create_server
from roi_occupancy import ROIOccupancy
from live_pipeline import LatestVideo, SlotRenderer

# Folder containing this script
HERE = Path(__file__).parent

# CONFIGURATION
BACKEND_URL      = "http://localhost:8000"
CAMERA_ID        = 1
CONFIG_JSON      = HERE / "slots_config.json"
SORTED_JSON      = str(HERE / "sorted_bounding_boxes.json")
MODEL_PATH       = str(HERE / "cars_best.pt")
VIDEO_SOURCE     = str(HERE / "parking_car_slow_05x.mp4")
SEND_INTERVAL    = 3.0
SHOW_WINDOW      = True
IMGSZ            = [1088, 1920]                    # multiple of 32
STREAM_STORE: FrameStore | None = None
SEND_LOCK = threading.Lock()



def load_slot_config(path: str) -> tuple[dict[int, str], list[dict]]:
    """
    Đọc slots_config.json → (index_to_code, slot_list_for_sync)
    """
    with open(path, encoding="utf-8") as f:
        config = json.load(f)
    index_map = {item["index"]: item["slot_code"] for item in config}
    return index_map, config


def sync_slots_with_backend(config: list[dict], camera_id: int) -> bool:
    """
    Call /api/ai/sync-slots to upsert all slots to DB.
    Run once when agent starts.
    Automatically adapts to any number of slots.
    """
    slots_payload = []
    for item in config:
        # Convert points [[x,y],...] → [{"x":..,"y":..},...]
        roi = [{"x": float(p[0]), "y": float(p[1])} for p in item["points"]]
        slots_payload.append({
            "slot_code"       : item["slot_code"],
            "roi_coordinates" : roi,
            "col"             : item.get("col", 0),
            "row"             : item.get("row", 0),
        })

    payload = {"camera_id": camera_id, "slots": slots_payload}

    try:
        resp = httpx.post(
            f"{BACKEND_URL}/api/ai/sync-slots",
            json=payload,
            timeout=30.0,
        )
        if resp.status_code == 200:
            r = resp.json()
            print(
                f" Sync slots: total={r['total']} | "
                f"created={r['created']} | updated={r['updated']} | unchanged={r['unchanged']}"
            )
            return True
        else:
            print(f" Sync fail {resp.status_code}: {resp.text[:200]}")
            return False
    except httpx.ConnectError:
        print(f" Can't connect to {BACKEND_URL}")
        print("   Please ensure Backend is running before starting agent!")
        return False
    except httpx.HTTPError as error:
        print(f" Slot sync unavailable ({type(error).__name__}); video processing will continue.")
        return False


def detect_slot_status(
    parkingmanager,
    frame: np.ndarray,
    slot_map: dict[int, str]
) -> list[dict]:
    """
    Calculate per-slot occupancy using cv2.pointPolygonTest.
    Use parkingmanager.boxes (confirmed correct image coordinates).
    """
    slot_statuses = []

    regions = getattr(parkingmanager, "json", [])
    if not regions:
        return slot_statuses

    # parkingmanager.boxes = xyxy tensor (N×4) in original image coordinates
    boxes_tensor = getattr(parkingmanager, "boxes", None)
    centroids: list[tuple[int, int]] = []

    if boxes_tensor is not None:
        try:
            raw = boxes_tensor.cpu().numpy()   # shape (N, 4): x1 y1 x2 y2
            centroids = [
                (int((b[0] + b[2]) / 2), int((b[1] + b[3]) / 2))
                for b in raw
            ]
        except Exception as e:
            print(f" Lỗi đọc boxes: {e}")

    # Debug first time — confirm coordinate space
    if not hasattr(detect_slot_status, "_logged"):
        detect_slot_status._logged = True
        xmin = min(c[0] for c in centroids) if centroids else 0
        xmax = max(c[0] for c in centroids) if centroids else 0
        ymin = min(c[1] for c in centroids) if centroids else 0
        ymax = max(c[1] for c in centroids) if centroids else 0
        print(f" boxes={len(centroids)} | x:{xmin}-{xmax} y:{ymin}-{ymax} | slots={len(regions)}")

    # Polygon hit-test for each slot
    for idx, region in enumerate(regions):
        slot_code = slot_map.get(idx)
        if slot_code is None:
            continue

        pts = np.array(region["points"], dtype=np.int32).reshape(-1, 1, 2)
        is_occupied = any(
            cv2.pointPolygonTest(pts, (float(xc), float(yc)), False) >= 0
            for (xc, yc) in centroids
        )

        slot_statuses.append({
            "slot_code" : slot_code,
            "status"    : "OCCUPIED" if is_occupied else "EMPTY",
            "confidence": None,
        })

    # Debug first time — count occupied
    if not hasattr(detect_slot_status, "_count_logged"):
        detect_slot_status._count_logged = True
        occ_count = sum(1 for s in slot_statuses if s["status"] == "OCCUPIED")
        print(f"   polygon test: {occ_count}/{len(slot_statuses)} OCCUPIED")

    return slot_statuses



def send_to_backend(slot_statuses: list[dict], camera_id: int) -> None:
    """Gửi HTTP POST về backend (chạy trong thread riêng để không block YOLO)."""
    payload = {
        "camera_id"    : camera_id,
        "parking_slots": slot_statuses,
    }
    try:
        resp = httpx.post(
            f"{BACKEND_URL}/api/ai/parking-status",
            json=payload,
            timeout=15.0,   # increased from 3s to 15s
        )
        if resp.status_code == 200:
            if STREAM_STORE:
                STREAM_STORE.sync_result(True)
            result = resp.json()
            print(
                f"  Send {result['received_slots']} slot | "
                f"changed={result['changed_slots']} | "
                f"unknown={len(result['unknown_slots'])}"
            )
        else:
            if STREAM_STORE:
                STREAM_STORE.sync_result(False)
            print(f"  Backend trả {resp.status_code}: {resp.text[:100]}")
    except httpx.ConnectError:
        if STREAM_STORE:
            STREAM_STORE.sync_result(False)
        print(f"  Can't connect to {BACKEND_URL}")
    except Exception as e:
        if STREAM_STORE:
            STREAM_STORE.sync_result(False)
        print(f"  Error: {e}")


def send_async(slot_statuses: list[dict], camera_id: int) -> None:
    """Gửi trong background thread — không block vòng lặp YOLO."""
    if not SEND_LOCK.acquire(blocking=False):
        return
    def send_once() -> None:
        try:
            send_to_backend(slot_statuses, camera_id)
        finally:
            SEND_LOCK.release()
    t = threading.Thread(
        target=send_once,
        daemon=True,
    )
    t.start()


def run_agent(show_window: bool = SHOW_WINDOW):
    print(f"Parking Agent starting")
    print(f"   Backend : {BACKEND_URL}")
    print(f"   Camera  : {VIDEO_SOURCE}")
    print(f"   Model   : {MODEL_PATH}")

    if not Path(VIDEO_SOURCE).is_file():
        raise FileNotFoundError(f"Video not found: {VIDEO_SOURCE}")
    # Load slot mapping + config
    slot_map, slot_config = load_slot_config(CONFIG_JSON)
    print(f"   Slots   : {len(slot_map)} slot từ {CONFIG_JSON}")

    # Auto sync slots to DB (upsert)
    print("\n Sync slots with Backend...")
    synced = sync_slots_with_backend(slot_config, CAMERA_ID)
    if not synced:
        print("  Sync fail but agent still running")

    # Keep YOLO boxes and cached ROI geometry on the same device.
    # ParkingManagement repeats GPU scalar reads inside 470 polygon loops.
    model = YOLO(MODEL_PATH)
    with open(SORTED_JSON, encoding="utf-8") as regions_file:
        parkingmanager = SimpleNamespace(json=json.load(regions_file), boxes=None)
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    occupancy = ROIOccupancy(parkingmanager.json, slot_map, device)
    print(f" YOLO + ROI device: {device}")


    video = LatestVideo(VIDEO_SOURCE)
    stop = threading.Event()
    analysis_lock = threading.Lock()
    analysis = {}
    render_errors = []

    def render_video():
        previous, renderer = -1, None
        last_stamp, video_fps = time.perf_counter(), 0.0
        try:
            while not stop.is_set():
                sample = video.get(previous)
                if sample is None:
                    continue
                previous = sample.sequence
                if renderer is None:
                    renderer = SlotRenderer(parkingmanager.json, slot_map, sample.image.shape)
                with analysis_lock:
                    current = analysis.copy()
                age = time.perf_counter() - current.get("captured_at", 0)
                fresh = current.get("epoch") == sample.epoch and age < 2
                statuses = current.get("statuses", []) if fresh else []
                # Do not show old vehicle boxes as if they belonged to this frame.
                boxes = current.get("boxes", np.empty((0, 4))) if fresh and age < .3 else np.empty((0, 4))
                render_started = time.perf_counter()
                display = renderer.draw(sample.image, statuses, boxes)
                render_ms = (time.perf_counter() - render_started) * 1000
                if STREAM_STORE:
                    encode_started = time.perf_counter()
                    ok, encoded = cv2.imencode(".jpg", display, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    stamp = time.perf_counter()
                    instantaneous = 1 / max(stamp - last_stamp, .001)
                    video_fps = instantaneous if not video_fps else video_fps * .8 + instantaneous * .2
                    last_stamp = stamp
                    if ok:
                        STREAM_STORE.publish(
                            encoded.tobytes(), frame_id=sample.sequence,
                            fps=current.get("fps", 0), video_fps=round(video_fps, 1),
                            roi_device=str(device), roi_ms=current.get("roi_ms", 0),
                            inference_ms=current.get("inference_ms", 0), render_ms=round(render_ms, 2),
                            encode_ms=round((stamp - encode_started) * 1000, 2),
                            analysis_age_ms=round(age * 1000, 1) if current else None,
                            analysis_stale=not fresh, ai_frame_id=current.get("sequence"),
                            ai_media_seconds=current.get("media_seconds"),
                            media_seconds=round(sample.media_seconds, 2),
                            occupied=sum(s["status"] == "OCCUPIED" for s in statuses),
                            empty=sum(s["status"] == "EMPTY" for s in statuses))
                if show_window:
                    cv2.imshow("Parking Agent [Q de thoat]", display)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        stop.set()
        except Exception as error:
            render_errors.append(error)
            stop.set()

    video.start()
    renderer_thread = threading.Thread(target=render_video, daemon=True)
    renderer_thread.start()
    last_sent, previous, ai_fps = 0.0, -1, 0.0
    last_stamp = time.perf_counter()
    try:
        while not stop.is_set():
            sample = video.get(previous)
            if sample is None:
                continue
            previous = sample.sequence
            inference_started = time.perf_counter()
            # Keep input resolution and thresholds unchanged to preserve accuracy.
            result = model.predict(sample.image, imgsz=IMGSZ, conf=.25, iou=.7,
                                   max_det=300, verbose=False, device=device)[0]
            parkingmanager.boxes = result.boxes.xyxy if result.boxes is not None else None
            roi_started = time.perf_counter()
            statuses = occupancy.detect(parkingmanager.boxes)
            roi_ms = (time.perf_counter() - roi_started) * 1000
            boxes = (parkingmanager.boxes.detach().cpu().numpy()
                     if parkingmanager.boxes is not None else np.empty((0, 4)))
            stamp = time.perf_counter()
            instantaneous = 1 / max(stamp - last_stamp, .001)
            ai_fps = instantaneous if not ai_fps else ai_fps * .8 + instantaneous * .2
            last_stamp = stamp
            with analysis_lock:
                analysis.update(statuses=statuses, boxes=boxes, epoch=sample.epoch,
                                captured_at=sample.captured_at, sequence=sample.sequence,
                                media_seconds=round(sample.media_seconds, 2),
                                roi_ms=round(roi_ms, 2), fps=round(ai_fps, 1),
                                inference_ms=round((roi_started - inference_started) * 1000, 2))
            if time.time() - last_sent >= SEND_INTERVAL:
                if statuses:
                    send_async(statuses, CAMERA_ID)
                last_sent = time.time()
        if render_errors:
            raise RuntimeError("Preview renderer failed") from render_errors[0]
    finally:
        stop.set()
        video.close()
        renderer_thread.join(timeout=5)
        cv2.destroyAllWindows()
    print("\nAgent stopped.")


def main() -> None:
    global STREAM_STORE
    parser = argparse.ArgumentParser(description="YOLO parking agent with optional local MJPEG preview")
    parser.add_argument("--stream", action="store_true")
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--stream-port", type=int, default=8001)
    args = parser.parse_args()
    server = None
    if args.stream:
        STREAM_STORE = FrameStore(CAMERA_ID, Path(VIDEO_SOURCE).name)
        server = create_server(STREAM_STORE, args.stream_port)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"Local AI stream: http://127.0.0.1:{args.stream_port}/video")
    try:
        run_agent(show_window=SHOW_WINDOW and not args.no_window)
    finally:
        if STREAM_STORE:
            STREAM_STORE.stop()
        if server:
            server.shutdown()
            server.server_close()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
