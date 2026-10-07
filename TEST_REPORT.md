# TEST REPORT — HSBA 2026.10.07.1

## Kết quả tĩnh

**26/26 kiểm tra tự động PASS.**

- Frontend ES module: syntax PASS (`node --check`).
- `sw.js`: syntax PASS.
- `Code.gs`: syntax PASS qua bản sao `.js`.
- `version.json`, `manifest.webmanifest`: JSON PASS.
- Không có ID DOM tĩnh trùng.
- Version frontend / Service Worker / version.json / Apps Script đồng bộ `2026.10.07.1`.
- `PUBLIC_SCHEMA_VERSION = 3`.

## Regression chính của release

PASS qua kiểm tra source:
- Không còn payload `storageStats` chứa `areas: undefined` hoặc `boxes: undefined`.
- Rebuild lấy thống kê quyển từ `quyenHoSo`/`storageStats`, không còn chỉ từ summary `doiTuong`.
- `storageStats` metadata vẫn giữ các trường tổng hợp và `inventory`, còn chi tiết `areas/boxes` nằm ở `congKhai/kho`.
- Private dashboard fallback sang full-scan `quyenHoSo` khi metadata storage thiếu/cũ.
- Render Dashboard chỉ ưu tiên `storageStats` khi `state.storageStatsLoaded === true`.
- Refresh storage stats đồng bộ cả Chuyển trung tâm và Khác.
- `0/0` quyển không còn hiển thị “Tất cả quyển hiện có đã được kiểm kê”.
- `startHsbaApp()` chỉ được kích hoạt sau khi production overrides đã được khai báo/gán.

## Nghiệp vụ bảo toàn

Kiểm tra tĩnh xác nhận vẫn còn:
- Firebase Realtime Database, không chuyển Firestore.
- `khoaThaoTac`.
- transaction `hsbaViTriLuuTru`.
- 2 khu `CHUNG` / `TU_VONG`.
- multi-file Google Drive + `hsbaFileChoXoa`.
- quyển tử vong phải còn file và là quyển cuối.
- realtime listener.
- PWA/Service Worker.

## Giới hạn kiểm thử

Môi trường kiểm tra không ghi vào Firebase/Google Drive production. Vì vậy nút `Cập nhật danh mục xem` cần được smoke-test sau deploy bằng tài khoản Quản trị. Release không tự migration hồ sơ vật lý và không thay Rules của các ứng dụng dùng chung database.
