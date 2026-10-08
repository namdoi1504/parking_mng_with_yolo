# Đối chiếu frontend và backend

Phạm vi được đối chiếu với các router thực sự được đăng ký trong `backend/app/main.py`, không chỉ với các schema còn lưu trong mã nguồn.

## Phương án triển khai

Giữ các màn hình vận hành hiện có và bổ sung thao tác vào đúng ngữ cảnh: giữ chỗ trong chi tiết ô trên bản đồ, báo cáo ngày trong Thống kê, thao tác tài khoản/camera trong Quản lý và danh mục quyền trong Phân quyền. Không thêm thư viện giao diện hoặc thay đổi API backend.

| Chức năng | Giao diện | API backend |
| --- | --- | --- |
| Đăng nhập, xoay refresh token | `/login`, API client dùng chung | `POST /auth/login`, `POST /auth/refresh` |
| Đăng xuất, thu hồi các phiên của tài khoản | Nút đăng xuất trên thanh trên cùng | `POST /auth/logout` |
| Bản đồ, tổng hợp, ô chưa xác định | `/monitor`, `/map`, `/lookup`; lọc trạng thái bản đồ | `GET /api/ai/map` |
| Video và trạng thái agent | `/monitor` | Gateway `/ai-stream/video`, `/ai-stream/status` |
| Giữ chỗ | `/map` → chọn ô trống | `POST /parking-slots/{id}/reserve` |
| Hủy giữ chỗ, xác nhận xe đến | `/map` → chọn ô giữ chỗ | `POST /parking-slots/{id}/cancel-reservation`, `POST /parking-slots/{id}/confirm-arrival` |
| Danh sách, thêm/sửa tài khoản | `/management` → Tài khoản | `GET/POST /users/`, `PUT /users/{id}` |
| Khóa/mở khóa, xóa tài khoản | Thao tác trong bảng tài khoản | `PATCH /users/{id}/status`, `DELETE /users/{id}` |
| Danh sách, thêm/sửa camera | `/management` → Camera | `GET/POST /cameras/`, `PUT /cameras/{id}` |
| Đánh dấu trạng thái, xóa camera | Thao tác trong bảng camera | `PATCH /cameras/{id}/status`, `DELETE /cameras/{id}` |
| Thêm/sửa/xóa vai trò | `/access` | `GET/POST /roles/`, `PUT/DELETE /roles/{id}` |
| Gán/gỡ quyền của vai trò | Ma trận quyền trên `/access` | `POST /roles/{id}/permissions`, `DELETE /roles/{id}/permissions/{permission_id}` |
| Tạo/sửa permission | Danh mục quyền trên `/access` | `GET/POST /permissions/`, `PUT /permissions/{id}` |
| Thống kê giờ, ngày, theo camera, CSV | `/statistics` → Theo giờ / Theo ngày | `GET /api/stats/hourly?date=...`, `GET /api/stats/daily?from=...&to=...`; tùy chọn `camera_id` |

Các endpoint tổng hợp `/api/ai/summary`, `/api/stats/realtime` và `/api/ai/unknown-slots` cung cấp thông tin đã có trong bản đồ; frontend dùng snapshot bản đồ để hiển thị tổng hợp và lọc ô chưa xác định.

## Quy tắc xử lý

- Giữ chỗ yêu cầu tên vai trò chính xác `Administrator`; quyền `parking:manage` riêng lẻ không đáp ứng điều kiện của backend. Giữ chỗ chỉ chuyển `EMPTY → RESERVED`; hủy chuyển `RESERVED → EMPTY`; xác nhận chuyển `RESERVED → OCCUPIED`.
- Thao tác giữ chỗ chỉ cập nhật màn hình sau phản hồi thành công. Snapshot bắt đầu trước khi thao tác thành công không được ghi đè phản hồi mới. Nếu backend trả lỗi, giữ nguyên dữ liệu và yêu cầu tải lại bản đồ.
- Camera có ô đỗ hoặc thống kê, và vai trò đang được gán cho tài khoản, không xóa được. Giao diện giữ bản ghi và hiển thị lỗi backend khi bị từ chối.
- Khi sửa tài khoản, chỉ gửi `role_id` và `status` nếu chúng thực sự đổi; để trống mật khẩu thì không gửi trường này. Điều này tránh thu hồi phiên khi chỉ sửa tên hoặc username. Tự khóa/xóa tài khoản hoặc tự đổi mật khẩu/vai trò sẽ chuyển về đăng nhập sau thành công.
- Đăng xuất gọi backend để thu hồi phiên trước khi xóa token cục bộ. Nếu access token hết hạn, API client thử xoay token rồi gọi lại. Nếu backend lỗi, giao diện cho thử lại hoặc chủ động chỉ xóa đăng nhập trên thiết bị; thao tác cục bộ không được báo là đã thu hồi phiên ở server.
- Báo cáo dùng ngày UTC theo hợp đồng backend, chấp nhận tối đa 366 ngày, giữ dấu `—` cho khoảng không có mẫu. Request cũ bị hủy/bỏ qua khi đổi bộ lọc; CSV chỉ xuất dữ liệu của bộ lọc hiện tại.
- Quyền quản trị theo JWT điều khiển giao diện; backend vẫn kiểm tra quyền hiện tại từ database. Khi quyền bị đổi ở phiên khác, backend có thể từ chối thao tác dù nút còn hiện cho đến khi token được làm mới.
- Chế độ demo không gửi các thao tác ghi dữ liệu mới tới backend.

## Giới hạn hiện tại

- Chưa có router đọc lịch sử `ParkingEvent`; bảng thay đổi của Giám sát vẫn là thay đổi quan sát giữa các snapshot trong phiên.
- Chưa có endpoint quản trị CRUD ô đỗ hoặc sửa ROI được đăng ký. `/api/ai/sync-slots` và `/api/ai/parking-status` là đầu vào của agent AI, không dùng làm form quản trị cho người dùng.
- Backend không có API xóa permission. Danh mục quyền chỉ cho tạo và sửa.
- Tạo permission mới không tự tạo nghiệp vụ mới; mã permission phải khớp với quyền backend kiểm tra.
- WebSocket đã có ở backend nhưng frontend tiếp tục polling 5 giây theo thiết kế hiện tại; video MJPEG vẫn chạy riêng.
- Chưa chạy thao tác ghi trên database thực tế trong đợt triển khai này. Kiểm thử frontend dùng API mock, kiểm tra giao diện dùng dữ liệu demo.

## Kiểm chứng

Từ `frontend/`, chạy `pnpm test` và `pnpm build`. Bộ kiểm thử mới bao phủ phân quyền giữ chỗ, ba transition, lỗi trạng thái cạnh tranh, snapshot trả chậm, báo cáo ngày/camera, khoảng ngày không hợp lệ, thao tác quản trị, xung đột xóa, cập nhật ma trận quyền và đăng xuất/refresh token. Không cần thông tin đăng nhập thật để chạy các kiểm thử này.

Kết quả kiểm chứng: 63 kiểm thử đạt, TypeScript/Vite build thành công. Đã kiểm tra bản đồ và báo cáo trên desktop, báo cáo, quản trị và form permission trên viewport mobile 390 px. `pnpm audit` báo 1 advisory mức high cho `source-map-js` gián tiếp từ PostCSS/Vite trong lockfile hiện có (`GHSA-68fv-2mgg-jv7q`); đợt này không thay đổi dependency hoặc lockfile.
