"""
Script sắp xếp lại bounding_boxes.json theo vị trí không gian
(trái→phải, trên→dưới) và sinh:
  - sorted_bounding_boxes.json  : dùng thay thế cho Ultralytics
  - slots_config.json           : mapping index → slot_code cho AI engine

Chạy: python sort_slots.py
Sau đó: python visualize_slot_index.py  (để xem kết quả đã sort)
"""
import json
import cv2
import numpy as np

# ======== CẤU HÌNH ========
INPUT_JSON   = "bounding_boxes.json"
SORTED_JSON  = "sorted_bounding_boxes.json"   # dùng cho Ultralytics thay vì input gốc
CONFIG_JSON  = "slots_config.json"            # dùng cho AI engine
PREVIEW_PNG  = "sorted_preview.png"

VIDEO_FILE   = "parking_car.mp4"              # để lấy frame nền

CAMERA_ID    = 1                              # Camera ID trong DB backend

# Ngưỡng gom hàng: 2 slot cách nhau < ROW_TOLERANCE pixel Y → cùng hàng
# Tăng nếu slot to, giảm nếu slot nhỏ và nhiều hàng sát nhau
COL_TOLERANCE = 20   # pixel — 2 slot cách nhau < COL_TOLERANCE pixel X → cùng cột

# Prefix tên slot: "A01", "A02"... hoặc "P001", "P002"...
SLOT_PREFIX  = ""    # để trống → dùng số thuần: "001", "002"...
                     # đặt "A" → "A001", "A002"...
# ==========================


def centroid(points):
    pts = np.array(points, dtype=np.float32)
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


def sort_slots_by_column(regions: list, col_tolerance: int = 20) -> list:
    """
    Sắp xếp slot theo cột (column-major):
    1. Gom thành "cột" dựa trên tọa độ X của centroid
    2. Trong mỗi cột, sort theo Y (trên → dưới)
    3. Các cột sort theo X (trái → phải)
    """
    indexed = [(i, r, centroid(r["points"])) for i, r in enumerate(regions)]

    # Sort theo X trước
    by_x = sorted(indexed, key=lambda s: s[2][0])

    # Gom cột theo X với tolerance
    cols = []
    current_col = [by_x[0]]
    for item in by_x[1:]:
        prev_x = np.mean([s[2][0] for s in current_col])
        if abs(item[2][0] - prev_x) <= col_tolerance:
            current_col.append(item)
        else:
            # Sort trong cột theo Y (trên → dưới)
            cols.append(sorted(current_col, key=lambda s: s[2][1]))
            current_col = [item]
    cols.append(sorted(current_col, key=lambda s: s[2][1]))

    return cols


def generate_slot_code(new_idx: int, prefix: str) -> str:
    if prefix:
        return f"{prefix}{new_idx + 1:03d}"
    return f"{new_idx + 1:03d}"


def main():
    with open(INPUT_JSON, encoding="utf-8") as f:
        regions = json.load(f)

    print(f"Tổng slot gốc: {len(regions)}")
    print(f"Col tolerance: {COL_TOLERANCE}px")

    # Sort theo cột (column-major: trái→phải, trong cột trên→dưới)
    cols = sort_slots_by_column(regions, COL_TOLERANCE)
    print(f"Số cột tìm được: {len(cols)}")
    for i, col in enumerate(cols):
        print(f"  Cột {i+1:3d}: {len(col):3d} slot  "
              f"X≈{np.mean([s[2][0] for s in col]):.0f}  "
              f"Y=[{min(s[2][1] for s in col):.0f}..{max(s[2][1] for s in col):.0f}]")

    # Sinh danh sách mới theo thứ tự đã sort
    sorted_regions = []
    config_output  = []
    new_idx = 0

    for col_idx, col in enumerate(cols):
        for row_idx, (orig_idx, region, (cx, cy)) in enumerate(col):
            slot_code = generate_slot_code(new_idx, SLOT_PREFIX)

            sorted_regions.append(region)
            config_output.append({
                "index"      : new_idx,
                "orig_index" : orig_idx,
                "slot_code"  : slot_code,
                "camera_id"  : CAMERA_ID,
                "col"        : col_idx,
                "row"        : row_idx,
                "centroid"   : {"x": round(cx, 1), "y": round(cy, 1)},
                "points"     : region["points"]
            })
            new_idx += 1

    # Ghi sorted_bounding_boxes.json
    with open(SORTED_JSON, "w", encoding="utf-8") as f:
        json.dump(sorted_regions, f, indent=2)
    print(f"\n✅ Đã ghi: {SORTED_JSON}  ({len(sorted_regions)} slots)")

    # Ghi slots_config.json
    with open(CONFIG_JSON, "w", encoding="utf-8") as f:
        json.dump(config_output, f, ensure_ascii=False, indent=2)
    print(f"✅ Đã ghi: {CONFIG_JSON}  ({len(config_output)} slots)")

    # ── Vẽ preview ──
    cap = cv2.VideoCapture(VIDEO_FILE)
    if not cap.isOpened():
        print("⚠️  Không mở được video, bỏ qua preview")
        return
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return

    preview = frame.copy()

    # Màu theo cột (mỗi cột 1 màu khác nhau)
    col_colors = [
        (255, 100, 100), (100, 255, 100), (100, 100, 255),
        (255, 255, 100), (255, 100, 255), (100, 255, 255),
        (200, 150, 50),  (50, 200, 150),  (150, 50, 200),
    ]

    for slot in config_output:
        pts = np.array(slot["points"], dtype=np.int32).reshape(-1, 1, 2)
        color = col_colors[slot["col"] % len(col_colors)]
        cx_i = int(slot["centroid"]["x"])
        cy_i = int(slot["centroid"]["y"])

        # Fill mờ theo màu hàng
        overlay = preview.copy()
        cv2.fillPoly(overlay, [pts], color)
        cv2.addWeighted(overlay, 0.2, preview, 0.8, 0, preview)

        # Viền
        cv2.polylines(preview, [pts], True, color, 1)

        # Label: slot_code
        label = slot["slot_code"]
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
        cv2.rectangle(preview, (cx_i-1, cy_i-th-2), (cx_i+tw+1, cy_i+2), (0,0,0), -1)
        cv2.putText(preview, label, (cx_i, cy_i),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)

    cv2.imwrite(PREVIEW_PNG, preview)
    print(f"✅ Đã xuất preview: {PREVIEW_PNG}")

    # Hiển thị
    h, w = preview.shape[:2]
    if w > 1280:
        scale = 1280 / w
        display = cv2.resize(preview, (int(w*scale), int(h*scale)))
    else:
        display = preview

    print("\n   Cửa sổ đang hiện — nhấn phím bất kỳ để đóng...")
    cv2.imshow("Sorted Slots Preview  [nhan phim bat ky de dong]", display)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    print("\n📌 BƯỚC TIẾP THEO:")
    print(f"   1. Kiểm tra '{PREVIEW_PNG}' — mỗi màu = 1 hàng, slot đánh số 001..{len(config_output):03d}")
    print(f"   2. Nếu thứ tự ổn: đổi main.py dùng '{SORTED_JSON}' thay vì '{INPUT_JSON}'")
    print(f"   3. AI engine đọc '{CONFIG_JSON}' để biết index → slot_code")
    print(f"   4. Neu cot chua dung: chinh COL_TOLERANCE (hien = {COL_TOLERANCE}) roi chay lai")


if __name__ == "__main__":
    main()
