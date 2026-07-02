# P0 — Checklist thực thi thủ công & nghiệm thu (TD-01 + TD-02 + TD-03)

> Làm theo ĐÚNG THỨ TỰ. Tick từng ô. Phần code/config đã sửa xong trong repo — đây là các bước bạn thao tác trên Vercel/Firebase/DNS + kiểm tra.
> Chi tiết từng phần: `TD-01-*`, `TD-02-*`, `TD-03-*` trong `docs/runbooks/`.
>
> **3 nguyên tắc thứ tự an toàn:**
> 1. Thêm `ADMIN_EMAIL` trên Vercel **TRƯỚC** khi deploy code API (nếu không, API trả 500 — chặn an toàn nhưng admin không push được).
> 2. Chạy emulator test **TRƯỚC** khi deploy Firestore rules.
> 3. Vercel phải "Valid/xanh" **TRƯỚC** khi gỡ domain ở GitHub Pages. **Chưa xoá file `CNAME`.**

---

## GIAI ĐOẠN 0 — Chuẩn bị biến môi trường (trước khi push code)

- [ ] Vercel → project `website-test` → **Settings → Environment Variables → Add**:
      `ADMIN_EMAIL` = `goldmenvt@gmail.com` (chọn cả **Production** và **Preview**). *(TD-02)*
- [ ] Xác nhận đã có sẵn: `FIREBASE_API_KEY`, `GITHUB_TOKEN`, `ADMIN_USER`, `ADMIN_PASSWORD_HASH`.
- [ ] *(Khuyến nghị bảo mật)* Firebase Console → Authentication → Sign-in method: **tắt tự đăng ký công khai** nếu chỉ admin dùng.

## GIAI ĐOẠN 1 — Đưa thay đổi code lên (TD-01 repo + TD-02)

- [ ] `git add -A && git commit -m "P0: deploy consolidation (TD-01) + admin authz API (TD-02) + registrations rule (TD-03)"`
- [ ] `git push origin master` → Vercel tự động deploy.
- [ ] Kiểm Vercel → Deployments: bản mới **Ready** (không lỗi build).

## GIAI ĐOẠN 2 — Firestore rules (TD-03)

- [ ] Chạy emulator test (theo `TD-03-registrations-rule-runbook.md` mục 1–2): tất cả case **xanh**.
- [ ] `firebase deploy --only firestore:rules`.

## GIAI ĐOẠN 3 — Domain & DNS (TD-01)

> Theo hướng dẫn chi tiết `TD-01-huong-dan-vercel-dns.md`.

- [ ] Vercel → Settings → Domains: thêm `amzpickleball.vn` (Primary) + `www.amzpickleball.vn`.
- [ ] Đặt `www` → Redirect 301 về `amzpickleball.vn`.
- [ ] Cập nhật DNS: record **A** cho `@` = IP Vercel; **CNAME** cho `www` = giá trị Vercel. TTL 300.
- [ ] Chờ Vercel hiển thị **Valid Configuration** (xanh) cho cả hai.
- [ ] Sau khi xanh: GitHub repo → Settings → Pages → **xoá custom domain** → Save.
- [ ] File `CNAME` trong repo **vẫn còn** (chưa xoá — đúng chủ trương).

---

## ✅ NGHIỆM THU (chạy sau khi hoàn tất 3 giai đoạn)

### TD-01 — Deploy hợp nhất
- [ ] `curl -sI https://amzpickleball.vn | grep -i x-vercel-id` → có `x-vercel-id` (đang chạy Vercel).
- [ ] `curl -sI https://www.amzpickleball.vn | grep -i location` → `location: https://amzpickleball.vn/` (301/308).
- [ ] `curl -sI https://amzpickleball.vn | grep -iE 'content-security-policy|strict-transport-security'` → có headers.
- [ ] Push thử 1 commit vào `master` → tab **Actions** KHÔNG có run "Deploy to GitHub Pages" mới.

### TD-02 — Kiểm quyền admin API
- [ ] `curl -sI -X POST https://amzpickleball.vn/api/push-data` → dòng đầu `HTTP/.. 401` (không token).
- [ ] Gọi với ID token tài khoản **không phải admin** → **403** (xem lệnh trong `TD-02-*` runbook mục 3).
- [ ] Đăng nhập admin panel (`goldmenvt@gmail.com`) → bấm lưu/push → chạy **200**, dữ liệu cập nhật.

### TD-03 — Rule registrations
- [ ] Vào form đăng ký giải công khai → điền + gửi → **tạo thành công** (đăng ký ở trạng thái pending).
- [ ] Admin panel → xem/duyệt/xoá đăng ký → hoạt động bình thường.
- [ ] (Nếu muốn chắc) thử tạo registration với `status:'confirmed'` từ client công khai → **bị từ chối**.

---

## Nếu có trục trặc → Rollback nhanh
| Phần | Rollback |
|---|---|
| TD-01 | Vercel → Deployments → **Promote** bản trước; KHÔNG trỏ về Pages trừ khi đã khoá `admin.html` |
| TD-02 | `git revert` commit → push (logic cũ chạy lại) |
| TD-03 | `git checkout <sha> -- firestore.rules` → `firebase deploy --only firestore:rules` |

> Sau khi tick xong hết mục Nghiệm thu, báo lại (hoặc dán kết quả `curl`) — mình sẽ xác nhận P0 hoàn tất và mở sang P1.
