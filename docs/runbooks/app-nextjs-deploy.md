# Runbook — Deploy app-nextjs (bản xem thử riêng tư)

> Liên quan: ADR-0004 (Accepted: deploy riêng), TD-04, TD-05. Ngày: 2026-07-02.
> **Giai đoạn 1: chỉ deploy PREVIEW** (`*.vercel.app`), KHÔNG gắn subdomain công khai. App còn WIP (đặt sân mock, chưa có login) → chưa công khai.

> **⚠️ Ghi chú trạng thái (cập nhật 2026-07-04):** Đây là runbook/biên bản deploy preview app-nextjs, không phải nguồn xác nhận trạng thái sống.
> - Trạng thái "rules đã publish qua Firebase Console" (mục bên dưới) hiện **CHƯA được xác minh lại** bằng Firebase Console.
> - Trạng thái Vercel app-nextjs preview hiện **CHƯA được xác minh** đã deploy thành công.
> - Không dùng file này làm bằng chứng duy nhất cho trạng thái production — cần xác minh lại trực tiếp trước khi dựa vào các claim bên dưới.

## Bối cảnh sẵn sàng (đọc kỹ)
- ✅ Chạy thật: xem giải đấu, form đăng ký giải (ghi Firestore).
- ⚠️ Đặt sân `/dat-san`: **mock** (`setTimeout`, TODO createBooking) — chưa ghi gì.
- ⚠️ Không có đăng nhập; hội viên/thanh toán chưa nối trang.
- ⚠️ Trang lịch/kết quả giải sẽ **không hiện danh sách đăng ký** (rules giữ `registrations` read = admin-only để bảo vệ SĐT/email — đúng chủ ý). Chấp nhận ở preview.

## Kiến trúc deploy
- **Dự án Vercel MỚI** (tách khỏi `website-test`), cùng repo `goldmenvt-svg/amz-pickleball`, **Root Directory = `app-nextjs`**, framework Next.js (auto).
- Không gắn custom domain. Dùng URL `*.vercel.app` Vercel cấp.
- Cùng Firebase project `amz-pickleball` (Firestore chung với site tĩnh).

## Biến môi trường cần thêm (Firebase web config — CÔNG KHAI, không phải secret)
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBEu79X60sxk8qIK41R0GTxMq7tDSe1ot0
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=amz-pickleball.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=amz-pickleball
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=amz-pickleball.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=699338393901
NEXT_PUBLIC_FIREBASE_APP_ID=1:699338393901:web:30925e4985c5abaf57aba4
```

## Các bước (Vercel)
1. Vercel → **Add New… → Project**.
2. Import repo `goldmenvt-svg/amz-pickleball` (Vercel cho phép import lại repo đã dùng cho project khác).
3. **Root Directory** → chọn `app-nextjs`.
4. Framework Preset: **Next.js** (tự nhận). Build/Output để mặc định.
5. **Environment Variables**: dán 6 biến `NEXT_PUBLIC_FIREBASE_*` ở trên (Production + Preview).
6. **Deploy**. Chờ build (~1–3 phút). Lấy URL `*.vercel.app`.
7. (KHÔNG thêm domain) — giữ private preview.

## Firestore rules (TD-04) — đã cập nhật
- `courts` read công khai → trang đặt sân hiển thị được sân.
- `bookings/payments/members/users/elo_history`: admin-only placeholder (mở owner-based khi có login).
- Nhớ **publish rules** (đã làm qua Firebase Console) để app đọc `courts`.

## Nghiệm thu (trên URL preview)
- [ ] Trang chủ app (`/` → redirect `/dat-san`) load, hiện danh sách sân (đọc `courts`).
- [ ] `/giai-dau` hiện danh sách giải; mở 1 giải xem được.
- [ ] `/bang-xep-hang` load (đọc players).
- [ ] Không lỗi Firebase "Missing/insufficient permissions" ở console (trừ registrations ở lịch/kết quả — đã biết).
- [ ] Đặt sân: bấm được nhưng CHỈ giả lập (đã biết, chưa nối).

## Việc còn lại trước khi CÔNG KHAI (giai đoạn 2 — chưa làm)
1. Nối `createBooking()` thật trong `BookingPage` (bỏ mock).
2. Quyết mô hình đặt sân: công khai (validate shape như registrations) hay yêu cầu đăng nhập.
3. Nếu cần login: thêm Firebase Auth flow; mở rule owner-based cho bookings/members.
4. Trang hội viên/thanh toán (VietQR) nối thật.
5. Chốt nguồn dữ liệu trùng (bảng xếp hạng/giải đấu) giữa app và site tĩnh (TD-06/ADR-0002).
6. Khi ổn: gắn subdomain `app.amzpickleball.vn` (DNS như TD-01).

## Rollback
- Xoá project Vercel mới (không ảnh hưởng site tĩnh `website-test`).
- Rules: `git checkout <sha> -- firestore.rules` → publish lại bản cũ.

---

## TRẠNG THÁI THỰC TẾ (2026-07-02) — đang vướng build

Đã làm xong (qua Chrome):
1. ✅ Đổi **default branch GitHub → master** (sửa gốc bug main/master; website-test không ảnh hưởng vì đã ghim Production Branch=master).
2. ✅ **TD-04 rules đã publish** lên Firestore production (courts read + placeholder admin-only cho bookings/payments/members/users/elo_history).
3. ✅ Tạo **Vercel project `amz-pickleball-yzil`** (repo amz-pickleball, branch master, Framework Next.js, Root Directory = `app-nextjs`, đã nhập đủ 6 biến `NEXT_PUBLIC_FIREBASE_*`).

⚠️ **Đang vướng:** build fail "No Next.js version detected" — Vercel chạy build từ **gốc repo** dù Settings hiển thị Root Directory = `app-nextjs`. Đã xác nhận `app-nextjs/package.json` CÓ trên master và có `next@15.3.3`. Redeploy "với settings mới nhất" vẫn fail. Đây là lỗi flaky của Vercel (root dir không được áp dụng ở build).

### Cách hoàn tất (chọn 1) — việc cho user
- **A (nhanh, khuyến nghị):** Deploy bằng **Vercel CLI** từ máy:
  ```bash
  npm i -g vercel
  cd "D:\website test\app-nextjs"
  vercel link   # chọn project amz-pickleball-yzil
  vercel        # (preview) hoặc: vercel --prod
  ```
  CLI build đúng thư mục `app-nextjs`, tránh lỗi root-dir của dashboard.
- **B:** Trên GitHub tạo 1 commit nhỏ vào master (bất kỳ) → push → Vercel tự build lại `amz-pickleball-yzil` với settings hiện tại (root=app-nextjs). Deploy "commit mới" thường áp dụng root-dir đúng hơn redeploy cùng commit.
- **C:** Xoá project `amz-pickleball-yzil` và import lại, kiểm Root Directory = app-nextjs ĐÃ LƯU (Settings → Build) trước khi deploy.

### Dọn dẹp
- Có 1 project Vercel thừa **`amz-pickleball`** (tạo nhầm ở lần import đầu). Nên **xoá** (Settings → Advanced → Delete Project) để tránh nhầm. Không ảnh hưởng site tĩnh `website-test`.

### Còn cần user xác nhận (Firebase Auth authorized domains)
Khi app preview chạy trên URL `*.vercel.app`, để Firebase Auth (nếu sau này bật login) hoạt động, thêm domain preview vào Firebase Console → Authentication → Settings → Authorized domains. Hiện app chưa có login nên chưa gấp.
