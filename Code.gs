/**
 * HSBA - DỊCH VỤ FILE GOOGLE DRIVE
 *
 * Phạm vi duy nhất của Apps Script:
 * 1. Xác thực người dùng bằng Firebase ID token.
 * 2. Tải PDF/hình ảnh lên Google Drive.
 * 3. Xóa file tạm nếu Firebase không hoàn tất thao tác.
 * 4. Xóa file hồ sơ đã được người dùng đánh dấu, sau khi RTDB bỏ tham chiếu.
 *
 * Không đọc Google Sheet.
 * Không ghi Google Sheet.
 * Không tạo/sửa nghiệp vụ đối tượng, quyển hồ sơ, trạng thái hay thống kê.
 * Chỉ đọc tối thiểu metadata RTDB cần thiết để xác minh thao tác xóa file an toàn.
 */

const CONFIG = Object.freeze({
  DRIVE_ROOT_FOLDER_ID: '1ocPBQPY0qiEzxF0gw5ztxk4mAE39q8vU',

  // KHÔNG dùng Browser key của frontend tại đây.
  // Production ưu tiên Script Property FIREBASE_API_KEY, giá trị phải là
  // key "Apps Script Firebase Auth Admin" (Identity Toolkit API).
  FIREBASE_API_KEY: '',
  FIREBASE_API_KEY_PROPERTY: 'FIREBASE_API_KEY',
  DELETE_TOKEN_SECRET_PROPERTY: 'HSBA_DELETE_TOKEN_SECRET',
  FILE_CLEANUP_QUEUE_PATH: 'hsbaFileChoXoa',
  FIREBASE_DATABASE_URL:
    'https://hsba-trung-tam-test-default-rtdb.asia-southeast1.firebasedatabase.app',

  SERVICE_VERSION: '2026.10.07.1',
  OWNER_EMAIL: 'thanhbds2011@gmail.com',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,

  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ],

  WRITE_ROLES: ['admin', 'editor']
});


/* ========================= WEB APP ========================= */

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'health')
      .trim();

    if (action !== 'health') {
      return json_(fail_('Hành động GET không hợp lệ.'));
    }

    DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);

    return json_(ok_({
      service: 'HSBA Drive File Service',
      version: CONFIG.SERVICE_VERSION,
      firebaseAuthConfigured: Boolean(getFirebaseApiKey_(false)),
      serverTime: new Date().toISOString(),
      sheetAccess: false
    }, 'Dịch vụ file đang hoạt động.'));
  } catch (error) {
    console.error(error);
    return json_(fail_(error.message || 'Dịch vụ file không hoạt động.'));
  }
}

function doPost(e) {
  try {
    const params = parseJsonRequest_(e);
    const action = String(params.action || '').trim();

    switch (action) {
      case 'taiFileLen':
        return json_(apiTaiFileLen_(params));

      case 'xoaFileTam':
        return json_(apiXoaFileTam_(params));

      case 'taoYeuCauXoaFile':
        return json_(apiTaoYeuCauXoaFile_(params));

      case 'xoaFileHoSo':
        return json_(apiXoaFileHoSo_(params));

      default:
        return json_(fail_('Hành động POST không hợp lệ.'));
    }
  } catch (error) {
    console.error(error);
    return json_(fail_(
      error.message || 'Không xử lý được yêu cầu file.',
      error.hsbaCode || 'UNEXPECTED_ERROR'
    ));
  }
}

function parseJsonRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Không nhận được dữ liệu gửi lên.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('Dữ liệu gửi lên không đúng định dạng JSON.');
  }
}


/* ========================= XÁC THỰC FIREBASE ========================= */

function getFirebaseApiKey_(required) {
  const mustExist = required !== false;
  const properties = PropertiesService.getScriptProperties();
  const fromProperty = String(
    properties.getProperty(CONFIG.FIREBASE_API_KEY_PROPERTY) || ''
  ).trim();
  const fallback = String(CONFIG.FIREBASE_API_KEY || '').trim();
  const apiKey = fromProperty || fallback;

  if (!apiKey && mustExist) {
    throw serviceError_(
      'AUTH_CONFIG_MISSING',
      'Dịch vụ lưu trữ chưa được cấu hình khóa xác thực Firebase.'
    );
  }

  return apiKey;
}

function serviceError_(code, message) {
  const error = new Error(message || 'Có lỗi dịch vụ.');
  error.hsbaCode = String(code || 'SERVICE_ERROR');
  return error;
}

function parseJsonSafe_(text) {
  try {
    return JSON.parse(String(text || '{}')) || {};
  } catch (error) {
    return {};
  }
}

function getDeleteTokenSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = String(properties.getProperty(CONFIG.DELETE_TOKEN_SECRET_PROPERTY) || '').trim();
  if (secret) return secret;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    secret = String(properties.getProperty(CONFIG.DELETE_TOKEN_SECRET_PROPERTY) || '').trim();
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty(CONFIG.DELETE_TOKEN_SECRET_PROPERTY, secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

function base64UrlEncodeText_(text) {
  return Utilities.base64EncodeWebSafe(String(text || ''), Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function base64UrlEncodeBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function base64UrlDecodeText_(encoded) {
  const bytes = Utilities.base64DecodeWebSafe(String(encoded || ''));
  return Utilities.newBlob(bytes).getDataAsString(Utilities.Charset.UTF_8);
}

function safeStringEquals_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function createFileCleanupToken_(fileId) {
  const payload = JSON.stringify({
    fileId: String(fileId || ''),
    issuedAt: Date.now(),
    nonce: Utilities.getUuid()
  });
  const payloadPart = base64UrlEncodeText_(payload);
  const signature = Utilities.computeHmacSha256Signature(
    payloadPart,
    getDeleteTokenSecret_(),
    Utilities.Charset.UTF_8
  );
  return payloadPart + '.' + base64UrlEncodeBytes_(signature);
}

function verifyFileCleanupToken_(token, expectedFileId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw serviceError_('DELETE_TOKEN_INVALID', 'Xác nhận xóa file không hợp lệ.');
  }
  const expectedSignature = base64UrlEncodeBytes_(Utilities.computeHmacSha256Signature(
    parts[0],
    getDeleteTokenSecret_(),
    Utilities.Charset.UTF_8
  ));
  if (!safeStringEquals_(parts[1], expectedSignature)) {
    throw serviceError_('DELETE_TOKEN_INVALID', 'Xác nhận xóa file không hợp lệ.');
  }
  const payload = parseJsonSafe_(base64UrlDecodeText_(parts[0]));
  if (String(payload.fileId || '') !== String(expectedFileId || '')) {
    throw serviceError_('DELETE_TOKEN_MISMATCH', 'Xác nhận xóa file không khớp file hiện tại.');
  }
  return payload;
}

function extractFirebaseProviderCode_(payload) {
  const message = String(
    payload && payload.error && payload.error.message || ''
  ).trim();

  if (!message) return '';

  return message
    .split(':')[0]
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_\-]/g, '_')
    .slice(0, 100);
}

function classifyFirebaseLookupError_(responseCode, providerCode) {
  const code = String(providerCode || '').toUpperCase();

  if (
    code.indexOf('INVALID_ID_TOKEN') >= 0 ||
    code.indexOf('TOKEN_EXPIRED') >= 0 ||
    code.indexOf('INVALID_AUTH') >= 0
  ) {
    return {
      code: 'AUTH_TOKEN_INVALID',
      message: 'Phiên đăng nhập Firebase không còn hợp lệ. Vui lòng thử lại.'
    };
  }

  if (code.indexOf('USER_DISABLED') >= 0) {
    return {
      code: 'AUTH_USER_DISABLED',
      message: 'Tài khoản Firebase đã bị vô hiệu hóa.'
    };
  }

  if (
    code.indexOf('CREDENTIAL_MISMATCH') >= 0 ||
    code.indexOf('PROJECT_NUMBER_MISMATCH') >= 0
  ) {
    return {
      code: 'AUTH_PROJECT_MISMATCH',
      message: 'Dịch vụ lưu trữ đang dùng sai cấu hình Firebase project.'
    };
  }

  if (
    code.indexOf('API_DISABLED') >= 0 ||
    code.indexOf('SERVICE_DISABLED') >= 0
  ) {
    return {
      code: 'AUTH_API_DISABLED',
      message: 'Identity Toolkit API chưa sẵn sàng cho dịch vụ lưu trữ.'
    };
  }

  if (
    Number(responseCode) === 403 ||
    code.indexOf('API_KEY') >= 0 ||
    code.indexOf('PERMISSION_DENIED') >= 0 ||
    code.indexOf('FORBIDDEN') >= 0
  ) {
    return {
      code: 'AUTH_API_KEY_REJECTED',
      message: 'Dịch vụ lưu trữ chưa được cấu hình đúng khóa xác thực Firebase.'
    };
  }

  return {
    code: 'AUTH_PROVIDER_ERROR',
    message: 'Không xác thực được phiên đăng nhập với Firebase.'
  };
}

function verifyAuthorizedUser_(idToken) {
  const token = requireText_(idToken, 'Thiếu mã xác thực Firebase.');
  const firebaseApiKey = getFirebaseApiKey_(true);

  const lookupUrl =
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
    encodeURIComponent(firebaseApiKey);

  const response = UrlFetchApp.fetch(lookupUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: token }),
    muteHttpExceptions: true
  });

  const responseCode = Number(response.getResponseCode());
  const responseText = String(response.getContentText() || '');
  const responsePayload = parseJsonSafe_(responseText);

  if (responseCode !== 200) {
    const providerCode = extractFirebaseProviderCode_(responsePayload);
    const classified = classifyFirebaseLookupError_(
      responseCode,
      providerCode
    );

    // Không log ID token, API key hoặc toàn bộ phản hồi từ nhà cung cấp.
    console.error(JSON.stringify({
      event: 'firebase_accounts_lookup_failed',
      httpStatus: responseCode,
      providerCode: providerCode || 'UNKNOWN',
      hsbaCode: classified.code
    }));

    throw serviceError_(classified.code, classified.message);
  }

  const account = responsePayload.users && responsePayload.users[0];

  if (!account || !account.localId || !account.email) {
    throw serviceError_(
      'AUTH_ACCOUNT_NOT_FOUND',
      'Không xác định được tài khoản Firebase.'
    );
  }

  const user = {
    uid: String(account.localId),
    email: String(account.email).trim().toLowerCase(),
    emailVerified: account.emailVerified === true
  };

  if (user.email === CONFIG.OWNER_EMAIL.toLowerCase()) {
    return user;
  }

  const permission = readOwnFirebasePermission_(user.uid, token);
  const role = String(permission.role || '').trim().toLowerCase();

  if (
    permission.active !== true ||
    CONFIG.WRITE_ROLES.indexOf(role) === -1
  ) {
    throw serviceError_(
      'AUTH_PERMISSION_DENIED',
      'Tài khoản chưa được cấp quyền tải file hồ sơ.'
    );
  }

  return user;
}

function readOwnFirebasePermission_(uid, idToken) {
  const url =
    CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, '') +
    '/phanQuyen/' + encodeURIComponent(uid) +
    '.json?auth=' + encodeURIComponent(idToken);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return {};
  }

  try {
    return JSON.parse(response.getContentText() || '{}') || {};
  } catch (error) {
    return {};
  }
}


/* ========================= TẢI FILE ========================= */

function apiTaiFileLen_(params) {
  const user = verifyAuthorizedUser_(params.idToken);

  const soHoSo = sanitizeFolderName_(
    requireText_(params.soHoSo, 'Thiếu số hồ sơ.')
  );
  const quyenSo = Number(params.quyenSo);
  const fileName = sanitizeFileName_(
    requireText_(params.fileName, 'Thiếu tên file.')
  );
  const requestedMimeType = String(params.mimeType || '').trim();
  const mimeType = normalizeUploadMimeType_(fileName, requestedMimeType);
  const base64Data = requireText_(params.base64Data, 'Thiếu dữ liệu file.');

  if (!Number.isInteger(quyenSo) || quyenSo < 1) {
    throw new Error('Quyển số không hợp lệ.');
  }

  if (CONFIG.ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
    throw new Error(
      'Chỉ chấp nhận PDF, JPG/JPEG, PNG, WEBP, HEIC hoặc HEIF.'
    );
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64Data);
  } catch (error) {
    throw new Error('Dữ liệu file không hợp lệ.');
  }

  if (!bytes.length) {
    throw new Error('File không có dữ liệu.');
  }

  if (bytes.length > CONFIG.MAX_FILE_SIZE_BYTES) {
    throw new Error('File vượt quá dung lượng tối đa 20 MB.');
  }

  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const folders = getOrCreateBookFolder_(root, soHoSo, quyenSo);

  const timestamp = Utilities.formatDate(
    new Date(),
    CONFIG.TIMEZONE,
    'yyyyMMdd_HHmmss'
  );
  const randomCode = Utilities.getUuid().slice(0, 8);
  const finalName =
    soHoSo + '_Q' + quyenSo + '_' + timestamp + '_' +
    randomCode + '_' + fileName;

  const blob = Utilities.newBlob(bytes, mimeType, finalName);
  const file = folders.bookFolder.createFile(blob);

  file.setDescription([
    'HSBA_UPLOAD',
    'uid=' + user.uid,
    'email=' + user.email,
    'soHoSo=' + soHoSo,
    'quyenSo=' + quyenSo,
    'createdAt=' + new Date().toISOString()
  ].join('|'));

  return ok_({
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    folderUrl: folders.bookFolder.getUrl(),
    sizeBytes: bytes.length,
    mimeType: mimeType
  }, 'Đã tải file lên Google Drive.');
}

function normalizeUploadMimeType_(fileName, mimeType) {
  const rawType = String(mimeType || '').trim().toLowerCase();

  if (rawType === 'image/jpg') return 'image/jpeg';

  if (CONFIG.ALLOWED_MIME_TYPES.indexOf(rawType) !== -1) {
    return rawType;
  }

  const name = String(fileName || '').trim().toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? name.slice(dotIndex + 1) : '';

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


function getOrCreateBookFolder_(root, soHoSo, quyenSo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const patientFolder = findOrCreateFolder_(root, soHoSo);
    const bookFolder = findOrCreateFolder_(
      patientFolder,
      'QUYỂN ' + quyenSo
    );

    return { patientFolder: patientFolder, bookFolder: bookFolder };
  } finally {
    lock.releaseLock();
  }
}


/* ========================= XÓA FILE HỒ SƠ ĐÃ ĐÁNH DẤU ========================= */

/**
 * Xóa file cũ sau khi Realtime Database đã commit danh sách file mới.
 * File binary luôn nằm trên Google Drive; RTDB chỉ lưu metadata/tham chiếu.
 *
 * An toàn:
 * - bắt buộc user Firebase còn quyền ghi HSBA;
 * - file phải nằm trong HSBA root và có description HSBA_UPLOAD;
 * - description phải khớp hồ sơ/quyển tại thời điểm file được upload;
 * - bản ghi quyển hiện hành trong RTDB không còn tham chiếu file này;
 * - thao tác idempotent: file đã ở thùng rác được xem là hoàn tất.
 */
function apiTaoYeuCauXoaFile_(params) {
  const user = verifyAuthorizedUser_(params.idToken);
  const soHoSo = requireText_(params.soHoSo, 'Thiếu số hồ sơ hiện hành.');
  const quyenSo = Number(params.quyenSo);
  const fileId = String(params.fileId || extractDriveFileIdFromUrl_(params.fileUrl) || '').trim();
  if (!fileId) throw serviceError_('FILE_ID_MISSING', 'Không xác định được file cần xóa.');
  if (!Number.isInteger(quyenSo) || quyenSo < 1) throw serviceError_('BOOK_INVALID', 'Quyển số không hợp lệ.');

  const file = DriveApp.getFileById(fileId);
  if (!isFileUnderConfiguredRoot_(file)) throw serviceError_('FILE_OUTSIDE_HSBA_ROOT', 'File không thuộc thư mục HSBA được cấu hình.');
  const description = String(file.getDescription() || '');
  if (description.indexOf('HSBA_UPLOAD') !== 0) throw serviceError_('FILE_NOT_MANAGED', 'Không được phép xóa file không do ứng dụng HSBA tạo.');

  const patientId = firebaseKeyForHsba_(soHoSo);
  const bookId = bookKeyForHsba_(quyenSo);
  const book = readFirebaseJson_('quyenHoSo/' + patientId + '/' + bookId, params.idToken);
  if (!bookReferencesDriveFile_(book, fileId, String(params.fileUrl || ''))) {
    throw serviceError_('FILE_NOT_LINKED_TO_BOOK', 'File không còn thuộc quyển hồ sơ đang chỉnh sửa.');
  }

  const cleanupToken = createFileCleanupToken_(fileId);
  return ok_({ cleanupToken: cleanupToken, fileId: fileId, issuedForUid: user.uid }, 'Đã xác nhận file chờ xóa.');
}

function apiXoaFileHoSo_(params) {
  const user = verifyAuthorizedUser_(params.idToken);
  const fileId = String(params.fileId || extractDriveFileIdFromUrl_(params.fileUrl) || '').trim();
  const cleanupToken = requireText_(params.cleanupToken, 'Thiếu xác nhận xóa file an toàn.');
  const cleanupJobKey = String(params.cleanupJobKey || '').trim();

  if (!fileId) throw serviceError_('FILE_ID_MISSING', 'Không xác định được file cần xóa.');
  verifyFileCleanupToken_(cleanupToken, fileId);

  let job = null;
  if (cleanupJobKey) {
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(cleanupJobKey)) throw serviceError_('DELETE_JOB_INVALID', 'Mã hàng đợi xóa file không hợp lệ.');
    job = readFirebaseJson_(CONFIG.FILE_CLEANUP_QUEUE_PATH + '/' + cleanupJobKey, params.idToken);
    if (!job || String(job.status || '') !== 'pending') {
      throw serviceError_('DELETE_JOB_MISSING', 'Yêu cầu xóa file không còn tồn tại hoặc đã hoàn tất.');
    }
    if (
      String(job.fileId || '') !== fileId ||
      String(job.cleanupToken || '') !== cleanupToken
    ) {
      throw serviceError_('DELETE_JOB_MISMATCH', 'Yêu cầu xóa file không khớp dữ liệu đã cam kết.');
    }
  } else {
    // Tương thích ngắn hạn với phiên frontend cũ đang mở trong lúc nâng cấp.
    // Không tạo đường xóa tùy ý: token vẫn phải do File Service ký và file phải vừa được bỏ tham chiếu khỏi đúng quyển.
    const legacySoHoSo = requireText_(params.soHoSo, 'Thiếu số hồ sơ hiện hành.');
    const legacyQuyenSo = Number(params.quyenSo);
    if (!Number.isInteger(legacyQuyenSo) || legacyQuyenSo < 1) throw serviceError_('BOOK_INVALID', 'Quyển số hiện hành không hợp lệ.');
    job = {
      status: 'pending',
      fileId: fileId,
      fileUrl: String(params.fileUrl || ''),
      patientId: firebaseKeyForHsba_(legacySoHoSo),
      bookKey: bookKeyForHsba_(legacyQuyenSo),
      soHoSo: legacySoHoSo,
      quyenSo: legacyQuyenSo,
      cleanupToken: cleanupToken
    };
  }

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    throw serviceError_('DRIVE_FILE_UNAVAILABLE', 'Không truy cập được file cần dọn trên Google Drive. Hệ thống sẽ giữ yêu cầu để thử lại.');
  }
  // Nếu file đã ở thùng rác từ lần dọn trước nhưng client chưa kịp xóa job RTDB,
  // coi thao tác là idempotent thành công. Token đã được File Service ký khi file còn hợp lệ.
  if (typeof file.isTrashed === 'function' && file.isTrashed()) {
    return ok_({ fileId: fileId, alreadyDeleted: true, cleanupJobKey: cleanupJobKey || '' }, 'File đã được xóa trước đó.');
  }

  if (!isFileUnderConfiguredRoot_(file)) throw serviceError_('FILE_OUTSIDE_HSBA_ROOT', 'File không thuộc thư mục HSBA được cấu hình.');
  const description = String(file.getDescription() || '');
  if (description.indexOf('HSBA_UPLOAD') !== 0) throw serviceError_('FILE_NOT_MANAGED', 'Không được phép xóa file không do ứng dụng HSBA tạo.');

  const patientId = String(job.patientId || '').trim();
  const bookId = String(job.bookKey || '').trim();
  if (!patientId || !/^q_\d{6}$/.test(bookId)) {
    throw serviceError_('DELETE_JOB_CONTEXT_INVALID', 'Yêu cầu xóa file thiếu thông tin hồ sơ/quyển.');
  }

  const book = readFirebaseJson_('quyenHoSo/' + patientId + '/' + bookId, params.idToken);
  if (bookReferencesDriveFile_(book, fileId, String(job.fileUrl || params.fileUrl || ''))) {
    throw serviceError_('FILE_STILL_REFERENCED', 'File vẫn đang được quyển hồ sơ tham chiếu nên chưa thể xóa.');
  }

  const death = readFirebaseJson_('hoSoTuVong/' + patientId, params.idToken);
  if (bookReferencesDriveFile_(death, fileId, String(job.fileUrl || params.fileUrl || ''))) {
    throw serviceError_('FILE_STILL_REFERENCED', 'File vẫn đang được hồ sơ tử vong tham chiếu nên chưa thể xóa.');
  }

  file.setTrashed(true);
  return ok_({
    fileId: fileId,
    cleanupJobKey: cleanupJobKey || '',
    deletedByUid: user.uid,
    deletedByEmail: user.email
  }, 'Đã xóa file khỏi Google Drive.');
}

function readFirebaseJson_(relativePath, idToken) {
  const cleanPath = String(relativePath || '')
    .split('/')
    .filter(Boolean)
    .map(function(segment) { return encodeURIComponent(segment); })
    .join('/');
  const url = CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, '') +
    '/' + cleanPath + '.json?auth=' + encodeURIComponent(idToken);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw serviceError_('FIREBASE_READ_FAILED', 'Không xác minh được tham chiếu file hiện hành trên Firebase.');
  }
  const text = String(response.getContentText() || 'null');
  if (text === 'null') return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw serviceError_('FIREBASE_RESPONSE_INVALID', 'Dữ liệu Firebase trả về không hợp lệ.');
  }
}

function firebaseKeyForHsba_(value) {
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
  return slug + '_' + (hash >>> 0).toString(36);
}

function bookKeyForHsba_(quyenSo) {
  return 'q_' + String(Number(quyenSo) || 0).padStart(6, '0');
}

function extractDriveFileIdFromUrl_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const patterns = [
    /\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/file\/d\/([A-Za-z0-9_-]{10,})/
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = text.match(patterns[i]);
    if (match && match[1]) return match[1];
  }
  return '';
}

function bookReferencesDriveFile_(book, fileId, fileUrl) {
  if (!book || typeof book !== 'object') return false;
  const targetId = String(fileId || '').trim();
  const targetUrl = String(fileUrl || '').trim();
  const legacyId = String(book.fileId || extractDriveFileIdFromUrl_(book.fileDinhKem || book.fileUrl || '') || '').trim();
  const legacyUrl = String(book.fileDinhKem || book.fileUrl || '').trim();
  if ((targetId && legacyId === targetId) || (targetUrl && legacyUrl === targetUrl)) return true;

  const files = book.files;
  if (!files || typeof files !== 'object') return false;
  const values = Array.isArray(files) ? files : Object.keys(files).map(function(key) { return files[key]; });
  for (let i = 0; i < values.length; i += 1) {
    const record = values[i] || {};
    const recordUrl = String(record.fileUrl || record.url || '').trim();
    const recordId = String(record.fileId || extractDriveFileIdFromUrl_(recordUrl) || '').trim();
    if ((targetId && recordId === targetId) || (targetUrl && recordUrl === targetUrl)) return true;
  }
  return false;
}

/* ========================= XÓA FILE TẠM ========================= */

function apiXoaFileTam_(params) {
  const user = verifyAuthorizedUser_(params.idToken);
  const fileId = requireText_(params.fileId, 'Thiếu mã file cần xóa.');
  const file = DriveApp.getFileById(fileId);

  if (!isFileUnderConfiguredRoot_(file)) {
    throw new Error('File không thuộc thư mục HSBA được cấu hình.');
  }

  const description = String(file.getDescription() || '');

  if (description.indexOf('HSBA_UPLOAD') !== 0) {
    throw new Error('Không được phép xóa file không do ứng dụng tạo.');
  }

  const uploaderUid = extractDescriptionValue_(description, 'uid');
  const isOwner = user.email === CONFIG.OWNER_EMAIL.toLowerCase();

  if (!isOwner && uploaderUid !== user.uid) {
    throw new Error('Không được phép xóa file do tài khoản khác tải lên.');
  }

  file.setTrashed(true);

  return ok_({ fileId: fileId }, 'Đã xóa file tạm.');
}

function isFileUnderConfiguredRoot_(file) {
  const targetRootId = CONFIG.DRIVE_ROOT_FOLDER_ID;
  const queue = [];
  const initialParents = file.getParents();

  while (initialParents.hasNext()) {
    queue.push(initialParents.next());
  }

  const visited = {};
  let steps = 0;

  while (queue.length && steps < 30) {
    steps += 1;
    const folder = queue.shift();
    const folderId = folder.getId();

    if (folderId === targetRootId) return true;
    if (visited[folderId]) continue;
    visited[folderId] = true;

    const parents = folder.getParents();
    while (parents.hasNext()) {
      queue.push(parents.next());
    }
  }

  return false;
}

function extractDescriptionValue_(description, key) {
  const prefix = key + '=';
  const parts = String(description || '').split('|');

  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].indexOf(prefix) === 0) {
      return parts[i].slice(prefix.length);
    }
  }

  return '';
}


/* ========================= TIỆN ÍCH DRIVE ========================= */

function findOrCreateFolder_(parent, name) {
  const safeName = sanitizeFolderName_(name).slice(0, 120);
  const folders = parent.getFoldersByName(safeName);

  return folders.hasNext()
    ? folders.next()
    : parent.createFolder(safeName);
}

function sanitizeFolderName_(value) {
  return String(value || 'HSBA')
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]~]/g, '_')
    .replace(/\s+/g, ' ');
}

function sanitizeFileName_(value) {
  return String(value || 'tep-dinh-kem')
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]~]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function requireText_(value, message) {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}


/* ========================= PHẢN HỒI JSON ========================= */

function ok_(data, message) {
  return {
    success: true,
    message: message || 'Thành công.',
    data: data === undefined ? null : data
  };
}

function fail_(message, errorCode) {
  return {
    success: false,
    message: message || 'Có lỗi xảy ra.',
    errorCode: String(errorCode || 'SERVICE_ERROR'),
    data: null
  };
}

function json_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}
function capQuyenTaiFile() {
  const firebaseApiKey = getFirebaseApiKey_(true);
  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/',
    {
      method: 'get',
      muteHttpExceptions: true
    }
  );

  const folder = DriveApp.getFolderById(
    CONFIG.DRIVE_ROOT_FOLDER_ID
  );

  Logger.log(
    'UrlFetch: ' +
      response.getResponseCode() +
      ' | Drive: ' +
      folder.getName() +
      ' | Firebase key configured: ' +
      Boolean(firebaseApiKey)
  );
}
