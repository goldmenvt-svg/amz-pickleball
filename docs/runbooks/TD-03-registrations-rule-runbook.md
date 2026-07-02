# Runbook — TD-03 Siết rule `registrations`

> Trạng thái: **ĐÃ PUBLISH LÊN PRODUCTION qua Firebase Console 2026-07-02 (10:05).** Rule mới cho `registrations` đang live. (Repo `firestore.rules` = prod, chỉ khác dấu tiếng Việt trong comment.)
> Phạm vi: CHỈ block `registrations` trong `firestore.rules`. Không đụng code app, không đụng dữ liệu.
> Tham chiếu: `docs/design/DESIGN-firestore-rules.md`, `ADR-0002`, `SECURITY.md` #3.

## Vấn đề & cách làm
- Cũ: `allow create: if true` → ai cũng ghi `registrations` tuỳ ý (spam/lạm quyền).
- **KHÔNG bắt đăng nhập** được, vì form đăng ký giải là **công khai** (`dat-san`/`giai-dau/[id]/dang-ky`, ghi `source:'public'` không auth). Bắt `request.auth != null` sẽ **làm hỏng đăng ký**.
- Cách siết đúng (P0): **validate shape** — người công khai chỉ tạo được đúng field, luôn `status/payment_status/checkin_status = 'pending'`, `source='public'`, `seed_number=0`, không set id. Admin ghi tự do qua `isAdmin()`.

Rule mới:
```
match /registrations/{regId} {
  allow create: if isAdmin() || isValidPublicRegistration();
  allow read, update, delete: if isAdmin();
}
```
+ hàm `isValidPublicRegistration()` (xem `firestore.rules`).

## Đã kiểm (trong sandbox)
- ✅ Desk-check theo mọi đường ghi: public `dang-ky` (14 field) khớp `hasOnly`; admin add/update/delete qua `isAdmin` (bypass). `createRegistrationOS` trong lib **không có caller** (code chết).
- ✅ Mô phỏng logic bằng JS: 9/9 PASS (public đơn/đôi cho qua; tự-xác-nhận, tự-đánh-dấu-đã-trả, field lạ, `source=admin`, set seed, spam 5000 ký tự, thiếu field → bị chặn).
- ⚠️ **Chưa chạy được emulator trong sandbox** (không cài được `firebase-tools`/tải emulator). → **BẮT BUỘC** chạy emulator test (mục dưới) trước khi deploy để xác nhận cú pháp CEL.

## 1. Emulator test (chạy trên máy bạn — gate trước deploy)

```bash
# 1) Cài công cụ (một lần)
npm i -g firebase-tools

# 2) Tạo test (thư mục bất kỳ, cùng cấp firestore.rules hoặc trỏ đúng đường dẫn)
#    file: test/registrations.rules.test.js  (nội dung ở mục 2)
npm i -D @firebase/rules-unit-testing mocha

# 3) Chạy với emulator
firebase emulators:exec --only firestore "npx mocha test/registrations.rules.test.js"
```

## 2. Nội dung test đề xuất (`registrations.rules.test.js`)
```js
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const { setDoc, doc, collection, addDoc } = require('firebase/firestore');

let env;
const base = { event_id:'evt1', player_1_name:'Nguyen A', player_1_phone:'0901234567',
  player_1_email:'a@x.com', player_1_id:null, player_2_name:'Tran B', player_2_phone:'0907654321',
  player_2_id:null, status:'pending', payment_status:'pending', checkin_status:'pending',
  seed_number:0, source:'public', created_at:new Date().toISOString() };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'amz-pickleball',
    firestore: { rules: fs.readFileSync('firestore.rules','utf8') }
  });
});
after(() => env.cleanup());

const anon = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext('adm', { email:'goldmenvt@gmail.com' }).firestore();

it('public hợp lệ → cho tạo', async () => {
  await assertSucceeds(addDoc(collection(anon(),'registrations'), base));
});
it('public tự status=confirmed → chặn', async () => {
  await assertFails(addDoc(collection(anon(),'registrations'), {...base, status:'confirmed'}));
});
it('public payment=paid → chặn', async () => {
  await assertFails(addDoc(collection(anon(),'registrations'), {...base, payment_status:'paid'}));
});
it('public field lạ → chặn', async () => {
  await assertFails(addDoc(collection(anon(),'registrations'), {...base, isAdmin:true}));
});
it('public update/delete → chặn (chỉ admin)', async () => {
  const ref = await addDoc(collection(admin(),'registrations'), base);
  await assertFails(setDoc(doc(anon(),'registrations',ref.id), {status:'confirmed'}, {merge:true}));
});
it('admin tạo tự do → cho', async () => {
  await assertSucceeds(addDoc(collection(admin(),'registrations'), {...base, source:'admin', status:'confirmed'}));
});
```

## 3. Deploy (sau khi test xanh)
```bash
firebase deploy --only firestore:rules
```

## 4. Nghiệm thu
- [ ] Emulator test: tất cả case xanh.
- [ ] Form đăng ký công khai (`giai-dau/.../dang-ky`) vẫn tạo được đăng ký (status pending).
- [ ] Không thể tạo đăng ký với `status=confirmed`/`payment_status=paid` từ client công khai.
- [ ] Admin panel vẫn thêm/duyệt/xoá đăng ký bình thường.

## 5. Rollback
| Tình huống | Hành động |
|---|---|
| Đăng ký công khai bị chặn nhầm sau deploy | So field form với `isValidPublicRegistration()` (có thể form đã đổi shape); sửa danh sách `hasOnly` cho khớp |
| Cần hoàn tác ngay | `git checkout <sha> -- firestore.rules` rồi `firebase deploy --only firestore:rules` (khôi phục bản trước) |

**Mức rollback: ⚠️ Có điều kiện** — rules thay thế toàn bộ; giữ bản cũ trong git để redeploy. RTO < 15 phút.

> ⚠️ Lưu ý: nếu sau này form đăng ký đổi field, phải cập nhật `hasOnly([...])` trong rule cho khớp, nếu không đăng ký sẽ bị chặn.
