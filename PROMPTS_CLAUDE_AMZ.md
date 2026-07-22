# PROMPTS_CLAUDE_AMZ.md

## Prompt 0 - Chế độ an toàn trước khi làm
Đọc `CLAUDE.md`, `.agents/product-marketing.md`, và kiểm tra quyền hiện tại. Không đọc `.env`, `.env.*`, `secrets/**`, `*.pem`, `*.key`. Không chạy lệnh cài package ngoài, không commit/push/deploy. Trước tiên hãy báo cáo cấu trúc repo, các route chính, framework đang dùng, và kế hoạch audit trong 5 gạch đầu dòng.

## Prompt 1 - Audit toàn bộ website AMZ
Đọc `.agents/product-marketing.md` và `CLAUDE.md`. Sau đó audit website hiện tại theo 6 nhóm: định vị thương hiệu, UI/UX, pricing, SEO local Việt Nam, mobile, conversion/CTA. Chỉ báo cáo trước, chưa sửa code. Ưu tiên tìm lỗi làm website nhìn generic hoặc sai bối cảnh Việt Nam.

## Prompt 2 - Nâng cấp trang chủ
Dựa trên audit, nâng cấp homepage AMZ theo hướng: rõ AMZ là Pickleball + Cafe trong 5 giây đầu; có CTA Đặt sân / Xem giá / Tham gia social; giao diện xanh mát, hiện đại, không generic; mobile đẹp. Sửa code vừa đủ, không phá layout hiện có. Sau khi sửa, chạy lint/build nếu có.

## Prompt 3 - Nâng cấp pricing
Đọc `data/pricing.json` ngay trước khi phân tích hoặc sửa nội dung pricing — đây là nguồn giá hiện hành, không dùng số liệu cũ trong prompt hay tài liệu khác. Tìm toàn bộ nơi hiển thị giá. Làm bảng giá dễ hiểu, có ghi chú khung giờ. Nếu cần thông tin liên hệ, dùng quy tắc nguồn tại `CLAUDE.md`/`AGENTS.md`. Không tự bịa giá mới.

## Prompt 4 - SEO local Việt Nam
Kiểm tra metadata, title, description, heading, copy, schema nếu có. Sửa lỗi địa lý sai sang Mỹ. Tối ưu SEO local cho AMZ Pickleball/Cafe tại Việt Nam. Đừng nhồi từ khóa.

## Prompt 5 - Social content 30 ngày
Dùng marketing skills nếu đã cài, nếu chưa thì tự làm thủ công. Tạo lịch nội dung 30 ngày cho AMZ Pickleball + Cafe: bài giáo dục người mới, ưu đãi sân, social, giải đấu, behind-the-scenes, tuyển dụng. Xuất bảng ngày/chủ đề/hook/caption/CTA.

## Prompt 6 - Poster/tuyển dụng copy
Viết lại nội dung tuyển dụng AMZ Cafe cho poster: tuyển 05 phục vụ nữ + 02 pha chế, yêu cầu nhanh nhẹn vui vẻ giao tiếp tốt, ngoại hình ưa nhìn là lợi thế, thời gian linh động, bao ăn ở, môi trường thoải mái. Giọng văn trẻ, rõ, có dấu ấn AMZ.
