# import cv2

# from ultralytics import solutions

# cap = cv2.VideoCapture("parking_car.mp4")
# assert cap.isOpened(), "Error reading video file"

# # Video writer
# w, h, fps = (int(cap.get(x)) for x in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT, cv2.CAP_PROP_FPS))
# video_writer = cv2.VideoWriter("parking car result.avi", cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

# # Initialize parking management object
# parkingmanager = solutions.ParkingManagement(
#     model="cars_best.pt",  # path to model file
#     json_file="sorted_bounding_boxes.json",
#     imgsz=[1088, 1920],# path to parking annotations file
# )

# while cap.isOpened():
#     ret, im0 = cap.read()
#     if not ret:
#         break

#     results = parkingmanager(im0)

#     # print(results)  # access the output

#     video_writer.write(results.plot_im)  # write the processed frame.

# cap.release()
# video_writer.release()
# cv2.destroyAllWindows()  # destroy all opened windows



import cv2
import json
import time
import torch
import numpy as np

from ultralytics import YOLO
from types import SimpleNamespace
from pathlib import Path

from roi_occupancy import ROIOccupancy


DATASET_DIR = Path(__file__).resolve().parent
VIDEO_PATH = str(DATASET_DIR / "parking_car.mp4")
MODEL_PATH = str(DATASET_DIR / "cars_best.pt")
SLOTS_PATH = str(DATASET_DIR / "sorted_bounding_boxes.json")

IMGSZ = [1088, 1920]
CONF = 0.25
IOU = 0.7


device = torch.device(
    "cuda:0" if torch.cuda.is_available() else "cpu"
)

print("Device:", device)

model = YOLO(MODEL_PATH)

with open(SLOTS_PATH, "r", encoding="utf-8") as f:
    regions = json.load(f)


# slot code: 001, 002, 003...
slot_map = {
    i: f"{i + 1:03d}"
    for i in range(len(regions))
}


# Cache polygon geometry once
occupancy = ROIOccupancy(
    regions=regions,
    slot_map=slot_map,
    device=device
)


cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    raise RuntimeError("Cannot open video")


w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS)


writer = cv2.VideoWriter(
    "parking_result.mp4",
    cv2.VideoWriter_fourcc(*"mp4v"),
    fps,
    (w, h)
)


slot_polygons = []

for region in regions:

    pts = np.array(
        region["points"],
        dtype=np.int32
    )

    slot_polygons.append(pts)


frame_count = 0

while True:

    ret, frame = cap.read()

    if not ret:
        break

    start = time.perf_counter()

    result = model.predict(
        frame,
        imgsz=IMGSZ,
        conf=CONF,
        iou=IOU,
        max_det=300,
        verbose=False,
        device=device
    )[0]


    boxes = (
        result.boxes.xyxy
        if result.boxes is not None
        else None
    )


    statuses = occupancy.detect(boxes)


    for i, status in enumerate(statuses):

        pts = slot_polygons[i]

        occupied = (
            status["status"] == "OCCUPIED"
        )

        color = (
            (0, 0, 255)
            if occupied
            else (0, 255, 0)
        )

        cv2.polylines(
            frame,
            [pts],
            True,
            color,
            2
        )


    if boxes is not None:

        boxes_cpu = boxes.detach().cpu().numpy()

        for x1, y1, x2, y2 in boxes_cpu:

            cv2.rectangle(
                frame,
                (int(x1), int(y1)),
                (int(x2), int(y2)),
                (255, 0, 0),
                2
            )


    elapsed = time.perf_counter() - start

    current_fps = (
        1 / elapsed
        if elapsed > 0
        else 0
    )


    cv2.putText(
        frame,
        f"FPS: {current_fps:.1f}",
        (30, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (255, 255, 255),
        2
    )


    writer.write(frame)

    cv2.imshow(
        "Parking",
        frame
    )


    if cv2.waitKey(1) & 0xFF == ord("q"):
        break


    frame_count += 1


cap.release()
writer.release()
cv2.destroyAllWindows()

print("Done")
