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
| VĐV 2 (`player_2_id`) | Để **trống/null** ở bước đăng ký cá nhân ban đầu — chỉ điền sau khi đã bốc thăm ghép cặp xong (mục 7) |
| Thanh toán (`payment_status`) | `pending` (chưa đóng tiền) hoặc `paid` (đã đóng) |
| Check-in (`checkin_status`) | Mặc định `pending`, chuyển `checked_in` khi VĐV có mặt đúng ngày 18/07 |
| Số hạt giống (`seed_number`) | Để trống nếu không seed theo ELO, hoặc điền nếu BTC muốn seed khi chia bảng |
| Trạng thái (`status`) | `pending` (chờ duyệt) → `confirmed` (đã xét trình xong, hợp lệ) → `rejected` (từ chối, VD trùng đăng ký hoặc không hợp lệ) |

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
| "Chuyển trình" (Owner gọi là `moved_level`) | **Chưa có field riêng trong `registrations`** | `moved_level` **không phải và không được ghi như một status thật** — hệ thống không có field/giá trị này. Nếu có đổi trình sau khi xét: (a) ghi nhận VĐV vào đúng `event_id` (Trình Thấp/Cao) theo trình **đã xét**, không phải trình tự khai; (b) nếu cần lưu vết thay đổi, ghi qua tính năng có sẵn **"Lịch sử trình"** (tab History trong admin) hoặc một dòng **ghi chú vận hành** ngoài hệ thống (VD sổ tay/Google Sheet) — không tạo field/giá trị mới trong Firestore cho việc này |

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

Khi xuất/công bố danh sách VĐV, bảng đấu, lịch thi đấu ra kênh công khai (web/Facebook), **không hiển thị**:

- Số điện thoại đầy đủ của VĐV (nếu cần liên hệ công khai, chỉ hiển thị số tổng đài AMZ, không phải số cá nhân).
- Email cá nhân (nếu có thu thập).
- Ghi chú riêng/nội bộ về VĐV (VD: lý do đổi trình, phản hồi riêng, lịch sử tranh chấp nếu có).

Chỉ công khai: họ tên, trình/hạng thi đấu, tên bảng, kết quả trận đấu, lịch thi đấu (sân/giờ).

---

## 9. Checklist kiểm tra trước khi bốc thăm

- [ ] Toàn bộ VĐV dự kiến bốc thăm đã có `registrations.status = confirmed` (đã xét trình xong).
- [ ] Toàn bộ VĐV đó đã có `payment_status = paid`.
- [ ] Đã tách đúng danh sách theo `event_id` (Trình Thấp riêng, Trình Cao riêng) — không lẫn 2 trình.
- [ ] Số lượng mỗi trình đúng như kỳ vọng (32 VĐV/trình) hoặc đã có phương án xử lý nếu lệch số.
- [ ] Không có VĐV nào bị trùng lặp (cùng 1 người có 2 bản ghi `registrations`).

## 10. Checklist kiểm tra trước khi xếp bảng

- [ ] Đã bốc thăm xong, mỗi `registrations` đại diện 1 cặp đã có đủ `player_1_id` và `player_2_id`.
- [ ] Đúng 16 cặp/trình trước khi chia 4 bảng x 4 cặp.
- [ ] Nếu seed theo ELO, đã xác nhận `seed_number` hoặc dữ liệu ELO của từng VĐV là mới nhất (đối chiếu `players.elo`).
- [ ] Đã xác nhận `event_id` của các cặp đúng trình trước khi chạy chức năng chia bảng (chia nhầm trình sẽ phải reset lại toàn bộ bảng của nội dung đó).

## 11. Checklist kiểm tra trước khi công bố lịch

- [ ] Toàn bộ trận vòng bảng đã có `court_number` và `scheduled_time`.
- [ ] Không có VĐV/cặp nào bị xếp trùng giờ trên 2 sân khác nhau.
- [ ] Lịch vòng bảng nằm gọn trong khung 07:30 → dự kiến kết thúc trước 16:00 (chừa thời gian chuẩn bị Gala 16:30).
- [ ] Đã rà lại đúng phân sân: Sân 1–4 chỉ chứa trận Trình Thấp, Sân 5–8 chỉ chứa trận Trình Cao.
- [ ] Đã kiểm tra dữ liệu công khai trước khi đăng — không lộ số điện thoại/email/ghi chú riêng (xem mục 8).

---

## 12. Vai trò

**Owner / BTC**
- Xác nhận ngưỡng điểm phân trình (mục 2), chính sách khi thiếu/dư VĐV, giá trị `round_type` cho Tứ kết/Chung kết/Tranh hạng ba (mục 5) trước khi nhập dữ liệu thật.
- Theo dõi sổ tay nguồn đăng ký (mục 7) trong lúc tiếp nhận qua Facebook/Zalo/Hotline.

**Claude Code**
- Hỗ trợ nhập liệu/kiểm tra dữ liệu theo đúng checklist này khi được yêu cầu.
- Xác nhận lại giá trị `round_type` chính xác trong code trước khi BTC tạo trận Tứ kết/Chung kết/Tranh hạng ba lần đầu (mục 5 còn đang cần xác minh thêm).
- Không tự ý nhập/sửa dữ liệu giải đấu nếu chưa có yêu cầu rõ ràng từ Owner.
