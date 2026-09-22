import cv2
import json
import numpy as np
from ultralytics import YOLO

cap = cv2.VideoCapture("parking_car.mp4")
assert cap.isOpened(), "Error reading video file"

w, h, fps = (int(cap.get(x)) for x in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT, cv2.CAP_PROP_FPS))
video_writer = cv2.VideoWriter("parking_car_result1.avi", cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

model = YOLO("cars_best.pt")
with open("bounding_boxes.json") as f:
    regions = json.load(f)  # list các {"points": [[x,y], ...]}

while cap.isOpened():
    ret, im0 = cap.read()
    if not ret:
        break

    results = model.predict(im0, imgsz=[1088, 1920], verbose=False)[0]
    boxes = results.boxes.xyxy.cpu().numpy() if results.boxes is not None else []
    centers = [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in boxes]

    filled = 0
    for idx, region in enumerate(regions, start=1):
        pts = np.array(region["points"], dtype=np.int32).reshape((-1, 1, 2))
        occupied = any(cv2.pointPolygonTest(pts, c, False) >= 0 for c in centers)
        color = (0, 0, 255) if occupied else (0, 255, 0)  # đỏ = đã đậu, xanh = trống
        filled += occupied

        cv2.polylines(im0, [pts], True, color, 2)
        cx, cy = pts.reshape(-1, 2).mean(axis=0).astype(int)
        cv2.putText(im0, str(idx), (cx - 10, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    total = len(regions)
    available = total - filled
    cv2.rectangle(im0, (10, 10), (300, 100), (255, 255, 255), -1)
    cv2.putText(im0, f"Total: {total}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(im0, f"Occupied: {filled}", (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.putText(im0, f"Available: {available}", (20, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2)

    video_writer.write(im0)

cap.release()
video_writer.release()
cv2.destroyAllWindows()