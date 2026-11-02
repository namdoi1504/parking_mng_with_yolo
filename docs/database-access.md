# Kết nối database Docker bằng DBeaver hoặc pgAdmin

Database của dự án nằm trong PostgreSQL Docker, lưu bền tại volume
`parking-mng_parking_data`. DBeaver/pgAdmin kết nối vào database này để truy vấn
và quản lý; không tạo một bản database mới trên Windows.

Compose mở cổng chỉ trên máy local: `127.0.0.1:5433` → container `5432`.
Có thể đổi cổng ngoài bằng `POSTGRES_HOST_PORT` trong `.env.docker` nếu bị trùng.
Backend vẫn dùng `db:5432` bên trong mạng Docker.

## DBeaver

Chọn Database → New Database Connection → PostgreSQL. Nhập:

| Trường | Giá trị |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` hoặc POSTGRES_HOST_PORT đã cấu hình |
| Database | POSTGRES_DB trong `.env.docker`, hiện tại `parking_db` |
| Username | POSTGRES_USER trong `.env.docker`, hiện tại `parking_user` |
| Password | POSTGRES_PASSWORD trong `.env.docker` |

Chọn Test Connection; tải PostgreSQL driver nếu DBeaver yêu cầu, sau đó Finish.
Mở database → Schemas → public → Tables. Hoặc mở SQL Editor và chạy:

```sql
SELECT current_database(), current_user;
SELECT COUNT(*) FROM public.parking_slots;
SELECT id, slot_code, status FROM public.parking_slots ORDER BY id LIMIT 20;
```

Trong pgAdmin có thể đăng ký server với cùng host, port và thông tin tài khoản.
Cổng 5432 trên Windows có thể là PostgreSQL cài riêng; bản Docker mặc định dùng
cổng 5433 để tránh nhầm.

### Lỗi TimeZone Asia/Saigon trong DBeaver

Nếu báo `FATAL: invalid value for parameter "TimeZone": "Asia/Saigon"`, mở
Window → Preferences → User Interface, đổi Timezone/Client Timezone thành
`Asia/Ho_Chi_Minh` (hoặc `UTC`), Apply and Close và khởi động lại DBeaver.
Đây là tên múi giờ phía client gửi trong lúc kết nối. PostgreSQL Docker hiện tại
đã được kiểm tra có `Asia/Ho_Chi_Minh` và `UTC`, không có alias `Asia/Saigon`.

Nếu bản DBeaver không có mục này, đóng ứng dụng, mở `dbeaver.ini` cạnh file
chạy DBeaver và thêm một dòng riêng `-Duser.timezone=Asia/Ho_Chi_Minh` trong phần
sau `-vmargs`, rồi mở lại ứng dụng.

## Áp dụng cấu hình cổng

Chạy tại thư mục gốc dự án:

```powershell
docker compose --env-file .env.docker up -d db
```

Lệnh trên giữ volume hiện có. Dừng/tạo lại container không tự xóa dữ liệu;
`down -v` sẽ xóa volume nên chỉ dùng nếu chủ động muốn xóa database.
POSTGRES_PASSWORD phải khớp mật khẩu đang có trong database; chỉ sửa file môi
trường không đổi mật khẩu của tài khoản đã được tạo trước đó.

Đặt chỗ/check-in/check-out nên thao tác qua UI/API để giữ đúng phiên và lịch sử.
Thay đổi cấu trúc bảng/cột của dự án cần thực hiện bằng Alembic migration.

Tham khảo: https://dbeaver.com/docs/dbeaver/Database-driver-PostgreSQL/
