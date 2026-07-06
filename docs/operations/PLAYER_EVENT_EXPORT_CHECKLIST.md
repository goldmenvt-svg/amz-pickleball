# Checklist Export Người chơi / Giải đấu — Sổ tay vận hành

> Tài liệu dành cho Owner và đội vận hành — không cần hiểu kỹ thuật, chỉ cần biết khi nào export, bấm ở đâu, kiểm tra gì.

---

## 1. Mục tiêu

Đảm bảo dữ liệu người chơi / bảng xếp hạng / giải đấu trên **amzpickleball.vn** luôn khớp với những gì Owner vừa chỉnh trong trang quản trị (admin).

---

## 2. Khi nào cần export

- Sau khi sửa thông tin người chơi.
- Sau khi cập nhật điểm/ELO/bảng xếp hạng.
- Sau khi tạo hoặc sửa giải đấu/sự kiện.
- Bất cứ khi nào muốn thay đổi vừa làm trong admin xuất hiện trên website công khai.

---

## 3. Trước khi export

- Đã kiểm tra lại thay đổi trong admin, thấy đúng rồi.
- Không có ai khác đang sửa dữ liệu cùng lúc.
- Biết rõ mình đang muốn cập nhật: người chơi, giải đấu/sự kiện, hay cả hai.

---

## 4. Sau khi bấm export

1. Đợi khoảng 30–60 giây.
2. Mở trang `amzpickleball.vn`.
3. Kiểm tra bảng xếp hạng.
4. Kiểm tra mục giải đấu/sự kiện.
5. Xác nhận dữ liệu mới đã hiện đúng.

---

## 5. Nếu dữ liệu chưa đúng

- Không bấm export liên tục nhiều lần.
- Chụp lại màn hình lỗi.
- Báo Claude Code/ChatGPT kiểm tra.
- Không tự sửa trực tiếp file `data/players.json` hoặc `data/events.json` nếu chưa được hướng dẫn.

---

## 6. Trước phiên làm việc kỹ thuật tiếp theo

- Luôn kiểm tra/đồng bộ máy local với GitHub trước khi bắt đầu (git pull).
- Nhớ rằng export từ admin ghi thẳng lên GitHub, không đi qua máy local.
- Nếu không đồng bộ lại, máy local có thể đang cũ hơn GitHub.

---

## 7. Vai trò

**Owner / đội vận hành**
- Bấm export và kiểm tra website sau khi export.

**ChatGPT**
- Hỗ trợ đánh giá nếu dữ liệu hiển thị sai.

**Claude Code**
- Kiểm tra kỹ thuật nếu export lỗi hoặc dữ liệu bị lệch.
