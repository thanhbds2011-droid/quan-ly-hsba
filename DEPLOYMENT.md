# TRIỂN KHAI PRODUCTION 8.1.0

## Thứ tự bắt buộc

### Bước 1 — Backup
1. Sao lưu Realtime Database Rules đang chạy.
2. Không chỉnh sửa HSBA, `tongHopYTe` hoặc dữ liệu `baoCaoYTe/baoCao`.

### Bước 2 — Publish Rules
Dán toàn bộ `firebase-rules.json` vào Firebase Realtime Database Rules và Publish.

So với Rules 8.0.3, bản này chỉ bổ sung dưới `baoCaoYTe`:
- `hanhTrinhChuyenVien`
- `hanhTrinhDangMo`

### Bước 3 — Upload source GitHub
Dán đè production 8.1.0 lên repo hiện tại.

File mới:
- `journeys.js`
- `journeys.css`

File nghiệp vụ được cập nhật:
- `index.html`
- `reports.js`
- `service-worker.js`
- `app-config.js`
- `app.js`

### Bước 4 — Chờ GitHub Pages deploy
Mở cửa sổ ẩn danh hoặc Ctrl+Shift+R.

### Bước 5 — Kiểm thử
Thực hiện checklist trong `TEST_HANH_TRINH_8.1.0.md`.

Không chạy lại migration. Dữ liệu Chuyển viện cũ được giữ nguyên và hiển thị trong Lịch sử.
