# Design Doc — Xác thực quyền admin cho serverless `api/push-*`

> Liên quan: TD-02 (P0), TD-15 (P3). Trạng thái: **APPROVED — Phương án A đã triển khai (code) 2026-06-30**; Phương án B (Admin SDK) hoãn sang P2. Ngày: 2026-06-30.
> Runbook: `docs/runbooks/TD-02-admin-authz-runbook.md`. Test logic: 8/8 PASS (admin→200, non-admin→403, thiếu email→403, token sai→401).
> ADR: `docs/adr/ADR-0003-admin-authz-on-serverless.md`.
> **Gate:** chỉ triển khai sau khi 4 mục dưới được duyệt.

---

## 1. Tài liệu thiết kế

### Vấn đề
`api/push-data.js` và `api/push-videos.js` verify Firebase ID token bằng REST `identitytoolkit accounts:lookup` rồi **chỉ kiểm `verifyRes.ok`** — tức bất kỳ user Firebase hợp lệ nào (kể cả không phải admin) cũng được dùng `GITHUB_TOKEN` để ghi `data/*.json` lên repo → deploy lên site. (SECURITY #1, Critical.)

### Giải pháp (2 lựa chọn — chọn 1)

**Phương án A (tối thiểu, nhanh):** giữ REST `accounts:lookup`, nhưng đọc `users[0].email` và `emailVerified` trong response, **chỉ cho qua** khi `email === ADMIN_EMAIL` (env). Bổ sung kiểm `users[0].localId`/`validSince` nếu cần.

**Phương án B (chuẩn hơn, khuyến nghị):** dùng **Firebase Admin SDK** `verifyIdToken(idToken)` để verify chữ ký phía server, rồi kiểm **custom claim** `admin === true` (hoặc email). Dùng `FIREBASE_ADMIN_SERVICE_ACCOUNT_KEY` (đã khai báo trong `.env.local.example`, hiện chưa dùng → giải quyết luôn TD-15).

→ Đề xuất **A trước (P0, nhanh, ít rủi ro)**, lên lịch **B** ở P2 khi gắn Admin SDK.

### Phòng thủ bổ sung
- Kiểm cấu hình Firebase Auth: **tắt self-signup** nếu chỉ admin dùng hệ thống quản trị.
- Cân nhắc App Check cho endpoint (liên quan DESIGN-firestore-rules).

---

## 2. Kế hoạch migration

| Bước | Hành động |
|---|---|
| M1 | Thêm env `ADMIN_EMAIL=goldmenvt@gmail.com` trên Vercel |
| M2 | Cập nhật `api/push-data.js` + `push-videos.js`: sau lookup, parse JSON, so `email` |
| M3 | Deploy preview, test bằng token admin (pass) và token non-admin (403) |
| M4 | Promote production |
| M5 | (P2, phương án B) Thêm Admin SDK, chuyển sang `verifyIdToken` + custom claim |

Thay đổi **cộng thêm** một lớp kiểm tra, không phá luồng admin hợp lệ → rủi ro thấp.

---

## 3. Kế hoạch rollback

| Tình huống | Hành động |
|---|---|
| Admin thật bị chặn nhầm (403) | Kiểm `ADMIN_EMAIL` env đúng; kiểm response `accounts:lookup` có `email` |
| Cần hoàn tác ngay | `git revert` commit; redeploy bản trước (logic cũ vẫn hoạt động) |

**Mức rollback: ✅ Dễ.** Một commit, một redeploy.

---

## 4. Tiêu chí nghiệm thu

- [ ] Gọi `/api/push-data` bằng token của **admin** → `200`, JSON được push.
- [ ] Gọi bằng token user Firebase **không phải admin** → `403`, KHÔNG push.
- [ ] Gọi **không** token / token sai → `401`.
- [ ] Không có thay đổi nào với trải nghiệm admin hợp lệ (push vẫn chạy).
- [ ] Log ghi rõ lý do từ chối (email không khớp) mà không lộ token.
- [ ] (Nếu làm B) `verifyIdToken` reject token hết hạn/giả mạo; service account key chỉ ở server env, không commit.
