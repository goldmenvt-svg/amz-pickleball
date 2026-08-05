# SPRINT_PLAN.md — AMZ Pickleball

> Kế hoạch triển khai theo sprint 2 tuần. Cập nhật trạng thái: 2026-08-04 (R25.08B). Vai trò: CTO / Lead Architect.
> Dựa trên `TECH_DEBT.md` (P0→P3). Thay đổi lớn phải qua gate ở `docs/design/`.
> Giả định năng lực: nhóm nhỏ (1–2 dev). Sprint = 2 tuần. Mỗi sprint dành ~20% cho buffer/sự cố.

---

## 0. Bảng điều khiển thực hiện

Quy ước: ✅ hoàn thành có bằng chứng · 🟡 một phần/đang chờ · ⬜ chưa làm · ❓ cần Owner xác minh ngoài repository.

| Sprint | Task | Trạng thái 2026-08-04 | Ghi chú kiểm toán |
|---|---|---:|---|
| S1 | TD-01 — hợp nhất Production về Vercel | ✅ | Code và hồ sơ triển khai P0 đã có; workflow Pages không tự chạy |
| S1 | TD-02 — kiểm quyền admin `api/push-*` giai đoạn A | ✅ | REST lookup + kiểm admin đã triển khai; Admin SDK/custom claim vẫn thuộc TD-15 |
| S1 | TD-03 — siết `registrations` | ✅ | Rule hiện không còn `create: if true` |
| S1 | Tắt self-signup + alert | ❓ | Cấu hình ngoài repository, chưa có bằng chứng hiện hành |
| S2 | TD-04 — rules đầy đủ + emulator test | 🟡 | Có rules cho collection chính và append-only; chưa chứng minh ma trận emulator đầy đủ |
| S2 | Scheduled backup | ❓ | Chưa có bằng chứng cấu hình/runs |
| S2 | ADR-0004 — số phận app-nextjs | ✅ | Accepted ngày 2026-07-02: preview/private trước, chưa public |
| S3 | TD-06 — một nguồn sự thật | 🟡 | TD-06A và thiết kế TD-06B đã được chấp nhận; runtime/migration chưa triển khai |
| S4 | TD-07 — deploy rules qua CI | ⬜ | Chưa có workflow được phê duyệt |
| S4 | TD-08 — test/lint/build CI | 🟡 | Có test chuyên biệt cho video; CI chung và root `npm test` chưa đạt |
| S4 | TD-10 — hợp nhất đường ghi `videos.json` | 🟡 | Đã có concurrency + test an toàn; hai workflow vẫn cùng có quyền ghi |
| S4 | TD-11 — token tối thiểu/xoay vòng | ❓ | Cần Owner kiểm tra GitHub Settings; không thể kết luận từ repo |
| S4 | R25.08A — Node.js 24 | 🟡 | Source-control hoàn tất; chờ run sau `bd229f2` để đóng |

### Cây công việc đang điều hành

```text
AMZ 2026
├── R25.06 B–E3                 ✅ Đã đóng
├── R25.07B mobile              ✅ Đã đóng
├── R25.08A Actions Node.js 24  🟡 Chờ run hậu triển khai
└── R25.08B tài liệu quản trị   🟡 Đang thực hiện
    └── Kế tiếp: TD-06          ⬜ Chưa mở triển khai
```

---

## 1. Nhịp & nghi thức (cadence)

| Nghi thức | Thời điểm | Mục đích |
|---|---|---|
| Sprint Planning | Thứ 2 đầu sprint | Chốt scope, gắn task vào TD-XX |
| Daily check (async) | Mỗi ngày | Cập nhật trạng thái, gỡ blocker |
| Design Gate Review | Trước khi code thay đổi lớn | Duyệt 4 mục (thiết kế/migration/rollback/nghiệm thu) |
| Sprint Review + Retro | Thứ 6 cuối sprint | Nghiệm thu theo acceptance criteria; rút kinh nghiệm |

### Definition of Done (DoD) chung
- [ ] Đạt acceptance criteria của task/design doc.
- [ ] Thay đổi lớn: đã qua Design Gate, có kế hoạch rollback đã kiểm chứng.
- [ ] Không hạ cấp bảo mật (không thêm `if true`, không lộ secret).
- [ ] Tài liệu liên quan đã cập nhật (`DATABASE.md`/`DEPLOYMENT.md`/ADR…).
- [ ] Rollback được xác nhận khả thi trước khi lên production.

---

## 2. Sprint 1 — "Khoá lỗ hổng" (P0)  ·  2026-07-01 → 2026-07-14

**Mục tiêu sprint:** đóng toàn bộ rủi ro bảo mật P0 và bật cảnh báo cơ bản. Không động tới dữ liệu.

| Task | TD | Loại | Gate cần | Nghiệm thu |
|---|---|---|---|---|
| Duyệt 3 design doc P0 | — | Gate | — | 3 doc trong `docs/design/` được approve |
| Hợp nhất deploy về Vercel, gỡ Pages + CNAME | TD-01 | Deploy 🔒 | DESIGN-deploy-consolidation | AC trong design doc xanh |
| Thêm kiểm admin trong `api/push-*` (Phương án A) | TD-02 | Auth 🔒 | DESIGN-admin-auth | token non-admin → 403 |
| Siết rule `registrations` (cần đăng nhập + validate) | TD-03 | Firestore 🔒 | DESIGN-firestore-rules | create ẩn danh bị từ chối (emulator) |
| Tắt self-signup Firebase (nếu chỉ admin dùng) | TD-02 | Config | — | đăng ký mới bị chặn |
| Bật alert: Firebase Auth signup + GitHub Actions fail | — | Monitoring | — | nhận được alert thử nghiệm |

**Thứ tự an toàn:** design gate → TD-02 + TD-03 (vá API/rules) → TD-01 (đổi host) cuối, trong giờ thấp điểm.
**Rủi ro sprint:** đổi DNS (TD-01) — đã có rollback DNS. **Capacity:** vừa với 2 tuần vì các task đều size S.

**Sprint 1 Definition of Success:** SECURITY #1, #2, #3 chuyển sang "đã khắc phục"; site + admin + api hoạt động đúng trên Vercel.

---

## 3. Sprint 2 — "Nền móng dữ liệu" (P1)  ·  2026-07-15 → 2026-07-28

**Mục tiêu:** hoàn thiện rules cho mọi collection + chuẩn bị nguồn-sự-thật + quyết app-nextjs.

| Task | TD | Gate | Nghiệm thu |
|---|---|---|---|
| Hoàn thiện `firestore.rules` (courts/bookings/payments/members/users/elo_history) | TD-04 | DESIGN-firestore-rules | emulator test toàn bộ vai trò xanh |
| Append-only cho `payments`/`elo_history` | TD-04 | ↑ | update/delete bị cấm |
| Bật Firestore scheduled export (backup) | — | — | export hằng ngày chạy |
| Quyết định ADR-0004 (app-nextjs) | TD-05 | ADR | ADR chuyển Accepted |
| Cập nhật `firestore-schema.md` khớp `registrations` top-level | TD-04 | — | schema khớp code |

---

## 4. Sprint 3 — "Một nguồn sự thật"  ·  2026-07-29 → 2026-08-11

**Mục tiêu:** chuẩn hoá `players` + chốt luồng snapshot một chiều (ADR-0002).

| Task | TD | Gate | Nghiệm thu |
|---|---|---|---|
| Migration script chuẩn hoá shape `players` (idempotent) | TD-06 | DATABASE_VERSIONING | chạy lại an toàn; backup trước |
| Sinh `data/players.json`/`events.json` một chiều từ Firestore | TD-06 | ADR-0002 | site tĩnh & app cùng số liệu |
| Thêm `schemaVersion` vào snapshot + `appConfig` | — | DATABASE_VERSIONING | version khớp |
| Làm rõ ranh giới `events` vs `tournaments` | TD-06 | ADR-0002 | tài liệu + code thống nhất |
| Owner chấp nhận hợp đồng dữ liệu TD-06A | TD-06 | DESIGN-td-06-data-contract | ADR-0002 được chuyển Accepted trước khi cutover |
| Duyệt kế hoạch runtime/migration TD-06B | TD-06 | DESIGN-td-06b-runtime-migration-plan | Owner chấp nhận ngày 2026-08-05; chưa cấp quyền sửa code hoặc triển khai |

---

## 5. Sprint 4 — "Quy trình & chất lượng" (P2)  ·  2026-08-12 → 2026-08-25

| Task | TD | Nghiệm thu |
|---|---|---|
| Đưa `firebase deploy --only firestore:rules` vào CI (có phê duyệt) | TD-07 | rules deploy qua workflow |
| Thêm lint/build cho app-nextjs vào CI | TD-08 | CI chặn lỗi build |
| Hợp nhất 2 đường ghi `videos.json` | TD-10 | không còn ghi đè |
| Thu hẹp + xoay vòng `GITHUB_TOKEN` (fine-grained) | TD-11 | token scope tối thiểu |
| Uptime checks 3 endpoint + log JSON chuẩn | — | dashboard sống |

---

## 6. Backlog P2/P3 (xếp vào các sprint sau — xem MASTER_ROADMAP)
- TD-09 migrate `settings/adminData` blob.
- TD-12 điền thông tin doanh nghiệp (email/social/loại sân).
- TD-13 tách JS/CSS khỏi monolith (làm dần).
- TD-14 dọn file dev khỏi repo.
- TD-15 thống nhất Admin SDK (`verifyIdToken` + custom claim) — gắn phương án B của DESIGN-admin-auth.

---

## 7. Ký hiệu
🔒 = thay đổi lớn, bắt buộc qua Design Gate (`docs/design/`).

## 8. Tham chiếu
- Ưu tiên & đánh giá → `TECH_DEBT.md`
- Lộ trình 12 tháng → `MASTER_ROADMAP.md`
- Thiết kế chi tiết → `docs/design/`
