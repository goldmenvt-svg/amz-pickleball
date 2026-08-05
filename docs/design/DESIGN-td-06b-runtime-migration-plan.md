# DESIGN — TD-06B: Kế hoạch runtime và migration an toàn

- **Trạng thái:** Accepted design — Owner chấp nhận ngày 2026-08-05; chưa cấp quyền triển khai
- **Ngày:** 2026-08-05
- **Mốc đầu vào:** TD-06A đã được Owner chấp nhận; commit Production được báo cáo là `f92231d`
- **Phạm vi:** kế hoạch triển khai, kiểm thử, migration, cutover và rollback; chưa cho phép sửa runtime, đọc/ghi dữ liệu Production, deploy hoặc migration
- **Liên quan:** `docs/design/DESIGN-td-06-data-contract.md`, ADR-0002, TD-06, TD-09

## 1. Mục tiêu

Đưa hợp đồng version 1 của TD-06A vào runtime theo từng pha có thể dừng và hoàn tác, với bốn kết quả bắt buộc:

1. Mọi writer mới chỉ ghi trường chuẩn; alias cũ chỉ còn được đọc tạm thời.
2. Migration `players` là idempotent, không tự giải quyết xung đột và không xóa alias trong lần đầu.
3. Hai snapshot public được tạo từ `players` + `tournaments`, có cùng metadata và nằm trong một commit Git duy nhất.
4. Không mất dữ liệu khi tách dần `settings/adminData`/`localStorage.amz_admin`; phần này giữ ranh giới với TD-09.

## 2. Bằng chứng runtime hiện hành

| Bề mặt | Hiện trạng quan sát trong code | Khoảng cách với TD-06A |
|---|---|---|
| `admin.html` save/load | Blob `settings/adminData`; ghi localStorage trước rồi debounce lên Firestore; lỗi Firestore thì dùng localStorage | Đây là nguồn bóng, không phải collection chuẩn |
| Import VĐV | Ghi trực tiếp `players`, nhưng chưa luôn tạo `elo_score`, `elo_version`, `is_active`, `updated_at` | Writer chưa đáp ứng đầy đủ schema version 1 |
| Export phía trình duyệt | Dựng JSON từ biến `players`/`tournaments`; `level` có thể fallback sang ELO | Sai quy tắc `level` chỉ dẫn xuất từ `amz_rating` |
| `api/push-data.js` | Nhận chuỗi JSON do client dựng; chỉ xóa `phone`/`email`; ghi hai file tuần tự | Thiếu allowlist/schema/TEST gate và tính nguyên tử |
| Snapshot | Chưa có `schemaVersion`, `snapshotId`, `generatedAt` dùng chung | Không thể chứng minh hai file cùng một lần xuất |

Không dùng bảng này để kết luận trạng thái dữ liệu Production. Count, trường thực tế, xung đột alias và cấu hình backup đều **chưa xác minh** cho tới G1/G4.

## 3. Ranh giới triển khai

### Trong TD-06B

- Adapter đọc tương thích cho `players` và `tournaments`.
- Writer chuẩn cho các luồng VĐV nằm trong phạm vi được duyệt.
- Tool inventory/migration chạy dry-run mặc định.
- Exporter server-side có validator và một commit nguyên tử.
- Test contract, migration, export, reader và rollback.
- Runbook staging/Production chỉ được thực thi sau phê duyệt riêng.

### Ngoài TD-06B

- Xóa alias cũ hoặc xóa `settings/adminData`.
- Tự động nhập localStorage từ mọi trình duyệt.
- Thay đổi nghiệp vụ registration, auto-pairing hoặc Elo.
- Deploy rules, xoay token, đổi DNS/Vercel/GitHub settings.
- Đọc/in PII hoặc dữ liệu cá nhân trong báo cáo.

TD-09 chịu trách nhiệm loại bỏ blob nguồn bóng. TD-06B chỉ thêm telemetry/read preference cần thiết để collection chuẩn có thể được xác minh trước; không được âm thầm sao chép blob hoặc localStorage vào collection chuẩn.

## 4. Kiến trúc chuyển tiếp

| Pha | Read path | Write path | Snapshot | Điều kiện quay lại |
|---|---|---|---|---|
| P0 — Baseline | Không đổi | Không đổi | Không đổi | Không áp dụng |
| P1 — Compatibility | Ưu tiên trường chuẩn, alias chỉ fallback và ghi metric | Writer hiện hành; chưa cutover | Export cũ chưa dùng Production mới | Tắt adapter/flag |
| P2 — Dual verification | Collection chuẩn là candidate; blob chỉ đối chiếu/read-only | Chỉ writer chuẩn trong staging | Export mới chạy dry-run, không publish | Trở về P1 |
| P3 — Writer cutover | Collection chuẩn | Chỉ trường chuẩn; chưa xóa alias cũ | Export mới có thể publish sau gate | Tắt writer mới, khôi phục code; dữ liệu chuẩn đã ghi được giữ lại |
| P4 — Snapshot cutover | Như P3 | Như P3 | Hai file/một commit | Revert commit snapshot/runtime và republish snapshot tốt gần nhất |
| P5 — Observe | Như P4 | Như P4 | Đối chiếu tự động | Dừng dọn alias; rollback theo P3/P4 |

Mỗi pha là một thay đổi reviewable riêng. Không gộp migration dữ liệu, writer cutover và export cutover vào cùng một commit/deploy.

## 5. Work packages dự kiến

### WP1 — Contract library và adapter đọc

- Định nghĩa validator/mapping thuần cho player, tournament và hai snapshot.
- Quy tắc ưu tiên đúng TD-06A; nếu canonical và alias cùng có nhưng khác nhau, trả `conflict`, không chọn im lặng.
- Không dùng `||` cho field số/boolean vì làm mất giá trị hợp lệ như `0` hoặc `false`.
- Telemetry chỉ ghi count/mã lỗi/ID băm hoặc ID kỹ thuật phù hợp; không log tên, phone, email, note.

**Nghiệm thu:** unit test đủ canonical-only, alias-only, cả hai giống nhau, cả hai xung đột, null/0/false và field không hợp lệ.

### WP2 — Inventory và migration tool

Tool phải có hai chế độ tách biệt:

- `--dry-run` mặc định: chỉ đọc, xuất tổng hợp count theo loại lỗi; không in PII.
- `--apply --approved-plan <hash>`: chỉ chạy khi báo cáo dry-run đã được Owner phê duyệt và backup đã xác minh.

Thuật toán theo document:

1. Đọc document và precondition/version hiện tại.
2. Map theo bảng TD-06A.
3. Nếu canonical/alias xung đột, thiếu `created_at`, kiểu sai hoặc giá trị ngoài validator: đưa vào quarantine report và không ghi.
4. Nếu hợp lệ, chỉ bổ sung/sửa trường chuẩn cần thiết; giữ alias.
5. Ghi bằng batch có giới hạn và precondition để không ghi đè thay đổi đồng thời.
6. Lưu migration run ID, target schema và checksum logic; không lưu PII trong log.

Migration phải chạy lại tạo `0` write. Không gán `updated_at` mới cho document vốn đã đạt chuẩn, vì việc đó phá idempotency.

### WP3 — Writer chuẩn

- Cập nhật từng writer tạo/sửa player để luôn ghi `full_name`, `amz_rating`, `elo_score`, `elo_version`, `is_active`, `created_at`, `updated_at` đúng hợp đồng.
- Giữ nguyên transaction/revision của luồng Elo; không biến migration thành cập nhật Elo nghiệp vụ.
- Writer mới không ghi `name`, `duprLevel`, `elo`, `isActive`, `createdAt`, `updatedAt`.
- Chặn ghi nếu adapter phát hiện xung đột chưa xử lý.

### WP4 — Exporter nguyên tử

Server tự đọc nguồn chuẩn sau khi xác thực admin; không tin payload JSON do client dựng làm nguồn dữ liệu cuối cùng.

Pipeline bắt buộc:

1. Đọc `players` và `tournaments` trong một export run; tạo `snapshotId` và `generatedAt` dùng chung.
2. Map bằng allowlist, validate kiểu/ID trùng/TEST/PII và quan hệ cần thiết.
3. Tạo hai blob JSON; canonical serialization để kết quả kiểm thử ổn định.
4. Dùng Git Data API (blob → tree từ SHA đầu vào → một commit → cập nhật ref bằng fast-forward có expected base SHA) hoặc cơ chế tương đương.
5. Nếu ref đã đổi, trả conflict và không retry mù; fetch/rebuild trên base mới sau kiểm tra riêng.
6. Đọc lại commit vừa tạo, xác minh đúng hai path và metadata chung rồi mới trả thành công.

Không dùng hai lần Contents API tuần tự. Response thành công phải trả `commitSha`, `snapshotId`, `schemaVersion`, counts và checksum của payload đã khử PII.

### WP5 — Dừng fallback có bảo toàn dữ liệu

TD-06B không xóa `localStorage.amz_admin`. Trước khi TD-09 cutover phải:

- Inventory aggregate cho `settings/adminData` và bản localStorage trên từng thiết bị quản trị do Owner chỉ định.
- So sánh ID/count/update time với collection chuẩn mà không xuất PII.
- Nếu local có bản ghi không tồn tại ở nguồn chuẩn, export backup mã hóa/kiểm soát truy cập và đưa vào hàng chờ reconcile; không tự merge.
- Khi Firestore lỗi, UI chuyển read-only/degraded mode và chặn thao tác ghi thay vì ghi local rồi báo như đã lưu bền vững.
- Chỉ xóa fallback sau thời gian quan sát và phê duyệt TD-09 riêng.

## 6. Backup, rollback và recovery

| Thành phần | Backup trước cutover | Rollback |
|---|---|---|
| Firestore `players` | Managed export hoặc bản export được mã hóa, kèm timestamp/project/count/checksum; restore rehearsal trên môi trường không phải Production | Restore có chọn lọc chỉ khi migration đã ghi sai; ưu tiên sửa forward vì alias chưa bị xóa |
| Runtime | Tag/SHA đã xác minh và artifact deploy trước đó | Revert commit runtime và redeploy theo quyền Owner |
| Snapshot public | Ghi nhận commit SHA tốt gần nhất và checksum hai file | Revert đúng commit nguyên tử hoặc republish cặp snapshot tốt; không khôi phục một file riêng lẻ |
| Blob/localStorage | Inventory + bản sao do Owner kiểm soát trước khi vô hiệu hóa | Bật lại read-only adapter; không bật lại silent local write |

Backup chỉ được coi là đạt khi có bằng chứng đọc/restore thử ở môi trường cô lập. “Đã bật scheduled backup” nhưng chưa kiểm tra restore không đủ điều kiện qua G4.

## 7. Gates và tiêu chí dừng

| Gate | Bằng chứng bắt buộc | Stop condition |
|---|---|---|
| G0 — Design | Owner chấp nhận TD-06B và ADR-0002 phù hợp | Hợp đồng còn điểm chưa quyết định |
| G1 — Inventory | Aggregate counts, field coverage, conflict/quarantine counts; không PII | Có canonical/alias conflict chưa có quyết định |
| G2 — Automated tests | Contract + migration + export atomicity + concurrency tests xanh | Lần chạy migration thứ hai còn write |
| G3 — Emulator/staging | Reader/writer/export end-to-end; fault injection từng bước | Có partial snapshot hoặc fallback ghi âm thầm |
| G4 — Production preflight | Backup + restore rehearsal + dry-run report + approved plan hash | Không chứng minh được backup/restore hoặc project ID sai |
| G5 — Migration | Batch report trước/sau, zero unexpected delete, quarantine không bị ghi | Count giảm, write conflict, error vượt ngưỡng được duyệt |
| G6 — Runtime/export cutover | Writer chuẩn và một commit/two snapshots; health checks | Git ref race, schema mismatch, PII/TEST hit |
| G7 — Observation | Count/checksum logic và site/admin khớp trong cửa sổ được Owner duyệt | Sai lệch dữ liệu, lỗi tăng hoặc cần fallback |
| G8 — Cleanup handoff | Báo cáo ổn định; TD-09 được phê duyệt riêng | Còn reader/writer phụ thuộc alias/blob/localStorage |

Ngưỡng số lượng cụ thể và thời gian quan sát là **chưa xác minh**; phải lấy từ G1 và được Owner chốt trước G4, không tự đặt trong code.

## 8. Thứ tự commit/deploy đề xuất

1. Tests/fixtures không chứa dữ liệu thật + contract library.
2. Inventory/migration tool ở chế độ dry-run mặc định.
3. Reader adapter + telemetry không PII, sau staging mới bật flag.
4. Writer chuẩn theo từng luồng, không xóa alias.
5. Exporter nguyên tử + client chỉ kích hoạt job; export cũ vẫn còn khả năng rollback trong thời gian ngắn.
6. Runbook và bằng chứng G1–G7.
7. TD-09 riêng để loại bỏ blob/localStorage và cuối cùng mới xem xét xóa alias.

Mỗi bước cần phê duyệt commit và deploy riêng. Firestore migration là một quyền riêng, không được suy ra từ quyền sửa/commit code.

## 9. Ma trận kiểm thử tối thiểu

- Contract: canonical/alias/conflict/null/0/false/invalid type/unknown field.
- Migration: dry-run zero writes; apply; rerun zero writes; concurrent update; partial batch failure; resume cùng run ID.
- Export: forbidden PII, TEST data, duplicate ID, missing rating, tournament mapping, common metadata, ref race, Git API failure ở từng bước.
- Atomicity: không trạng thái nào chỉ công bố một snapshot.
- Runtime: admin read/write chuẩn; static site render; ranking không dùng ELO làm `level`.
- Recovery: revert runtime, republish cặp snapshot tốt, restore rehearsal trên non-production.

Fixtures phải tổng hợp, không sao chép bản ghi Production.

## 10. Tiêu chí chấp nhận thiết kế TD-06B

- Owner chấp nhận ranh giới TD-06B/TD-09 và thứ tự work package.
- Chốt rằng exporter server-side đọc Firestore và dùng một Git commit nguyên tử.
- Chốt migration giữ alias, quarantine xung đột và mặc định dry-run.
- Chốt không silent fallback ghi local khi Firestore lỗi.
- Chốt backup chỉ đạt khi restore rehearsal thành công.
- Ghi rõ mọi lần sửa code, commit, deploy, đọc Production, backup hoặc migration đều cần phê duyệt riêng theo đúng ranh giới quyền.
