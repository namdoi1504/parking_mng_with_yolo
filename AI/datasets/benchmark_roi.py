"""Compare CPU/CUDA occupancy on real YOLO outputs; never sends backend writes."""
import json
import statistics
import time
from types import SimpleNamespace

import cv2
import torch
from ultralytics import YOLO

import parking_agent as agent
from roi_occupancy import ROIOccupancy


def main() -> None:
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    with open(agent.SORTED_JSON, encoding="utf-8") as source:
        regions = json.load(source)
    slot_map, _ = agent.load_slot_config(agent.CONFIG_JSON)
    engine = ROIOccupancy(regions, slot_map, device)
    model = YOLO(agent.MODEL_PATH)
    cap = cv2.VideoCapture(agent.VIDEO_SOURCE)
    cpu_times, tensor_times, differences = [], [], 0
    try:
        for seconds in [0, 10, 30, 60, 100]:
            cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(f"Cannot decode video at {seconds}s")
            result = model.predict(frame, imgsz=agent.IMGSZ, conf=.25, iou=.7,
                                   max_det=300, verbose=False, device=device)[0]
            manager = SimpleNamespace(json=regions, boxes=result.boxes.xyxy)
            engine.detect(manager.boxes)  # Warm up allocation and kernels.
            cpu_results = agent.detect_slot_status(manager, frame, slot_map)
            gpu_results = engine.detect(manager.boxes)
            differences += sum(a != b for a, b in zip(cpu_results, gpu_results))
            assert len(cpu_results) == len(gpu_results)
            for _ in range(5):
                if device.type == "cuda":
                    torch.cuda.synchronize()
                started = time.perf_counter()
                agent.detect_slot_status(manager, frame, slot_map)
                cpu_times.append((time.perf_counter() - started) * 1000)
                started = time.perf_counter()
                engine.detect(manager.boxes)  # Includes GPU -> CPU status transfer.
                if device.type == "cuda":
                    torch.cuda.synchronize()
                tensor_times.append((time.perf_counter() - started) * 1000)
            print(json.dumps({"video_seconds": seconds, "cars": len(result.boxes),
                              "mismatched_slots": sum(a != b for a, b in zip(cpu_results, gpu_results))}), flush=True)
    finally:
        cap.release()
    print(json.dumps({"device": str(device), "slots": len(slot_map), "mismatches": differences,
                      "cpu_median_ms": round(statistics.median(cpu_times), 2),
                      "tensor_median_ms": round(statistics.median(tensor_times), 2)}), flush=True)
    if differences:
        raise SystemExit("CPU/CUDA result mismatch")


if __name__ == "__main__":
    main()
