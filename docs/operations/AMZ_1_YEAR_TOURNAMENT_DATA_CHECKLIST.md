# Data Checklist — Giải Nội Bộ Kỷ Niệm 1 Năm AMZ Pickleball

> Tài liệu kỹ thuật dành cho người nhập dữ liệu vào trang quản trị (admin) và/hoặc Claude Code khi hỗ trợ nhập liệu. Đối chiếu trực tiếp với schema Firestore thật đang chạy trong `admin.html` (không phải thiết kế mới) — xem `docs/operations/AMZ_1_YEAR_TOURNAMENT_BRIEF.md` cho quy trình nghiệp vụ đầy đủ.

**Lưu ý quan trọng:** một số nhãn trạng thái Owner đề xuất (`approved`, `moved_level`, `unpaid`) **không khớp 1:1** với giá trị thật đang có trong hệ thống — xem mục "Trạng thái nên dùng" bên dưới để biết cách quy đổi đúng, tránh nhập sai giá trị vào Firestore.

---

## 1. Dữ liệu cần nhập vào `tournaments`

Nhập qua admin → tab "Giải đấu" → modal tạo giải. Field thật (tên field trong Firestore ghi trong ngoặc):

| Field | Giá trị cho giải này |
|---|---|
| Tên giải (`name`) | Giải Nội Bộ Kỷ Niệm 1 Năm AMZ Pickleball |
| Ngày bắt đầu (`start_date`) | 2026-07-18 |
| Ngày kết thúc (`end_date`) | 2026-07-18 (trùng ngày bắt đầu — giải 1 ngày) |
| Địa điểm (`venue`) | AMZ Pickleball (điền địa chỉ đầy đủ nếu cần) |
| Số sân sử dụng (`court_count`) | 8 |
| Trạng thái (`status`) | `draft` khi chưa mở đăng ký công khai → `open` khi bắt đầu nhận đăng ký → `ongoing` đúng ngày 18/07 → `closed` sau khi kết thúc |
| Mô tả (`description`) | Ghi thể lệ tóm tắt: 2 trình, 64 VĐV, lệ phí 300.000đ, luật điểm theo brief |

---

## 2. Dữ liệu cần nhập vào `events` (nội dung thi đấu — tương ứng 2 trình)

Nhập qua admin → tab "Nội dung thi đấu". Cần tạo **2 events**, mỗi trình 1 event, cùng thuộc `tournament_id` của giải này:

| Field | Trình Thấp | Trình Cao |
|---|---|---|
| Tên nội dung (`name`) | Trình Thấp — Đôi | Trình Cao — Đôi |
| Giải đấu (`tournament_id`) | (id giải vừa tạo ở mục 1) | (id giải vừa tạo ở mục 1) |
| Loại (`event_type`) | `mixed` hoặc loại phù hợp nhất — **cần Owner xác nhận** loại nội dung chính xác (đôi nam/đôi nữ/mixed trộn lẫn theo bốc thăm) vì hệ thống chỉ có 5 lựa chọn cố định (`mens_doubles`/`womens_doubles`/`mixed`/`mens_singles`/`womens_singles`), không có "đôi ngẫu nhiên/mở" | tương tự |
| Trạng thái (`status`) | `open` khi nhận đăng ký → `full` khi đủ 32 → `closed` sau hạn 16/07 | tương tự |
| Trình tối thiểu (`rating_min`) | theo mức trình Thấp Owner quy định (VD 2.0) | theo mức trình Cao Owner quy định (VD 3.5) |
| Trình tối đa (`rating_max`) | theo mức trình Thấp Owner quy định | theo mức trình Cao Owner quy định |
| Số đội tối đa (`max_players`) | 16 (số **cặp** tối đa, không phải số người — đặt tên field dễ gây nhầm) | 16 |
| Phí đăng ký (`entry_fee`) | 300000 | 300000 |

**Cần Owner chốt:** ngưỡng điểm trình cụ thể phân biệt Trình Thấp/Trình Cao (VD: dưới 3.0 = Thấp, từ 3.0 trở lên = Cao) để điền đúng `rating_min`/`rating_max`.

---

## 3. Dữ liệu cần nhập vào `registrations`

**Cảnh báo bắt buộc đọc trước khi nhập:**
- **Không mở form đăng ký công khai trên website** (`#regForm`) cho giải này — form đó hiện gửi qua Formspree (chỉ email) và lưu tạm vào `localStorage` trình duyệt, **không ghi vào Firestore**. Nếu dùng nhầm luồng này, dữ liệu đăng ký thật của VĐV sẽ không vào được hệ thống và có thể mất hoàn toàn.
- **Bug đã biết:** nút "+ Đăng ký" trên giao diện admin hiện mở nhầm modal cũ (không lưu Firestore) — **không dùng nút đó để nhập đăng ký thật** cho đến khi được kiểm tra/fix riêng. Cần dùng đúng luồng "Thêm VĐV vào nội dung" từ tab Nội dung thi đấu/Đăng ký giải đang hoạt động thật với Firestore; nếu không chắc nút nào đúng, xác nhận với Claude Code trước khi nhập hàng loạt.

Field thật cần điền cho **mỗi VĐV** (vì đăng ký là cá nhân, nhập từng người trước khi ghép cặp):

| Field | Ghi chú |
|---|---|
| Nội dung thi đấu (`event_id`) | Chọn đúng Trình Thấp hoặc Trình Cao sau khi đã xét trình |
| VĐV 1 (`player_1_id`) | Chọn VĐV có sẵn trong danh sách `players`, hoặc tạo mới nếu chưa có |
| VĐV 2 (`player_2_id`) | Để **trống/null** ở bước đăng ký cá nhân ban đầu — chỉ được điền **bởi hệ thống tự động bốc thăm ghép cặp**, không điền tay để "ghép hộ" VĐV (xem cảnh báo kỹ thuật ở cuối mục này) |
| Thanh toán (`payment_status`) | `pending` (chưa đóng tiền) hoặc `paid` (đã đóng) |
| Check-in (`checkin_status`) | Mặc định `pending`, chuyển `checked_in` khi VĐV có mặt đúng ngày 18/07 |
| Số hạt giống (`seed_number`) | Để trống nếu không seed theo ELO, hoặc điền nếu BTC muốn seed khi chia bảng |
| Trạng thái (`status`) | `pending` (chờ duyệt) → `confirmed` (đã xét trình xong, hợp lệ) → `rejected` (từ chối, VD trùng đăng ký hoặc không hợp lệ) |

### 3.1. Ghép cặp — bắt buộc tự động, KHÔNG ghép thủ công

**Yêu cầu nghiệp vụ chính thức (Owner chốt):** sau khi VĐV đăng ký xong và qua xét trình, việc bắt cặp ngẫu nhiên **phải hoàn toàn tự động bởi hệ thống** — không ghép thủ công theo cảm tính, không cho VĐV tự chọn đồng đội.

**⚠️ Xác nhận qua code — tính năng này CHƯA tồn tại:** đã kiểm tra `admin.html`, không có hàm random/shuffle nào ghép 2 VĐV cá nhân thành 1 cặp. Tab "Chia bảng" hiện tại chỉ nhận **các cặp đã có sẵn** (`registrations` đã điền đủ `player_1_id` và `player_2_id`) để chia vào `groups` — nó **không tạo cặp mới từ danh sách cá nhân**. Do đó: **không được giả định tính năng này đã hoạt động**. Đây là một hạng mục kỹ thuật cần audit + triển khai riêng, có Owner/ChatGPT chốt phương án trước khi Claude Code build, và cần hoàn tất + kiểm thử trước ngày thi đấu 18/07/2026.

**Điều kiện để một VĐV được đưa vào tập dữ liệu đầu vào cho bốc thăm tự động** (đề xuất filter khi build tính năng):
- `registrations.status = confirmed` (đã được duyệt tham gia).
- Có `event_id` hợp lệ (đã chốt Trình Thấp hoặc Trình Cao).
- `payment_status = paid` (đã xác nhận đóng tiền).
- **Đã có điểm trình cá nhân** — field thật là `players.amz_rating` (đã xác nhận qua code, `admin.html:1348`; fallback `self_rating` nếu `amz_rating` trống, nhưng nên yêu cầu `amz_rating` đã có giá trị sau xét trình, không dùng giá trị mặc định).
- **Đã có giới tính thi đấu** — field thật là `players.gender`, giá trị `male`/`female` (đã xác nhận qua code, `admin.html:891-894`) — đây là field **tự khai khi tạo hồ sơ VĐV**, không phải field mới. **Cần Owner/BTC xác nhận:** dùng thẳng giá trị `players.gender` có sẵn, hay bắt buộc BTC xác nhận lại giới tính thi đấu riêng cho giải này (phòng trường hợp hồ sơ cũ sai/thiếu) — nếu cần xác nhận lại riêng, phải audit thêm chỗ lưu (hiện chưa có field "giới tính đã BTC xác nhận cho giải X" tách biệt với `players.gender`).
- Không thuộc nhóm `pending`/`rejected`/thiếu `player_1_id`.

**Quy tắc ghép cặp khi build:**
- Trình Thấp: lọc đúng 32 VĐV hợp lệ theo điều kiện trên → random ghép thành 16 cặp.
- Trình Cao: lọc đúng 32 VĐV hợp lệ theo điều kiện trên → random ghép thành 16 cặp.
- Không random chéo giữa 2 `event_id` (không ghép Thấp với Cao).
- Không có bước cho phép VĐV chọn đồng đội theo ý muốn.
- **Random không phải random thuần túy** — phải là random có điều kiện, dùng `pair_adjusted_score` (công thức bên dưới) để hỗ trợ cân bằng sức mạnh khi ghép/chia bảng, không chỉ random vị trí thuần túy.

### 3.2. Điểm quy đổi cặp đôi (`pair_adjusted_score`) — công bằng theo cấu trúc giới tính

**Bối cảnh:** random thuần theo điểm trình có thể tạo ra cặp Nam-Nam/Nam-Nữ/Nữ-Nữ không cân sức dù tổng điểm bằng nhau. Owner yêu cầu tính thêm điểm quy đổi để hỗ trợ ghép cặp/chia bảng công bằng hơn.

**Công thức:**
```
pair_base_score = players[player_1_id].amz_rating + players[player_2_id].amz_rating

gender_adjustment (dựa trên players.gender của cả 2 người):
  male + male     → +0.3
  male + female   → 0
  female + female → -0.3

pair_adjusted_score = pair_base_score + gender_adjustment
```

**Ràng buộc bắt buộc:**
- `pair_adjusted_score` là **giá trị tính toán tạm thời tại thời điểm ghép cặp** — không phải field cố định, không ghi đè lên `players.amz_rating` của bất kỳ VĐV nào.
- **Không sửa `players.amz_rating` (điểm trình cá nhân) vĩnh viễn** vì lý do ghép cặp — điểm trình cá nhân chỉ thay đổi qua quy trình xét trình/lịch sử trình riêng, không liên quan tới phép tính này.
- Chỉ dùng `pair_adjusted_score` để: (a) hỗ trợ thuật toán ghép cặp tự động, (b) chia bảng cho cân, (c) cân bằng sức mạnh giữa các bảng/nhánh. **Không dùng để chấp điểm trong trận đấu.**
- Hệ số `+0.3 / 0 / -0.3` là **hệ số tạm thời cho giải này**, không phải hằng số cố định trong hệ thống — nếu build thành code, nên để dạng cấu hình dễ chỉnh (không hard-code cứng nếu tránh được), và cần Owner xác nhận lại cho từng giải sau.
- **Không suy đoán `gender` từ tên hoặc hình ảnh VĐV dưới bất kỳ hình thức nào** — chỉ đọc từ field `players.gender` đã có sẵn (tự khai hoặc BTC xác nhận), nếu field này trống thì VĐV đó **chưa đủ điều kiện** đưa vào random (xem mục 3.1).
- **Xác nhận qua code:** hiện `admin.html` không có hàm nào tính `pair_base_score`/`pair_adjusted_score` — đây là logic hoàn toàn mới, cần audit + triển khai cùng lúc với tính năng random ghép cặp (mục 3.1), không phải 2 việc tách rời.

**Minh bạch/audit (đề xuất, vì hệ thống chưa có audit log riêng cho hành động này):**
- Sau khi random xong, ghi kết quả trực tiếp vào `player_1_id`/`player_2_id` của từng `registrations` — đây chính là nơi lưu kết quả bốc thăm, không cần bảng dữ liệu mới.
- Nếu cần chạy random lại, phải có xác nhận của BTC trước — không tự động chạy lại khi phát hiện sai sót mà chưa hỏi.
- Vì `registrations` không có field lưu "ai bấm random, lúc nào", cần **ghi nhận thời điểm + người thao tác vào ghi chú vận hành ngoài hệ thống** (sổ tay/Google Sheet, cùng chỗ theo dõi `source` ở mục 7) cho tới khi có audit log thật trong code.

---

## 4. Dữ liệu cần nhập vào `groups`

Chỉ tạo **sau khi** đã bốc thăm ghép cặp xong và có đủ 16 cặp/trình. Có thể dùng chức năng "Chia bảng" tự động trong admin (tab Chia bảng → sinh bảng từ danh sách `registrations` có `status: confirmed`), hoặc nhập tay:

| Field | Ghi chú |
|---|---|
| Nội dung (`event_id`) | Trình Thấp hoặc Trình Cao |
| Tên bảng (`name`) | Bảng A / Bảng B / Bảng C / Bảng D (x2 vì mỗi trình 4 bảng) |
| Thứ tự bảng (`group_order`) | 1/2/3/4 |

Sau khi tạo bảng, hệ thống tự sinh các trận vòng bảng tương ứng trong `matches` (mục 5) — không cần tạo tay từng trận vòng bảng.

---

## 5. Dữ liệu cần nhập vào `matches`

Trận vòng bảng được **tự động sinh** khi tạo `groups` qua chức năng Chia bảng (mỗi bảng 4 cặp → 6 trận vòng tròn/bảng). Với các vòng sau, cần bổ sung/xác nhận field sau cho từng trận:

| Field | Ghi chú |
|---|---|
| Nội dung (`event_id`) | Trình Thấp hoặc Trình Cao |
| Bảng (`group_id`) | Có giá trị ở vòng bảng; **để trống (`null`)** từ Tứ kết trở đi |
| Loại vòng (`round_type`) | `group` (vòng bảng) → `quarterfinal` (Tứ kết) → `semifinal` (Bán kết) → `final` (Chung kết) → `third_place` (Tranh hạng ba) — **cần xác nhận với Claude Code** tên chính xác hệ thống dùng cho Tứ kết/Chung kết/Tranh hạng ba trước khi tạo, vì chỉ mới xác minh chắc chắn giá trị `group` và `semifinal` trong code hiện tại |
| Đội A / Đội B (`team_a_id`/`team_b_id`) | Trỏ tới `id` của bản ghi trong `registrations` (là cặp đã ghép, không phải từng cá nhân) |
| Sân (`court_number`) | 1–4 cho Trình Thấp, 5–8 cho Trình Cao |
| Giờ thi đấu (`scheduled_time`) | Điền sau khi xếp lịch |
| Tỷ số (`score_a`/`score_b`) | Điền sau khi có kết quả |
| Đội thắng (`winner_id`) | Điền sau khi có kết quả |
| Trạng thái (`status`) | `scheduled` → `completed` sau khi có kết quả |

---

## 6. Trạng thái nên dùng — quy đổi sang giá trị thật của hệ thống

Owner đề xuất dùng: `pending / approved / moved_level / unpaid / paid`. Đây là **cách gọi nghiệp vụ** (dễ hiểu cho người vận hành) — **không phải giá trị thật** trong Firestore. Bảng dưới đây tách rõ 2 cột để không ai nhập nhầm chữ nghiệp vụ trực tiếp vào hệ thống:

| A. Cách gọi nghiệp vụ (cho người vận hành) | B. Field/trạng thái thật trong hệ thống | Ghi chú |
|---|---|---|
| "Chờ duyệt" | `registrations.status = pending` | Khớp trực tiếp, có thể dùng đúng chữ này khi nhập |
| "Đã duyệt / hợp lệ" | `registrations.status = confirmed` | Hệ thống **không có giá trị `approved`** — chỉ có `confirmed`. Không được gõ `approved` vào Firestore |
| "Chưa đóng tiền" | `registrations.payment_status = pending` | Hệ thống **không có giá trị `unpaid`** — trạng thái "chưa đóng tiền" cũng dùng chung giá trị `pending` của field `payment_status` |
| "Đã đóng tiền" | `registrations.payment_status = paid` | Khớp trực tiếp |
| "Chuyển trình" (Owner gọi là `moved_level`) | **Chưa có field riêng trong `registrations`** | `moved_level` **không phải và không được ghi như một status thật** — hệ thống không có field/giá trị này. Nếu có đổi trình sau khi xét: (a) ghi nhận VĐV vào đúng `event_id` (Trình Thấp/Cao) theo trình **đã xét**, không phải trình tự khai; (b) nếu cần lưu vết thay đổi, xem cảnh báo quan trọng ở mục 9 về tính năng "Lịch sử trình" — hiện **không phải Firestore thật**, tạm dùng ghi chú vận hành ngoài hệ thống thay thế |

**Khuyến nghị:** người nhập liệu chỉ thao tác qua giao diện admin (chọn trong dropdown có sẵn), không tự gõ tay giá trị vào Firestore. Cột A chỉ để giao tiếp/trao đổi nghiệp vụ giữa Owner-BTC-Claude Code, cột B mới là giá trị thật cần chọn trên giao diện.

---

## 7. Mapping nguồn đăng ký (source: facebook / zalo / hotline / manual)

**Quan trọng:** `facebook / zalo / hotline / manual` ở đây chỉ là **cách gọi nghiệp vụ** để phân loại đăng ký đến từ đâu — **đây không phải và không được hiểu là một field thật đã tồn tại trong Firestore**.

- **Hệ thống hiện chưa có field `source`** trong schema `registrations`. Không có chỗ nào trong Firestore lưu được "đăng ký này đến từ Facebook hay Zalo hay Hotline".
- **Trong giải này, nguồn đăng ký nên theo dõi tạm bằng sổ tay/Google Sheet ngoài hệ thống hoặc ghi chú vận hành** — không nhập giá trị `facebook`/`zalo`/`hotline`/`manual` vào bất kỳ field nào trong admin vì không có chỗ chứa đúng nghĩa cho nó.
- Cột gợi ý cho sổ tay: Họ tên | SĐT | Trình khai báo | Nguồn (facebook/zalo/hotline) | Người tiếp nhận | Đã nhập vào admin? (có/chưa).
- Sau khi đối chiếu xong và nhập vào admin, đánh dấu "đã nhập" trong sổ tay để tránh nhập trùng.
- **Nếu sau này muốn lưu source trong Firestore thì phải là một task kỹ thuật riêng, có audit/review trước** (bổ sung field mới vào `registrations`) — không tự ý thêm field này khi đang vận hành giải, ngoài phạm vi tài liệu vận hành này.

---

## 8. Dữ liệu không được công khai

**Được công khai:**
- Tên VĐV
- Nhóm trình (Trình Thấp/Trình Cao)
- Cặp đấu
- Bảng đấu
- Lịch thi đấu (sân/giờ)
- Kết quả
- Thành tích

**Không được công khai:**
- Số điện thoại đầy đủ của VĐV (nếu cần liên hệ công khai, chỉ hiển thị số tổng đài AMZ, không phải số cá nhân).
- Email cá nhân.
- Ghi chú nội bộ (VD: lý do đổi trình, phản hồi riêng, lịch sử tranh chấp nếu có).
- Trạng thái thanh toán chi tiết (đã đóng/chưa đóng, số tiền, hình thức thanh toán).
- Nhận xét cá nhân nhạy cảm về VĐV (nếu có ghi trong `players.note` hoặc bất kỳ ghi chú nội bộ nào khác).

---

## 9. Quản lý dữ liệu VĐV dài hạn

**Nguyên tắc (Owner chốt):** Dữ liệu VĐV là **tài sản vận hành dài hạn của AMZ** — dùng cho các giải sau, xét trình sau, lịch sử thi đấu, thành tích, và vận hành cộng đồng, không chỉ dùng cho một giải rồi bỏ.

**Phân biệt các loại dữ liệu (đối chiếu đúng collection Firestore hiện có):**
- `players` — **hồ sơ gốc** của từng VĐV, tồn tại xuyên suốt, dùng lại cho mọi giải.
- `registrations` — **đăng ký theo từng giải** cụ thể, phải luôn gắn về đúng `player_1_id`/`player_2_id` trỏ tới hồ sơ `players` đã có.
- `matches` — **lịch sử trận đấu** (kết quả, tỷ số, đối thủ) theo từng giải.
- Lịch sử thay đổi điểm trình ("rating_history"/"Lịch sử trình") — **xem cảnh báo quan trọng bên dưới, hiện không đáng tin cậy.**
- `groups`/`matches` — dữ liệu bảng đấu, lịch thi đấu, kết quả của từng giải.

**Bắt buộc:** Mọi đăng ký giải (`registrations`) phải gắn về đúng `player_id` nếu VĐV đã có hồ sơ. Nếu là VĐV mới, phải **tạo hồ sơ `players` trước hoặc trong cùng lúc nhập đăng ký** — không tạo đăng ký "mồ côi" (không gắn về hồ sơ VĐV nào), vì sẽ làm mất khả năng tra cứu lịch sử/tái sử dụng dữ liệu cho giải sau.

**⚠️ Cảnh báo quan trọng — đính chính lại thông tin đã ghi trước đó:** Ở mục 6 và mục 3.1, tài liệu trước đây có nhắc tới tính năng **"Lịch sử trình" (tab History trong admin)** như một nơi có thể ghi nhận thay đổi điểm trình. Sau khi kiểm tra kỹ hơn: **tab này hiện đọc/ghi vào `db.history` — một mảng dữ liệu cục bộ lưu trong `localStorage`, KHÔNG phải Firestore thật** (cùng cơ chế cũ/hỏng với modal đăng ký cũ đã cảnh báo ở mục 3). Nghĩa là dữ liệu ghi vào "Lịch sử trình" hiện tại **không đồng bộ, không dùng chung được giữa các máy/trình duyệt, và có thể mất bất cứ lúc nào** — **đây không phải một cơ chế lưu trữ dài hạn đáng tin cậy** như có thể hiểu nhầm từ tài liệu trước. Cần audit/sửa riêng trước khi coi đây là giải pháp chính thức lưu lịch sử điểm trình.

**Mapping điểm số theo yêu cầu Owner — field nào đã có, field nào chưa:**

| Khái niệm Owner yêu cầu | Field thật tương ứng | Trạng thái |
|---|---|---|
| `self_declared_rating` (điểm/trình VĐV tự khai) | `players.self_rating` | ✅ Đã có (xác nhận qua code, `admin.html:1347`) |
| `amz_assessed_rating` (điểm AMZ/Ban chuyên môn chấm) | `players.amz_rating` | ✅ Đã có (xác nhận qua code, `admin.html:1348`) |
| `official_tournament_rating` (điểm chính thức dùng cho 1 giải cụ thể) | **Chưa có field riêng** | ❌ Chưa có — hiện chỉ có 1 giá trị `amz_rating` dùng chung cho mọi giải, không có snapshot riêng theo từng giải. Nếu điểm chính thức cần khác nhau giữa các giải, phải audit kỹ thuật riêng (VD thêm field snapshot trong `registrations`) — **không được giả định đã tồn tại** |
| `rating_confirmed_by` (người chốt điểm) | **Chưa có field nào** | ❌ Chưa có — không có field nào trong `players` hay `registrations` lưu "ai đã xác nhận điểm này". Cần audit riêng nếu Owner muốn có |
| `rating_note` (ghi chú điều chỉnh điểm) | `players.note` (tạm dùng) | ⚠️ Có field `note` chung (xác nhận qua code, `admin.html:927`), nhưng đây là **ghi chú chung cho VĐV** (VD "Forehand mạnh"), không riêng cho việc điều chỉnh điểm, và là **1 giá trị duy nhất** (ghi đè mỗi lần sửa, không phải nhật ký nhiều dòng) — dùng tạm được nhưng sẽ mất nội dung cũ nếu ghi đè, cần Owner quyết định có chấp nhận không hay cần cơ chế riêng |

**Không ghi đè mất lịch sử điểm trình:** nếu `amz_rating` của một VĐV thay đổi (VD sau xét trình lại, hoặc sau kết quả giải), **không chỉ ghi đè giá trị mới rồi mất giá trị cũ** — cần ghi nhận đầy đủ (điểm cũ, điểm mới, lý do, ngày) qua tính năng lịch sử trình thật (sau khi được audit/sửa để dùng Firestore) hoặc tạm thời qua ghi chú vận hành ngoài hệ thống (sổ tay/Google Sheet, cùng cách theo dõi `source` ở mục 7), cho tới khi có cơ chế kỹ thuật đáng tin cậy.

**Nguồn dữ liệu:** Facebook/Zalo/Hotline **chỉ là nguồn đầu vào** để tiếp nhận thông tin ban đầu — **nguồn quản lý chính thức, dài hạn của dữ liệu VĐV vẫn phải là hệ thống AMZ (admin/Firestore)**. Không coi sổ tay Facebook/Zalo/Hotline là nơi lưu trữ chính thức — mọi thông tin cuối cùng phải được nhập vào Firestore qua admin để có giá trị tái sử dụng lâu dài.

**Nếu hệ thống hiện chưa có đủ field để lưu các điểm trên** (`official_tournament_rating`, `rating_confirmed_by`, và cơ chế lịch sử điểm trình đáng tin cậy) — đây là **yêu cầu kỹ thuật cần audit/triển khai riêng**, không được giả định là đã có sẵn hoặc sẽ tự động hoạt động.

---

## 10. Checklist kiểm tra trước khi bốc thăm

- [ ] **Tính năng hệ thống tự động ghép cặp (kèm tính `pair_adjusted_score`) đã được audit/triển khai và kiểm thử thành công** — chưa có tính năng này thì chưa được tiến hành bốc thăm dưới bất kỳ hình thức nào, kể cả ghép tay tạm thời (xem mục 3.1, 3.2).
- [ ] Toàn bộ VĐV dự kiến bốc thăm đã có `registrations.status = confirmed` (đã xét trình xong).
- [ ] Toàn bộ VĐV đó đã có `payment_status = paid`.
- [ ] Toàn bộ VĐV đó đã có `players.amz_rating` (điểm trình cá nhân) — không còn ai trống điểm trình.
- [ ] Toàn bộ VĐV đó đã có `players.gender` (giới tính thi đấu, tự khai/BTC xác nhận) — không còn ai trống giới tính.
- [ ] Đã tách đúng danh sách theo `event_id` (Trình Thấp riêng, Trình Cao riêng) — không lẫn 2 trình.
- [ ] Số lượng mỗi trình đúng như kỳ vọng (32 VĐV/trình) hoặc đã có phương án xử lý nếu lệch số.
- [ ] Không có VĐV nào bị trùng lặp (cùng 1 người có 2 bản ghi `registrations`).

## 11. Checklist kiểm tra trước khi xếp bảng

- [ ] Đã bốc thăm xong, mỗi `registrations` đại diện 1 cặp đã có đủ `player_1_id` và `player_2_id`.
- [ ] Đúng 16 cặp/trình trước khi chia 4 bảng x 4 cặp.
- [ ] Nếu seed theo ELO, đã xác nhận `seed_number` hoặc dữ liệu ELO của từng VĐV là mới nhất (đối chiếu `players.elo`).
- [ ] Đã xác nhận `event_id` của các cặp đúng trình trước khi chạy chức năng chia bảng (chia nhầm trình sẽ phải reset lại toàn bộ bảng của nội dung đó).

## 12. Checklist kiểm tra trước khi công bố lịch

- [ ] Toàn bộ trận vòng bảng đã có `court_number` và `scheduled_time`.
- [ ] Không có VĐV/cặp nào bị xếp trùng giờ trên 2 sân khác nhau.
- [ ] Lịch vòng bảng nằm gọn trong khung 07:30 → dự kiến kết thúc trước 16:00 (chừa thời gian chuẩn bị Gala 16:30).
- [ ] Đã rà lại đúng phân sân: Sân 1–4 chỉ chứa trận Trình Thấp, Sân 5–8 chỉ chứa trận Trình Cao.
- [ ] Đã kiểm tra dữ liệu công khai trước khi đăng — không lộ số điện thoại/email/ghi chú riêng (xem mục 8).

---

## 13. Vai trò

**Owner / BTC**
- Xác nhận ngưỡng điểm phân trình (mục 2), chính sách khi thiếu/dư VĐV, giá trị `round_type` cho Tứ kết/Chung kết/Tranh hạng ba (mục 5) trước khi nhập dữ liệu thật.
- Theo dõi sổ tay nguồn đăng ký (mục 7) trong lúc tiếp nhận qua Facebook/Zalo/Hotline.
- Quyết định phương án cho các field còn thiếu ở mục 9 (`official_tournament_rating`, `rating_confirmed_by`, có chấp nhận tạm dùng `players.note` cho `rating_note` không).

**Claude Code**
- Hỗ trợ nhập liệu/kiểm tra dữ liệu theo đúng checklist này khi được yêu cầu.
- **Audit + đề xuất phương án kỹ thuật cho tính năng tự động ghép cặp** (xem mục 3.1 — hiện chưa tồn tại trong code), chỉ build sau khi Owner/ChatGPT chốt phương án.
- **Audit + đề xuất phương án cho quản lý dữ liệu VĐV dài hạn** (mục 9) — bao gồm sửa lại tính năng "Lịch sử trình" hiện đang dùng localStorage thay vì Firestore, và các field còn thiếu (`official_tournament_rating`, `rating_confirmed_by`).
- Xác nhận lại giá trị `round_type` chính xác trong code trước khi BTC tạo trận Tứ kết/Chung kết/Tranh hạng ba lần đầu (mục 5 còn đang cần xác minh thêm).
- Không tự ý nhập/sửa dữ liệu giải đấu nếu chưa có yêu cầu rõ ràng từ Owner.
