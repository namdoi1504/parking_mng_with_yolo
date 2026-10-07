# Rà soát code ngày 08/10/2026

Phạm vi: frontend hiện tại, luồng gọi API và refresh phiên, video AI, bản đồ, cùng các phần backend liên quan đến xác thực, cập nhật trạng thái, giữ chỗ, thống kê và WebSocket. Đây là một lượt rà soát và sửa các vấn đề có bằng chứng; không phải kiểm toán bảo mật toàn bộ hệ thống. Các thay đổi giao diện và chức năng đã có trước lượt này được giữ lại.

## Lỗi đã tái hiện và sửa

### Phản hồi refresh cũ có thể ghi đè phiên mới

Khi refresh đang chờ, người dùng đăng xuất hoặc đăng nhập tài khoản khác, phản hồi thành công từ phiên cũ vẫn có thể lưu lại token. Phản hồi thất bại của phiên cũ cũng có thể xóa token của phiên mới. Ngoài ra, lỗi tạm thời như HTTP 503 trước đây xóa thông tin đăng nhập.

- `frontend/src/api.ts` theo dõi phiên và token nguồn, chỉ áp dụng kết quả refresh cho đúng phiên đang hoạt động.
- Những request trong cùng phiên dùng chung một refresh; request trả 401 muộn có thể dùng token vừa được xoay thay vì refresh thêm lần nữa.
- Chỉ xóa phiên hiện tại khi refresh bị từ chối với 401/403; giữ token khi máy chủ lỗi tạm thời.
- Request bị hủy ngừng chờ refresh, trong khi refresh dùng chung vẫn phục vụ request khác. Refresh có thời hạn 15 giây.
- Test bao phủ đăng xuất, đăng nhập mới, refresh bị từ chối, lỗi 503, request đồng thời, 401 đến muộn và hủy request.

### Video mất kết nối vẫn hiển thị số liệu cũ như đang hoạt động

Metadata mới nhận gần đây không đảm bảo khung hình vẫn đang được truyền. Khi luồng hình lỗi hoặc quá hạn, số ô và nhãn đồng bộ trước đây vẫn có thể tiếp tục xuất hiện.

- `frontend/src/CameraStream.tsx` chỉ hiển thị số liệu và xác nhận đồng bộ khi hình đang hoạt động và kết quả AI chưa quá hạn.
- Khi mất hình hoặc kết quả cũ, số liệu chuyển sang `—`, không giữ nhãn xác nhận đồng bộ màu xanh.
- Test kiểm tra cả khung hình quá hạn và lỗi truyền hình.

## Tối ưu và dọn code đã thực hiện

- `frontend/src/ParkingMap.tsx`: cache hình học theo ROI, tách trạng thái sống khỏi dữ liệu vị trí. Polling trả object mới hoặc thay đổi một ô khác không tính lại đường đến ô đang chọn. Thay đổi trạng thái ô được chọn và hướng vào/ra vẫn cập nhật đường đi. Test sử dụng bản đồ thực 470 ô để kiểm tra hành vi này.
- Kiểm tra ô đang chọn có trên bản đồ được tính một lần mỗi render, thay cho quét toàn bộ danh sách ở từng ô. Giảm thao tác này từ bậc hai xuống tuyến tính theo số ô; chưa đo thời gian render thực tế.
- Xóa CSS của màn hình đăng nhập cũ, giữ các class thương hiệu còn dùng. Bỏ request Google Fonts Inter không còn cần trong giao diện hiện tại. CSS build giảm từ 70,43 kB xuống 67,03 kB; gzip từ 14,78 kB xuống 14,01 kB.
- Xóa helper `websocketUrl` và mock không còn được frontend sử dụng. Sửa tài liệu polling: backend đã đưa phần xác thực đồng bộ sang thread pool, nên nhận định cũ rằng nó đang chặn vòng lặp API không còn chính xác.
- Xóa ba dòng dấu conflict còn sót trong `.gitignore`, giữ quy tắc ignore của cả hai phía.

## Kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend: `pnpm test` | 69 test đạt, 12 file |
| Frontend: `pnpm build` | Đạt |
| TypeScript: `tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters` | Đạt |
| Backend: `pytest tests -q` | 49 đạt, 5 bỏ qua |
| AI: `python -m unittest discover -s AI/tests -q` | 15 test đạt |
| `git diff --check` | Không có lỗi whitespace |

Backend được kiểm tra với database SQLite riêng của bộ test. Năm test bỏ qua gồm một test refresh đồng thời, ba trường hợp chuyển trạng thái đồng thời và một test migration; chúng cần PostgreSQL riêng để kiểm tra row lock và migration. Chưa xác minh các trường hợp này trên PostgreSQL trong lượt rà soát này. Không sử dụng database đang chạy của ứng dụng để thử nghiệm.

Môi trường backend thiếu pytest/httpx; phụ thuộc test được cài vào thư mục tạm riêng, không thay đổi virtualenv đang chạy ứng dụng. Bộ test backend có một cảnh báo deprecation từ Starlette/httpx; không phải lỗi test. Các ca frontend tái hiện lỗi phiên và số liệu video, cùng kiểm tra số lần tính đường, đã thất bại trước sửa và đạt sau sửa.

## Các bước tiếp theo đáng cân nhắc

1. **Đo tải broadcast trước khi đổi kiến trúc.** Backend hiện broadcast lần lượt từng sự kiện ô và kiểm tra quyền từng client ở mỗi sự kiện (`backend/app/routers/parking.py`, `backend/app/websocket_manager.py`). Với batch lớn và nhiều client, số lượt kiểm tra có thể tăng mạnh. Nên đo độ trễ, số truy vấn và hành vi client chậm trước khi thiết kế batch hoặc hàng đợi. Phải giữ khả năng thu hồi quyền; chưa có số đo để khẳng định đây là nút thắt hiện tại.
2. **Gom stylesheet theo component từng phần.** `styles.css` và `workspace.css` vẫn có các rule kế thừa/ghi đè từ những lần đổi giao diện. Có thể chuyển dần từng nhóm component và kiểm tra desktop/mobile trước khi xóa rule, tránh đổi toàn bộ CSS trong một lượt.
3. **Chạy nhóm PostgreSQL còn thiếu trong môi trường test riêng.** Đây là phần xác minh quan trọng còn lại cho tranh chấp giữ chỗ/AI, refresh token và migration.

## Audit phụ thuộc trước khi push

- `npm audit --prefix frontend --json`: không báo lỗ hổng.
- `pip-audit` cho phiên bản đã pin trong `requirements.txt`: báo ba advisory ở `urllib3 2.7.0`, bản sửa `2.8.0` (PYSEC-2026-4175, PYSEC-2026-4176, PYSEC-2026-4177).
- `pip-audit` cho các package đang cài trong virtualenv backend: báo 23 dòng advisory, có dòng trùng, liên quan đến `ecdsa 0.19.2`, `python-jose 3.5.0`, `pip 24.0` và `setuptools 65.5.0`. Đây là audit môi trường đang cài, không phải một lockfile backend. Đầu ra không nêu bản sửa cho `ecdsa` và `python-jose`; cần đánh giá khả năng khai thác và phương án cập nhật riêng.

Các phụ thuộc và cấu hình/credential dịch vụ không được thay đổi trong lượt này.
