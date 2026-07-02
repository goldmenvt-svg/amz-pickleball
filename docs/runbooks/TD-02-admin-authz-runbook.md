# Runbook — TD-02 Kiểm quyền admin cho `api/push-*`

> Trạng thái: **Preflight** (chờ duyệt trước khi sửa code). Ngày: 2026-06-30.
> Phạm vi: CHỈ hai file `api/push-data.js`, `api/push-videos.js`. Không sửa `index.html`/`admin.html`, không refactor, không đụng DB.
> Tham chiếu: `docs/design/DESIGN-admin-auth.md`, `ADR-0003`, `SECURITY.md` #1.

## Vấn đề (nhắc lại)
Hai function verify Firebase ID token bằng REST `accounts:lookup` nhưng **chỉ kiểm token hợp lệ** (`verifyRes.ok`), KHÔNG kiểm có phải admin. → Bất kỳ user Firebase nào cũng có thể đẩy JSON lên repo → lên site (Critical).

## Cách khắc phục — Phương án A (khuyến nghị làm ngay, P0)
Sau khi `accounts:lookup` trả OK, **đọc email trong response** và chỉ cho qua nếu đúng admin:
- Parse JSON kết quả `accounts:lookup` → `data.users[0].email` (+ `emailVerified`).
- So sánh với biến môi trường `ADMIN_EMAIL`.
- Nếu không khớp → trả **403** (Forbidden), KHÔNG push.
- Áp dụng cho **cả hai** file, giống hệt nhau.

> Phương án B (P2, sau này): dùng Firebase Admin SDK `verifyIdToken` + custom claim `admin`. Ghi trong `DESIGN-admin-auth.md`, không làm ở sprint này.

---

## 1. Checklist PREFLIGHT (làm TRƯỚC khi sửa code)

### A. Xác nhận thông tin
- [ ] Email admin chính xác: `goldmenvt@gmail.com` (khớp `firestore.rules`).
- [ ] Xác nhận đây là tài khoản duy nhất được phép push.

### B. Chuẩn bị môi trường Vercel (thủ công — bạn làm)
- [ ] Thêm biến môi trường trên Vercel: `ADMIN_EMAIL = goldmenvt@gmail.com`
      (Project `website-test` → Settings → Environment Variables → Add → áp dụng cho Production + Preview).
- [ ] Xác nhận đã có sẵn `FIREBASE_API_KEY`, `GITHUB_TOKEN` (đang dùng).

### C. Giảm bề mặt tấn công (khuyến nghị, thủ công)
- [ ] Kiểm tra Firebase Console → Authentication → Sign-in method: **tắt tự đăng ký** nếu chỉ admin dùng (Email/Password để "cho phép đăng nhập" nhưng không mở form tạo tài khoản công khai; tắt Anonymous nếu bật).

### D. Sẵn sàng rollback
- [ ] Biết commit SHA hiện tại để `git revert` nếu cần.
- [ ] Hiểu: thay đổi chỉ **cộng thêm** một lớp kiểm tra → admin hợp lệ vẫn push bình thường.

---

## 2. Thay đổi code dự kiến (chưa áp dụng — chờ duyệt)

Chèn đoạn kiểm tra admin **sau** khối verify token, **trước** khi dùng `GITHUB_TOKEN`, ở cả `push-data.js` và `push-videos.js`:

```js
// Sau khi verifyRes.ok === true:
const info = await verifyRes.json();
const email = info?.users?.[0]?.email?.toLowerCase();
const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
if (!adminEmail) return res.status(500).json({ error: 'ADMIN_EMAIL not set on server' });
if (email !== adminEmail) return res.status(403).json({ error: 'Forbidden: not admin' });
```

> Ghi chú: hiện code gọi `verifyRes.ok` rồi bỏ body. Ta sẽ đọc body (`.json()`) để lấy email. Không đổi luồng còn lại.

---

## 3. Lệnh nghiệm thu (sau khi deploy)
```bash
# Không token → 401
curl -sI -X POST https://amzpickleball.vn/api/push-data | grep -i 'HTTP/'

# Token hợp lệ NHƯNG không phải admin → 403  (dùng ID token của tài khoản test non-admin)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer <NON_ADMIN_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventsJSON":"{}","playersJSON":"{}"}' \
  https://amzpickleball.vn/api/push-data     # kỳ vọng 403

# Từ admin panel thật (đăng nhập goldmenvt@gmail.com) → push chạy bình thường (200)
```

## 4. Rollback
| Tình huống | Hành động |
|---|---|
| Admin thật bị chặn nhầm (403) | Kiểm `ADMIN_EMAIL` trên Vercel đúng chính tả; kiểm `accounts:lookup` có trả `email` |
| Cần hoàn tác ngay | `git revert <sha>` → redeploy (logic cũ hoạt động lại) |

**Mức rollback: ✅ Dễ** — một commit, một redeploy.

## 5. Tiêu chí hoàn thành (DoD)
- [ ] Token admin → 200, push chạy.
- [ ] Token non-admin → 403, không push.
- [ ] Không token/sai → 401.
- [ ] Không thay đổi trải nghiệm admin hợp lệ.
- [ ] Log ghi lý do từ chối, không lộ token.
