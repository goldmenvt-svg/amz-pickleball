# ADR-0007 — Tournament Auto Pairing MVP (Giải Nội Bộ Kỷ Niệm 1 Năm AMZ)

- **Trạng thái:** Proposed
- **Ngày:** 2026-07-07
- **Người quyết định:** Owner
- **Liên quan:** ADR-0002 (Firestore single source of truth), ADR-0004 (app-nextjs fate), ADR-0005 (court schedule source of truth), `docs/operations/AMZ_1_YEAR_TOURNAMENT_BRIEF.md`, `docs/operations/AMZ_1_YEAR_TOURNAMENT_DATA_CHECKLIST.md`

## 1. Trạng thái

Proposed — chưa triển khai code, chờ Owner/ChatGPT duyệt phương án trước khi build.

## 2. Bối cảnh

Giải Nội Bộ Kỷ Niệm 1 Năm AMZ Pickleball dùng hình thức đăng ký **cá nhân, không đăng ký cặp cố định**. Sau khi VĐV đăng ký, Ban chuyên môn xét trình và xác nhận đóng tiền, **hệ thống phải tự động bốc thăm ghép cặp ngẫu nhiên có điều kiện** — không ghép thủ công theo cảm tính, không cho VĐV tự chọn đồng đội.

Audit kỹ thuật (đã thực hiện trước ADR này) xác nhận qua code hiện tại (`admin.html` + Firestore):

- **Chưa có** hàm random/shuffle nào ghép 2 VĐV cá nhân thành 1 cặp.
- **Chưa có** logic tính điểm quy đổi cặp đôi (`pair_adjusted_score`).
- **Chưa có** rating snapshot bền vững gắn theo từng giải — `players.amz_rating` là giá trị dùng chung, không tách riêng theo giải.
- `players` hiện có sẵn: `self_rating`, `amz_rating`, `gender`, `note` (xác nhận qua `admin.html:1339-1352`).
- `registrations` hiện có sẵn: `status`, `payment_status`, `player_1_id`/`player_2_id` (xác nhận qua `admin.html:1656-1664`).
- "Lịch sử trình" (tab History trong admin) hiện chỉ ghi vào `localStorage` (`db.history`), **không phải Firestore bền vững** — không liên quan trực tiếp tới ADR này nhưng là bối cảnh quan trọng khi thiết kế nơi lưu snapshot điểm.
- ADR-0005 **vẫn giữ nguyên hiệu lực**: không tự động liên kết `tournaments`/`events` với `bookings`/`courts`, không tạo Court Schedule collection mới. ADR-0007 này **không đụng tới** phạm vi đó.

## 3. Quyết định

- **MVP auto pairing chạy trong `admin.html` hiện tại** (client-side, thao tác qua giao diện quản trị) — **chưa làm Cloud Function/server-side** trong giai đoạn này.
- **Chỉ Admin/BTC thao tác** tính năng này — không mở cho VĐV hay công khai trên web.
- **Có thể nâng cấp lên server-side sau này** nếu quy mô giải lớn hơn hoặc cần mức độ audit/chống thao túng kết quả cao hơn (VD: giải có giải thưởng lớn, cần minh bạch với bên thứ ba) — không thuộc phạm vi quyết định lần này, chỉ ghi nhận là hướng mở.

## 4. Điều kiện hợp lệ để đưa vào auto pairing (Player eligibility)

Một VĐV **chỉ** được đưa vào tập dữ liệu đầu vào cho auto pairing khi thỏa **tất cả** điều kiện sau:

- `registrations.status = confirmed`
- `registrations.payment_status = paid`
- Có `player_id` hợp lệ (liên kết đúng tới 1 hồ sơ `players` có thật)
- Có `event_id` đúng nhóm trình (Trình Thấp hoặc Trình Cao)
- `players.gender` đã có giá trị (không suy đoán từ tên/hình ảnh)
- `players.amz_rating` đã có giá trị
- **Không** thuộc nhóm pending / rejected / waitlist / thiếu thông tin

Thiếu bất kỳ điều kiện nào ở trên → VĐV đó **loại khỏi vòng random**, không đưa vào tính toán, không random tạm với dữ liệu thiếu.

## 5. Quy tắc điểm (Rating rule)

- `players.self_rating` — **chỉ là điểm tự khai**, không dùng để tính pairing.
- `players.amz_rating` — điểm AMZ/Ban chuyên môn đang chấm, là **nền để ghép cặp**, nhưng **không dùng trực tiếp và không bị sửa** bởi quy trình ghép cặp.
- `official_rating_snapshot` — điểm được **chụp lại** (copy giá trị `amz_rating` tại đúng thời điểm chạy random) và lưu riêng vào bản ghi `registrations` liên quan. Đây là field **mới**, hiện chưa tồn tại trong schema, cần audit/triển khai (xem mục 8, 12).
- **Không ghi đè `players.amz_rating`** vì bất kỳ lý do gì liên quan tới việc tính cặp — điểm trình cá nhân chỉ thay đổi qua quy trình xét trình/lịch sử trình riêng, tách biệt hoàn toàn khỏi luồng auto pairing.

## 6. Công thức điểm cặp đôi (Pair score formula)

```
pair_base_score = official_rating_snapshot_1 + official_rating_snapshot_2

gender_adjustment:
  Nam-Nam → +0.3
  Nam-Nữ  → 0
  Nữ-Nữ   → -0.3

pair_adjusted_score = pair_base_score + gender_adjustment
```

- `official_rating_snapshot_1`/`_2` là giá trị đã chụp tại thời điểm ghép (mục 5), **không phải** đọc trực tiếp `players.amz_rating` tại thời điểm sau này (tránh lệch nếu hồ sơ VĐV bị sửa sau khi đã ghép).
- Hệ số `+0.3 / 0 / -0.3` là **hệ số tạm thời cho giải này** — không phải hằng số cố định vĩnh viễn trong hệ thống.
- `pair_adjusted_score` chỉ dùng để hỗ trợ ghép cặp/chia bảng cho cân — **không dùng để chấp điểm trong trận đấu**.

## 7. Quy tắc ghép cặp (Pairing rule)

- **Random không phải random thuần túy** — là random có điều kiện, dựa trên `pair_adjusted_score` (rating + gender) để hỗ trợ cân bằng sức mạnh, không random vị trí hoàn toàn ngẫu nhiên.
- **Không cho VĐV tự chọn đồng đội.**
- **Không ghép cặp thủ công theo cảm tính** dưới bất kỳ hình thức nào, kể cả BTC tự ghép tay rồi nhập kết quả vào hệ thống.
- Trình Thấp: đủ 32 VĐV hợp lệ (theo mục 4) → hệ thống tự động random thành 16 cặp.
- Trình Cao: đủ 32 VĐV hợp lệ (theo mục 4) → hệ thống tự động random thành 16 cặp.
- Không random chéo giữa 2 `event_id` (không ghép Trình Thấp với Trình Cao).

## 8. Lưu trữ dữ liệu (Data persistence)

Kết quả mỗi lần ghép cặp cần lưu tối thiểu các field sau (gắn vào bản ghi `registrations` liên quan, hoặc cấu trúc tương đương — chi tiết kỹ thuật để Claude Code đề xuất khi audit triển khai):

- `paired_at` — thời điểm chạy random.
- `paired_by` — người thao tác (tài khoản admin bấm nút).
- `pairing_batch_id` hoặc `pairing_seed` — định danh cho 1 lần chạy random, để truy vết/tái tạo nếu cần.
- `official_rating_snapshot` — điểm đã chụp tại thời điểm ghép (mục 5).
- `pair_adjusted_score` — kết quả tính theo công thức mục 6.
- `player_1_id`, `player_2_id` — 2 VĐV trong cặp.
- `event_id` — nhóm trình (Trình Thấp/Trình Cao).
- `tournament_id` — giải đấu liên quan.

Toàn bộ field trên **hiện chưa tồn tại trong schema thật** — đây là phần việc kỹ thuật cần audit + thiết kế chi tiết trước khi code (xem mục 12), không được giả định đã có.

## 9. Quy tắc bốc thăm lại (Re-random rule)

- Nếu 1 nhóm trình **đã có kết quả ghép cặp**, nút "Ghép cặp lại" phải yêu cầu **xác nhận rõ ràng** (VD: hộp thoại xác nhận nêu rõ hậu quả — sẽ xóa/thay thế cặp hiện có) trước khi chạy.
- Mỗi lần bốc thăm lại phải **ghi nhận lại thời điểm và người thao tác** (dùng cùng field `paired_at`/`paired_by`, tăng `pairing_batch_id` mới).
- **Không được tự động ghi đè im lặng** — không có luồng nào cho phép random lại mà không qua bước xác nhận.

## 10. Không thuộc phạm vi ADR này (Non-goals)

- Không sửa cơ chế rating history / localStorage hiện tại trong ADR này (là một audit/quyết định riêng, khác phạm vi).
- Không làm thanh toán online.
- Không public `app-nextjs` (giữ nguyên theo ADR-0004).
- Không liên kết `tournaments`/`events` với `bookings`/`courts` (giữ nguyên theo ADR-0005).
- Không tạo Court Schedule collection mới (giữ nguyên theo ADR-0005).
- Không làm Cloud Function/server-side trong MVP này (xem mục 3 — để ngỏ cho tương lai, không quyết định ngay).

## 11. Rủi ro (Risks)

- **Random thiếu điều kiện** — nếu lọc sai (VD thiếu kiểm tra `payment_status`), có thể ghép cặp cho người chưa đủ điều kiện tham gia.
- **Mất lịch sử trình** — vẫn tồn tại do "Lịch sử trình" hiện là localStorage (rủi ro có sẵn từ trước, không phải do ADR này gây ra, nhưng cần lưu ý khi thiết kế `official_rating_snapshot` để không phụ thuộc vào cơ chế lịch sử chưa đáng tin cậy).
- **Ghi đè điểm cá nhân** — nếu code vô tình ghi `pair_adjusted_score` hoặc `official_rating_snapshot` đè lên `players.amz_rating` thay vì lưu riêng vào `registrations`.
- **Không gắn `player_id`** — nếu có đăng ký "mồ côi" (không trỏ tới hồ sơ VĐV thật) lọt vào vòng random.
- **Tranh cãi nếu không lưu kết quả bốc thăm** — nếu thiếu `paired_at`/`paired_by`/`pairing_batch_id`, không có cách chứng minh cặp đã ghép là ngẫu nhiên, hợp lệ khi có khiếu nại.
- **Công khai nhầm dữ liệu nhạy cảm** — nếu xuất danh sách cặp ra công khai mà lộ kèm SĐT/email/ghi chú nội bộ (xem `AMZ_1_YEAR_TOURNAMENT_DATA_CHECKLIST.md` mục 8).

## 12. Kế hoạch triển khai (Implementation plan)

1. Thêm kiểm tra dữ liệu đủ điều kiện (mục 4) — lọc đúng danh sách VĐV hợp lệ trước khi cho phép chạy random.
2. Thêm hàm tính `pair_adjusted_score` (mục 6) — logic thuần, chưa cần lưu vĩnh viễn nếu chưa cần truy vết.
3. Thêm nút "Ghép cặp tự động" trong giao diện admin (tab Đăng ký giải/Chia bảng).
4. Lưu kết quả pairing vào Firestore theo đúng field ở mục 8.
5. Khóa hoặc cảnh báo rõ ràng khi bốc thăm lại (mục 9).
6. Kiểm tra dữ liệu (đủ 32/32, không trùng, đã ghép đủ cặp) trước khi cho phép chuyển sang bước chia bảng.

Mỗi bước cần Owner/ChatGPT xác nhận trước khi Claude Code triển khai, theo đúng `AMZ_DECISION_PROTOCOL.md`.
