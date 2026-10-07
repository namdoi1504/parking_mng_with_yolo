# ImperiaSmart Parking UI

## Giao diện đăng nhập

Trang `/login` dùng hướng thiết kế đã duyệt: cảnh bãi xe sáng, form trắng, nút xanh và nội dung “Quản lý bãi đỗ xe / Xem camera và trạng thái ô đỗ.” Bố cục chuyển thành ảnh phía trên và form gối lên ảnh ở điện thoại. Styles riêng trong `src/pages/LoginPage.css` chỉ áp dụng cho trang đăng nhập.

Ảnh ý tưởng được tạo bằng built-in image_gen và lưu tại `public/images/parking-login-entrance.png`; đây không phải ảnh bãi xe thực tế. Prompt: [IMAGE-PROMPT-V2.md](../docs/uiux-preview/IMAGE-PROMPT-V2.md). Trang chính dùng xác thực thật, ghi nhớ phiên, hiện/ẩn mật khẩu, lỗi API và tra cứu công khai như trước. Hỗ trợ mật khẩu hướng dẫn liên hệ quản trị viên.

## Giao diện vận hành

Các trang giám sát, bản đồ, tra cứu, thống kê, quản lý và phân quyền dùng cùng phong cách đã duyệt: nền xanh nhạt, thanh điều hướng trắng, chữ và biểu tượng nhất quán, nút chính xanh, bảng và form trên nền trắng. `src/workspace.css` chứa styles chung, nạp sau `src/styles.css`; menu chia thành Vận hành, Báo cáo và Quản trị. Đầu trang vận hành chỉ có tiêu đề, mô tả và thao tác; ảnh trang trí chỉ dùng ở đăng nhập.

Tra cứu công khai có header riêng và nút **Tìm ô trống** để chọn ô trống đầu tiên trong kết quả hiện tại, chuyển về bản đồ và xem chi tiết. Nút không giữ chỗ hoặc tính khoảng cách. Thiết kế và kiểm tra responsive: [UIUX-V2-DIRECTION.md](../docs/UIUX-V2-DIRECTION.md).

## Chạy cùng backend

```powershell
pnpm install
pnpm dev
```

Vite chuyển tiếp các đường dẫn `/auth`, `/users`, `/roles`, `/permissions`, `/cameras`, `/api` và `/ws` tới backend tại `http://127.0.0.1:8000`, vì vậy backend không cần thay đổi CORS.

## Chế độ xem mẫu

```powershell
$env:VITE_DEMO_MODE='true'
pnpm dev
```

Chế độ này chỉ dùng dữ liệu mẫu để duyệt giao diện. Để tích hợp thật, bỏ biến trên và chạy backend trước frontend.

Có thể đặt các biến sau trong `frontend/.env` cục bộ hoặc môi trường terminal, rồi khởi động lại Vite:

| Biến | Ý nghĩa |
| --- | --- |
| `VITE_DEMO_MODE` | Đặt `true` để xem dữ liệu mẫu |
| `VITE_API_BASE_URL` | URL gốc của backend; mặc định rỗng để dùng proxy cùng origin |

Các biến `VITE_*` được đưa vào frontend, vì vậy không chứa mật khẩu hoặc secret. Video và trạng thái luồng dùng chung `VITE_API_BASE_URL` qua gateway `/ai-stream` của Backend; không cần tunnel riêng cho cổng 8001. Hướng dẫn chạy backend và agent: [README gốc](../README.md) và [AI/STREAMING.md](../AI/STREAMING.md).

Khi `VITE_API_BASE_URL` trỏ đến ngrok, FE tự thêm header `ngrok-skip-browser-warning` cho các request API và làm mới token để bỏ qua trang cảnh báo của tunnel. Backend cần cho phép header này trong CORS và cho phép origin của FE. Sau khi cập nhật mã hoặc URL API, deploy lại FE trên Vercel.

## Video trên Vercel qua ngrok

1. Chạy Backend cổng 8000 và `python -u AI/datasets/parking_agent.py --stream --no-window` từ thư mục gốc dự án.
2. Chạy `ngrok http 8000`; giữ dịch vụ AI cổng 8001 trên loopback.
3. Đặt `VITE_API_BASE_URL` trên Vercel thành URL HTTPS của tunnel, không kèm đường dẫn.
4. Thêm origin Vercel vào `CORS_ORIGINS` của `backend/.env`, khởi động lại Backend và deploy lại FE.
5. Đăng nhập tài khoản có quyền `parking:view`, mở `/monitor`.

FE đọc MJPEG bằng `fetch` có Bearer token và header ngrok, sau đó hiển thị JPEG bằng URL blob. Kết nối được mở lại sau mỗi 60 giây để Backend kiểm tra quyền; FE nối lại khi lỗi và ngắt nếu không nhận khung hình trong 10 giây. Đóng trang sẽ hủy request và giải phóng URL blob. Không đưa token vào URL video. Gateway không thay đổi xử lý YOLO hoặc chu kỳ cập nhật trạng thái ô đỗ.

Ảnh video cập nhật qua `ref` thay vì React state mỗi khung; component video dùng `memo` để không render lại theo polling của trang.

## Màn hình và giới hạn

- `/monitor`: video AI, tốc độ video/AI riêng, thay đổi quan sát giữa các lần polling và bản đồ theo camera.
- `/map`: tìm mã, lọc trạng thái, phóng to và chọn ô xem chi tiết. Administrator có thể giữ ô trống, hủy giữ chỗ hoặc xác nhận xe đến. `/configuration` chuyển về `/map` để giữ liên kết cũ.
- `/lookup`: tra cứu công khai dạng bản đồ hoặc danh sách ô trống. Dữ liệu tải lại mỗi 5 giây; không giữ chỗ.
- `/management`: phân trang tài khoản/camera, lọc trạng thái, tìm trong trang hiện tại; thêm/sửa, cập nhật trạng thái và xóa theo quyền `user:manage` và `camera:manage`. Backend từ chối xóa camera đang có ô đỗ hoặc thống kê.
- `/access`: tạo/sửa/xóa vai trò, gán/gỡ quyền và tạo/sửa danh mục permission; backend kiểm tra quyền `role:manage` và từ chối xóa vai trò đang có tài khoản.
- `/statistics`: báo cáo theo giờ/ngày UTC, lọc theo camera và xuất CSV của bộ lọc hiện tại; tối đa 366 ngày cho báo cáo ngày, không suy diễn số lượt xe từ mẫu nhận diện.

Bản đồ giữ vị trí từ tọa độ đã lưu nhưng không cho sửa hình học hoặc xuất cấu hình ROI. Camera được lưu cấu hình không tự khởi động AI.
Camera 1 với bộ 470 ô của `parking_car.mp4` có sơ đồ đường đi tham khảo: cổng trên bên phải đi vào hướng trái, cổng dưới bên phải đi ra hướng phải theo ảnh đánh dấu. Chọn ô trống để hiện đường vào; đổi hướng để xem đường ra từ ô bất kỳ. Đường xe, dải phân cách, đảo cây và đường bộ hành được đối chiếu với khung hình gốc 1920×1080. Routing chỉ chạy trong hành lang quanh các tim lối xe được vẽ trên sơ đồ, đồng thời tránh polygon ô đỗ và cây xanh; không coi toàn bộ khoảng trống là đường, không dùng khe hẹp ngoài dãy cuối cùng. Ô không có đường tiếp cận trong phạm vi ảnh hiển thị thông báo thay vì tuyến giả. Nút “Đối chiếu ảnh gốc” bật ảnh tĩnh tham chiếu phía dưới các ô, không phải camera/video trực tiếp. Các làn nội bộ tạm giả định hai chiều, chưa có khảo sát, GPS, khoảng cách hay ETA thực tế. Layout chỉ áp dụng khi các điểm neo trùng khớp; camera khác giữ bản đồ ô thông thường. Tính năng chỉ ở frontend, không thay đổi backend/API.
Màu trạng thái: xanh lá trống, xanh dương đã đỗ, vàng giữ chỗ, đỏ chưa xác định.
Nếu backend lỗi, dữ liệu lần tải trước được giữ cùng cảnh báo; không tự dùng dữ liệu mẫu.
Chế độ demo luôn có nhãn minh họa. Form tạo/sửa tài khoản, camera và vai trò không ghi dữ liệu thật trong chế độ này.
Tests gọi API bằng mock, không tạo tài khoản hay thay quyền thật.

## Chế độ cập nhật trạng thái hiện tại

Frontend không mở WebSocket trạng thái, kể cả khi đã đăng nhập. Giám sát, bản đồ và tra cứu gọi `GET /api/ai/map` mỗi 5 giây; không gọi chồng khi request trước chưa kết thúc. Request quá hạn 10 giây hiển thị lỗi, giữ dữ liệu cũ và tự thử lại. Video MJPEG vẫn chạy riêng, không bị chuyển sang polling ảnh.

Nhãn giao diện ghi rõ chu kỳ tải, không coi polling là kết nối trực tiếp. Bảng thay đổi so sánh trạng thái hai snapshot liên tiếp trong phiên hiện tại; thời gian là lúc frontend quan sát, không phải thời điểm phát sinh sự kiện. Không ghi biến động lúc tải lần đầu, có thể bỏ lỡ thay đổi qua lại giữa hai lần tải và không phải lịch sử đầy đủ. Backend vẫn cung cấp WebSocket cho client khác; frontend không dùng `VITE_WS_URL` và đã bỏ helper tạo URL socket không còn được gọi.

```powershell
pnpm test
pnpm build
```

## Đồng bộ chức năng backend

Nút đăng xuất gọi `POST /auth/logout` để thu hồi phiên ở backend trước khi xóa token. Thao tác giữ chỗ dùng các endpoint `/parking-slots/{id}/...`; proxy Vite đã có tiền tố `/parking-slots`. Giao diện cập nhật ô và tổng hợp sau phản hồi thành công, tải lại trạng thái nếu backend từ chối do ô đã đổi trạng thái.

Đối chiếu API, quyền và các chức năng backend chưa hỗ trợ: [FRONTEND-BACKEND-COVERAGE.md](../docs/FRONTEND-BACKEND-COVERAGE.md).
