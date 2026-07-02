# TECH_DEBT.md — AMZ Pickleball

> Sổ nợ kỹ thuật — đã ưu tiên hoá P0→P3. Cập nhật: 2026-06-30. Vai trò: CTO / Lead Software Architect.
> Quy ước ưu tiên:
> - **P0** — Phải xử lý ngay (bảo mật/chặn vận hành). Không trì hoãn.
> - **P1** — Cao. Trong 1–2 sprint tới. Nợ cấu trúc lõi.
> - **P2** — Trung. Quy trình/chất lượng/bảo trì.
> - **P3** — Thấp. Dọn dẹp khi rảnh.
>
> Tài liệu ghi nhận & lập kế hoạch — KHÔNG sửa code production. Kế hoạch thực thi ở `SPRINT_PLAN.md`, `MASTER_ROADMAP.md`. Thiết kế chi tiết cho thay đổi lớn ở `docs/design/`.

---

## 0. Thang đánh giá (giải thích các cột)

| Cột | Ý nghĩa |
|---|---|
| **Rủi ro** | Xác suất × hậu quả nếu KHÔNG xử lý (Thấp/TB/Cao/Nghiêm trọng) |
| **Ảnh hưởng người dùng** | Người dùng cuối có cảm nhận được không (None / Gián tiếp / Trực tiếp) |
| **Độ phức tạp** | Công sức + độ rủi ro khi triển khai (S/M/L) |
| **Rollback** | Có thể hoàn tác nhanh không (✅ Dễ / ⚠️ Có điều kiện / ❌ Khó) |

---

## 1. Bảng ưu tiên tổng hợp (P0 → P3)

| ID | Khoản nợ | P | Rủi ro | Ảnh hưởng user | Phức tạp | Rollback |
|---|---|---|---|---|---|---|
| **TD-01** | Bỏ pipeline GitHub Pages (chốt 1 host Vercel) | **P0** | 🔴 Nghiêm trọng | Gián tiếp | S | ✅ Dễ |
| **TD-02** | API `push-*` kiểm tra danh tính admin | **P0** | 🔴 Nghiêm trọng | None | S | ✅ Dễ |
| **TD-03** | Siết rule `registrations` (`create: if true`) | **P0** | 🟠 Cao | Gián tiếp | S | ✅ Dễ |
| **TD-04** | Hoàn thiện `firestore.rules` + khớp schema/code | **P1** | 🟠 Cao | Trực tiếp | M | ⚠️ Có điều kiện |
| **TD-05** | Quyết định số phận `app-nextjs` (deploy/gộp/đóng băng) | **P1** | 🟡 TB | Trực tiếp | M–L | ⚠️ Có điều kiện |
| **TD-06** | Chốt 1 nguồn sự thật cho `players`/`events` | **P1** | 🟠 Cao | Trực tiếp | L | ⚠️ Có điều kiện |
| **TD-07** | Đưa deploy Firestore rules vào CI (bỏ thủ công) | **P2** | 🟡 TB | None | S | ✅ Dễ |
| **TD-08** | Thêm test/lint/build vào CI | **P2** | 🟡 TB | Gián tiếp | M | ✅ Dễ |
| **TD-09** | Migrate `settings/adminData` blob → collection riêng | **P2** | 🟡 TB | Gián tiếp | M | ⚠️ Có điều kiện |
| **TD-10** | Hợp nhất 2 đường ghi `videos.json` (admin + cron) | **P2** | 🟡 TB | Gián tiếp | S | ✅ Dễ |
| **TD-11** | Thu hẹp scope + xoay vòng `GITHUB_TOKEN` | **P2** | 🟡 TB | None | S | ✅ Dễ |
| **TD-12** | Điền thông tin doanh nghiệp (email, social, loại sân) | **P2** | 🟢 Thấp | Trực tiếp | S | ✅ Dễ |
| **TD-13** | Tách JS/CSS khỏi monolith `index.html`/`admin.html` | **P2** | 🟡 TB | None | L | ⚠️ Có điều kiện |
| **TD-14** | Dọn file dev khỏi repo (docx, png, test-results) | **P3** | 🟢 Thấp | None | S | ✅ Dễ |
| **TD-15** | Thống nhất Admin SDK vs REST verify (bỏ biến thừa) | **P3** | 🟢 Thấp | None | S | ✅ Dễ |

> Ghi chú: TD-01/02/03 đều là thay đổi nhỏ nhưng tác động bảo mật lớn → P0. TD-04/05/06 là nợ **cấu trúc lõi**, công sức lớn hơn, làm sau khi P0 ổn định.

---

## 2. Đánh giá chi tiết từng mục

### TD-01 — Bỏ pipeline GitHub Pages · P0
- **Rủi ro:** 🔴 Nghiêm trọng. Pages không chạy `middleware.js`/`api/`/headers; nếu domain trỏ Pages, `admin.html` lộ public, mất CSP/HSTS.
- **Ảnh hưởng người dùng:** Gián tiếp (an toàn dữ liệu, không thấy trực tiếp).
- **Độ phức tạp:** S — vô hiệu hoá `deploy.yml`, gỡ `CNAME`, cấu hình domain trong Vercel.
- **Rollback:** ✅ Khôi phục file từ git nếu cần.
- **Thiết kế bắt buộc:** `docs/design/DESIGN-deploy-consolidation.md`.

### TD-02 — API `push-*` kiểm tra admin · P0
- **Rủi ro:** 🔴 Nghiêm trọng. Hiện chỉ verify token hợp lệ → bất kỳ user Firebase nào cũng ghi được `data/*.json` lên repo (SECURITY #1).
- **Ảnh hưởng người dùng:** None trực tiếp; gián tiếp nếu bị defacement.
- **Độ phức tạp:** S — thêm kiểm `email === admin` (hoặc custom claim) sau `accounts:lookup`.
- **Rollback:** ✅ Dễ (đảo commit; logic cộng thêm, không phá luồng cũ).
- **Thiết kế bắt buộc:** `docs/design/DESIGN-admin-auth.md`.

### TD-03 — Siết `registrations` create · P0
- **Rủi ro:** 🟠 Cao. `create: if true` → ghi rác không cần đăng nhập (SECURITY #3).
- **Ảnh hưởng người dùng:** Gián tiếp (spam làm hỏng dữ liệu đăng ký giải).
- **Độ phức tạp:** S — yêu cầu `request.auth != null` + validate field.
- **Rollback:** ✅ Dễ (đổi lại rule).
- **Thiết kế bắt buộc:** `docs/design/DESIGN-firestore-rules.md`.

### TD-04 — Hoàn thiện `firestore.rules` · P1
- **Rủi ro:** 🟠 Cao. Thiếu rule `courts/bookings/payments/members/users/elo_history` → app-nextjs bị chặn; nguy cơ thêm rule lỏng khi vội.
- **Ảnh hưởng người dùng:** Trực tiếp (đặt sân/hội viên không chạy được khi app lên production).
- **Độ phức tạp:** M — viết least-privilege từng collection, append-only cho audit, test emulator.
- **Rollback:** ⚠️ Có điều kiện — rules deploy thay thế bản cũ; phải lưu bản trước để khôi phục.
- **Thiết kế bắt buộc:** `docs/design/DESIGN-firestore-rules.md`.

### TD-05 — Số phận `app-nextjs` · P1
- **Rủi ro:** 🟡 TB. Để treo gây lệch khỏi site tĩnh, tốn công bảo trì, không tạo giá trị.
- **Ảnh hưởng người dùng:** Trực tiếp (tính năng đặt sân/giải đấu hoặc lên hoặc bỏ).
- **Độ phức tạp:** M–L tuỳ quyết định (deploy subdomain / gộp / đóng băng).
- **Rollback:** ⚠️ Có điều kiện (nếu deploy mới, có thể gỡ; nếu gộp code thì khó hơn).
- **Quyết định:** ghi vào `docs/adr/ADR-0004-app-nextjs-fate.md`.

### TD-06 — Một nguồn sự thật `players`/`events` · P1
- **Rủi ro:** 🟠 Cao. Hai nguồn ghi shape lệch → số liệu bảng xếp hạng mâu thuẫn giữa site tĩnh và app.
- **Ảnh hưởng người dùng:** Trực tiếp (thấy số liệu khác nhau).
- **Độ phức tạp:** L — thống nhất shape, sinh JSON snapshot một chiều từ Firestore.
- **Rollback:** ⚠️ Có điều kiện (migration dữ liệu; cần backup).
- **Quyết định:** `docs/adr/ADR-0002-firestore-single-source-of-truth.md`.

### TD-07 — Rules deploy vào CI · P2
- **Rủi ro:** 🟡 TB. Deploy thủ công → repo lệch prod.
- **Ảnh hưởng người dùng:** None.
- **Độ phức tạp:** S — workflow chạy `firebase deploy --only firestore:rules` có phê duyệt.
- **Rollback:** ✅ Dễ.

### TD-08 — Test/lint/build trong CI · P2
- **Rủi ro:** 🟡 TB. Không gate chất lượng; `test = exit 1`.
- **Ảnh hưởng người dùng:** Gián tiếp.
- **Độ phức tạp:** M.
- **Rollback:** ✅ Dễ.

### TD-09 — Migrate `settings/adminData` blob · P2
- **Rủi ro:** 🟡 TB. Blob tạm chứa players[]/tournaments[]/registrations[]/history[].
- **Ảnh hưởng người dùng:** Gián tiếp.
- **Độ phức tạp:** M.
- **Rollback:** ⚠️ Có điều kiện (cần backup, migration script idempotent).

### TD-10 — Hợp nhất ghi `videos.json` · P2
- **Rủi ro:** 🟡 TB. Admin push và cron `sync-youtube.yml` cùng ghi → ghi đè.
- **Ảnh hưởng người dùng:** Gián tiếp (video hiển thị sai/biến mất).
- **Độ phức tạp:** S.
- **Rollback:** ✅ Dễ.

### TD-11 — Thu hẹp `GITHUB_TOKEN` · P2
- **Rủi ro:** 🟡 TB. PAT scope rộng; nếu lộ, ghi toàn repo.
- **Ảnh hưởng người dùng:** None.
- **Độ phức tạp:** S — fine-grained token Contents:write, lịch xoay vòng.
- **Rollback:** ✅ Dễ.

### TD-12 — Thông tin doanh nghiệp · P2
- **Rủi ro:** 🟢 Thấp. Email/social/loại sân còn trống → SEO/structured data thiếu.
- **Ảnh hưởng người dùng:** Trực tiếp (thiếu thông tin liên hệ).
- **Độ phức tạp:** S.
- **Rollback:** ✅ Dễ.

### TD-13 — Tách JS/CSS khỏi monolith · P2
- **Rủi ro:** 🟡 TB. `index.html` 199KB/`admin.html` 153KB; khó bảo trì, buộc CSP `'unsafe-inline'`.
- **Ảnh hưởng người dùng:** None (nếu làm đúng).
- **Độ phức tạp:** L — làm dần, không đập đi xây lại.
- **Rollback:** ⚠️ Có điều kiện.

### TD-14 — Dọn file dev · P3
- **Rủi ro:** 🟢 Thấp. Nhiễu repo, nguy cơ commit nhầm nội dung nhạy cảm.
- **Ảnh hưởng người dùng:** None.
- **Độ phức tạp:** S — mở rộng `.gitignore`, `git rm --cached`.
- **Rollback:** ✅ Dễ.

### TD-15 — Admin SDK vs REST · P3
- **Rủi ro:** 🟢 Thấp. `.env.local.example` khai báo `FIREBASE_ADMIN_SERVICE_ACCOUNT_KEY` nhưng chưa dùng.
- **Ảnh hưởng người dùng:** None.
- **Độ phức tạp:** S (gắn với TD-02 nếu chuyển sang `verifyIdToken`).
- **Rollback:** ✅ Dễ.

---

## 3. Quy tắc "gate" cho thay đổi lớn

Mọi mục đụng **Deploy (TD-01)**, **Firestore (TD-03/04/06/09)**, **Auth (TD-02)** chỉ được triển khai **sau khi** có đủ 4 thứ trong design doc tương ứng (`docs/design/`):
1. Tài liệu thiết kế
2. Kế hoạch migration
3. Kế hoạch rollback
4. Tiêu chí nghiệm thu (acceptance criteria)

→ Xem `docs/design/DESIGN-deploy-consolidation.md`, `DESIGN-admin-auth.md`, `DESIGN-firestore-rules.md`.

## 4. Tham chiếu
- Kế hoạch sprint → `SPRINT_PLAN.md`
- Roadmap 12 tháng → `MASTER_ROADMAP.md`
- Quyết định kiến trúc → `docs/adr/`
- Quan hệ dữ liệu → `ERD.md`, `DATABASE.md`
- Ranh giới module → `MODULE_BOUNDARY.md`
- API → `API_DESIGN.md` · Versioning DB → `DATABASE_VERSIONING.md` · Giám sát → `MONITORING.md`
