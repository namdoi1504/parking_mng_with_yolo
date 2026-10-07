# Parking Management with YOLO

Hệ thống quản lý bãi đỗ xe gồm backend FastAPI/PostgreSQL, frontend React/TypeScript và agent YOLO nhận diện trạng thái ô đỗ từ video. Agent gửi trạng thái về backend và cung cấp video MJPEG có lớp phủ ô đỗ để xem trên giao diện.

## Thành phần

| Thư mục | Chức năng |
| --- | --- |
| `backend/` | API đăng nhập, tài khoản, vai trò, camera, ô đỗ và thống kê; migration Alembic |
| `frontend/` | Giao diện giám sát, bản đồ, tra cứu, quản trị và báo cáo bằng React/Vite |
| `AI/datasets/` | Agent YOLO, cấu hình ROI, kiểm tra occupancy và dịch vụ preview |
| `AI/tests/` | Kiểm thử pipeline video, ROI và MJPEG |

## Chuẩn bị

- Python và môi trường ảo tương thích với các phiên bản trong file requirements; backend dùng Python 3.11 trở lên.
- PostgreSQL đang chạy và database đã được tạo.
- Node.js tương thích với Vite và pnpm.
- FFmpeg nếu cần tạo video chậm cho bản demo.
- GPU CUDA là tùy chọn; agent tự dùng CPU nếu CUDA không khả dụng. Hiệu năng phụ thuộc thiết bị.

Các lệnh bên dưới dùng PowerShell, bắt đầu từ thư mục gốc repo. Mỗi dịch vụ chạy trong một terminal riêng.

## 1. Khởi động backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
Set-Location backend
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Chỉ sao chép `.env.example` ở lần thiết lập đầu tiên để tránh ghi đè cấu hình hiện có. Sửa `backend/.env` với thông tin PostgreSQL của bạn: `DATABASE_HOSTNAME`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME` và `DATABASE_PASSWORD`.

Tạo giá trị riêng cho `SECRET_KEY`, tối thiểu 32 ký tự:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Sau khi lưu cấu hình database và secret:

```powershell
python -m alembic upgrade head
python -m app.seed --admin-username admin
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Lệnh seed hỏi mật khẩu và xác nhận để tạo tài khoản quản trị. Chạy một lần cho username mới; tài khoản đã tồn tại sẽ không bị ghi đè. Tài liệu API: <http://127.0.0.1:8000/docs>.

## 2. Khởi động frontend

Trong terminal mới, từ thư mục gốc:

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm dev
```

Mở <http://localhost:5173> và đăng nhập bằng tài khoản vừa tạo. Vite chuyển tiếp API sang backend ở `127.0.0.1:8000` và `/ai-stream` sang agent ở `127.0.0.1:8001`.

| Đường dẫn | Chức năng |
| --- | --- |
| `/monitor` | Video AI, trạng thái kết nối, tốc độ xử lý và bản đồ theo camera |
| `/map` | Bản đồ, tuyến tham khảo; Administrator giữ/hủy chỗ và xác nhận xe đến |
| `/lookup` | Tra cứu công khai ô đỗ; không giữ chỗ |
| `/management` | Thêm/sửa/xóa, cập nhật trạng thái tài khoản và camera theo quyền |
| `/access` | Tạo/sửa/xóa vai trò, gán/gỡ quyền và tạo/sửa permission |
| `/statistics` | Báo cáo giờ/ngày, bộ lọc camera và xuất CSV |

Giám sát, bản đồ và tra cứu tải trạng thái qua `GET /api/ai/map` mỗi 5 giây. Frontend hiện không mở WebSocket trạng thái. Video MJPEG chạy riêng; bảng thay đổi chỉ so sánh các snapshot trong phiên, có thể bỏ lỡ thay đổi giữa hai lần tải và không phải lịch sử đầy đủ.

Để xem giao diện bằng dữ liệu mẫu:

```powershell
$env:VITE_DEMO_MODE='true'
pnpm dev
```

Chế độ demo có nhãn minh họa và không ghi dữ liệu thật từ form quản trị. Khi quay lại backend thật, xóa biến và khởi động lại Vite:

```powershell
Remove-Item Env:VITE_DEMO_MODE -ErrorAction SilentlyContinue
pnpm dev
```

Chi tiết màn hình, cấu hình và giới hạn bản đồ: [frontend/README.md](frontend/README.md).

## 3. Khởi động agent AI và video preview

Trong terminal mới, từ thư mục gốc:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Agent dùng model `AI/datasets/cars_best.pt` cùng `slots_config.json` và `sorted_bounding_boxes.json`. Video không được đưa lên Git; đặt video nguồn `parking_car.mp4` vào `AI/datasets/` trên máy của bạn.

Mặc định agent đọc `parking_car_slow_05x.mp4`. Tạo bản chạy chậm một nửa từ video nguồn:

```powershell
ffmpeg -n -i AI/datasets/parking_car.mp4 -vf "setpts=2*PTS" -af "atempo=0.5" -c:v libx264 -preset fast -crf 20 -r 30000/1001 -c:a aac -b:a 128k -movflags +faststart AI/datasets/parking_car_slow_05x.mp4
python -u AI/datasets/parking_agent.py --stream --no-window
```

Nếu dùng video khác, cập nhật `VIDEO_SOURCE` trong `AI/datasets/parking_agent.py`. Agent hiện đồng bộ và gửi trạng thái cho camera ID 1 mỗi 3 giây; tạo camera trong giao diện không tự khởi động agent.

Xem video ở `/monitor`, hoặc mở preview độc lập tại <http://127.0.0.1:8001/>. `/video` cung cấp MJPEG, `/status` cung cấp thông tin xử lý và `/frame.jpg` cung cấp ảnh chụp. Dừng agent bằng Ctrl+C.

Decoder, YOLO và renderer chạy độc lập, giữ kết quả mới nhất và bỏ frame cũ khi xử lý không kịp. FPS video và FPS AI được hiển thị riêng. Màu ô: xanh lá là trống, xanh dương là đã đỗ, vàng là giữ chỗ, đỏ là chưa xác định. Video vẫn có thể phát khi gửi trạng thái về backend thất bại; kiểm tra `sync_ok` trong `/status`.

Preview chỉ phục vụ phát triển/demo cục bộ và bind loopback. Khi triển khai, cần proxy cùng origin và gateway xác thực cho video; bản build frontend không kèm proxy của Vite. Chi tiết pipeline và benchmark: [AI/STREAMING.md](AI/STREAMING.md).

## Kiểm tra

Chạy kiểm thử AI từ thư mục gốc sau khi cài dependency AI:

```powershell
python -m unittest discover -s AI/tests -v
```

Kiểm thử backend từ `backend/` sau khi cài `requirements-dev.txt`:

```powershell
python -m pytest
```

Kiểm thử, build và audit frontend từ `frontend/`:

```powershell
pnpm test
pnpm build
pnpm audit
```

`pnpm build` tạo sản phẩm trong `frontend/dist/`. Test frontend dùng API mock. Benchmark AI cần video/model cục bộ; xem hướng dẫn trong `AI/STREAMING.md`.

## File cục bộ

Video, `.env`, môi trường ảo, `node_modules` và cache không cần commit. `.gitignore` loại các file môi trường thực tế và cho phép template `.env.example`; không đưa mật khẩu hoặc secret thật vào template.
