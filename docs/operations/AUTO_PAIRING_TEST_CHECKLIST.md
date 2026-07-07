# Checklist Vận Hành & Kiểm Thử An Toàn — Auto Pairing MVP (ADR-0007)

> Tài liệu dành cho Owner/BTC và Claude Code khi kiểm thử tính năng Ghép cặp tự động (Auto Pairing) trước khi dùng cho giải thật. Tham chiếu: `docs/adr/ADR-0007-tournament-auto-pairing-mvp.md`.

---

## 1. Mục tiêu kiểm thử

- Xác nhận auto pairing **chỉ chạy khi đủ đúng 32 VĐV hợp lệ** cho 1 nội dung thi đấu.
- Xác nhận bước **xem trước (preview) không ghi Firestore** dưới bất kỳ hình thức nào.
- Xác nhận bước **lưu Firestore ghi đúng 16 cặp đang hiển thị** trên màn hình tại thời điểm bấm Lưu — không phải một bộ dữ liệu khác.
- Xác nhận **secondary registration chuyển đúng `status = "merged"`**, không bị xóa, có `merged_into` trỏ đúng về registration chính.
- Xác nhận **không random lại khi bấm nút Lưu** — nút Lưu chỉ ghi lại đúng preview đã tạo.

---

## 2. Quy tắc an toàn trước khi test

- Chỉ **1 admin** thao tác auto pairing tại một thời điểm (chưa có application-level lock — xem mục 10).
- **Không test trực tiếp trên giải thật** khi chưa backup/export dữ liệu `registrations` và `players`.
- Tạo **1 nội dung thi đấu (event) riêng cho test**, đặt tên rõ ràng, ví dụ: `TEST_AUTO_PAIRING`, để không lẫn với nội dung thi đấu thật.
- Dùng **VĐV test** (hồ sơ `players` tạo riêng cho mục đích test) hoặc dữ liệu test đã được đánh dấu rõ, không dùng hồ sơ VĐV thật đang tham gia giải khác.
- **Không bấm nút Lưu kết quả ghép cặp nếu chưa kiểm tra kỹ bảng preview** đang hiển thị.

---

## 3. Dữ liệu test tối thiểu

Cần chuẩn bị đúng **32 registration cá nhân** cho event test, mỗi registration:

- `event_id` = đúng event test (`TEST_AUTO_PAIRING`)
- `player_1_id` hợp lệ (trỏ tới 1 hồ sơ `players` có thật)
- `player_2_id = null`
- `status = "confirmed"`
- `payment_status = "paid"`

Mỗi `players` tương ứng cần có:

- `gender` = `"male"` hoặc `"female"` (đúng giá trị hệ thống đang dùng — xem ADR-0007 mục 6)
- `amz_rating` có giá trị số hợp lệ (không rỗng, không NaN)

---

## 4. Test thiếu dữ liệu

Kiểm tra từng trường hợp riêng lẻ (mỗi lần chỉ tạo đúng 1 loại thiếu, còn lại đủ 32 để cô lập nguyên nhân):

- [ ] Thiếu thanh toán (1 VĐV có `payment_status != "paid"`).
- [ ] Chưa confirmed (1 VĐV có `status != "confirmed"`).
- [ ] Thiếu giới tính (1 `players` không có `gender`).
- [ ] Thiếu `amz_rating` (1 `players` không có `amz_rating` hoặc giá trị rỗng/NaN).
- [ ] Không đủ 32 VĐV hợp lệ (ví dụ chỉ có 31).
- [ ] Nhiều hơn 32 VĐV hợp lệ (ví dụ có 33).

**Kỳ vọng cho mọi trường hợp trên:** nút "Xem trước ghép cặp" **không được bật** (disabled), khối trạng thái dữ liệu hiển thị đúng số liệu cảnh báo tương ứng (số thiếu thanh toán/thiếu confirmed/thiếu giới tính/thiếu rating), và số "X / 32 VĐV hợp lệ" phản ánh đúng thực tế.

---

## 5. Test preview

Sau khi dữ liệu test đủ đúng 32 VĐV hợp lệ:

- [ ] Bấm "Xem trước ghép cặp".
- [ ] Kiểm tra bảng preview hiển thị **đúng 16 dòng** (16 cặp).
- [ ] Kiểm tra **mỗi VĐV chỉ xuất hiện đúng 1 lần** trong toàn bộ bảng (không VĐV nào lặp lại ở cặp khác).
- [ ] Kiểm tra cột "Điểm AMZ" của từng người khớp đúng `amz_rating` hiện tại của VĐV đó (snapshot đúng tại thời điểm preview).
- [ ] Kiểm tra `gender_adjustment` đúng theo giới tính từng cặp:
  - Nam-Nam: `+0.3`
  - Nam-Nữ: `0`
  - Nữ-Nữ: `-0.3`
- [ ] Kiểm tra `pair_adjusted_score` = tổng điểm AMZ 2 người + `gender_adjustment` đúng công thức ADR-0007 mục 7.

---

## 6. Test bốc lại preview

- [ ] Sau khi đã có 1 preview, bấm "Bốc lại preview" (preview lần 2) cho cùng event.
- [ ] Xác nhận có hộp thoại confirm hiện ra trước khi random lại.
- [ ] Bấm **Cancel** → xác nhận bảng preview **cũ vẫn giữ nguyên**, không đổi, nút vẫn ghi "Bốc lại preview".
- [ ] Bấm **OK** → xác nhận bảng preview **mới thay thế hoàn toàn** preview cũ (16 cặp có thể khác thứ tự/khác cặp so với lần trước).
- [ ] Ghi rõ trong lúc test: **chỉ phương án preview cuối cùng đang hiển thị mới được lưu** nếu bấm nút Lưu — các phương án preview trước đó không được lưu lại ở đâu.

---

## 7. Test lưu Firestore

- [ ] Trước khi bấm Lưu, **chụp màn hình hoặc ghi lại thủ công 16 cặp đang hiển thị** (tên VĐV 1, VĐV 2 của từng cặp) để đối chiếu sau khi lưu.
- [ ] Bấm "Lưu kết quả ghép cặp".
- [ ] Xác nhận hộp thoại confirm **nói rõ đây là thao tác ghi dữ liệu thật vào Firestore**, không thể hoàn tác tự động.
- [ ] Sau khi lưu, kiểm tra trên Firestore (hoặc qua UI reload):
  - [ ] Đúng **16 registration chính (primary)** có `player_2_id` được gán.
  - [ ] 16 primary vẫn giữ `status = "confirmed"`.
  - [ ] Đúng **16 registration phụ (secondary)** chuyển `status = "merged"`.
  - [ ] Mỗi secondary có `merged_into` trỏ đúng về `id` của registration chính tương ứng.
  - [ ] Toàn bộ 32 bản ghi (16 primary + 16 secondary) có **cùng một `pairing_batch_id`**.
  - [ ] **Không có registration nào bị xóa** — tổng số bản ghi `registrations` của event test trước và sau khi lưu phải bằng nhau (chỉ đổi field, không đổi số lượng).
  - [ ] Đối chiếu 16 cặp đã lưu đúng khớp với 16 cặp đã chụp/ghi lại ở bước preview cuối cùng (không lệch cặp nào).

---

## 8. Test sau khi lưu

- [ ] Vào lại tab Chia bảng cho event test — bảng "Đội đã xác nhận thanh toán" **không còn hiển thị secondary registration như 1 đội độc lập**.
- [ ] Nút "Lưu kết quả ghép cặp" **bị khóa lại** (disabled) ngay sau khi lưu thành công.
- [ ] Thử bấm lại nút Lưu (nếu vô tình còn enable) → xác nhận **không thể lưu lại cùng 1 preview** (do state preview đã bị reset về `null`).
- [ ] Nếu tiếp tục sang bước chia bảng: xác nhận chỉ các registration **đã ghép đủ cặp** (có `player_2_id`) được đưa vào, không còn registration cá nhân lẻ nào lọt vào.

---

## 9. Checklist trước khi dùng cho giải thật

- [ ] Đã backup/export `registrations` của giải thật (CSV hoặc export Firestore).
- [ ] Đã backup/export `players` liên quan tới giải thật.
- [ ] Đã kiểm tra đủ đúng 32 VĐV hợp lệ cho mỗi nhóm trình (Trình Thấp, Trình Cao).
- [ ] Đã kiểm tra toàn bộ VĐV trong danh sách đã `payment_status = "paid"`.
- [ ] Đã kiểm tra toàn bộ VĐV có `gender` đầy đủ.
- [ ] Đã kiểm tra toàn bộ VĐV có `amz_rating` đầy đủ, đúng (đã qua xét trình, không phải giá trị tạm/nháp).
- [ ] Xác nhận chỉ có **1 admin** thao tác ghép cặp tại thời điểm chạy thật (không có ai khác đang mở cùng tab Chia bảng của event đó).
- [ ] **Owner/BTC đã xem và duyệt bảng preview** trước khi admin bấm nút Lưu — không tự ý bấm Lưu khi chưa có xác nhận từ Owner/BTC.

---

## 10. Rủi ro còn lại

- **Chưa có application-level lock** chống 2 admin thao tác đồng thời trên cùng 1 event — nếu 2 người cùng mở tab Chia bảng và cùng bấm Lưu gần như đồng thời, có rủi ro race condition tầng ứng dụng (dù mỗi lượt `batch.commit()` vẫn atomic ở tầng Firestore).
- **Banner "Đã lưu xong"** trên UI chỉ tồn tại trong phiên trình duyệt hiện tại (biến JS `_autoPairLastSavedInfo`) — không phải nguồn sự thật, sẽ biến mất nếu tải lại trang dù dữ liệu đã lưu vẫn còn nguyên trong Firestore.
- **Nếu nhập sai `amz_rating`/`gender` trước khi ghép cặp**, kết quả ghép cặp (bao gồm `pair_adjusted_score`) sẽ sai theo đúng dữ liệu đầu vào sai đó — hệ thống không có cơ chế phát hiện dữ liệu "sai nhưng hợp lệ về mặt kiểu dữ liệu" (ví dụ rating nhập nhầm số nhưng vẫn là số hợp lệ).

---

## Vai trò

- **Owner/BTC:** xác nhận dữ liệu test, duyệt preview trước khi cho phép lưu thật, quyết định thời điểm dùng cho giải thật.
- **Claude Code:** hỗ trợ chuẩn bị dữ liệu test khi được yêu cầu rõ ràng, không tự ý tạo/xóa dữ liệu thật, không tự ý bấm các nút ghi dữ liệu trong quá trình audit/kiểm thử.
