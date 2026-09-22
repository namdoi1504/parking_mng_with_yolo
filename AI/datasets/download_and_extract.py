# import yt_dlp
#
# def dowload_high_quality_youtube(video_url, output_name='video_bai_do_xe.mp4'):
#     print("dang connect")
#
#     ydl_opts = {
#         'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
#         'outtmpl': output_name,
#         'quiet': False
#     }
#     try:
#         with yt_dlp.YoutubeDL(ydl_opts) as ydl:
#             ydl.download([video_url])
#         print(f" Đã tải xong! File video chất lượng cao lưu tại: {output_name}")
#     except Exception as e:
#         print(f"Có lỗi xảy ra trong quá trình tải: {e}")
#
# if __name__ == "__main__":
#     LINK_YOUTUBE  = "https://youtu.be/Pv8N1PamwPQ?si=5TbM0EHQ7YBW6vll"
#     dowload_high_quality_youtube(LINK_YOUTUBE)



import cv2
def extract_first_frame(video_path, output_image_path='image-000001.jpg'):
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        print("khong mo file duoc")
        return
    ret, frame = cap.read()
    if ret:
        cv2.imwrite(output_image_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 100])
        print(f"succe: {output_image_path}")
    else:
        print("false.")
    cap.release()


if __name__ == "__main__":
    FILE_VIDEO = 'car.mp4'
    extract_first_frame(FILE_VIDEO)