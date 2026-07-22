# AMZ Operation Mode Plan

> **Cơ chế (không phụ thuộc thời điểm đọc):** Trên nhánh `r21/agent-guidance-alignment`,
> đây là chính sách đang được đề xuất/review. Chính sách OPERATION MODE có
> hiệu lực đối với repository sau khi commit chứa thay đổi này được Owner phê
> duyệt và merge vào `master` — không tuyên bố đã merge khi điều đó chưa xảy
> ra. Trước thời điểm đó, `master` vẫn vận hành theo SETUP MODE (chế độ trước
> R21). Tài liệu này không tự enforce gì — nó mô tả OPERATION MODE và điều
> kiện/quy trình để chuyển sang đó. Xem `docs/operations/AMZ_AI_OPERATING_MANUAL.md`
> mục 9 cho tiến độ R21 cụ thể và nguồn sự thật enforce thật (`CLAUDE.md` +
> `.claude/settings.local.json`).

## 1. Mục đích

OPERATION MODE là chế độ vận hành ổn định, áp dụng **sau khi** giai đoạn cài đặt/nâng cấp AMZ AI workflow đã hoàn tất. Khác với SETUP MODE (ưu tiên tốc độ cài đặt/audit), mục tiêu của OPERATION MODE là **giảm rủi ro**: tránh AI tự cài tool, tự sửa lan man ngoài phạm vi được giao, tự đụng vào production khi chưa có xác nhận rõ ràng.

## 2. Khi nào chuyển sang OPERATION MODE

Điều kiện đề xuất (tất cả nên đạt trước khi chuyển):
- Website live đã ổn định.
- Không còn cài thêm tool lớn.
- Repo clean.
- Owner xác nhận dừng giai đoạn setup.
- Đã có operating manual (`AMZ_AI_OPERATING_MANUAL.md`).
- Đã có PII guardrail (đã có — xem `CLAUDE.md` mục E / `AMZ_AI_OPERATING_MANUAL.md` mục 8.E).
- Đã có visual check hoặc smoke test gần nhất pass.

## 3. Những quyền nên giữ AUTO-SAFE

- Chỉ đọc và kiểm tra, không làm thay đổi file hay hệ thống.
- Không đọc secret hoặc xuất dữ liệu cá nhân hàng loạt.
- `git status`
- `git diff`
- `git diff --stat`
- `grep`, `find`, `ls`, `dir`, `head`
- Đọc tài liệu `docs/operations/**`
- Đọc `CLAUDE.md`, `AGENTS.md`
- Đọc `.agents/*.md`
- Đọc `blog/index.html`, `blog/posts/*.html` khi làm task content
- Đọc `sitemap.xml`, `robots.txt` khi làm SEO
- Kiểm tra schema/validation/số lượng tổng hợp trong `data/players.json` mà không in bản ghi cá nhân (xem mục 6)

## 4. Những quyền nên chuyển về ASK-FIRST

- Sửa `index.html`
- Sửa `blog/index.html`
- Sửa `blog/posts/*.html`
- Sửa `data/pricing.json`
- Sửa `data/blog-posts.json`
- Sửa `sitemap.xml`
- Sửa `robots.txt`
- Sửa `vercel.json`
- Sửa `admin.html`
- Sửa `api/*.js`
- Sửa `app-nextjs/**`
- Cài dependency hoặc chạy lệnh có khả năng tạo file/đổi lockfile: `npx`, `npm install`, `npm i`, `npm ci`, `pnpm install`, `pnpm add`, `pnpm dlx`, `yarn add`, `yarn install`, `yarn dlx`
- `npm test`, `npm run lint`, `npm run build` (test/build có ghi artifact)
- `git commit` — chỉ khi Owner đã phê duyệt chính xác commit đó
- Đọc trường hoặc bản ghi cá nhân cụ thể trong `data/players.json` khi nhiệm vụ thật sự cần (xem mục 6)

## 5. Những quyền OWNER-ONLY — AI Agent không tự thực hiện

- `git push`
- `git merge`
- Mở hoặc cập nhật pull request
- `vercel deploy`, `vercel --prod`, hoặc deploy/publish khác
- Ghi dữ liệu Firebase hoặc gọi endpoint mutation production
- Thay đổi DNS, Vercel, hoặc GitHub settings
- Thay đổi secrets/credentials

Owner phải tự tay thực hiện các hành động OWNER-ONLY này. Không có sự phê
duyệt hoặc ủy quyền nào biến hành động OWNER-ONLY thành việc AI Agent được
tự thực hiện. Phê duyệt review hoặc commit không cho phép AI Agent push,
merge, mở/cập nhật PR, deploy, publish, sửa production hoặc thay đổi cấu
hình bên ngoài.

## 6. Những quyền nên HARD-DENY

- Đọc hoặc tiết lộ secret/credential/private key: `.env`, `.env.*`, `app-nextjs/.env.local`, `secrets/**`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- Bỏ qua permission guard (VD `--dangerously-skip-permissions`)
- `rm -rf`, `rm -r`, xóa file hàng loạt
- `npm publish`, `pnpm publish`, `yarn publish`
- In dữ liệu cá nhân, tên VĐV, phone, email nếu Owner không yêu cầu rõ
- Xuất/in hàng loạt bản ghi `data/players.json` (xem mục 6b cho mức độ chi tiết)
- `curl`/`wget`/`Invoke-WebRequest` gửi dữ liệu ra ngoài khi chưa có phạm vi và đích đến được Owner cho phép

### 6b. Riêng `data/players.json`

- Không cấm tuyệt đối việc đọc file theo tên đường dẫn.
- AUTO-SAFE: schema/validation/số lượng tổng hợp, không in bản ghi cá nhân.
- ASK-FIRST: đọc trường/bản ghi cá nhân cụ thể khi nhiệm vụ thật sự cần.
- HARD-DENY: in/xuất hàng loạt tên, điện thoại, email; gửi ra ngoài khi chưa được Owner cho phép rõ phạm vi và đích đến.

## 7. Quy trình chuyển mode

1. ✅ Owner ra quyết định chuyển mode (R21).
2. ✅ Claude cập nhật `CLAUDE.md` (và `AGENTS.md`, các file `.claude/agents/*.md`
   liên quan, cùng mục 8 của `AMZ_AI_OPERATING_MANUAL.md`) từ SETUP MODE sang
   OPERATION MODE — trên nhánh `r21/agent-guidance-alignment`, chưa merge.
3. ⏳ Claude đề xuất patch `.claude/settings.local.json` — chưa thực hiện; R21
   hiện chỉ đọc và đối chiếu file này (nếu tồn tại), không sửa.
4. ⏳ ChatGPT/Owner review toàn bộ diff R21 — chưa thực hiện.
5. ⏳ Commit `CLAUDE.md` và docs liên quan, rồi merge vào `master` — chưa
   thực hiện. Chính sách OPERATION MODE chỉ có hiệu lực trên `master` sau
   bước này.
6. `.claude/settings.local.json` vẫn local, không commit nếu bị ignore.

## 8. Quy trình quay lại SETUP MODE

- Chỉ quay lại khi cần cài tool lớn, refactor lớn, migration Next.js, hoặc nâng cấp hạ tầng.
- Phải ghi rõ lý do và phạm vi.
- Sau khi xong phải quay lại OPERATION MODE.

## 9. Checklist trước khi chuyển

- [ ] Repo clean
- [ ] origin/master đã sync
- [ ] Website live pass smoke test
- [ ] Không còn task cài tool lớn
- [ ] PII guardrail đã áp dụng
- [x] Owner xác nhận chuyển mode
- [ ] ChatGPT review policy
- [ ] Claude chưa tự push/deploy

Tiến độ R21 tại thời điểm sửa đổi này (không thay thế các checkbox trên):
- Quyết định Owner chuyển mode: đã có.
- ChatGPT final review: chưa hoàn tất.
- Commit/merge vào `master`: chưa thực hiện.
- Hardening `.claude/settings.local.json`: chưa thực hiện và không nằm trong diff R21.

## 10. Nguồn sự thật

- `CLAUDE.md` là policy chính cho Claude.
- `.claude/settings.local.json` là enforcement local.
- `AMZ_AI_OPERATING_MANUAL.md` là tài liệu tổng hợp.
- `AMZ_OPERATION_MODE_PLAN.md` (tài liệu này) là kế hoạch chuyển mode, **không tự enforce**.
