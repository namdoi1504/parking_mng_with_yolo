# Hướng thiết kế 02 — theo ảnh người dùng gửi

Ngày 08/10/2026. Hướng này cập nhật lựa chọn hình ảnh của phương án trước. Đã áp dụng vào frontend chính: đăng nhập, giám sát, bản đồ, tra cứu, thống kê, quản lý tài khoản/camera và phân quyền.

Trang chính: [Đăng nhập](http://127.0.0.1:5173/login). Mã React: `frontend/src/pages/LoginPage.tsx`; styles riêng: `frontend/src/pages/LoginPage.css`; ảnh chính: `frontend/public/images/parking-login-entrance.png`. Luồng xác thực và lưu token được giữ nguyên. Đã chạy 63 test hiện có và build frontend thành công.

Mở mẫu: [Đăng nhập mới](http://127.0.0.1:5181/login-v2.html).

## Điều cần học từ ảnh tham chiếu

- Có một cảnh nền cụ thể với tiền cảnh, hậu cảnh và ánh sáng rõ. Hình ảnh mang nội dung của sản phẩm, được bố cục cùng với chữ và form.
- Tiêu đề ngắn, tương phản cao, ngắt dòng có chủ ý. Logo, tiêu đề và phần nhập liệu có thứ tự đọc rõ.
- Form trắng nối tiếp cảnh nền ở điện thoại. Bo góc lớn, bóng nhẹ tạo cảm giác một tấm form nổi; mỗi ô nhập có nhãn, biểu tượng và khoảng cách đủ thoáng.
- Màu xanh sáng được tập trung ở nút chính; chi tiết xanh ngọc dùng cho nhận diện. Hiệu ứng màu và bóng được dùng ở vị trí cần nhấn.
- Giảm câu khẩu hiệu dài, huy hiệu, mô tả kỹ thuật và các hộp phụ không phục vụ đăng nhập.

## Cách chuyển sang ImperiaSmart

Mẫu dùng ảnh cổng bãi xe, cây xanh, chung cư và ô tô xanh ngọc tạo riêng bằng image_gen. Đây là ảnh ý tưởng, không phải ảnh bãi xe thực tế. Chữ và form được viết bằng HTML/CSS, không nằm trong ảnh, để còn chỉnh responsive và hỗ trợ bàn phím.

Theo góp ý về câu chữ, tiêu đề được đổi thành “Quản lý bãi đỗ xe”, mô tả “Xem camera và trạng thái ô đỗ.” Phần form dùng “Sử dụng tài khoản đã được cấp.” Bỏ khẩu hiệu, lời chào kiểu quảng cáo và nét gạch trang trí. Tham chiếu chỉ định hướng màu, chiều sâu hình ảnh và cách bố trí form.

Desktop: cảnh xe ở bên trái, form trắng ở bên phải trên nền xanh nhạt. Điện thoại: logo và tiêu đề nằm trên cảnh nền; form trắng có góc bo lớn gối lên phần dưới của ảnh, tương ứng bố cục tham chiếu.

Tên đăng nhập, mật khẩu, hiện/ẩn mật khẩu, ghi nhớ đăng nhập, hỗ trợ qua quản trị viên và tra cứu công khai đều tương ứng với chức năng hiện tại. Trong mẫu, ô nhập chỉ đọc, checkbox không lưu và nút Đăng nhập chỉ chuyển đến màn hình điều hành giả lập.

## Thiết kế đã áp dụng cho các màn hình vận hành

| Màn hình | Thay đổi trên bản chính |
| --- | --- |
| Giám sát | Thanh điều hướng trắng, đầu trang gọn với tiêu đề và thao tác, thẻ số liệu rõ nhãn và tỷ lệ; thông tin kỹ thuật luồng hình được thu gọn trong mục mở rộng |
| Bản đồ | Bộ lọc, nút thu/phóng, nền sơ đồ và bảng chi tiết đồng bộ; trạng thái giữ màu và nhãn hiện có |
| Tra cứu | Khách chưa đăng nhập có header riêng; chọn camera, nút tìm ô trống nhanh, bản đồ và thông tin ô. Nút chỉ chọn ô để xem, không giữ chỗ hoặc khẳng định ô gần nhất |
| Quản lý / phân quyền | Bảng có biểu tượng tài khoản/camera, form thoáng, tab rõ trạng thái; vai trò và quyền trình bày trên các mặt nền trắng |
| Thống kê | Bộ lọc trong thẻ riêng, số liệu và biểu đồ xanh dịu; ô phân tích dùng nền xanh nhạt cùng bảng số liệu và xuất CSV |

Styles chung nằm trong `frontend/src/workspace.css`, được nạp sau stylesheet hiện có. Menu chia thành Vận hành, Báo cáo và Quản trị theo quyền hiện tại. Theo góp ý tiếp theo, ảnh trang trí đã được bỏ khỏi giám sát, bản đồ và tra cứu; đầu trang chỉ có tiêu đề, mô tả và thao tác để nội dung vận hành xuất hiện sớm hơn. Ảnh chỉ giữ ở đăng nhập; styles đăng nhập tiếp tục được giới hạn trong `.parking-login`.

Đã chạy 63 test hiện có và build TypeScript/Vite thành công. Đã kiểm tra sáu trang ở desktop 1280×900 và điện thoại 390×844, sửa lỗi tràn ngang khung video và bản đồ có hiệu chỉnh đường đi, thử đóng menu bằng Escape và trả focus về nút mở menu. Form tài khoản/camera, chọn vai trò và lọc quyền được kiểm tra trong phiên demo riêng, không ghi dữ liệu thật. Tra cứu bản chính tải 470 ô từ backend và nút tìm ô trống chọn được ô để xem chi tiết; layout công khai không tràn ngang ở điện thoại. Backend và AI còn hoạt động khi kiểm tra.

Ảnh kiểm tra giao diện: [Bản đồ desktop](uiux-preview/workspace-map-desktop.jpg), [Quản lý desktop](uiux-preview/workspace-management-desktop.jpg), [Phân quyền desktop](uiux-preview/workspace-access-desktop.jpg), [Giám sát điện thoại](uiux-preview/workspace-monitor-mobile.jpg), [Tra cứu điện thoại](uiux-preview/workspace-lookup-mobile.jpg). Các ảnh trang riêng tư dùng dữ liệu demo và có nhãn trên màn hình.

## Kiểm tra bản mẫu

Đã thử ở desktop mặc định và điện thoại 390×844: ảnh tải đúng, không tràn ngang. Đã thử nút hiện/ẩn mật khẩu mẫu, ghi nhớ, hỗ trợ mật khẩu và chuyển đến trang Điều hành. Không gọi API hoặc lưu thông tin đăng nhập.

Asset: `uiux-preview/assets/parking-entrance-v2.png`.
Prompt và chế độ tạo: [IMAGE-PROMPT-V2.md](uiux-preview/IMAGE-PROMPT-V2.md).
Ảnh chụp: [Điện thoại](uiux-preview/login-v2-mobile.jpg), [Desktop](uiux-preview/login-v2-desktop.jpg).
