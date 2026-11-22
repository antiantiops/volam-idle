# Võ Lâm Idle (Docker Local)

Gói chạy cục bộ bằng Docker cho máy chủ và giao diện Võ Lâm Idle (thuần Node.js built-in, không dùng thư viện ngoài).

## Yêu cầu chuẩn bị

- Docker và Docker Compose v2 (`docker compose`).
- Thư mục `assets/` do bạn tự chuẩn bị từ gói tài nguyên gốc hợp lệ mà bạn được quyền sử dụng. Mã nguồn và Docker image không kèm sẵn tài nguyên này.

## Cấu trúc thư mục `assets`

Đặt thư mục `assets/` ngay cạnh `compose.yaml` trước khi khởi động:

```text
.
├── assets/          # Người dùng tự cung cấp từ gói tài nguyên gốc hợp lệ
├── cau-hinh.json
├── chay-game.js
├── compose.yaml
├── Dockerfile
├── game.html
├── may-chu/
├── quan-tri.js
└── src/
```

`compose.yaml` mount `./assets` vào `/app/assets` ở chế độ chỉ đọc (`read_only: true`) với `create_host_path: false`, vì vậy `./assets` phải tồn tại sẵn trên máy host trước khi chạy.

## Khởi động

```bash
docker compose up --build
```

Hoặc chạy nền:

```bash
docker compose up -d --build
```

Sau khi máy chủ chạy, mở trình duyệt tại:

- `http://localhost:8101`

Cổng mặc định chỉ bind vào `127.0.0.1:8101` trên máy host.

## Tạo tài khoản đầu tiên

Tài khoản đầu tiên được tạo sẽ tự động có quyền quản trị (`admin`). Tên tài khoản hợp lệ gồm 3–20 ký tự `[a-z0-9_]`.

Chạy trong Bash để tạo tài khoản `admin` mà không lưu mật khẩu vào lịch sử lệnh:

```bash
(
  read -rsp 'Mật khẩu: ' VL_PASS || exit 1
  printf '\n'
  export VL_PASS
  docker compose exec -e VL_PASS game sh -c 'node quan-tri.js them admin "$VL_PASS"'
)
```

## Lưu trữ dữ liệu (Persistence)

Dữ liệu tài khoản, nhân vật, nhật ký và bản sao lưu hàng ngày được lưu tại `/data` trong container thông qua biến môi trường `VL_DU_LIEU=/data` gắn với named volume `game_data`.

## Dừng máy chủ

```bash
docker compose down
```

Lệnh này dừng và gỡ container nhưng giữ nguyên dữ liệu trong named volume `game_data`.

## Cổng quản trị ngoài (tùy chọn)

Route `/admin/tao-tai-khoan` mặc định **bị tắt** (fail-closed, trả về HTTP `403`) nếu thiếu cấu hình runtime. Chỉ bật khi chạy sau reverse proxy đã xác thực OAuth/OIDC và gắn secret nội bộ:

- `VL_ADMIN_EMAIL` — email quản trị khớp với trường `email` (`email_verified: true`) trong header `x-userinfo`.
- `VL_ADMIN_ORIGIN` — origin `https://...` chính xác (không có đường dẫn hay dấu `/` cuối), dùng để kiểm tra header `Origin` ở các yêu cầu `POST`.
- Secret file `/run/secrets/volam-admin-proxy` — mount qua Docker secret hoặc bind chỉ đọc chứa chuỗi khớp với header `x-volam-admin-proxy`.

`compose.yaml` truyền sẵn hai biến môi trường với mặc định rỗng để chạy cục bộ luôn an toàn. Có thể đặt cấu hình qua `.env` cục bộ hoặc Docker secret mount; tệp `.env` đã nằm trong `.gitignore` — **không bao giờ** commit cấu hình thật hay secret vào repository.

## Tùy chỉnh gameplay

Một số tệp chính liên quan tới gameplay và cấu hình cục bộ:

- `cau-hinh.json` — hệ số kinh nghiệm, rơi đồ, nội công, luyện kỹ năng và thông số máy chủ.
- `src/game/vocong.js` — xử lý thi triển và sát thương võ công phía client.
- `may-chu/doi-phai.js` — xử lý đổi môn phái phía máy chủ.

## Ghi nhận

Tác giả gốc / credit: **Heo Búy**.
