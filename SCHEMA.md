# SCHEMA REALTIME DATABASE — 8.1.0

## 1. Các node cũ
Toàn bộ Rules và dữ liệu của HSBA, `tongHopYTe`, `yTeApp` và các node Báo cáo hiện hữu được giữ nguyên. Module Hành trình chuyển viện chỉ bổ sung node mới.

## 2. Danh bạ ứng dụng Y tế

```text
yTeApp/
  nguoiDung/
    {uid}/
      email
      displayName
      photoURL
      provider
      active
      createdAt
      updatedAt
      lastLoginAt
```

## 3. Quyền Báo cáo

```text
baoCaoYTe/
  phanQuyen/
    {uid}/
      email
      displayName
      role: admin | nhaplieu | viewer
      active: true | false
      source
      createdAt
      updatedAt
```

Quyền này dùng chung cho Chuyển viện và Tử vong.

## 4. Báo cáo cũ / Tử vong hiện hành

```text
baoCaoYTe/
  baoCao/
    {reportId}/
      id
      loaiBaoCao: CHUYEN_VIEN | TU_VONG
      ...
```

Các bản ghi Chuyển viện đã migration vẫn nằm tại đây và được hiển thị ở `Chuyển viện -> Lịch sử` với nhãn dữ liệu cũ. Báo cáo Tử vong tiếp tục sử dụng schema hiện tại.

## 5. Hành trình chuyển viện

```text
baoCaoYTe/
  hanhTrinhChuyenVien/
    {caseId}/
      thongTin/
        id
        doiTuong
        doiTuongNorm
        theBHYT
        theBHYTNorm
        doiTuongKey
        noiDiBanDau
        noiHienTai
        lyDoHienTai
        tinhTrangChanDoanHienTai
        trangThaiHienTai:
          TAI_KHAM |
          DANG_DIEU_TRI |
          CHUYEN_TIEP_BENH_VIEN_KHAC |
          TU_VONG_TAI_BENH_VIEN |
          DA_VE_TRUNG_TAM
        trangThaiKyThuat: OPEN | CLOSED
        ngayGioDi
        ngayGioVe
        tinhTrangKhiVe
        thuTuChang
        version
        createdAt
        createdByUid
        createdByEmail
        createdByName
        updatedAt
        updatedByUid
        updatedByEmail
        updatedByName

      chang/
        {stageId}/
          id
          caseId
          thuTu
          noiDi
          noiDen
          lyDo
          tinhTrangChanDoan
          trangThaiSauChang
          thoiDiem
          uid
          email
          displayName

      lichSu/
        {historyId}/
          id
          caseId
          loaiSuKien
          trangThaiTruoc
          trangThaiSau
          noiTruoc
          noiSau
          lyDo
          tinhTrangChanDoan
          tinhTrangKhiVe
          uid
          email
          displayName
          createdAt
```

`ngayGioDi`, `ngayGioVe`, `createdAt`, `updatedAt`, `thoiDiem` của module mới được ghi bằng Firebase Server Timestamp.

## 6. Chỉ mục hành trình đang mở

```text
baoCaoYTe/
  hanhTrinhDangMo/
    {doiTuongKey}: {caseId}
```

Node này được claim bằng Firebase Transaction để hạn chế tạo đồng thời hai hành trình đang mở cho cùng đối tượng. Khi hành trình kết thúc, chỉ mục được xóa.

## 7. Nhật ký chung

Module Hành trình tiếp tục ghi sự kiện nghiệp vụ vào:

```text
baoCaoYTe/
  nhatKy/
    YYYY-MM/
      {logId}/
```

Không tự động ghi dữ liệu sang `tongHopYTe/soLieuTheoNgay` và không tự tạo Báo cáo tử vong khi hành trình có trạng thái `TU_VONG_TAI_BENH_VIEN`.
