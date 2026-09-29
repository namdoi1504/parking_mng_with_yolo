import json
import time
import threading
import httpx
import cv2
import numpy as np
from pathlib import Path
from ultralytics import solutions
from utils import draw_slot_overlay

# Folder containing this script
HERE = Path(__file__).parent

# CONFIGURATION
BACKEND_URL      = "http://localhost:8000"
CAMERA_ID        = 1
CONFIG_JSON      = HERE / "slots_config.json"
SORTED_JSON      = str(HERE / "sorted_bounding_boxes.json")
MODEL_PATH       = str(HERE / "cars_best.pt")
VIDEO_SOURCE     = str(HERE / "parking_car.mp4")
SEND_INTERVAL    = 3.0
SHOW_WINDOW      = True
IMGSZ            = [1088, 1920]                    # multiple of 32



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
            result = resp.json()
            print(
                f"  Send {result['received_slots']} slot | "
                f"changed={result['changed_slots']} | "
                f"unknown={len(result['unknown_slots'])}"
            )
        else:
            print(f"  Backend trả {resp.status_code}: {resp.text[:100]}")
    except httpx.ConnectError:
        print(f"  Can't connect to {BACKEND_URL}")
    except Exception as e:
        print(f"  Error: {e}")


def send_async(slot_statuses: list[dict], camera_id: int) -> None:
    """Gửi trong background thread — không block vòng lặp YOLO."""
    t = threading.Thread(
        target=send_to_backend,
        args=(slot_statuses, camera_id),
        daemon=True,
    )
    t.start()


def main():
    print(f"Parking Agent starting")
    print(f"   Backend : {BACKEND_URL}")
    print(f"   Camera  : {VIDEO_SOURCE}")
    print(f"   Model   : {MODEL_PATH}")

    # Load slot mapping + config
    slot_map, slot_config = load_slot_config(CONFIG_JSON)
    print(f"   Slots   : {len(slot_map)} slot từ {CONFIG_JSON}")

    # Auto sync slots to DB (upsert)
    print("\n Sync slots with Backend...")
    synced = sync_slots_with_backend(slot_config, CAMERA_ID)
    if not synced:
        print("  Sync fail but agent still running")

    # Initialize YOLO ParkingManagement with sorted file
    parkingmanager = solutions.ParkingManagement(
        model     = MODEL_PATH,
        json_file = SORTED_JSON,
        imgsz     = IMGSZ,
    )


    cap = cv2.VideoCapture(VIDEO_SOURCE)
    assert cap.isOpened(), f"Can't open source: {VIDEO_SOURCE}"

    last_sent = 0.0
    frame_idx = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            # End of video → loop
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        frame_idx += 1

        # Run detection
        results = parkingmanager(frame)

        display_frame = (
            results.plot_im.copy()
            if hasattr(results, "plot_im")
            else frame.copy()
        )
        slot_statuses = detect_slot_status(
            parkingmanager,
            frame,
            slot_map
        )
        display_frame = draw_slot_overlay(
            display_frame,
            parkingmanager,
            slot_map,
            slot_statuses
        )

        # Send to backend by interval
        now = time.time()

        if now - last_sent >= SEND_INTERVAL:
            if slot_statuses:
                print(
                    f"\n[Frame {frame_idx}] "
                    f"Sending {len(slot_statuses)} slots..."
                )

                send_async(
                    slot_statuses,
                    CAMERA_ID
                )

            last_sent = now
        if SHOW_WINDOW:
            h, w = display_frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                display_frame = cv2.resize(display_frame, (int(w*scale), int(h*scale)))
            cv2.imshow("Parking Agent [Q de thoat]", display_frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()
    print("\nAgent stopped.")


if __name__ == "__main__":
    main()
