import cv2
import os

video_path = 'video1.mp4'
output_dir = 'images_frame'
os.makedirs(output_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps

timestamps = [0, duration*0.25, duration*0.5, duration*0.75, duration*0.95]

for i, t in enumerate(timestamps):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ret, frame = cap.read()
    if ret:
        filename = f"{output_dir}/stage{i+1}_t{int(t)}s.jpg"
        cv2.imwrite(filename, frame)
        print(f"Đã lưu {filename}")

cap.release()