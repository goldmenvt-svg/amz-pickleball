# Hướng dẫn commit + push để deploy P0 (TD-01 + TD-02)

> Mục tiêu: đưa các thay đổi code lên `master` để Vercel tự deploy → kích hoạt TD-01 (redirect www, tắt Pages) và TD-02 (kiểm quyền admin API).
> Chọn 1 trong 2 cách. **Cách A (GitHub Desktop)** dễ cho người không chuyên. **Cách B (Git Bash)** nhanh cho ai quen dòng lệnh.
> ⚠️ Push vào `master` sẽ khiến Vercel deploy lên site thật. Nên làm khi rảnh tay để kịp nghiệm thu.

---

## Trước khi push — hiểu sẽ commit gì

Các file sẽ được đưa lên (đã lọc bớt file dev nhờ `.gitignore` vừa cập nhật):

**Code/cấu hình (kích hoạt P0):**
- `vercel.json` — thêm redirect 301 www→apex
- `.github/workflows/deploy.yml` — tắt auto-deploy GitHub Pages (chuyển sang chạy tay)
- `api/push-data.js`, `api/push-videos.js` — thêm kiểm quyền admin
- `firestore.rules` — rule `registrations` mới (đã publish rồi; commit để repo khớp prod)
- `.gitignore` — loại file dev

**Tài liệu (an toàn, chỉ là .md):**
- `CLAUDE.md`, `ARCHITECTURE.md`, `DATABASE.md`, `DEPLOYMENT.md`, `SECURITY.md`, `TECH_DEBT.md`, `SPRINT_PLAN.md`, `MASTER_ROADMAP.md`, và thư mục `docs/`

**Sẽ KHÔNG commit (đã bị .gitignore):** `*.docx`, `test-results/`, `contact-*.png`.

> Lưu ý: có thể thấy `package.json`, `app-nextjs/next-env.d.ts`, `app-nextjs/tsconfig.json` cũng "modified" — đây là thay đổi có sẵn từ trước, không phải của đợt P0. Bạn có thể commit kèm cũng được (vô hại), hoặc bỏ chọn nếu muốn giữ riêng.

---

## CÁCH A — GitHub Desktop (khuyến nghị)

1. Mở **GitHub Desktop**.
2. Góc trên bên trái, mục **Current Repository** → chọn repo **amz-pickleball** (nếu chưa mở, `File → Add local repository…` → trỏ tới `D:\website test`).
3. Cột trái (**Changes**) hiện danh sách file thay đổi, mỗi file có ô tick.
   - Kiểm nhanh: các file kể trên đều có mặt; **KHÔNG** thấy `*.docx`/`test-results/`/`contact-*.png` (nếu vẫn thấy, bỏ tick chúng).
4. Dưới cùng cột trái, ô **Summary**: gõ:
   ```
   P0: TD-01 deploy consolidation + TD-02 admin authz API + TD-03 registrations rule
   ```
5. Bấm nút **Commit to master** (màu xanh).
6. Bấm **Push origin** (nút phía trên bên phải, có mũi tên lên). Chờ chạy xong.
7. Vercel sẽ tự nhận commit và deploy. Xem tiến độ ở Vercel → tab **Deployments** (bản mới → **Ready**).

> Nếu GitHub Desktop hỏi đăng nhập GitHub: đăng nhập bằng tài khoản có quyền push repo `goldmenvt-svg/amz-pickleball`.

---

## CÁCH B — Git Bash (dòng lệnh)

1. Mở **Git Bash**.
2. Chuyển vào thư mục dự án:
   ```bash
   cd "/d/website test"
   ```
3. (Tuỳ chọn) xem thử sẽ commit gì:
   ```bash
   git status
   ```
4. Thêm tất cả thay đổi (đã lọc file dev qua .gitignore):
   ```bash
   git add -A
   ```
5. (Tuỳ chọn) kiểm lại danh sách đã stage — chắc chắn không có `.docx`/`test-results`:
   ```bash
   git status
   ```
6. Commit:
   ```bash
   git commit -m "P0: TD-01 deploy consolidation + TD-02 admin authz API + TD-03 registrations rule"
   ```
7. Push:
   ```bash
   git push origin master
   ```
   Nếu hỏi user/mật khẩu: dùng tài khoản GitHub (mật khẩu là **Personal Access Token**, không phải mật khẩu thường).

---

## Sau khi push — NGHIỆM THU (chờ Vercel "Ready" ~1–2 phút)

Mở Git Bash hoặc PowerShell, chạy:

```bash
# TD-01: www phải 301 về apex
curl -sI https://www.amzpickleball.vn | grep -i location
# kỳ vọng: location: https://amzpickleball.vn/

# TD-01: apex chạy Vercel + có security headers
curl -sI https://amzpickleball.vn | grep -iE "x-vercel-id|strict-transport-security"

# TD-02: gọi API không token → 401 (không phải 404/500)
curl -sI -X POST https://amzpickleball.vn/api/push-data
# kỳ vọng dòng đầu: HTTP/2 401
```

Kiểm thủ công:
- [ ] Đăng nhập admin panel (`amzpickleball.vn/admin.html`, tài khoản `goldmenvt@gmail.com`) → bấm lưu/push dữ liệu → chạy **200** (⇒ `ADMIN_EMAIL` đúng).
- [ ] Vào tab **Actions** trên GitHub: push này **không** tạo lần chạy "Deploy to GitHub Pages".
- [ ] (TD-03) Form đăng ký giải công khai → đăng ký thử → tạo được (pending); admin duyệt/xoá bình thường.

Nếu API trả **500 "ADMIN_EMAIL not set"** → kiểm lại biến `ADMIN_EMAIL` trên Vercel rồi **Redeploy**.

---

## Rollback (nếu có sự cố sau deploy)
- Vercel → **Deployments** → chọn bản trước → **Promote to Production** (đưa site về bản cũ ngay).
- Hoặc hoàn tác commit: trong Git Bash `git revert HEAD` → `git push` (Vercel deploy lại bản đã đảo).
- KHÔNG trỏ domain về GitHub Pages khi chưa khoá `admin.html` (xem `DESIGN-deploy-consolidation.md`).

---

*Tham chiếu: `P0-execution-checklist.md`, `TD-01-*`, `TD-02-*`, `TD-03-*` trong `docs/runbooks/`.*
