# Đồng bộ backend/frontend — 14/10/2026

## Hợp đồng hiện tại: e05fdf5

Đã đối chiếu router đăng ký, schema/model, migration, dịch vụ ô/phiên, thống kê,
xác thực, streaming, frontend và luồng gửi quan sát AI. Hai commit trước
`91083b7` và `277fe22` thêm phiên gửi xe và quan sát ổn định; commit mới
`e05fdf5` thay phiên nhiều trạng thái bằng phiên tối giản.

`docs/CODEX-NAVIGATION-GUIDE.md` được yêu cầu trong hướng dẫn nhưng không có
trong checkout; dùng mã nguồn và Git để xác định phạm vi.

Phiên hiện chỉ có: `id`, `parking_slot_id`, `customer_name`, `phone_number`,
`license_plate`, `is_active`, `created_by`, `created_at`. Backend đã bỏ status,
giờ đặt chỗ/đến/rời/kết thúc/hủy, nguồn đến/rời và updated_at của phiên.
Frontend không suy diễn lại các thông tin này từ dữ liệu thiếu.

## Phương án đã triển khai

Giữ React/Vite, bố cục vận hành, polling bản đồ 5 giây và MJPEG riêng. Backend
quyết định vòng đời; frontend dùng snapshot đầy đủ và phản hồi thao tác để cập
nhật, tải lại khi xung đột. Giữ các sửa đổi frontend từ lần rà soát trước.

| Chức năng | Frontend theo backend mới |
| --- | --- |
| Giữ chỗ | Form tên khách, điện thoại, biển số; POST reserve; chỉ ô EMPTY có quan sát mới, không phiên/cờ đối soát |
| Đăng ký xe đang đỗ | POST check-in với đúng ba trường khách; bỏ nhập/gửi arrived_at |
| Phân loại phiên | Chỉ Đang hoạt động / Đã đóng từ is_active; không phân biệt hủy, hết hạn hay hoàn tất |
| Tra cứu | GET /parking-sessions với is_active=true/false hoặc bỏ bộ lọc để lấy tất cả; giữ bộ lọc biển số, điện thoại, ID ô, thời gian tạo và phân trang |
| Chi tiết | Thông tin khách, người tạo, thời gian tạo; hạn quay lại lấy từ ô đang gắn đúng phiên trong API map |
| Hủy / kết thúc | Phiên hoạt động, quan sát mới và ô RESERVED thuộc đúng phiên; backend kiểm tra lại occupancy EMPTY |
| Lịch sử | GET /parking-sessions/{id}/events vẫn giữ phân trang, thời gian và nguồn từng sự kiện đổi trạng thái ô |
| Quyền | Trang /sessions và thao tác dành cho Administrator theo yêu cầu router |
| Chưa nhận diện | status null hiển thị Chờ nhận diện; khác UNKNOWN là xe chưa đăng ký |
| Khả dụng | Chỉ EMPTY có observation_ready, không active_session_id/cờ đối soát; giữ summary server và ngữ cảnh bản đồ |
| Video | Số đếm EMPTY/OCCUPIED là quan sát vật lý; trạng thái nghiệp vụ được backend đối chiếu với phiên |
| Proxy | Có cả /parking-slots và /parking-sessions trong Vite |

Cả reserve và check-in tạo phiên is_active=true, với hạn quay lại ô 10 phút
kể từ created_at. Xe rời ô trước hạn làm ô RESERVED nhưng phiên vẫn hoạt động;
xe quay lại trong hạn được gắn với cùng phiên. Xe còn đỗ sau hạn vẫn giữ phiên.
Khi ô trống sau hạn, backend đóng phiên; xe mới đến không có phiên sẽ là UNKNOWN.
Frontend không tự đóng phiên khi đồng hồ chạm hạn.

Hủy giữ chỗ giờ được backend cho phép đối với ô RESERVED có phiên hoạt động,
kể cả phiên đã từng có xe. Check-out cũng chỉ cần phiên hoạt động và quan sát
EMPTY. Frontend không tiếp tục yêu cầu status RESERVED/PARKED của phiên cũ.

Thời gian bộ lọc nhập theo giờ địa phương, chuyển sang ISO có timezone. Cận
kết thúc không bao gồm. Biển số và điện thoại được tìm chính xác. Thời gian sự
kiện không được gán thành thời gian đến/rời/kết thúc phiên.

Các trang tài khoản/camera, vai trò/quyền và thống kê vẫn khớp router đang đăng
ký. Báo cáo là mẫu lấp đầy theo giờ Việt Nam (UTC+7), không phải lượt xe/doanh thu. Quản lý camera
không khởi động worker AI; gateway hiện phục vụ một preview AI.

Báo cáo giờ/ngày dùng `utc_offset_minutes=420` để lấy đúng ranh giới ngày và
khung giờ Việt Nam. Mẫu hoàn tất mỗi 15 phút; UI hiển thị thời điểm mẫu gần
nhất và tự tải lại báo cáo ngày hiện tại mỗi phút. `UNKNOWN` được tính là có
xe cùng `OCCUPIED`. Các mẫu lịch sử đã lưu theo cách đếm cũ được giữ nguyên.
Tác vụ đọc trạng thái trong transaction REPEATABLE READ rồi ghi mẫu trong
transaction READ COMMITTED riêng, tránh xung đột khóa ngoại với AI cập nhật
camera liên tục. Đã khôi phục mẫu bị bỏ lỡ kết thúc lúc 18:00 từ sự kiện;
mẫu kết thúc 18:15 được scheduler ghi thành công khi AI đang chạy.

Đã giữ sửa driver PostgreSQL thành postgresql+psycopg2:// để khớp dependency
psycopg2-binary khi SQLAlchemy 2.1 được cài; không sửa credentials.

## Triển khai và dữ liệu

Hai migration mới d9e43c1a6f32 và e0f54d2b7a43 xóa các cột lịch sử phiên và cờ
is_reservation. Dữ liệu trạng thái cũ được chuyển thành is_active; thời gian
đặt cũ được dùng làm created_at nếu có. Chi tiết bị xóa không thể khôi phục
chỉ bằng downgrade; migration từ chối downgrade khi bảng còn dữ liệu.

Sao lưu database trước khi nâng migration tới head. Sau migration, khởi động
lại backend và AI để có quan sát mới, rồi chạy frontend. Không chạy migration
trên database thật trong lần đồng bộ này.

## Hướng nâng cấp tiếp

1. Backend công bố can_check_in/can_check_out hoặc occupancy mới nhất để FE
   trình bày khả năng thao tác chính xác hơn, đặc biệt với ô legacy.
2. Đã nối WebSocket: tải lại snapshot khi kết nối/reconnect, nhận
   PARKING_SESSION_CHANGED (chứa is_active) hoặc SLOT_STATUS_CHANGED;
   thông báo đổi phiên tải lại API chi tiết/danh sách được bảo vệ,
   giữ polling snapshot 5 giây và phiên 15 giây dự phòng.
3. Nếu cần giờ đến/rời hoặc lý do đóng phiên, backend cần API/audit riêng.
   Không phục hồi các nhãn chi tiết bằng phỏng đoán từ is_active.
4. Nếu cần nhiều camera thật hoặc báo cáo doanh thu, bổ sung quản lý worker
   theo camera và API thống kê phiên/quy tắc tính phí.

## Kết quả kiểm tra

88 test frontend qua; TypeScript/Vite build thành công. Backend: 56 qua,
4 bỏ qua vì cần PostgreSQL cô lập. Browser smoke với phản hồi phiên tối giản
đã thử giữ chỗ có payload khách, hủy và trả xe; desktop/mobile không tràn ngang
hoặc lỗi JavaScript. Ảnh và kết quả trong artifacts/ không đưa vào Git.

Test dùng API giả lập và SQLite cô lập. Chưa xác minh migration trên PostgreSQL
hoặc một phiên YOLO thực với database thật.
