# CHANGELOG — HSBA 2026.10.07.1

## Dashboard / dữ liệu dẫn xuất
- Sửa nguồn tính `congKhai/_meta/stats`: số liệu quyển được rebuild từ `quyenHoSo` thay vì tin summary legacy trong `doiTuong`.
- `Tổng quyển`, Hết quyển, Hồi gia, Tử vong, Chuyển trung tâm, Khác, Có file/Chưa file được đồng bộ từ dữ liệu quyển thật.
- Dashboard ưu tiên `storageStats` sau khi đã load thành công.
- Private dashboard tự fallback full-scan `quyenHoSo` nếu `_meta/storageStats` thiếu/cũ.
- Sửa thông báo kiểm kê giấy tờ khi tổng quyển thực sự bằng 0.

## Rebuild “Cập nhật danh mục xem”
- Sửa lỗi Firebase từ `storageStats.areas = undefined` / `boxes = undefined`.
- Dùng destructuring để **loại bỏ hoàn toàn** `areas` và `boxes` khỏi metadata trước khi `set()`.
- Giữ chi tiết thùng ở `congKhai/kho`.
- `PUBLIC_SCHEMA_VERSION`: `2 → 3`.

## Runtime / event binding
- Dời thời điểm `startHsbaApp()` xuống cuối module.
- Bảo đảm chain override cuối cùng của `bindEvents`, `submitBook`, `updateBookStatusFields`, multi-file được dùng khi đăng ký listener.

## Version / PWA / Apps Script
- Frontend: `2026.10.07.1`.
- Service Worker/cache: `2026.10.07.1`.
- `version.json`: `2026.10.07.1`.
- Apps Script File Service: `2026.10.07.1`, giữ đầy đủ managed delete của thế hệ 2026.09.11.2.

## Firebase Rules
- Không thay đổi logic Rules.
- Handoff file giữ nguyên bản Rules HSBA hiện tại ngày 07/10/2026 và đúng ranh giới trước phần Tổng hợp số liệu.
