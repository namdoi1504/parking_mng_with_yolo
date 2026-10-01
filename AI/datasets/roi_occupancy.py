"""Batched integer point-in-polygon tests on CUDA, with a CPU tensor fallback."""

import math
from typing import Any

import torch


class ROIOccupancy:
    """Cache polygon edges once; count boundary points as inside like OpenCV.

    Boxes use original-image xyxy coordinates. Both polygons and box centroids
    are truncated toward zero to preserve the previous agent's integer rule.
    Integer cross products avoid rounding errors at slanted polygon boundaries.
    """

    def __init__(self, regions: list[dict[str, Any]], slot_map: dict[int, str],
                 device: torch.device | str, chunk_size: int = 128) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        self.device = torch.device(device)
        self.chunk_size = chunk_size
        polygons = []
        self.codes = []
        for index, region in enumerate(regions):
            if index not in slot_map:
                continue
            points = region["points"]
            if len(points) < 3:
                raise ValueError("Each ROI needs at least three vertices")
            if any(len(p) != 2 or any(not math.isfinite(float(v)) or abs(v) > 1_000_000
                                     for v in p) for p in points):
                raise ValueError("ROI coordinates must be finite and within safe integer bounds")
            polygons.append([(int(x), int(y)) for x, y in points])
            self.codes.append(slot_map[index])
        edges = max((len(p) for p in polygons), default=1)
        starts = torch.zeros((len(polygons), edges, 2), dtype=torch.int64)
        ends = torch.zeros_like(starts)
        valid = torch.zeros((len(polygons), edges), dtype=torch.bool)
        for index, polygon in enumerate(polygons):
            starts[index, :len(polygon)] = torch.tensor(polygon)
            ends[index, :len(polygon)] = torch.tensor(polygon[1:] + polygon[:1])
            valid[index, :len(polygon)] = True
        # Cached shapes: (polygon, 1, edge). The middle axis broadcasts over cars.
        starts, ends = starts.to(self.device), ends.to(self.device)
        self.ax, self.ay = starts[..., 0].unsqueeze(1), starts[..., 1].unsqueeze(1)
        self.bx, self.by = ends[..., 0].unsqueeze(1), ends[..., 1].unsqueeze(1)
        self.dx, self.dy = self.bx - self.ax, self.by - self.ay
        self.valid = valid.to(self.device).unsqueeze(1)

    @torch.inference_mode()
    def occupied(self, boxes: torch.Tensor | None) -> torch.Tensor:
        """Return one boolean per polygon, on the configured device."""
        occupied = torch.zeros(len(self.codes), dtype=torch.bool, device=self.device)
        if boxes is None or not len(self.codes):
            return occupied
        if boxes.ndim != 2 or boxes.shape[1] != 4:
            raise ValueError("Boxes must have shape (cars, 4)")
        boxes = boxes.to(self.device)
        # Preserve float box-addition rounding before truncating the centers.
        centers = torch.trunc((boxes[:, :2] + boxes[:, 2:]) / 2).to(torch.int64)
        for chunk in centers.split(self.chunk_size):
            px, py = chunk[:, 0][None, :, None], chunk[:, 1][None, :, None]
            cross = self.dx * (py - self.ay) - self.dy * (px - self.ax)
            on_edge = ((cross == 0) & (px >= torch.minimum(self.ax, self.bx))
                       & (px <= torch.maximum(self.ax, self.bx))
                       & (py >= torch.minimum(self.ay, self.by))
                       & (py <= torch.maximum(self.ay, self.by)) & self.valid)
            # Ray crosses a nonhorizontal edge to the right of the point.
            crosses = (((self.ay > py) != (self.by > py))
                       & torch.where(self.dy > 0, cross > 0, cross < 0) & self.valid)
            inside = ((crosses.sum(dim=2) % 2) != 0) | on_edge.any(dim=2)
            occupied |= inside.any(dim=1)
        return occupied

    def detect(self, boxes: torch.Tensor | None) -> list[dict[str, Any]]:
        # One small GPU -> CPU transfer, after all geometric tests finish.
        flags = self.occupied(boxes).cpu().tolist()
        return [{"slot_code": code, "status": "OCCUPIED" if flag else "EMPTY",
                 "confidence": None} for code, flag in zip(self.codes, flags)]
