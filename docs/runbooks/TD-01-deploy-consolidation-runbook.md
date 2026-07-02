# Runbook — TD-01 Hợp nhất Deploy về Vercel

> Trạng thái: Design doc **Approved** (kèm 3 điều chỉnh). Ngày: 2026-06-30.
> Phạm vi: CHỈ cấu hình deploy. Không sửa `index.html`/`admin.html`, không refactor code, không đụng DB.
> Tham chiếu: `docs/design/DESIGN-deploy-consolidation.md`, `ADR-0001`.

## Điều chỉnh đã duyệt (bắt buộc tuân thủ)
1. **Rollback KHÔNG mặc định trỏ lại GitHub Pages** (Pages không chạy middleware/API/headers). Nếu buộc phải rollback về Pages → **khoá/ẩn `admin.html` trước**.
2. **Không xoá `deploy.yml`** — vô hiệu hoá an toàn bằng `workflow_dispatch` (hoặc đổi tên `.disabled`).
3. **`amzpickleball.vn` là domain chính**; `www.amzpickleball.vn` **301** về apex.

---

## 1. Checklist PREFLIGHT (làm TRƯỚC khi sửa)

### A. Xác minh hiện trạng
- [ ] Xác định DNS hiện tại của `amzpickleball.vn` đang trỏ Vercel hay GitHub Pages (`dig +short amzpickleball.vn`, `dig +short www.amzpickleball.vn`).
- [ ] Xác định site production hiện đang phục vụ bởi đâu (`curl -sI https://amzpickleball.vn | grep -i 'server\|x-vercel-id'`).
- [ ] Ghi lại bản ghi DNS hiện tại (A/AAAA/CNAME) để rollback.
- [ ] Chụp màn hình cấu hình domain trong Vercel project `website-test` và trong GitHub Pages settings.

### B. Xác minh điều kiện an toàn
- [ ] Vercel env đã có `ADMIN_USER` + `ADMIN_PASSWORD_HASH` (Basic auth admin sẽ hoạt động sau cutover).
- [ ] Vercel env đã có `FIREBASE_API_KEY` + `GITHUB_TOKEN` (api/push-* hoạt động).
- [ ] Có quyền sửa DNS của domain `amzpickleball.vn`.
- [ ] Hạ TTL DNS xuống 300s trước cutover ≥ 1 giờ (lý tưởng 24h).

### C. Xác minh backup/rollback sẵn sàng
- [ ] Biết commit SHA hiện tại để `git revert` nếu cần.
- [ ] Hiểu quy tắc rollback điều chỉnh #1 (không mặc định về Pages; nếu buộc → khoá admin.html trước).
- [ ] Chọn khung giờ thấp điểm (đêm VN) để đổi DNS.

> ✅ Chỉ tiến hành sửa repo khi A/B/C đã tick xong. Phần sửa repo (mục 2) an toàn kể cả khi DNS chưa đổi, vì chỉ tắt auto-deploy Pages và thêm redirect (Vercel bỏ qua khi domain chưa gắn).

---

## 2. Thay đổi repo (đã thực hiện trong TD-01)
1. `.github/workflows/deploy.yml`: trigger `push` → **`workflow_dispatch`** (chỉ chạy thủ công). File giữ nguyên, không xoá.
2. `vercel.json`: thêm khối `redirects` → `www.amzpickleball.vn/*` **301** → `https://amzpickleball.vn/*`.
3. `CNAME`: **giữ nguyên** (vô hại trên Vercel). Chỉ xoá **thủ công sau khi** xác nhận DNS đã trỏ Vercel ổn định (tránh phá binding Pages giữa chừng).

---

## 3. Thao tác thủ công (Vercel/DNS — ngoài repo)
1. Vercel → Project `website-test` → Settings → Domains: thêm `amzpickleball.vn` (Primary) và `www.amzpickleball.vn`.
2. Đặt `www` → Redirect to `amzpickleball.vn` (301) nếu dùng cơ chế domain-level (song song redirect trong `vercel.json`).
3. Cập nhật DNS theo hướng dẫn Vercel (apex A/ALIAS + www CNAME).
4. Chờ propagate; chạy nghiệm thu (mục 4).
5. Trong GitHub → Settings → Pages: gỡ custom domain (sau khi DNS đã sang Vercel).
6. (Tuỳ chọn, sau khi ổn định) xoá `CNAME` khỏi repo.

---

## 4. Lệnh nghiệm thu
```bash
# Phục vụ bởi Vercel?
curl -sI https://amzpickleball.vn | grep -i 'x-vercel-id'

# www 301 về apex?
curl -sI https://www.amzpickleball.vn | grep -iE 'HTTP/|location'
# kỳ vọng: HTTP/2 301 ... location: https://amzpickleball.vn/

# Basic auth admin còn sống? (kỳ vọng 401)
curl -sI https://amzpickleball.vn/admin.html | grep -i 'HTTP/'

# Security headers hiện diện?
curl -sI https://amzpickleball.vn | grep -iE 'content-security-policy|strict-transport-security|x-frame-options'

# Serverless còn sống? (kỳ vọng 401 do thiếu token, KHÔNG phải 404)
curl -sI -X POST https://amzpickleball.vn/api/push-data | grep -i 'HTTP/'

# Pages không còn auto-deploy: kiểm tab Actions không có run "Deploy to GitHub Pages" mới khi push
```

---

## 5. Rollback (theo điều chỉnh #1)
**Mặc định: rollback trong phạm vi Vercel + DNS, KHÔNG quay về Pages.**

| Tình huống | Hành động |
|---|---|
| Site lỗi sau đổi DNS | Trỏ DNS về **deployment Vercel trước đó** (Vercel → Deployments → Promote bản cũ); KHÔNG trỏ Pages |
| Cần hoàn tác thay đổi repo | `git revert <sha>` (khôi phục `on: push` cho deploy.yml + bỏ redirect) |
| **Bắt buộc** phải về GitHub Pages | **TRƯỚC TIÊN khoá/ẩn `admin.html`** (xoá/đổi tên admin.html khỏi nội dung Pages, hoặc chặn ở tầng DNS/host) vì Pages KHÔNG có Basic auth; chỉ sau đó mới trỏ DNS về Pages |

RTO mục tiêu < 30 phút. Ghi rõ: rollback về Pages là phương án cuối, kèm điều kiện khoá admin.

---

## 6. Định nghĩa hoàn thành (DoD)
- [ ] `deploy.yml` không còn auto-deploy trên push (chỉ workflow_dispatch).
- [ ] `vercel.json` có redirect 301 www→apex hợp lệ.
- [ ] Tất cả lệnh nghiệm thu mục 4 cho kết quả kỳ vọng (sau khi hoàn tất thao tác thủ công).
- [ ] Rollback plan tuân thủ điều chỉnh #1.
