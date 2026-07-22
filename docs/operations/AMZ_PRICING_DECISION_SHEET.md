# AMZ Pricing Decision Sheet

> **Trạng thái:** Chờ Owner chốt — chưa áp dụng thay đổi nào vào production.
> Tài liệu này tổng hợp từ Phase 7A (Pricing/Product Ops Audit) thành các quyết định cụ thể cần Owner trả lời trước khi Claude Code triển khai Phase 7C.
> Không tự sửa `data/pricing.json`, `index.html`, hay booking logic cho tới khi Owner chốt từng mục.
>
> **Tài liệu này là bản ghi quyết định/làm việc tại thời điểm soạn, không phải
> nguồn giá hiện hành. Mọi giá và ưu đãi hiện hành phải đọc trực tiếp từ
> `data/pricing.json`. Các checkbox chưa hoàn tất vẫn cần Owner quyết định.**

## 1. Trạng thái được ghi nhận tại thời điểm soạn

- **Giá thuê sân đang có:** Thứ 2–6 (05:00–16:00) 70.000đ/giờ; Thứ 7–CN (05:00–14:00) 100.000đ/giờ — cả 2 lấy từ `data/pricing.json`, hiển thị đúng trên `index.html`.
- **Giá Social đang có:** 350.000đ/tháng — lấy từ `data/pricing.json`.
- **Giá xé vé đang có:** 40.000đ/lần — lấy từ `data/pricing.json`.
- **Giá coaching đang hardcode:** "Từ 500K/buổi" — viết cứng trong `index.html`, không có trong `data/pricing.json`.
- **Khung giờ tối đang thiếu giá:** Thứ 2–6 16:00–22:00 và Thứ 7–CN 14:00–23:00 — khung giờ này đang hoạt động thật (theo schema.org `openingHours`, booking wizard, FAQ, blog content) nhưng không có giá nào được định nghĩa.

## 2. Bảng giá hiện có

| Sản phẩm | Giá hiện tại | Nguồn | Trạng thái |
|---|---|---|---|
| Thuê sân Thứ 2–6, 05:00–16:00 | 70.000đ/giờ | `data/pricing.json` | Được ghi là đang áp dụng tại thời điểm soạn |
| Thuê sân Thứ 7–CN, 05:00–14:00 | 100.000đ/giờ | `data/pricing.json` | Được ghi là đang áp dụng tại thời điểm soạn |
| Social | 350.000đ/tháng | `data/pricing.json` | Được ghi là đang áp dụng tại thời điểm soạn, chưa rõ quyền lợi chi tiết |
| Xé vé | 40.000đ/lần | `data/pricing.json` | Được ghi là đang áp dụng tại thời điểm soạn, chưa rõ "1 lần" là gì |
| Coaching | Từ 500K/buổi | Hardcode trong `index.html` | Đang hiển thị, chưa đồng bộ vào `data/pricing.json` |

## 3. Khung giờ cần Owner chốt

| Nhóm ngày | Khung giờ | Giá hiện tại | Cần chốt |
|---|---|---|---|
| Thứ 2–6 | 16:00–22:00 | Chưa có | Giá/giờ? Có tính cao điểm không? |
| Thứ 7–CN | 14:00–23:00 | Chưa có | Giá/giờ? Có tính cao điểm không? |

## 4. Social Club

Câu hỏi cần Owner chốt:
- 350k/tháng bao gồm gì (số giờ chơi, số lần/tuần, quyền ưu tiên đặt sân...)?
- Có giới hạn số buổi/tháng không?
- Có áp dụng cho tất cả khung giờ (kể cả khung giờ tối chưa có giá ở mục 3) không?
- Có bao gồm xé vé (VD được xé vé miễn phí thêm) không?

## 5. Xé vé

Câu hỏi cần Owner chốt:
- 40k/lần là 1 giờ, 1 buổi (nhiều giờ liên tục), hay 1 lần tham gia social?
- Áp dụng khung giờ nào (chỉ giờ hiện có giá, hay cả khung tối)?
- Có cần đặt trước không, hay mua tại chỗ?

## 6. Thành Viên vs Social

Vấn đề: `data/pricing.json` dùng tên **"Social"**, nhưng booking wizard trong `index.html` (bước chọn dịch vụ) dùng tên **"Thành Viên"** ("Gói membership ưu đãi"). Chưa rõ đây là 2 tên gọi của cùng 1 sản phẩm hay 2 sản phẩm khác nhau.

Cần Owner quyết định: thống nhất thành 1 tên gọi duy nhất (VD "Social Club") dùng xuyên suốt cả `pricing.json` và booking wizard, hay giữ tách thành 2 sản phẩm riêng biệt (Social 350k/tháng và Thành Viên là gói khác chưa định giá).

## 7. Coaching

- Hiện đang hardcode "Từ 500K/buổi" trực tiếp trong `index.html`, không nằm trong `data/pricing.json`.
- Cần Owner xác nhận mức giá này còn đúng không.
- Nếu đúng, đề xuất chuyển vào `data/pricing.json` ở bước sau (Phase 7C) để về chung 1 nguồn giá, tránh phải sửa trực tiếp `index.html` mỗi khi đổi giá coaching.

## 8. Booking Logic

- Hiện tại booking wizard **chưa tính giá** theo ngày/giờ khách chọn — chỉ thu thập thông tin (ngày, giờ, số người, liên hệ) rồi gửi qua Formspree/Zalo.
- Đề xuất: sau khi Owner chốt đầy đủ giá ở các mục 3–7, sẽ thêm dòng "giá ước tính" vào bước xác nhận của booking wizard, tính từ dữ liệu `data/pricing.json` thật (không hardcode).
- **Không** tự động thu tiền online ở giai đoạn này — chỉ hiển thị giá ước tính để tham khảo, thanh toán vẫn xử lý thủ công như hiện tại.

## 9. Owner Decision Checklist

- [ ] Chốt giá Thứ 2–6, 16:00–22:00
- [ ] Chốt giá Thứ 7–CN, 14:00–23:00
- [ ] Chốt Social Club 350k/tháng bao gồm gì
- [ ] Chốt xé vé 40k/lần nghĩa là gì
- [ ] Chốt "Thành Viên" có đổi thành "Social Club" không
- [ ] Chốt coaching 500k/buổi
- [ ] Chốt có hiển thị giá ước tính trong booking wizard không

## 10. Sau khi Owner chốt

Bước tiếp theo sẽ là **Phase 7C**, chỉ triển khai sau khi Owner đã trả lời đầy đủ checklist mục 9:
- Cập nhật `data/pricing.json` theo giá đã chốt.
- Cập nhật `index.html` để render giá mới (bao gồm khung giờ tối nếu có).
- Chuẩn hóa wording "Social Club" xuyên suốt `pricing.json` và booking wizard.
- Cân nhắc thêm "giá ước tính" trong booking wizard.
- Test bằng Playwright trước khi coi là hoàn tất.
