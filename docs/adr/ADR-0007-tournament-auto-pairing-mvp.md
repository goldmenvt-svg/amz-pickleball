# ADR-0007 — Tournament Auto Pairing MVP (Giải Nội Bộ Kỷ Niệm 1 Năm AMZ)

- **Trạng thái:** Proposed
- **Ngày:** 2026-07-07
- **Cập nhật:** 2026-07-07 — bổ sung tiền đề đăng ký cá nhân, chính sách merge đăng ký sau ghép cặp (status = merged), đổi kế hoạch triển khai thành 5 commit (thêm bước nền hỗ trợ đăng ký cá nhân làm Commit 1)
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

## 4. Tiền đề dữ liệu đầu vào (Prerequisite — đăng ký cá nhân)

Auto pairing **chỉ vận hành đúng khi đăng ký được tạo ở dạng cá nhân**, không phải dạng cặp có sẵn:

- Khi tạo `registrations` cho giải này, admin **chỉ chọn `player_1_id`, để `player_2_id = null`** — không được chọn sẵn đồng đội tại bước đăng ký (khác với cách dùng hiện tại của `saveReg2()`, vốn cho phép chọn cả `player_1_id` và `player_2_id` cùng lúc cho các nội dung đôi thông thường).
- Mỗi bản ghi `registrations` ở trạng thái chờ ghép cặp = **đúng 1 cá nhân**. Hệ thống chỉ coi 1 `registrations` là "1 cặp/1 đội" **sau khi** auto pairing đã chạy và cập nhật `player_2_id` (xem mục 9 — Chính sách merge).
- Đây là **tiền đề bắt buộc**, không phải điều kiện lọc: nếu quy trình đăng ký thực tế vẫn cho nhập sẵn cặp (`player_2_id` khác null ngay từ đầu) cho giải 1 năm AMZ, toàn bộ thiết kế auto pairing trong ADR này **không áp dụng được** — cần chốt lại quy trình đăng ký trước khi build.

## 5. Điều kiện hợp lệ để đưa vào auto pairing (Player eligibility)

Một VĐV **chỉ** được đưa vào tập dữ liệu đầu vào cho auto pairing khi thỏa **tất cả** điều kiện sau:

- `registrations.status = confirmed`
- `registrations.payment_status = paid`
- `registrations.player_2_id = null` (còn là cá nhân, chưa được ghép — theo tiền đề mục 4)
- Có `player_id` hợp lệ (liên kết đúng tới 1 hồ sơ `players` có thật)
- Có `event_id` đúng nhóm trình (Trình Thấp hoặc Trình Cao)
- `players.gender` đã có giá trị (không suy đoán từ tên/hình ảnh)
- `players.amz_rating` đã có giá trị
- **Không** thuộc nhóm pending / rejected / waitlist / thiếu thông tin

Thiếu bất kỳ điều kiện nào ở trên → VĐV đó **loại khỏi vòng random**, không đưa vào tính toán, không random tạm với dữ liệu thiếu.

## 6. Quy tắc điểm (Rating rule)

- `players.self_rating` — **chỉ là điểm tự khai**, không dùng để tính pairing.
- `players.amz_rating` — điểm AMZ/Ban chuyên môn đang chấm, là **nền để ghép cặp**, nhưng **không dùng trực tiếp và không bị sửa** bởi quy trình ghép cặp.
- `official_rating_snapshot` — điểm được **chụp lại** (copy giá trị `amz_rating` tại đúng thời điểm chạy random) và lưu riêng vào bản ghi `registrations` liên quan. Đây là field **mới**, hiện chưa tồn tại trong schema, cần audit/triển khai (xem mục 10, 14).
- **Không ghi đè `players.amz_rating`** vì bất kỳ lý do gì liên quan tới việc tính cặp — điểm trình cá nhân chỉ thay đổi qua quy trình xét trình/lịch sử trình riêng, tách biệt hoàn toàn khỏi luồng auto pairing.

## 7. Công thức điểm cặp đôi (Pair score formula)

```
pair_base_score = official_rating_snapshot_1 + official_rating_snapshot_2

gender_adjustment:
  Nam-Nam → +0.3
  Nam-Nữ  → 0
  Nữ-Nữ   → -0.3

pair_adjusted_score = pair_base_score + gender_adjustment
```

- `official_rating_snapshot_1`/`_2` là giá trị đã chụp tại thời điểm ghép (mục 6), **không phải** đọc trực tiếp `players.amz_rating` tại thời điểm sau này (tránh lệch nếu hồ sơ VĐV bị sửa sau khi đã ghép).
- Hệ số `+0.3 / 0 / -0.3` là **hệ số tạm thời cho giải này** — không phải hằng số cố định vĩnh viễn trong hệ thống.
- `pair_adjusted_score` chỉ dùng để hỗ trợ ghép cặp/chia bảng cho cân — **không dùng để chấp điểm trong trận đấu**.

## 8. Quy tắc ghép cặp (Pairing rule)

- **Random không phải random thuần túy** — là random có điều kiện, dựa trên `pair_adjusted_score` (rating + gender) để hỗ trợ cân bằng sức mạnh, không random vị trí hoàn toàn ngẫu nhiên.
- **Không cho VĐV tự chọn đồng đội.**
- **Không ghép cặp thủ công theo cảm tính** dưới bất kỳ hình thức nào, kể cả BTC tự ghép tay rồi nhập kết quả vào hệ thống.
- Trình Thấp: đủ 32 VĐV hợp lệ (theo mục 5) → hệ thống tự động random thành 16 cặp.
- Trình Cao: đủ 32 VĐV hợp lệ (theo mục 5) → hệ thống tự động random thành 16 cặp.
- Không random chéo giữa 2 `event_id` (không ghép Trình Thấp với Trình Cao).

## 9. Chính sách merge đăng ký sau khi ghép cặp (Merge policy)

Vì mỗi VĐV đăng ký ở dạng cá nhân (mục 4), khi auto pairing ghép 2 cá nhân thành 1 cặp, hệ thống phải **merge 2 bản ghi `registrations` thành 1**, không tạo bản ghi/collection mới cho "cặp":

- Chọn **1 trong 2 bản ghi `registrations`** làm bản ghi **chính** (primary) — cập nhật `player_2_id` = id của người còn lại, cộng thêm toàn bộ field pairing (mục 10).
- Bản ghi **cá nhân còn lại** (secondary) **không bị xóa** — được cập nhật:
  - `status = "merged"` (giá trị **mới**, thêm vào enum `status` hiện tại của `registrations` — trước đây chỉ có `pending`/`confirmed`/`rejected`).
  - `merged_into = <id của bản ghi chính>` (field **mới**, dùng để truy vết cặp đã hợp nhất vào đâu).
- Bản ghi có `status = "merged"` **bị loại vĩnh viễn** khỏi:
  - Tập dữ liệu đầu vào của `getEligiblePlayersForPairing()` (không lọt lại vào vòng random sau, kể cả khi bốc thăm lại).
  - Danh sách "Đội đã xác nhận thanh toán" ở tab Chia bảng và mọi danh sách đăng ký đang hoạt động — chỉ hiển thị lại nếu có màn hình audit/lịch sử riêng (ngoài phạm vi ADR này).
- **Không xóa bản ghi cá nhân gốc** dưới bất kỳ hình thức nào — giữ nguyên để có dấu vết ai đã đăng ký, đúng nguyên tắc không mất lịch sử đã chốt ở tài liệu quản lý dữ liệu VĐV dài hạn.
- Khi bốc thăm lại (mục 11), nếu bản ghi chính cũ bị ghép lại với người khác, bản ghi secondary cũ **vẫn giữ nguyên `status = merged`** — không tự động phục hồi về cá nhân; việc phục hồi (nếu cần) là thao tác thủ công riêng, ngoài phạm vi ADR này.

## 10. Lưu trữ dữ liệu (Data persistence)

Kết quả mỗi lần ghép cặp cần lưu tối thiểu các field sau (gắn vào bản ghi `registrations` liên quan, hoặc cấu trúc tương đương — chi tiết kỹ thuật để Claude Code đề xuất khi audit triển khai):

- `paired_at` — thời điểm chạy random.
- `paired_by` — người thao tác (tài khoản admin bấm nút).
- `pairing_batch_id` hoặc `pairing_seed` — định danh cho 1 lần chạy random, để truy vết/tái tạo nếu cần.
- `official_rating_snapshot` — điểm đã chụp tại thời điểm ghép (mục 6).
- `pair_adjusted_score` — kết quả tính theo công thức mục 7.
- `player_1_id`, `player_2_id` — 2 VĐV trong cặp.
- `event_id` — nhóm trình (Trình Thấp/Trình Cao).
- `tournament_id` — giải đấu liên quan.
- `status = "merged"` và `merged_into` — chỉ áp dụng cho bản ghi cá nhân **secondary** bị hợp nhất (xem mục 9 — Chính sách merge), không áp dụng cho bản ghi chính.

Toàn bộ field trên **hiện chưa tồn tại trong schema thật** — đây là phần việc kỹ thuật cần audit + thiết kế chi tiết trước khi code (xem mục 14), không được giả định đã có.

## 11. Quy tắc bốc thăm lại (Re-random rule)

- Nếu 1 nhóm trình **đã có kết quả ghép cặp**, nút "Ghép cặp lại" phải yêu cầu **xác nhận rõ ràng** (VD: hộp thoại xác nhận nêu rõ hậu quả — sẽ xóa/thay thế cặp hiện có) trước khi chạy.
- Mỗi lần bốc thăm lại phải **ghi nhận lại thời điểm và người thao tác** (dùng cùng field `paired_at`/`paired_by`, tăng `pairing_batch_id` mới).
- **Không được tự động ghi đè im lặng** — không có luồng nào cho phép random lại mà không qua bước xác nhận.

## 12. Không thuộc phạm vi ADR này (Non-goals)

- Không sửa cơ chế rating history / localStorage hiện tại trong ADR này (là một audit/quyết định riêng, khác phạm vi).
- Không làm thanh toán online.
- Không public `app-nextjs` (giữ nguyên theo ADR-0004).
- Không liên kết `tournaments`/`events` với `bookings`/`courts` (giữ nguyên theo ADR-0005).
- Không tạo Court Schedule collection mới (giữ nguyên theo ADR-0005).
- Không làm Cloud Function/server-side trong MVP này (xem mục 3 — để ngỏ cho tương lai, không quyết định ngay).

## 13. Rủi ro (Risks)

- **Random thiếu điều kiện** — nếu lọc sai (VD thiếu kiểm tra `payment_status`), có thể ghép cặp cho người chưa đủ điều kiện tham gia.
- **Mất lịch sử trình** — vẫn tồn tại do "Lịch sử trình" hiện là localStorage (rủi ro có sẵn từ trước, không phải do ADR này gây ra, nhưng cần lưu ý khi thiết kế `official_rating_snapshot` để không phụ thuộc vào cơ chế lịch sử chưa đáng tin cậy).
- **Ghi đè điểm cá nhân** — nếu code vô tình ghi `pair_adjusted_score` hoặc `official_rating_snapshot` đè lên `players.amz_rating` thay vì lưu riêng vào `registrations`.
- **Không gắn `player_id`** — nếu có đăng ký "mồ côi" (không trỏ tới hồ sơ VĐV thật) lọt vào vòng random.
- **Tranh cãi nếu không lưu kết quả bốc thăm** — nếu thiếu `paired_at`/`paired_by`/`pairing_batch_id`, không có cách chứng minh cặp đã ghép là ngẫu nhiên, hợp lệ khi có khiếu nại.
- **Công khai nhầm dữ liệu nhạy cảm** — nếu xuất danh sách cặp ra công khai mà lộ kèm SĐT/email/ghi chú nội bộ (xem `AMZ_1_YEAR_TOURNAMENT_DATA_CHECKLIST.md` mục 8).
- **Merge sai bản ghi** — nếu chọn nhầm bản ghi chính/phụ (mục 9), có thể ghi đè nhầm `player_1_id` hoặc đánh dấu `merged` lên bản ghi lẽ ra phải giữ làm chính, gây khó truy vết ai là "chủ" đăng ký ban đầu.
- **Đăng ký cá nhân bị nhập sai từ đầu** — nếu quy trình đăng ký thực tế không tuân thủ tiền đề mục 4 (VD admin lỡ chọn sẵn `player_2_id`), bản ghi đó sẽ không xuất hiện trong tập hợp lệ (mục 5) và bị loại khỏi vòng random mà không có cảnh báo rõ ràng nếu UI không kiểm tra riêng trường hợp này.

## 14. Kế hoạch triển khai (Implementation plan)

Triển khai theo **5 commit riêng biệt**, mỗi commit chỉ làm đúng 1 việc, không gộp:

- **Commit 1 — Hỗ trợ đăng ký cá nhân (bước nền, làm trước mọi bước pairing):**
  Cho phép tạo `registrations` với `player_1_id` có dữ liệu và `player_2_id = null` cho giải này (theo tiền đề mục 4). Không bắt buộc chọn đồng đội tại bước đăng ký. Không tự động coi 1 bản ghi cá nhân là 1 đội/cặp ở bất kỳ màn hình nào (Chia bảng, Lịch thi đấu...) cho tới khi đã qua auto pairing. Đây là **bước nền bắt buộc** — không có bước này thì Commit 2-5 không có dữ liệu đầu vào đúng để hoạt động.

- **Commit 2 — Helper functions thuần (không UI, không ghi Firestore):**
  Thêm `getEligiblePlayersForPairing()` (lọc theo điều kiện mục 5, bao gồm kiểm tra tiền đề `player_2_id = null` ở mục 4), `calculatePairAdjustedScore()` (công thức mục 7), `generateRandomPairs()` (ghép 32→16 theo mục 8, chưa ghi Firestore). Logic thuần, có thể kiểm chứng độc lập trước khi có giao diện.

- **Commit 3 — UI preview auto pairing (chưa ghi Firestore):**
  Đặt trong tab Chia bảng. Hiển thị 16 cặp dự kiến kèm rating (`official_rating_snapshot`), gender, và `pair_adjusted_score` từng cặp. Nút "Xác nhận & Lưu" ở bước này **chưa hoạt động thật** (chỉ preview, không ghi dữ liệu).

- **Commit 4 — Ghi Firestore + chính sách merge:**
  Thêm `savePairingResults()` — update bản ghi chính với `player_2_id` + toàn bộ field pairing (mục 10). Bản ghi phụ **không bị xóa**, được đánh dấu `status = "merged"` + `merged_into` (mục 9). Bản ghi đã `merged` **không được quay lại vòng random** ở bất kỳ lần chạy `getEligiblePlayersForPairing()` nào sau đó. Nối nút "Xác nhận & Lưu" ở Commit 3 với hàm này.

- **Commit 5 — Bốc thăm lại có xác nhận (re-random):**
  Thêm `rerandomWithConfirmation()` — kiểm tra event đã có cặp chưa, yêu cầu xác nhận rõ ràng nêu hậu quả (mục 11), tạo `pairing_batch_id` mới cho lần chạy lại, không tự động phục hồi bản ghi đã `merged` (mục 9), **không ghi đè im lặng** dưới bất kỳ hình thức nào.

Tách Commit 4 và 5 riêng vì rủi ro khác nhau: ghi Firestore lần đầu (dữ liệu mới, ít khả năng phá dữ liệu cũ) so với bốc thăm lại (có khả năng ghi đè/ảnh hưởng cặp đã tồn tại) — cho phép Owner/ChatGPT review riêng từng rủi ro. Commit 1 tách riêng đầu tiên vì là bước nền dữ liệu, không phải logic pairing — nếu quy trình đăng ký cá nhân chưa có, không thể kiểm thử được bất kỳ commit nào từ Commit 2 trở đi.

Mỗi bước cần Owner/ChatGPT xác nhận trước khi Claude Code triển khai, theo đúng `AMZ_DECISION_PROTOCOL.md`.
