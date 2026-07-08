# AMZ AI Operating Manual

> **Trạng thái:** Đã xác nhận — 2026-07-08
> **Vai trò tài liệu:** Tài liệu vận hành duy nhất, tổng hợp quy trình ra quyết định (`AMZ_DECISION_PROTOCOL.md`) và chính sách phân quyền AI (`CLAUDE.md` — mục AMZ PERMISSION POLICY) thành 1 nơi tham chiếu cho người vận hành mới.
> Không tạo business truth mới. Nếu mâu thuẫn với `AMZ_BUSINESS_BLUEPRINT.md` hoặc `AMZ_OS.md`, hai tài liệu đó thắng.
> Nếu mâu thuẫn giữa tài liệu này với `CLAUDE.md`/`.claude/settings.local.json` về chi tiết kỹ thuật permission, **`CLAUDE.md` + `.claude/settings.local.json` là bản enforce thật, thắng** — xem mục 9.

---

## 1. Vai trò

- **Owner** — người quyết định cuối cùng về business, duyệt mọi thay đổi quan trọng.
- **ChatGPT** — cố vấn chiến lược và CTO reviewer, phản biện phương án, giảm rủi ro.
- **Claude Code** — phân tích và thực thi kỹ thuật. Không tự quyết định business.

## 2. Tài liệu nền

- `AMZ_BUSINESS_BLUEPRINT.md` — nguồn sự thật về business.
- `AMZ_OS.md` — nguồn sự thật về cấu trúc vận hành.
- `AMZ_90_DAY_ACTION_PLAN.md` — kế hoạch 90 ngày.
- `docs/adr/` — ghi lại quyết định kiến trúc/kỹ thuật đã chốt (VD `ADR-0005-court-schedule-source-of-truth.md`, `ADR-0007-tournament-auto-pairing-mvp.md`).
- `docs/operations/` — playbook/checklist cho quy trình vận hành hằng ngày (VD tài liệu này, `AUTO_PAIRING_TEST_CHECKLIST.md`).
- `CLAUDE.md` — chính sách phân quyền AI chi tiết (permission policy), nạp tự động vào context của Claude Code mỗi phiên.
- `.claude/settings.local.json` — cấu hình permission thật, được harness thực thi (allow/ask/deny).

## 3. Nguyên tắc vận hành chung

- Claude Code không tự quyết định business.
- Không làm công nghệ chỉ vì công nghệ.
- Ưu tiên giá trị thật tại sân, khách hàng, cộng đồng, nội dung sống.
- Mỗi lần chỉ chọn 1–2 việc chính.
- Nhiệm vụ phân tích thì chỉ phân tích, không sửa file.
- Trước khi sửa code phải audit và được Owner duyệt.
- Trước khi commit phải có final review.
- Không push, deploy, đổi Firebase nếu Owner chưa duyệt rõ.

## 4. Quy trình ra quyết định

1. Claude Code phân tích hiện trạng, đề xuất phương án.
2. ChatGPT review — chỉ ra điểm đúng, điểm sai, rủi ro.
3. Owner chốt quyết định.
4. Claude Code ghi nhận bằng ADR hoặc playbook nếu cần.
5. Final review trước commit.
6. Commit riêng, rõ phạm vi.
7. Push thủ công nếu cần.
8. Post-push verification.

## 5. Quy tắc giao việc cho Claude Code

- Mỗi task phải ghi rõ được sửa gì và không được sửa gì.
- Không tự mở rộng phạm vi.
- Không tự tạo file nếu chưa được yêu cầu.
- Không tự commit/push/deploy.
- Nếu phát hiện mâu thuẫn giữa tài liệu và code, phải dừng lại báo cáo.

## 6. Khi nào dùng ADR, khi nào dùng playbook

- **ADR** — quyết định kiến trúc, dữ liệu, bảo mật, deploy, nguồn sự thật.
- **Playbook** — quy trình vận hành hằng ngày, nhân viên sân, checklist thủ công.

## 7. Thứ tự ưu tiên khi mâu thuẫn

- Công nghệ mâu thuẫn với business → ưu tiên business.
- Tốc độ mâu thuẫn với an toàn → ưu tiên an toàn.
- Claude Code không chắc → dừng lại, hỏi Owner và ChatGPT.

---

## 8. AMZ AI Permission Policy — SETUP MODE

> **SETUP MODE** được dùng khi đang trong giai đoạn nâng cấp/cài đặt/audit hệ thống AMZ AI workflow — mục tiêu là giảm thao tác thủ công, cho phép Claude hỗ trợ cài đặt/audit/sửa code nhanh hơn, nhưng vẫn phải bảo vệ secret, dữ liệu cá nhân, và không tự push/deploy.
> Sau khi hệ thống ổn định, chính sách này sẽ được chuyển về **OPERATION MODE** chặt hơn (thu hẹp nhóm AUTO-SAFE, mở rộng nhóm ASK-FIRST) — xem mục 9.

### 8.A Nhóm AUTO-SAFE — đọc/sửa và lệnh không cần hỏi trước
- Đọc/sửa `index.html`
- Đọc/sửa `blog/index.html`
- Đọc/sửa `blog/posts/*.html`
- Đọc/sửa `sitemap.xml`
- Đọc/sửa `data/blog-posts.json`
- Đọc/sửa `data/pricing.json`
- Đọc/sửa `content/*.md`
- Đọc/sửa `404.html`
- Chạy `git status`
- Chạy `git diff`
- Chạy `git diff --stat`
- Chạy `grep`, `find`, `ls`, `dir`, `head`

### 8.B Nhóm ASK-FIRST — phải hỏi trước khi chạy/sửa trong SETUP MODE
- `npx`
- `npm install` / `npm i` / `npm ci`
- `pnpm install` / `pnpm add` / `pnpm dlx`
- `yarn install` / `yarn add` / `yarn dlx`
- `codegraph init`
- `npm test`
- `npm run lint`
- `npm run build`
- `git commit`
- Sửa `admin.html`
- Sửa `api/*.js`
- Sửa `vercel.json`
- Sửa `robots.txt`
- Sửa `app-nextjs/**`
- Chạy tool audit/test như Playwright nếu không đọc secret

### 8.C Nhóm HARD-DENY — luôn cấm, không có ngoại lệ trong SETUP MODE
- Đọc `.env`, `.env.*`, `app-nextjs/.env.local`
- Đọc `secrets/**`
- Đọc `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- In token, API key, password, hash, số điện thoại, email cá nhân
- `git push`
- `vercel deploy`, `vercel --prod`
- `rm -rf`, `rm -r`, xoá file hàng loạt
- `npm publish`, `pnpm publish`, `yarn publish`
- Gửi dữ liệu ra ngoài bằng `curl`/`wget`/`Invoke-WebRequest` nếu chưa có yêu cầu riêng

### 8.D Riêng `data/players.json` — dữ liệu nhạy cảm
- `data/players.json` chứa thông tin cá nhân thật của VĐV (tên, v.v.) — coi là **dữ liệu nhạy cảm**, không phải file cấu hình thông thường.
- **Không dùng tool Read trên file này** dưới bất kỳ lý do gì — Read in toàn bộ nội dung ra transcript, kể cả khi không cố ý.
- Chỉ được kiểm tra bằng `grep`/`find` (đếm field, kiểm tra tên key có tồn tại hay không, đếm số lượng bản ghi) hoặc script không in giá trị (VD `node -e` chỉ in `Object.keys(...)` hoặc `.length`, không in nội dung từng record).
- **Không in tên VĐV hoặc bất kỳ giá trị cá nhân nào** ra transcript/báo cáo nếu Owner không yêu cầu rõ ràng.
- Nếu cần sửa dữ liệu (kể cả dữ liệu public) trong file này thì phải hỏi trước.

### 8.E Quy trình trước khi sửa
- Luôn liệt kê chính xác file dự kiến sửa trước khi bắt đầu.
- Chỉ sửa đúng những file đã liệt kê.
- Sau khi sửa, luôn chạy `git diff --stat` và `git diff` để xác nhận thay đổi.
- Không commit / push / deploy trừ khi được yêu cầu rõ ràng.

---

## 9. SETUP MODE vs OPERATION MODE — trạng thái & nguồn sự thật kỹ thuật

- **Hiện tại (2026-07-08): đang ở SETUP MODE.** Repo đang trong giai đoạn nâng cấp AMZ AI workflow (permission, skills, playbook, ADR).
- **Điều kiện chuyển sang OPERATION MODE:** khi Owner xác nhận hệ thống đã ổn định (không còn audit/cài đặt lớn đang chạy), Owner ra quyết định chuyển mode — Claude Code không tự chuyển.
- **Khi chuyển:** cần cập nhật đồng thời cả 3 nơi — mục 8 của tài liệu này, `CLAUDE.md` (mục AMZ PERMISSION POLICY), và `.claude/settings.local.json` (allow/ask/deny thật) — để tránh 3 nơi lệch nhau.
- **Nguồn sự thật kỹ thuật:** tài liệu này là bản tổng hợp dễ đọc cho người vận hành; **`CLAUDE.md` + `.claude/settings.local.json` mới là nơi thật sự được harness thực thi**. Nếu 2 nơi lệch nhau (VD tài liệu này chưa cập nhật theo kịp một thay đổi nhỏ trong `settings.local.json`), lấy `CLAUDE.md`/`settings.local.json` làm chuẩn và báo Owner để đồng bộ lại tài liệu này.
