import cv2
import os

video_path = 'parking_car.mp4'
output_dir = 'images_frame'
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