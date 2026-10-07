# Đề xuất UI/UX cho ImperiaSmart Parking

Ngày: 08/10/2026. Phạm vi: đọc frontend hiện tại, nghiên cứu nguyên tắc UX và làm mẫu để duyệt. Chưa thay giao diện ứng dụng thật. Các đề xuất là giả thuyết thiết kế, chưa được kiểm chứng bằng thử nghiệm với người dùng thực tế.

**Cập nhật hướng hình ảnh:** sau ảnh tham chiếu người dùng gửi, xem [Hướng thiết kế 02](UIUX-V2-DIRECTION.md) và [mẫu đăng nhập mới](http://127.0.0.1:5181/login-v2.html). Phần hình ảnh ở phương án 01 dưới đây được giữ để so sánh.

## Hướng đề xuất

Giữ navy làm màu thương hiệu, nền sáng trung tính, xanh lá cho thao tác chính và ô trống. Giảm viền, lớp hộp lồng nhau và phần giải thích dài. Chọn kiểu giao diện vận hành gọn, bình tĩnh, dễ quét mắt; ảnh minh họa dành cho đăng nhập và những trạng thái phù hợp.

Bản mẫu tương tác: [http://127.0.0.1:5181/](http://127.0.0.1:5181/). Mã mẫu nằm trong `docs/uiux-preview/`, chạy độc lập bằng thư viện chuẩn Python, không cần cài thêm dependency:

```powershell
python -m http.server 5181 --bind 127.0.0.1 --directory docs/uiux-preview
```

Mẫu dùng 24 ô giả lập. Có thể đổi màn hình, lọc khu, tìm mã ô, chọn ô, tìm ô trống tiếp theo, thử giữ/hủy/xác nhận chỗ và kiểm tra thông báo mất hình. Mọi thao tác chỉ thay đổi dữ liệu trong bộ nhớ trang; không gọi backend, đăng nhập, lưu mật khẩu hoặc ghi vào cơ sở dữ liệu. Tải lại trang sẽ khôi phục mẫu. Menu bị vô hiệu hóa là phần chưa làm mẫu.

## Ba màn hình để duyệt

| Màn hình | Vấn đề trong giao diện hiện tại | Hướng mẫu | Khi triển khai thật |
| --- | --- | --- | --- |
| Tìm chỗ đỗ | Tra cứu nằm trong cùng shell có nhiều mục quản trị; sơ đồ 470 ô dễ tạo cảm giác nặng | Header đơn giản, số ô trống rõ, một nút tìm ô trống, lọc khu, chi tiết theo ô | Giữ sơ đồ và tọa độ thật; chia khu theo cấu hình hiện có. Không khẳng định ô gần nhất hoặc ETA khi chưa có dữ liệu xác định |
| Điều hành | Video, sơ đồ, cập nhật và mô tả trạng thái cạnh tranh sự chú ý; thao tác giữ chỗ hiện nằm ở trang bản đồ | Tổng quan 4 trạng thái, cảnh báo chưa xác định có nút đi tới ô, thao tác gắn với ô đang chọn, camera phụ trách ở gần sơ đồ | Dùng quyền backend; reserve chỉ cho Administrator theo hợp đồng hiện tại. Giữ freshness của dữ liệu AI, hiển thị nguồn hình và thời điểm cập nhật thật |
| Đăng nhập | Phần giới thiệu nhiều chữ, chưa có hình nhận diện riêng | Ảnh bãi đỗ tạo riêng, câu giới thiệu ngắn, form rõ và đường vào tra cứu công khai | Giữ xác thực hiện tại, thông báo lỗi và điều hướng theo quyền. Mẫu không thu thập thông tin đăng nhập |

## Các cải tiến ưu tiên

1. **Tổ chức theo việc cần làm.** Người lái vào tra cứu; nhân viên vào điều hành; chức năng phân quyền và cấu hình gom vào quản trị, chỉ hiện khi được phép. Không ép người lái đọc các chỉ số vận hành hoặc menu không liên quan. Giao diện nhiều chức năng nên làm nổi bật thông tin chính và mở thêm chi tiết theo nhu cầu. [NN/g — Designing Complex Applications](https://www.nngroup.com/articles/complex-application-design/).
2. **Cảnh báo dẫn tới hành động.** “Chưa rõ trạng thái” phải đi tới đúng ô/camera. “Mất hình” nên có lần cập nhật gần nhất và nút thử lại; hướng dẫn khởi động agent dành cho phần chẩn đoán của quản trị viên, không chiếm vùng chính. Giữ quy tắc không phát lại video cũ như đang trực tiếp khi AI ngừng chạy.
3. **Giữ/hủy/xác nhận ngay tại ô đang chọn.** Chỉ hiện thao tác hợp lệ và đủ quyền. Sau thao tác cập nhật ô, tổng quan và thông báo kết quả nhất quán; khi có xung đột từ backend cần báo trạng thái mới và cho người dùng xem lại. Dữ liệu giả trong mẫu chỉ minh họa trình tự.
4. **Dễ đọc và dùng trên điện thoại.** Trạng thái có chữ và biểu tượng; màu chỉ hỗ trợ, tránh bắt người dùng phân biệt ô bằng màu đơn thuần. [W3C — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Nút chính hướng tới vùng bấm ít nhất 44 px, ô đỗ và bộ lọc có khoảng cách, focus bàn phím rõ. Mức tối thiểu AA trong WCAG 2.2 là 24×24 CSS px, với các ngoại lệ quy định. [W3C — Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
5. **Trang trí có mục đích.** Ảnh lớn ở đăng nhập, có thể thêm một minh họa nhỏ cho lần đầu cấu hình camera hoặc chưa có báo cáo. Không dùng ảnh tạo sinh thay bản đồ thực, video trực tiếp hay dữ liệu nhận diện. Giao diện đẹp có thể tăng cảm nhận dễ sử dụng, nhưng không thay thế việc sửa luồng thao tác và kiểm chứng khả năng hoàn thành nhiệm vụ. [NN/g — Aesthetic–Usability Effect](https://www.nngroup.com/articles/aesthetic-usability-effect/).

## Quy ước hình ảnh và trạng thái

| Thành phần | Hướng dùng |
| --- | --- |
| Navy `#162c40` | Điều hướng, chữ quan trọng, nhận diện thương hiệu |
| Xanh lá `#126247` | Thao tác chính, ô trống; chữ “Trống” + dấu kiểm |
| Xanh lam `#335e8d` | Có xe; chữ “Có xe” + biểu tượng xe |
| Vàng nâu `#865800` | Đã giữ; chữ “Đã giữ” + biểu tượng khóa |
| Đỏ trầm `#9a4242` | Chưa rõ; chữ “Chưa rõ” + biểu tượng cảnh báo |
| Ảnh `assets/parking-courtyard.png` | Minh họa ý tưởng ở đăng nhập; caption phân biệt với ảnh/sơ đồ thực tế |

Mẫu giữ ánh sáng dịu và không dùng chuyển động trang trí. Responsive: bố cục hai cột chuyển thành một cột ở điện thoại; nút chính và bộ lọc vẫn rõ. Khi triển khai sơ đồ 470 ô thật cần giữ zoom/pan, tìm ô và bản danh sách tương đương; grid 24 ô trong mẫu chỉ là công cụ duyệt phong cách, không phải thay thế trực tiếp cho sơ đồ thật.

## Trình tự áp dụng đề xuất

- **Đợt 1 — dễ nhận thấy, ít ảnh hưởng logic:** chỉnh tokens, chữ, khoảng cách, nút, legend; giản lược mô tả trạng thái; đưa ảnh vào đăng nhập; cải thiện hiển thị trên màn hình nhỏ.
- **Đợt 2 — cải thiện luồng công việc:** tách shell tra cứu/nhân viên, nhóm menu theo quyền, thống nhất điều hành với chi tiết ô và reservation; cảnh báo dẫn tới ô/camera liên quan.
- **Đợt 3 — hoàn thiện các trang còn lại:** thống kê ưu tiên bộ lọc và kết quả, export gần báo cáo; quản lý tách edit khỏi delete và thông báo xung đột; phân quyền giảm tải bằng nhóm quyền và tìm kiếm.

Khi người dùng duyệt mẫu, xác định ưu tiên một đợt rồi áp dụng vào React hiện tại. Không thêm thư viện UI chỉ để đổi hình thức; giữ API, hình học bản đồ, xác thực và phân quyền đã có.

## Cách kiểm chứng trước khi gọi là “dễ dùng hơn”

Thử với 5 người đại diện cho hai nhóm người lái/nhân viên, dùng các nhiệm vụ tương ứng với quyền của họ: tìm ô trống ở khu B; tìm ô theo mã; giữ rồi hủy một ô bằng tài khoản đủ quyền; phân biệt camera mất hình với trạng thái ô chưa xác định; xem báo cáo theo ngày. Ghi thời gian hoàn thành, số lần bấm sai, có cần giải thích không và câu trả lời sau tác vụ. So sánh với giao diện hiện tại, không chỉ hỏi “có đẹp không”.

Điều kiện để áp dụng: người dùng tìm được thao tác chính ngay; không nhầm “đang xem ô” với “đã giữ ô”; không hiểu dữ liệu cũ là trực tiếp; bàn phím và màn hình nhỏ hoàn thành được luồng; không phát sinh thao tác trái quyền. Mẫu minh họa chưa phải đánh giá WCAG đầy đủ và chưa kiểm chứng sơ đồ 470 ô.

## Kiểm tra bản mẫu

Đã kiểm tra trên trình duyệt:

- Tìm ô trống kế tiếp; tìm mã không có kết quả; chọn khu B chuyển chi tiết sang ô trong khu B, hiển thị 12 ô.
- Giữ chỗ: tổng trống 10 → 9, đã giữ 3 → 4; hủy khôi phục 10/3; xác nhận xe vào chuyển trạng thái sang Có xe và tổng có xe 10 → 11. Đây đều là thao tác mẫu.
- Cảnh báo mở ô B-03 và camera phụ trách CAM-02; Escape đóng hộp xác nhận, không đổi trạng thái.
- Desktop mặc định và điện thoại 390×844: tra cứu, điều hành, đăng nhập không tràn ngang; ảnh minh họa tải đúng. Trên điện thoại, chọn ô mở phần chi tiết và có nút quay về sơ đồ.
- JavaScript qua kiểm tra cú pháp Node; không ghi nhận lỗi console trong phiên kiểm tra.

Ảnh chụp để duyệt: [Tra cứu desktop](uiux-preview/driver-desktop.jpg), [Điều hành desktop](uiux-preview/operator-desktop.jpg), [Đăng nhập desktop](uiux-preview/login-desktop.jpg), [Tra cứu mobile](uiux-preview/driver-mobile.jpg), [Đăng nhập mobile](uiux-preview/login-mobile.jpg).

Bản mẫu hoạt động độc lập, không yêu cầu chạy lại build/test của production vì không sửa mã frontend trong đợt thiết kế này. Các kiểm tra trên không thay thế kiểm thử khả dụng với người dùng hoặc đánh giá WCAG đầy đủ.
