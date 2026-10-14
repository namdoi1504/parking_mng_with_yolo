# Demo dùng giao diện production

Mở `http://127.0.0.1:5173/scenarios/map` khi chạy Vite dev. Trang đăng nhập
có nút **Trình diễn tình huống demo**. Route `/scenarios` tự mở bản đồ.

Demo dùng trực tiếp MapPage, MonitorPage, SessionsPage, StatisticsPage,
AppShell, ParkingMap, ReservationActions và SessionDetail của production.
Thanh điều khiển kịch bản ở đầu trang là phần thêm duy nhất. Các liên kết
Giám sát / Bản đồ / Phiên / Thống kê luôn ở trong `/scenarios/*`.

## Chạy

Từ thư mục dự án, dùng môi trường Python riêng:

```powershell
python -m pip install -r backend/requirements-lab.txt
python backend/run_scenario_lab.py
```

Môi trường đã cài trên máy này: `.venv-test/Scripts/python.exe`.
Terminal khác:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1
```

Lab chỉ bind `127.0.0.1:8002`; Vite proxy `/scenario-lab` tới lab. Không
mount lab trong app.main, không triển khai lab/proxy lên production.
Các route frontend lab bị loại khỏi build production.

## Dữ liệu và xử lý

Lab khởi tạo đầy đủ 470 ô với ROI, row, col và mã từ slots_config.json,
cho cùng sơ đồ và 13 khu như bãi vận hành. Ô 001 chạy kịch bản; ô còn lại
là dữ liệu nền minh họa (EMPTY / UNKNOWN), không phải kết quả nhận diện.

Frontend trong `/scenarios/*` chuyển tất cả apiResponse sang
`/scenario-lab/api/...`; không gửi Authorization hoặc cookie thật, không
fallback sang API production khi lab lỗi. Không mở socket production.
Các API demo dùng hợp đồng map, phiên, sự kiện, thao tác ô và báo cáo của
production trên SQLite trong bộ nhớ. Endpoint không hỗ trợ trả 404.

Các form production đặt/hủy/check-in/checkout gọi manual_action thật.
Kịch bản AI gọi reconcile và ObservationStabilizer thật. Quét hết hạn dùng
expire_reservations thật. API danh sách/chi tiết/sự kiện phiên và báo cáo
đọc cùng model/logic router trên session demo. Nhãn thời gian mô phỏng luôn
ở thanh điều khiển; không đổi đồng hồ máy hoặc thời gian bãi thật.

Launcher ép cấu hình database giả trước khi import, không dùng SessionLocal
để xử lý và không kết nối PostgreSQL. Thông tin khách/tài khoản đều giả.
Vai Administrator trong frontend là người điều phối lab, không phải đăng nhập
hoặc cấp quyền trên backend vận hành. Thoát demo không thu hồi/xóa token thật.

## Trình diễn

Chọn 1 trong 12 tình huống. Chạy từng bước hoặc tự động cách 2 giây; có tạm
 dừng và đặt lại. Sau mỗi bước, bản đồ tải snapshot mới và chọn lại ô 001.
Thông tin phiên tải bằng API demo với cùng component bảo vệ thông tin ở
production. Chuyển sang Phiên gửi xe để xem lịch sử, hoặc Thống kê để so sánh
khu/cột/hàng. Thao tác tay có thể thay đổi điều kiện kịch bản; đặt lại trước
khi chạy lại. Reset chỉ thay database demo trong RAM.

Giám sát dùng CameraStream và parser MJPEG production, nhận ảnh JPEG do lab
vẽ từ ROI và tín hiệu. Nguồn/alt/nhãn ghi rõ mô phỏng, không gọi YOLO hoặc
video bãi thật. Frame trên hình là occupancy; màu bản đồ là trạng thái nghiệp vụ.

Danh sách kịch bản: xe đến, ô giữ vẫn trống, không đến/hết hạn, đỗ trực tiếp,
hủy, rời/quay lại trong hạn, rời sau hạn, checkout hợp lệ, đặt trùng, checkout
khi xe còn, quan sát cũ và nhận diện chập chờn.

## Giới hạn

Đặt trùng là hai yêu cầu nối tiếp, không chứng minh concurrency PostgreSQL.
Quan sát cũ không phải mô phỏng lỗi mạng trình duyệt. Lab kiểm tra quy tắc
và UI; không chứng minh độ chính xác YOLO, đăng nhập/phân quyền hoặc WebSocket
production. Báo cáo lịch sử chỉ có mẫu thực sự tổng hợp từ thời điểm khởi tạo,
không dựng dữ liệu quá khứ. Nhóm cần dùng video để chứng minh phần nhận diện.

Một lượt lab dùng chung cho một người trình diễn. Lệnh có run_id/cursor để
chặn bước cũ hoặc chạy hai lần sau reset. Có thể tải lại trạng thái nếu tab
khác điều khiển cùng lượt.

Kiểm thử có đủ 12 kịch bản, API form/lịch sử với 470 ô, reset/stale command,
JPEG và bảo đảm không gửi token thật. Đã chạy trình duyệt: đặt chỗ → xe đến,
chi tiết phiên, danh sách phiên, MJPEG giám sát và thống kê production.
