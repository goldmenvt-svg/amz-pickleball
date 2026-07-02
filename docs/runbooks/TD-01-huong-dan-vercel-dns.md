# Hướng dẫn thủ công: Trỏ domain về Vercel (cho người không chuyên)

> Dành cho TD-01. Mục tiêu: đưa `amzpickleball.vn` chạy trên Vercel, `www` tự chuyển về bản chính.
> Làm theo đúng thứ tự. Mỗi phần có "bấm vào đâu". Phần repo đã xong — đây chỉ là thao tác trên web.
> ⚠️ **KHÔNG xoá file `CNAME` trong giai đoạn này** (sẽ làm sau, khi mọi thứ chạy ổn).

---

## Trước khi bắt đầu — chuẩn bị 3 thứ

1. **Tài khoản Vercel** đăng nhập được, thấy project tên **`website-test`**.
2. **Nơi quản lý tên miền** `amzpickleball.vn` — thường là nơi bạn đã mua tên miền (ví dụ: Mắt Bão, PA Việt Nam, Nhân Hòa, GoDaddy, Cloudflare…). Cần đăng nhập được vào trang quản lý DNS ở đó.
3. **Chọn giờ vắng khách** (buổi tối) để đổi, vì có thể gián đoạn vài phút.

> Mẹo: nên làm trên máy tính, không làm trên điện thoại.

---

## PHẦN A — Thêm domain vào Vercel

1. Vào **https://vercel.com** → đăng nhập.
2. Ở màn hình danh sách project, **bấm vào project `website-test`**.
3. Trên thanh menu ngang phía trên, **bấm tab `Settings`**.
4. Ở cột menu bên trái, **bấm `Domains`**.
5. Thấy ô nhập domain + nút **`Add`** (hoặc `Add Domain`). Gõ:
   ```
   amzpickleball.vn
   ```
   rồi **bấm `Add`**.
6. Vercel có thể hỏi kiểu thêm (Add `amzpickleball.vn` / Add `www.amzpickleball.vn` / Redirect…). **Chọn thêm cả hai** nếu được hỏi; nếu không, lát nữa ta thêm `www` ở bước A8.
7. Sau khi bấm Add, Vercel hiện một bảng **"Invalid Configuration"** (màu vàng/đỏ) kèm **các giá trị DNS bạn cần khai báo**. **ĐỪNG đóng trang này** — ta cần copy giá trị ở PHẦN B.
8. Lặp lại bước 5 nhưng gõ `www.amzpickleball.vn` rồi **`Add`** (nếu chưa thêm ở bước 6).

> Trạng thái "Invalid Configuration" lúc này là **bình thường** — nghĩa là Vercel chờ DNS. Ta sẽ sửa DNS ở PHẦN C.

---

## PHẦN B — Ghi lại giá trị DNS mà Vercel yêu cầu

Trong bảng Vercel vừa hiện (PHẦN A bước 7), bạn sẽ thấy đại loại như sau. **Ghi lại / chụp màn hình** đúng giá trị Vercel hiển thị (giá trị thật lấy từ Vercel, ví dụ dưới đây chỉ để bạn nhận dạng):

| Cho domain | Loại record | Tên/Host | Giá trị (Value) |
|---|---|---|---|
| `amzpickleball.vn` (apex/gốc) | **A** | `@` | `76.76.21.21` *(hoặc IP Vercel hiển thị)* |
| `www.amzpickleball.vn` | **CNAME** | `www` | `cname.vercel-dns.com` *(hoặc giá trị Vercel hiển thị)* |

> Quan trọng: **dùng đúng giá trị Vercel hiển thị trên màn hình của bạn**, không dùng cứng ví dụ ở trên nếu khác.

---

## PHẦN C — Kiểm tra & cập nhật DNS ở nơi quản lý tên miền

1. Mở tab mới, đăng nhập vào **trang quản lý tên miền** `amzpickleball.vn`.
2. Tìm mục **"Quản lý DNS" / "DNS Records" / "DNS Management"** cho tên miền này.
3. **KIỂM TRA trước (đừng vội sửa):** xem các record hiện có. Đặc biệt chú ý:
   - Record **A** cho `@` (gốc) — đang trỏ IP nào?
   - Record **CNAME** cho `www` — đang trỏ đâu?
   - Nếu thấy đang trỏ về GitHub Pages (ví dụ IP `185.199.108.153` / `...109.153` / `...110.153` / `...111.153`, hoặc CNAME tới `goldmenvt-svg.github.io`) → đó là cấu hình cũ cần đổi.
   - **CHỤP MÀN HÌNH toàn bộ DNS hiện tại trước khi sửa** (để khôi phục nếu cần).
4. **Cập nhật record `@` (apex):**
   - Sửa (hoặc tạo) record **A**, Host = `@`, Value = **IP mà Vercel cho ở PHẦN B**.
   - Nếu đang có nhiều record A cũ trỏ GitHub Pages → xoá các IP cũ, chỉ để IP Vercel.
5. **Cập nhật record `www`:**
   - Sửa (hoặc tạo) record **CNAME**, Host = `www`, Value = **giá trị Vercel cho ở PHẦN B** (ví dụ `cname.vercel-dns.com`).
6. **TTL:** nếu có ô TTL, đặt nhỏ (ví dụ `300` giây) để thay đổi áp dụng nhanh.
7. **Lưu** (Save) lại.

> Một số nhà cung cấp dùng chữ khác: "Bản ghi" = record, "Trỏ tới" = value, "Loại" = type. Ý nghĩa giống nhau.
> Nếu nhà cung cấp **không cho tạo CNAME ở gốc** thì không sao — ta chỉ đặt A ở gốc và CNAME ở `www` như trên.

---

## PHẦN D — Quay lại Vercel: chờ xác nhận & đặt domain chính + redirect www

1. Quay lại tab Vercel (`Settings → Domains`). Đợi vài phút rồi **bấm nút `Refresh`** (hoặc tải lại trang).
2. Khi DNS đã đúng, dấu hiệu cạnh domain chuyển thành **"Valid Configuration"** ✅ (màu xanh). (Có thể mất từ vài phút đến vài giờ tuỳ nhà cung cấp.)
3. **Đặt `amzpickleball.vn` làm domain chính:**
   - Tìm `amzpickleball.vn` trong danh sách → nếu có nút/menu **`Set as Primary`** (hoặc dấu `…` → `Set as Primary Domain`) thì **bấm vào đó**.
4. **Đặt `www` chuyển hướng về bản chính:**
   - Tìm `www.amzpickleball.vn` → mở menu (`Edit` hoặc dấu `…`).
   - Chọn **`Redirect to`** và chọn `amzpickleball.vn`, kiểu **`308`/`301` Permanent**.
   - *(Ngay cả khi bạn bỏ qua bước này, file `vercel.json` đã có sẵn quy tắc 301 từ `www` về gốc — nhưng nên đặt ở đây cho chắc.)*

---

## PHẦN E — Gỡ domain ở GitHub Pages (CHỈ làm sau khi PHẦN D xanh)

> Làm bước này để GitHub Pages không còn "tranh" tên miền. **Chưa xanh ở Vercel thì chưa làm.**

1. Vào **https://github.com/goldmenvt-svg/amz-pickleball**.
2. **Bấm tab `Settings`** (của repo).
3. Cột trái, **bấm `Pages`**.
4. Mục **"Custom domain"** nếu đang ghi `amzpickleball.vn` → **xoá nội dung trong ô đó** và **bấm `Save`**.
5. **KHÔNG cần** đụng gì thêm. (File `CNAME` trong repo cứ để nguyên — không xoá lúc này.)

> Vì sao chưa xoá `CNAME`? Để tránh rủi ro nếu cần lùi lại. Khi mọi thứ chạy ổn định vài ngày, ta sẽ xoá sau.

---

## ✅ CHECKLIST NGHIỆM THU (tick từng mục)

### Bước cấu hình
- [ ] Đã thêm `amzpickleball.vn` vào Vercel project `website-test`.
- [ ] Đã thêm `www.amzpickleball.vn` vào Vercel.
- [ ] Đã chụp màn hình DNS cũ trước khi sửa.
- [ ] Đã cập nhật record **A** cho `@` về IP Vercel.
- [ ] Đã cập nhật record **CNAME** cho `www` về giá trị Vercel.
- [ ] Trong Vercel, `amzpickleball.vn` hiển thị **Valid Configuration** (xanh).
- [ ] Trong Vercel, `www.amzpickleball.vn` hiển thị **Valid** và **Redirect → amzpickleball.vn**.
- [ ] Đã đặt `amzpickleball.vn` là **Primary**.
- [ ] Đã gỡ custom domain trong GitHub Pages (sau khi Vercel xanh).
- [ ] File `CNAME` trong repo **vẫn còn** (chưa xoá — đúng yêu cầu).

### Bước kiểm tra trên trình duyệt (ai cũng làm được)
- [ ] Mở `https://amzpickleball.vn` → trang web hiện ra bình thường, có ổ khoá HTTPS.
- [ ] Mở `https://www.amzpickleball.vn` → **tự nhảy về** `https://amzpickleball.vn` (mất chữ `www`).
- [ ] Mở `https://amzpickleball.vn/admin.html` → **hiện hộp đăng nhập** (yêu cầu user/mật khẩu). Đây là dấu hiệu Basic auth còn sống → đúng.
- [ ] Trang chủ hiển thị đúng nội dung mới nhất (bảng xếp hạng, sự kiện…).

### Bước kiểm tra kỹ thuật (tuỳ chọn — nếu bạn muốn chắc chắn 100%)
- [ ] Chạy: `curl -sI https://amzpickleball.vn | grep -i x-vercel-id` → có dòng `x-vercel-id` (đang chạy Vercel).
- [ ] Chạy: `curl -sI https://www.amzpickleball.vn | grep -i location` → thấy `location: https://amzpickleball.vn/` (redirect 301/308).
- [ ] Chạy: `curl -sI https://amzpickleball.vn/admin.html` → dòng đầu là `HTTP/.. 401`.
- [ ] Trên GitHub tab **Actions**: push mới vào `master` **không** tạo run "Deploy to GitHub Pages".

---

## Nếu có trục trặc
- **Vercel mãi không "Valid":** đợi lâu hơn (DNS lan truyền có thể tới vài giờ); kiểm lại đúng IP/CNAME Vercel yêu cầu; đảm bảo đã xoá record A cũ trỏ GitHub Pages.
- **Trang không lên / lỗi:** xem mục Rollback trong `docs/runbooks/TD-01-deploy-consolidation-runbook.md` — **không** tự ý trỏ về GitHub Pages mà chưa khoá `admin.html`.
- **Cần trợ giúp:** chụp màn hình bảng Domains của Vercel + bảng DNS, gửi lại để được hướng dẫn tiếp.

---

*Tham chiếu: `docs/runbooks/TD-01-deploy-consolidation-runbook.md`, `docs/design/DESIGN-deploy-consolidation.md`, `ADR-0001`.*
