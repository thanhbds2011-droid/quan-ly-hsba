# MIGRATION PRECHECK — FILE BÁO CÁO

Nguồn kiểm tra: file Excel người dùng cung cấp.

- Báo cáo chuyển viện: 146 bản ghi có dữ liệu.
- Báo cáo tử vong: 11 bản ghi có dữ liệu.
- Không thiếu các trường bắt buộc chính trong dữ liệu hiện có.
- Có 1 ngày chuyển viện năm 2015 (`01/12/2015`) cần người dùng kiểm tra vì khác biệt lớn so với các bản ghi còn lại.
- Có một số trường hợp cùng bệnh nhân + cùng ngày chuyển viện xuất hiện nhiều hơn một dòng; migration chỉ cảnh báo, không tự xóa vì có thể là các lần chuyển viện/báo cáo hợp lệ khác nhau.
- `NĂM SINH` có cả dạng năm và ngày/tháng/năm nên production lưu dạng chuỗi để bảo toàn dữ liệu cũ.
