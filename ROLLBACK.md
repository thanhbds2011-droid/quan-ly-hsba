# ROLLBACK 8.1.0

Nếu module Hành trình chuyển viện gặp lỗi sau deploy:

1. Khôi phục source GitHub về bản 8.0.3/commit trước 8.1.0.
2. Khôi phục Firebase Rules từ bản backup trước khi Publish 8.1.0.
3. Không xóa `baoCaoYTe/hanhTrinhChuyenVien` hoặc `baoCaoYTe/hanhTrinhDangMo`; hãy giữ dữ liệu để kiểm tra/khôi phục sau.
4. Không thay đổi `baoCaoYTe/baoCao`, HSBA, `tongHopYTe` hoặc `yTeApp`.

Source 8.0.3 không sử dụng hai node hành trình mới nên dữ liệu mới có thể được giữ nguyên trong thời gian rollback.
