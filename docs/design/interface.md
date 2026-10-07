# Quy ước giao diện frontend

Giao diện dùng nền xanh nhạt, thanh điều hướng trắng, chữ Segoe UI, nút chính xanh và mặt nền trắng cho form/bảng. Màu trạng thái luôn đi cùng nhãn để người dùng phân biệt ô trống, đã đỗ, giữ chỗ và chưa xác định.

- Đăng nhập: ảnh bãi xe ở bên trái trên desktop; ảnh phía trên, form trắng gối lên ảnh trên điện thoại. Ảnh minh họa chỉ dùng tại trang đăng nhập.
- Giám sát và bản đồ: ưu tiên camera, dữ liệu ô đỗ, bộ lọc và thao tác. Thông tin kỹ thuật luồng video nằm trong mục mở rộng.
- Tra cứu công khai: header riêng, chọn camera và tìm ô trống để xem vị trí. Thao tác chọn ô không giữ chỗ hoặc xác định khoảng cách.
- Quản lý và phân quyền: bảng/form trên nền trắng, tab và vai trò đang chọn có trạng thái rõ; menu hiển thị theo quyền hiện tại.
- Thống kê: bộ lọc ngày/camera, số liệu, biểu đồ và bảng báo cáo; xuất CSV từ dữ liệu đã tải.

Styles chung: `frontend/src/workspace.css`, nạp sau `frontend/src/styles.css`. Đăng nhập dùng `frontend/src/pages/LoginPage.css`, giới hạn trong `.parking-login`. Asset đăng nhập và prompt được ghi ở [login-image.md](login-image.md).

Kiểm tra giao diện đã thực hiện ở desktop 1280×900 và điện thoại 390×844, gồm tràn ngang video/bản đồ, đóng menu bằng Escape và trả focus. Kết quả test/build và giới hạn kiểm tra backend: [Báo cáo rà soát](../reviews/2026-10-08.md).
