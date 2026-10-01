import cv2
import os
import numpy as np

# draw slot
def draw_slot_overlay(
    frame: np.ndarray,
    parkingmanager,
    slot_map: dict,
    slot_statuses: list[dict],
) -> np.ndarray:
    regions = getattr(parkingmanager, "json", [])
    status_by_code = {s["slot_code"]: s["status"] for s in slot_statuses}

    overlay = frame.copy()
    outlines = []
    colors = {"EMPTY": (129, 185, 14), "OCCUPIED": (232, 103, 40),
              "RESERVED": (17, 159, 245), "UNKNOWN": (72, 69, 239)}
    for idx, region in enumerate(regions):
        slot_code = slot_map.get(idx)
        if slot_code is None:
            continue

        pts = np.array(region["points"], dtype=np.int32).reshape(-1, 1, 2)
        status = status_by_code.get(slot_code, "UNKNOWN")
        color = colors[status]
        cv2.fillPoly(overlay, [pts], color)
        outlines.append((pts, color, slot_code))
    cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)
    for pts, color, slot_code in outlines:
        cv2.polylines(frame, [pts], True, color, 1)

        cx = int(pts[:, 0, 0].mean())
        cy = int(pts[:, 0, 1].mean())
        label = slot_code.zfill(3) if slot_code.isdigit() else slot_code
        cv2.putText(
            frame, label,
            (cx - 12, cy + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.3,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

    return frame


# cut frame
def cut_3s_frame(output_dir, video_path):
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    interval_sec = 3

    t = 0
    count = 0
    while t < duration:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if ret:
            filename = f"{output_dir}/frame_test{int(t)}s.jpg"
            cv2.imwrite(filename, frame)
            print(f"Đã lưu {filename}")
            count += 1
        t += interval_sec

    cap.release()
    print(f"Tổng cộng đã lưu {count} ảnh")


def cut_5_images(video_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    timestamps = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration * 0.95]

    for i, t in enumerate(timestamps):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if ret:
            filename = f"{output_dir}/stage{i + 1}_t{int(t)}s.jpg"
            cv2.imwrite(filename, frame)
            print(f"Đã lưu {filename}")

    cap.release()
