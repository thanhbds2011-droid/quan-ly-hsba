# Kiểm thử Hành trình chuyển viện 8.1.0

- [ ] Rules JSON hợp lệ và chỉ bổ sung `baoCaoYTe/hanhTrinhChuyenVien`, `baoCaoYTe/hanhTrinhDangMo`.
- [ ] Không thay đổi Rules HSBA, `tongHopYTe`, `yTeApp` và các node `baoCaoYTe` cũ.
- [ ] Role `viewer` đọc được nhưng không ghi hành trình.
- [ ] Role `nhaplieu`/`admin` tạo được hành trình.
- [ ] Ngày giờ đi dùng Server Timestamp, không có input ngày/giờ cho người dùng sửa.
- [ ] Chặn hành trình đang mở trùng đối tượng.
- [ ] Chuyển tiếp tạo chặng mới.
- [ ] Tái khám/Đang điều trị cập nhật trạng thái nhưng không tạo chặng di chuyển giả.
- [ ] Đã về Trung tâm bắt buộc Tình trạng khi về và tự ghi Ngày + giờ về.
- [ ] Tử vong tại bệnh viện kết thúc hành trình, không tự tạo báo cáo tử vong.
- [ ] Ca kết thúc không còn trong Đang theo dõi.
- [ ] Lịch sử hiển thị timeline và dữ liệu chuyển viện cũ.
- [ ] Hành trình đã kết thúc không thể cập nhật tiếp.
- [ ] Giao diện mobile: 3 tab cùng hàng, 3 chỉ số cùng hàng, card hành trình và nút thao tác responsive.
