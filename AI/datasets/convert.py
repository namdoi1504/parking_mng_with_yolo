import json

data = json.load(open("input.json"))

def convert_to_points(pred):
    x, y, w, h = pred["x"], pred["y"], pred["width"], pred["height"]
    hw, hh = w / 2, h / 2
    return {
        "points": [
            [x - hw, y - hh],  # top-left
            [x - hw, y + hh],  # bottom-left
            [x + hw, y + hh],  # bottom-right
            [x + hw, y - hh],  # top-right
        ]
    }

result = [convert_to_points(p) for p in data["predictions"]]

json.dump({"predictions": result}, open("output.json", "w"), indent=2)
print("Done, total:", len(result))