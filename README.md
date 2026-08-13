# Ứng dụng Phòng Y tế — Firebase Production 8.1.0

Bản 8.1.0 giữ nguyên kiến trúc quyền hiện tại và bổ sung **Hành trình chuyển viện** cho phân hệ Báo cáo.

## Phân hệ

1. **Tổng hợp số liệu** — giữ nguyên `tongHopYTe` và nghiệp vụ production hiện có.
2. **Báo cáo** — quyền dùng chung tại `baoCaoYTe/phanQuyen`:
   - **Chuyển viện**: Đang theo dõi / Lập chuyển viện / Lịch sử.
   - **Tử vong**: giữ nguyên nghiệp vụ báo cáo hiện tại.

Firebase Authentication dùng chung. Người dùng có thể được cấp quyền Tổng hợp, Báo cáo, cả hai hoặc không có quyền.

## Nguyên tắc 8.1.0

- Không dùng Firestore.
- Không thay đổi node HSBA.
- Không thay đổi schema/rules `tongHopYTe`.
- Không tự động ghi Chuyển viện/Tử vong sang Tổng hợp số liệu.
- Không tự tạo Báo cáo tử vong khi hành trình kết thúc bằng `Tử vong tại bệnh viện`.
- Ngày giờ nghiệp vụ của Hành trình chuyển viện dùng Firebase Server Timestamp.
- Một đối tượng không được mở đồng thời hai hành trình chuyển viện.
- Chuyển tiếp bệnh viện tạo chặng mới; chặng/lịch sử cũ không bị sửa đè.
- Hành trình kết thúc khi `Đã về Trung tâm` hoặc `Tử vong tại bệnh viện`.
- Role `viewer` chỉ xem; `nhaplieu` và `admin` được lập/cập nhật.

## Node bổ sung 8.1.0

```text
baoCaoYTe/
  hanhTrinhChuyenVien/{caseId}/
    thongTin
    chang/{stageId}
    lichSu/{historyId}

  hanhTrinhDangMo/{doiTuongKey}: {caseId}
```

Các node cũ `baoCaoYTe/baoCao`, `phanQuyen`, `lichSu`, `nhatKy`, `cauHinh`, `_migration` giữ nguyên.

## Dữ liệu chuyển viện cũ

Dữ liệu Chuyển viện đã migration vẫn nằm tại `baoCaoYTe/baoCao` và được hiển thị trong **Chuyển viện → Lịch sử** với nhãn **Dữ liệu cũ**. Không cần migration lại.

## File production chính

- `index.html`
- `styles.css`
- `ui-fixes.css`
- `reports.css`
- `journeys.css`
- `app.js`
- `reports.js`
- `journeys.js`
- `app-config.js`
- `service-worker.js`
- `manifest.webmanifest`
- `firebase-rules.json`

Xem `HUONG_DAN_NANG_CAP_8.1.0.txt` để triển khai và `TEST_HANH_TRINH_8.1.0.md` để kiểm thử.
