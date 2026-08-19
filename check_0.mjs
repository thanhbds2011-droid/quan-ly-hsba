
    const HSBA_RUNTIME_ALLOWED =
  window.location.protocol === 'https:' &&
  (
    window.location.hostname.endsWith('.github.io') ||
    window.location.hostname === 'quan-ly-hsba.vercel.app' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

    if (!HSBA_RUNTIME_ALLOWED) {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('#loading')?.classList.add('hidden');
        document.querySelector('#authGate')?.classList.add('hidden');
        document.querySelector('#connectionBadge')?.classList.add('offline');
        if (document.querySelector('#connectionBadge')) {
          document.querySelector('#connectionBadge').textContent = 'XEM THỬ GIAO DIỆN';
        }
        const empty = document.querySelector('#patientsEmpty');
        if (empty) {
          empty.classList.remove('hidden');
          empty.innerHTML = `
            <div class="guest-access-card">
              <div class="guest-icon"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#i-eye"></use></svg></div>
              <h3>Đang xem thử giao diện</h3>
              <p>Dữ liệu trực tuyến chỉ được tải khi mở ứng dụng từ đường dẫn GitHub Pages chính thức.</p>
            </div>`;
        }
      });
    } else {
      const {
        initializeApp
      } = await import(
        'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js'
      );

      const {
        getAuth,
        GoogleAuthProvider,
        signInWithPopup,
        onAuthStateChanged,
        signOut,
        setPersistence,
        browserLocalPersistence
      } = await import(
        'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js'
      );

      const {
        getDatabase,
        ref,
        get,
        set,
        update,
        remove,
        query,
        orderByChild,
        equalTo,
        startAt,
        endAt,
        endBefore,
        limitToFirst,
        limitToLast,
        push,
        runTransaction,
        onValue,
        serverTimestamp
      } = await import(
        'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js'
      );

    const CONFIG = Object.freeze({
      OWNER_EMAIL: 'thanhbds2011@gmail.com',
      ACCESS_REQUEST_PATH: 'hsbaYeuCauDangKy',
      STORAGE_INDEX_PATH: 'hsbaViTriLuuTru',

      // Apps Script này chỉ dùng upload Google Drive; cấp quyền HSBA không còn phụ thuộc Apps Script/Google Sheet.
      DRIVE_UPLOAD_URL:
        'https://script.google.com/macros/s/AKfycbwTuGwnLDDDE7sUi2Isy4W_TwvboLaC-Qo7g5QqueSSS0Z_Mo8UxaTBq8eGaI6ax9Mz/exec',

      MAX_UPLOAD_BYTES: 20 * 1024 * 1024,
      PUBLIC_SCHEMA_VERSION: 1,

      // Giai đoạn 5: danh sách hồ sơ được tải theo trang thay vì tải toàn bộ.
      PATIENT_PAGE_SIZE: 50,
      PATIENT_SEARCH_LIMIT: 100,

      STATUS: {
        HET_QUYEN: 'Hết quyển',
        HOI_GIA: 'Đối tượng hồi gia',
        TU_VONG: 'Đối tượng tử vong',
        CHUYEN_TRUNG_TAM: 'Đối tượng chuyển trung tâm',
        KHAC: 'Khác',
        LEGACY_DANG_KHAM: 'Đang khám',
        LEGACY_LUU_KHO: 'Đã lưu kho'
      }
    });

    const firebaseConfig = Object.freeze({
      apiKey: "AIzaSyCDEcZZWhMbdNpDD6PEPmDgo68zo352jOU",
      authDomain: "hsba-trung-tam-test.firebaseapp.com",
      databaseURL:
        "https://hsba-trung-tam-test-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "hsba-trung-tam-test",
      storageBucket: "hsba-trung-tam-test.firebasestorage.app",
      messagingSenderId: "711784208666",
      appId: "1:711784208666:web:89c555a08ece8b7f44f4a3",
      measurementId: "G-W8JYRQNQMB"
    });

    const firebaseApp = initializeApp(firebaseConfig);
    const firebaseAuth = getAuth(firebaseApp);
    const firebaseDatabase = getDatabase(firebaseApp);
    const googleProvider = new GoogleAuthProvider();
    let authUpgradeInProgress = false;

    googleProvider.setCustomParameters({
      prompt: 'select_account'
    });

    /*
     * GitHub Pages chạy khác miền với firebaseapp.com.
     * Dùng cửa sổ đăng nhập Google để Safari giữ ổn định
     * trạng thái xác thực khi ứng dụng chạy trên GitHub Pages.
     */

    const NETWORK_ALLOWED =
      window.location.protocol === 'https:' ||
      ['localhost', '127.0.0.1'].includes(window.location.hostname);

    function uppercaseVietnamese(value) {
      return String(value || '').trim().toLocaleUpperCase('vi-VN');
    }

    function formatVietnamesePersonName(value) {
      const normalized = String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('vi-VN');

      return normalized.replace(
        /(^|[\s'-])(\p{L})/gu,
        (_, separator, letter) =>
          separator + letter.toLocaleUpperCase('vi-VN')
      );
    }

    function formatMedicalRecordNumber(value) {
      const compact = uppercaseVietnamese(value)
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10);

      if (!compact) return '';

      const letters = compact.slice(0, 2).replace(/[^A-Z]/g, '');
      const digits = compact.slice(2).replace(/\D/g, '').slice(0, 8);
      const parts = [letters];

      if (digits.length > 0) parts.push(digits.slice(0, 2));
      if (digits.length > 2) parts.push(digits.slice(2, 4));
      if (digits.length > 4) parts.push(digits.slice(4, 8));

      return parts.filter(Boolean).join('.');
    }

    function isValidMedicalRecordNumber(value) {
      return /^[A-Z]{2}\.\d{2}\.\d{2}\.\d{4}$/.test(
        String(value || '').trim()
      );
    }

    function firebaseKey(value) {
      const raw = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const slug = raw
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 70) || 'hoso';

      let hash = 2166136261;

      for (let index = 0; index < raw.length; index += 1) {
        hash ^= raw.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }

      return `${slug}_${(hash >>> 0).toString(36)}`;
    }

    function bookKey(quyenSo) {
      return `q_${String(Number(quyenSo) || 0).padStart(6, '0')}`;
    }

    function firebaseError(error) {
      const code = String(error?.code || '');

      if (
        code.includes('permission-denied') ||
        code.includes('PERMISSION_DENIED')
      ) {
        return new Error(
          'Tài khoản hiện tại chưa được cấp quyền thực hiện thao tác này. '
          + 'Vui lòng liên hệ người quản trị hệ thống.'
        );
      }

      if (code === 'auth/unauthorized-domain') {
        return new Error(
          'Địa chỉ truy cập hiện tại chưa được hệ thống cho phép. Vui lòng liên hệ người quản trị.'
        );
      }

      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        return new Error('Tài khoản hoặc mật khẩu không đúng.');
      }

      if (code === 'auth/invalid-email') {
        return new Error('Địa chỉ email không đúng định dạng.');
      }

      if (code === 'auth/user-disabled') {
        return new Error('Tài khoản đã bị vô hiệu hóa.');
      }

      if (code === 'auth/too-many-requests') {
        return new Error('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.');
      }

      if (code === 'auth/popup-blocked') {
        return new Error(
          'Safari đang chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.'
        );
      }

      if (code === 'auth/popup-closed-by-user') {
        return new Error(
          'Cửa sổ đăng nhập đã được đóng trước khi hoàn tất.'
        );
      }

      if (code === 'auth/cancelled-popup-request') {
        return new Error(
          'Đã có một cửa sổ đăng nhập khác đang mở. Vui lòng thử lại.'
        );
      }

      if (code.startsWith('auth/')) {
        return new Error(
          'Không đăng nhập được hệ thống. Vui lòng thử lại.'
        );
      }

      return error instanceof Error
        ? error
        : new Error('Không thực hiện được yêu cầu. Vui lòng thử lại.');
    }

    function normalizeRecordStatus(value) {
      const status = String(value || '').trim();
      if (status === CONFIG.STATUS.LEGACY_LUU_KHO) return CONFIG.STATUS.HET_QUYEN;
      if (status === CONFIG.STATUS.LEGACY_DANG_KHAM) return '';
      return status;
    }


    function normalizeStorageText(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
    }

    function storageLocationLabel(thungSo, viTriSo) {
      const box = Number(thungSo);
      const position = Number(viTriSo);
      if (!Number.isInteger(box) || box < 1 || !Number.isInteger(position) || position < 1) return '';
      return `Thùng ${box} - Vị trí ${position}`;
    }

    function storageLocationKey(thungSo, viTriSo) {
      const box = Number(thungSo);
      const position = Number(viTriSo);

      if (
        !Number.isInteger(box) || box < 1 ||
        !Number.isInteger(position) || position < 1
      ) {
        return '';
      }

      return `t_${String(box).padStart(6, '0')}_v_${String(position).padStart(6, '0')}`;
    }

    function parseStorageLocation(source = {}) {
      const directBox = Number(source.thungSo ?? source['THÙNG SỐ']);
      const directPosition = Number(source.viTriSo ?? source['VỊ TRÍ SỐ']);

      if (Number.isInteger(directBox) && directBox >= 1 && Number.isInteger(directPosition) && directPosition >= 1) {
        return {
          thungSo: directBox,
          viTriSo: directPosition,
          label: storageLocationLabel(directBox, directPosition),
          structured: true
        };
      }

      const legacy = String(source.maLuuTru ?? source['MÃ SỐ LƯU TRỮ'] ?? '').trim();
      const normalized = normalizeStorageText(legacy);
      const boxMatch = normalized.match(/thung\s*(?:so\s*)?(\d+)/);
      const positionMatch = normalized.match(/vi\s*tri\s*(?:so\s*)?(\d+)/);
      const parsedBox = boxMatch ? Number(boxMatch[1]) : 0;
      const parsedPosition = positionMatch ? Number(positionMatch[1]) : 0;

      if (Number.isInteger(parsedBox) && parsedBox >= 1 && Number.isInteger(parsedPosition) && parsedPosition >= 1) {
        return {
          thungSo: parsedBox,
          viTriSo: parsedPosition,
          label: storageLocationLabel(parsedBox, parsedPosition),
          structured: false
        };
      }

      return {
        thungSo: 0,
        viTriSo: 0,
        label: legacy,
        structured: false
      };
    }

    function findStorageLocationConflict(
      booksRoot,
      thungSo,
      viTriSo,
      ignorePatientId = '',
      ignoreBookKey = ''
    ) {
      const targetBox = Number(thungSo);
      const targetPosition = Number(viTriSo);

      for (const [patientId, patientBooks] of Object.entries(booksRoot || {})) {
        if (!patientBooks || typeof patientBooks !== 'object') continue;

        for (const [candidateBookKey, book] of Object.entries(patientBooks)) {
          if (!book || typeof book !== 'object') continue;

          if (
            patientId === ignorePatientId &&
            candidateBookKey === ignoreBookKey
          ) {
            continue;
          }

          const storage = parseStorageLocation(book);
          if (
            Number(storage.thungSo) === targetBox &&
            Number(storage.viTriSo) === targetPosition
          ) {
            return {
              patientId,
              bookKey: candidateBookKey,
              soHoSo: String(book.soHoSo || ''),
              quyenSo: Number(book.quyenSo) || 0,
              thungSo: targetBox,
              viTriSo: targetPosition
            };
          }
        }
      }

      return null;
    }

    function storageConflictMessage(conflict, thungSo, viTriSo) {
      const location = storageLocationLabel(thungSo, viTriSo);
      if (!conflict) {
        return `${location} đã được sử dụng. Vui lòng chọn vị trí khác.`;
      }

      const recordLabel = conflict.soHoSo
        ? `hồ sơ ${conflict.soHoSo}`
        : 'một hồ sơ khác';
      const bookLabel = conflict.quyenSo
        ? `, quyển ${conflict.quyenSo}`
        : '';

      return `${location} đã được sử dụng bởi ${recordLabel}${bookLabel}. `
        + 'Mỗi vị trí chỉ được lưu một quyển hồ sơ. Vui lòng chọn vị trí khác.';
    }

    const INVENTORY_FIELDS = [
      { key: 'soToChamSoc', uiKey: 'SỐ TỜ CHĂM SÓC', label: 'Tờ chăm sóc', shortLabel: 'Chăm sóc', unit: 'tờ' },
      { key: 'soToDieuTri', uiKey: 'SỐ TỜ ĐIỀU TRỊ', label: 'Tờ điều trị', shortLabel: 'Điều trị', unit: 'tờ' },
      { key: 'soPhieuTruyenDich', uiKey: 'SỐ PHIẾU TRUYỀN DỊCH', label: 'Phiếu truyền dịch', shortLabel: 'Truyền dịch', unit: 'phiếu' },
      { key: 'soPhieuDanhGiaTeNga', uiKey: 'SỐ PHIẾU ĐÁNH GIÁ TÉ NGÃ', label: 'Phiếu đánh giá nguy cơ té ngã', shortLabel: 'Té ngã', unit: 'phiếu' },
      { key: 'soPhieuDanhGiaLoetTiDe', uiKey: 'SỐ PHIẾU ĐÁNH GIÁ LOÉT TÌ ĐÈ', label: 'Phiếu đánh giá nguy cơ loét tì đè', shortLabel: 'Loét tì đè', unit: 'phiếu' }
    ];

    function optionalNonNegativeInteger(value) {
      if (value === null || value === undefined || String(value).trim() === '') return '';
      const number = Number(value);
      return Number.isInteger(number) && number >= 0 ? number : '';
    }

    function documentInventoryFromSource(source = {}) {
      const values = {};
      let complete = true;
      let total = 0;

      INVENTORY_FIELDS.forEach(field => {
        const value = optionalNonNegativeInteger(source[field.key] ?? source[field.uiKey]);
        values[field.key] = value;
        if (value === '') complete = false;
        else total += value;
      });

      return {
        ...values,
        complete,
        total: complete ? total : ''
      };
    }

    function formatDateVN(value) {
      const text = String(value || '').trim();
      if (!text) return '—';
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
      if (match) return `${match[3]}/${match[2]}/${match[1]}`;
      return text;
    }

    function patientToUi(id, patient = {}) {
      return {
        '_FIREBASE_ID': id,
        'SỐ HỒ SƠ': patient.soHoSo || '',
        'HỌ VÀ TÊN': formatVietnamesePersonName(patient.hoTen || ''),
        'NĂM SINH': patient.namSinh || '',
        'GIỚI TÍNH': patient.gioiTinh || '',
        'TỔNG SỐ QUYỂN': Number(patient.tongSoQuyen) || 0,
        'QUYỂN ĐANG MỞ': '',
        'TRẠNG THÁI MỚI NHẤT': normalizeRecordStatus(patient.trangThaiHienTai),
        '_SỐ QUYỂN HẾT QUYỂN': Number(
          patient.soQuyenHetQuyen ?? patient.soQuyenDaLuuKho
        ) || 0,
        '_SỐ QUYỂN HỒI GIA': Number(patient.soQuyenHoiGia) || 0,
        '_SỐ QUYỂN TỬ VONG': Number(patient.soQuyenTuVong) || 0,
        '_SỐ QUYỂN CHUYỂN TRUNG TÂM': Number(patient.soQuyenChuyenTrungTam) || 0,
        '_SỐ QUYỂN KHÁC': Number(patient.soQuyenKhac) || 0,
        '_SỐ QUYỂN CÓ FILE': Number(patient.soQuyenCoFile) || 0,
        '_UPDATED_AT': Number(patient.updatedAt) || 0
      };
    }

    function bookToUi(patient, book = {}) {
      const storage = parseStorageLocation(book);
      return {
        'SỐ HỒ SƠ': patient.soHoSo || '',
        'HỌ VÀ TÊN': formatVietnamesePersonName(patient.hoTen || ''),
        'NĂM SINH': patient.namSinh || '',
        'GIỚI TÍNH': patient.gioiTinh || '',
        'FILE ĐÍNH KÈM': book.fileDinhKem || '',
        'QUYỂN SỐ': Number(book.quyenSo) || 0,
        'NGÀY BẮT ĐẦU': book.ngayBatDau || '',
        'NGÀY KẾT THÚC': book.ngayKetThuc || '',
        'TRẠNG THÁI HIỆN TẠI': normalizeRecordStatus(book.trangThai),
        'NƠI TỬ VONG': book.noiTuVong || '',
        'NGUYÊN NHÂN TỬ VONG': book.nguyenNhanTuVong || '',
        'NGÀY HỒI GIA': book.ngayHoiGia || '',
        'NGÀY TỬ VONG': book.ngayTuVong || (normalizeRecordStatus(book.trangThai) === CONFIG.STATUS.TU_VONG ? book.ngayKetThuc || '' : ''),
        'NGÀY CHUYỂN TRUNG TÂM': book.ngayChuyenTrungTam || '',
        'NỘI DUNG KHÁC': book.noiDungKhac || '',
        'THÙNG SỐ': storage.thungSo || '',
        'VỊ TRÍ SỐ': storage.viTriSo || '',
        'MÃ SỐ LƯU TRỮ': storage.label || book.maLuuTru || '',
        'SỐ TỜ CHĂM SÓC': documentInventoryFromSource(book).soToChamSoc,
        'SỐ TỜ ĐIỀU TRỊ': documentInventoryFromSource(book).soToDieuTri,
        'SỐ PHIẾU TRUYỀN DỊCH': documentInventoryFromSource(book).soPhieuTruyenDich,
        'SỐ PHIẾU ĐÁNH GIÁ TÉ NGÃ': documentInventoryFromSource(book).soPhieuDanhGiaTeNga,
        'SỐ PHIẾU ĐÁNH GIÁ LOÉT TÌ ĐÈ': documentInventoryFromSource(book).soPhieuDanhGiaLoetTiDe,
        'TỔNG SỐ GIẤY TỜ': documentInventoryFromSource(book).total,
        '_ĐÃ KIỂM KÊ GIẤY TỜ': documentInventoryFromSource(book).complete,
        'GHI CHÚ': book.ghiChu || '',
        '_LEGACY_STATUS': book.trangThai || ''
      };
    }

    function deathToUi(item = {}) {
      const storage = parseStorageLocation(item);
      return {
        'SỐ HỒ SƠ': item.soHoSo || '',
        'HỌ VÀ TÊN': formatVietnamesePersonName(item.hoTen || ''),
        'NĂM SINH': item.namSinh || '',
        'GIỚI TÍNH': item.gioiTinh || '',
        'QUYỂN SỐ': Number(item.quyenSo) || 0,
        'NGÀY KẾT THÚC': item.ngayKetThuc || '',
        'NGÀY TỬ VONG': item.ngayTuVong || item.ngayKetThuc || '',
        'NĂM TỬ VONG': Number(item.namTuVong) || Number(String(item.ngayTuVong || item.ngayKetThuc || '').slice(0, 4)) || '',
        'NƠI TỬ VONG': item.noiTuVong || '',
        'NGUYÊN NHÂN TỬ VONG': item.nguyenNhanTuVong || '',
        'THÙNG SỐ': storage.thungSo || '',
        'VỊ TRÍ SỐ': storage.viTriSo || '',
        'MÃ SỐ LƯU TRỮ': storage.label || item.maLuuTru || '',
        'SỐ TỜ CHĂM SÓC': documentInventoryFromSource(item).soToChamSoc,
        'SỐ TỜ ĐIỀU TRỊ': documentInventoryFromSource(item).soToDieuTri,
        'SỐ PHIẾU TRUYỀN DỊCH': documentInventoryFromSource(item).soPhieuTruyenDich,
        'SỐ PHIẾU ĐÁNH GIÁ TÉ NGÃ': documentInventoryFromSource(item).soPhieuDanhGiaTeNga,
        'SỐ PHIẾU ĐÁNH GIÁ LOÉT TÌ ĐÈ': documentInventoryFromSource(item).soPhieuDanhGiaLoetTiDe,
        'TỔNG SỐ GIẤY TỜ': documentInventoryFromSource(item).total,
        '_ĐÃ KIỂM KÊ GIẤY TỜ': documentInventoryFromSource(item).complete,
        'FILE ĐÍNH KÈM': item.fileDinhKem || ''
      };
    }

    function calculateStats(patientObjects = []) {
      const patients = patientObjects.map(item => item || {});

      const stats = patients.reduce((result, patient) => {
        result.tongDoiTuong += 1;
        result.tongQuyenHoSo += Number(patient.tongSoQuyen) || 0;
        result.hoSoHetQuyen += Number(
          patient.soQuyenHetQuyen ?? patient.soQuyenDaLuuKho
        ) || 0;
        result.hoSoHoiGia += Number(patient.soQuyenHoiGia) || 0;
        result.hoSoTuVong += Number(patient.soQuyenTuVong) || 0;
        result.hoSoChuyenTrungTam += Number(patient.soQuyenChuyenTrungTam) || 0;
        result.hoSoKhac += Number(patient.soQuyenKhac) || 0;
        result.hoSoCoFile += Number(patient.soQuyenCoFile) || 0;
        return result;
      }, {
        tongDoiTuong: 0,
        tongQuyenHoSo: 0,
        hoSoHetQuyen: 0,
        hoSoHoiGia: 0,
        hoSoTuVong: 0,
        hoSoChuyenTrungTam: 0,
        hoSoKhac: 0,
        hoSoCoFile: 0,
        hoSoChuaFile: 0
      });

      stats.hoSoChuaFile = Math.max(
        0,
        stats.tongQuyenHoSo - stats.hoSoCoFile
      );

      return stats;
    }

    function hasPrivateHsbaAccess(role = state.currentRole) {
      return ['admin', 'editor', 'viewer'].includes(String(role || '').toLowerCase());
    }

    function isPublicSession() {
      return (
        !firebaseAuth.currentUser ||
        firebaseAuth.currentUser?.isAnonymous === true ||
        !hasPrivateHsbaAccess()
      );
    }

    function publicBookFromSource(book = {}) {
      const inventory = documentInventoryFromSource(book);
      const storage = parseStorageLocation(book);

      return {
        soHoSo: String(book.soHoSo || ''),
        quyenSo: Number(book.quyenSo) || 0,
        ngayBatDau: String(book.ngayBatDau || ''),
        ngayKetThuc: String(book.ngayKetThuc || ''),
        trangThai: normalizeRecordStatus(book.trangThai),
        ngayHoiGia:
          normalizeRecordStatus(book.trangThai) === CONFIG.STATUS.HOI_GIA
            ? String(book.ngayHoiGia || '')
            : '',
        ngayTuVong:
          normalizeRecordStatus(book.trangThai) === CONFIG.STATUS.TU_VONG
            ? String(book.ngayTuVong || book.ngayKetThuc || '')
            : '',
        ngayChuyenTrungTam:
          normalizeRecordStatus(book.trangThai) === CONFIG.STATUS.CHUYEN_TRUNG_TAM
            ? String(book.ngayChuyenTrungTam || '')
            : '',
        thungSo: Number(book.thungSo) || Number(storage.thungSo) || 0,
        viTriSo: Number(book.viTriSo) || Number(storage.viTriSo) || 0,
        maLuuTru: String(book.maLuuTru || storage.label || ''),
        soToChamSoc: Number(inventory.soToChamSoc) || 0,
        soToDieuTri: Number(inventory.soToDieuTri) || 0,
        soPhieuTruyenDich: Number(inventory.soPhieuTruyenDich) || 0,
        soPhieuDanhGiaTeNga: Number(inventory.soPhieuDanhGiaTeNga) || 0,
        soPhieuDanhGiaLoetTiDe: Number(inventory.soPhieuDanhGiaLoetTiDe) || 0,
        tongSoGiayTo: Number(inventory.total) || 0,
        updatedAt: Number(book.updatedAt) || Date.now()
      };
    }

    function publicPatientFromSource(patient = {}, bookMap = {}) {
      const publicBooks = {};

      Object.entries(bookMap || {}).forEach(([key, book]) => {
        if (!book) return;
        publicBooks[key] = publicBookFromSource(book);
      });

      const summaryBooks = Object.values(bookMap || {}).filter(Boolean);
      const normalizedBooks = summaryBooks.map(book => ({
        ...book,
        normalizedStatus: normalizeRecordStatus(book.trangThai)
      }));
      const latest = [...normalizedBooks].sort((a, b) => {
        const dateDifference = String(
          b.ngayKetThuc || b.ngayBatDau || ''
        ).localeCompare(String(a.ngayKetThuc || a.ngayBatDau || ''));
        if (dateDifference) return dateDifference;
        return Number(b.quyenSo || 0) - Number(a.quyenSo || 0);
      })[0] || null;

      return {
        soHoSo: String(patient.soHoSo || ''),
        hoTen: formatVietnamesePersonName(patient.hoTen || ''),
        hoTenTimKiem: String(
          patient.hoTenTimKiem || normalize(patient.hoTen || '')
        ),
        namSinh: Number(patient.namSinh) || 0,
        gioiTinh: String(patient.gioiTinh || ''),
        tongSoQuyen: summaryBooks.length,
        trangThaiHienTai:
          latest?.normalizedStatus ||
          normalizeRecordStatus(patient.trangThaiHienTai),
        soQuyenHetQuyen: normalizedBooks.filter(
          book => book.normalizedStatus === CONFIG.STATUS.HET_QUYEN
        ).length,
        soQuyenHoiGia: normalizedBooks.filter(
          book => book.normalizedStatus === CONFIG.STATUS.HOI_GIA
        ).length,
        soQuyenTuVong: normalizedBooks.filter(
          book => book.normalizedStatus === CONFIG.STATUS.TU_VONG
        ).length,
        soQuyenChuyenTrungTam: normalizedBooks.filter(
          book => book.normalizedStatus === CONFIG.STATUS.CHUYEN_TRUNG_TAM
        ).length,
        soQuyenKhac: normalizedBooks.filter(
          book => book.normalizedStatus === CONFIG.STATUS.KHAC
        ).length,
        soQuyenCoFile: Number(patient.soQuyenCoFile) || 0,
        updatedAt: Number(patient.updatedAt) || Date.now(),
        quyenHoSo: publicBooks
      };
    }

    function extractPublicCatalogEntries(value = {}) {
      if (!value || typeof value !== 'object') return [];

      // Hỗ trợ cả cấu trúc trực tiếp và các cấu trúc trung gian
      // từng được tạo trong quá trình thử nghiệm.
      const candidates = [
        value,
        value.data,
        value.items,
        value.hoSo,
        value.danhSach
      ].filter(item => item && typeof item === 'object');

      for (const source of candidates) {
        const entries = Object.entries(source)
          .filter(([key, patient]) => {
            if (key.startsWith('_')) return false;
            if (!patient || typeof patient !== 'object') return false;
            return Boolean(
              String(patient.soHoSo || '').trim() ||
              String(patient.hoTen || '').trim()
            );
          })
          .map(([id, patient]) => ({ id, patient: patient || {} }));

        if (entries.length) return entries;
      }

      return [];
    }

    async function readPublicCatalog() {
      const sortEntries = (entries) =>
        entries.sort((a, b) => {
          const updatedDifference =
            (Number(b.patient.updatedAt) || 0) -
            (Number(a.patient.updatedAt) || 0);

          if (updatedDifference) return updatedDifference;

          return String(a.patient.soHoSo || '')
            .localeCompare(String(b.patient.soHoSo || ''), 'vi');
        });

      // Chỉ dùng cấu trúc chính thức khi đã có dữ liệu.
      // Không gộp thêm các hồ sơ thử nghiệm cũ nằm trực tiếp dưới congKhai.
      try {
        const nestedSnapshot = await get(
          ref(firebaseDatabase, 'congKhai/hoSo')
        );
        const officialEntries = extractPublicCatalogEntries(
          nestedSnapshot.val() || {}
        );

        if (officialEntries.length) {
          return sortEntries(officialEntries);
        }
      } catch (error) {
        console.warn('Không đọc được congKhai/hoSo:', error);
      }

      // Chỉ dùng cấu trúc cũ như phương án tương thích khi hoSo chưa tồn tại.
      try {
        const rootSnapshot = await get(
          ref(firebaseDatabase, 'congKhai')
        );
        const rootValue = rootSnapshot.val() || {};
        const legacyEntries = [];

        Object.entries(rootValue).forEach(([id, patient]) => {
          if (
            id === '_meta' ||
            id === 'hoSo' ||
            id.startsWith('_') ||
            !patient ||
            typeof patient !== 'object'
          ) return;

          if (
            !String(patient.soHoSo || '').trim() &&
            !String(patient.hoTen || '').trim()
          ) return;

          legacyEntries.push({ id, patient });
        });

        return sortEntries(legacyEntries);
      } catch (error) {
        console.warn('Không đọc được danh mục công khai:', error);
        return [];
      }
    }

    async function readPublicDeaths() {
      const entries = await readPublicCatalog();
      const deaths = [];

      entries.forEach(({ patient }) => {
        Object.values(patient.quyenHoSo || {})
          .filter(Boolean)
          .forEach(book => {
            if (
              normalizeRecordStatus(book.trangThai) !==
              CONFIG.STATUS.TU_VONG
            ) return;

            deaths.push({
              soHoSo: patient.soHoSo || '',
              hoTen: patient.hoTen || '',
              namSinh: Number(patient.namSinh) || 0,
              gioiTinh: patient.gioiTinh || '',
              quyenSo: Number(book.quyenSo) || 0,
              ngayKetThuc: book.ngayKetThuc || '',
              namTuVong:
                Number(String(book.ngayKetThuc || '').slice(0, 4)) || 0,
              noiTuVong: '',
              nguyenNhanTuVong: '',
              thungSo: Number(book.thungSo) || 0,
              viTriSo: Number(book.viTriSo) || 0,
              maLuuTru: book.maLuuTru || '',
              soToChamSoc: Number(book.soToChamSoc) || 0,
              soToDieuTri: Number(book.soToDieuTri) || 0,
              soPhieuTruyenDich: Number(book.soPhieuTruyenDich) || 0,
              soPhieuDanhGiaTeNga:
                Number(book.soPhieuDanhGiaTeNga) || 0,
              soPhieuDanhGiaLoetTiDe:
                Number(book.soPhieuDanhGiaLoetTiDe) || 0,
              tongSoGiayTo: Number(book.tongSoGiayTo) || 0,
              fileDinhKem: '',
              updatedAt: Number(book.updatedAt) || 0
            });
          });
      });

      return deaths.sort(
        (a, b) =>
          (Number(b.updatedAt) || 0) -
          (Number(a.updatedAt) || 0)
      );
    }

    const firebaseDataCache = {
      uid: '',
      booksRoot: null,
      storageStats: null
    };

    function resetPrivateDataCache() {
      firebaseDataCache.uid = '';
      firebaseDataCache.booksRoot = null;
      firebaseDataCache.storageStats = null;
    }

    function ensurePrivateDataCacheOwner() {
      const uid = String(firebaseAuth.currentUser?.uid || '');

      if (!uid) {
        throw new Error('Phiên chỉnh sửa đã hết hạn. Vui lòng đăng nhập lại.');
      }

      if (firebaseDataCache.uid !== uid) {
        firebaseDataCache.uid = uid;
        firebaseDataCache.booksRoot = null;
        firebaseDataCache.storageStats = null;
      }

      return uid;
    }

    function invalidateStorageCache() {
      firebaseDataCache.storageStats = null;
      state.storageStatsLoaded = false;
    }

    async function readBooksRootCached(forceRefresh = false) {
      ensurePrivateDataCacheOwner();

      if (!forceRefresh && firebaseDataCache.booksRoot !== null) {
        return firebaseDataCache.booksRoot;
      }

      const snapshot = await get(ref(firebaseDatabase, 'quyenHoSo'));
      firebaseDataCache.booksRoot = snapshot.val() || {};
      invalidateStorageCache();

      return firebaseDataCache.booksRoot;
    }

    function cachedBooksForPatient(patientId) {
      ensurePrivateDataCacheOwner();

      if (firebaseDataCache.booksRoot === null) return null;
      return firebaseDataCache.booksRoot[patientId] || {};
    }

    function patchBooksRootCache(oldPatientId, newPatientId, bookMap) {
      if (firebaseDataCache.booksRoot !== null) {
        const nextRoot = { ...firebaseDataCache.booksRoot };

        if (oldPatientId) {
          delete nextRoot[oldPatientId];
        }

        if (
          newPatientId &&
          bookMap &&
          Object.values(bookMap).some(Boolean)
        ) {
          nextRoot[newPatientId] = bookMap;
        }

        firebaseDataCache.booksRoot = nextRoot;
      }

      invalidateStorageCache();
    }

    function patientCatalogPath() {
      return isPublicSession()
        ? 'congKhai/hoSo'
        : 'doiTuong';
    }

    function snapshotPatientEntries(snapshot) {
      const entries = [];

      snapshot.forEach(childSnapshot => {
        const patient = childSnapshot.val() || {};
        if (!patient || typeof patient !== 'object') return;
        entries.push({
          id: childSnapshot.key,
          patient
        });
      });

      return entries;
    }

    function sortPatientEntriesNewest(entries = []) {
      return [...entries].sort((a, b) => {
        const updatedDifference =
          (Number(b.patient?.updatedAt) || 0) -
          (Number(a.patient?.updatedAt) || 0);

        if (updatedDifference) return updatedDifference;

        return String(b.id || '').localeCompare(String(a.id || ''));
      });
    }

    async function readPatientPage(cursor = null) {
      const sourceRef = ref(firebaseDatabase, patientCatalogPath());
      const constraints = [orderByChild('updatedAt')];

      if (cursor?.updatedAt !== undefined && cursor?.key) {
        constraints.push(
          endBefore(Number(cursor.updatedAt) || 0, String(cursor.key))
        );
      }

      // Lấy thêm 1 bản ghi để biết còn trang kế tiếp hay không.
      constraints.push(limitToLast(CONFIG.PATIENT_PAGE_SIZE + 1));

      const snapshot = await get(query(sourceRef, ...constraints));
      const ordered = sortPatientEntriesNewest(
        snapshotPatientEntries(snapshot)
      );
      const hasMore = ordered.length > CONFIG.PATIENT_PAGE_SIZE;
      const entries = ordered.slice(0, CONFIG.PATIENT_PAGE_SIZE);
      const last = entries[entries.length - 1] || null;

      return {
        entries,
        hasMore,
        cursor: last
          ? {
              updatedAt: Number(last.patient?.updatedAt) || 0,
              key: last.id
            }
          : null
      };
    }

    async function readPatientTotalCount() {
      try {
        const snapshot = await get(
          ref(firebaseDatabase, 'congKhai/_meta/patientCount')
        );
        if (!snapshot.exists()) return null;
        const count = Number(snapshot.val());
        return Number.isFinite(count) && count >= 0 ? count : null;
      } catch (error) {
        console.warn('Không đọc được tổng số hồ sơ:', error);
        return null;
      }
    }

    function prefixRangeQuery(path, childKey, prefix, limit) {
      return query(
        ref(firebaseDatabase, path),
        orderByChild(childKey),
        startAt(prefix),
        endAt(`${prefix}\uf8ff`),
        limitToFirst(limit)
      );
    }

    async function searchPatientEntriesRemote(keyword) {
      const raw = String(keyword || '').trim();
      if (!raw) return [];

      const path = patientCatalogPath();
      const upper = normalize(raw);
      const tasks = [];

      // Số hồ sơ: hỗ trợ đúng số hoặc tiền tố, ví dụ HA.11 hoặc HA.11.11.1111.
      if (/^[A-Z0-9.]+$/i.test(raw.replace(/\s+/g, ''))) {
        const compactRecord = uppercaseVietnamese(raw).replace(/\s+/g, '');
        const recordPrefix = /^[A-Z]{1,2}/.test(compactRecord)
          ? (formatMedicalRecordNumber(compactRecord) || compactRecord)
          : compactRecord;
        tasks.push(
          get(prefixRangeQuery(
            path,
            'soHoSo',
            recordPrefix,
            CONFIG.PATIENT_SEARCH_LIMIT + 1
          ))
        );
      }

      // Năm sinh: tìm chính xác khi người dùng nhập 4 chữ số.
      if (/^\d{4}$/.test(raw)) {
        tasks.push(
          get(query(
            ref(firebaseDatabase, path),
            orderByChild('namSinh'),
            equalTo(Number(raw)),
            limitToFirst(CONFIG.PATIENT_SEARCH_LIMIT + 1)
          ))
        );
      }

      // Giới tính: tìm chính xác khi nhập Nam/Nữ.
      if (upper === 'NAM' || upper === 'NỮ') {
        tasks.push(
          get(query(
            ref(firebaseDatabase, path),
            orderByChild('gioiTinh'),
            equalTo(upper === 'NAM' ? 'Nam' : 'Nữ'),
            limitToFirst(CONFIG.PATIENT_SEARCH_LIMIT + 1)
          ))
        );
      }

      // Họ tên: Realtime Database hỗ trợ tìm theo tiền tố trên trường đã index.
      // Ví dụ "NGUYỄN" tìm được các tên bắt đầu bằng NGUYỄN.
      if (upper) {
        tasks.push(
          get(prefixRangeQuery(
            path,
            'hoTenTimKiem',
            upper,
            CONFIG.PATIENT_SEARCH_LIMIT + 1
          ))
        );
      }

      const snapshots = await Promise.all(tasks);
      const byId = new Map();

      snapshots.forEach(snapshot => {
        snapshotPatientEntries(snapshot).forEach(entry => {
          byId.set(entry.id, entry);
        });
      });

      return sortPatientEntriesNewest([...byId.values()])
        .slice(0, CONFIG.PATIENT_SEARCH_LIMIT);
    }

    // Chỉ dùng cho thao tác quản trị sửa chữa/rebuild toàn bộ danh mục công khai.
    // Luồng đăng nhập và danh sách thường ngày không gọi hàm full-read này.
    async function readPatientSummaries() {
      const patientSnapshot = await get(
        ref(firebaseDatabase, 'doiTuong')
      );
      const value = patientSnapshot.val() || {};

      return Object.entries(value)
        .map(([id, sourcePatient]) => ({
          id,
          patient: sourcePatient || {}
        }))
        .sort((a, b) => {
          const updatedDifference =
            (Number(b.patient.updatedAt) || 0) -
            (Number(a.patient.updatedAt) || 0);

          if (updatedDifference) return updatedDifference;

          return String(a.patient.soHoSo || '')
            .localeCompare(String(b.patient.soHoSo || ''), 'vi');
        });
    }

    async function readDeathObjects() {
      const snapshot = await get(ref(firebaseDatabase, 'hoSoTuVong'));
      const value = snapshot.val() || {};

      return Object.values(value)
        .map(item => item || {})
        .sort(
          (a, b) =>
            (Number(b.updatedAt) || 0) -
            (Number(a.updatedAt) || 0)
        );
    }


    function calculateStorageStatistics(rootValue = {}) {
      const boxMap = new Map();
      let totalBooks = 0;
      let structuredBooks = 0;
      let unstructuredBooks = 0;
      let inventoriedBooks = 0;
      let unInventoriedBooks = 0;
      let finishedBooks = 0;
      let returnedBooks = 0;
      let deathBooks = 0;
      let transferredBooks = 0;
      let otherBooks = 0;
      let scannedBooks = 0;
      const inventoryTotals = {
        soToChamSoc: 0,
        soToDieuTri: 0,
        soPhieuTruyenDich: 0,
        soPhieuDanhGiaTeNga: 0,
        soPhieuDanhGiaLoetTiDe: 0,
        tongSoGiayTo: 0
      };

      Object.entries(rootValue).forEach(([patientId, bookMap]) => {
        Object.values(bookMap || {}).filter(Boolean).forEach(book => {
          totalBooks += 1;

          const normalizedStatus = normalizeRecordStatus(book.trangThai);
          if (normalizedStatus === CONFIG.STATUS.HET_QUYEN) finishedBooks += 1;
          if (normalizedStatus === CONFIG.STATUS.HOI_GIA) returnedBooks += 1;
          if (normalizedStatus === CONFIG.STATUS.TU_VONG) deathBooks += 1;
          if (normalizedStatus === CONFIG.STATUS.CHUYEN_TRUNG_TAM) transferredBooks += 1;
          if (normalizedStatus === CONFIG.STATUS.KHAC) otherBooks += 1;
          if (String(book.fileDinhKem || '').trim()) scannedBooks += 1;

          const inventory = documentInventoryFromSource(book);
          if (inventory.complete) {
            inventoriedBooks += 1;
            INVENTORY_FIELDS.forEach(field => {
              inventoryTotals[field.key] += Number(inventory[field.key]) || 0;
            });
            inventoryTotals.tongSoGiayTo += Number(inventory.total) || 0;
          } else {
            unInventoriedBooks += 1;
          }
          const storage = parseStorageLocation(book);

          if (!storage.thungSo || !storage.viTriSo) {
            unstructuredBooks += 1;
            return;
          }

          structuredBooks += 1;
          if (!boxMap.has(storage.thungSo)) {
            boxMap.set(storage.thungSo, {
              thungSo: storage.thungSo,
              records: [],
              positions: new Map()
            });
          }

          const box = boxMap.get(storage.thungSo);
          const record = {
            patientId,
            soHoSo: String(book.soHoSo || ''),
            quyenSo: Number(book.quyenSo) || 0,
            viTriSo: storage.viTriSo,
            trangThai: normalizeRecordStatus(book.trangThai),
            ngayKetThuc: String(book.ngayKetThuc || '')
          };
          box.records.push(record);
          if (!box.positions.has(storage.viTriSo)) {
            box.positions.set(storage.viTriSo, []);
          }
          box.positions.get(storage.viTriSo).push(record);
        });
      });

      const boxes = [...boxMap.values()]
        .map(box => {
          const records = box.records.sort(
            (a, b) => a.viTriSo - b.viTriSo || a.quyenSo - b.quyenSo
          );
          const duplicatePositions = [...box.positions.entries()]
            .filter(([, recordsAtPosition]) => recordsAtPosition.length > 1)
            .map(([position]) => Number(position))
            .sort((a, b) => a - b);
          return {
            thungSo: box.thungSo,
            soQuyen: records.length,
            viTriDaDung: [...box.positions.keys()]
              .map(Number)
              .sort((a, b) => a - b),
            duplicatePositions,
            records
          };
        })
        .sort((a, b) => a.thungSo - b.thungSo);

      return {
        totalBooks,
        finishedBooks,
        returnedBooks,
        deathBooks,
        transferredBooks,
        otherBooks,
        scannedBooks,
        structuredBooks,
        unstructuredBooks,
        totalBoxes: boxes.length,
        duplicateLocationCount: boxes.reduce(
          (sum, box) => sum + box.duplicatePositions.length,
          0
        ),
        inventory: {
          inventoriedBooks,
          unInventoriedBooks,
          ...inventoryTotals
        },
        boxes
      };
    }

    async function readStorageStatistics() {
      ensurePrivateDataCacheOwner();

      if (firebaseDataCache.storageStats !== null) {
        return firebaseDataCache.storageStats;
      }

      const booksRoot = await readBooksRootCached();
      firebaseDataCache.storageStats = calculateStorageStatistics(booksRoot);

      return firebaseDataCache.storageStats;
    }

    async function readPublicStorageStatistics() {
      const entries = await readPublicCatalog();
      const rootValue = {};

      entries.forEach(({ id, patient }) => {
        rootValue[id] = patient.quyenHoSo || {};
      });

      return calculateStorageStatistics(rootValue);
    }

    async function writeLog(action, content = {}) {
      try {
        const user = firebaseAuth.currentUser;
        if (!user) return;

        const logReference = push(ref(firebaseDatabase, 'nhatKy'));

        await set(logReference, {
          action,
          content,
          email: user.email || '',
          uid: user.uid,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        console.warn('Không ghi được nhật ký hệ thống:', error);
      }
    }

    class DriveUploader {
      constructor(baseUrl, auth) {
        this.baseUrl = baseUrl;
        this.auth = auth;
      }

      async fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          return await fetch(url, {
            ...options,
            signal: controller.signal
          });
        } catch (error) {
          if (error.name === 'AbortError') {
            throw new Error('Tải file quá lâu. Vui lòng kiểm tra mạng và thử lại.');
          }

          throw new Error(
            'Không kết nối được dịch vụ lưu trữ tệp. '
            + 'Vui lòng kiểm tra kết nối mạng rồi thử lại.'
          );
        } finally {
          clearTimeout(timer);
        }
      }

      async request(payload, timeoutMs = 60000) {
        const user = this.auth.currentUser;
        if (!user) throw new Error('Phiên đăng nhập đã hết hạn.');

        const idToken = await user.getIdToken();
        const response = await this.fetchWithTimeout(this.baseUrl, {
          method: 'POST',
          cache: 'no-store',
          redirect: 'follow',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            ...payload,
            idToken
          })
        }, timeoutMs);

        if (!response.ok) {
          let message =
            `Dịch vụ lưu trữ phản hồi lỗi HTTP ${response.status}.`;

          try {
            const errorResult = await response.json();
            message = errorResult?.message || message;
          } catch (_) {
            // Giữ thông báo HTTP ở trên nếu phản hồi lỗi không phải JSON.
          }

          throw new Error(message);
        }

        let result;
        try {
          result = await response.json();
        } catch (error) {
          throw new Error('Dịch vụ file trả về dữ liệu không hợp lệ.');
        }

        if (!result || result.success !== true) {
          throw new Error(
            result?.message || 'Không thực hiện được thao tác file.'
          );
        }

        return result;
      }

      async upload(soHoSo, quyenSo, file) {
        if (!file) throw new Error('Chưa chọn file.');

        if (file.size > CONFIG.MAX_UPLOAD_BYTES) {
          throw new Error('File vượt quá 20 MB.');
        }

        const mimeType = resolveUploadMimeType(file);
        const allowedTypes = new Set([
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        ]);

        if (!allowedTypes.has(mimeType)) {
          throw new Error(
            'Chỉ chấp nhận PDF, JPG/JPEG, PNG, WEBP, HEIC hoặc HEIF.'
          );
        }

        const base64Data = await fileToBase64(file);

        return this.request({
          action: 'taiFileLen',
          soHoSo,
          quyenSo,
          fileName: file.name,
          mimeType,
          base64Data
        }, 150000);
      }

      async removeTemporary(fileId) {
        if (!fileId) return;

        try {
          await this.request({
            action: 'xoaFileTam',
            fileId
          }, 30000);
        } catch (error) {
          console.warn('Không xóa được file tạm:', error);
        }
      }
    }

    class FirebaseDataClient {
      constructor(database, auth, driveUploader) {
        this.database = database;
        this.auth = auth;
        this.driveUploader = driveUploader;
        this.lockLifetimeMs = 3 * 60 * 1000;
      }

      ensureSignedIn(allowPublic = false) {
        if (!this.auth.currentUser && !allowPublic) {
          throw new Error('Phiên chỉnh sửa đã hết hạn. Vui lòng đăng nhập lại.');
        }
      }

      makeOperationToken() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }

      async acquirePatientLock(patientId, operation) {
        const user = this.auth.currentUser;
        const lockReference = ref(
          this.database,
          `khoaThaoTac/${patientId}`
        );
        const token = this.makeOperationToken();
        const now = Date.now();

        const result = await runTransaction(
          lockReference,
          current => {
            const currentExpiresAt = Number(current?.expiresAt) || 0;
            const currentUid = String(current?.uid || '');

            if (
              current &&
              currentUid !== user.uid &&
              currentExpiresAt > now
            ) {
              return;
            }

            return {
              uid: user.uid,
              email: user.email || '',
              operation,
              token,
              acquiredAt: now,
              expiresAt: now + this.lockLifetimeMs
            };
          },
          { applyLocally: false }
        );

        const lock = result.snapshot.val() || {};

        if (!result.committed || lock.token !== token) {
          throw new Error(
            'Hồ sơ đang được thao tác trên thiết bị khác. '
            + 'Vui lòng chờ ít phút rồi thử lại.'
          );
        }

        return token;
      }

      async releasePatientLock(patientId, token) {
        if (!patientId || !token || !this.auth.currentUser) return;

        const user = this.auth.currentUser;
        const lockReference = ref(
          this.database,
          `khoaThaoTac/${patientId}`
        );

        try {
          await runTransaction(
            lockReference,
            current => {
              if (
                current?.uid === user.uid &&
                current?.token === token
              ) {
                return null;
              }

              return current;
            },
            { applyLocally: false }
          );
        } catch (error) {
          console.warn('Không giải phóng được khóa thao tác:', error);
        }
      }

      makeLog(action, content) {
        const user = this.auth.currentUser;
        return {
          action,
          content,
          email: user.email || '',
          uid: user.uid,
          createdAt: serverTimestamp()
        };
      }


      isPublicSession() {
        return (
          !this.auth.currentUser ||
          this.auth.currentUser?.isAnonymous === true ||
          !hasPrivateHsbaAccess()
        );
      }

      async rebuildPublicCatalog(patientEntries = null) {
        if (this.isPublicSession()) {
          throw new Error(
            'Chỉ tài khoản có quyền chỉnh sửa mới được cập nhật danh mục xem.'
          );
        }

        if (!['admin', 'editor'].includes(state.currentRole)) {
          throw new Error(
            'Tài khoản hiện tại không có quyền cập nhật danh mục xem.'
          );
        }

        const currentUser = this.auth.currentUser;
        if (!currentUser) {
          throw new Error('Phiên chỉnh sửa đã hết hạn.');
        }

        await currentUser.getIdToken(true);

        // Giai đoạn 5: rebuild thủ công mới đọc toàn bộ danh sách hồ sơ;
        // đồng thời chỉ đọc toàn bộ quyenHoSo một lần khi thực sự phải rebuild.
        const entries = Array.isArray(patientEntries)
          ? patientEntries
          : await readPatientSummaries();
        const booksRoot = await readBooksRootCached(true);

        const now = Date.now();

        const sourceUpdatedAt = entries.reduce(
          (maximum, item) =>
            Math.max(maximum, Number(item.patient?.updatedAt) || 0),
          0
        );

        const expectedIds = new Set(entries.map(item => item.id));
        const publicRootRef = ref(this.database, 'congKhai');
        const publicBooksRef = ref(this.database, 'congKhai/hoSo');

        // 1. Xóa cấu trúc thử nghiệm cũ nằm trực tiếp dưới congKhai/{id}.
        const currentRootSnapshot = await get(publicRootRef);
        const currentRootValue = currentRootSnapshot.val() || {};
        const cleanupUpdates = {};

        Object.keys(currentRootValue).forEach(key => {
          if (key !== '_meta' && key !== 'hoSo') {
            cleanupUpdates[key] = null;
          }
        });

        if (Object.keys(cleanupUpdates).length) {
          await update(publicRootRef, cleanupUpdates);
        }

        // 2. Xóa các hồ sơ công khai đã không còn tồn tại trong dữ liệu chính.
        const currentPublicSnapshot = await get(publicBooksRef);
        const currentPublicValue = currentPublicSnapshot.val() || {};
        const staleUpdates = {};

        Object.keys(currentPublicValue).forEach(id => {
          if (!expectedIds.has(id)) {
            staleUpdates[id] = null;
          }
        });

        if (Object.keys(staleUpdates).length) {
          await update(publicBooksRef, staleUpdates);
        }

        // 3. Ghi từng hồ sơ theo lô nhỏ. Cách này tránh việc một payload lớn
        // làm toàn bộ thao tác thất bại và giúp xác định đúng hồ sơ gây lỗi.
        const BATCH_SIZE = 20;
        const failedRecords = [];

        for (let start = 0; start < entries.length; start += BATCH_SIZE) {
          const batch = entries.slice(start, start + BATCH_SIZE);
          const batchUpdates = {};

          batch.forEach(({ id, patient }) => {
            batchUpdates[id] = publicPatientFromSource(
              patient,
              booksRoot[id] || {}
            );
          });

          try {
            await update(publicBooksRef, batchUpdates);
          } catch (error) {
            console.error('Không ghi được lô danh mục công khai:', error);

            // Thử lại từng hồ sơ để xác định chính xác hồ sơ lỗi.
            for (const { id, patient } of batch) {
              try {
                await set(
                  ref(this.database, `congKhai/hoSo/${id}`),
                  publicPatientFromSource(patient, booksRoot[id] || {})
                );
              } catch (recordError) {
                console.error(
                  `Không ghi được hồ sơ công khai ${id}:`,
                  recordError
                );
                failedRecords.push({
                  id,
                  soHoSo: String(patient?.soHoSo || id),
                  message:
                    recordError?.message ||
                    'Không xác định được nguyên nhân.'
                });
              }
            }
          }
        }

        if (failedRecords.length) {
          const first = failedRecords[0];
          throw new Error(
            `Không đồng bộ được ${failedRecords.length} hồ sơ. ` +
            `Hồ sơ đầu tiên: ${first.soHoSo}. ${first.message}`
          );
        }

        // 4. Cập nhật metadata sau cùng, chỉ khi toàn bộ hồ sơ đã ghi xong.
        await set(ref(this.database, 'congKhai/_meta'), {
          schemaVersion: CONFIG.PUBLIC_SCHEMA_VERSION,
          patientCount: entries.length,
          sourceUpdatedAt,
          updatedAt: now
        });

        // 5. Đọc lại và xác minh số lượng thật.
        const verifiedSnapshot = await get(publicBooksRef);
        const verifiedValue = verifiedSnapshot.val() || {};
        const verifiedEntries = extractPublicCatalogEntries(verifiedValue);

        if (verifiedEntries.length !== entries.length) {
          throw new Error(
            `Danh mục xem hiện có ${verifiedEntries.length}/${entries.length} hồ sơ.`
          );
        }

        return {
          patientCount: verifiedEntries.length,
          updatedAt: now
        };
      }

      async syncPublicCatalogIfNeeded() {
        if (this.isPublicSession()) return;
        if (!['admin', 'editor'].includes(state.currentRole)) return;

        // Giai đoạn 5: bootstrap chỉ tải một trang hồ sơ, vì vậy tuyệt đối
        // không so patientCount với số bản ghi của trang hiện tại và không
        // tự rebuild toàn bộ danh mục. Nút “Cập nhật danh mục xem” vẫn là
        // cơ chế sửa chữa thủ công khi quản trị cần đối chiếu toàn bộ dữ liệu.
        const metaSnapshot = await get(
          ref(this.database, 'congKhai/_meta')
        );
        const meta = metaSnapshot.val() || {};

        if (Number(meta.schemaVersion) !== CONFIG.PUBLIC_SCHEMA_VERSION) {
          console.warn(
            'Phiên bản danh mục xem chưa khớp. Quản trị nên bấm “Cập nhật danh mục xem”.'
          );
        }
      }

      async updatePublicMeta(delta = 0, sourceUpdatedAt = Date.now()) {
        if (this.isPublicSession()) return;

        if (delta) {
          await runTransaction(
            ref(this.database, 'congKhai/_meta/patientCount'),
            current => Math.max(0, Number(current || 0) + delta),
            { applyLocally: false }
          );
        }

        await update(ref(this.database, 'congKhai/_meta'), {
          schemaVersion: CONFIG.PUBLIC_SCHEMA_VERSION,
          sourceUpdatedAt: Number(sourceUpdatedAt) || Date.now(),
          updatedAt: Date.now()
        });
      }

      async get(action, params = {}) {
        this.ensureSignedIn(true);

        try {
          switch (action) {
            case 'bootstrap':
              return await this.bootstrap();

            case 'layChiTietHoSo':
              return await this.getBooks(params.soHoSo);

            case 'layHoSoTuVong':
              return await this.getDeaths();

            case 'layThongKe':
              return await this.getStats();

            case 'layThongKeLuuTru':
              return await this.getStorageStats();

            default:
              throw new Error('Chức năng này chưa được hỗ trợ.');
          }
        } catch (error) {
          throw firebaseError(error);
        }
      }

      async post(action, payload = {}) {
        this.ensureSignedIn();

        try {
          switch (action) {
            case 'themDoiTuong':
              return await this.addPatient(payload);

            case 'capNhatDoiTuong':
              return await this.updatePatient(payload);

            case 'xoaDoiTuong':
              return await this.deletePatient(payload);

            case 'luuQuyenHoSo':
              return await this.saveBook(payload, null);

            default:
              throw new Error('Chức năng này chưa được hỗ trợ.');
          }
        } catch (error) {
          throw firebaseError(error);
        }
      }

      async saveBookWithFile(payload, file) {
        this.ensureSignedIn();

        try {
          return await this.saveBook(payload, file || null);
        } catch (error) {
          throw firebaseError(error);
        }
      }

      async bootstrap() {
        const page = await readPatientPage();
        const totalCount = await readPatientTotalCount();

        if (!this.isPublicSession()) {
          try {
            await this.syncPublicCatalogIfNeeded();
          } catch (syncError) {
            console.warn('Không kiểm tra được danh mục xem:', syncError);
          }
        }

        const patients = page.entries.map(({ id, patient }) =>
          patientToUi(id, patient)
        );

        const pageStats = calculateStats(
          page.entries.map(item => item.patient)
        );

        if (totalCount !== null) {
          pageStats.tongDoiTuong = totalCount;
        }

        return {
          success: true,
          data: {
            patients,
            deaths: [],
            stats: pageStats,
            pagination: {
              hasMore: page.hasMore,
              cursor: page.cursor,
              totalCount
            }
          }
        };
      }

      async getBooks(soHoSo) {
        const id = firebaseKey(soHoSo);
        const publicSession = this.isPublicSession();
        let patientSnapshot = await get(
          ref(
            this.database,
            publicSession ? `congKhai/hoSo/${id}` : `doiTuong/${id}`
          )
        );

        // Tương thích cấu trúc công khai cũ trong giai đoạn chuyển đổi.
        if (publicSession && !patientSnapshot.exists()) {
          patientSnapshot = await get(
            ref(this.database, `congKhai/${id}`)
          );
        }

        if (!patientSnapshot.exists()) {
          throw new Error('Không tìm thấy hồ sơ trên hệ thống.');
        }

        const patient = patientSnapshot.val() || {};
        let value = {};

        if (publicSession) {
          value = patient.quyenHoSo || {};
        } else {
          const cachedBookMap = cachedBooksForPatient(id);

          if (cachedBookMap !== null) {
            value = cachedBookMap;
          } else {
            const booksSnapshot = await get(
              ref(this.database, `quyenHoSo/${id}`)
            );
            value = booksSnapshot.val() || {};
          }
        }

        const books = Object.values(value)
          .map(book => bookToUi(patient, book))
          .sort(
            (a, b) =>
              Number(a['QUYỂN SỐ']) - Number(b['QUYỂN SỐ'])
          );

        return {
          success: true,
          data: books
        };
      }

      async getDeaths() {
        const deaths = this.isPublicSession()
          ? await readPublicDeaths()
          : await readDeathObjects();

        return {
          success: true,
          data: deaths.map(deathToUi)
        };
      }

      async getStats() {
        const patientEntries = this.isPublicSession()
          ? await readPublicCatalog()
          : await readPatientSummaries();

        return {
          success: true,
          data: calculateStats(
            patientEntries.map(item => item.patient)
          )
        };
      }


      async getStorageStats() {
        return {
          success: true,
          data: this.isPublicSession()
            ? await readPublicStorageStatistics()
            : await readStorageStatistics()
        };
      }

      async addPatient(payload) {
        const soHoSo = formatMedicalRecordNumber(payload.soHoSo);
        const hoTen = formatVietnamesePersonName(payload.hoTen);
        const namSinh = Number(payload.namSinh);
        const gioiTinh = String(payload.gioiTinh || '').trim();
        const currentYear = new Date().getFullYear();

        if (!soHoSo || !hoTen || !Number.isInteger(namSinh) || !['Nam', 'Nữ'].includes(gioiTinh)) {
          throw new Error('Vui lòng nhập đầy đủ số hồ sơ, họ tên, năm sinh và giới tính.');
        }

        if (!isValidMedicalRecordNumber(soHoSo)) {
          throw new Error(
            'Số hồ sơ phải đúng định dạng XX.XX.XX.XXXX, ví dụ HA.11.11.1111.'
          );
        }

        if (namSinh < 1900 || namSinh > currentYear) {
          throw new Error('Năm sinh không hợp lệ.');
        }

        const id = firebaseKey(soHoSo);
        const patientReference = ref(this.database, `doiTuong/${id}`);
        const now = Date.now();
        const patient = {
          soHoSo,
          hoTen,
          hoTenTimKiem: normalize(hoTen),
          namSinh,
          gioiTinh,
          tongSoQuyen: 0,
          quyenDangMo: '',
          trangThaiHienTai: '',
          soQuyenDaLuuKho: 0,
          soQuyenHetQuyen: 0,
          soQuyenHoiGia: 0,
          soQuyenTuVong: 0,
          soQuyenCoFile: 0,
          createdAt: now,
          updatedAt: now,
          createdBy: this.auth.currentUser.email || ''
        };

        const result = await runTransaction(
          patientReference,
          current => current === null ? patient : undefined,
          { applyLocally: false }
        );

        if (!result.committed) {
          throw new Error(`Số hồ sơ ${soHoSo} đã tồn tại.`);
        }

        await set(
          ref(this.database, `congKhai/hoSo/${id}`),
          publicPatientFromSource(patient, {})
        );
        await this.updatePublicMeta(1, now);

        await writeLog('THÊM HỒ SƠ', { soHoSo, hoTen, namSinh, gioiTinh });

        return {
          success: true,
          message: 'Đã lưu hồ sơ.',
          data: patientToUi(id, patient)
        };
      }

      async updatePatient(payload) {
        const originalSoHoSo = formatMedicalRecordNumber(
          payload.originalSoHoSo || payload.soHoSo
        );
        const soHoSo = formatMedicalRecordNumber(payload.soHoSo);
        const hoTen = formatVietnamesePersonName(payload.hoTen);
        const namSinh = Number(payload.namSinh);
        const gioiTinh = String(payload.gioiTinh || '').trim();
        const currentYear = new Date().getFullYear();
        const isAdmin = state.currentRole === 'admin';
        const isEditor = state.currentRole === 'editor';

        if (!isAdmin && !isEditor) {
          throw new Error('Tài khoản hiện tại không có quyền chỉnh sửa hồ sơ.');
        }

        if (!originalSoHoSo || !soHoSo || !hoTen || !Number.isInteger(namSinh) || !['Nam', 'Nữ'].includes(gioiTinh)) {
          throw new Error('Vui lòng nhập đầy đủ thông tin hồ sơ.');
        }

        if (!isValidMedicalRecordNumber(soHoSo)) {
          throw new Error(
            'Số hồ sơ phải đúng định dạng XX.XX.XX.XXXX, ví dụ HA.11.11.1111.'
          );
        }

        if (namSinh < 1900 || namSinh > currentYear) {
          throw new Error('Năm sinh không hợp lệ.');
        }

        if (!isAdmin && soHoSo !== originalSoHoSo) {
          throw new Error('Chỉ tài khoản quản trị được thay đổi số hồ sơ.');
        }

        const oldId = firebaseKey(originalSoHoSo);
        const newId = firebaseKey(soHoSo);
        const oldLockToken = await this.acquirePatientLock(oldId, 'SUA_THONG_TIN');
        let newLockToken = '';

        try {
          const [patientSnapshot, booksSnapshot, deathSnapshot] = await Promise.all([
            get(ref(this.database, `doiTuong/${oldId}`)),
            get(ref(this.database, `quyenHoSo/${oldId}`)),
            get(ref(this.database, `hoSoTuVong/${oldId}`))
          ]);

          if (!patientSnapshot.exists()) {
            throw new Error('Không tìm thấy hồ sơ.');
          }

          const bookMap = booksSnapshot.val() || {};
          const bookCount = Object.values(bookMap).filter(Boolean).length;

          if (isEditor && bookCount === 0) {
            throw new Error(
              'Hồ sơ chưa có quyển. Tài khoản nhập liệu phải xóa hồ sơ nhập sai và tạo lại.'
            );
          }

          if (oldId !== newId) {
            const duplicateSnapshot = await get(ref(this.database, `doiTuong/${newId}`));
            if (duplicateSnapshot.exists()) {
              throw new Error(`Số hồ sơ ${soHoSo} đã tồn tại trong hệ thống.`);
            }
            newLockToken = await this.acquirePatientLock(newId, 'DOI_SO_HO_SO');
          }

          const now = Date.now();
          const oldPatient = patientSnapshot.val() || {};
          const updatedPatient = {
            ...oldPatient,
            soHoSo,
            hoTen,
            hoTenTimKiem: normalize(hoTen),
            namSinh,
            gioiTinh,
            updatedAt: now,
            updatedBy: this.auth.currentUser.email || ''
          };

          const updatedBooks = {};
          Object.entries(bookMap).forEach(([bookId, book]) => {
            if (!book) return;
            updatedBooks[bookId] = {
              ...book,
              soHoSo,
              updatedAt: Number(book.updatedAt) || now,
              updatedBy: this.auth.currentUser.email || ''
            };
          });

          const oldDeath = deathSnapshot.val() || null;
          const updatedDeath = oldDeath
            ? {
                ...oldDeath,
                soHoSo,
                hoTen,
                namSinh,
                gioiTinh,
                updatedAt: now
              }
            : null;

          const logKey = push(ref(this.database, 'nhatKy')).key;
          const updates = {
            [`doiTuong/${newId}`]: updatedPatient,
            [`congKhai/hoSo/${newId}`]: publicPatientFromSource(
              updatedPatient,
              updatedBooks
            ),
            [`congKhai/_meta/schemaVersion`]: CONFIG.PUBLIC_SCHEMA_VERSION,
            [`congKhai/_meta/sourceUpdatedAt`]: now,
            [`congKhai/_meta/updatedAt`]: now,
            [`nhatKy/${logKey}`]: this.makeLog(
              oldId !== newId
                ? 'ĐỔI SỐ VÀ CHỈNH SỬA HỒ SƠ'
                : 'CHỈNH SỬA THÔNG TIN HỒ SƠ',
              {
                soHoSoCu: originalSoHoSo,
                soHoSoMoi: soHoSo,
                hoTen,
                namSinh,
                gioiTinh
              }
            ),
            [`khoaThaoTac/${oldId}`]: null
          };

          // Không ghi cả nhánh cha quyenHoSo/{patientId} vì Rules chỉ cấp
          // quyền ghi tại từng quyenHoSo/{patientId}/{bookId}. Ghi từng quyển
          // cũng giữ nguyên cơ chế khóa chống chỉnh sửa đồng thời.
          if (bookCount > 0) {
            Object.entries(updatedBooks).forEach(([bookId, book]) => {
              if (!book) return;
              updates[`quyenHoSo/${newId}/${bookId}`] = book;
            });
          }

          if (updatedDeath) {
            updates[`hoSoTuVong/${newId}`] = updatedDeath;
          }

          if (oldId !== newId) {
            updates[`doiTuong/${oldId}`] = null;
            Object.entries(bookMap).forEach(([bookId, book]) => {
              if (!book) return;
              updates[`quyenHoSo/${oldId}/${bookId}`] = null;
            });
            updates[`hoSoTuVong/${oldId}`] = null;
            updates[`congKhai/hoSo/${oldId}`] = null;
            updates[`khoaThaoTac/${newId}`] = null;
          }

          await update(ref(this.database), updates);

          patchBooksRootCache(
            oldId,
            newId,
            bookCount > 0 ? updatedBooks : null
          );

          return {
            success: true,
            message:
              oldId !== newId
                ? `Đã đổi số hồ sơ từ ${originalSoHoSo} thành ${soHoSo}.`
                : 'Đã cập nhật thông tin hồ sơ.',
            data: patientToUi(newId, updatedPatient),
            oldSoHoSo: originalSoHoSo,
            newSoHoSo: soHoSo
          };
        } catch (error) {
          await this.releasePatientLock(oldId, oldLockToken);
          if (newLockToken) {
            await this.releasePatientLock(newId, newLockToken);
          }
          throw error;
        }
      }

      async deletePatient(payload) {
        const soHoSo = formatMedicalRecordNumber(payload.soHoSo);
        const lyDoXoa = String(payload.lyDoXoa || '').trim();
        const isAdmin = state.currentRole === 'admin';
        const isEditor = state.currentRole === 'editor';

        if (!isAdmin && !isEditor) {
          throw new Error('Tài khoản chỉ xem không được phép xóa hồ sơ.');
        }

        if (!soHoSo) {
          throw new Error('Không xác định được hồ sơ cần xóa.');
        }

        if (lyDoXoa.length < 3) {
          throw new Error('Vui lòng nhập lý do xóa hồ sơ.');
        }

        const id = firebaseKey(soHoSo);
        const lockToken = await this.acquirePatientLock(id, 'XOA_HO_SO');

        try {
          const [patientSnapshot, booksSnapshot] = await Promise.all([
            get(ref(this.database, `doiTuong/${id}`)),
            get(ref(this.database, `quyenHoSo/${id}`))
          ]);

          if (!patientSnapshot.exists()) {
            throw new Error('Hồ sơ không còn tồn tại trên hệ thống.');
          }

          const bookMap = booksSnapshot.val() || {};
          const bookCount = Object.values(bookMap).filter(Boolean).length;

          if (isEditor && bookCount > 0) {
            throw new Error(
              'Tài khoản nhập liệu không được xóa hồ sơ đã có quyển. Hãy chỉnh sửa thông tin hồ sơ.'
            );
          }

          const patient = patientSnapshot.val() || {};
          const logKey = push(ref(this.database, 'nhatKy')).key;
          const updates = {
            [`doiTuong/${id}`]: null,
            [`hoSoTuVong/${id}`]: null,
            [`congKhai/hoSo/${id}`]: null,
            [`khoaThaoTac/${id}`]: null,
            [`nhatKy/${logKey}`]: this.makeLog(
              bookCount > 0 ? 'QUẢN TRỊ XÓA TOÀN BỘ HỒ SƠ' : 'XÓA HỒ SƠ NHẬP NHẦM',
              {
                soHoSo,
                hoTen: patient.hoTen || '',
                namSinh: patient.namSinh || '',
                gioiTinh: patient.gioiTinh || '',
                soQuyenDaXoa: bookCount,
                lyDoXoa
              }
            )
          };

          // Rules chỉ cho phép ghi/xóa tại từng bookId. Vì vậy:
          // - Admin: có quyển thì xóa lần lượt toàn bộ quyển rồi xóa hồ sơ.
          // - Nhập liệu: đã có quyển đã bị chặn ở trên; chưa có quyển thì
          //   không phát sinh write vào nhánh quyenHoSo nên vẫn xóa được.
          Object.entries(bookMap).forEach(([bookId, book]) => {
            if (!book) return;
            updates[`quyenHoSo/${id}/${bookId}`] = null;
          });

          await update(ref(this.database), updates);
          await this.updatePublicMeta(-1, Date.now());
          patchBooksRootCache(id, null, null);

          return {
            success: true,
            message:
              bookCount > 0
                ? `Quản trị đã xóa hồ sơ ${soHoSo} và ${bookCount} quyển liên quan.`
                : `Đã xóa hồ sơ ${soHoSo}.`
          };
        } catch (error) {
          await this.releasePatientLock(id, lockToken);
          throw error;
        }
      }

      summarizeBooks(bookMap) {
        const books = Object.values(bookMap || {}).filter(Boolean);
        const normalized = books.map(book => ({ ...book, normalizedStatus: normalizeRecordStatus(book.trangThai) }));
        const latest = [...normalized].sort((a, b) => {
          const dateDiff = String(b.ngayKetThuc || b.ngayBatDau || '').localeCompare(String(a.ngayKetThuc || a.ngayBatDau || ''));
          if (dateDiff) return dateDiff;
          return Number(b.quyenSo || 0) - Number(a.quyenSo || 0);
        })[0] || null;

        return {
          total: books.length,
          latestStatus: latest?.normalizedStatus || '',
          finished: normalized.filter(book => book.normalizedStatus === CONFIG.STATUS.HET_QUYEN).length,
          returned: normalized.filter(book => book.normalizedStatus === CONFIG.STATUS.HOI_GIA).length,
          deaths: normalized.filter(book => book.normalizedStatus === CONFIG.STATUS.TU_VONG).length,
          transferred: normalized.filter(book => book.normalizedStatus === CONFIG.STATUS.CHUYEN_TRUNG_TAM).length,
          others: normalized.filter(book => book.normalizedStatus === CONFIG.STATUS.KHAC).length,
          files: normalized.filter(book => String(book.fileDinhKem || '').trim()).length,
          deathBook: normalized
            .filter(book => book.normalizedStatus === CONFIG.STATUS.TU_VONG)
            .sort((a, b) => Number(b.quyenSo || 0) - Number(a.quyenSo || 0))[0] || null
        };
      }

      async reserveStorageLocation({
        patientId,
        targetBookKey,
        originalBookKey = '',
        soHoSo,
        quyenSo,
        thungSo,
        viTriSo
      }) {
        const locationKey = storageLocationKey(thungSo, viTriSo);
        if (!locationKey) {
          throw new Error('Vị trí lưu trữ không hợp lệ.');
        }

        // Kiểm tra toàn bộ dữ liệu hiện hữu trước để chặn cả các quyển cũ
        // chưa có trong chỉ mục vị trí.
        const booksRoot = await readBooksRootCached(true);
        const conflict = findStorageLocationConflict(
          booksRoot,
          thungSo,
          viTriSo,
          patientId,
          originalBookKey
        );

        if (conflict) {
          throw new Error(storageConflictMessage(conflict, thungSo, viTriSo));
        }

        const indexReference = ref(
          this.database,
          `${CONFIG.STORAGE_INDEX_PATH}/${locationKey}`
        );

        // Nếu chỉ mục cũ bị sót nhưng quyển tham chiếu không còn ở vị trí đó,
        // dọn chỉ mục trước khi giữ chỗ mới.
        const existingSnapshot = await get(indexReference);
        const existingIndex = existingSnapshot.val() || null;
        const allowedBookKeys = new Set(
          [targetBookKey, originalBookKey].filter(Boolean)
        );

        if (
          existingIndex &&
          !(
            String(existingIndex.patientId || '') === patientId &&
            allowedBookKeys.has(String(existingIndex.bookKey || ''))
          )
        ) {
          const indexedPatientId = String(existingIndex.patientId || '');
          const indexedBookKey = String(existingIndex.bookKey || '');
          const indexedBookSnapshot =
            indexedPatientId && indexedBookKey
              ? await get(
                  ref(
                    this.database,
                    `quyenHoSo/${indexedPatientId}/${indexedBookKey}`
                  )
                )
              : null;
          const indexedBook = indexedBookSnapshot?.exists()
            ? indexedBookSnapshot.val()
            : null;
          const indexedStorage = parseStorageLocation(indexedBook || {});

          if (
            indexedBook &&
            Number(indexedStorage.thungSo) === Number(thungSo) &&
            Number(indexedStorage.viTriSo) === Number(viTriSo)
          ) {
            throw new Error(
              storageConflictMessage(
                {
                  soHoSo: indexedBook.soHoSo || existingIndex.soHoSo || '',
                  quyenSo:
                    Number(indexedBook.quyenSo) ||
                    Number(existingIndex.quyenSo) ||
                    0
                },
                thungSo,
                viTriSo
              )
            );
          }

          // Chỉ mục mồ côi: chỉ xóa nếu nó vẫn đúng bản ghi vừa kiểm tra.
          await runTransaction(
            indexReference,
            current => {
              if (
                current &&
                String(current.patientId || '') === indexedPatientId &&
                String(current.bookKey || '') === indexedBookKey
              ) {
                return null;
              }
              return current;
            },
            { applyLocally: false }
          );
        }

        const reservationToken = this.makeOperationToken();
        const now = Date.now();
        const reservation = {
          locationKey,
          patientId,
          bookKey: targetBookKey,
          soHoSo,
          quyenSo: Number(quyenSo),
          thungSo: Number(thungSo),
          viTriSo: Number(viTriSo),
          reservationToken,
          updatedAt: now,
          updatedByUid: this.auth.currentUser?.uid || '',
          updatedByEmail: this.auth.currentUser?.email || ''
        };

        const result = await runTransaction(
          indexReference,
          current => {
            if (!current) {
              return reservation;
            }

            const samePatient =
              String(current.patientId || '') === patientId;
            const currentBookKey = String(current.bookKey || '');

            if (samePatient && allowedBookKeys.has(currentBookKey)) {
              // Đây chính là quyển đang chỉnh sửa; giữ nguyên chỉ mục cũ
              // cho đến khi ghi dữ liệu chính thức thành công.
              return current;
            }

            return;
          },
          { applyLocally: false }
        );

        if (!result.committed) {
          const current = result.snapshot?.val() || null;
          throw new Error(
            storageConflictMessage(current, thungSo, viTriSo)
          );
        }

        const committedIndex = result.snapshot?.val() || {};
        const acquiredByThisAttempt =
          String(committedIndex.reservationToken || '') === reservationToken;

        return {
          locationKey,
          reservation,
          reservationToken,
          acquiredByThisAttempt
        };
      }

      async releaseStorageLocationReservation(
        locationKey,
        patientId,
        allowedBookKeys = [],
        reservationToken = ''
      ) {
        if (!locationKey) return;

        const acceptedKeys = new Set(
          (Array.isArray(allowedBookKeys) ? allowedBookKeys : [allowedBookKeys])
            .filter(Boolean)
            .map(String)
        );

        await runTransaction(
          ref(this.database, `${CONFIG.STORAGE_INDEX_PATH}/${locationKey}`),
          current => {
            if (!current) return null;
            if (String(current.patientId || '') !== String(patientId || '')) {
              return current;
            }

            const currentBookKey = String(current.bookKey || '');
            if (acceptedKeys.size && !acceptedKeys.has(currentBookKey)) {
              return current;
            }

            if (
              reservationToken &&
              String(current.reservationToken || '') !== reservationToken
            ) {
              return current;
            }

            return null;
          },
          { applyLocally: false }
        );
      }

      async saveBook(payload, file) {
        const soHoSo = String(payload.soHoSo || '').trim();
        const mode = String(payload.mode || 'add');
        const quyenSo = Number(payload.quyenSo);
        const originalQuyenSo = Number(payload.originalQuyenSo || quyenSo);
        const ngayBatDau = String(payload.ngayBatDau || '').trim();
        const ngayKetThuc = String(payload.ngayKetThuc || '').trim();
        const trangThai = normalizeRecordStatus(payload.trangThai);
        const noiTuVong = String(payload.noiTuVong || '').trim();
        const nguyenNhanTuVong = String(payload.nguyenNhanTuVong || '').trim();
        const ngayHoiGia = String(payload.ngayHoiGia || '').trim();
        const ngayTuVong = String(payload.ngayTuVong || '').trim();
        const ngayChuyenTrungTam = String(payload.ngayChuyenTrungTam || '').trim();
        const noiDungKhac = String(payload.noiDungKhac || '').trim();
        const thungSo = Number(payload.thungSo);
        const viTriSo = Number(payload.viTriSo);
        const maLuuTru = storageLocationLabel(thungSo, viTriSo);
        const inventoryValues = {};
        INVENTORY_FIELDS.forEach(field => {
          inventoryValues[field.key] = optionalNonNegativeInteger(payload[field.key]);
        });
        const inventoryComplete = INVENTORY_FIELDS.every(field => inventoryValues[field.key] !== '');
        const tongSoGiayTo = inventoryComplete
          ? INVENTORY_FIELDS.reduce((sum, field) => sum + Number(inventoryValues[field.key] || 0), 0)
          : 0;
        const ghiChu = String(payload.ghiChu || '').trim();
        const existingFileUrl = String(payload.existingFileUrl || '').trim();

        if (!soHoSo || !Number.isInteger(quyenSo) || quyenSo < 1) {
          throw new Error('Vui lòng nhập đúng số hồ sơ và quyển số.');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayBatDau) || !/^\d{4}-\d{2}-\d{2}$/.test(ngayKetThuc)) {
          throw new Error('Vui lòng nhập đầy đủ ngày mở quyển và ngày kết thúc.');
        }
        if (ngayKetThuc < ngayBatDau) {
          throw new Error('Ngày kết thúc không được trước ngày mở quyển.');
        }
        if (![
          CONFIG.STATUS.HET_QUYEN,
          CONFIG.STATUS.HOI_GIA,
          CONFIG.STATUS.TU_VONG,
          CONFIG.STATUS.CHUYEN_TRUNG_TAM,
          CONFIG.STATUS.KHAC
        ].includes(trangThai)) {
          throw new Error('Vui lòng chọn đúng trạng thái kết thúc hồ sơ.');
        }
        if (!Number.isInteger(thungSo) || thungSo < 1) throw new Error('Vui lòng nhập đúng thùng số.');
        if (!Number.isInteger(viTriSo) || viTriSo < 1) throw new Error('Vui lòng nhập đúng vị trí số trong thùng.');
        if (!inventoryComplete) {
          throw new Error('Vui lòng kiểm kê đầy đủ 5 loại giấy tờ trong quyển. Nhập 0 đối với loại không có.');
        }
        if (trangThai === CONFIG.STATUS.TU_VONG && !noiTuVong) {
          throw new Error('Vui lòng nhập nơi tử vong.');
        }
        if (trangThai === CONFIG.STATUS.TU_VONG && !nguyenNhanTuVong) {
          throw new Error('Vui lòng nhập nguyên nhân tử vong.');
        }
        if (trangThai === CONFIG.STATUS.HOI_GIA) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayHoiGia)) {
            throw new Error('Vui lòng nhập ngày đối tượng hồi gia.');
          }
          if (ngayHoiGia < ngayBatDau || ngayHoiGia > ngayKetThuc) {
            throw new Error('Ngày hồi gia phải nằm trong khoảng từ ngày mở quyển đến ngày kết thúc.');
          }
        }
        if (trangThai === CONFIG.STATUS.TU_VONG) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayTuVong)) {
            throw new Error('Vui lòng nhập ngày đối tượng tử vong.');
          }
          if (ngayTuVong < ngayBatDau || ngayTuVong > ngayKetThuc) {
            throw new Error('Ngày tử vong phải nằm trong khoảng từ ngày mở quyển đến ngày kết thúc.');
          }
        }
        if (trangThai === CONFIG.STATUS.CHUYEN_TRUNG_TAM) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayChuyenTrungTam)) {
            throw new Error('Vui lòng nhập ngày chuyển trung tâm.');
          }
          if (ngayChuyenTrungTam < ngayBatDau || ngayChuyenTrungTam > ngayKetThuc) {
            throw new Error('Ngày chuyển trung tâm phải nằm trong khoảng từ ngày mở quyển đến ngày kết thúc.');
          }
        }
        if (trangThai === CONFIG.STATUS.KHAC && !noiDungKhac) {
          throw new Error('Vui lòng nhập nội dung khác.');
        }
        if (noiDungKhac.length > 500) {
          throw new Error('Nội dung khác không được vượt quá 500 ký tự.');
        }
        if (trangThai === CONFIG.STATUS.TU_VONG && !file && !existingFileUrl) {
          throw new Error('Hồ sơ tử vong bắt buộc phải có file scan hoặc hình ảnh.');
        }

        const id = firebaseKey(soHoSo);
        const lockToken = await this.acquirePatientLock(id, mode === 'edit' ? 'SUA_QUYEN' : 'LUU_QUYEN');
        let uploadedFileId = '';
        let storageReservation = null;
        let previousLocationKey = '';
        let dataCommitted = false;

        try {
          const [patientSnapshot, booksSnapshot] = await Promise.all([
            get(ref(this.database, `doiTuong/${id}`)),
            get(ref(this.database, `quyenHoSo/${id}`))
          ]);

          if (!patientSnapshot.exists()) throw new Error('Không tìm thấy hồ sơ.');
          const patient = patientSnapshot.val() || {};
          const bookMap = booksSnapshot.val() || {};
          const targetKey = bookKey(quyenSo);
          const originalKey = bookKey(originalQuyenSo);
          const previousBook = mode === 'edit' ? bookMap[originalKey] : null;

          if (mode === 'edit' && !previousBook) throw new Error('Không tìm thấy quyển hồ sơ cần chỉnh sửa.');
          if (mode !== 'edit' && bookMap[targetKey]) throw new Error(`Quyển ${quyenSo} đã tồn tại.`);
          if (mode === 'edit' && quyenSo !== originalQuyenSo && bookMap[targetKey]) {
            throw new Error(`Quyển ${quyenSo} đã tồn tại.`);
          }

          if (previousBook) {
            const previousStorage = parseStorageLocation(previousBook);
            previousLocationKey = storageLocationKey(
              previousStorage.thungSo,
              previousStorage.viTriSo
            );
          }

          storageReservation = await this.reserveStorageLocation({
            patientId: id,
            targetBookKey: targetKey,
            originalBookKey: mode === 'edit' ? originalKey : '',
            soHoSo,
            quyenSo,
            thungSo,
            viTriSo
          });

          let fileDinhKem = previousBook?.fileDinhKem || existingFileUrl || '';
          if (file) {
            const upload = await this.driveUploader.upload(soHoSo, quyenSo, file);
            uploadedFileId = upload.data?.fileId || '';
            fileDinhKem = upload.data?.fileUrl || '';
            if (!fileDinhKem) throw new Error('Không nhận được đường dẫn tệp sau khi tải lên.');
          }

          const nowEmail = this.auth.currentUser.email || '';
          const savedBook = {
            ...(previousBook || {}),
            soHoSo,
            quyenSo,
            ngayBatDau,
            ngayKetThuc,
            trangThai,
            noiTuVong: trangThai === CONFIG.STATUS.TU_VONG ? noiTuVong : '',
            nguyenNhanTuVong: trangThai === CONFIG.STATUS.TU_VONG ? nguyenNhanTuVong : '',
            ngayHoiGia: trangThai === CONFIG.STATUS.HOI_GIA ? ngayHoiGia : '',
            ngayTuVong: trangThai === CONFIG.STATUS.TU_VONG ? ngayTuVong : '',
            ngayChuyenTrungTam: trangThai === CONFIG.STATUS.CHUYEN_TRUNG_TAM ? ngayChuyenTrungTam : '',
            noiDungKhac: trangThai === CONFIG.STATUS.KHAC ? noiDungKhac : '',
            thungSo,
            viTriSo,
            maLuuTru,
            ...inventoryValues,
            tongSoGiayTo,
            fileDinhKem,
            ghiChu,
            createdAt: previousBook?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: previousBook?.createdBy || nowEmail,
            updatedBy: nowEmail
          };

          const nextBookMap = { ...bookMap };
          if (mode === 'edit' && originalKey !== targetKey) delete nextBookMap[originalKey];
          nextBookMap[targetKey] = savedBook;
          const summary = this.summarizeBooks(nextBookMap);
          const logKey = push(ref(this.database, 'nhatKy')).key;

          const publicPatient = publicPatientFromSource(
            {
              ...patient,
              tongSoQuyen: summary.total,
              trangThaiHienTai: summary.latestStatus,
              soQuyenHetQuyen: summary.finished,
              soQuyenHoiGia: summary.returned,
              soQuyenTuVong: summary.deaths,
              soQuyenChuyenTrungTam: summary.transferred,
              soQuyenKhac: summary.others,
              soQuyenCoFile: summary.files,
              updatedAt: Date.now()
            },
            nextBookMap
          );

          const updates = {
            [`quyenHoSo/${id}/${targetKey}`]: savedBook,
            [`doiTuong/${id}/tongSoQuyen`]: summary.total,
            [`doiTuong/${id}/quyenDangMo`]: '',
            [`doiTuong/${id}/trangThaiHienTai`]: summary.latestStatus,
            [`doiTuong/${id}/soQuyenDaLuuKho`]: summary.finished,
            [`doiTuong/${id}/soQuyenHetQuyen`]: summary.finished,
            [`doiTuong/${id}/soQuyenHoiGia`]: summary.returned,
            [`doiTuong/${id}/soQuyenTuVong`]: summary.deaths,
            [`doiTuong/${id}/soQuyenChuyenTrungTam`]: summary.transferred,
            [`doiTuong/${id}/soQuyenKhac`]: summary.others,
            [`doiTuong/${id}/soQuyenCoFile`]: summary.files,
            [`doiTuong/${id}/updatedAt`]: serverTimestamp(),
            [`congKhai/hoSo/${id}`]: publicPatient,
            [`congKhai/_meta/schemaVersion`]: CONFIG.PUBLIC_SCHEMA_VERSION,
            [`congKhai/_meta/sourceUpdatedAt`]: Date.now(),
            [`congKhai/_meta/updatedAt`]: Date.now(),
            [`${CONFIG.STORAGE_INDEX_PATH}/${storageReservation.locationKey}`]:
              storageReservation.reservation,
            [`nhatKy/${logKey}`]: this.makeLog(
              mode === 'edit' ? 'CHỈNH SỬA QUYỂN HỒ SƠ' : 'LƯU QUYỂN HỒ SƠ',
              {
                soHoSo,
                quyenSo,
                ngayBatDau,
                ngayKetThuc,
                trangThai,
                noiTuVong: trangThai === CONFIG.STATUS.TU_VONG ? noiTuVong : '',
                nguyenNhanTuVong: trangThai === CONFIG.STATUS.TU_VONG ? nguyenNhanTuVong : '',
                ngayHoiGia: trangThai === CONFIG.STATUS.HOI_GIA ? ngayHoiGia : '',
                ngayTuVong: trangThai === CONFIG.STATUS.TU_VONG ? ngayTuVong : '',
                ngayChuyenTrungTam: trangThai === CONFIG.STATUS.CHUYEN_TRUNG_TAM ? ngayChuyenTrungTam : '',
                noiDungKhac: trangThai === CONFIG.STATUS.KHAC ? noiDungKhac : '',
                thungSo,
                viTriSo,
                maLuuTru,
                ...inventoryValues,
                tongSoGiayTo
              }
            )
          };

          if (mode === 'edit' && originalKey !== targetKey) {
            updates[`quyenHoSo/${id}/${originalKey}`] = null;
          }

          if (summary.deathBook) {
            const deathBook = summary.deathBook;
            updates[`hoSoTuVong/${id}`] = {
              soHoSo,
              hoTen: patient.hoTen || '',
              namSinh: patient.namSinh || '',
              gioiTinh: patient.gioiTinh || '',
              quyenSo: Number(deathBook.quyenSo) || 0,
              ngayKetThuc: deathBook.ngayKetThuc || '',
              ngayTuVong: deathBook.ngayTuVong || deathBook.ngayKetThuc || '',
              namTuVong: Number(String(deathBook.ngayTuVong || deathBook.ngayKetThuc || '').slice(0, 4)) || 0,
              noiTuVong: deathBook.noiTuVong || '',
              nguyenNhanTuVong: deathBook.nguyenNhanTuVong || '',
              thungSo: Number(deathBook.thungSo) || parseStorageLocation(deathBook).thungSo || 0,
              viTriSo: Number(deathBook.viTriSo) || parseStorageLocation(deathBook).viTriSo || 0,
              maLuuTru: deathBook.maLuuTru || parseStorageLocation(deathBook).label || '',
              soToChamSoc: Number(deathBook.soToChamSoc) || 0,
              soToDieuTri: Number(deathBook.soToDieuTri) || 0,
              soPhieuTruyenDich: Number(deathBook.soPhieuTruyenDich) || 0,
              soPhieuDanhGiaTeNga: Number(deathBook.soPhieuDanhGiaTeNga) || 0,
              soPhieuDanhGiaLoetTiDe: Number(deathBook.soPhieuDanhGiaLoetTiDe) || 0,
              tongSoGiayTo: Number(deathBook.tongSoGiayTo) || 0,
              fileDinhKem: deathBook.fileDinhKem || '',
              updatedAt: serverTimestamp()
            };
          } else {
            updates[`hoSoTuVong/${id}`] = null;
          }

          await update(ref(this.database), updates);
          dataCommitted = true;

          if (
            previousLocationKey &&
            previousLocationKey !== storageReservation.locationKey
          ) {
            try {
              await this.releaseStorageLocationReservation(
                previousLocationKey,
                id,
                [originalKey, targetKey]
              );
            } catch (releaseOldLocationError) {
              console.warn(
                'Đã lưu quyển nhưng chưa dọn được chỉ mục vị trí cũ:',
                releaseOldLocationError
              );
            }
          }

          try {
            await this.releasePatientLock(id, lockToken);
          } catch (releaseLockError) {
            console.warn(
              'Đã lưu quyển nhưng chưa giải phóng được khóa thao tác:',
              releaseLockError
            );
          }

          patchBooksRootCache(id, id, nextBookMap);

          return {
            success: true,
            message: mode === 'edit' ? `Đã cập nhật quyển ${quyenSo}.` : `Đã lưu quyển ${quyenSo}.`,
            data: bookToUi(patient, { ...savedBook, updatedAt: Date.now() })
          };
        } catch (error) {
          if (
            !dataCommitted &&
            storageReservation?.acquiredByThisAttempt &&
            storageReservation?.locationKey
          ) {
            try {
              await this.releaseStorageLocationReservation(
                storageReservation.locationKey,
                id,
                [bookKey(quyenSo)],
                storageReservation.reservationToken
              );
            } catch (releaseLocationError) {
              console.warn(
                'Không giải phóng được vị trí tạm sau khi lưu thất bại:',
                releaseLocationError
              );
            }
          }

          try {
            await this.releasePatientLock(id, lockToken);
          } catch (releaseLockError) {
            console.warn('Không giải phóng được khóa thao tác:', releaseLockError);
          }

          if (!dataCommitted && uploadedFileId) {
            await this.driveUploader.removeTemporary(uploadedFileId);
          }
          throw error;
        }
      }
    }

    const driveUploader = new DriveUploader(
      CONFIG.DRIVE_UPLOAD_URL,
      firebaseAuth
    );
    const api = new FirebaseDataClient(
      firebaseDatabase,
      firebaseAuth,
      driveUploader
    );

    const state = {
      patients: [],
      deaths: [],
      deathsLoaded: false,
      stats: {},
      storageStats: { totalBooks: 0, structuredBooks: 0, unstructuredBooks: 0, totalBoxes: 0, duplicateLocationCount: 0, boxes: [] },
      storageStatsLoaded: false,
      storageSearch: '',
      currentPatient: null,
      currentBooks: [],
      allPatients: [],
      patientPaging: {
        browsePatients: [],
        cursor: null,
        hasMore: false,
        totalCount: null,
        loading: false,
        searchActive: false,
        lastSearchKeyword: '',
        searchRequestId: 0
      },
      activeStatusFilter: 'all',
      deathYearFilter: 'all',
      currentRole: 'public',
      accountAdmin: {
        requests: [],
        permissions: [],
        loaded: false,
        errors: { requests: '', permissions: '' }
      }
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

    let realtimeCatalogUnsubscribe = null;
    let realtimeCatalogMetaSeen = 0;
    let realtimeRefreshTimer = null;
    let realtimeRefreshRunning = false;
    let realtimeRefreshQueued = false;

    function activeViewId() {
      return document.querySelector('.view.active')?.id || 'patientsView';
    }

    async function refreshCurrentPatientRealtime() {
      const soHoSo = state.currentPatient?.['SỐ HỒ SƠ'];
      if (!soHoSo) return;

      const id = firebaseKey(soHoSo);
      const patientSnapshot = await get(
        ref(firebaseDatabase, `${patientCatalogPath()}/${id}`)
      );

      if (!patientSnapshot.exists()) {
        state.currentPatient = null;
        state.currentBooks = [];
        switchView('patients');
        showToast('Hồ sơ đang xem vừa được cập nhật hoặc xóa trên thiết bị khác.');
        return;
      }

      state.currentPatient = patientToUi(id, patientSnapshot.val() || {});
      const detail = await api.get('layChiTietHoSo', { soHoSo });
      state.currentBooks = detail.data || [];
      renderDetail();
    }

    async function runRealtimeDataRefresh() {
      if (realtimeRefreshRunning) {
        realtimeRefreshQueued = true;
        return;
      }

      realtimeRefreshRunning = true;
      try {
        await refreshPatientSummariesSilently();

        const view = activeViewId();
        if (view === 'detailView') {
          await refreshCurrentPatientRealtime();
        } else if (view === 'deathsView') {
          await refreshDeathsSilently();
        } else if (view === 'dashboardView') {
          state.storageStatsLoaded = false;
          await refreshStorageStatsSilently();
        }

        if (view === 'accountsView' && state.currentRole === 'admin') {
          state.accountAdmin.loaded = false;
          await refreshAccountAdministration(true);
        }
      } catch (error) {
        console.warn('Không tự đồng bộ được dữ liệu mới:', error);
      } finally {
        realtimeRefreshRunning = false;
        if (realtimeRefreshQueued) {
          realtimeRefreshQueued = false;
          scheduleRealtimeDataRefresh(250);
        }
      }
    }

    function scheduleRealtimeDataRefresh(delay = 450) {
      window.clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = window.setTimeout(runRealtimeDataRefresh, delay);
    }

    function startRealtimeDataSync() {
      if (realtimeCatalogUnsubscribe) return;

      realtimeCatalogUnsubscribe = onValue(
        ref(firebaseDatabase, 'congKhai/_meta/updatedAt'),
        snapshot => {
          const updatedAt = Number(snapshot.val() || 0);
          if (!updatedAt) return;

          // Lần đầu chỉ ghi nhận mốc hiện tại để không gọi lại bootstrap.
          if (!realtimeCatalogMetaSeen) {
            realtimeCatalogMetaSeen = updatedAt;
            return;
          }

          if (updatedAt <= realtimeCatalogMetaSeen) return;
          realtimeCatalogMetaSeen = updatedAt;
          scheduleRealtimeDataRefresh();
        },
        error => console.warn('Không mở được kênh đồng bộ thời gian thực:', error)
      );
    }

    let hsbaInitStarted = false;

    function startHsbaApp() {
      if (hsbaInitStarted) return;
      hsbaInitStarted = true;

      init().catch(error => {
        console.error('Không khởi động được ứng dụng:', error);
        showPublicState();
        applyRoleUi();
        $('#loading')?.classList.add('hidden');
        $('#connectionBadge')?.classList.add('offline');
        if ($('#connectionBadge')) {
          $('#connectionBadge').textContent = 'CHƯA KẾT NỐI';
        }
        showPublicConnectionError();
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startHsbaApp, { once: true });
    } else {
      startHsbaApp();
    }

    async function init() {
      bindEvents();
      bindAuthentication();
      setToday();

      // Trạng thái mặc định luôn là chế độ xem công khai.
      // Nhờ vậy người chưa đăng nhập vẫn thấy nút đăng nhập,
      // đồng thời tuyệt đối không thấy nút thêm/sửa/xóa trong lúc Firebase đang tải.
      state.currentRole = 'public';
      showPublicState();
      applyRoleUi();

      if (!NETWORK_ALLOWED) {
        $('#authGate').classList.add('hidden');
        $('#patientsEmpty').classList.remove('hidden');
        $('#patientsEmpty').textContent =
          'Hệ thống chỉ hoạt động khi mở bằng kết nối HTTPS.';
        renderDeaths();
        renderStats();
        return;
      }

      try {
        await setPersistence(
          firebaseAuth,
          browserLocalPersistence
        );
      } catch (error) {
        console.warn('Không đặt được chế độ lưu đăng nhập:', error);
      }

      onValue(ref(firebaseDatabase, '.info/connected'), snapshot => {
        const badge = $('#connectionBadge');
        if (!badge) return;

        const connected = snapshot.val() === true;
        badge.textContent = connected ? 'TRỰC TUYẾN' : 'MẤT KẾT NỐI';
        badge.classList.toggle('offline', !connected);
      });

      onAuthStateChanged(firebaseAuth, async user => {
        if (authUpgradeInProgress && !user) return;

        $('#loading').classList.remove('hidden');
        let accessResolved = false;
        const publicMode = !user || user.isAnonymous;

        try {
          if (publicMode) {
            resetPrivateDataCache();
            state.currentRole = 'public';
            showPublicState();
          } else {
            ensurePrivateDataCacheOwner();
            const access = await resolveUserAccess(user);
            accessResolved = true;
            state.currentRole = access.role;
            showLoggedInState(user, access.role, access.displayName);

            if (access.role === 'pending') {
              showToast('Yêu cầu sử dụng HSBA đã được gửi và đang chờ quản trị viên duyệt.');
            } else if (access.role === 'blocked') {
              showToast('Tài khoản HSBA đang bị khóa. Bạn hiện chỉ xem được danh mục công khai.', true);
            } else if (access.role === 'admin') {
              refreshAccountAdministration(true).catch(error => {
                console.warn('Không tải được danh sách tài khoản HSBA:', error);
              });
            }

          }

          applyRoleUi();

          const result = await api.get('bootstrap');
          state.patients = result.data.patients || [];
          state.allPatients = [...state.patients];
          state.patientPaging.browsePatients = [...state.patients];
          state.patientPaging.cursor = result.data.pagination?.cursor || null;
          state.patientPaging.hasMore = result.data.pagination?.hasMore === true;
          const bootstrapTotalCount = result.data.pagination?.totalCount;
          state.patientPaging.totalCount =
            bootstrapTotalCount !== null &&
            bootstrapTotalCount !== undefined &&
            Number.isFinite(Number(bootstrapTotalCount))
              ? Number(bootstrapTotalCount)
              : null;
          state.patientPaging.loading = false;
          state.patientPaging.searchActive = false;
          state.patientPaging.lastSearchKeyword = '';
          state.deaths = [];
          state.deathsLoaded = false;
          state.storageStatsLoaded = false;
          state.stats = result.data.stats || {};

          renderPatients();
          renderDeaths();
          renderStats();
          startRealtimeDataSync();

          if (publicMode && state.patients.length === 0) {
            $('#patientsEmpty')?.classList.remove('hidden');
            if ($('#patientsEmpty')) {
              $('#patientsEmpty').textContent =
                'Danh mục xem hiện chưa có dữ liệu. Người quản trị cần đăng nhập và bấm “Cập nhật danh mục xem”.';
            }
          }
        } catch (error) {
          console.error(error);

          if (!publicMode && !accessResolved) {
            await signOut(firebaseAuth).catch(() => {});
            openLoginDialog();
            showAuthError(
              error.message || 'Tài khoản chưa được cấp quyền.'
            );
          } else if (!publicMode) {
            showLoggedInState(user, state.currentRole || 'pending');
            applyRoleUi();
            showToast(
              'Đã đăng nhập nhưng chưa tải được dữ liệu. Vui lòng tải lại trang.',
              true
            );
          } else {
            showPublicConnectionError();
          }
        } finally {
          $('#loading').classList.add('hidden');
        }
      });
    }

    async function resolveUserAccess(user) {
      if (user?.isAnonymous) {
        return { active: true, role: 'public', email: '' };
      }

      const email = String(user?.email || '').trim().toLowerCase();

      if (email === CONFIG.OWNER_EMAIL.toLowerCase()) {
        const ownerPermission = await readRealtimePermission(user.uid).catch(() => ({}));
        return {
          active: true,
          role: 'admin',
          email,
          displayName: String(ownerPermission.displayName || user.displayName || '').trim()
        };
      }

      const permission = await readRealtimePermission(user.uid);
      const role = String(permission.role || '').trim().toLowerCase();

      if (
        permission.active === true &&
        ['admin', 'editor', 'viewer'].includes(role)
      ) {
        return {
          active: true,
          role,
          email: permission.email || email,
          displayName: String(permission.displayName || user.displayName || '').trim()
        };
      }

      // Tài khoản đã từng được duyệt nhưng đang bị khóa: không tự tạo yêu cầu mới.
      if (permission.email && permission.active === false) {
        return {
          active: false,
          role: 'blocked',
          email: permission.email || email,
          displayName: String(permission.displayName || user.displayName || '').trim()
        };
      }

      const request = await ensureHsbaAccessRequest(user);
      return {
        active: false,
        role: request.status === 'rejected' ? 'rejected' : 'pending',
        email,
        displayName: String(request.displayName || user.displayName || '').trim(),
        request
      };
    }

    async function readRealtimePermission(uid) {
      const snapshot = await get(
        ref(firebaseDatabase, `phanQuyen/${uid}`)
      );
      return snapshot.val() || {};
    }

    async function readHsbaAccessRequest(uid) {
      const snapshot = await get(
        ref(firebaseDatabase, `${CONFIG.ACCESS_REQUEST_PATH}/${uid}`)
      );
      return snapshot.val() || {};
    }

    async function ensureHsbaAccessRequest(user) {
      const uid = String(user?.uid || '').trim();
      const email = String(user?.email || '').trim().toLowerCase();

      if (!uid || !email) {
        throw new Error('Không xác định được tài khoản Google vừa đăng nhập.');
      }

      const existing = await readHsbaAccessRequest(uid);
      const existingStatus = String(existing.status || '').toLowerCase();

      if (existingStatus === 'pending') {
        return existing;
      }

      if (existingStatus === 'approved') {
        throw new Error(
          'Yêu cầu tài khoản đã được duyệt nhưng quyền HSBA chưa đồng bộ. Vui lòng liên hệ quản trị viên.'
        );
      }

      const provider = (user.providerData || [])
        .map(item => String(item?.providerId || '').trim())
        .filter(Boolean)
        .join(',') || 'google.com';

      const request = {
        email,
        displayName: String(user.displayName || '').trim(),
        provider,
        status: 'pending',
        requestedAt: Date.now()
      };

      await set(
        ref(firebaseDatabase, `${CONFIG.ACCESS_REQUEST_PATH}/${uid}`),
        request
      );

      return request;
    }

    function canEditRecords() {
      return state.currentRole === 'admin' || state.currentRole === 'editor';
    }

    function canDeleteRecords() {
      return state.currentRole === 'admin' || state.currentRole === 'editor';
    }

    function roleLabel(role) {
      if (role === 'admin') return 'Quản trị';
      if (role === 'editor') return 'Nhập liệu';
      if (role === 'viewer') return 'Chỉ xem';
      if (role === 'pending') return 'Chờ duyệt';
      if (role === 'blocked') return 'Tạm khóa';
      if (role === 'rejected') return 'Chưa được duyệt';
      return 'Xem công khai';
    }

    function updateAccountAccessNotice() {
      const notice = $('#accountAccessNotice');
      if (!notice) return;

      let message = '';
      if (state.currentRole === 'pending') {
        message = '⏳ Yêu cầu sử dụng HSBA đã được ghi nhận. Bạn vẫn có thể xem danh mục công khai trong khi chờ quản trị viên duyệt; sau khi được duyệt chỉ cần tải lại trang.';
      } else if (state.currentRole === 'blocked') {
        message = 'Tài khoản HSBA hiện đang bị khóa. Vui lòng liên hệ quản trị viên để được mở lại quyền.';
      } else if (state.currentRole === 'rejected') {
        message = 'ℹ️ Yêu cầu sử dụng HSBA chưa được duyệt. Đăng nhập lại sẽ tạo yêu cầu xét duyệt mới.';
      }

      notice.textContent = message;
      notice.classList.toggle('hidden', !message);
    }

    function applyRoleUi() {
      const canEdit = canEditRecords();
      const isGuest = isPublicSession();
      const isAdmin = state.currentRole === 'admin';
      $('#addPatientBtn')?.classList.toggle('hidden', !canEdit);
      $('#exportExcelBtn')?.classList.toggle('hidden', !canEdit);
      $('#syncPublicBtn')?.classList.toggle('hidden', !canEdit);
      $('#adminAccountsNavBtn')?.classList.toggle('hidden', !isAdmin);
      document.body.classList.toggle('read-only-mode', !canEdit);
      document.body.classList.toggle('guest-mode', isGuest);
      updateAccountAccessNotice();
    }

    function requireEditPermission() {
      if (canEditRecords()) return true;
      if (state.currentRole === 'public') {
        openLoginDialog();
        showToast('Vui lòng đăng nhập Google để thực hiện thao tác chỉnh sửa.', true);
      } else if (state.currentRole === 'pending') {
        showToast('Tài khoản đang chờ quản trị viên HSBA duyệt.', true);
      } else if (state.currentRole === 'blocked') {
        showToast('Tài khoản HSBA đang bị khóa.', true);
      } else {
        showToast('Tài khoản này chỉ có quyền xem dữ liệu.', true);
      }
      return false;
    }

    function bindAuthentication() {
      const openLoginButton = $('#openLoginBtn');
      const handleOpenLogin = event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        openLoginDialog();
      };

      openLoginButton.addEventListener('click', handleOpenLogin);
      openLoginButton.addEventListener('pointerup', event => {
        if (event.pointerType === 'touch') handleOpenLogin(event);
      });

      $('#closeAuthGateBtn').addEventListener('click', closeLoginDialog);
      $('#authGate').addEventListener('click', event => {
        if (event.target === $('#authGate')) closeLoginDialog();
      });

      $('#googleLoginBtn').addEventListener('click', async () => {
        const button = $('#googleLoginBtn');
        button.disabled = true;
        button.textContent = 'Đang mở cửa sổ Google...';
        hideAuthError();
        authUpgradeInProgress = true;

        try {
          const currentUser = firebaseAuth.currentUser;

          // Dọn phiên Anonymous cũ nếu trình duyệt từng sử dụng bản thử nghiệm.
          if (currentUser?.isAnonymous) {
            await signOut(firebaseAuth);
          }

          const result = await signInWithPopup(
            firebaseAuth,
            googleProvider
          );

          // Chờ token sẵn sàng rồi đóng hộp đăng nhập.
          // onAuthStateChanged sẽ tự đọc phanQuyen/{UID} và mở giao diện.
          await result.user.getIdToken(true);
          closeLoginDialog();
        } catch (error) {
          showAuthError(firebaseError(error).message);
        } finally {
          authUpgradeInProgress = false;
          button.disabled = false;
          button.innerHTML =
            '<span class="google-mark">G</span> Đăng nhập bằng Google';
        }
      });

      $('#syncPublicBtn').addEventListener('click', async () => {
        if (!canEditRecords()) return;

        const button = $('#syncPublicBtn');
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = 'Đang cập nhật...';

        try {
          const result = await api.rebuildPublicCatalog();
          showToast(
            `Đã cập nhật danh mục xem với ${Number(result?.patientCount) || 0} hồ sơ.`
          );
        } catch (error) {
          console.error(error);
          let message =
            error?.message ||
            'Chưa cập nhật được danh mục xem.';

          if (
            error?.code === 'PERMISSION_DENIED' ||
            /permission[- ]denied/i.test(message)
          ) {
            message =
              'Tài khoản chưa được cấp quyền cập nhật dữ liệu. Vui lòng đăng xuất, đăng nhập lại hoặc liên hệ người quản trị, ' +
              'đăng xuất rồi đăng nhập lại tài khoản quản trị.';
          }

          showToast(message, true);
        } finally {
          button.disabled = false;
          button.textContent = oldText;
        }
      });

      $('#logoutBtn').addEventListener('click', async () => {
        await signOut(firebaseAuth);
      });
    }

    function openLoginDialog() {
      hideAuthError();
      const gate = $('#authGate');
      if (!gate) return;

      gate.classList.remove('hidden');
      gate.setAttribute('aria-hidden', 'false');
      document.body.classList.add('auth-dialog-open');

      requestAnimationFrame(() => {
        gate.scrollTop = 0;
        setTimeout(() => $('#googleLoginBtn')?.focus(), 80);
      });
    }

    function closeLoginDialog() {
      const gate = $('#authGate');
      gate?.classList.add('hidden');
      gate?.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('auth-dialog-open');
      hideAuthError();
    }

    function showPublicState() {
      state.currentRole = 'public';
      state.accountAdmin.loaded = false;
      applyRoleUi();

      $('#authGate').classList.add('hidden');
      $('#openLoginBtn').classList.remove('hidden');
      $('#openLoginBtn').innerHTML = `${uiIcon('log-in')}<span>Đăng nhập chỉnh sửa</span>`;
      $('#authUserBar').classList.add('hidden');
      updateTopGreeting('');
      hideAuthError();

      const googleButton = $('#googleLoginBtn');
      googleButton.disabled = false;
      googleButton.innerHTML =
        '<span class="google-mark">G</span> Đăng nhập bằng Google';
    }

    function showPublicConnectionError() {
      state.currentRole = 'public';
      state.patients = [];
      state.allPatients = [];
      state.deaths = [];
      applyRoleUi();
      showPublicState();

      $('#summary').innerHTML = '';
      $('#patientsList').innerHTML = '';
      $('#patientsEmpty').classList.remove('hidden');
      $('#patientsEmpty').innerHTML = `
        <div class="guest-access-card">
          <div class="guest-icon">ℹ️</div>
          <h3>Chưa thể mở danh mục xem</h3>
          <p>Vui lòng tải lại trang. Nếu tình trạng vẫn còn, liên hệ người quản trị hệ thống.</p>
        </div>`;
      switchView('patients');
    }

    function greetingShortName(value) {
      const displayName = String(value || '').trim().replace(/\s+/g, ' ');
      if (!displayName) return '';
      const parts = displayName.split(' ').filter(Boolean);
      return parts[parts.length - 1] || '';
    }

    function updateTopGreeting(displayName = '') {
      const greeting = $('#topGreetingText');
      if (!greeting) return;
      const shortName = greetingShortName(displayName);
      greeting.textContent = shortName ? `Xin chào, ${shortName} 👋` : 'Xin chào 👋';
    }

    function showLoggedInState(user, role, displayName = '') {
      $('#authGate').classList.add('hidden');
      $('#openLoginBtn').classList.add('hidden');
      $('#authUserBar').classList.remove('hidden');
      document.body.classList.remove('guest-mode');
      updateTopGreeting(displayName || user.displayName || '');
      $('#authUserEmail').textContent = roleLabel(role);
      hideAuthError();
    }

    function showAuthError(message) {
      const element = $('#authError');
      element.textContent = message;
      element.classList.remove('hidden');
    }

    function hideAuthError() {
      const element = $('#authError');
      element.textContent = '';
      element.classList.add('hidden');
    }

    function bindEvents() {
      $('#menuBtn').addEventListener('click', openSidebar);
      $('#overlay').addEventListener('click', closeSidebar);
      $('#addPatientBtn').addEventListener('click', () => openPatientDialog('add'));
      $('#exportExcelBtn')?.addEventListener('click', openReportPreview);
      $('#reportPreviewExportBtn')?.addEventListener('click', exportExcelReport);
      $('#backBtn').addEventListener('click', () => switchView('patients'));
      $('#refreshAccountsBtn')?.addEventListener('click', () => refreshAccountAdministration(true));
      $('#accountRequestsList')?.addEventListener('click', handleAccountRequestAction);
      $('#accountPermissionsList')?.addEventListener('click', handleAccountPermissionAction);

      $('#searchBtn').addEventListener('click', searchPatients);
      $('#searchInput').addEventListener('input', debounce(searchPatients, 320));
      $('#loadMorePatientsBtn')?.addEventListener('click', loadMorePatients);
      $('#searchInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') searchPatients();
      });

      $$('[data-status-filter]').forEach(button => {
        button.addEventListener('click', () => {
          state.activeStatusFilter = button.dataset.statusFilter || 'all';
          searchPatients();
        });
      });

      const openFilterDialog = () => {
        const dialog = $('#advancedFilterDialog');
        const selectedValue = state.activeStatusFilter || 'all';
        const selectedRadio = dialog.querySelector(`input[name="advancedStatus"][value="${selectedValue}"]`);
        if (selectedRadio) selectedRadio.checked = true;
        dialog.showModal();
      };

      $('#openAdvancedFilterBtn').addEventListener('click', openFilterDialog);
      $('#mobileFilterTrigger').addEventListener('click', openFilterDialog);

      $('#applyAdvancedFilterBtn').addEventListener('click', () => {
        const selected = document.querySelector('input[name="advancedStatus"]:checked');
        state.activeStatusFilter = selected ? selected.value : 'all';
        $('#advancedFilterDialog').close();
        searchPatients();
      });

      $('#resetAdvancedFilterBtn').addEventListener('click', () => {
        $('#searchInput').value = '';
        state.activeStatusFilter = 'all';
        const defaultRadio = document.querySelector('input[name="advancedStatus"][value="all"]');
        if (defaultRadio) defaultRadio.checked = true;
        $('#advancedFilterDialog').close();
        searchPatients();
      });

      $('#clearFiltersBtn').addEventListener('click', () => {
        $('#searchInput').value = '';
        state.activeStatusFilter = 'all';
        searchPatients();
      });

      $$('.nav-btn').forEach(button => {
        button.addEventListener('click', () => {
          switchView(button.dataset.view);
          closeSidebar();
        });
      });

      $$('.close-dialog').forEach(button => {
        button.addEventListener('click', () => button.closest('dialog').close());
      });

      $('#confirmActionCancelBtn')?.addEventListener('click', () => closeConfirmActionDialog(false));
      $('#confirmActionSubmitBtn')?.addEventListener('click', () => closeConfirmActionDialog(true));
      $('#confirmActionDialog')?.addEventListener('cancel', event => {
        event.preventDefault();
        closeConfirmActionDialog(false);
      });

      $('#bookForm [name="trangThai"]').addEventListener('change', updateBookStatusFields);
      $('#bookForm [name="thungSo"]').addEventListener('input', updateStorageLocationPreview);
      $('#bookForm [name="viTriSo"]').addEventListener('input', updateStorageLocationPreview);
      INVENTORY_FIELDS.forEach(field => {
        $(`#bookForm [name="${field.key}"]`)?.addEventListener('input', updateDocumentInventoryPreview);
      });
      const recordNumberInput = $('#patientSoHoSo');
      recordNumberInput?.addEventListener('input', () => {
        const cursorAtEnd = recordNumberInput.selectionStart === recordNumberInput.value.length;
        recordNumberInput.value = formatMedicalRecordNumber(recordNumberInput.value);
        if (cursorAtEnd) {
          const end = recordNumberInput.value.length;
          recordNumberInput.setSelectionRange(end, end);
        }
      });
      recordNumberInput?.addEventListener('blur', () => {
        recordNumberInput.value = formatMedicalRecordNumber(recordNumberInput.value);
      });

      $('#patientHoTen')?.addEventListener('blur', event => {
        event.currentTarget.value = formatVietnamesePersonName(event.currentTarget.value);
      });
      $('#patientForm').addEventListener('submit', submitPatient);
      $('#bookForm').addEventListener('submit', submitBook);
      $('#deletePatientForm').addEventListener('submit', submitDeletePatient);
    }

    function setToday() {
      const today = new Date().toISOString().slice(0, 10);
      $('#bookForm [name="ngayBatDau"]').value = today;
      $('#bookForm [name="ngayKetThuc"]').value = today;
    }

    function applyPatientFilters() {
      const statusFilter = state.activeStatusFilter || 'all';

      state.patients = state.allPatients.filter(patient => {
        return (
          statusFilter === 'all' ||
          getPatientStatusGroup(patient) === statusFilter
        );
      });

      renderFilterControls();
      renderPatients();
      renderPatientPagination();
    }

    async function searchPatients() {
      const keyword = String($('#searchInput').value || '').trim();
      const normalizedKeyword = normalize(keyword);
      const paging = state.patientPaging;

      if (!keyword) {
        paging.searchActive = false;
        paging.lastSearchKeyword = '';
        state.allPatients = [...paging.browsePatients];
        applyPatientFilters();
        return;
      }

      // Nếu từ khóa không đổi (ví dụ chỉ đổi bộ lọc trạng thái), không gọi Firebase lại.
      if (
        paging.searchActive &&
        paging.lastSearchKeyword === normalizedKeyword
      ) {
        applyPatientFilters();
        return;
      }

      const requestId = ++paging.searchRequestId;
      paging.loading = true;
      paging.searchActive = true;
      paging.lastSearchKeyword = normalizedKeyword;
      renderPatientPagination();

      try {
        const entries = await searchPatientEntriesRemote(keyword);
        if (requestId !== paging.searchRequestId) return;

        state.allPatients = entries.map(({ id, patient }) =>
          patientToUi(id, patient)
        );
        applyPatientFilters();
      } catch (error) {
        if (requestId !== paging.searchRequestId) return;
        console.error('Không tìm kiếm được hồ sơ:', error);
        showToast(
          error?.message || 'Không tìm kiếm được hồ sơ. Vui lòng thử lại.',
          true
        );
      } finally {
        if (requestId === paging.searchRequestId) {
          paging.loading = false;
          renderPatientPagination();
        }
      }
    }

    async function loadMorePatients() {
      const paging = state.patientPaging;
      if (paging.loading || paging.searchActive || !paging.hasMore) return;

      paging.loading = true;
      renderPatientPagination();

      try {
        const page = await readPatientPage(paging.cursor);
        const existing = new Map(
          paging.browsePatients.map(patient => [
            patient['_FIREBASE_ID'] || firebaseKey(patient['SỐ HỒ SƠ']),
            patient
          ])
        );

        page.entries.forEach(({ id, patient }) => {
          existing.set(id, patientToUi(id, patient));
        });

        paging.browsePatients = [...existing.values()];
        paging.cursor = page.cursor;
        paging.hasMore = page.hasMore;
        state.allPatients = [...paging.browsePatients];
        applyPatientFilters();
      } catch (error) {
        console.error('Không tải thêm được hồ sơ:', error);
        showToast(
          error?.message || 'Không tải thêm được hồ sơ. Vui lòng thử lại.',
          true
        );
      } finally {
        paging.loading = false;
        renderPatientPagination();
      }
    }

    function renderPatientPagination() {
      const container = $('#patientPagination');
      const info = $('#patientPaginationInfo');
      const button = $('#loadMorePatientsBtn');
      if (!container || !info || !button) return;

      const paging = state.patientPaging;
      const loaded = paging.browsePatients.length;
      const total = paging.totalCount;

      if (paging.searchActive) {
        container.classList.remove('hidden');
        info.textContent =
          `Tìm thấy ${state.allPatients.length} hồ sơ · tối đa ${CONFIG.PATIENT_SEARCH_LIMIT} kết quả mỗi lần tìm.`;
        button.classList.add('hidden');
        return;
      }

      button.classList.remove('hidden');
      const totalLabel = Number.isFinite(total)
        ? ` / ${total}`
        : '';
      info.textContent = `Đã tải ${loaded}${totalLabel} hồ sơ.`;
      button.disabled = paging.loading || !paging.hasMore;
      button.textContent = paging.loading
        ? 'Đang tải...'
        : paging.hasMore
          ? `Tải thêm ${CONFIG.PATIENT_PAGE_SIZE} hồ sơ`
          : 'Đã tải hết hồ sơ';

      container.classList.toggle(
        'hidden',
        loaded === 0 && !paging.hasMore
      );
    }

    function getPatientStatusGroup(patient) {
      const latestStatus = normalizeRecordStatus(patient['TRẠNG THÁI MỚI NHẤT']);
      const totalBooks = Number(patient['TỔNG SỐ QUYỂN']) || 0;
      if (latestStatus === CONFIG.STATUS.TU_VONG) return 'death';
      if (latestStatus === CONFIG.STATUS.HOI_GIA) return 'returned';
      if (latestStatus === CONFIG.STATUS.CHUYEN_TRUNG_TAM) return 'transferred';
      if (latestStatus === CONFIG.STATUS.KHAC) return 'other';
      if (latestStatus === CONFIG.STATUS.HET_QUYEN) return 'finished';
      return totalBooks > 0 ? 'finished' : 'empty';
    }

    function renderFilterControls() {
      // Bộ lọc vẫn lọc theo HỒ SƠ, nhưng số hiển thị của các trạng thái kết thúc
      // phải là tổng SỐ QUYỂN thực tế. Một hồ sơ có thể có nhiều quyển.
      const counts = {
        // Số trên bộ lọc phản ánh phạm vi đang tải/tìm kiếm hiện tại.
        // Tổng số toàn hệ thống được hiển thị riêng ở thanh phân trang.
        all: state.allPatients.length,
        finished: 0,
        returned: 0,
        death: 0,
        empty: 0
      };

      state.allPatients.forEach(patient => {
        counts.finished += Number(patient['_SỐ QUYỂN HẾT QUYỂN']) || 0;
        counts.returned += Number(patient['_SỐ QUYỂN HỒI GIA']) || 0;
        counts.death += Number(patient['_SỐ QUYỂN TỬ VONG']) || 0;

        if ((Number(patient['TỔNG SỐ QUYỂN']) || 0) === 0) {
          counts.empty += 1;
        }
      });

      $$('[data-filter-count]').forEach(element => {
        element.textContent = counts[element.dataset.filterCount] || 0;
      });
      $$('[data-adv-count]').forEach(element => {
        element.textContent = counts[element.dataset.advCount] || 0;
      });
      $$('[data-status-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.statusFilter === state.activeStatusFilter);
      });

      const filterNames = {
        all: 'Tất cả hồ sơ',
        finished: 'Hết quyển',
        returned: 'Đối tượng hồi gia',
        death: 'Đối tượng tử vong',
        empty: 'Chưa lưu quyển'
      };
      const activeFilter = state.activeStatusFilter || 'all';
      if ($('#mobileFilterLabel')) $('#mobileFilterLabel').textContent = filterNames[activeFilter] || filterNames.all;
      if ($('#mobileFilterCount')) $('#mobileFilterCount').textContent = counts[activeFilter] || 0;
      const selectedRadio = document.querySelector(`input[name="advancedStatus"][value="${activeFilter}"]`);
      if (selectedRadio) selectedRadio.checked = true;
    }

    function debounce(callback, wait = 160) {
      let timer;

      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => callback(...args), wait);
      };
    }

    function renderPatients() {
      // Thống kê trạng thái theo SỐ QUYỂN thực tế, không đếm theo số hồ sơ.
      // Một hồ sơ có thể có nhiều quyển nên dùng các trường tổng hợp từ quyenHoSo.
      const finishedCount = state.patients.reduce(
        (sum, patient) => sum + (Number(patient['_SỐ QUYỂN HẾT QUYỂN']) || 0),
        0
      );
      const returnCount = state.patients.reduce(
        (sum, patient) => sum + (Number(patient['_SỐ QUYỂN HỒI GIA']) || 0),
        0
      );
      const deathCount = state.patients.reduce(
        (sum, patient) => sum + (Number(patient['_SỐ QUYỂN TỬ VONG']) || 0),
        0
      );

      const patientSummaryLabel = state.patientPaging.searchActive
        ? `${state.patients.length} kết quả`
        : `${state.patients.length} hồ sơ đang hiển thị`;

      $('#summary').innerHTML = `
        <span class="chip">${uiIcon('users')} ${patientSummaryLabel}</span>
        <span class="chip">${uiIcon('check')} ${finishedCount} quyển hết quyển</span>
        <span class="chip">${uiIcon('home')} ${returnCount} quyển hồi gia</span>
        <span class="chip">${uiIcon('folder')} ${deathCount} quyển tử vong</span>
      `;

      if (!state.patients.length) {
        $('#patientsList').innerHTML = '';
        const emptyElement = $('#patientsEmpty');
        emptyElement.classList.remove('hidden');
        emptyElement.textContent = state.patientPaging.searchActive
          ? 'Không tìm thấy hồ sơ phù hợp với từ khóa và điều kiện tra cứu.'
          : state.allPatients.length
            ? 'Không tìm thấy hồ sơ phù hợp với điều kiện tra cứu trong số hồ sơ đã tải.'
            : isPublicSession()
              ? 'Danh mục xem hiện chưa có hồ sơ. Người quản trị vui lòng bấm “Cập nhật danh mục xem”.'
              : 'Chưa có dữ liệu.';
        renderFilterControls();
        renderPatientPagination();
        return;
      }

      $('#patientsEmpty').classList.add('hidden');
      $('#patientsList').innerHTML = state.patients.map(patient => {
        const latest = normalizeRecordStatus(patient['TRẠNG THÁI MỚI NHẤT']);
        const totalBooks = Number(patient['TỔNG SỐ QUYỂN']) || 0;
        const statusGroup = getPatientStatusGroup(patient);

        let displayStatus = 'Chưa lưu quyển hồ sơ';
        let statusClass = 'closed';

        if (statusGroup === 'death') {
          displayStatus = CONFIG.STATUS.TU_VONG;
          statusClass = 'death';
        } else if (statusGroup === 'returned') {
          displayStatus = CONFIG.STATUS.HOI_GIA;
          statusClass = 'open';
        } else if (statusGroup === 'finished' || totalBooks > 0) {
          // Hồ sơ đã có quyển nhưng dữ liệu tóm tắt cũ có thể chưa có trạng thái.
          // Không được hiển thị nhầm là “Chưa lưu quyển hồ sơ”.
          displayStatus = latest || CONFIG.STATUS.HET_QUYEN;
          statusClass = 'closed';
        }

        return `
          <article class="patient-card">
            ${genderAvatarHtml(patient['GIỚI TÍNH'])}
            <div>
              <h3>${escapeHtml(patient['HỌ VÀ TÊN'])}</h3>
              <div class="patient-info-grid">
                <div class="patient-info-item"><span class="patient-info-label">Năm sinh</span><span class="patient-info-value">${escapeHtml(patient['NĂM SINH'])}</span></div>
                <div class="patient-info-item"><span class="patient-info-label">Giới tính</span><span class="patient-info-value">${escapeHtml(patient['GIỚI TÍNH'] || 'Chưa cập nhật')}</span></div>
                <div class="patient-info-item"><span class="patient-info-label">Số hồ sơ</span><span class="patient-info-value">${escapeHtml(patient['SỐ HỒ SƠ'])}</span></div>
                <div class="patient-info-item"><span class="patient-info-label">Số quyển</span><span class="patient-info-value">${Number(patient['TỔNG SỐ QUYỂN']) || 0}</span></div>
              </div>
              <div class="patient-status-row">
                <span class="badge ${statusClass}">${escapeHtml(displayStatus)}</span>
              </div>
            </div>
            <div class="patient-action">
              <button class="btn small" data-action="open-patient" data-so-ho-so="${escapeAttr(patient['SỐ HỒ SƠ'])}">
                <span class="detail-label-desktop">Xem chi tiết →</span><span class="detail-label-mobile" aria-hidden="true">›</span>
              </button>
            </div>
          </article>`;
      }).join('');

      $$('[data-action="open-patient"]').forEach(button => {
        button.addEventListener('click', () => openPatient(button.dataset.soHoSo));
      });
      renderFilterControls();
      renderPatientPagination();
    }

    async function openPatient(soHoSo, showLoader = false) {
      await withLoading(async () => {
        const patient = state.patients.find(
          item => normalize(item['SỐ HỒ SƠ']) === normalize(soHoSo)
        );

        const result = await api.get('layChiTietHoSo', { soHoSo });

        state.currentPatient = patient || {
          'SỐ HỒ SƠ': soHoSo,
          'HỌ VÀ TÊN': '',
          'NĂM SINH': '',
          'GIỚI TÍNH': ''
        };

        state.currentBooks = result.data || [];

        renderDetail();
        switchView('detail');
      }, showLoader);
    }

    function renderDetail() {
      const patient = state.currentPatient;
      const books = state.currentBooks;
      const isDeath = books.some(book => normalizeRecordStatus(book['TRẠNG THÁI HIỆN TẠI']) === CONFIG.STATUS.TU_VONG);
      const canEdit = canEditRecords();

      const isPublicView = isPublicSession();
      const detailColumnCount = isPublicView ? 7 : 10;

      $('#patientDetail').innerHTML = `
        <section class="detail-card">
          ${genderAvatarHtml(patient['GIỚI TÍNH'], true)}
          <div>
            <h2>${escapeHtml(patient['HỌ VÀ TÊN'])}</h2>
            <div class="patient-meta-inline">
              <span>Số hồ sơ: <strong>${escapeHtml(patient['SỐ HỒ SƠ'])}</strong></span>
              <span>Năm sinh: <strong>${escapeHtml(patient['NĂM SINH'])}</strong></span>
              <span>Giới tính: <strong>${escapeHtml(patient['GIỚI TÍNH'] || 'Chưa cập nhật')}</strong></span>
            </div>
            <div class="badges">
              <span class="badge">${uiIcon('book')} ${books.length} quyển</span>
              ${patient['TRẠNG THÁI MỚI NHẤT'] ? `<span class="badge ${isDeath ? 'death' : 'closed'}">${escapeHtml(patient['TRẠNG THÁI MỚI NHẤT'])}</span>` : ''}
            </div>
          </div>
          <div class="detail-action">
            ${canEdit ? `<div class="detail-action-group">
              ${(state.currentRole === 'admin' || books.length > 0)
                ? `<button id="editPatientBtn" class="btn secondary-action">${uiIcon('edit')}<span>Chỉnh sửa thông tin</span></button>`
                : ''}
              ${canDeleteRecords() ? `<button id="deletePatientBtn" class="btn danger-action" ${state.currentRole === 'editor' && books.length ? 'disabled title="Tài khoản nhập liệu không được xóa hồ sơ đã có quyển"' : ''}>${uiIcon('trash')}<span>Xóa hồ sơ</span></button>` : ''}
              <button id="openBookBtn" class="btn primary" ${isDeath ? 'disabled title="Hồ sơ tử vong không mở thêm quyển mới"' : ''}>${uiIcon('plus')}<span>Lưu hồ sơ</span></button>
            </div>` : `<span class="readonly-label">${uiIcon('eye')} ${isPublicView ? 'Xem công khai' : 'Chế độ chỉ xem'}</span>`}
          </div>
        </section>

        <div class="book-records-wrap">
          ${books.length
            ? books.map(book => bookRecordTableHtml(book, isPublicView)).join('')
            : `<div class="empty-book-record">Chưa lưu quyển hồ sơ.</div>`}
        </div>`;

      $('#openBookBtn')?.addEventListener('click', () => openBookDialog(patient['SỐ HỒ SƠ']));
      $('#editPatientBtn')?.addEventListener('click', () => openPatientDialog('edit', patient));
      $('#deletePatientBtn')?.addEventListener('click', () => openDeletePatientDialog(patient));
      $$('[data-action="edit-book"]').forEach(button => {
        button.addEventListener('click', () => openEditBookDialog(Number(button.dataset.quyenSo)));
      });
      $$('[data-action="view-inventory"]').forEach(button => {
        button.addEventListener('click', () => openInventoryDetailDialog(Number(button.dataset.quyenSo)));
      });
    }

    function openInventoryDetailDialog(quyenSo) {
      const book = state.currentBooks.find(item => Number(item['QUYỂN SỐ']) === Number(quyenSo));
      if (!book) return;

      const inventory = documentInventoryFromSource(book);
      $('#inventoryDetailTitle').textContent = `Kiểm kê giấy tờ · Quyển ${quyenSo}`;
      $('#inventoryDetailSubtitle').textContent = `${state.currentPatient?.['HỌ VÀ TÊN'] || ''} · Số hồ sơ ${state.currentPatient?.['SỐ HỒ SƠ'] || ''}`;

      if (!inventory.complete) {
        $('#inventoryDetailContent').innerHTML = '<div class="empty">Quyển hồ sơ này chưa được kiểm kê thành phần giấy tờ.</div>';
      } else {
        $('#inventoryDetailContent').innerHTML = `
          <div class="inventory-detail-total">
            <span>Tổng số tờ và phiếu đã kiểm kê</span>
            <strong>${escapeHtml(inventory.total)}</strong>
          </div>
          <div class="inventory-detail-grid">
            ${INVENTORY_FIELDS.map(field => `
              <div class="inventory-detail-item">
                <span>${escapeHtml(field.label)}</span>
                <strong>${escapeHtml(inventory[field.key])}</strong>
              </div>`).join('')}
          </div>`;
      }

      $('#inventoryDetailDialog').showModal();
    }

    function documentInventoryCellHtml(source = {}) {
      const inventory = documentInventoryFromSource(source);
      if (!inventory.complete) {
        return '<span class="inventory-missing">Chưa kiểm kê</span>';
      }

      return `
        <div class="inventory-summary-card">
          <div>
            <small>Tổng kiểm kê</small>
            <strong>${escapeHtml(inventory.total)} tờ/phiếu</strong>
          </div>
          <button
            type="button"
            class="inventory-detail-btn"
            data-action="view-inventory"
            data-quyen-so="${escapeAttr(source['QUYỂN SỐ'])}">
            Chi tiết
          </button>
        </div>`;
    }

    function bookDynamicStructure(book, publicView = false) {
      const status =
        normalizeRecordStatus(book['TRẠNG THÁI HIỆN TẠI']) ||
        'Chưa hoàn tất';

      const base = [
        { key: 'book', title: 'Quyển' },
        { key: 'period', title: 'Thời gian' },
        { key: 'status', title: 'Trạng thái' }
      ];

      // Người xem công khai không được nhận nơi/nguyên nhân tử vong.
      // Với tài khoản đã đăng nhập, tiêu đề được tạo đúng theo trạng thái.
      if (status === CONFIG.STATUS.TU_VONG) {
        base.push({ key: 'deathDate', title: 'Ngày tử vong' });
        if (!publicView) {
          base.push(
            { key: 'deathPlace', title: 'Nơi tử vong' },
            { key: 'deathCause', title: 'Nguyên nhân tử vong' }
          );
        }
      } else if (status === CONFIG.STATUS.HOI_GIA) {
        base.push({ key: 'returnDate', title: 'Ngày hồi gia' });
      } else if (status === CONFIG.STATUS.CHUYEN_TRUNG_TAM) {
        base.push({ key: 'transferDate', title: 'Ngày chuyển trung tâm' });
      } else if (status === CONFIG.STATUS.KHAC && !publicView) {
        base.push({ key: 'otherContent', title: 'Nội dung khác' });
      }

      base.push(
        { key: 'storage', title: 'Vị trí lưu' },
        { key: 'inventory', title: 'Kiểm kê' }
      );

      if (!publicView) {
        base.push(
          { key: 'file', title: 'Tệp' },
          { key: 'note', title: 'Ghi chú' },
          { key: 'action', title: 'Thao tác' }
        );
      }

      return { status, columns: base };
    }

    function bookCellHtml(columnKey, book, status, publicView = false) {
      const statusClass =
        status === CONFIG.STATUS.TU_VONG
          ? 'death'
          : status === CONFIG.STATUS.HOI_GIA
            ? 'open'
            : 'closed';

      const storageBox = book['THÙNG SỐ']
        ? `Thùng ${escapeHtml(book['THÙNG SỐ'])}`
        : 'Chưa cập nhật';
      const storagePosition = book['VỊ TRÍ SỐ']
        ? `Vị trí ${escapeHtml(book['VỊ TRÍ SỐ'])}`
        : escapeHtml(book['MÃ SỐ LƯU TRỮ'] || 'Chưa cập nhật');

      switch (columnKey) {
        case 'book':
          return `
            <td class="book-number-cell" data-label="Quyển">
              <strong>${escapeHtml(book['QUYỂN SỐ'])}</strong>
            </td>`;

        case 'period':
          return `
            <td data-label="Thời gian">
              <div class="book-period-cell">
                <div class="book-period-line">
                  <span>Mở</span>
                  <strong>${escapeHtml(
                    formatDateVN(book['NGÀY BẮT ĐẦU'])
                  )}</strong>
                </div>
                <div class="book-period-line">
                  <span>Kết thúc</span>
                  <strong>${escapeHtml(
                    formatDateVN(book['NGÀY KẾT THÚC'])
                  )}</strong>
                </div>
              </div>
            </td>`;

        case 'status':
          return `
            <td class="book-status-cell" data-label="Trạng thái">
              <span class="badge ${statusClass}">
                ${escapeHtml(status)}
              </span>
              ${book['_LEGACY_STATUS'] === CONFIG.STATUS.LEGACY_DANG_KHAM
                ? '<span class="legacy-status-note">Cần chỉnh sửa để hoàn tất hồ sơ.</span>'
                : ''}
            </td>`;

        case 'deathPlace':
          return `
            <td class="event-plain-cell" data-label="Nơi tử vong">
              ${escapeHtml(book['NƠI TỬ VONG'] || 'Chưa cập nhật')}
            </td>`;

        case 'deathCause':
          return `
            <td class="event-plain-cell" data-label="Nguyên nhân tử vong">
              ${escapeHtml(
                book['NGUYÊN NHÂN TỬ VONG'] || 'Chưa cập nhật'
              )}
            </td>`;

        case 'returnDate':
          return `
            <td class="event-plain-cell" data-label="Ngày hồi gia">
              ${escapeHtml(formatDateVN(book['NGÀY HỒI GIA']))}
            </td>`;

        case 'deathDate':
          return `
            <td class="event-plain-cell" data-label="Ngày tử vong">
              ${escapeHtml(formatDateVN(book['NGÀY TỬ VONG']))}
            </td>`;

        case 'transferDate':
          return `
            <td class="event-plain-cell" data-label="Ngày chuyển trung tâm">
              ${escapeHtml(formatDateVN(book['NGÀY CHUYỂN TRUNG TÂM']))}
            </td>`;

        case 'otherContent':
          return `
            <td class="event-plain-cell" data-label="Nội dung khác">
              ${escapeHtml(book['NỘI DUNG KHÁC'] || 'Chưa cập nhật')}
            </td>`;

        case 'storage':
          return `
            <td data-label="Vị trí lưu">
              <div class="storage-simple-values">
                <strong>${storageBox}</strong>
                <strong>${storagePosition}</strong>
              </div>
            </td>`;

        case 'inventory':
          return `
            <td data-label="Kiểm kê" data-full="true">
              ${documentInventoryCellHtml(book)}
            </td>`;

        case 'file':
          return `
            <td data-label="Tệp">
              ${book['FILE ĐÍNH KÈM']
                ? `<a class="file-link"
                     href="${escapeAttr(book['FILE ĐÍNH KÈM'])}"
                     target="_blank"
                     rel="noopener">${uiIcon('paperclip')}<span>Mở tệp</span></a>`
                : '—'}
            </td>`;

        case 'note':
          return `
            <td class="book-note-cell" data-label="Ghi chú" data-full="true">
              ${escapeHtml(book['GHI CHÚ'] || '—')}
            </td>`;

        case 'action':
          return `
            <td data-label="Thao tác">
              ${canEditRecords()
                ? `<button
                     class="btn small edit-action"
                     data-action="edit-book"
                     data-quyen-so="${escapeAttr(book['QUYỂN SỐ'])}">
                     ✎ Chỉnh sửa
                   </button>`
                : '—'}
            </td>`;

        default:
          return '<td>—</td>';
      }
    }

    function bookRecordTableHtml(book, publicView = false) {
      const structure = bookDynamicStructure(book, publicView);

      return `
        <div class="table-wrap book-record-table-wrap">
          <table class="book-table dynamic-book-table">
            <thead>
              <tr>
                ${structure.columns
                  .map(column => `<th>${escapeHtml(column.title)}</th>`)
                  .join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                ${structure.columns
                  .map(column =>
                    bookCellHtml(
                      column.key,
                      book,
                      structure.status,
                      publicView
                    )
                  )
                  .join('')}
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    function renderDeaths() {
      const publicView = isPublicSession();
      const years = [...new Set(
        state.deaths
          .map(item => Number(item['NĂM TỬ VONG']))
          .filter(Boolean)
      )].sort((a, b) => b - a);
      const filtered = state.deathYearFilter === 'all'
        ? state.deaths
        : state.deaths.filter(
            item =>
              String(item['NĂM TỬ VONG']) ===
              String(state.deathYearFilter)
          );

      const publicHeaders = `
        <th>Số hồ sơ</th><th>Họ và tên</th><th>Năm sinh</th>
        <th>Giới tính</th><th>Quyển số</th><th>Ngày kết thúc</th>
        <th>Năm</th><th>Thùng số</th><th>Vị trí số</th>
        <th>Kiểm kê giấy tờ</th>`;
      const privateHeaders = `
        <th>Số hồ sơ</th><th>Họ và tên</th><th>Năm sinh</th>
        <th>Giới tính</th><th>Quyển số</th><th>Ngày tử vong</th>
        <th>Năm</th><th>Nơi tử vong</th><th>Nguyên nhân tử vong</th>
        <th>Thùng số</th><th>Vị trí số</th><th>Kiểm kê giấy tờ</th>
        <th>File</th>`;

      $('#deathsList').innerHTML = `
        <div class="death-overview">
          <div>
            <h3>Danh mục hồ sơ tử vong</h3>
            <p>${publicView
              ? 'Tra cứu theo năm và vị trí lưu trữ.'
              : 'Tra cứu theo năm, nơi và nguyên nhân tử vong, vị trí lưu trữ.'}</p>
          </div>
          <div class="death-count">${filtered.length}</div>
        </div>
        <div class="death-year-toolbar">
          <label>Năm tử vong
            <select id="deathYearSelect">
              <option value="all">Tất cả các năm</option>
              ${years.map(year => `
                <option value="${year}"
                  ${String(state.deathYearFilter) === String(year)
                    ? 'selected'
                    : ''}>${year}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="table-wrap"><table>
          <thead><tr>${publicView ? publicHeaders : privateHeaders}</tr></thead>
          <tbody>${filtered.length ? filtered.map(item => {
            const commonCells = `
              <td><strong>${escapeHtml(item['SỐ HỒ SƠ'])}</strong></td>
              <td>${escapeHtml(item['HỌ VÀ TÊN'])}</td>
              <td>${escapeHtml(item['NĂM SINH'])}</td>
              <td>${escapeHtml(item['GIỚI TÍNH'] || '—')}</td>
              <td><span class="badge closed">Quyển ${escapeHtml(item['QUYỂN SỐ'])}</span></td>
              <td>${escapeHtml(formatDateVN(publicView ? item['NGÀY KẾT THÚC'] : item['NGÀY TỬ VONG']))}</td>
              <td><strong>${escapeHtml(item['NĂM TỬ VONG'])}</strong></td>`;
            const storageCells = `
              <td>${item['THÙNG SỐ']
                ? `Thùng ${escapeHtml(item['THÙNG SỐ'])}`
                : '—'}</td>
              <td>${item['VỊ TRÍ SỐ']
                ? `Vị trí ${escapeHtml(item['VỊ TRÍ SỐ'])}`
                : escapeHtml(item['MÃ SỐ LƯU TRỮ'] || '—')}</td>
              <td>${documentInventoryCellHtml(item)}</td>`;

            if (publicView) {
              return `<tr>${commonCells}${storageCells}</tr>`;
            }

            return `<tr>
              ${commonCells}
              <td>${escapeHtml(item['NƠI TỬ VONG'] || '—')}</td>
              <td class="death-cause-cell">${escapeHtml(item['NGUYÊN NHÂN TỬ VONG'] || '—')}</td>
              ${storageCells}
              <td>${item['FILE ĐÍNH KÈM']
                ? `<a class="file-link" href="${escapeAttr(item['FILE ĐÍNH KÈM'])}" target="_blank" rel="noopener">${uiIcon('paperclip')}<span>Mở file</span></a>`
                : '—'}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="${publicView ? 10 : 13}">Chưa có hồ sơ tử vong trong năm đã chọn.</td></tr>`}</tbody>
        </table></div>`;

      $('#deathYearSelect')?.addEventListener('change', event => {
        state.deathYearFilter = event.target.value || 'all';
        renderDeaths();
      });
    }

    function renderStats() {
      const stats = state.stats || {};
      const totalPatients = Number(stats.tongDoiTuong) || 0;
      const totalBooks = Number(stats.tongQuyenHoSo) || 0;
      const finishedBooks = Number(stats.hoSoHetQuyen) || 0;
      const returnedBooks = Number(stats.hoSoHoiGia) || 0;
      const deathBooks = Number(stats.hoSoTuVong) || 0;
      const transferredBooks = Number(stats.hoSoChuyenTrungTam) || Number(state.storageStats?.transferredBooks) || 0;
      const otherBooks = Number(stats.hoSoKhac) || Number(state.storageStats?.otherBooks) || 0;
      const scannedBooks = Number(stats.hoSoCoFile) || 0;
      const unscannedBooks = Number(stats.hoSoChuaFile) || 0;
      const scanRate = totalBooks ? Math.round(scannedBooks / totalBooks * 100) : 0;
      const averageBooks = totalPatients ? (totalBooks / totalPatients).toFixed(1) : '0';
      const rate = value => totalBooks ? Math.round(value / totalBooks * 100) : 0;
      const storageStats = state.storageStats || {};
      const totalBoxes = Number(storageStats.totalBoxes) || 0;
      const structuredBooks = Number(storageStats.structuredBooks) || 0;
      const unstructuredBooks = Number(storageStats.unstructuredBooks) || 0;
      const inventoryStats = storageStats.inventory || {};

      const publicView = isPublicSession();

      $('#statsGrid').innerHTML = `
        ${publicView ? `<div class="public-view-note">${uiIcon('eye')}<span>Đang xem danh mục tra cứu công khai. Đăng nhập để xem tệp, ghi chú và thông tin nghiệp vụ đầy đủ.</span></div>` : ''}
        <div class="dashboard-kpi-grid">
          ${dashboardKpiHtml({icon:'users',label:'Tổng hồ sơ',value:totalPatients,note:'Số đối tượng đã tạo hồ sơ lưu trữ',color:'#D95F57',bg:'#FFF0ED',soft:'rgba(242,128,118,.16)'})}
          ${dashboardKpiHtml({icon:'book',label:'Tổng quyển lưu',value:totalBooks,note:`Bình quân ${averageBooks} quyển/hồ sơ`,color:'#A66F48',bg:'#FFF6EA',soft:'rgba(251,193,147,.18)'})}
          ${dashboardKpiHtml({icon:'check',label:'Hết quyển',value:finishedBooks,note:`${rate(finishedBooks)}% tổng số quyển`,color:'#C94F49',bg:'#FFECE9',soft:'rgba(255,182,175,.19)'})}
          ${dashboardKpiHtml({icon:'home',label:'Đối tượng hồi gia',value:returnedBooks,note:`${rate(returnedBooks)}% tổng số quyển`,color:'#388D7B',bg:'#EEF9F6',soft:'rgba(78,176,155,.16)'})}
          ${dashboardKpiHtml({icon:'box',label:'Tổng thùng lưu trữ',value:totalBoxes,note:`${structuredBooks} quyển đã xác định vị trí`,color:'#A86B3C',bg:'#FFF2E5',soft:'rgba(250,224,199,.24)'})}
        </div>
        <div class="dashboard-panels">
          <article class="dashboard-panel">
            <div class="dashboard-panel-head"><div><h3 class="dashboard-panel-title">Tiến độ số hóa hồ sơ</h3><p class="dashboard-panel-subtitle">Tỷ lệ quyển hồ sơ có file scan hoặc hình ảnh</p></div><span class="dashboard-panel-badge">${scanRate}%</span></div>
            <div class="scan-overview"><div class="scan-ring" style="--progress:${scanRate}"><div class="scan-ring-value"><strong>${scanRate}%</strong><span>Đã số hóa</span></div></div>
              <div class="scan-details"><div class="scan-detail-row"><span>Có file</span><strong>${scannedBooks} quyển</strong></div><div class="progress-track"><div class="progress-fill" style="width:${scanRate}%"></div></div><div class="scan-detail-row"><span>Chưa có file</span><strong>${unscannedBooks} quyển</strong></div><div class="scan-detail-row"><span>Tổng quyển</span><strong>${totalBooks} quyển</strong></div></div>
            </div>
          </article>
          <article class="dashboard-panel">
            <div class="dashboard-panel-head"><div><h3 class="dashboard-panel-title">Cơ cấu trạng thái lưu trữ</h3><p class="dashboard-panel-subtitle">Theo trạng thái kết thúc của từng quyển hồ sơ</p></div><span class="dashboard-panel-badge">${totalBooks} quyển</span></div>
            <div class="status-bars">
              ${statusBarHtml('Hết quyển', finishedBooks, rate(finishedBooks), 'archive')}
              ${statusBarHtml('Đối tượng hồi gia', returnedBooks, rate(returnedBooks), 'open')}
              ${statusBarHtml('Đối tượng tử vong', deathBooks, rate(deathBooks), 'death')}
              ${statusBarHtml('Đối tượng chuyển trung tâm', transferredBooks, rate(transferredBooks), 'archive')}
              ${statusBarHtml('Khác', otherBooks, rate(otherBooks), 'archive')}
            </div>
          </article>
          <article class="dashboard-panel">
            <div class="dashboard-panel-head"><div><h3 class="dashboard-panel-title">Chỉ số quản lý</h3><p class="dashboard-panel-subtitle">Các chỉ số phục vụ kiểm tra hồ sơ lưu trữ</p></div></div>
            <div class="management-metrics">
              ${managementMetricHtml('book','Bình quân quyển',`${averageBooks}`,'Mỗi hồ sơ','#74413E','#FFF7F5')}
              ${managementMetricHtml('folder','Hồ sơ tử vong',`${deathBooks}`,'Quyển hồ sơ','#b94747','#fdebec')}
              ${managementMetricHtml('paperclip','File còn thiếu',`${unscannedBooks}`,'Quyển cần bổ sung','#d36a3d','#fff0e8')}
            </div>
          </article>
        </div>
        ${storageInventoryPanelHtml(storageStats)}
        ${documentInventoryStatsPanelHtml(inventoryStats)}
        <div class="dashboard-alerts">
          <article class="dashboard-alert ${unscannedBooks ? 'warning' : 'success'}"><div class="dashboard-alert-icon">${uiIcon(unscannedBooks ? 'warning' : 'check')}</div><div><strong>${unscannedBooks ? `${unscannedBooks} quyển chưa có file` : 'Đã hoàn tất file số hóa'}</strong><p>${unscannedBooks ? 'Cần tiếp tục bổ sung file scan hoặc hình ảnh.' : 'Tất cả quyển hiện có đều đã đính kèm file.'}</p></div></article>
          <article class="dashboard-alert ${deathBooks ? '' : 'success'}"><div class="dashboard-alert-icon">${uiIcon(deathBooks ? 'folder' : 'check')}</div><div><strong>${deathBooks ? `${deathBooks} quyển thuộc hồ sơ tử vong` : 'Chưa có hồ sơ tử vong'}</strong><p>Danh mục tử vong có thể lọc theo năm và nơi tử vong.</p></div></article>
        </div>`;

      const storageSearchInput = $('#storageInventorySearch');
      if (storageSearchInput) {
        storageSearchInput.value = state.storageSearch || '';
        storageSearchInput.addEventListener('input', event => {
          state.storageSearch = event.target.value || '';
          renderStorageInventoryRows();
        });
      }
      renderStorageInventoryRows();
    }

    function documentInventoryStatsPanelHtml(inventoryStats = {}) {
      const inventoriedBooks = Number(inventoryStats.inventoriedBooks) || 0;
      const unInventoriedBooks = Number(inventoryStats.unInventoriedBooks) || 0;
      const totalBooks = inventoriedBooks + unInventoriedBooks;
      const completionRate = totalBooks ? Math.round(inventoriedBooks / totalBooks * 100) : 0;

      return `
        <article class="inventory-stats-panel">
          <div class="inventory-stats-head">
            <div>
              <h3>Thống kê thành phần giấy tờ trong quyển</h3>
              <p>Tổng hợp số tờ, phiếu đã kiểm kê khi bàn giao hồ sơ vào lưu trữ.</p>
            </div>
            <span class="inventory-completion-badge">${inventoriedBooks}/${totalBooks} quyển đã kiểm kê · ${completionRate}%</span>
          </div>
          <div class="inventory-stat-grid">
            ${INVENTORY_FIELDS.map(field => `
              <div class="inventory-stat-card">
                <span>${escapeHtml(field.label)}</span>
                <strong>${Number(inventoryStats[field.key]) || 0}</strong>
              </div>`).join('')}
          </div>
          <p class="inventory-stat-note${unInventoriedBooks ? ' warning' : ''}">
            ${unInventoriedBooks
              ? `⚠ Còn ${unInventoriedBooks} quyển cũ chưa kiểm kê đủ 5 thành phần giấy tờ.`
              : '✓ Tất cả quyển hiện có đã được kiểm kê thành phần giấy tờ.'}
          </p>
        </article>`;
    }

    function storageInventoryPanelHtml(storageStats = {}) {
      const totalBoxes = Number(storageStats.totalBoxes) || 0;
      const structuredBooks = Number(storageStats.structuredBooks) || 0;
      const unstructuredBooks = Number(storageStats.unstructuredBooks) || 0;
      const duplicateCount = Number(storageStats.duplicateLocationCount) || 0;
      return `
        <article class="storage-inventory-panel">
          <div class="storage-inventory-head">
            <div>
              <h3>Thống kê thùng và vị trí lưu trữ</h3>
              <p>Tra cứu quyển hồ sơ theo thùng, vị trí, số hồ sơ hoặc số quyển.</p>
            </div>
            <div class="storage-inventory-summary">
              <span><strong>${totalBoxes}</strong> thùng</span>
              <span><strong>${structuredBooks}</strong> quyển</span>
            </div>
          </div>
          <div class="storage-inventory-toolbar">
            <input id="storageInventorySearch" type="search" placeholder="Tìm thùng, vị trí, số hồ sơ hoặc quyển..." aria-label="Tìm vị trí lưu trữ">
            ${unstructuredBooks ? `<span class="storage-warning">⚠ ${unstructuredBooks} quyển cũ chưa tách thùng/vị trí</span>` : ''}
            ${duplicateCount ? `<span class="storage-danger">⚠ ${duplicateCount} vị trí đang bị trùng</span>` : ''}
          </div>
          <div class="table-wrap storage-table-wrap">
            <table class="storage-table">
              <thead><tr><th>Thùng</th><th>Số quyển</th><th>Vị trí đã dùng</th><th>Chi tiết quyển trong thùng</th></tr></thead>
              <tbody id="storageInventoryBody"></tbody>
            </table>
          </div>
        </article>`;
    }

    function renderStorageInventoryRows() {
      const body = $('#storageInventoryBody');
      if (!body) return;
      const boxes = Array.isArray(state.storageStats?.boxes) ? state.storageStats.boxes : [];
      const keyword = normalizeStorageText(state.storageSearch || '').trim();
      const filteredBoxes = boxes.map(box => {
        const boxMatches = !keyword || normalizeStorageText(`thung ${box.thungSo}`).includes(keyword);
        const records = boxMatches ? box.records : box.records.filter(record =>
          normalizeStorageText(`thung ${box.thungSo} vi tri ${record.viTriSo} ${record.soHoSo} quyen ${record.quyenSo} ${record.trangThai}`).includes(keyword)
        );
        return { ...box, records };
      }).filter(box => box.records.length);

      body.innerHTML = filteredBoxes.length ? filteredBoxes.map(box => {
        const positions = [...new Set(box.records.map(record => Number(record.viTriSo)).filter(Boolean))].sort((a, b) => a - b);
        const details = box.records.map(record => `
          <span class="storage-record-chip${box.duplicatePositions?.includes(record.viTriSo) ? ' duplicate' : ''}">
            HS ${escapeHtml(record.soHoSo || '—')} · Q${escapeHtml(record.quyenSo || '—')} · VT${escapeHtml(record.viTriSo || '—')}
          </span>`).join('');
        return `
          <tr>
            <td><strong>Thùng ${escapeHtml(box.thungSo)}</strong></td>
            <td><span class="storage-count-badge">${box.records.length} quyển</span></td>
            <td>${positions.map(position => `<span class="position-chip">${position}</span>`).join('')}</td>
            <td><div class="storage-record-list">${details}</div></td>
          </tr>`;
      }).join('') : `<tr><td colspan="4">${boxes.length ? 'Không tìm thấy vị trí phù hợp.' : 'Chưa có dữ liệu thùng và vị trí lưu trữ.'}</td></tr>`;
    }

    function dashboardKpiHtml({
      icon,
      label,
      value,
      note,
      color,
      bg,
      soft
    }) {
      return `
        <article
          class="dashboard-kpi"
          style="
            --kpi-color:${color};
            --kpi-bg:${bg};
            --kpi-soft:${soft};
          ">
          <div>
            <span class="dashboard-kpi-label">${escapeHtml(label)}</span>
            <strong class="dashboard-kpi-value">${Number(value) || 0}</strong>
            <p class="dashboard-kpi-note">${escapeHtml(note)}</p>
          </div>
          <div class="dashboard-kpi-icon">${uiIcon(icon, 'dashboard-kpi-svg')}</div>
        </article>
      `;
    }

    function statusBarHtml(label, value, percent, className) {
      return `
        <div class="status-bar-item">
          <div class="status-bar-head">
            <span>${escapeHtml(label)}</span>
            <strong>${Number(value) || 0} quyển · ${Number(percent) || 0}%</strong>
          </div>
          <div class="status-track">
            <div
              class="status-fill ${className}"
              style="width:${Math.max(0, Math.min(100, Number(percent) || 0))}%">
            </div>
          </div>
        </div>
      `;
    }

    function managementMetricHtml(
      icon,
      name,
      value,
      label,
      color,
      background
    ) {
      return `
        <div class="management-metric">
          <div
            class="management-metric-icon"
            style="
              --metric-color:${color};
              --metric-bg:${background};
            ">
            ${uiIcon(icon, 'management-metric-svg')}
          </div>
          <div>
            <div class="management-metric-label">${escapeHtml(label)}</div>
            <div class="management-metric-name">${escapeHtml(name)}</div>
          </div>
          <div
            class="management-metric-value"
            style="--metric-color:${color}">
            ${escapeHtml(value)}
          </div>
        </div>
      `;
    }


    function openPatientDialog(mode = 'add', patient = null) {
      if (!requireEditPermission()) return;
      const form = $('#patientForm');
      form.reset();
      form.elements.mode.value = mode;
      const isEdit = mode === 'edit';
      const isAdmin = state.currentRole === 'admin';

      if (isEdit && state.currentRole === 'editor' && state.currentBooks.length === 0) {
        showToast(
          'Hồ sơ chưa có quyển. Tài khoản nhập liệu phải xóa hồ sơ nhập sai và tạo lại.',
          true
        );
        return;
      }

      $('#patientDialogTitle').textContent = isEdit ? 'Chỉnh sửa thông tin hồ sơ' : 'Thêm hồ sơ';
      $('#patientSubmitBtn').textContent = isEdit ? 'Cập nhật hồ sơ' : 'Lưu hồ sơ';
      form.elements.soHoSo.readOnly = isEdit && !isAdmin;
      form.elements.originalSoHoSo.value =
        isEdit && patient ? formatMedicalRecordNumber(patient['SỐ HỒ SƠ']) : '';

      $('#patientNumberHelp').textContent = isEdit
        ? (isAdmin
            ? 'Quản trị được thay đổi số hồ sơ; hệ thống sẽ chuyển toàn bộ quyển và dữ liệu liên quan sang số mới.'
            : 'Số hồ sơ được khóa. Chỉ tài khoản quản trị được thay đổi số hồ sơ.')
        : 'Số hồ sơ theo định dạng XX.XX.XX.XXXX. Có thể nhập liền, hệ thống tự thêm dấu chấm và chuyển IN HOA.';

      if (isEdit && patient) {
        form.elements.soHoSo.value = formatMedicalRecordNumber(patient['SỐ HỒ SƠ']);
        form.elements.hoTen.value = formatVietnamesePersonName(patient['HỌ VÀ TÊN']);
        form.elements.namSinh.value = patient['NĂM SINH'] || '';
        form.elements.gioiTinh.value = patient['GIỚI TÍNH'] || '';
      }
      $('#patientDialog').showModal();
    }

    function updateBookStatusFields() {
      const form = $('#bookForm');
      const status = form.elements.trangThai.value;
      const isDeath = status === CONFIG.STATUS.TU_VONG;
      const isReturned = status === CONFIG.STATUS.HOI_GIA;
      const isTransferred = status === CONFIG.STATUS.CHUYEN_TRUNG_TAM;
      const isOther = status === CONFIG.STATUS.KHAC;

      $('#deathDateField').classList.toggle('hidden', !isDeath);
      $('#deathPlaceField').classList.toggle('hidden', !isDeath);
      $('#deathCauseField').classList.toggle('hidden', !isDeath);
      $('#returnDateField').classList.toggle('hidden', !isReturned);
      $('#transferDateField').classList.toggle('hidden', !isTransferred);
      $('#otherContentField').classList.toggle('hidden', !isOther);

      form.elements.noiTuVong.required = isDeath;
      form.elements.nguyenNhanTuVong.required = isDeath;
      form.elements.ngayTuVong.required = isDeath;
      form.elements.ngayHoiGia.required = isReturned;
      form.elements.ngayChuyenTrungTam.required = isTransferred;
      form.elements.noiDungKhac.required = isOther;

      if (!isDeath) {
        form.elements.noiTuVong.value = '';
        form.elements.nguyenNhanTuVong.value = '';
        form.elements.ngayTuVong.value = '';
      }

      if (!isReturned) {
        form.elements.ngayHoiGia.value = '';
      }

      if (!isTransferred) {
        form.elements.ngayChuyenTrungTam.value = '';
      }

      if (!isOther) {
        form.elements.noiDungKhac.value = '';
      }
    }


    function updateStorageLocationPreview() {
      const form = $('#bookForm');
      const label = storageLocationLabel(form.elements.thungSo.value, form.elements.viTriSo.value);
      const preview = $('#storageLocationPreview');
      if (!preview) return;
      preview.classList.toggle('ready', Boolean(label));
      preview.querySelector('strong').textContent = label || 'Chưa chọn thùng và vị trí';
    }

    function updateDocumentInventoryPreview() {
      const form = $('#bookForm');
      const preview = $('#inventoryTotalPreview');
      if (!form || !preview) return;

      const values = {};
      INVENTORY_FIELDS.forEach(field => {
        values[field.key] = form.elements[field.key]?.value ?? '';
      });
      const inventory = documentInventoryFromSource(values);
      const strong = preview.querySelector('strong');
      preview.classList.toggle('incomplete', !inventory.complete);
      strong.textContent = inventory.complete ? `${inventory.total} tờ/phiếu` : 'Chưa nhập đủ';
    }

    function openBookDialog(soHoSo) {
      if (!requireEditPermission()) return;
      const form = $('#bookForm');
      form.reset();
      form.elements.mode.value = 'add';
      form.elements.soHoSo.value = soHoSo;
      form.elements.originalQuyenSo.value = '';
      form.elements.existingFileUrl.value = '';
      form.elements.thungSo.value = '';
      form.elements.viTriSo.value = '';
      INVENTORY_FIELDS.forEach(field => {
        form.elements[field.key].value = '';
      });
      const nextBook = state.currentBooks.length ? Math.max(...state.currentBooks.map(book => Number(book['QUYỂN SỐ']) || 0)) + 1 : 1;
      form.elements.quyenSo.value = nextBook;
      form.elements.quyenSo.readOnly = false;
      const today = new Date().toISOString().slice(0, 10);
      form.elements.ngayBatDau.value = today;
      form.elements.ngayKetThuc.value = today;
      form.elements.nguyenNhanTuVong.value = '';
      form.elements.ngayHoiGia.value = '';
      form.elements.ngayTuVong.value = '';
      form.elements.ngayChuyenTrungTam.value = '';
      form.elements.noiDungKhac.value = '';
      $('#bookDialogTitle').textContent = 'Lưu hồ sơ bệnh án';
      $('#bookSubmitBtn').textContent = 'Lưu hồ sơ';
      $('#bookNumberHelp').textContent = 'Hệ thống gợi ý số quyển tiếp theo; có thể điều chỉnh khi nhập hồ sơ lưu trữ cũ.';
      $('#existingFileNotice').classList.add('hidden');
      updateBookStatusFields();
      updateStorageLocationPreview();
      updateDocumentInventoryPreview();
      $('#bookDialog').showModal();
    }

    function openEditBookDialog(quyenSo) {
      if (!requireEditPermission()) return;
      const book = state.currentBooks.find(item => Number(item['QUYỂN SỐ']) === Number(quyenSo));
      if (!book) return showToast('Không tìm thấy quyển hồ sơ.', true);
      const form = $('#bookForm');
      form.reset();
      form.elements.mode.value = 'edit';
      form.elements.soHoSo.value = state.currentPatient['SỐ HỒ SƠ'];
      form.elements.originalQuyenSo.value = book['QUYỂN SỐ'];
      form.elements.quyenSo.value = book['QUYỂN SỐ'];
      form.elements.quyenSo.readOnly = true;
      form.elements.ngayBatDau.value = book['NGÀY BẮT ĐẦU'] || '';
      form.elements.ngayKetThuc.value = book['NGÀY KẾT THÚC'] || new Date().toISOString().slice(0, 10);
      const mappedStatus = normalizeRecordStatus(book['TRẠNG THÁI HIỆN TẠI']);
      form.elements.trangThai.value = mappedStatus || CONFIG.STATUS.HET_QUYEN;
      form.elements.noiTuVong.value = book['NƠI TỬ VONG'] || '';
      form.elements.nguyenNhanTuVong.value = book['NGUYÊN NHÂN TỬ VONG'] || '';
      form.elements.ngayHoiGia.value = book['NGÀY HỒI GIA'] || '';
      form.elements.ngayTuVong.value = book['NGÀY TỬ VONG'] || '';
      form.elements.ngayChuyenTrungTam.value = book['NGÀY CHUYỂN TRUNG TÂM'] || '';
      form.elements.noiDungKhac.value = book['NỘI DUNG KHÁC'] || '';
      const storage = parseStorageLocation(book);
      form.elements.thungSo.value = storage.thungSo || '';
      form.elements.viTriSo.value = storage.viTriSo || '';
      INVENTORY_FIELDS.forEach(field => {
        const value = book[field.uiKey];
        form.elements[field.key].value = value === '' || value === null || value === undefined ? '' : value;
      });
      form.elements.ghiChu.value = book['GHI CHÚ'] || '';
      form.elements.existingFileUrl.value = book['FILE ĐÍNH KÈM'] || '';
      $('#bookDialogTitle').textContent = `Chỉnh sửa quyển ${book['QUYỂN SỐ']}`;
      $('#bookSubmitBtn').textContent = 'Cập nhật hồ sơ';
      $('#bookNumberHelp').textContent = 'Số quyển được khóa khi chỉnh sửa để tránh trùng dữ liệu.';
      const notice = $('#existingFileNotice');
      if (book['FILE ĐÍNH KÈM']) {
        notice.innerHTML = `Đang có file: <a href="${escapeAttr(book['FILE ĐÍNH KÈM'])}" target="_blank" rel="noopener">Mở file hiện tại</a>. Chọn file mới nếu cần thay thế liên kết.`;
        notice.classList.remove('hidden');
      } else {
        notice.classList.add('hidden');
      }
      updateBookStatusFields();
      updateStorageLocationPreview();
      updateDocumentInventoryPreview();
      $('#bookDialog').showModal();
    }

    function openDeletePatientDialog(patient) {
      if (!canDeleteRecords()) {
        showToast('Tài khoản hiện tại không có quyền xóa hồ sơ.', true);
        return;
      }

      if (state.currentRole === 'editor' && state.currentBooks.length > 0) {
        showToast(
          'Tài khoản nhập liệu không được xóa hồ sơ đã có quyển. Hãy chỉnh sửa thông tin hồ sơ.',
          true
        );
        return;
      }

      const warning = $('#deletePatientWarning');
      if (warning) {
        warning.innerHTML = state.currentRole === 'admin'
          ? '<strong>Lưu ý:</strong> Quản trị được xóa toàn bộ hồ sơ, kể cả hồ sơ đã có quyển. Dữ liệu liên quan sẽ được xử lý theo quy trình xóa của hệ thống.'
          : '<strong>Lưu ý:</strong> Tài khoản nhập liệu chỉ được xóa hồ sơ chưa có quyển. Hồ sơ đã có quyển chỉ được chỉnh sửa để bảo đảm an toàn dữ liệu.';
      }

      const form = $('#deletePatientForm');
      form.reset();
      form.elements.soHoSo.value = patient['SỐ HỒ SƠ'];
      $('#deletePatientNumber').textContent = patient['SỐ HỒ SƠ'] || '—';
      $('#deletePatientName').textContent = patient['HỌ VÀ TÊN'] || '—';
      $('#deletePatientDialog').showModal();
      setTimeout(() => $('#deleteReasonInput')?.focus(), 80);
    }

    async function submitPatient(event) {
      event.preventDefault();
      if (!requireEditPermission()) return;
      const form = event.currentTarget;
      const submitButton = $('#patientSubmitBtn');
      const originalText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Đang lưu...';
      const data = Object.fromEntries(new FormData(form).entries());
      data.soHoSo = formatMedicalRecordNumber(data.soHoSo);
      data.hoTen = formatVietnamesePersonName(data.hoTen);
      data.originalSoHoSo = formatMedicalRecordNumber(
        data.originalSoHoSo || data.soHoSo
      );
      form.elements.soHoSo.value = data.soHoSo;
      form.elements.hoTen.value = data.hoTen;

      try {
        await withLoading(async () => {
          const action = data.mode === 'edit' ? 'capNhatDoiTuong' : 'themDoiTuong';
          const result = await api.post(action, data);
          const oldNumber = normalize(result.oldSoHoSo || data.originalSoHoSo);
          const newNumber = normalize(result.data['SỐ HỒ SƠ']);

          state.allPatients = state.allPatients.filter(item => {
            const itemNumber = normalize(item['SỐ HỒ SƠ']);
            return itemNumber !== oldNumber && itemNumber !== newNumber;
          });
          state.allPatients.unshift(result.data);

          if (
            state.currentPatient &&
            normalize(state.currentPatient['SỐ HỒ SƠ']) === oldNumber
          ) {
            state.currentPatient = result.data;
          }
          searchPatients();
          if (data.mode === 'edit') renderDetail();
          form.reset();
          $('#patientDialog').close();
          showToast(result.message);
          refreshPatientSummariesSilently();
        });
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }

    async function submitDeletePatient(event) {
      event.preventDefault();

      if (!canDeleteRecords()) {
        showToast('Tài khoản hiện tại không có quyền xóa hồ sơ.', true);
        return;
      }

      const form = event.currentTarget;
      const submitButton = $('#deletePatientSubmitBtn');
      const originalText = submitButton.textContent;
      const data = Object.fromEntries(new FormData(form).entries());

      submitButton.disabled = true;
      submitButton.textContent = 'Đang xóa...';

      try {
        await withLoading(async () => {
          const result = await api.post('xoaDoiTuong', data);
          const targetNumber = normalize(data.soHoSo);

          state.allPatients = state.allPatients.filter(
            item => normalize(item['SỐ HỒ SƠ']) !== targetNumber
          );
          state.patients = state.patients.filter(
            item => normalize(item['SỐ HỒ SƠ']) !== targetNumber
          );
          state.currentPatient = null;
          state.currentBooks = [];
          state.deathsLoaded = false;

          form.reset();
          $('#deletePatientDialog').close();
          searchPatients();
          renderStats();
          switchView('patients');
          showToast(result.message);
          await refreshPatientSummariesSilently();
        });
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }

    async function submitBook(event) {
      event.preventDefault();
      if (!requireEditPermission()) return;
      const form = event.currentTarget;
      const submitButton = $('#bookSubmitBtn');
      const originalText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Đang lưu...';
      const formData = new FormData(form);
      const file = formData.get('file');
      const data = Object.fromEntries(formData.entries());
      delete data.file;

      try {
        await withLoading(async () => {
          const result = await api.saveBookWithFile({ ...data, quyenSo: Number(data.quyenSo), originalQuyenSo: Number(data.originalQuyenSo || data.quyenSo) }, file && file.size ? file : null);
          const index = state.currentBooks.findIndex(book => Number(book['QUYỂN SỐ']) === Number(data.originalQuyenSo || data.quyenSo));
          if (index >= 0) state.currentBooks[index] = result.data;
          else state.currentBooks.push(result.data);
          state.currentBooks.sort((a,b) => Number(a['QUYỂN SỐ']) - Number(b['QUYỂN SỐ']));
          form.reset();
          $('#bookDialog').close();
          showToast(result.message);
          await refreshPatientSummariesSilently();
          const refreshed = state.allPatients.find(item => normalize(item['SỐ HỒ SƠ']) === normalize(data.soHoSo));
          if (refreshed) state.currentPatient = refreshed;
          renderDetail();
          state.deathsLoaded = false;
          state.storageStatsLoaded = false;
        });
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }

    async function refreshPatientSummariesSilently() {
      try {
        const [page, totalCount] = await Promise.all([
          readPatientPage(),
          readPatientTotalCount()
        ]);

        const patients = page.entries.map(({ id, patient }) =>
          patientToUi(id, patient)
        );

        state.patientPaging.browsePatients = [...patients];
        state.patientPaging.cursor = page.cursor;
        state.patientPaging.hasMore = page.hasMore;
        state.patientPaging.totalCount = totalCount;
        state.patientPaging.searchActive = false;
        state.patientPaging.lastSearchKeyword = '';
        state.allPatients = [...patients];

        const pageStats = calculateStats(
          page.entries.map(item => item.patient)
        );
        if (totalCount !== null) {
          pageStats.tongDoiTuong = totalCount;
        }
        state.stats = pageStats;

        // Sau khi ghi dữ liệu, trở về danh sách mới nhất; nếu ô tìm kiếm còn
        // từ khóa thì chạy lại query để kết quả phản ánh dữ liệu vừa cập nhật.
        if (String($('#searchInput')?.value || '').trim()) {
          state.patientPaging.lastSearchKeyword = '';
          await searchPatients();
        } else {
          applyPatientFilters();
        }
        renderStats();
      } catch (error) {
        console.warn(error);
      }
    }

    async function refreshDeathsSilently() {
      try {
        const result = await api.get('layHoSoTuVong');
        state.deaths = result.data || [];
        state.deathsLoaded = true;
        renderDeaths();
      } catch (error) {
        console.warn(error);
      }
    }

    async function refreshStatsSilently() {
      try {
        const result = await api.get('layThongKe');
        state.stats = result.data || {};
        renderStats();
      } catch (error) {
        console.warn(error);
      }
    }


    async function refreshStorageStatsSilently() {
      try {
        const result = await api.get('layThongKeLuuTru');
        state.storageStats = result.data || { totalBooks: 0, structuredBooks: 0, unstructuredBooks: 0, totalBoxes: 0, duplicateLocationCount: 0, boxes: [] };
        state.storageStatsLoaded = true;

        const totalPatients = Number.isFinite(state.patientPaging.totalCount)
          ? state.patientPaging.totalCount
          : Number(state.stats?.tongDoiTuong) || 0;
        const totalBooks = Number(state.storageStats.totalBooks) || 0;
        const scannedBooks = Number(state.storageStats.scannedBooks) || 0;
        state.stats = {
          ...state.stats,
          tongDoiTuong: totalPatients,
          tongQuyenHoSo: totalBooks,
          hoSoHetQuyen: Number(state.storageStats.finishedBooks) || 0,
          hoSoHoiGia: Number(state.storageStats.returnedBooks) || 0,
          hoSoTuVong: Number(state.storageStats.deathBooks) || 0,
          hoSoCoFile: scannedBooks,
          hoSoChuaFile: Math.max(0, totalBooks - scannedBooks)
        };

        renderStats();
      } catch (error) {
        console.warn(error);
      }
    }

    function accountRoleOptions(selectedRole = 'editor') {
      const roles = [
        ['editor', 'Nhập liệu'],
        ['viewer', 'Chỉ xem'],
        ['admin', 'Quản trị']
      ];

      return roles.map(([value, label]) =>
        `<option value="${value}" ${value === selectedRole ? 'selected' : ''}>${label}</option>`
      ).join('');
    }

    function accountTimeLabel(value) {
      const timestamp = Number(value) || 0;
      if (!timestamp) return '—';
      try {
        return new Intl.DateTimeFormat('vi-VN', {
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(new Date(timestamp));
      } catch (_) {
        return new Date(timestamp).toLocaleString('vi-VN');
      }
    }

    async function refreshAccountAdministration(force = false) {
      if (state.currentRole !== 'admin') return;
      if (state.accountAdmin.loaded && !force) {
        renderAccountAdministration();
        return;
      }

      const readRoots = () => Promise.allSettled([
        get(ref(firebaseDatabase, CONFIG.ACCESS_REQUEST_PATH)),
        get(ref(firebaseDatabase, 'phanQuyen'))
      ]);

      let results = await readRoots();

      // Một số phiên đăng nhập lâu ngày có thể giữ token cũ. Làm mới token
      // đúng một lần trước khi kết luận cấu hình quyền truy cập bị lệch.
      if (results.some(item => item.status === 'rejected') && firebaseAuth.currentUser) {
        await firebaseAuth.currentUser.getIdToken(true).catch(() => {});
        results = await readRoots();
      }

      const [requestResult, permissionResult] = results;
      state.accountAdmin.errors = { requests: '', permissions: '' };

      if (requestResult.status === 'fulfilled') {
        const requestRoot = requestResult.value.val() || {};
        state.accountAdmin.requests = Object.entries(requestRoot)
          .map(([uid, value]) => ({ uid, ...(value || {}) }))
          .sort((a, b) => {
            const ap = a.status === 'pending' ? 0 : 1;
            const bp = b.status === 'pending' ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return (Number(b.requestedAt) || 0) - (Number(a.requestedAt) || 0);
          });
      } else {
        state.accountAdmin.requests = [];
        state.accountAdmin.errors.requests = 'Không tải được danh sách yêu cầu cấp quyền.';
        console.warn('Không tải được yêu cầu cấp quyền HSBA:', requestResult.reason);
      }

      if (permissionResult.status === 'fulfilled') {
        const permissionRoot = permissionResult.value.val() || {};
        state.accountAdmin.permissions = Object.entries(permissionRoot)
          .map(([uid, value]) => ({ uid, ...(value || {}) }))
          .sort((a, b) => {
            if ((a.active === true) !== (b.active === true)) return a.active === true ? -1 : 1;
            return String(a.email || '').localeCompare(String(b.email || ''), 'vi');
          });
      } else {
        state.accountAdmin.permissions = [];
        state.accountAdmin.errors.permissions = 'Không tải được danh sách tài khoản đã phân quyền.';
        console.warn('Không tải được phân quyền HSBA:', permissionResult.reason);
      }

      state.accountAdmin.loaded = true;
      renderAccountAdministration();
    }

    function renderAccountAdministration() {
      if (state.currentRole !== 'admin') return;

      const pending = state.accountAdmin.requests.filter(item => item.status === 'pending');
      const unapproved = state.accountAdmin.requests.filter(item => item.status !== 'approved');
      const requestError = String(state.accountAdmin.errors?.requests || '');
      const permissionError = String(state.accountAdmin.errors?.permissions || '');

      $('#pendingAccountCount').textContent = requestError ? '—' : String(unapproved.length);
      $('#activeAccountCount').textContent = permissionError ? '—' : String(state.accountAdmin.permissions.length);
      $('#pendingAccountBadge').textContent = String(pending.length);
      $('#pendingAccountBadge').classList.toggle('hidden', Boolean(requestError) || pending.length === 0);

      $('#accountRequestsList').innerHTML = requestError
        ? `<div class="account-admin-read-error">
             <span class="account-admin-read-error-icon">!</span>
             <div><strong>Chưa thể tải yêu cầu cấp quyền</strong><p>Quyền truy cập dữ liệu quản trị chưa được đồng bộ. Vui lòng cập nhật cấu hình quyền truy cập rồi bấm “Làm mới”.</p></div>
           </div>`
        : unapproved.length
        ? unapproved.map(request => {
            const isPending = request.status === 'pending';
            const statusText = isPending ? 'Đang chờ duyệt' : 'Đã từ chối';
            return `
            <article class="account-admin-card" data-request-uid="${escapeAttr(request.uid)}">
              <div class="account-admin-main">
                <div class="account-avatar">${escapeHtml((request.displayName || request.email || '?').trim().charAt(0).toUpperCase() || '?')}</div>
                <div class="account-admin-info">
                  <strong>${escapeHtml(request.displayName || 'Chưa có tên hiển thị')}</strong>
                  <span>${escapeHtml(request.email || '')}</span>
                  <small>${escapeHtml(statusText)} · Gửi yêu cầu: ${escapeHtml(accountTimeLabel(request.requestedAt))}</small>
                </div>
              </div>
              <div class="account-admin-actions">
                <select class="account-role-select" aria-label="Vai trò cấp cho tài khoản">
                  ${accountRoleOptions('editor')}
                </select>
                <button class="btn primary small" type="button" data-account-action="approve">${isPending ? 'Duyệt' : 'Duyệt lại'}</button>
                ${isPending ? '<button class="btn small" type="button" data-account-action="reject">Từ chối</button>' : ''}
                <button class="btn small danger-outline" type="button" data-account-action="delete-request" title="Xóa yêu cầu cấp quyền">Xóa yêu cầu</button>
              </div>
            </article>`;
          }).join('')
        : '<div class="account-admin-empty">Không có tài khoản nào đang chờ duyệt hoặc đã bị từ chối.</div>';

      $('#accountPermissionsList').innerHTML = permissionError
        ? `<div class="account-admin-read-error">
             <span class="account-admin-read-error-icon">!</span>
             <div><strong>Chưa thể tải danh sách tài khoản</strong><p>Quyền truy cập dữ liệu quản trị chưa được đồng bộ. Vui lòng cập nhật cấu hình quyền truy cập rồi bấm “Làm mới”.</p></div>
           </div>`
        : state.accountAdmin.permissions.length
        ? state.accountAdmin.permissions.map(account => {
            const isCurrentAccount = account.uid === firebaseAuth.currentUser?.uid;
            const accountNote = isCurrentAccount ? ' · Tài khoản đang đăng nhập' : '';
            return `
              <article class="account-admin-card" data-permission-uid="${escapeAttr(account.uid)}">
                <div class="account-admin-main">
                  <div class="account-avatar">${escapeHtml((account.displayName || account.email || '?').trim().charAt(0).toUpperCase() || '?')}</div>
                  <div class="account-admin-info">
                    <strong>${escapeHtml(account.displayName || account.email || 'Tài khoản')}</strong>
                    <span>${escapeHtml(account.email || '')}</span>
                    <small>${account.active === true ? 'Đang hoạt động' : 'Đã khóa'} · ${escapeHtml(roleLabel(account.role))}${escapeHtml(accountNote)}</small>
                  </div>
                </div>
                <div class="account-admin-actions">
                  <input
                    class="account-display-name-input"
                    type="text"
                    maxlength="150"
                    autocomplete="off"
                    aria-label="Tên hiển thị tài khoản ${escapeAttr(account.email || '')}"
                    placeholder="Tên hiển thị"
                    value="${escapeAttr(account.displayName || '')}"
                  >
                  <select class="account-role-select" aria-label="Vai trò tài khoản ${escapeAttr(account.email || '')}">
                    ${accountRoleOptions(String(account.role || 'editor'))}
                  </select>
                  <button class="btn small" type="button" data-account-action="save-role">Lưu quyền</button>
                  <button class="btn small ${account.active === true ? 'danger-outline' : 'primary'}" type="button" data-account-action="toggle-active">
                    ${account.active === true ? 'Khóa' : 'Mở khóa'}
                  </button>
                  <button class="btn small danger-outline" type="button" data-account-action="delete-account" title="Xóa tài khoản khỏi ứng dụng">Xóa tài khoản</button>
                </div>
              </article>`;
          }).join('')
        : '<div class="account-admin-empty">Chưa có tài khoản HSBA nào được phân quyền.</div>';
    }

    async function approveHsbaAccess(uid, role) {
      if (state.currentRole !== 'admin') throw new Error('Chỉ quản trị viên mới được duyệt tài khoản.');
      if (!['admin', 'editor', 'viewer'].includes(role)) throw new Error('Vai trò không hợp lệ.');

      const request = state.accountAdmin.requests.find(item => item.uid === uid);
      if (!request || !['pending', 'rejected'].includes(String(request.status || ''))) {
        throw new Error('Yêu cầu không còn ở trạng thái có thể duyệt.');
      }

      const existing = state.accountAdmin.permissions.find(item => item.uid === uid) || {};
      const now = Date.now();
      const reviewer = firebaseAuth.currentUser;
      const permission = {
        ...existing,
        email: String(request.email || '').trim().toLowerCase(),
        displayName: String(request.displayName || existing.displayName || '').trim(),
        role,
        active: true,
        createdAt: Number(existing.createdAt) || now,
        updatedAt: now,
        approvedByUid: reviewer?.uid || '',
        approvedByEmail: reviewer?.email || ''
      };

      const reviewedRequest = {
        ...request,
        status: 'approved',
        reviewedAt: now,
        reviewedByUid: reviewer?.uid || '',
        reviewedByEmail: reviewer?.email || ''
      };
      delete reviewedRequest.uid;

      await update(ref(firebaseDatabase), {
        [`phanQuyen/${uid}`]: permission,
        [`${CONFIG.ACCESS_REQUEST_PATH}/${uid}`]: reviewedRequest
      });

      state.accountAdmin.loaded = false;
      await refreshAccountAdministration(true);
      showToast(`Đã duyệt ${request.email || 'tài khoản'} với quyền ${roleLabel(role)}.`);
    }

    async function rejectHsbaAccess(uid) {
      if (state.currentRole !== 'admin') throw new Error('Chỉ quản trị viên mới được từ chối tài khoản.');
      const request = state.accountAdmin.requests.find(item => item.uid === uid);
      if (!request || request.status !== 'pending') throw new Error('Yêu cầu không còn ở trạng thái chờ duyệt.');

      const now = Date.now();
      const reviewer = firebaseAuth.currentUser;
      const next = {
        ...request,
        status: 'rejected',
        reviewedAt: now,
        reviewedByUid: reviewer?.uid || '',
        reviewedByEmail: reviewer?.email || ''
      };
      delete next.uid;

      await set(ref(firebaseDatabase, `${CONFIG.ACCESS_REQUEST_PATH}/${uid}`), next);
      state.accountAdmin.loaded = false;
      await refreshAccountAdministration(true);
      showToast(`Đã từ chối yêu cầu của ${request.email || 'tài khoản'}.`);
    }

    const confirmActionState = {
      resolver: null,
      resolve(value) {
        if (typeof this.resolver === 'function') {
          const fn = this.resolver;
          this.resolver = null;
          fn(Boolean(value));
        }
      }
    };

    function closeConfirmActionDialog(result) {
      const dialog = $('#confirmActionDialog');
      if (dialog?.open) dialog.close();
      confirmActionState.resolve(result);
    }

    function showConfirmActionDialog(options = {}) {
      const dialog = $('#confirmActionDialog');
      if (!dialog) return Promise.resolve(true);

      const {
        chip = 'Xác nhận thao tác',
        title = 'Xác nhận thao tác',
        subtitle = 'Vui lòng kiểm tra thông tin trước khi tiếp tục.',
        message = '',
        detailLines = [],
        confirmText = 'Xác nhận',
        cancelText = 'Quay lại',
        tone = 'danger',
        icon = '!'
      } = options;

      $('#confirmActionChip').textContent = chip;
      $('#confirmActionTitle').textContent = title;
      $('#confirmActionSubtitle').textContent = subtitle;
      $('#confirmActionMessage').textContent = message;
      $('#confirmActionCancelBtn').textContent = cancelText;
      $('#confirmActionSubmitBtn').textContent = confirmText;
      $('#confirmActionIcon').textContent = icon;

      const detailEl = $('#confirmActionDetail');
      const lines = Array.isArray(detailLines)
        ? detailLines.filter(Boolean)
        : (String(detailLines || '').trim() ? [String(detailLines || '').trim()] : []);
      detailEl.innerHTML = lines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
      detailEl.classList.toggle('hidden', lines.length === 0);

      const submitBtn = $('#confirmActionSubmitBtn');
      submitBtn.classList.remove('confirm-danger-btn', 'confirm-primary-btn');
      submitBtn.classList.add(tone === 'primary' ? 'confirm-primary-btn' : 'confirm-danger-btn');

      // Nếu một xác nhận cũ còn treo, đóng an toàn trước khi mở xác nhận mới.
      if (typeof confirmActionState.resolver === 'function') {
        confirmActionState.resolve(false);
      }

      return new Promise(resolve => {
        confirmActionState.resolver = resolve;
        if (dialog.open) dialog.close();
        dialog.showModal();
      });
    }

    async function updateHsbaPermission(uid, patch) {
      if (state.currentRole !== 'admin') throw new Error('Chỉ quản trị viên mới được thay đổi quyền.');
      const account = state.accountAdmin.permissions.find(item => item.uid === uid);
      if (!account) throw new Error('Không tìm thấy tài khoản cần cập nhật.');

      const nextRole = String(patch.role || account.role || '').trim().toLowerCase();
      if (!['admin', 'editor', 'viewer'].includes(nextRole)) throw new Error('Vai trò không hợp lệ.');

      const hasDisplayNamePatch = Object.prototype.hasOwnProperty.call(patch, 'displayName');
      const nextDisplayName = hasDisplayNamePatch
        ? formatVietnamesePersonName(patch.displayName)
        : String(account.displayName || '').trim();
      if (nextDisplayName.length > 150) throw new Error('Tên hiển thị không được vượt quá 150 ký tự.');

      const nextActive = patch.active === undefined
        ? account.active === true
        : patch.active === true;
      const isCurrentAccount = uid === firebaseAuth.currentUser?.uid;

      if (isCurrentAccount && (nextRole !== 'admin' || nextActive !== true)) {
        const confirmed = await showConfirmActionDialog({
          chip: 'Thay đổi quyền sử dụng',
          title: 'Bạn đang thay đổi quyền của chính mình',
          subtitle: 'Thay đổi sẽ được áp dụng ngay sau khi lưu.',
          message: 'Nếu tiếp tục, quyền sử dụng hiện tại của tài khoản đang đăng nhập sẽ được cập nhật theo lựa chọn mới.',
          detailLines: [
            'Bạn có thể không còn quyền quản trị sau khi lưu thay đổi.',
            'Hệ thống sẽ tự tải lại để áp dụng quyền mới.'
          ],
          confirmText: 'Lưu thay đổi',
          cancelText: 'Quay lại',
          tone: 'primary',
          icon: '✓'
        });
        if (!confirmed) return false;
      }

      await update(ref(firebaseDatabase, `phanQuyen/${uid}`), {
        displayName: nextDisplayName,
        role: nextRole,
        active: nextActive,
        updatedAt: Date.now(),
        approvedByUid: firebaseAuth.currentUser?.uid || '',
        approvedByEmail: firebaseAuth.currentUser?.email || ''
      });

      if (isCurrentAccount) {
        showToast('Đã cập nhật thông tin tài khoản đang đăng nhập. Hệ thống sẽ tải lại để áp dụng thay đổi.');
        setTimeout(() => window.location.reload(), 500);
        return true;
      }

      state.accountAdmin.loaded = false;
      await refreshAccountAdministration(true);
      showToast('Đã cập nhật thông tin tài khoản.');
      return true;
    }

    async function deleteHsbaAccessRequest(uid) {
      if (state.currentRole !== 'admin') throw new Error('Chỉ quản trị viên mới được xóa yêu cầu tài khoản.');
      const request = state.accountAdmin.requests.find(item => item.uid === uid);
      if (!request) throw new Error('Không tìm thấy yêu cầu cần xóa.');

      const confirmed = await showConfirmActionDialog({
        chip: 'Quản trị tài khoản',
        title: 'Xóa yêu cầu cấp quyền?',
        subtitle: 'Yêu cầu sẽ được gỡ khỏi danh sách chờ xử lý.',
        message: `Bạn có chắc muốn xóa yêu cầu cấp quyền của ${request.email || 'tài khoản này'}?`,
        detailLines: [
          'Yêu cầu hiện tại sẽ được xóa khỏi danh sách quản trị.',
          'Nếu cần sử dụng lại, người dùng có thể đăng nhập để gửi yêu cầu cấp quyền mới.'
        ],
        confirmText: 'Xóa yêu cầu',
        cancelText: 'Quay lại',
        tone: 'danger',
        icon: '×'
      });
      if (!confirmed) return false;

      await remove(ref(firebaseDatabase, `${CONFIG.ACCESS_REQUEST_PATH}/${uid}`));
      state.accountAdmin.loaded = false;
      await refreshAccountAdministration(true);
      showToast(`Đã xóa yêu cầu của ${request.email || 'tài khoản'}.`);
      return true;
    }

    async function deleteHsbaAccount(uid) {
      if (state.currentRole !== 'admin') throw new Error('Chỉ quản trị viên mới được xóa tài khoản HSBA.');
      const account = state.accountAdmin.permissions.find(item => item.uid === uid);
      if (!account) throw new Error('Không tìm thấy tài khoản cần xóa.');

      const isCurrentAccount = uid === firebaseAuth.currentUser?.uid;
      const detailLines = [
        'Tài khoản sẽ không còn quyền sử dụng ứng dụng Hồ sơ bệnh án lưu trữ.',
        'Các hồ sơ và dữ liệu đã nhập trước đây vẫn được giữ nguyên.',
        'Nếu cần sử dụng lại, người dùng phải đăng nhập và gửi yêu cầu cấp quyền mới.'
      ];
      if (isCurrentAccount) {
        detailLines.unshift('Đây là tài khoản bạn đang sử dụng. Quyền quản trị sẽ kết thúc ngay sau khi xác nhận.');
      }

      const confirmed = await showConfirmActionDialog({
        chip: 'Quản trị tài khoản',
        title: 'Xóa tài khoản khỏi hệ thống?',
        subtitle: 'Thao tác chỉ loại bỏ quyền sử dụng trong Hồ sơ bệnh án lưu trữ.',
        message: `Bạn có chắc muốn xóa tài khoản ${account.email || 'này'} khỏi hệ thống?`,
        detailLines,
        confirmText: 'Xóa tài khoản',
        cancelText: 'Quay lại',
        tone: 'danger',
        icon: '×'
      });
      if (!confirmed) return false;

      await update(ref(firebaseDatabase), {
        [`phanQuyen/${uid}`]: null,
        [`${CONFIG.ACCESS_REQUEST_PATH}/${uid}`]: null
      });

      if (isCurrentAccount) {
        showToast('Đã xóa quyền HSBA của tài khoản đang đăng nhập. Hệ thống sẽ tải lại.');
        setTimeout(() => window.location.reload(), 500);
        return true;
      }

      state.accountAdmin.loaded = false;
      await refreshAccountAdministration(true);
      showToast(`Đã xóa tài khoản HSBA của ${account.email || 'người dùng'}.`);
      return true;
    }

    async function handleAccountRequestAction(event) {
      const button = event.target.closest('[data-account-action]');
      if (!button) return;
      const card = button.closest('[data-request-uid]');
      const uid = card?.dataset.requestUid || '';
      if (!uid) return;

      button.disabled = true;
      try {
        await withLoading(async () => {
          if (button.dataset.accountAction === 'approve') {
            const role = card.querySelector('.account-role-select')?.value || 'editor';
            await approveHsbaAccess(uid, role);
          } else if (button.dataset.accountAction === 'reject') {
            await rejectHsbaAccess(uid);
          } else if (button.dataset.accountAction === 'delete-request') {
            await deleteHsbaAccessRequest(uid);
          }
        });
      } catch (error) {
        showToast(firebaseError(error).message, true);
      } finally {
        button.disabled = false;
      }
    }

    async function handleAccountPermissionAction(event) {
      const button = event.target.closest('[data-account-action]');
      if (!button) return;
      const card = button.closest('[data-permission-uid]');
      const uid = card?.dataset.permissionUid || '';
      if (!uid) return;

      const account = state.accountAdmin.permissions.find(item => item.uid === uid);
      if (!account) return;

      button.disabled = true;
      try {
        await withLoading(async () => {
          const role = card.querySelector('.account-role-select')?.value || account.role || 'editor';
          const displayName = card.querySelector('.account-display-name-input')?.value ?? account.displayName ?? '';
          if (button.dataset.accountAction === 'save-role') {
            await updateHsbaPermission(uid, { role, displayName });
          } else if (button.dataset.accountAction === 'toggle-active') {
            await updateHsbaPermission(uid, { role, active: account.active !== true });
          } else if (button.dataset.accountAction === 'delete-account') {
            await deleteHsbaAccount(uid);
          }
        });
      } catch (error) {
        showToast(firebaseError(error).message, true);
      } finally {
        button.disabled = false;
      }
    }

    async function switchView(name) {
      if (name === 'accounts' && state.currentRole !== 'admin') {
        showToast('Chỉ quản trị viên HSBA mới được mở quản trị tài khoản.', true);
        name = 'patients';
      }

      $$('.view').forEach(view => view.classList.remove('active'));
      $$('.nav-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.view === name);
      });

      const map = {
        patients: '#patientsView',
        detail: '#detailView',
        deaths: '#deathsView',
        dashboard: '#dashboardView',
        accounts: '#accountsView'
      };

      $(map[name] || '#patientsView').classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (name === 'deaths' && !state.deathsLoaded) {
        await withLoading(refreshDeathsSilently);
      }

      if (name === 'dashboard' && !state.storageStatsLoaded) {
        await withLoading(refreshStorageStatsSilently);
      }

      if (name === 'accounts') {
        await withLoading(() => refreshAccountAdministration(false));
      }
    }

    function openSidebar() {
      $('#sidebar').classList.add('open');
      $('#overlay').classList.add('show');
    }

    function closeSidebar() {
      $('#sidebar').classList.remove('open');
      $('#overlay').classList.remove('show');
    }



    const reportPreviewCache = {
      signature: '',
      patients: [],
      reportRows: [],
      generatedAt: null
    };

    async function currentReportPatients() {
      // Khi đang tìm kiếm, báo cáo theo đúng tập kết quả query hiện tại.
      if (state.patientPaging.searchActive) {
        return [...state.patients];
      }

      // Báo cáo là thao tác chủ động của người dùng nên được phép đọc toàn bộ
      // doiTuong tại thời điểm này để giữ nguyên nghiệp vụ "báo cáo đầy đủ".
      // Luồng đăng nhập/danh sách thường ngày vẫn chỉ đọc theo trang.
      const entries = await readPatientSummaries();
      const all = entries.map(({ id, patient }) =>
        patientToUi(id, patient)
      );
      const statusFilter = state.activeStatusFilter || 'all';

      return statusFilter === 'all'
        ? all
        : all.filter(patient =>
            getPatientStatusGroup(patient) === statusFilter
          );
    }

    function reportDataSignature(patients) {
      return JSON.stringify(
        patients.map(patient => [
          patient['_FIREBASE_ID'] || '',
          patient['SỐ HỒ SƠ'] || '',
          Number(patient['_UPDATED_AT']) || 0,
          Number(patient['TỔNG SỐ QUYỂN']) || 0,
          patient['TRẠNG THÁI MỚI NHẤT'] || ''
        ])
      );
    }

    async function prepareReportData(forceRefresh = false) {
      const patients = await currentReportPatients();

      if (!patients.length) {
        throw new Error('Không có dữ liệu phù hợp để xem báo cáo.');
      }

      const signature = reportDataSignature(patients);

      if (
        !forceRefresh &&
        reportPreviewCache.signature === signature &&
        reportPreviewCache.reportRows.length
      ) {
        return reportPreviewCache;
      }

      const reportRows = await collectExcelReportRows(patients);

      reportPreviewCache.signature = signature;
      reportPreviewCache.patients = patients;
      reportPreviewCache.reportRows = reportRows;
      reportPreviewCache.generatedAt = new Date();

      return reportPreviewCache;
    }

    function reportScopeLabel() {
      const labels = {
        all: 'Tất cả hồ sơ',
        finished: 'Hồ sơ hết quyển',
        returned: 'Đối tượng hồi gia',
        death: 'Đối tượng tử vong',
        empty: 'Hồ sơ chưa lưu quyển'
      };

      return labels[state.activeStatusFilter || 'all'] || 'Tất cả hồ sơ';
    }

    function reportStatusClass(status) {
      if (status === CONFIG.STATUS.TU_VONG) return 'status-death';
      if (status === CONFIG.STATUS.HOI_GIA) return 'status-returned';
      return 'status-finished';
    }

    function renderReportPreview(prepared) {
      const patients = prepared.patients;
      const reportRows = prepared.reportRows;
      const bookRows = reportRows.filter(item => item.book);
      const deathCount = bookRows.filter(item =>
        normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
        CONFIG.STATUS.TU_VONG
      ).length;
      const returnedCount = bookRows.filter(item =>
        normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
        CONFIG.STATUS.HOI_GIA
      ).length;
      const finishedCount = bookRows.filter(item =>
        normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
        CONFIG.STATUS.HET_QUYEN
      ).length;
      const transferredCount = bookRows.filter(item =>
        normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
        CONFIG.STATUS.CHUYEN_TRUNG_TAM
      ).length;
      const otherCount = bookRows.filter(item =>
        normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
        CONFIG.STATUS.KHAC
      ).length;

      $('#reportPreviewSummary').innerHTML = `
        <div class="report-preview-statline" role="status">
          <span><strong>${patients.length}</strong> hồ sơ</span>
          <span><strong>${bookRows.length}</strong> dòng quyển</span>
          <span>Hết quyển <strong>${finishedCount}</strong></span>
          <span>Hồi gia <strong>${returnedCount}</strong></span>
          <span>Tử vong <strong>${deathCount}</strong></span>
          <span>Chuyển trung tâm <strong>${transferredCount}</strong></span>
          <span>Khác <strong>${otherCount}</strong></span>
        </div>
      `;

      $('#reportPreviewScope').textContent =
        `Phạm vi báo cáo: ${reportScopeLabel()}`;

      $('#reportPreviewGeneratedAt').textContent =
        `Dữ liệu chuẩn bị lúc ${new Intl.DateTimeFormat('vi-VN', {
          dateStyle: 'full',
          timeStyle: 'short'
        }).format(prepared.generatedAt || new Date())}`;

      $('#reportPreviewBody').innerHTML = reportRows.map((item, rowIndex) => {
        const patient = item.patient;
        const book = item.book;
        const status = book
          ? normalizeRecordStatus(book['TRẠNG THÁI HIỆN TẠI'])
          : 'Chưa lưu quyển';

        return `
          <tr>
            <td class="center">${rowIndex + 1}</td>
            <td>${escapeHtml(patient['SỐ HỒ SƠ'])}</td>
            <td>${escapeHtml(patient['HỌ VÀ TÊN'])}</td>
            <td class="center">${escapeHtml(patient['NĂM SINH'])}</td>
            <td class="center">${escapeHtml(patient['GIỚI TÍNH'] || '—')}</td>
            <td class="center">${book ? escapeHtml(book['QUYỂN SỐ']) : '—'}</td>
            <td class="center">${book ? escapeHtml(formatDateVN(book['NGÀY BẮT ĐẦU'])) : '—'}</td>
            <td class="center">${book ? escapeHtml(formatDateVN(book['NGÀY KẾT THÚC'])) : '—'}</td>
            <td class="${reportStatusClass(status)}">${escapeHtml(status)}</td>
            <td class="center">${
              book && status === CONFIG.STATUS.HOI_GIA
                ? escapeHtml(formatDateVN(book['NGÀY HỒI GIA']))
                : '—'
            }</td>
            <td class="center">${
              book && status === CONFIG.STATUS.TU_VONG
                ? escapeHtml(formatDateVN(book['NGÀY TỬ VONG']))
                : '—'
            }</td>
            <td class="center">${
              book && status === CONFIG.STATUS.CHUYEN_TRUNG_TAM
                ? escapeHtml(formatDateVN(book['NGÀY CHUYỂN TRUNG TÂM']))
                : '—'
            }</td>
            <td>${
              book && status === CONFIG.STATUS.KHAC
                ? escapeHtml(book['NỘI DUNG KHÁC'] || '—')
                : '—'
            }</td>
            <td>${
              book && status === CONFIG.STATUS.TU_VONG
                ? escapeHtml(book['NƠI TỬ VONG'] || '—')
                : '—'
            }</td>
            <td>${
              book && status === CONFIG.STATUS.TU_VONG
                ? escapeHtml(book['NGUYÊN NHÂN TỬ VONG'] || '—')
                : '—'
            }</td>
            <td class="center">${
              book && book['THÙNG SỐ']
                ? escapeHtml(book['THÙNG SỐ'])
                : '—'
            }</td>
            <td class="center">${
              book && book['VỊ TRÍ SỐ']
                ? escapeHtml(book['VỊ TRÍ SỐ'])
                : '—'
            }</td>
            <td class="center">${
              book && book['TỔNG SỐ GIẤY TỜ'] !== ''
                ? escapeHtml(book['TỔNG SỐ GIẤY TỜ'])
                : '—'
            }</td>
          </tr>`;
      }).join('');
    }

    async function openReportPreview() {
      if (!requireEditPermission()) return;

      const button = $('#exportExcelBtn');
      const originalHtml = button.innerHTML;

      button.disabled = true;
      button.textContent = 'Đang chuẩn bị báo cáo...';

      try {
        await withLoading(async () => {
          const prepared = await prepareReportData(false);
          renderReportPreview(prepared);
          $('#reportPreviewDialog').showModal();
        });
      } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }

    let excelJsLoadingPromise = null;

    function loadExcelJs() {
      if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
      if (excelJsLoadingPromise) return excelJsLoadingPromise;

      excelJsLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src =
          'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
        script.async = true;
        script.onload = () => {
          if (window.ExcelJS) resolve(window.ExcelJS);
          else reject(new Error('Không khởi tạo được thư viện xuất Excel.'));
        };
        script.onerror = () =>
          reject(new Error('Không tải được chức năng xuất Excel.'));
        document.head.appendChild(script);
      }).catch(error => {
        excelJsLoadingPromise = null;
        throw error;
      });

      return excelJsLoadingPromise;
    }

    function parseExcelDate(value) {
      const text = String(value || '').trim();
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return '';
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      );
    }

    async function collectExcelReportRows(patients) {
      const rows = [];
      const booksRoot = await readBooksRootCached();

      patients.forEach(patient => {
        const patientId =
          patient['_FIREBASE_ID'] ||
          firebaseKey(patient['SỐ HỒ SƠ']);
        const rawPatient = {
          soHoSo: patient['SỐ HỒ SƠ'] || '',
          hoTen: patient['HỌ VÀ TÊN'] || '',
          namSinh: patient['NĂM SINH'] || '',
          gioiTinh: patient['GIỚI TÍNH'] || ''
        };
        const books = Object.values(booksRoot[patientId] || {})
          .filter(Boolean)
          .map(book => bookToUi(rawPatient, book))
          .sort(
            (a, b) =>
              Number(a['QUYỂN SỐ']) - Number(b['QUYỂN SỐ'])
          );

        if (!books.length) {
          rows.push({
            patient,
            book: null
          });
          return;
        }

        books.forEach(book => rows.push({ patient, book }));
      });

      return rows;
    }

    function excelSafeText(value) {
      const text = String(value ?? '').trim();
      if (/^[=+\-@]/.test(text)) return `'${text}`;
      return text;
    }

    function excelFileName() {
      const now = new Date();
      const date = [
        String(now.getDate()).padStart(2, '0'),
        String(now.getMonth() + 1).padStart(2, '0'),
        now.getFullYear()
      ].join('-');
      return `Bao_cao_HSBA_${date}.xlsx`;
    }

    async function exportExcelReport() {
      if (!requireEditPermission()) return;

      const exportButton = $('#reportPreviewExportBtn');
      const originalText = exportButton.textContent;

      exportButton.disabled = true;
      exportButton.textContent = 'Đang tạo Excel...';

      try {
        await withLoading(async () => {
          const prepared = await prepareReportData(false);
          const patients = prepared.patients;
          const reportRows = prepared.reportRows;
          const ExcelJS = await loadExcelJs();
          const workbook = new ExcelJS.Workbook();

          workbook.creator = 'Hệ thống quản lý HSBA';
          workbook.lastModifiedBy =
            firebaseAuth.currentUser?.email || CONFIG.OWNER_EMAIL;
          workbook.created = new Date();
          workbook.modified = new Date();

          const sheet = workbook.addWorksheet('Báo cáo HSBA', {
            views: [{ state: 'frozen', ySplit: 5 }],
            pageSetup: {
              paperSize: 9,
              orientation: 'landscape',
              fitToPage: true,
              fitToWidth: 1,
              fitToHeight: 0,
              horizontalCentered: true,
              verticalCentered: false,
              margins: {
                left: 0.25,
                right: 0.25,
                top: 0.5,
                bottom: 0.5,
                header: 0.2,
                footer: 0.2
              },
              printTitlesRow: '1:5'
            },
            properties: {
              defaultRowHeight: 20
            }
          });

          sheet.headerFooter.oddFooter =
            '&LHSBA Trung tâm&CTrang &P / &N&RNgày xuất: &D';

          const totalColumns = 23;
          sheet.mergeCells(1, 1, 1, totalColumns);
          sheet.getCell('A1').value =
            'BÁO CÁO DANH MỤC HỒ SƠ BỆNH ÁN LƯU TRỮ';
          sheet.getCell('A1').font = {
            name: 'Arial',
            size: 16,
            bold: true,
            color: { argb: 'FFF28076' }
          };
          sheet.getCell('A1').alignment = {
            horizontal: 'center',
            vertical: 'middle'
          };
          sheet.getRow(1).height = 28;

          sheet.mergeCells(2, 1, 2, totalColumns);
          sheet.getCell('A2').value =
            `Phạm vi báo cáo: ${state.activeStatusFilter === 'all'
              ? 'Toàn bộ hồ sơ đang hiển thị'
              : 'Theo bộ lọc hiện tại'} · ${patients.length} hồ sơ`;
          sheet.getCell('A2').alignment = {
            horizontal: 'center',
            vertical: 'middle'
          };
          sheet.getCell('A2').font = {
            name: 'Arial',
            size: 10,
            italic: true,
            color: { argb: 'FF687169' }
          };

          sheet.mergeCells(3, 1, 3, totalColumns);
          sheet.getCell('A3').value =
            `Ngày xuất báo cáo: ${new Intl.DateTimeFormat('vi-VN', {
              dateStyle: 'full',
              timeStyle: 'short'
            }).format(new Date())}`;
          sheet.getCell('A3').alignment = {
            horizontal: 'center',
            vertical: 'middle'
          };
          sheet.getCell('A3').font = {
            name: 'Arial',
            size: 9,
            color: { argb: 'FF778078' }
          };

          const headers = [
            'STT',
            'Số hồ sơ',
            'Họ và tên',
            'Năm sinh',
            'Giới tính',
            'Quyển số',
            'Ngày mở',
            'Ngày kết thúc',
            'Trạng thái',
            'Ngày hồi gia',
            'Ngày tử vong',
            'Ngày chuyển trung tâm',
            'Nội dung khác',
            'Nơi tử vong',
            'Nguyên nhân tử vong',
            'Thùng số',
            'Vị trí số',
            'Tờ chăm sóc',
            'Tờ điều trị',
            'Phiếu truyền dịch',
            'Phiếu đánh giá té ngã',
            'Phiếu đánh giá loét tì đè',
            'Tổng kiểm kê'
          ];

          const headerRow = sheet.getRow(5);
          headerRow.values = headers;
          headerRow.height = 38;
          headerRow.eachCell(cell => {
            cell.font = {
              name: 'Arial',
              size: 9,
              bold: true,
              color: { argb: 'FFFFFFFF' }
            };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF28076' }
            };
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true
            };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFBCD0BE' } },
              left: { style: 'thin', color: { argb: 'FFBCD0BE' } },
              bottom: { style: 'thin', color: { argb: 'FFBCD0BE' } },
              right: { style: 'thin', color: { argb: 'FFBCD0BE' } }
            };
          });

          reportRows.forEach((item, rowIndex) => {
            const patient = item.patient;
            const book = item.book;
            const status = book
              ? normalizeRecordStatus(book['TRẠNG THÁI HIỆN TẠI'])
              : 'Chưa lưu quyển';

            const row = sheet.addRow([
              rowIndex + 1,
              excelSafeText(patient['SỐ HỒ SƠ']),
              excelSafeText(patient['HỌ VÀ TÊN']),
              Number(patient['NĂM SINH']) || '',
              excelSafeText(patient['GIỚI TÍNH'] || ''),
              book ? Number(book['QUYỂN SỐ']) || '' : '',
              book ? parseExcelDate(book['NGÀY BẮT ĐẦU']) : '',
              book ? parseExcelDate(book['NGÀY KẾT THÚC']) : '',
              status,
              book && status === CONFIG.STATUS.HOI_GIA
                ? parseExcelDate(book['NGÀY HỒI GIA'])
                : '',
              book && status === CONFIG.STATUS.TU_VONG
                ? parseExcelDate(book['NGÀY TỬ VONG'])
                : '',
              book && status === CONFIG.STATUS.CHUYEN_TRUNG_TAM
                ? parseExcelDate(book['NGÀY CHUYỂN TRUNG TÂM'])
                : '',
              book && status === CONFIG.STATUS.KHAC
                ? excelSafeText(book['NỘI DUNG KHÁC'])
                : '',
              book && status === CONFIG.STATUS.TU_VONG
                ? excelSafeText(book['NƠI TỬ VONG'])
                : '',
              book && status === CONFIG.STATUS.TU_VONG
                ? excelSafeText(book['NGUYÊN NHÂN TỬ VONG'])
                : '',
              book ? Number(book['THÙNG SỐ']) || '' : '',
              book ? Number(book['VỊ TRÍ SỐ']) || '' : '',
              book ? Number(book['SỐ TỜ CHĂM SÓC']) || 0 : '',
              book ? Number(book['SỐ TỜ ĐIỀU TRỊ']) || 0 : '',
              book ? Number(book['SỐ PHIẾU TRUYỀN DỊCH']) || 0 : '',
              book ? Number(book['SỐ PHIẾU ĐÁNH GIÁ TÉ NGÃ']) || 0 : '',
              book ? Number(book['SỐ PHIẾU ĐÁNH GIÁ LOÉT TÌ ĐÈ']) || 0 : '',
              book ? Number(book['TỔNG SỐ GIẤY TỜ']) || 0 : ''
            ]);

            row.height = 34;
            row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
              cell.font = { name: 'Arial', size: 9 };
              cell.alignment = {
                vertical: 'middle',
                horizontal: [1, 4, 5, 6, 7, 8, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23]
                  .includes(columnNumber)
                  ? 'center'
                  : 'left',
                wrapText: true
              };
              cell.border = {
                top: { style: 'hair', color: { argb: 'FFF2D5D5' } },
                left: { style: 'hair', color: { argb: 'FFF2D5D5' } },
                bottom: { style: 'hair', color: { argb: 'FFF2D5D5' } },
                right: { style: 'hair', color: { argb: 'FFF2D5D5' } }
              };
              if (rowIndex % 2 === 1) {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFAF8F4' }
                };
              }
            });

            [7, 8, 10, 11, 12].forEach(columnNumber => {
              row.getCell(columnNumber).numFmt = 'dd/mm/yyyy';
            });

            const statusCell = row.getCell(9);
            if (status === CONFIG.STATUS.TU_VONG) {
              statusCell.font = {
                name: 'Arial',
                size: 9,
                bold: true,
                color: { argb: 'FFA45157' }
              };
            } else if (status === CONFIG.STATUS.HOI_GIA) {
              statusCell.font = {
                name: 'Arial',
                size: 9,
                bold: true,
                color: { argb: 'FF4F7B59' }
              };
            } else {
              statusCell.font = {
                name: 'Arial',
                size: 9,
                bold: true,
                color: { argb: 'FFF28076' }
              };
            }
          });

          const dataEndRow = Math.max(5, sheet.rowCount);
          sheet.autoFilter = {
            from: { row: 5, column: 1 },
            to: { row: dataEndRow, column: totalColumns }
          };

          const widths = [
            6, 13, 25, 10, 10, 9, 12, 12, 22, 12,
            12, 15, 30, 20, 30, 9, 9, 11, 11, 12,
            13, 13, 12
          ];
          widths.forEach((width, index) => {
            sheet.getColumn(index + 1).width = width;
          });

          const summaryRowNumber = sheet.rowCount + 2;
          sheet.mergeCells(
            summaryRowNumber,
            1,
            summaryRowNumber,
            5
          );
          sheet.getCell(summaryRowNumber, 1).value = 'TỔNG HỢP';
          sheet.getCell(summaryRowNumber, 1).font = {
            name: 'Arial',
            size: 10,
            bold: true,
            color: { argb: 'FFFFFFFF' }
          };
          sheet.getCell(summaryRowNumber, 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF28076' }
          };
          sheet.getCell(summaryRowNumber, 1).alignment = {
            horizontal: 'center',
            vertical: 'middle'
          };

          const summaryLabels = [
            ['Số hồ sơ xuất', patients.length],
            ['Số dòng quyển', reportRows.filter(item => item.book).length],
            ['Hết quyển', reportRows.filter(item =>
              normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
              CONFIG.STATUS.HET_QUYEN
            ).length],
            ['Hồi gia', reportRows.filter(item =>
              normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
              CONFIG.STATUS.HOI_GIA
            ).length],
            ['Tử vong', reportRows.filter(item =>
              normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
              CONFIG.STATUS.TU_VONG
            ).length],
            ['Chuyển trung tâm', reportRows.filter(item =>
              normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
              CONFIG.STATUS.CHUYEN_TRUNG_TAM
            ).length],
            ['Khác', reportRows.filter(item =>
              normalizeRecordStatus(item.book?.['TRẠNG THÁI HIỆN TẠI']) ===
              CONFIG.STATUS.KHAC
            ).length]
          ];

          summaryLabels.forEach((summary, index) => {
            const column = 6 + index * 2;
            sheet.mergeCells(
              summaryRowNumber,
              column,
              summaryRowNumber,
              column + 1
            );
            sheet.getCell(summaryRowNumber, column).value =
              `${summary[0]}: ${summary[1]}`;
            sheet.getCell(summaryRowNumber, column).alignment = {
              horizontal: 'center',
              vertical: 'middle'
            };
            sheet.getCell(summaryRowNumber, column).font = {
              name: 'Arial',
              size: 9,
              bold: true,
              color: { argb: 'FF29332C' }
            };
            sheet.getCell(summaryRowNumber, column).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFCF8F3' }
            };
          });

          sheet.pageSetup.printArea =
            `A1:T${sheet.rowCount}`;

          const buffer = await workbook.xlsx.writeBuffer();
          const blob = new Blob(
            [buffer],
            {
              type:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
          );
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = excelFileName();
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
          $('#reportPreviewDialog')?.close();

          showToast(
            `Đã xuất ${patients.length} hồ sơ. Dữ liệu được dùng lại từ bản xem trước.`
          );
        });
      } finally {
        exportButton.disabled = false;
        exportButton.textContent = originalText;
      }
    }

    async function withLoading(callback, show = true) {
      if (show) $('#loading').classList.remove('hidden');

      try {
        return await callback();
      } catch (error) {
        console.error(error);
        showToast(error.message || 'Có lỗi xảy ra.', true);
      } finally {
        if (show) $('#loading').classList.add('hidden');
      }
    }

    function showToast(message, error = false) {
      const toast = $('#toast');
      toast.textContent = message;
      toast.classList.toggle('error', error);
      toast.classList.add('show');

      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => {
        toast.classList.remove('show');
      }, 3800);
    }

    function resolveUploadMimeType(file) {
      const rawType = String(file?.type || '').trim().toLowerCase();

      if (rawType === 'image/jpg') return 'image/jpeg';

      const allowedDirectTypes = new Set([
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif'
      ]);

      if (allowedDirectTypes.has(rawType)) return rawType;

      const fileName = String(file?.name || '').trim().toLowerCase();
      const extension = fileName.includes('.')
        ? fileName.split('.').pop()
        : '';

      const mimeByExtension = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif'
      };

      return mimeByExtension[extension] || rawType;
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          const value = String(reader.result || '');
          resolve(value.includes(',') ? value.split(',')[1] : value);
        };

        reader.onerror = () => reject(new Error('Không đọc được file.'));
        reader.readAsDataURL(file);
      });
    }


    function uiIcon(name, className = '') {
      const safeName = String(name || '').replace(/[^a-z0-9-]/gi, '');
      const safeClass = String(className || '').replace(/[^a-z0-9 _-]/gi, '').trim();
      return `<svg class="ui-icon${safeClass ? ` ${safeClass}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${safeName}"></use></svg>`;
    }

    function normalize(value) {
      return String(value || '').trim().toUpperCase();
    }

    function initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);

      if (!parts.length) return 'HS';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

      return (
        parts[parts.length - 2][0] +
        parts[parts.length - 1][0]
      ).toUpperCase();
    }


    function genderAvatarHtml(gender, detail = false) {
      const normalizedGender = normalize(gender);
      const isFemale = normalizedGender === 'NỮ';
      const isMale = normalizedGender === 'NAM';
      const type = isFemale ? 'female' : (isMale ? 'male' : 'unknown');
      const label = isFemale ? 'Nữ' : (isMale ? 'Nam' : 'Chưa cập nhật giới tính');
      const baseClass = detail ? 'detail-avatar' : 'avatar';

      const femaleSvg = `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <path d="M18 27c0-10 5.8-17 14-17s14 7 14 17v5H18z" fill="currentColor" opacity=".25"/>
          <circle cx="32" cy="25" r="9.5" fill="currentColor" opacity=".94"/>
          <path d="M16 54c1.8-10.7 7.8-16 16-16s14.2 5.3 16 16" fill="currentColor" opacity=".94"/>
          <path d="M21.5 22.5c1-7.8 5.2-11.7 10.5-11.7 5.4 0 9.6 4 10.5 11.7-3-3.2-6.5-4.8-10.5-4.8s-7.5 1.6-10.5 4.8z" fill="currentColor"/>
          <path d="M23 42.5 32 50l9-7.5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>
        </svg>`;

      const maleSvg = `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle cx="32" cy="24" r="10" fill="currentColor" opacity=".94"/>
          <path d="M15.5 54c2-10.8 8-16.2 16.5-16.2S46.5 43.2 48.5 54" fill="currentColor" opacity=".94"/>
          <path d="M22.5 18.3c2.3-5.8 6-8.7 11.2-8.2 4.7.4 8 3.2 9.8 8.2-3.6-1.2-7.1-1.8-10.7-1.8-3.6 0-7 .6-10.3 1.8z" fill="currentColor"/>
          <path d="M24 42.5 32 48l8-5.5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>
        </svg>`;

      const unknownSvg = `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle cx="32" cy="23" r="10" fill="currentColor" opacity=".88"/>
          <path d="M15.5 54c2-10.7 8.1-16 16.5-16s14.5 5.3 16.5 16" fill="currentColor" opacity=".88"/>
          <circle cx="49" cy="16" r="9" fill="#fff" opacity=".96"/>
          <text x="49" y="20" text-anchor="middle" font-size="13" font-weight="800" fill="currentColor">?</text>
        </svg>`;

      const svg = isFemale ? femaleSvg : (isMale ? maleSvg : unknownSvg);
      return `<div class="${baseClass} gender-avatar ${type}" role="img" aria-label="${label}" title="${label}">${svg}</div>`;
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }
    }
  