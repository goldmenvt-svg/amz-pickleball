# Hướng dẫn Setup Airtable — Quản lý VĐV & Giải đấu AMZ Pickleball

## Bước 1: Tạo tài khoản Airtable (miễn phí)

1. Vào **https://airtable.com/signup**
2. Đăng ký bằng email `goldmenvt@gmail.com`
3. Chọn plan **Free** (miễn phí tới 1,000 records)

---

## Bước 2: Tạo Base mới

1. Click **"+ Add a base"**
2. Đặt tên: **"AMZ Pickleball — Quản lý VĐV"**

---

## Bước 3: Tạo 4 bảng (Tables)

### Bảng 1: VẬN ĐỘNG VIÊN

| Tên cột | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| Họ tên | Single line text | Primary field |
| SĐT | Phone number | |
| Email | Email | |
| Trình hiện tại | Number (1 decimal) | VD: 3.5 |
| Hạng trình | Single select | Mới (2.0-2.5) / Trung bình (3.0-3.5) / Khá (4.0-4.5) / Nâng cao (5.0+) |
| Ngày cập nhật trình | Date | |
| Ghi chú | Long text | VD: Forehand mạnh, cần cải thiện dink |
| Đăng ký giải | Link to "ĐĂNG KÝ GIẢI" | Cho phép link nhiều records |
| Lịch sử trình | Link to "LỊCH SỬ TRÌNH ĐỘ" | |

### Bảng 2: GIẢI ĐẤU

| Tên cột | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| Tên giải | Single line text | Primary field |
| Ngày thi đấu | Date | |
| Loại giải | Single select | Nội bộ / Liên CLB / Mở rộng |
| Hạng trình cho phép | Multiple select | 2.0-2.5 / 3.0-3.5 / 4.0-4.5 / 5.0+ |
| Trạng thái | Single select | Mở đăng ký / Đã đóng đăng ký / Đang diễn ra / Đã kết thúc |
| Số đội tối đa | Number | |
| Giải thưởng | Single line text | VD: 10 triệu |
| DS đăng ký | Link to "ĐĂNG KÝ GIẢI" | |
| Ghi chú | Long text | |

### Bảng 3: ĐĂNG KÝ GIẢI (bảng trung gian)

| Tên cột | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| ID đăng ký | Auto number | Tự tăng |
| Vận động viên | Link to "VẬN ĐỘNG VIÊN" | |
| Giải đấu | Link to "GIẢI ĐẤU" | |
| Trình khai báo | Number (1 decimal) | VD: 3.5 |
| Hạng thi đấu | Single select | Đơn nam / Đơn nữ / Đôi nam / Đôi nữ / Đôi nam nữ |
| Đồng đội | Link to "VẬN ĐỘNG VIÊN" | Chỉ cần khi đánh đôi |
| Ngày đăng ký | Created time | Tự động |
| Trạng thái | Single select | Chờ duyệt / Đã duyệt / Từ chối / Đã thi đấu |
| Kết quả | Single select | Vô địch / Á quân / Hạng 3 / Top 8 / Tham gia |
| Trình sau giải | Number (1 decimal) | Admin nhập sau khi giải kết thúc |

### Bảng 4: LỊCH SỬ TRÌNH ĐỘ

| Tên cột | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| Vận động viên | Link to "VẬN ĐỘNG VIÊN" | |
| Ngày thay đổi | Date | |
| Trình cũ | Number (1 decimal) | |
| Trình mới | Number (1 decimal) | |
| Chênh lệch | Formula | `{Trình mới} - {Trình cũ}` |
| Lý do | Single select | Kết quả giải / HLV đánh giá / Tự khai báo / Admin điều chỉnh |
| Giải liên quan | Link to "GIẢI ĐẤU" | Nếu thay đổi do kết quả giải |
| Người cập nhật | Single line text | |

---

## Bước 4: Tạo Views hữu ích

### Trong bảng VẬN ĐỘNG VIÊN:
- **Grid view** (mặc định) — xem tất cả
- **Theo trình độ** — Group by "Hạng trình"
- **VĐV mới** — Filter: "Ngày cập nhật trình" is within past 30 days

### Trong bảng GIẢI ĐẤU:
- **Sắp diễn ra** — Filter: "Trạng thái" = "Mở đăng ký" hoặc "Đang diễn ra"
- **Lịch sử giải** — Sort by "Ngày thi đấu" descending

### Trong bảng ĐĂNG KÝ GIẢI:
- **Chờ duyệt** — Filter: "Trạng thái" = "Chờ duyệt"
- **Theo giải** — Group by "Giải đấu"
- **Kanban view** — Group by "Trạng thái" (kéo thả dễ dàng)

---

## Bước 5: Kết nối Formspree → Airtable (tự động)

### Cách 1: Dùng Zapier (dễ nhất)

1. Vào **https://zapier.com** → tạo tài khoản miễn phí
2. Click **"Create Zap"**
3. **Trigger:** Formspree → New Submission
4. **Action:** Airtable → Create Record in "VẬN ĐỘNG VIÊN"
5. Map các fields:
   - `name` → Họ tên
   - `phone` → SĐT
   - `email` → Email
   - `level` → Trình hiện tại (dùng Formatter để extract số)
   - `type` → ghi vào Ghi chú (loại yêu cầu)
6. Turn on Zap

### Cách 2: Dùng Make.com (linh hoạt hơn)

1. Vào **https://make.com** → tạo tài khoản
2. Tạo Scenario: Formspree webhook → Airtable
3. Thêm Router để phân luồng:
   - Nếu `type` = "dang-ky-giai" → tạo record ở cả VẬN ĐỘNG VIÊN + ĐĂNG KÝ GIẢI
   - Nếu `type` khác → chỉ tạo ở VẬN ĐỘNG VIÊN

---

## Bước 6: Quy trình cập nhật trình sau giải

1. Giải kết thúc → vào bảng **ĐĂNG KÝ GIẢI**
2. Nhập **Kết quả** cho từng VĐV
3. Nhập **Trình sau giải** (nếu thay đổi)
4. Vào bảng **LỊCH SỬ TRÌNH ĐỘ** → tạo record mới cho mỗi VĐV có thay đổi trình
5. Cập nhật **Trình hiện tại** trong bảng VẬN ĐỘNG VIÊN

> Mẹo: Dùng Airtable Automations (miễn phí) để tự động:
> - Khi "Trình sau giải" được nhập → tự tạo record trong LỊCH SỬ TRÌNH ĐỘ
> - Khi LỊCH SỬ mới được tạo → tự cập nhật "Trình hiện tại" của VĐV

---

## Tóm tắt chi phí

| Dịch vụ | Chi phí | Giới hạn |
|---|---|---|
| Airtable Free | $0 | 1,000 records / base |
| Zapier Free | $0 | 100 tasks / tháng |
| Formspree Free | $0 | 50 submissions / tháng |
| **Tổng** | **$0** | Đủ cho CLB < 500 VĐV |

Khi vượt 1,000 records → nâng Airtable lên Team ($20/tháng) hoặc chuyển sang Notion (miễn phí không giới hạn).
