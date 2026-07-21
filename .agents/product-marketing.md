# AMZ Product Marketing Context

## Brand
AMZ là hệ sinh thái Pickleball + Cafe, định vị là điểm đến thể thao, thư giãn, kết nối cộng đồng và trải nghiệm trọn vẹn.

Slogan đã chốt: **Trọn vẹn từng khoảnh khắc**.

## Business units
1. **AMZ Pickleball**
   - Trọng tâm: trải nghiệm chơi, hướng dẫn, social, cộng đồng và giải đấu.
   - Đối tượng: người mới, người chơi phong trào, nhóm bạn, gia đình và cộng đồng doanh nghiệp.
   - Không lưu giá, khung giờ, ưu đãi hoặc thông tin liên hệ trong tệp này.
   - Trước khi dùng các dữ liệu đó, đọc trực tiếp `data/pricing.json` và chỉ dùng mục đang `visible`.

2. **AMZ Cafe**
   - Không gian cafe gắn với trải nghiệm thể thao và cộng đồng.
   - Không tự công bố tuyển dụng, quyền lợi hoặc số lượng vị trí nếu chưa có thông tin được chủ sở hữu xác nhận.

## Voice & tone
- Việt Nam, đời thường, rõ ràng, có chất thương hiệu.
- Không viết kiểu AI sáo rỗng.
- Ưu tiên câu ngắn, có CTA rõ.
- Khi viết landing page: nhấn trải nghiệm, cộng đồng, sự tiện lợi, giá minh bạch, coach cho người mới.

## Website priorities
1. Trang chủ phải nói rõ AMZ là gì trong 5 giây đầu.
2. Có CTA: Đặt sân, Xem giá, Tham gia social, Hỏi coach.
3. Pricing phải cực rõ, không mập mờ.
4. Có section cho người mới chơi.
5. Có section giải đấu/sự kiện.
6. Có SEO local theo Việt Nam, không để sai địa lý sang Mỹ.
7. Giao diện không generic: typography mạnh, bố cục có nhịp, spacing tốt, hình ảnh thực tế nếu có.

## Evidence rules
- Không tự tạo claim về quy mô, số sân, số thành viên, số giải, vị trí thị trường, giải thưởng hoặc kết quả kinh doanh.
- Không tự tạo review, testimonial, câu chuyện khách hàng, chương trình miễn phí, quà tặng hoặc giảm giá.
- Mỗi claim động phải có nguồn hiện hành trong repo hoặc bằng chứng do chủ sở hữu cung cấp.
- Nếu chưa đủ bằng chứng, bỏ claim hoặc gắn `[CẦN XÁC MINH]` trong bản nháp; không đưa placeholder lên nội dung public.
- Thiết kế phải theo `.claude/rules/design-system.md`; tài liệu hay mockup cũ không được ghi đè nguồn này.

## AI operating rule
- ChatGPT giữ vai trò chiến lược, reviewer, kiểm tra logic kinh doanh.
- Claude Code/Cursor thực thi code trong repo.
- GitHub là nguồn sự thật.
- Không commit trực tiếp nếu chưa review diff.
- Không đưa API key, dữ liệu khách hàng thật, email cá nhân, tài khoản ngân hàng vào prompt.
