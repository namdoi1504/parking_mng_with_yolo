# ImperiaSmart Parking UI

## Trình diễn tình huống

Trong Vite dev, mở `/scenarios/map` hoặc nút **Trình diễn tình huống demo** trên
trang đăng nhập. Demo dùng trực tiếp các trang production (Giám sát, Bản đồ,
Phiên gửi xe, Thống kê), sơ đồ 470 ô và 12 kịch bản trên dữ liệu riêng.
Cài `backend/requirements-lab.txt`, chạy `python backend/run_scenario_lab.py`
từ thư mục dự án. Thanh điều khiển kịch bản là phần thêm riêng cho demo.
Xem [hướng dẫn và phạm vi kiểm chứng](../docs/frontend/scenario-lab.md).
Lab chỉ ở localhost:8002, không gắn vào backend vận hành hoặc build production.

## Giao diện đăng nhập

Trang `/login` dùng hướng thiết kế đã duyệt: cảnh bãi xe sáng, form trắng, nút xanh và nội dung “Quản lý bãi đỗ xe / Xem camera và trạng thái ô đỗ.” Bố cục chuyển thành ảnh phía trên và form gối lên ảnh ở điện thoại. Styles riêng trong `src/pages/LoginPage.css` chỉ áp dụng cho trang đăng nhập.

Ảnh ý tưởng được tạo bằng built-in image_gen và lưu tại `public/images/parking-login-entrance.png`; đây không phải ảnh bãi xe thực tế. Prompt: [Ảnh đăng nhập](../docs/design/login-image.md). Trang chính dùng xác thực thật, ghi nhớ phiên, hiện/ẩn mật khẩu, lỗi API và tra cứu công khai như trước. Hỗ trợ mật khẩu hướng dẫn liên hệ quản trị viên.

## Giao diện vận hành

Các trang giám sát, bản đồ, tra cứu, thống kê, quản lý và phân quyền dùng cùng phong cách đã duyệt: nền xanh nhạt, thanh điều hướng trắng, chữ và biểu tượng nhất quán, nút chính xanh, bảng và form trên nền trắng. `src/workspace.css` chứa styles chung, nạp sau `src/styles.css`; menu chia thành Vận hành, Báo cáo và Quản trị. Đầu trang vận hành chỉ có tiêu đề, mô tả và thao tác; ảnh trang trí chỉ dùng ở đăng nhập.

Tra cứu công khai có header riêng và nút **Tìm ô trống** để chọn ô trống đầu tiên trong kết quả hiện tại, chuyển về bản đồ và xem chi tiết. Nút không giữ chỗ hoặc tính khoảng cách. Quy ước giao diện: [Thiết kế frontend](../docs/design/interface.md).

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

- `/monitor`: video AI, tốc độ video/AI riêng, tổng hợp trạng thái theo camera và thay đổi quan sát giữa các lần polling. Bản đồ, chọn khu và chi tiết ô tập trung tại `/map`; giám sát có liên kết mở bản đồ.
- `/map`: tìm mã, lọc trạng thái, phóng to và chọn ô xem chi tiết. Administrator nhập tên khách, điện thoại, biển số để giữ ô đủ điều kiện trong 10 phút hoặc đăng ký xe chưa có phiên. AI tự ghi nhận xe đến; chi tiết phiên hỗ trợ hủy giữ chỗ và kết thúc phiên sau khi camera xác nhận xe rời ô. `/configuration` chuyển về `/map` để giữ liên kết cũ.
- `/sessions`: Administrator tra cứu phiên theo trạng thái hoạt động, biển số, điện thoại, ID ô và thời gian tạo; trạng thái Đang hoạt động/Đã đóng; xem thông tin khách, sự kiện phân trang và kết thúc phiên hợp lệ.
- `/map` tích hợp tìm ô trống nhanh và danh sách ô trống theo camera/khu; thao tác tìm chỉ chọn ô, giữ chỗ vẫn là thao tác riêng trong chi tiết ô. Menu nội bộ không còn mục Tra cứu trùng với bản đồ.
- `/lookup`: tra cứu công khai dạng bản đồ hoặc danh sách ô trống cho khách chưa đăng nhập. Dữ liệu tải lại mỗi 5 giây; không giữ chỗ. Khi đã đăng nhập (hoặc xem demo), đường dẫn này chuyển về `/map`.
- `/management`: phân trang tài khoản/camera, lọc trạng thái, tìm trong trang hiện tại; thêm/sửa, cập nhật trạng thái và xóa theo quyền `user:manage` và `camera:manage`. Backend từ chối xóa camera đang có ô đỗ hoặc thống kê.
- `/access`: tạo/sửa/xóa vai trò, gán/gỡ quyền và tạo/sửa danh mục permission; backend kiểm tra quyền `role:manage` và từ chối xóa vai trò đang có tài khoản.
- `/statistics`: báo cáo theo giờ/ngày Việt Nam (UTC+7), lọc theo camera và xuất CSV của bộ lọc hiện tại; tối đa 366 ngày cho báo cáo ngày, không suy diễn số lượt xe từ mẫu nhận diện. Mẫu được tổng hợp mỗi 15 phút, có thời điểm mẫu gần nhất; khoảng chưa có mẫu hiện dấu “—”, khác với 0%. Báo cáo chứa ngày hiện tại tự tải lại mỗi phút. Số ô có xe gồm cả `OCCUPIED` và `UNKNOWN`; dữ liệu lịch sử đã lưu theo cách đếm cũ không tự tính lại. Frontend gửi `utc_offset_minutes=420`; API vẫn mặc định UTC cho client cũ.

Bản đồ giữ vị trí từ tọa độ đã lưu nhưng không cho sửa hình học hoặc xuất cấu hình ROI. Camera được lưu cấu hình không tự khởi động AI.
Thu phóng bản đồ 100–600% bằng con lăn chuột tại vị trí con trỏ hoặc nút +/−; kéo để di chuyển khi phóng to. Trên điện thoại dùng nút và vuốt. Khi focus vùng bản đồ, +/− thu phóng và 0 về toàn cảnh. Vùng hiển thị giữ kích thước cố định khi zoom, thao tác kéo không chọn nhầm ô.
Sơ đồ hiệu chỉnh có lớp **Hiển thị lối đi bên trái**: mở rộng 120 đơn vị ảnh sang trái, thêm lối dọc nối đường ngang trên/dưới để dãy 001–009 có tuyến tiếp cận. Lối đi dùng cùng nền đường và nét đứt trắng với các đường còn lại. Đây là phần bố trí sơ đồ ngoài phạm vi camera; không đổi ROI hoặc tọa độ backend. Lớp có thể tắt và tự ẩn khi đối chiếu ảnh gốc. Routing gốc vẫn giữ phạm vi ảnh ban đầu.
Camera 1 với bộ 470 ô của `parking_car.mp4` có sơ đồ đường đi tham khảo: cổng trên bên phải đi vào hướng trái, cổng dưới bên phải đi ra hướng phải theo ảnh đánh dấu. Chọn ô trống để hiện đường vào; đổi hướng để xem đường ra từ ô bất kỳ. Đường xe, dải phân cách, đảo cây và đường bộ hành được đối chiếu với khung hình gốc 1920×1080. Routing chỉ chạy trong hành lang quanh các tim lối xe được vẽ trên sơ đồ, đồng thời tránh polygon ô đỗ và cây xanh; không coi toàn bộ khoảng trống là đường, không dùng khe hẹp ngoài dãy cuối cùng. Ô không có đường tiếp cận trong phạm vi ảnh hiển thị thông báo thay vì tuyến giả. Nút “Đối chiếu ảnh gốc” bật ảnh tĩnh tham chiếu phía dưới các ô, không phải camera/video trực tiếp. Các làn nội bộ tạm giả định hai chiều, chưa có khảo sát, GPS, khoảng cách hay ETA thực tế. Layout chỉ áp dụng khi các điểm neo trùng khớp; camera khác giữ bản đồ ô thông thường. Tính năng chỉ ở frontend, không thay đổi backend/API.
Màu trạng thái: xanh lá trống, xanh dương đã đỗ, vàng giữ chỗ, đỏ chưa xác định.
Nếu backend lỗi, dữ liệu lần tải trước được giữ cùng cảnh báo; không tự dùng dữ liệu mẫu.
Chế độ demo luôn có nhãn minh họa. Form tạo/sửa tài khoản, camera và vai trò không ghi dữ liệu thật trong chế độ này.
Tests gọi API bằng mock, không tạo tài khoản hay thay quyền thật.

## Chế độ cập nhật trạng thái hiện tại

Frontend đã đăng nhập và có `parking:view` mở WebSocket `/ws/parking`, xác thực bằng subprotocol `parking` và `bearer.<access_token>`; token không nằm trong URL. Khi kết nối/reconnect hoặc nhận `SLOT_STATUS_CHANGED` / `PARKING_SESSION_CHANGED`, frontend gộp thông báo và tải snapshot mới. Thông báo đổi phiên yêu cầu tải lại danh sách/chi tiết bằng API được bảo vệ. Mất kết nối tự thử lại với backoff 1–30 giây; mã 1008 dừng retry quyền truy cập. Khách công khai và demo không mở socket.

Snapshot vẫn tải mỗi 5 giây làm dự phòng, không gọi chồng; timeout 10 giây giữ dữ liệu cũ và cảnh báo. Danh sách/chi tiết phiên tải dự phòng mỗi 15 giây. Nhãn kết nối phân biệt WebSocket với polling. Bảng thay đổi giám sát so sánh snapshot trong phiên hiện tại; thời gian là lúc frontend quan sát, không phải lịch sử đầy đủ. Video MJPEG chạy riêng. Chi tiết phiên có Xác nhận xe đến, Hủy giữ chỗ và Checkout; backend kiểm tra quan sát AI và từ chối 409 nếu trạng thái không hợp lệ, frontend tải lại trạng thái/chi tiết sau thao tác. API chưa cung cấp mốc đặt/vào/ra/hủy và lý do đóng phiên riêng; UI ghi rõ giới hạn này.

```powershell
pnpm test
pnpm build
```

## Đồng bộ chức năng backend

Nút đăng xuất gọi `POST /auth/logout` để thu hồi phiên ở backend trước khi xóa token. Thao tác giữ chỗ dùng các endpoint `/parking-slots/{id}/...`; proxy Vite đã có tiền tố `/parking-slots`. Giao diện cập nhật ô và tổng hợp sau phản hồi thành công, tải lại trạng thái nếu backend từ chối do ô đã đổi trạng thái.

Đối chiếu API, quyền và các chức năng backend chưa hỗ trợ: [Đối chiếu frontend/backend](../docs/frontend/backend-coverage.md).

## Đồng bộ phiên gửi xe (14/10/2026)

Tra cứu khả dụng chỉ tính ô EMPTY có `observation_ready`, không có phiên hoạt động hoặc cờ đối soát. `UNKNOWN` là xe chưa đăng ký; `null` hiển thị chờ nhận diện. Số đếm video mô tả nhận diện vật lý, không phải trạng thái phiên. Proxy phát triển có cả `/parking-slots` và `/parking-sessions`.

Chạy migration backend tới head và khởi động lại backend/AI để có quan sát mới trước khi thử thao tác. Phân tích, phương án đã triển khai và hướng nâng cấp tiếp: [Báo cáo đồng bộ backend/frontend](../docs/frontend/backend-sync-2026-10-14.md).

### Cập nhật theo commit e05fdf5

Phiên chỉ còn `is_active` và `created_at` cùng thông tin khách/người tạo. Bộ lọc
`/sessions` gửi `is_active=true/false`; không hiển thị các mốc giờ đến/rời hoặc
phân loại COMPLETED/CANCELLED/EXPIRED vì backend đã bỏ các trường này. Check-in
chỉ gửi thông tin khách, không gửi `arrived_at`. Cả giữ chỗ và check-in đều có
hạn quay lại ô 10 phút tính từ thời gian tạo. Hạn của phiên đang hoạt động lấy
từ dữ liệu ô trong API map; sự kiện vẫn có thời gian và nguồn ghi nhận riêng.

Hai migration mới xóa các cột lịch sử chi tiết của phiên. Sao lưu database
trước khi nâng migration tới head; không thể khôi phục chi tiết đã xóa chỉ bằng
downgrade. Frontend không chạy migration tự động.

## Phân khu theo đảo cây

Bản đồ và tra cứu công khai có bộ chọn khu, tên mặc định **Khu 1, Khu 2…**.
Với bố trí đã hiệu chỉnh của camera 1, mỗi khu chính gồm hai dãy hai bên cùng
một đảo cây và giữ toàn bộ chiều dài dãy; ranh giới theo các lối xe đã vẽ trong
`siteLayout.ts`. Không chia mỗi 5 row nữa: row trong dữ liệu chỉ là thứ tự ô
trong từng cột, bắt đầu lại từ 0, không phải hàng ngang của toàn bãi.

Bộ 470 ô hiện có 13 khu: 10 cụm dãy quanh đảo cây, 1 dãy sát mép phải và 2 cụm
cạnh cổng tách riêng. Các ô ngang gần cổng không ghép vào đảo bên dưới dù chung
col. Khu 7 gồm col 12, 13, 14 vì bộ gom cột AI chia một dãy vật lý thành nhiều
chỉ số. ID và số khu được cố định theo sơ đồ, không đổi khi trạng thái/polling đổi.
Thuật toán nằm trong `src/zones.ts`.

Chỉ áp dụng ranh giới này khi ROI camera khớp các điểm neo của sơ đồ đã hiệu
chỉnh; camera khác/chưa hiệu chỉnh tạm chia nguyên từng dãy theo col và có nhãn
rõ ràng. Ô thiếu vị trí hợp lệ nằm trong nhóm **Chưa phân khu**. Các khu được
tính từ dữ liệu frontend, chưa lưu cấu hình tên vào database.

Chọn khu cập nhật thống kê và khoanh toàn bộ cụm bằng viền xanh nét đứt có tên
khu. Ô ngoài khu được làm mờ, giữ hình học và mạng đường toàn bãi. Tra cứu nhanh
chỉ chọn ô khả dụng trong khu; các bộ lọc trạng thái vẫn hoạt động độc lập với
viền khu. Chi tiết ô có tên khu; thay đổi trên giám sát lọc theo camera.

Tab **Hiện tại theo khu / cột / hàng** trong /statistics cho chọn nhóm theo khu vật lý hoặc giá trị `col`/`row` của backend, tách riêng mỗi camera và giữ nguyên chỉ số bắt đầu từ 0. Hiển thị tổng ô, trống, có thể giữ
chỗ, đã đỗ, giữ chỗ, xe chưa đăng ký, chờ AI và tỷ lệ có xe. Tỷ lệ có xe là
(OCCUPIED + UNKNOWN) / tổng ô; EMPTY cũ không được coi là khả dụng. Dữ liệu tải
mỗi 5 giây, tách khỏi báo cáo ngày/giờ. Test kiểm tra cả hai dãy đầy đủ, ô gần
cổng, camera khác, dữ liệu lỗi và toàn bộ 470 ô không mất/trùng.
