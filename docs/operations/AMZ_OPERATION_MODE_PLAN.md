# AMZ Operation Mode Plan

> **Trạng thái:** Kế hoạch (Plan) — chưa áp dụng. Repo hiện đang ở **SETUP MODE**.
> Tài liệu này không tự enforce gì — nó chỉ mô tả OPERATION MODE sẽ như thế nào và điều kiện/quy trình để chuyển sang đó. Xem `docs/operations/AMZ_AI_OPERATING_MANUAL.md` mục 9 cho nguồn sự thật enforce thật (`CLAUDE.md` + `.claude/settings.local.json`).

## 1. Mục đích

OPERATION MODE là chế độ vận hành ổn định, áp dụng **sau khi** giai đoạn cài đặt/nâng cấp AMZ AI workflow đã hoàn tất. Khác với SETUP MODE (ưu tiên tốc độ cài đặt/audit), mục tiêu của OPERATION MODE là **giảm rủi ro**: tránh AI tự cài tool, tự sửa lan man ngoài phạm vi được giao, tự đụng vào production khi chưa có xác nhận rõ ràng.

## 2. Khi nào chuyển sang OPERATION MODE

Điều kiện đề xuất (tất cả nên đạt trước khi chuyển):
- Website live đã ổn định.
- Không còn cài thêm tool lớn.
- Repo clean.
- Owner xác nhận dừng giai đoạn setup.
- Đã có operating manual (`AMZ_AI_OPERATING_MANUAL.md`).
- Đã có PII guardrail (đã có — xem `CLAUDE.md` mục D / `AMZ_AI_OPERATING_MANUAL.md` mục 8.D).
- Đã có visual check hoặc smoke test gần nhất pass.

## 3. Những quyền nên giữ AUTO-SAFE

- `git status`
- `git diff`
- `git diff --stat`
- `grep`, `find`, `ls`, `dir`, `head`
- Đọc tài liệu `docs/operations/**`
- Đọc `CLAUDE.md`
- Đọc `.agents/*.md`
- Đọc `blog/index.html`, `blog/posts/*.html` khi làm task content
- Đọc `sitemap.xml`, `robots.txt` khi làm SEO

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
- `npm test`, `npm run lint`, `npm run build`
- `git commit`

## 5. Những quyền nên HARD-DENY

- Đọc `.env`, `.env.*`, `app-nextjs/.env.local`
- Đọc `secrets/**`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- Read `data/players.json`
- In dữ liệu cá nhân, tên VĐV, phone, email nếu Owner không yêu cầu rõ
- `npx`, `npm install`, `npm i`, `npm ci`, `pnpm install`, `pnpm add`, `pnpm dlx`, `yarn add`, `yarn install`, `yarn dlx`
- `curl`/`wget`/`Invoke-WebRequest` gửi dữ liệu ra ngoài nếu chưa có yêu cầu riêng
- `git push`
- `vercel deploy`, `vercel --prod`
- `rm -rf`, `rm -r`
- `npm publish`, `pnpm publish`, `yarn publish`

## 6. Quy trình chuyển mode

1. Owner ra quyết định chuyển mode.
2. Claude cập nhật `CLAUDE.md` từ SETUP MODE sang OPERATION MODE.
3. Claude đề xuất patch `.claude/settings.local.json`.
4. ChatGPT/Owner review.
5. Commit `CLAUDE.md` và docs liên quan nếu cần.
6. `.claude/settings.local.json` vẫn local, không commit nếu bị ignore.

## 7. Quy trình quay lại SETUP MODE

- Chỉ quay lại khi cần cài tool lớn, refactor lớn, migration Next.js, hoặc nâng cấp hạ tầng.
- Phải ghi rõ lý do và phạm vi.
- Sau khi xong phải quay lại OPERATION MODE.

## 8. Checklist trước khi chuyển

- [ ] Repo clean
- [ ] origin/master đã sync
- [ ] Website live pass smoke test
- [ ] Không còn task cài tool lớn
- [ ] PII guardrail đã áp dụng
- [ ] Owner xác nhận chuyển mode
- [ ] ChatGPT review policy
- [ ] Claude chưa tự push/deploy

## 9. Nguồn sự thật

- `CLAUDE.md` là policy chính cho Claude.
- `.claude/settings.local.json` là enforcement local.
- `AMZ_AI_OPERATING_MANUAL.md` là tài liệu tổng hợp.
- `AMZ_OPERATION_MODE_PLAN.md` (tài liệu này) là kế hoạch chuyển mode, **không tự enforce**.
