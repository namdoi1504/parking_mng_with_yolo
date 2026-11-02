# Điều khiển video demo: pause, resume và tua

Đã triển khai phần backend và AI. FE chưa có nút điều khiển; API có thể dùng ngay
bằng Swagger hoặc PowerShell. Không thay đổi bảng/cột, không có migration mới.

## Chạy một bản Docker tại cổng 8080

Chạy từ thư mục gốc. `compose.yaml` khởi động cả PostgreSQL, backend, frontend
và AI; video vẫn tự lặp và mặc định bật API pause/resume/seek. Chỉ dùng database
của project `parking-mng`, không cần bản chạy riêng tại 18080 hoặc database thứ hai.
Tên biến `VIDEO_DEMO_ENABLED` trong code có nghĩa bật đồng hồ/điều khiển video
đã ghi sẵn; trong Docker mặc định biến này là true ở backend và AI.

Trong `.env.docker` cần `VIDEO_DEMO_CONTROL_TOKEN`, chuỗi ngẫu nhiên ít nhất 32 ký tự,
dùng chung cho backend và AI. Token này không phải mật khẩu admin/token đăng nhập
và không đưa vào frontend. Máy hiện tại đã có token.

```powershell
docker compose --env-file .env.docker up -d --build
```

Nếu database mới chưa có admin, chạy một lần:

```powershell
docker compose --env-file .env.docker exec backend python -m app.seed --admin-username admin
```

- Frontend: http://localhost:8080 (FE chưa có nút điều khiển video).
- API/Swagger: http://localhost:8000/docs.
- Đổi cổng bằng FRONTEND_PORT/BACKEND_PORT nếu cần.
- Tài khoản và database của bản 8080 hiện có được dùng tiếp; không chuyển/gộp
  dữ liệu từ bản 18080 cũ.
- DB vẫn lưu trong volume `parking-mng_parking_data`; dừng/tạo lại container không
  tự xóa volume. Chỉ lệnh seek mới chủ động reset dữ liệu phiên/sự kiện/thống kê
  của camera theo hợp đồng phía dưới.

Dừng cả dự án và giữ database:

```powershell
docker compose --env-file .env.docker down
```

Sau khi đổi code backend/AI, tạo lại cả hai vì đang dùng chung network namespace:

```powershell
docker compose --env-file .env.docker up -d --build --force-recreate backend ai frontend
```

Bản 18080 trước đây đã được thay thế. Nếu máy khác còn chạy stack cũ, dừng nó
một lần (không thêm -v) rồi chạy lệnh mặc định ở trên:

```powershell
docker compose -p parking-mng-demo --env-file .env.docker down
```

Đây là chế độ cho một video/camera và một backend worker. Nếu sau này chuyển sang
camera bãi thực, cần thiết kế lại quyền reset/time handling; không dùng thao tác
tua/xóa phiên của video để vận hành camera thực.

## API cho FE

Tất cả endpoint dưới đây yêu cầu Bearer token của Administrator, giống quyền
đặt chỗ/check-in hiện có. API nội bộ AI chỉ bind loopback và yêu cầu shared token;
FE luôn gọi backend, không gọi AI trực tiếp.

FE dùng đường dẫn tương đối `/api/video-demo/...` như các API hiện có, không ghi
cứng cổng. Bản Docker truy cập chung tại 8080; khi phát triển FE bằng Vite ở 5173,
proxy hiện có chuyển `/api` tới backend Docker ở 8000. Không cần bản FE hoặc DB thứ hai.

| Method | Endpoint | Ý nghĩa |
|---|---|---|
| GET | `/api/video-demo/status` | Trạng thái video, sức khỏe AI và đồng hồ demo |
| POST | `/api/video-demo/pause` | Dừng giải mã, chờ nhận diện/gửi dữ liệu đang chạy kết thúc, gửi quan sát cuối rồi xác nhận paused |
| POST | `/api/video-demo/resume` | Tiếp tục từ vị trí dừng; bắt đầu lại xác nhận occupancy theo thời gian mới |
| POST | `/api/video-demo/seek` | Bắt đầu lượt demo mới ở mốc chỉ định, nhận diện lại và giữ pause |

POST pause/resume không cần body. Pause/resume có tính idempotent: gọi lại không cộng thời gian
dừng hai lần. Lệnh pause có thể mất vài giây vì phải chờ YOLO và sender kết thúc;
client nên dùng timeout ít nhất 35 giây. Không hiển thị "đã dừng" trước khi API
xác nhận. Nếu request timeout, GET status để đối chiếu rồi retry cùng lệnh.

Phản hồi có hai phần (rút gọn):

```json
{
  "playback": {
    "camera_id": 1,
    "run_id": "UUID của lượt chạy AI",
    "playback_state": "paused",
    "control_enabled": true,
    "ready": true,
    "running": true,
    "frame_id": 123,
    "media_seconds": 12.3,
    "fps": 0,
    "video_fps": 0,
    "paused_at": "UTC thực khi dừng",
    "resumed_at": null,
    "pause_id": "UUID của lần dừng"
  },
  "clock": {
    "enabled": true,
    "healthy": true,
    "paused": true,
    "business_time": "Thời gian nghiệp vụ demo",
    "wall_time": "Thời gian UTC thực",
    "excluded_pause_seconds": 0,
    "backend_id": "UUID tiến trình backend",
    "run_id": "UUID lượt AI",
    "playback_state": "paused"
  }
}
```

Các trường thời gian trong phản hồi thật là ISO 8601; UUID hợp lệ được mô tả trong
OpenAPI. `playback` cũng giữ các số liệu inference, tuổi kết quả, FPS, sync_ok của
stream hiện có. `/ai-stream/status` có playback_state và thêm demo_clock khi bật demo.

Mã lỗi: 401 chưa đăng nhập; 403 thiếu quyền; 404 chưa bật demo; 409 trạng thái chưa
sẵn sàng/AI từ chối lệnh; 503 AI không kết nối hoặc phản hồi không hợp lệ.

## Thao tác nhanh bằng PowerShell

Sau khi seed admin, đăng nhập mà không ghi mật khẩu vào lịch sử lệnh:

```powershell
$credential = Get-Credential -UserName admin -Message 'Tai khoan admin cua du an'
$loginBody = @{
    username = $credential.UserName
    password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:8000/auth/login' -ContentType 'application/json' -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.access_token)" }

Invoke-RestMethod -Method Get -Uri 'http://localhost:8000/api/video-demo/status' -Headers $headers
Invoke-RestMethod -Method Post -Uri 'http://localhost:8000/api/video-demo/pause' -Headers $headers -TimeoutSec 35
# Nhập thông tin/đặt chỗ/check-in qua UI hiện có tại localhost:8080 hoặc API.
Invoke-RestMethod -Method Post -Uri 'http://localhost:8000/api/video-demo/resume' -Headers $headers -TimeoutSec 35
```

## Tua đến mốc thời gian

Tua dùng cùng video hiện tại, không tạo nhiều clip và không lưu các phiên bản cũ.
Dữ liệu được reset trên chính database của bản 8080; yêu cầu quyền admin như các lệnh điều khiển khác.

```http
POST /api/video-demo/seek
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "seconds": 45,
  "request_id": "b9140705-365f-482b-bcd9-d8fb82537dac"
}
```

`seconds` là thời gian trong video nguồn, không phải thời gian thực đã chạy.
Ví dụ video đang phát 1/3× thì seconds=45 vẫn là mốc 00:45 trong video.
Phạm vi: `0 <= seconds < playback.duration_seconds`. Vị trí thật được làm tròn
xuống frame gần nhất; xem `playback.media_seconds` trong phản hồi. Status cũng có
`source_fps` và `total_frames` để FE làm thanh tua.

Quy trình: chặn thao tác nhập liệu → dừng và chờ các tác vụ AI cũ → chuyển tới
frame mới, đổi run_id → nhận diện frame này → đặt lại dữ liệu camera demo trong
một transaction → xác nhận với AI → trả trạng thái paused/seek_ready=true.

**Mỗi lệnh tua mới xóa các phiên đỗ/đặt chỗ, sự kiện và thống kê của camera demo.**
Tài khoản, phân quyền, camera và cấu hình ROI/ô đỗ được giữ lại. Camera khác không
bị xóa dữ liệu. Xe trong frame mới thành UNKNOWN, ô trống thành EMPTY. Đây là
snapshot tại mốc được chọn, không suy ra sự kiện xe vào/ra của đoạn đã bỏ qua.
Sau resume, AI tiếp tục dùng bộ xác nhận occupancy theo thời gian như bình thường.

Phản hồi thêm các trường:

```json
{
  "request_id": "b9140705-365f-482b-bcd9-d8fb82537dac",
  "replayed": false,
  "reset": {
    "deleted_sessions": 1,
    "deleted_events": 500,
    "deleted_statistics": 1,
    "initialized_slots": 470
  }
}
```

Ngoài ra vẫn có playback/clock như pause/resume. Khi thành công:
`playback.playback_state=paused`, `playback.seek_ready=true`,
`clock.paused=true`, `clock.healthy=true`, `clock.seeking=false`.
Đồng hồ demo bắt đầu lại cho lượt mới; có thể check-in/đặt chỗ ngay nếu
observation_ready=true. Kết quả hoặc gói tin từ run_id trước bị từ chối.

`request_id` có thể bỏ qua để backend sinh khi thử bằng Swagger. FE phải tự tạo
UUID cho mỗi thao tác tua mới và dùng lại cùng UUID/seconds khi retry do timeout.
Gửi lại yêu cầu đã hoàn tất trả replayed=true và không xóa dữ liệu mới nhập.
Dùng lại UUID với mốc khác, hoặc UUID của lượt cũ sau khi đã tua sang lượt khác,
trả 409. Mã yêu cầu chỉ giữ trong RAM, không phải bản sao video hay phiên đỗ.

Nếu reset/ack bị gián đoạn, clock.seeking=true và backend khóa các thao tác ghi;
retry cùng request_id để hoàn tất. AI cũng không cho resume trước khi backend
xác nhận reset. Không tự bấm Resume để bỏ qua một lệnh tua đang lỗi.

Ví dụ PowerShell sau khi đã có `$headers` từ bước đăng nhập:

```powershell
$seekBody = @{ seconds = 45; request_id = [guid]::NewGuid().ToString() } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:8000/api/video-demo/seek' -Headers $headers -ContentType 'application/json' -Body $seekBody -TimeoutSec 35
# Nếu timeout, dùng lại $seekBody; không sinh UUID khác cho lần retry.
```

Backend phát WebSocket event `VIDEO_DEMO_SEEKED` sau khi thành công, gồm
request_id, run_id và reset. FE cần đóng form/chi tiết phiên cũ và tải lại bản đồ,
danh sách phiên, sự kiện và thống kê. Trong lúc chờ phản hồi, hiển thị "Đang tua",
khóa nút điều khiển và form; tránh gửi nhiều lệnh tua cho mỗi bước kéo thanh trượt.
FE chưa được thay đổi trong đợt triển khai này.

## Quy tắc thời gian và giới hạn

- Khi paused, video không tiến, YOLO không nhận diện tiếp, sequence quan sát và
  observed_at trong DB không được làm mới. MJPEG có thể phát lại JPEG cuối để giữ
  kết nối; frame_id, vị trí và thời gian chụp không đổi.
- Đồng hồ nghiệp vụ dừng. Độ mới quan sát và thời hạn đặt chỗ dùng đồng hồ này,
  nên có thể nhập thông tin khi dừng lâu. Quan sát đã cũ trước lúc pause vẫn cũ;
  pause không tự biến ô chưa quan sát thành ô đủ điều kiện đặt chỗ.
- Sau resume, thời gian tiếp tục từ mốc đã dừng. Timestamp AI gửi lên vẫn là UTC
  thực và được kiểm tra tuổi thực trước; backend chuyển sang timeline demo khi
  lưu sự kiện/quan sát mới. Không sửa lại timestamp của quan sát đã lưu.
- Backend thăm AI mỗi 2 giây, lease tin cậy tối đa 6 giây. AI chết hoặc mất kết
  nối khi paused thì quan sát không còn đủ điều kiện thao tác; không giữ tin cậy
  vô hạn chỉ vì đồng hồ đang dừng.
- Token đăng nhập, network timeout và lịch chạy scheduler vẫn theo giờ thực.
  Pause quá lâu làm token đăng nhập hết hạn thì cần đăng nhập lại.
- Bộ xác nhận occupancy được reset khi resume để thời gian nghỉ không được tính
  thành thời gian xe có mặt/ô trống ổn định. Chờ quan sát mới sau resume khi cần.
- Đồng hồ/điều khiển chỉ lưu trong RAM. Restart backend/AI không bảo toàn timeline
  của lượt demo cũ. Khi backend đổi, phải resume và có quan sát mới để tiếp tục;
  nếu cần trình diễn đúng thời hạn của phiên cũ, dùng seek để bắt đầu lượt video mới (đặt lại các phiên cũ),
  không cần tạo thêm database. Không cam kết tiếp tục chính xác phiên đã pause qua restart.

## Công việc FE còn lại

Thêm nút Pause/Resume và trạng thái pausing/paused; dùng playback_state để phân biệt
pause với mất kết nối. Giữ hình cuối, gắn nhãn tạm dừng và hiển thị thời gian video.
Dùng clock.business_time cho đếm ngược đặt chỗ trong demo. Không dùng Date.now()
để tự đánh giá tuổi observation demo: sau nhiều lần pause, timestamp nghiệp vụ
có thể chậm hơn UTC thật. Dựa vào observation_ready và clock.healthy của backend.
FE cũ hiện có thể báo khung hình cũ khi pause lâu vì vẫn kiểm tra frame_age_seconds;
đây là phần tích hợp FE để làm sau theo phạm vi đã thống nhất.

## Kiểm tra

Kiểm tra pause/resume ban đầu: toàn bộ backend 82 passed/4 skipped; AI 20 passed.
Kiểm tra Docker thực tế trong stack/database riêng `parking-mng-pause-check`:

- Nhận diện và đồng bộ 470 ô.
- Pause, gọi pause lại giữ cùng pause_id.
- Dừng 18 giây: frame_id/media_seconds, sequence AI, observed_at và đồng hồ nghiệp vụ không đổi.
- Sau 18 giây vẫn đặt chỗ ô trống và check-in UNKNOWN thành công.
- Resume và gọi lại không trừ thời gian pause hai lần; AI tiếp tục gửi trạng thái.
- Nguồn video tiếp tục gần vị trí dừng, không nhảy qua 18 giây nghỉ.
- Lệnh điều khiển nội bộ không có token bị từ chối.
- Dừng container AI khi paused: backend hết lease và từ chối đặt chỗ.

Đã bổ sung tua trên cùng video; chưa thêm đổi file video/chọn case hoặc lưu lượt
phát qua restart. Model, ngưỡng nhận diện và độ phân giải inference giữ nguyên.

### Kết quả kiểm tra bổ sung cho tua

- Toàn bộ backend: 89 passed, 4 skipped; AI: 23 passed.
- Build backend/AI và chạy PostgreSQL thật trong stack riêng `parking-mng-seek-check`.
- Tua từ vị trí hiện tại đến 45 giây trả frame tại 44,93 giây (làm tròn theo FPS nguồn).
- Khởi tạo lại đủ 470 ô, xóa phiên/sự kiện/thống kê cũ đúng camera, giữ ID ô và tài khoản.
- Giữ pause 18 giây vẫn check-in UNKNOWN được.
- Retry cùng request_id giữ nguyên phiên mới vừa nhập, không reset lần thứ hai.
- Từ chối gói quan sát thuộc run cũ và mốc tua vượt thời lượng video.
- Tua lùi về 5 giây, resume tiếp tục gần mốc đó và đồng bộ bình thường.
- Kiểm thử lỗi mất phản hồi trước/sau xác nhận reset: thao tác ghi bị khóa trong
  trạng thái chưa hoàn tất; retry cùng request_id khôi phục được.
- Không thêm bảng/cột hoặc migration; FE chưa có nút/thanh tua.

### Cấu hình triển khai hiện tại

Đã hợp nhất vào `compose.yaml`: một lệnh up khởi động đủ bốn dịch vụ, không cần
profile hoặc compose.demo.yaml. Đã kiểm tra lại pause/tua/resume bằng cấu hình này
trong stack tạm `parking-mng-single-check`. Bản chính ở 8080 đã được cập nhật,
kiểm tra API pause/resume và giữ các tài khoản, ID ô, bản ghi phiên hiện có.
Không chạy seek trên database chính trong quá trình cập nhật. Stack 18080 cũ đã
dừng; volume cũ giữ lại làm dữ liệu lưu, không được dùng bởi bản 8080.
