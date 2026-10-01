import json
import unittest
from pathlib import Path

import cv2
import numpy as np
import torch

from AI.datasets.roi_occupancy import ROIOccupancy


def reference(regions, points):
    return [any(cv2.pointPolygonTest(np.asarray(region["points"], dtype=np.int32),
                                    (float(int(x)), float(int(y))), False) >= 0
                for x, y in points) for region in regions]


class ROITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.threads = torch.get_num_threads()
        torch.set_num_threads(1)

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.threads)

    def assert_matches(self, regions, points):
        expected = reference(regions, points)
        boxes = torch.tensor([[x, y, x, y] for x, y in points], dtype=torch.float32).reshape(-1, 4)
        devices = ["cpu", "cuda:0"] if torch.cuda.is_available() else ["cpu"]
        for device in devices:
            with self.subTest(device=device):
                engine = ROIOccupancy(regions, {i: str(i) for i in range(len(regions))}, device, chunk_size=17)
                self.assertEqual(engine.occupied(boxes.to(device)).cpu().tolist(), expected)

    def test_vertices_edges_inside_and_outside(self):
        regions = [{"points": [[0, 0], [10, 0], [10, 10], [0, 10]]},
                   {"points": [[20, 0], [30, 10], [20, 20], [10, 10]]}]
        for point in [(0, 0), (5, 0), (10, 10), (5, 5), (11, 0), (-1, 5),
                      (15, 5), (20, 10), (25, 5), (25, 6), (5.9, -.9)]:
            self.assert_matches(regions, [point])

    def test_concave_reversed_and_degenerate_polygons(self):
        points = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]
        regions = [{"points": points}, {"points": points[::-1]},
                   {"points": [[20, 0], [25, 0], [30, 0]]},
                   {"points": [[50, 50], [50, 50], [50, 50]]}]
        for point in [(7, 7), (2, 8), (4, 8), (25, 0), (25, 1), (50, 50), (50, 51)]:
            self.assert_matches(regions, [point])

    def test_no_detections(self):
        regions = [{"points": [[0, 0], [10, 0], [10, 10]]}]
        self.assert_matches(regions, [])
        engine = ROIOccupancy(regions, {0: "A"}, "cpu")
        self.assertEqual(engine.detect(None), [{"slot_code": "A", "status": "EMPTY", "confidence": None}])
        self.assertEqual(ROIOccupancy([], {}, "cpu").detect(None), [])

    def test_real_470_rois_random_points(self):
        regions = json.loads((Path(__file__).parents[1] / "datasets/sorted_bounding_boxes.json").read_text())
        rng = np.random.default_rng(42)
        # Check individual points; OR across all cars alone can hide a wrong hit.
        for point in rng.integers([-20, -20], [1940, 1100], size=(30, 2)):
            self.assert_matches(regions, [point.tolist()])
        self.assert_matches(regions, rng.integers(0, 1080, size=(300, 2)).tolist())

    def test_unmapped_rois_are_excluded(self):
        regions = [{"points": [[0, 0], [10, 0], [10, 10]]}] * 2
        engine = ROIOccupancy(regions, {1: "B"}, "cpu")
        self.assertEqual(engine.detect(torch.tensor([[1., 1., 1., 1.]])),
                         [{"slot_code": "B", "status": "OCCUPIED", "confidence": None}])

    def test_invalid_input_fails_clearly(self):
        with self.assertRaises(ValueError):
            ROIOccupancy([{"points": [[0, 0]]}], {0: "A"}, "cpu")
        with self.assertRaises(ValueError):
            ROIOccupancy([], {}, "cpu", chunk_size=0)
        engine = ROIOccupancy([{"points": [[0, 0], [10, 0], [10, 10]]}], {0: "A"}, "cpu")
        with self.assertRaises(ValueError):
            engine.occupied(torch.zeros(2, 3))


if __name__ == "__main__":
    unittest.main()
