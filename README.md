# HSBA 2026.10.07.1 — Production handoff

Bản chốt ngày **07/10/2026** cho ứng dụng **Hồ sơ bệnh án lưu trữ – HSBA**.

## Phạm vi sửa lần này

1. Sửa lỗi nút **“Cập nhật danh mục xem”** báo:
   `set failed: value argument contains undefined in property 'congKhai._meta.storageStats.areas'`.
2. Sửa Dashboard hiển thị **Tổng quyển / Hết quyển / Tiến độ số hóa / Cơ cấu trạng thái / Thống kê giấy tờ = 0** trong khi dữ liệu `quyenHoSo` và `congKhai/kho` vẫn có quyển.
3. Đưa `quyenHoSo` trở lại vai trò **nguồn sự thật của số liệu quyển** khi rebuild dữ liệu dẫn xuất.
4. Sửa thứ tự khởi động module để `bindEvents`, `submitBook`, multi-file và các override production được gắn đúng implementation cuối cùng.
5. Đồng bộ frontend/PWA/File Service lên version `2026.10.07.1`.

## Root cause đã xử lý

- Rebuild trước đây tạo `storageStats` bằng `{ ...storageStats, areas: undefined, boxes: undefined }`. Firebase Realtime Database không chấp nhận `undefined`, nên toàn bộ lần ghi `congKhai/_meta` thất bại.
- `congKhai/_meta/stats` trước đây được rebuild từ các summary legacy trong `doiTuong`, trong khi số quyển thực tế nằm ở `quyenHoSo`. Vì vậy có thể xuất hiện `30 quyển đã xác định vị trí` nhưng `Tổng quyển = 0`.
- Khi `congKhai/kho` tồn tại nhưng `_meta/storageStats` thiếu/cũ, code cũ vẫn lấy metadata thiếu và biến nhiều chỉ số thành 0.
- Module từng khởi động trước các production override ở cuối file; một số event listener có thể giữ reference của implementation cũ.

## Hành vi sau sửa

- `Cập nhật danh mục xem` loại bỏ hẳn `areas`/`boxes` khỏi metadata thay vì ghi `undefined`; chi tiết thùng vẫn nằm ở `congKhai/kho`.
- Khi rebuild, thống kê quyển được tính từ `quyenHoSo`: tổng quyển, Hết quyển, Hồi gia, Tử vong, Chuyển trung tâm, Khác, số hóa và kiểm kê giấy tờ.
- Dashboard ưu tiên `storageStats` sau khi đã tải thành công; nếu metadata cũ/thiếu trong phiên private, hệ thống tự full-scan `quyenHoSo` một lần để phục hồi số liệu thay vì hiển thị 0 giả.
- Trường hợp thực sự chưa có quyển sẽ hiển thị “Chưa có quyển hồ sơ để thống kê thành phần giấy tờ”, không còn hiểu `0/0` là “đã kiểm kê hết”.
- `PUBLIC_SCHEMA_VERSION` tăng từ 2 lên 3; sau deploy Admin phải bấm **Cập nhật danh mục xem** một lần.

## Firebase Rules

**Không thay đổi logic Rules trong release này.**

File `FIREBASE_RULES_HSBA_DAN_DE.txt` đi kèm là **bản HSBA hiện tại do người dùng cung cấp ngày 07/10/2026**, giữ đúng handoff contract:
- bắt đầu từ `{"rules": {`;
- kết thúc bằng dấu phẩy sau `hsbaYeuCauDangKy`;
- không tự đóng object `rules`;
- không chứa hoặc thay đổi `tongHopYTe`, `yTeApp`, `baoCaoYTe`.

Nếu Firebase Rules đang chạy đúng bản 07/10/2026 này thì **không cần Publish Rules lại**.

## Apps Script

`Code.gs` trong release này là thế hệ File Service đầy đủ có:
- `taiFileLen`;
- `xoaFileTam`;
- `taoYeuCauXoaFile`;
- `xoaFileHoSo`;
- hàng đợi `hsbaFileChoXoa` và token xóa ký HMAC.

Nó thay thế Apps Script riêng `2026.09.09.1` đã gửi trước đó. Giữ nguyên Script Properties hiện tại, đặc biệt `FIREBASE_API_KEY`.

## File cần thay

### GitHub Pages
- `index.html`
- `sw.js`
- `version.json`

### Google Apps Script
- `Code.gs`

### Giữ nguyên
- `manifest.webmanifest`
- `assets/logo-192.png`
- `assets/logo-512.png`
- Firebase Rules hiện tại nếu đã đúng bản 07/10/2026.

## Thứ tự triển khai

1. Sao lưu GitHub, Apps Script và MASTER Firebase Rules hiện tại.
2. Cập nhật `Code.gs` trong đúng Apps Script project đang dùng; deploy version mới nhưng giữ URL Web App hiện tại.
3. Thay `index.html`, `sw.js`, `version.json` trên GitHub repository; giữ manifest/assets như cũ.
4. Chờ GitHub Pages deploy xong, mở ứng dụng và chọn cập nhật phiên bản nếu banner PWA xuất hiện.
5. Đăng nhập bằng **Quản trị**, bấm **Cập nhật danh mục xem** đúng 01 lần.
6. Mở **Thống kê tổng quan** và kiểm tra Tổng quyển, trạng thái, số hóa, giấy tờ và 2 khu lưu trữ.
7. Chỉ khi các số liệu hợp lý mới tiếp tục nhập/sửa hồ sơ bình thường.

## Smoke test bắt buộc

- Nút `Cập nhật danh mục xem` không còn lỗi `undefined ... storageStats.areas`.
- Với dữ liệu hiện có, `Tổng quyển` phải khớp số quyển thật trong `quyenHoSo`.
- `Hết quyển + Hồi gia + Tử vong + Chuyển trung tâm + Khác` phải phản ánh dữ liệu quyển thực tế.
- Tiến độ số hóa phải đếm được cả cấu trúc multi-file mới và file legacy.
- Thống kê 5 thành phần giấy tờ phải lấy từ dữ liệu quyển.
- `CHUNG/T1/V1` và `TU_VONG/T1/V1` vẫn được phép cùng tồn tại; trùng trong cùng khu vẫn bị chặn.
- Thêm/sửa quyển, multi-file, tử vong, lock, rollback và realtime vẫn hoạt động.
