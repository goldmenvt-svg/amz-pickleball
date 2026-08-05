# TD-06 — Hồ sơ bằng chứng G0

- **Trạng thái hồ sơ:** Accepted — Owner nghiệm thu và đóng G0 ngày 2026-08-05
- **Ngày lập:** 2026-08-05
- **Gate:** G0 — xác minh điều kiện nền và quyết định thiết kế
- **Phạm vi:** bằng chứng repository cục bộ và dấu vết phê duyệt; không đọc dữ liệu Production
- **Mốc Production do Owner báo cáo:** `0ffcdc5c0a9d51d626ec9c00742cd63205039835`
- **Mốc kiểm toán cục bộ:** `6cd14c0d62d456d90e37e2b5709ae9895907c7a2`
- **Liên quan:** ADR-0002, TD-06A, TD-06B, TD-09

## 1. Mục đích và giới hạn kết luận

Hồ sơ này chứng minh các điều kiện thiết kế/quản trị của G0 và ghi nhận baseline tĩnh trước G1. Nó không chứng minh trạng thái dữ liệu, cấu hình backup, rules đang deploy hoặc hành vi runtime thực tế của Production.

Mốc `0ffcdc5c...` là bằng chứng do Owner cung cấp từ `HEAD` và `origin/master` của repository chính. Mốc `6cd14c0...` là commit QA cục bộ có nội dung TD-06B tương ứng nhưng lịch sử/SHA khác repository chính. Hai loại bằng chứng không được đánh đồng.

Không thao tác nào dưới đây được hồ sơ này cấp quyền:

- đọc Firestore/Production, trích xuất dữ liệu cá nhân từ bản ghi/snapshot, secret hoặc cấu hình tài khoản;
- chạy inventory, backup, restore, migration hoặc script cũ;
- sửa runtime, API, rules, snapshot hay dữ liệu;
- commit, push, deploy, publish hoặc thay đổi dịch vụ bên ngoài.

## 2. Quyết định đã được phê chuẩn

Ngày 2026-08-05, Owner xác nhận: “Chấp nhận ADR-0002 và cho phép chuẩn bị hồ sơ bằng chứng G0 cục bộ; chưa sửa code hoặc dữ liệu Production.”

Ngày 2026-08-05, Owner tiếp tục xác nhận: “Chấp nhận hồ sơ bằng chứng G0, cho phép đóng G0 và chuẩn bị commit cục bộ; chưa chuyển sang G1.”

Phạm vi quyết định:

1. Firestore là nguồn sự thật cho dữ liệu động thuộc TD-06.
2. `data/players.json` và `data/events.json` là snapshot công khai một chiều.
3. Hai snapshot phải có metadata chung và được công bố trong một commit Git nguyên tử.
4. Việc chấp nhận ADR không cấp quyền triển khai TD-06B hoặc chuyển sang G1.
5. Hồ sơ bằng chứng G0 được nghiệm thu và G0 được đóng; quyền chỉ giới hạn ở chuẩn bị commit cục bộ, không cấp quyền G1.

## 3. Sổ đăng ký bằng chứng

| ID | Bằng chứng | Nguồn | Mức xác minh | Kết quả |
|---|---|---|---|---|
| G0-E01 | TD-06A ghi nhận Owner đã chấp nhận design-only ngày 2026-08-05 | `docs/design/DESIGN-td-06-data-contract.md` | Xác minh cục bộ | Đạt |
| G0-E02 | TD-06B ghi nhận Owner đã chấp nhận thiết kế ngày 2026-08-05, chưa cấp quyền triển khai | `docs/design/DESIGN-td-06b-runtime-migration-plan.md` | Xác minh cục bộ | Đạt |
| G0-E03 | Repository chính được báo cáo sạch và đồng bộ tại `0ffcdc5c...` sau khi áp dụng TD-06B | Kết quả Git do Owner cung cấp | Owner-reported | Đạt có điều kiện; chưa xác minh trực tiếp từ remote |
| G0-E04 | Commit TD-06B chỉ gồm 4 tệp tài liệu, `188 insertions`, `2 deletions` | `git show --stat 6cd14c0...`; patch audit trước áp dụng | Xác minh cục bộ + Owner-reported | Đạt |
| G0-E05 | ADR-0002 đã được Owner chuyển từ `Proposed` sang `Accepted` ngày 2026-08-05 | `docs/adr/ADR-0002-firestore-single-source-of-truth.md` | Xác minh cục bộ | Đạt |
| G0-E06 | Admin vẫn có nguồn bóng `settings/adminData` và `localStorage.amz_admin`, gồm local-first write và fallback khi Firestore lỗi | `admin.html:4383-4443` | Xác minh tĩnh trong code | Khoảng cách đã biết; xử lý theo TD-06B/TD-09 |
| G0-E07 | Export phía client vẫn có thể suy `level` từ `elo_score` | `admin.html:4880-4900` | Xác minh tĩnh trong code | Không phù hợp TD-06A; chưa sửa ở G0 |
| G0-E08 | API chỉ xóa trực tiếp `phone`/`email` và ghi `events.json`, `players.json` tuần tự bằng hai lần `pushFile` | `api/push-data.js:113-125`, `api/push-data.js:149-152` | Xác minh tĩnh trong code | Thiếu allowlist và atomicity; chưa sửa ở G0 |
| G0-E09 | Hai snapshot repository không có `schemaVersion`, `snapshotId`, `generatedAt` ở top-level | Kiểm tra cấu trúc JSON cục bộ, không in bản ghi | Xác minh tĩnh | Chưa đạt contract version 1; xử lý ở gate sau |
| G0-E10 | Script migration cũ ghi `settings/adminData` và alias legacy (`name`, `duprLevel`, `elo`, `isActive`, `createdAt`, `updatedAt`) | `scripts/migrate-to-firestore.js:59-109` | Xác minh tĩnh trong code | Không được dùng làm migration TD-06B |
| G0-E11 | Không có bản ghi Firestore/Production, secret, backup hoặc cấu hình deploy nào được truy cập; kiểm tra snapshot chỉ lấy cấu trúc aggregate và không in phần tử | Nhật ký phạm vi phiên kiểm toán | Bằng chứng âm tính theo quy trình | Đúng ranh giới; trạng thái thật vẫn chưa xác minh |

## 4. Manifest baseline cục bộ

Các checksum dưới đây dùng để nhận biết chính xác tệp đã được kiểm toán. Chúng không chứng minh nội dung đang deploy trên Production. Hồ sơ này không tự băm chính nó để tránh phụ thuộc vòng.

| Tệp | SHA-256 |
|---|---|
| `admin.html` | `088aaf33fe195e568f8686785efc15d6d3f84fa83ac04836ae858d5c5dd387f1` |
| `api/push-data.js` | `7dda656148bcbf51657cd503006fbd9b79432e398ac7719249c87e130e41a22f` |
| `scripts/migrate-to-firestore.js` | `65f04bc784647baa39a7dfa4d26e2677cc70d5048cfe065d0665f4572d2aff66` |
| `firestore-schema.md` | `110d3ecc12e531c36afa4159a10f7d858148aaf20c4c472c2253f4f8a8fa29ff` |
| `firestore.rules` | `9467ac7f86b22470c5ae647fa7539b7490bac32e8b221922fd43f21f00164da0` |
| `docs/design/DESIGN-td-06-data-contract.md` | `9cbd01fb99edecda601e507e284bb3a4b7d888cd007d041df2628297296aa41b` |
| `docs/design/DESIGN-td-06b-runtime-migration-plan.md` | `94d7e5f0366fe2dcf7293c71451bc8cd5266c89173696a9392177c5adc079a15` |
| `docs/adr/ADR-0002-firestore-single-source-of-truth.md` | `a8baeea9878007353def648b2c6a9262f9c531a443053016dc00246c1bc1580b` |
| `docs/adr/README.md` | `c942b3c243bf89097f62ebba939e255e318494855887bb4e638f1da3af763587` |

## 5. Kiểm tra cấu trúc không đọc PII

Các kiểm tra JSON chỉ lấy tên khóa top-level và sự hiện diện của metadata; không in phần tử trong `players[]` hoặc `events[]`.

Kết quả baseline:

| Snapshot | Khóa top-level quan sát | Metadata contract version 1 |
|---|---|---|
| `data/players.json` | `lastUpdated`, `players` | Thiếu `schemaVersion`, `snapshotId`, `generatedAt` |
| `data/events.json` | `events`, `lastUpdated` | Thiếu `schemaVersion`, `snapshotId`, `generatedAt` |

Không dùng kết quả này để suy luận snapshot có đồng nhất với Firestore Production hay không.

## 6. Đánh giá gate G0

| Tiêu chí | Bằng chứng | Trạng thái |
|---|---|---|
| TD-06A đã được Owner chấp nhận | G0-E01 | Đạt |
| TD-06B đã được Owner chấp nhận | G0-E02 | Đạt |
| ADR-0002 phù hợp hợp đồng và được Owner chấp nhận chính thức | G0-E05 | Đạt |
| Khoảng cách runtime hiện hành đã được nhận diện tĩnh | G0-E06–G0-E10 | Đạt cho G0; chưa khắc phục |
| Không vượt quyền sang Production/G1 | G0-E11 | Đạt |
| Hồ sơ được Owner nghiệm thu và G0 được đóng rõ ràng | Quyết định Owner ngày 2026-08-05 | Đạt |

**Kết luận:** hồ sơ bằng chứng đã được Owner nghiệm thu và G0 được đóng ngày 2026-08-05. Trạng thái là `G0 CLOSED`; chưa chuyển sang G1 và quyết định đóng G0 không cấp bất kỳ quyền truy cập Production, đọc dữ liệu hoặc chạy tool nào.

## 7. Stop condition và ranh giới G1

Dừng ngay và không chuyển G1 nếu:

- SHA/baseline repository chính không còn khớp bằng chứng Owner đã cung cấp;
- ADR, TD-06A và TD-06B xuất hiện mâu thuẫn chưa có quyết định;
- kiểm tra yêu cầu đọc/in PII hoặc dùng secret ngoài phạm vi được duyệt;
- inventory tool không bảo đảm read-only/dry-run mặc định;
- chưa chốt danh sách collection, môi trường/project ID và định dạng báo cáo aggregate;
- có yêu cầu chạy `scripts/migrate-to-firestore.js` hoặc bất kỳ writer nào.

G1 cần phê duyệt riêng cho **kế hoạch inventory chỉ đọc**. Phê duyệt đóng G0 không mặc nhiên cho phép kết nối Production, đọc dữ liệu hoặc chạy tool.

## 8. Kiểm tra trước khi chuẩn bị commit cục bộ

- `git diff --check`
- xác minh diff chỉ có ADR-0002, chỉ mục ADR và hồ sơ G0;
- kiểm tra không có secret/PII hoặc dữ liệu bản ghi trong hồ sơ;
- xác minh checksum manifest sau lần sửa cuối;
- working tree vẫn cục bộ, remote local-only;
- chưa stage/commit/push/deploy/migration.
