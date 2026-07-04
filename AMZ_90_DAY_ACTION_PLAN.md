# AMZ_90_DAY_ACTION_PLAN.md — Kế hoạch hành động 90 ngày

> **Trạng thái:** Đã xác nhận (V2) — 2026-07-04
> **Nguồn:** `AMZ_BUSINESS_BLUEPRINT.md` (business truth) + `AMZ_OS.md` (cấu trúc vận hành)
> **Vai trò tài liệu này:** Biến ưu tiên Giai đoạn 1 trong Blueprint thành hành động cụ thể, có thời hạn. Không tạo sự thật kinh doanh mới, không thay thế Blueprint/AMZ_OS.

---

## A. Mục tiêu lớn của 90 ngày

Ổn định vận hành cốt lõi + có nội dung sống đều đặn + chốt nền dữ liệu (sân/lịch, players/events) — trước khi mở rộng bất kỳ công nghệ hay AI mới nào. Không chạy theo tính năng, chỉ chạy theo giá trị thật: khách hàng, vận hành, thương hiệu, cộng đồng.

---

## B. 5 ưu tiên trong 30 ngày đầu

1. **Chuẩn hóa quy trình vận hành thực tế** (đặt sân, cà phê, xử lý khách hàng) — viết ra, bắt đầu dùng ngay.
2. **Xây lịch giao lưu/cộng đồng cố định** — hàng tuần/tháng; lợi thế cạnh tranh bền vững nhất theo Blueprint.
3. **Video Center / YouTube** — biến thành nội dung sống: đăng đều đặn, khách thấy hoạt động thật tại sân, tích lũy dữ liệu truyền thông dần.
4. **Rà soát gói Hội viên hardcode** trong app-nextjs — chốt rõ giá 500k/1.2M/2.5M là placeholder hay chính thức.
5. **Quyết định nguồn dữ liệu sân/lịch dùng chung** (Pickleball ↔ Giải đấu & Sự kiện) + checklist thủ công cho export players/events (TD-06).

---

## C. Việc tạm hoãn có chủ đích

- **AI mới** — không làm gì trong 90 ngày nếu nền dữ liệu (mục B.5) chưa ổn định.
- **Cà phê/Bán lẻ thành hệ thống phần mềm riêng** — không mở rộng, hiện vận hành thủ công vẫn ổn.
- **app-nextjs: booking thật, auth, public subdomain** — trong 30 ngày đầu chỉ kiểm tra trạng thái Vercel preview, chưa xây thêm gì.
- **Quyết định giá Hội viên chính thức** — chờ sau khi rà soát (mục B.4) và có đủ dữ liệu kinh doanh.

---

## D. Việc giao Owner

- Chuẩn hóa quy trình vận hành + tổ chức lịch cộng đồng.
- Duyệt nội dung Video Center trước khi đăng.
- Quyết định placeholder/giá Hội viên.
- Tự kiểm tra trạng thái Vercel (Claude Code không truy cập được).
- Chốt quyết định nguồn dữ liệu sân/lịch (sau khi nghe đề xuất từ ChatGPT).

## E. Việc giao ChatGPT

- Đề xuất phương án kỹ thuật cho quyết định nguồn dữ liệu sân/lịch (ai ghi, ai đọc).
- Tư vấn chiến lược nội dung Video Center (tần suất, chủ đề, kênh).
- Tổng hợp đánh giá định kỳ 30/60/90 ngày.

## F. Việc giao Claude Code

- Viết checklist thủ công cho export players/events (TD-06).
- Ghi nhận quyết định nguồn dữ liệu sân/lịch sau khi Owner chốt.
- Hỗ trợ kỹ thuật pipeline Video Center (tránh 2 đường ghi đè `videos.json` — TD-10).
- Hỗ trợ rà soát code Hội viên (không tự quyết giá, chỉ đưa lựa chọn kỹ thuật).

---

## G. Kết quả cần đạt sau 30 ngày

- Quy trình vận hành đã viết ra và đang dùng thật.
- Lịch giao lưu cộng đồng đang chạy đều.
- Video Center có nhịp đăng nội dung đều đặn, không còn "để đó".
- Gói Hội viên không còn gây hiểu nhầm (đã gắn nhãn rõ ràng).
- Quyết định nguồn dữ liệu sân/lịch đã chốt bằng văn bản; checklist TD-06 đang được dùng.
- Biết rõ trạng thái Vercel app-nextjs preview (không cần đã xong — chỉ cần rõ ràng).

## H. Kết quả cần đạt sau 90 ngày

- Thương hiệu AMZ nhất quán trên các kênh (website, social, tại sân).
- Cộng đồng + nội dung tạo được đà đo được (lượt xem/tương tác tăng dần).
- Nền dữ liệu ổn định, xác nhận qua rà soát cuối kỳ.
- Cà phê/Bán lẻ/AI vẫn ở trạng thái hoãn **có chủ đích**, không phải bị bỏ quên.
- app-nextjs ở trạng thái rõ ràng: tiếp tục đầu tư hoặc tạm dừng — không còn "treo" như hiện tại.

---

## Nguyên tắc thực thi

- Mỗi lần chỉ làm 1–2 việc chính — không dồn nhiều việc cùng lúc.
- Ưu tiên giá trị thật tại sân (khách hàng, vận hành, cộng đồng) hơn việc kỹ thuật trừu tượng.
- Không làm công nghệ chỉ vì công nghệ — mỗi quyết định công nghệ phải trả lời được câu hỏi "có giúp khách hàng tốt hơn, doanh nghiệp bền vững hơn không?" (Blueprint §12).
- Mọi quyết định kỹ thuật phải phục vụ `AMZ_BUSINESS_BLUEPRINT.md` và `AMZ_OS.md` — không đi ngược lại hai tài liệu này.
