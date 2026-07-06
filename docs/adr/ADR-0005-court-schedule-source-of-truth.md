# ADR-0005 — Court Schedule Source of Truth

- **Trạng thái:** Accepted — 2026-07-06
- **Ngày:** 2026-07-06
- **Người quyết định:** Owner
- **Liên quan:** TD-06, ADR-0002 (Firestore single source of truth), ADR-0004 (app-nextjs fate), `AMZ_90_DAY_ACTION_PLAN.md`, `DATABASE.md`, `firestore-schema.md`

## Bối cảnh

Pickleball/Booking và Giải đấu & Sự kiện hiện **chưa dùng chung một lịch sân**:

- Collection `courts` + `bookings` (dùng bởi app-nextjs) có schema đủ trường để mô tả lịch sân: `courtId`, `date`, `startTime`/`endTime`.
- Collection `tournaments`/`events` hiện chỉ lưu `court_count` — một con số mô tả ("8 sân"), **không có `courtId` cụ thể, không có khung giờ**, không tham chiếu gì tới `bookings`.
- **Lưu ý về hiện trạng code:** luồng đặt sân trên `app-nextjs` (`/dat-san`) hiện **còn mock** (`setTimeout`, chưa gọi `createBooking()` thật từ UI) và hàm `createBooking()` trong `firestore.ts` **chưa dùng transaction** để chống trùng lịch — cơ chế chống double-booking thật sự **chưa được hoàn thiện trong code**. `bookings` mới chỉ là schema/định hướng phù hợp nhất hiện có, không phải một hệ thống đã chạy ổn.

Hệ quả: hai domain Core Physical Operations (Pickleball, Giải đấu & Sự kiện) đang giữ dữ liệu sân/lịch tách biệt, trái với nguyên tắc "một nguồn sự thật duy nhất cho sân/lịch" đã nêu ở `AMZ_OS.md` mục 4.

**Rủi ro:** nếu cả app đặt sân (booking) và giải đấu cùng hoạt động thật mà không chia sẻ dữ liệu, có thể xảy ra double-booking — khách đặt sân online trùng giờ với sân đã được giải đấu giữ, vì không hệ thống nào biết về bên kia.

## Quyết định

Trong **90 ngày đầu**:

1. **`bookings` (kèm `courts`) là nguồn ghi chính** cho trạng thái sân bận/rảnh.
2. **Giải đấu & Sự kiện không tự tạo một lịch sân riêng.** Khi cần giữ sân cho giải đấu, phải đi qua quy trình **"booking-block" thủ công** — nghĩa là: nhân viên tạo/ghi nhận một bản ghi giữ sân cho giải đấu hoặc sự kiện (khác với đặt sân của khách lẻ), trong cùng nguồn `bookings`, để tránh trùng lịch với khách đặt sân cá nhân. Trong 90 ngày đầu, việc này làm **thủ công** (không qua code tự động).
3. **Không tạo Court Schedule collection riêng** trong giai đoạn này.
4. **Không sửa code để tự động liên kết** `tournaments`/`events` với `bookings`.

## Lý do

- **Ít rủi ro nhất:** không tạo thêm collection/schema mới; định hướng ghi đè lên đúng nơi đã được thiết kế cho lịch sân (`courts`/`bookings`), thay vì để hai domain tự giữ hai bản lịch song song.
- **Tận dụng thiết kế hiện có:** `bookings` đã có schema đủ trường (`courtId`, `date`, `startTime`/`endTime`) phù hợp để làm nguồn ghi chính. **Đây là quyết định về nguồn sự thật/định hướng vận hành — không phải xác nhận rằng cơ chế chống trùng lịch trong code đã hoàn chỉnh.** Việc hoàn thiện transaction chống double-booking và nối luồng đặt sân thật từ UI vào `createBooking()` là việc kỹ thuật cần làm sau, nằm ngoài phạm vi ADR này.
- **Phù hợp `AMZ_90_DAY_ACTION_PLAN.md`:** mục A/C của kế hoạch 90 ngày yêu cầu ổn định nền dữ liệu hiện có trước, không mở rộng công nghệ mới (bao gồm collection mới) khi nền tảng chưa chốt xong. Về `app-nextjs` (TD-05): `ADR-0004` đã **Accepted** — deploy riêng, bản preview/private trước, **chưa public**. Điều chưa hoàn thiện không phải là "chưa quyết định", mà là: bản preview chưa được xác minh ổn định, tính năng đặt sân thật/đăng nhập chưa xong, và chưa public cho khách.

## Hệ quả

- Giải đấu **chưa được tự động chặn sân bằng code** — việc giữ sân cho giải đấu phụ thuộc vào quy trình thủ công của nhân viên, không có ràng buộc hệ thống.
- Cần có **checklist vận hành** để nhân viên không quên giữ sân (tạo booking-block) mỗi khi có giải đấu/sự kiện dùng sân.
- Sau 90 ngày, có thể xem xét lại phương án **Court Schedule dùng chung** (một nguồn trung lập cho cả booking cá nhân lẫn giữ sân giải đấu) — đặc biệt khi bản preview `app-nextjs` (theo `ADR-0004`) được xác minh ổn định, đặt sân thật + đăng nhập hoàn thiện, và chuyển sang public cho khách.

## Việc tạm hoãn

- Xây **Court Schedule collection riêng** dùng chung giữa Pickleball và Giải đấu & Sự kiện.
- **Tự động liên kết** `tournaments`/`events` với `bookings` bằng code.
- **Hoàn thiện đặt sân thật (transaction chống double-booking, nối UI vào `createBooking()`) và chuyển `app-nextjs` sang public** — theo `ADR-0004`, hiện mới ở giai đoạn deploy riêng bản preview/private, chưa đủ điều kiện (đăng nhập, rules Firestore cho `courts`/`bookings`/`members`/`payments`, xác minh ổn định) để public cho khách.
