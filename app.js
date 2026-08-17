'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  onValue,
  push,
  query,
  ref,
  orderByKey,
  startAt,
  endAt,
  serverTimestamp,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const APP_CONFIG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(APP_CONFIG.OWNER_EMAIL || '').trim().toLowerCase();
const ROOT = 'tongHopYTe';
const REPORT_ROOT = 'baoCaoYTe';
const YTE_APP_ROOT = 'yTeApp';
const PUBLIC_REPORT_STATS_ROOT = `${REPORT_ROOT}/congKhaiThongKe`;

const firebaseApp = initializeApp(APP_CONFIG.FIREBASE);
const firebaseAuth = getAuth(firebaseApp);
const firebaseDatabase = getDatabase(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const authPersistenceReady = setPersistence(firebaseAuth, browserLocalPersistence).catch((error) => {
  console.warn('Không thiết lập được Firebase Auth persistence:', error);
});

const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    unsubscribe();
    resolve(user || null);
  });
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}
function normalizeCategoryCode(value) {
  let text = String(value || '').trim().toLocaleUpperCase('vi-VN');
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');
  text = text.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  return text.slice(0, 60);
}
function normalizeMetricText(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function metricKindFromCategory(item) {
  const name = normalizeMetricText(item && (item.name || item.ten) || '');
  const code = normalizeCategoryCode(item && (item.code || item.ma) || '');
  if (['chuyen vien', 'luot chuyen vien', 'so luot chuyen vien'].includes(name) || ['CHUYEN_VIEN', 'CHUYENVIEN'].includes(code)) return 'transfer';
  if (['tu vong', 'luot tu vong', 'so tu vong', 'so luot tu vong'].includes(name) || ['TU_VONG', 'TUVONG'].includes(code)) return 'death';
  return '';
}
function markerCount(raw) {
  return Object.keys(raw || {}).filter((key) => raw[key] === true || raw[key] === 1 || raw[key] === '1').length;
}
function derivedCategory(categories, kind) {
  return (categories || []).find((item) => metricKindFromCategory(item) === kind) || null;
}
function mergeDerivedDailyRecords(records, categories, date, transferRaw, deathRaw) {
  const map = new Map((records || []).map((item) => [item.code, item]));
  const transfer = derivedCategory(categories, 'transfer');
  const death = derivedCategory(categories, 'death');
  function applyDerived(category, kind, raw) {
    if (!category) return;
    const autoValue = markerCount(raw);
    const stored = map.get(category.code) || null;
    if (!stored && autoValue === 0) return;
    if (stored) {
      map.set(category.code, {
        ...stored,
        autoDerived: true,
        derivedKind: kind,
        autoValue,
        manualOverride: true
      });
      return;
    }
    map.set(category.code, {
      id: `${date}-${category.code}`,
      date,
      code: category.code,
      name: category.name,
      value: autoValue,
      autoValue,
      note: '',
      updatedAt: 0,
      version: 0,
      autoDerived: true,
      derivedKind: kind,
      manualOverride: false
    });
  }
  applyDerived(transfer, 'transfer', transferRaw);
  applyDerived(death, 'death', deathRaw);
  return Array.from(map.values());
}
function mergeDerivedRangeRecords(records, categories, transferByDate, deathByDate, from, to) {
  const map = new Map((records || []).map((item) => [item.id, item]));
  const transfer = derivedCategory(categories, 'transfer');
  const death = derivedCategory(categories, 'death');
  const derivedCodes = new Set([transfer && transfer.code, death && death.code].filter(Boolean));
  const dates = new Set([
    ...Object.keys(transferByDate || {}),
    ...Object.keys(deathByDate || {}),
    ...(records || []).filter((item) => derivedCodes.has(item.code)).map((item) => item.date)
  ]);
  function applyDerived(date, category, kind, raw) {
    if (!category) return;
    const id = `${date}-${category.code}`;
    const autoValue = markerCount(raw);
    const stored = map.get(id) || null;
    if (!stored && autoValue === 0) return;
    if (stored) {
      map.set(id, {
        ...stored,
        autoDerived: true,
        derivedKind: kind,
        autoValue,
        manualOverride: true
      });
      return;
    }
    map.set(id, {
      id,
      date,
      code: category.code,
      name: category.name,
      value: autoValue,
      autoValue,
      note: '',
      updatedAt: 0,
      version: 0,
      autoDerived: true,
      derivedKind: kind,
      manualOverride: false
    });
  }
  dates.forEach((date) => {
    if (date < from || date > to) return;
    applyDerived(date, transfer, 'transfer', (transferByDate || {})[date] || {});
    applyDerived(date, death, 'death', (deathByDate || {})[date] || {});
  });
  return Array.from(map.values());
}
function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value || Date.now()));
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}
function monthKey(dateIso) {
  return String(dateIso || '').slice(0, 7);
}
function providerId(user) {
  const providers = (user && user.providerData) || [];
  if (providers.some((item) => item && item.providerId === 'password')) return 'password';
  if (providers.some((item) => item && item.providerId === 'google.com')) return 'google.com';
  return providers[0] && providers[0].providerId ? providers[0].providerId : '';
}
function uiRole(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Xem' : '';
}
function dbRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'quản trị' || value === 'quan tri') return 'admin';
  if (value === 'viewer' || value === 'xem' || value === 'chỉ xem' || value === 'chi xem') return 'viewer';
  return 'nhaplieu';
}
function uiReportRole(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Xem' : 'Chưa cấp';
}
function dbReportRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'quản trị' || value === 'quan tri') return 'admin';
  if (value === 'viewer' || value === 'xem' || value === 'chỉ xem' || value === 'chi xem') return 'viewer';
  return 'nhaplieu';
}
function uiStatus(active) {
  return active === true ? 'Hoạt động' : 'Khóa';
}
function snapshotObject(snapshot) {
  return snapshot && snapshot.exists() ? (snapshot.val() || {}) : {};
}
async function readOptionalSnapshot(referenceOrQuery) {
  try { return snapshotObject(await get(referenceOrQuery)); }
  catch (error) { console.warn('Không đọc được thống kê tự động:', error); return {}; }
}
function formatPersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).map((word) => {
    const lower = word.toLocaleLowerCase('vi-VN');
    return lower.charAt(0).toLocaleUpperCase('vi-VN') + lower.slice(1);
  }).join(' ');
}
async function preferredDisplayNameForUid(uid, fallback) {
  if (!uid) return String(fallback || '').trim();
  const raw = await readOptionalSnapshot(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi/${uid}`));
  return String(raw.displayName || fallback || '').trim().slice(0, 150);
}
function ownerUser(user) {
  return !!(user && normalizeEmail(user.email) === OWNER_EMAIL);
}

async function ensureYteUserProfile(user) {
  if (!user) return;
  const profileRef = ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${user.uid}`);
  const snap = await get(profileRef);
  const old = snapshotObject(snap);
  const now = Date.now();
  await update(profileRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || user.email || '').slice(0, 150),
    photoURL: String(user.photoURL || old.photoURL || '').slice(0, 1000),
    provider: providerId(user),
    active: true,
    createdAt: old.createdAt || now,
    updatedAt: now,
    lastLoginAt: now
  });
}

async function ensureReportOwnerPermission(user) {
  if (!ownerUser(user)) return;
  const permissionRef = ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin' && normalizeEmail(old.email) === normalizeEmail(user.email)) return;
  const now = Date.now();
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || 'Quản trị hệ thống').slice(0, 150),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || now,
    updatedAt: now
  });
}

async function getOwnReportPermission(user) {
  if (!user) return null;
  if (ownerUser(user)) await ensureReportOwnerPermission(user);
  const snap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`));
  return snap.exists() ? snap.val() : null;
}

function validModulePermission(permission) {
  return !!(permission && permission.active === true && ['admin', 'nhaplieu', 'viewer'].includes(permission.role));
}

async function writeAuditLog(user, action, content, dataDate) {
  if (!user) return;
  const keyMonth = monthKey(dataDate) || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit'
  }).format(new Date()).slice(0, 7);
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${keyMonth}`));
  await set(logRef, {
    action: String(action || '').slice(0, 100),
    content: String(content || '').slice(0, 1000),
    dataDate: dataDate || '',
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName: String((user.appPermission && user.appPermission.displayName) || user.displayName || user.email || '').slice(0, 150),
    role: user.appRole || '',
    createdAt: serverTimestamp()
  });
}

async function ensureOwnerPermission(user) {
  if (!ownerUser(user)) return;
  const permissionRef = ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin' && normalizeEmail(old.email) === normalizeEmail(user.email)) return;
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || 'Quản trị hệ thống').slice(0, 150),
    username: normalizeUsername(old.username || String(user.email || '').split('@')[0]),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || Date.now(),
    updatedAt: Date.now()
  });
}

async function ensureRegistrationRequest(user, profile) {
  if (!user) throw new Error('Chưa xác định được tài khoản. Vui lòng đăng nhập lại.');
  const requestRef = ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${user.uid}`);
  const snap = await get(requestRef);
  const existing = snapshotObject(snap);
  if (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'rejected') return existing;

  const displayName = String(
    (profile && profile.displayName) || user.displayName || user.email || ''
  ).trim().slice(0, 150);
  const username = normalizeUsername(
    (profile && profile.username) || existing.username || String(user.email || '').split('@')[0]
  );
  const request = {
    email: normalizeEmail(user.email),
    displayName: displayName,
    username: username,
    provider: providerId(user),
    status: 'pending',
    requestedAt: Date.now()
  };
  await set(requestRef, request);
  return request;
}

async function getOwnPermission(user) {
  if (!user) return null;
  if (ownerUser(user)) await ensureOwnerPermission(user);
  const snap = await get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`));
  return snap.exists() ? snap.val() : null;
}

function permissionToUser(user, permission) {
  return {
    id: user.uid,
    uid: user.uid,
    name: String(permission.displayName || user.displayName || user.email || ''),
    username: String(permission.username || ''),
    email: normalizeEmail(user.email || permission.email),
    role: uiRole(permission.role),
    status: uiStatus(permission.active),
    active: permission.active === true,
    forcePasswordChange: false,
    provider: providerId(user),
    lastLogin: permission.lastLoginAt ? formatDateTime(permission.lastLoginAt) : ''
  };
}

async function resolveApplicationAccess(user, profile) {
  if (!user) return {
    success: true,
    active: false,
    tongHopActive: false,
    authenticated: false,
    pending: false,
    user: null,
    authUser: null,
    reportPermission: null,
    categories: []
  };

  await ensureYteUserProfile(user);

  const [permission, reportPermission] = await Promise.all([
    getOwnPermission(user),
    getOwnReportPermission(user)
  ]);

  const preferredName = await preferredDisplayNameForUid(user.uid, (permission && permission.displayName) || (reportPermission && reportPermission.displayName) || user.displayName || user.email || '');
  if (permission) permission.displayName = preferredName;
  if (reportPermission) reportPermission.displayName = preferredName;
  const reportActive = validModulePermission(reportPermission);

  if (permission && ['admin', 'nhaplieu', 'viewer'].includes(permission.role)) {
    const appUser = permissionToUser(user, permission);
    if (permission.active === true) {
      return {
        success: true,
        active: true,
        tongHopActive: true,
        authenticated: true,
        pending: false,
        token: 'FIREBASE_AUTH',
        authUser: {
          uid: user.uid,
          email: normalizeEmail(user.email),
          name: preferredName || user.displayName || user.email || '',
          provider: providerId(user)
        },
        user: appUser,
        reportPermission: reportPermission || null,
        categories: await readPrivateCategories(true)
      };
    }

    if (reportActive) {
      return {
        success: true,
        active: false,
        tongHopActive: false,
        authenticated: true,
        pending: false,
        tongHopLocked: true,
        authUser: {
          uid: user.uid,
          email: normalizeEmail(user.email),
          name: preferredName || user.displayName || user.email || '',
          provider: providerId(user)
        },
        user: null,
        reportPermission: reportPermission,
        categories: []
      };
    }

    return {
      success: true,
      active: false,
      tongHopActive: false,
      authenticated: true,
      locked: true,
      pending: false,
      authUser: {
        uid: user.uid,
        email: normalizeEmail(user.email),
        name: preferredName || user.displayName || user.email || '',
        provider: providerId(user)
      },
      user: null,
      reportPermission: reportPermission || null,
      categories: [],
      message: 'Tài khoản Tổng hợp số liệu đang bị khóa.'
    };
  }

  if (reportActive) {
    return {
      success: true,
      active: false,
      tongHopActive: false,
      authenticated: true,
      pending: false,
      authUser: {
        uid: user.uid,
        email: normalizeEmail(user.email),
        name: preferredName || user.displayName || user.email || '',
        provider: providerId(user)
      },
      user: null,
      reportPermission: reportPermission,
      categories: []
    };
  }

  // Người dùng đã xác thực Google nhưng chưa có quyền ở bất kỳ phân hệ nào
  // được ghi nhận thành yêu cầu chờ duyệt. Đăng ký không tự cấp quyền.
  // Nếu yêu cầu đã bị từ chối, giữ nguyên trạng thái rejected cho đến khi admin xử lý/xóa.
  const request = await ensureRegistrationRequest(user, profile);
  return {
    success: true,
    active: false,
    tongHopActive: false,
    authenticated: true,
    pending: request.status === 'pending',
    rejected: request.status === 'rejected',
    authUser: {
      uid: user.uid,
      email: normalizeEmail(user.email),
      name: preferredName || user.displayName || user.email || '',
      provider: providerId(user)
    },
    user: null,
    reportPermission: reportPermission || null,
    categories: [],
    message: request.status === 'rejected'
      ? 'Tài khoản chưa được cấp quyền sử dụng ứng dụng.'
      : ''
  };
}

async function requireAppUser(requiredRole) {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Vui lòng đăng nhập.');
  const permission = await getOwnPermission(user);
  if (!permission || permission.active !== true || !['admin', 'nhaplieu'].includes(permission.role)) {
    throw new Error('Tài khoản chưa được cấp quyền Tổng hợp Y tế hoặc đã bị khóa.');
  }
  if (requiredRole === 'admin' && permission.role !== 'admin' && !ownerUser(user)) {
    throw new Error('Bạn không có quyền Quản trị Tổng hợp Y tế.');
  }
  user.appRole = permission.role;
  user.appPermission = { ...permission, displayName: await preferredDisplayNameForUid(user.uid, permission.displayName || user.displayName || user.email || '') };
  return user;
}

async function readPublicCategories() {
  const snap = await get(ref(firebaseDatabase, `${ROOT}/congKhai/danhMucChiTieu`));
  const raw = snapshotObject(snap);
  return Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return {
      code,
      name: item.ten || code,
      group: item.nhom || 'Khác',
      unit: item.donVi || 'Lượt',
      order: Number(item.thuTu || 9999),
      status: item.trangThai || 'Hoạt động',
      derivedKind: metricKindFromCategory({ code, name: item.ten || code })
    };
  }).filter((item) => item.status === 'Hoạt động')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
}

async function readPrivateCategories(activeOnly) {
  const snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu`));
  const raw = snapshotObject(snap);
  return Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return {
      code,
      name: item.ten || code,
      group: item.nhom || 'Khác',
      unit: item.donVi || 'Lượt',
      order: Number(item.thuTu || 9999),
      status: item.trangThai || 'Hoạt động',
      derivedKind: metricKindFromCategory({ code, name: item.ten || code })
    };
  }).filter((item) => !activeOnly || item.status === 'Hoạt động')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
}

async function getDashboardDataFirebase(filter) {
  const from = String(filter && filter.from || '');
  const to = String(filter && filter.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('Khoảng thời gian không hợp lệ.');
  }
  const categories = await readPublicCategories();
  const dataQuery = query(ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay`), orderByKey(), startAt(from), endAt(to));
  const transferQuery = query(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/chuyenVienTheoNgay`), orderByKey(), startAt(from), endAt(to));
  const deathQuery = query(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/tuVongTheoNgay`), orderByKey(), startAt(from), endAt(to));
  const snap = await get(dataQuery);
  const [transferRaw, deathRaw] = await Promise.all([readOptionalSnapshot(transferQuery), readOptionalSnapshot(deathQuery)]);
  const raw = snapshotObject(snap);
  const records = [];
  Object.keys(raw).sort().forEach((date) => {
    const day = raw[date] || {};
    Object.keys(day).forEach((code) => {
      const item = day[code] || {};
      records.push({ id: `${date}-${code}`, date, code, name: item.ten || code, value: Number(item.giaTri || 0), note: '', updatedAt: item.updatedAt || 0, version: Number(item.version || 0) });
    });
  });
  const merged = mergeDerivedRangeRecords(records, categories, transferRaw, deathRaw, from, to);
  return { success: true, from, to, categories, records: merged, generatedAt: formatDateTime(new Date()) };
}

async function getDailyDataFirebase(dateValue) {
  await requireAppUser();
  const date = String(dateValue || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày nhập số liệu không hợp lệ.');
  const [snap, categorySnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}`)),
    get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu`))
  ]);
  const [transferRaw, deathRaw] = await Promise.all([
    readOptionalSnapshot(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/chuyenVienTheoNgay/${date}`)),
    readOptionalSnapshot(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/tuVongTheoNgay/${date}`))
  ]);
  const raw = snapshotObject(snap);
  const categoriesRaw = snapshotObject(categorySnap);
  const categories = Object.keys(categoriesRaw).map((code) => { const item = categoriesRaw[code] || {}; return { code, name: item.ten || code, group: item.nhom || 'Khác', unit: item.donVi || 'Lượt', order: Number(item.thuTu || 9999), status: item.trangThai || 'Hoạt động' }; }).filter((item) => item.status === 'Hoạt động');
  const records = Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return { id: `${date}-${code}`, date, code, name: item.ten || code, value: Number(item.giaTri || 0), note: item.ghiChu || '', updatedBy: item.updatedByName || '', updatedAt: item.updatedAt ? formatDateTime(item.updatedAt) : '', version: Number(item.version || 0) };
  });
  return { success: true, date, records: mergeDerivedDailyRecords(records, categories, date, transferRaw, deathRaw) };
}

async function adjustDailyDataFirebase(payload) {
  const user = await requireAppUser();
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  const newValue = Number(payload.newValue);
  const expectedVersion = Number(payload.expectedVersion || 0);
  const reason = String(payload.reason || '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  if (!Number.isInteger(newValue) || newValue < 0) throw new Error('Số liệu mới phải là số nguyên không âm.');

  const categorySnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!categorySnap.exists() || categorySnap.child('trangThai').val() !== 'Hoạt động') {
    throw new Error('Chỉ tiêu không tồn tại hoặc đã ngừng sử dụng.');
  }
  const category = categorySnap.val() || {};
  const derivedKind = metricKindFromCategory({ code, name: category.ten || code });
  let autoValue = null;
  if (derivedKind) {
    const autoPath = derivedKind === 'transfer' ? 'chuyenVienTheoNgay' : 'tuVongTheoNgay';
    const autoRaw = await readOptionalSnapshot(ref(firebaseDatabase, `${PUBLIC_REPORT_STATS_ROOT}/${autoPath}/${date}`));
    autoValue = markerCount(autoRaw);
    if (reason.length < 3) throw new Error('Vui lòng nhập lý do điều chỉnh để lưu lịch sử đối chiếu.');
  }
  const recordRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${code}`);
  const currentSnap = await get(recordRef);
  const current = snapshotObject(currentSnap);
  const currentVersion = Number(current.version || 0);
  if (currentVersion !== expectedVersion) {
    throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Ứng dụng đã tự đồng bộ; vui lòng kiểm tra giá trị mới và thực hiện lại.');
  }
  const beforeValue = currentSnap.exists() ? Number(current.giaTri || 0) : (derivedKind ? Number(autoValue || 0) : 0);
  // Giá trị 0 là dữ liệu hợp lệ ở lần ghi nhận đầu tiên. Chỉ chặn thao tác
  // không làm thay đổi dữ liệu khi bản ghi thực tế đã tồn tại.
  if (currentSnap.exists() && beforeValue === newValue) throw new Error('Số liệu mới đang bằng số hiện tại.');

  const nextVersion = expectedVersion + 1;
  const action = derivedKind ? 'Điều chỉnh số liệu tự động' : (currentSnap.exists() ? 'Điều chỉnh' : 'Ghi nhận');
  const historyRef = push(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`));
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${monthKey(date)}`));
  const createdAt = current.createdAt || Date.now();
  const createdByUid = current.createdByUid || user.uid;
  const displayName = String(user.appPermission.displayName || user.displayName || user.email || '');

  const updates = {};
  updates[`${ROOT}/soLieuTheoNgay/${date}/${code}`] = {
    maChiTieu: code,
    ten: category.ten || code,
    ngay: date,
    giaTri: newValue,
    ghiChu: current.ghiChu || '',
    trangThai: 'Hoạt động',
    version: nextVersion,
    createdAt,
    createdByUid,
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByName: displayName
  };
  updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${code}`] = {
    maChiTieu: code,
    ten: category.ten || code,
    ngay: date,
    giaTri: newValue,
    version: nextVersion,
    updatedAt: serverTimestamp()
  };
  const historyRecord = {
    dataId: `${date}-${code}`,
    date,
    code,
    name: category.ten || code,
    action,
    beforeValue,
    afterValue: newValue,
    beforeNote: current.ghiChu || '',
    afterNote: current.ghiChu || '',
    reason: reason || (action === 'Ghi nhận' ? 'Ghi nhận số liệu lần đầu' : 'Cập nhật trực tiếp trên ứng dụng'),
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };
  if (derivedKind) historyRecord.autoValue = Number(autoValue || 0);
  updates[`${ROOT}/lichSu/${monthKey(date)}/${historyRef.key}`] = historyRecord;
  updates[`${ROOT}/nhatKy/${monthKey(date)}/${logRef.key}`] = {
    action: derivedKind ? 'Điều chỉnh số liệu tự động' : (action === 'Ghi nhận' ? 'Ghi nhận số liệu' : 'Điều chỉnh số liệu'),
    content: derivedKind
      ? `Ngày ${date} - ${category.ten || code}: Tự động ${beforeValue} → Chính thức ${newValue}`
      : `Ngày ${date} - ${category.ten || code}: ${currentSnap.exists() ? beforeValue : 'Chưa ghi nhận'} → ${newValue}`,
    dataDate: date,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };

  try {
    await update(ref(firebaseDatabase), updates);
  } catch (error) {
    const latestSnap = await get(recordRef).catch(() => null);
    const latestVersion = latestSnap && latestSnap.exists() ? Number(latestSnap.child('version').val() || 0) : 0;
    if (latestVersion !== expectedVersion) {
      throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Ứng dụng đã tự đồng bộ; vui lòng kiểm tra giá trị mới và thực hiện lại.');
    }
    throw error;
  }

  return {
    success: true,
    record: {
      id: `${date}-${code}`,
      date,
      code,
      name: category.ten || code,
      value: newValue,
      note: current.ghiChu || '',
      updatedBy: displayName,
      updatedAt: formatDateTime(new Date()),
      version: nextVersion,
      autoDerived: !!derivedKind,
      derivedKind: derivedKind || '',
      autoValue: derivedKind ? Number(autoValue || 0) : undefined,
      manualOverride: !!derivedKind
    },
    message: derivedKind ? 'Đã lưu số liệu điều chỉnh và ghi lịch sử.' : (action === 'Ghi nhận' ? 'Đã ghi nhận số liệu.' : 'Đã lưu thay đổi.')
  };
}

async function deleteDailyDataFirebase(payload) {
  const user = await requireAppUser('admin');
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  const expectedVersion = Number(payload.expectedVersion || 0);
  const reason = String(payload.reason || '').trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  if (reason.length < 3) throw new Error('Vui lòng nhập lý do xóa để lưu lịch sử truy vết.');

  const categorySnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!categorySnap.exists()) throw new Error('Chỉ tiêu không tồn tại.');
  const category = categorySnap.val() || {};
  const derivedKind = metricKindFromCategory({ code, name: category.ten || code });
  if (derivedKind) {
    throw new Error('Không thể xóa số liệu Chuyển viện/Tử vong tự động tại màn hình Nhập liệu. Hãy xử lý tại nghiệp vụ nguồn hoặc dùng chức năng điều chỉnh có lý do.');
  }

  const recordRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${code}`);
  const currentSnap = await get(recordRef);
  if (!currentSnap.exists()) throw new Error('Số liệu này không còn tồn tại. Ứng dụng sẽ tải lại dữ liệu mới nhất.');
  const current = currentSnap.val() || {};
  const currentVersion = Number(current.version || 0);
  if (currentVersion !== expectedVersion) {
    throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Vui lòng tải lại và kiểm tra trước khi xóa.');
  }

  const beforeValue = Number(current.giaTri || 0);
  const displayName = String(user.appPermission.displayName || user.displayName || user.email || '');
  const historyRef = push(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`));
  const logRef = push(ref(firebaseDatabase, `${ROOT}/nhatKy/${monthKey(date)}`));
  const updates = {};

  // Xóa record hiện hành và public mirror, nhưng giữ lịch sử/audit bất biến.
  updates[`${ROOT}/soLieuTheoNgay/${date}/${code}`] = null;
  updates[`${ROOT}/congKhai/soLieuTheoNgay/${date}/${code}`] = null;
  updates[`${ROOT}/lichSu/${monthKey(date)}/${historyRef.key}`] = {
    dataId: `${date}-${code}`,
    date,
    code,
    name: category.ten || code,
    action: 'Xóa số liệu',
    beforeValue,
    // Rules hiện hành của tongHopYTe/lichSu yêu cầu afterValue là number.
    // Với thao tác xóa, action là nguồn sự thật; 0 chỉ là giá trị audit tương thích Rules.
    // Khi đọc lịch sử, UI chuyển action 'Xóa số liệu' về trạng thái 'Đã xóa'.
    afterValue: 0,
    beforeNote: current.ghiChu || '',
    afterNote: '',
    reason,
    deletedVersion: currentVersion,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };
  updates[`${ROOT}/nhatKy/${monthKey(date)}/${logRef.key}`] = {
    action: 'Xóa số liệu',
    content: `Ngày ${date} - ${category.ten || code}: đã xóa giá trị ${beforeValue}. Lý do: ${reason}`,
    dataDate: date,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName,
    role: user.appRole,
    createdAt: serverTimestamp()
  };

  try {
    await update(ref(firebaseDatabase), updates);
  } catch (error) {
    const latestSnap = await get(recordRef).catch(() => null);
    const latestVersion = latestSnap && latestSnap.exists() ? Number(latestSnap.child('version').val() || 0) : 0;
    if (latestVersion !== expectedVersion) {
      throw new Error('Số liệu vừa được cập nhật từ thiết bị khác. Vui lòng tải lại và kiểm tra trước khi xóa.');
    }
    throw error;
  }

  return { success: true, deleted: true, date, code, beforeValue, message: 'Đã xóa số liệu và lưu đầy đủ lịch sử truy vết.' };
}

async function getDailyDataHistoryFirebase(payload) {
  await requireAppUser();
  payload = payload || {};
  const date = String(payload.date || '');
  const code = normalizeCategoryCode(payload.code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày số liệu không hợp lệ.');
  if (!code) throw new Error('Mã chỉ tiêu không hợp lệ.');
  const [snap, namesSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/lichSu/${monthKey(date)}`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null)
  ]);
  const raw = snapshotObject(snap);
  const displayNames = snapshotObject(namesSnap);
  const items = Object.keys(raw).map((id) => ({ id, ...(raw[id] || {}) }))
    .filter((item) => item.date === date && normalizeCategoryCode(item.code) === code)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .map((item) => ({
      id: item.id,
      action: String(item.action || ''),
      beforeValue: Number(item.beforeValue || 0),
      afterValue: String(item.action || '') === 'Xóa số liệu' ? null : (item.afterValue == null ? null : Number(item.afterValue || 0)),
      reason: String(item.reason || ''),
      displayName: String((displayNames[item.uid] && displayNames[item.uid].displayName) || item.displayName || item.email || ''),
      email: normalizeEmail(item.email),
      role: String(item.role || ''),
      autoValue: item.autoValue == null ? null : Number(item.autoValue || 0),
      createdAt: Number(item.createdAt || 0),
      createdAtText: item.createdAt ? formatDateTime(item.createdAt) : ''
    }));
  return { success: true, date, code, items };
}

async function loginGoogleFirebase() {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  return resolveApplicationAccess(credential.user);
}

async function restoreSessionFirebase() {
  await authReady;
  return resolveApplicationAccess(firebaseAuth.currentUser);
}

async function logoutFirebase() {
  await signOut(firebaseAuth);
  return { success: true, message: 'Đã đăng xuất.' };
}

async function getAdminCategoriesFirebase() {
  await requireAppUser('admin');
  return { success: true, categories: await readPrivateCategories(false) };
}

async function adminSaveCategoryFirebase(payload) {
  const user = await requireAppUser('admin');
  payload = payload || {};
  const originalCode = normalizeCategoryCode(payload.originalCode);
  const requestedCode = normalizeCategoryCode(payload.code);
  const name = String(payload.name || '').trim();
  const group = String(payload.group || 'Khác').trim();
  const unit = String(payload.unit || 'Lượt').trim();
  const order = Number(payload.order);
  const status = payload.status === 'Ngừng hoạt động' ? 'Ngừng hoạt động' : 'Hoạt động';
  if (name.length < 2 || name.length > 150) throw new Error('Tên chỉ tiêu phải có từ 2 đến 150 ký tự.');
  if (!group || group.length > 100) throw new Error('Nhóm chỉ tiêu không hợp lệ.');
  if (!unit || unit.length > 50) throw new Error('Đơn vị tính không hợp lệ.');
  if (!Number.isInteger(order) || order < 1 || order > 9999) throw new Error('Thứ tự hiển thị phải là số nguyên từ 1 đến 9999.');

  const all = await readPrivateCategories(false);
  if (all.some((item) => item.name.toLocaleLowerCase('vi-VN') === name.toLocaleLowerCase('vi-VN') && item.code !== originalCode)) {
    throw new Error('Tên chỉ tiêu này đã tồn tại.');
  }
  let code = originalCode;
  if (!code) {
    code = requestedCode || normalizeCategoryCode(name);
    if (!code) throw new Error('Không thể tạo mã chỉ tiêu từ tên đã nhập.');
    const existing = new Set(all.map((item) => item.code));
    const base = code;
    let suffix = 2;
    while (existing.has(code)) code = `${base}_${suffix++}`;
  }
  const now = Date.now();
  const oldSnap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  const old = snapshotObject(oldSnap);
  const item = {
    ma: code,
    ten: name,
    nhom: group,
    donVi: unit,
    thuTu: order,
    trangThai: status,
    createdAt: old.createdAt || now,
    updatedAt: now,
    updatedByUid: user.uid
  };
  const safePublic = {
    ma: code, ten: name, nhom: group, donVi: unit, thuTu: order, trangThai: status, updatedAt: now
  };
  const updates = {};
  updates[`${ROOT}/danhMucChiTieu/${code}`] = item;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}`] = safePublic;
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(user, oldSnap.exists() ? 'Sửa chỉ tiêu' : 'Thêm chỉ tiêu', `${code} - ${name} - ${status}`, '');
  return {
    success: true,
    category: { code, name, group, unit, order, status },
    message: oldSnap.exists() ? 'Đã cập nhật chỉ tiêu.' : 'Đã thêm chỉ tiêu mới.'
  };
}

async function adminSetCategoryStatusFirebase(codeValue, statusValue) {
  const user = await requireAppUser('admin');
  const code = normalizeCategoryCode(codeValue);
  const status = statusValue === 'Hoạt động' ? 'Hoạt động' : 'Ngừng hoạt động';
  const snap = await get(ref(firebaseDatabase, `${ROOT}/danhMucChiTieu/${code}`));
  if (!snap.exists()) throw new Error('Không tìm thấy chỉ tiêu.');
  const item = snap.val() || {};
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/danhMucChiTieu/${code}/trangThai`] = status;
  updates[`${ROOT}/danhMucChiTieu/${code}/updatedAt`] = now;
  updates[`${ROOT}/danhMucChiTieu/${code}/updatedByUid`] = user.uid;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}/trangThai`] = status;
  updates[`${ROOT}/congKhai/danhMucChiTieu/${code}/updatedAt`] = now;
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(user, status === 'Hoạt động' ? 'Khôi phục chỉ tiêu' : 'Ngừng sử dụng chỉ tiêu', `${code} - ${item.ten || code}`, '');
  return { success: true, message: status === 'Hoạt động' ? 'Đã khôi phục chỉ tiêu.' : 'Đã ngừng sử dụng chỉ tiêu.' };
}

async function getAdminUsersFirebase() {
  await requireAppUser('admin');
  const [permissionSnap, requestSnap, directorySnap, displayNameSnap, deletedSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/cauHinh/taiKhoanDaXoa`)).catch(() => null)
  ]);
  const customNames = snapshotObject(displayNameSnap);
  const permissions = snapshotObject(permissionSnap);
  const requests = snapshotObject(requestSnap);
  const directory = snapshotObject(directorySnap);
  const deletedUsers = snapshotObject(deletedSnap);
  const allUids = new Set([
    ...Object.keys(directory),
    ...Object.keys(permissions),
    ...Object.keys(requests)
  ]);
  const users = [];
  allUids.forEach((uid) => {
    // yTeApp/nguoiDung là hồ sơ dùng chung của Phòng Y tế và Rules chỉ cho chính
    // chủ tài khoản ghi. Khi admin xóa khỏi ứng dụng, ta giữ hồ sơ này cho audit
    // nhưng ẩn tài khoản directory-only bằng tombstone trong tongHopYTe/cauHinh.
    if (deletedUsers[uid] && !permissions[uid] && !requests[uid]) return;
    const item = permissions[uid] || {};
    const request = requests[uid] || {};
    const profile = directory[uid] || {};
    const hasPermission = !!permissions[uid];
    const requestStatus = request.status || (hasPermission ? 'approved' : 'unassigned');
    users.push({
      id: uid,
      uid,
      name: (customNames[uid] && customNames[uid].displayName) || item.displayName || request.displayName || profile.displayName || item.email || request.email || profile.email || '',
      username: item.username || request.username || '',
      email: item.email || request.email || profile.email || '',
      role: hasPermission ? uiRole(item.role) : '',
      status: hasPermission ? uiStatus(item.active) : 'Chưa cấp',
      isPending: !hasPermission,
      requestStatus,
      requestedAt: request.requestedAt ? formatDateTime(request.requestedAt) : (profile.createdAt ? formatDateTime(profile.createdAt) : ''),
      lastLogin: item.lastLoginAt ? formatDateTime(item.lastLoginAt) : (profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : '')
    });
  });
  users.sort((a, b) => (a.isPending === b.isPending ? String(a.name).localeCompare(String(b.name), 'vi') : a.isPending ? -1 : 1));
  return { success: true, users };
}

async function adminApproveRegistrationFirebase(uid, roleValue) {
  const admin = await requireAppUser('admin');
  const role = dbRole(roleValue);
  const [requestSnap, profileSnap, oldPermSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)),
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`))
  ]);
  const request = snapshotObject(requestSnap);
  const profile = snapshotObject(profileSnap);
  const oldPerm = snapshotObject(oldPermSnap);
  const email = normalizeEmail(request.email || profile.email || oldPerm.email);
  if (!email) throw new Error('Không tìm thấy thông tin tài khoản đã đăng nhập Google.');
  const displayName = String(request.displayName || profile.displayName || oldPerm.displayName || email).slice(0, 150);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/cauHinh/taiKhoanDaXoa/${uid}`] = null;
  updates[`${ROOT}/phanQuyen/${uid}`] = {
    email,
    displayName,
    username: normalizeUsername(request.username || oldPerm.username || String(email).split('@')[0]),
    role,
    active: true,
    legacyUserId: oldPerm.legacyUserId || '',
    source: oldPerm.source || 'APPROVED_IN_APP',
    createdAt: oldPerm.createdAt || now,
    updatedAt: now,
    approvedAt: now,
    approvedByUid: admin.uid
  };
  // Quyền Xem là quyền theo dõi toàn ứng dụng: Tổng quan + Báo cáo + Lịch sử.
  // Đồng bộ sang phân hệ Báo cáo để người xem không cần một bước cấp quyền thứ hai.
  if (role === 'viewer') {
    const oldReportSnap = await get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null);
    const oldReport = snapshotObject(oldReportSnap);
    updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
      email,
      displayName,
      role: 'viewer',
      active: true,
      source: oldReport.source || 'APP_VIEWER_SYNC',
      createdAt: oldReport.createdAt || now,
      updatedAt: now,
      updatedByUid: admin.uid
    };
  }
  if (requestSnap.exists()) {
    updates[`${ROOT}/yeuCauDangKy/${uid}/status`] = 'approved';
    updates[`${ROOT}/yeuCauDangKy/${uid}/reviewedAt`] = now;
    updates[`${ROOT}/yeuCauDangKy/${uid}/reviewedByUid`] = admin.uid;
  }
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(admin, 'Cấp quyền tài khoản', `${email} → ${uiRole(role)}`, '');
  return { success: true, message: `Đã cấp quyền ${uiRole(role)} cho tài khoản.` };
}

async function adminRejectRegistrationFirebase(uid) {
  const admin = await requireAppUser('admin');
  const requestRef = ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`);
  const snap = await get(requestRef);
  if (!snap.exists()) throw new Error('Không tìm thấy yêu cầu đăng ký.');
  await update(requestRef, {
    status: 'rejected',
    reviewedAt: Date.now(),
    reviewedByUid: admin.uid
  });
  const item = snap.val() || {};
  await writeAuditLog(admin, 'Từ chối cấp quyền', item.email || uid, '');
  return { success: true, message: 'Đã từ chối yêu cầu cấp quyền.' };
}

async function adminSetUserStatusFirebase(uid, statusValue) {
  const admin = await requireAppUser('admin');
  if (uid === admin.uid) throw new Error('Bạn không thể tự khóa quyền Tổng hợp Y tế của tài khoản đang sử dụng.');
  const active = statusValue === 'Hoạt động';
  const permissionRef = ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`);
  const snap = await get(permissionRef);
  if (!snap.exists()) throw new Error('Không tìm thấy quyền tài khoản.');
  await update(permissionRef, active
    ? { active: true, revoked: false, revokedAt: null, revokedByUid: null, updatedAt: Date.now(), updatedByUid: admin.uid }
    : { active: false, updatedAt: Date.now(), updatedByUid: admin.uid });
  const item = snap.val() || {};
  await writeAuditLog(admin, active ? 'Mở khóa tài khoản' : 'Khóa tài khoản', item.email || uid, '');
  return { success: true, message: active ? 'Đã mở quyền sử dụng Tổng hợp Y tế.' : 'Đã khóa quyền Tổng hợp số liệu.' };
}

async function adminSetUserRoleFirebase(uid, roleValue) {
  const admin = await requireAppUser('admin');
  const role = dbRole(roleValue);
  if (uid === admin.uid && role !== 'admin') throw new Error('Bạn không thể tự hạ quyền tài khoản Quản trị đang sử dụng.');
  const permissionRef = ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`);
  const [snap, profileSnap, reportSnap] = await Promise.all([
    get(permissionRef),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null)
  ]);
  if (!snap.exists()) throw new Error('Không tìm thấy quyền tài khoản.');
  const item = snap.val() || {};
  const profile = snapshotObject(profileSnap);
  const report = snapshotObject(reportSnap);
  const now = Date.now();
  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}/role`] = role;
  updates[`${ROOT}/phanQuyen/${uid}/active`] = true;
  updates[`${ROOT}/phanQuyen/${uid}/updatedAt`] = now;
  updates[`${ROOT}/phanQuyen/${uid}/updatedByUid`] = admin.uid;
  if (role === 'viewer') {
    const email = normalizeEmail(item.email || profile.email || report.email);
    const displayName = String(item.displayName || profile.displayName || report.displayName || email || uid).slice(0, 150);
    updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = {
      email,
      displayName,
      role: 'viewer',
      active: true,
      source: report.source || 'APP_VIEWER_SYNC',
      createdAt: report.createdAt || now,
      updatedAt: now,
      updatedByUid: admin.uid
    };
  } else if (report.source === 'APP_VIEWER_SYNC') {
    updates[`${REPORT_ROOT}/phanQuyen/${uid}/role`] = role;
    updates[`${REPORT_ROOT}/phanQuyen/${uid}/active`] = true;
    updates[`${REPORT_ROOT}/phanQuyen/${uid}/updatedAt`] = now;
    updates[`${REPORT_ROOT}/phanQuyen/${uid}/updatedByUid`] = admin.uid;
  }
  await update(ref(firebaseDatabase), updates);
  await writeAuditLog(admin, 'Thay đổi vai trò', `${item.email || uid} → ${uiRole(role)}`, '');
  return { success: true, message: `Đã cập nhật vai trò ${uiRole(role)}.` };
}

async function adminRevokeUserFirebase(uid) {
  const admin = await requireAppUser('admin');
  if (uid === admin.uid) throw new Error('Bạn không thể tự thu hồi quyền tài khoản đang sử dụng.');
  const permissionRef = ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`);
  const snap = await get(permissionRef);
  if (!snap.exists()) throw new Error('Không tìm thấy quyền tài khoản.');
  const item = snap.val() || {};
  await update(permissionRef, {
    active: false,
    revoked: true,
    revokedAt: Date.now(),
    revokedByUid: admin.uid,
    updatedAt: Date.now()
  });
  await writeAuditLog(admin, 'Thu hồi quyền Tổng hợp số liệu', item.email || uid, '');
  return { success: true, message: 'Đã thu hồi quyền Tổng hợp Y tế. Tài khoản đăng nhập và quyền HSBA (nếu có) được giữ nguyên.' };
}

async function adminDeleteUserFromAppFirebase(uid) {
  const admin = await requireAppUser('admin');
  if (!uid) throw new Error('Thiếu thông tin tài khoản cần xóa.');
  if (uid === admin.uid) throw new Error('Bạn không thể tự xóa tài khoản Quản trị đang sử dụng.');

  const [permissionSnap, requestSnap, reportPermissionSnap, allPermissionsSnap, profileSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${uid}`)),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)).catch(() => null)
  ]);

  const permission = snapshotObject(permissionSnap);
  const request = snapshotObject(requestSnap);
  const reportPermission = snapshotObject(reportPermissionSnap);
  const profile = snapshotObject(profileSnap);
  const hasAnyAppRecord = permissionSnap.exists() || requestSnap.exists() || (reportPermissionSnap && reportPermissionSnap.exists()) || (profileSnap && profileSnap.exists());
  if (!hasAnyAppRecord) throw new Error('Tài khoản không còn quyền hoặc yêu cầu đăng ký trong Ứng dụng Phòng Y tế.');

  if (permissionSnap.exists() && permission.role === 'admin') {
    const allPermissions = snapshotObject(allPermissionsSnap);
    const remainingActiveAdmins = Object.keys(allPermissions).filter((key) => {
      if (key === uid) return false;
      const item = allPermissions[key] || {};
      return item.active === true && item.role === 'admin';
    });
    if (!remainingActiveAdmins.length && !ownerUser(admin)) {
      throw new Error('Không thể xóa quản trị viên cuối cùng của Tổng hợp Y tế.');
    }
  }

  const email = normalizeEmail(permission.email || request.email || reportPermission.email || profile.email || '');
  if (email === OWNER_EMAIL && !ownerUser(admin)) {
    throw new Error('Không thể xóa tài khoản quản trị hệ thống.');
  }
  const displayName = String(permission.displayName || request.displayName || reportPermission.displayName || profile.displayName || email || uid).slice(0, 150);

  // Ghi audit trước khi gỡ quyền; không xóa lịch sử nghiệp vụ của tài khoản đích.
  await writeAuditLog(admin, 'Xóa tài khoản khỏi ứng dụng', `${displayName}${email ? ` (${email})` : ''}`, '');

  const updates = {};
  updates[`${ROOT}/phanQuyen/${uid}`] = null;
  updates[`${ROOT}/yeuCauDangKy/${uid}`] = null;
  updates[`${REPORT_ROOT}/phanQuyen/${uid}`] = null;
  updates[`${ROOT}/cauHinh/taiKhoanDaXoa/${uid}`] = {
    deletedAt: Date.now(),
    deletedByUid: admin.uid
  };
  // Cố ý giữ yTeApp/nguoiDung, yTeApp/tenHienThi và toàn bộ audit/history để
  // lịch sử vẫn đọc đúng danh tính và không ảnh hưởng phân hệ Y tế/HSBA khác.
  await update(ref(firebaseDatabase), updates);

  return {
    success: true,
    message: 'Đã xóa tài khoản khỏi Ứng dụng Phòng Y tế. Firebase Authentication và lịch sử nghiệp vụ được giữ nguyên.'
  };
}


async function requireReportPermissionManager() {
  await authReady;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Vui lòng đăng nhập.');
  if (ownerUser(user)) return { user, tongHopAdmin: true, reportAdmin: true, owner: true };
  const [tongHopSnap, reportSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen/${user.uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${user.uid}`))
  ]);
  const tongHop = snapshotObject(tongHopSnap);
  const report = snapshotObject(reportSnap);
  const tongHopAdmin = tongHop.active === true && tongHop.role === 'admin';
  const reportAdmin = report.active === true && report.role === 'admin';
  if (!tongHopAdmin && !reportAdmin) throw new Error('Bạn không có quyền quản trị tài khoản Báo cáo.');
  return { user, tongHopAdmin, reportAdmin, owner: false };
}

async function getAdminReportUsersFirebase() {
  await requireReportPermissionManager();
  const [directorySnap, permissionSnap, displayNameSnap, deletedSnap, requestSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/cauHinh/taiKhoanDaXoa`)).catch(() => null),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy`)).catch(() => null)
  ]);
  const directory = snapshotObject(directorySnap);
  const permissions = snapshotObject(permissionSnap);
  const customNames = snapshotObject(displayNameSnap);
  const deletedUsers = snapshotObject(deletedSnap);
  const requests = snapshotObject(requestSnap);
  const uids = new Set([...Object.keys(directory), ...Object.keys(permissions)]);
  const users = Array.from(uids).filter((uid) => {
    // Xóa khỏi ứng dụng phải đồng nhất ở cả màn hình Tài khoản Tổng hợp và Quyền Báo cáo.
    // Nếu người dùng đăng nhập lại và phát sinh một yêu cầu pending mới, họ được xem là
    // đăng ký lại và có thể xuất hiện để admin xét duyệt/cấp quyền lại.
    if (!deletedUsers[uid] || permissions[uid]) return true;
    return !!(requests[uid] && requests[uid].status === 'pending');
  }).map((uid) => {
    const profile = directory[uid] || {};
    const permission = permissions[uid] || {};
    return {
      id: uid,
      uid,
      name: (customNames[uid] && customNames[uid].displayName) || permission.displayName || profile.displayName || permission.email || profile.email || '',
      email: normalizeEmail(permission.email || profile.email || ''),
      role: permission.role || '',
      roleLabel: uiReportRole(permission.role),
      active: permission.active === true,
      status: permission.active === true ? 'Hoạt động' : 'Chưa cấp',
      lastLoginAt: Number(profile.lastLoginAt || 0),
      lastLogin: profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : ''
    };
  }).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'vi'));
  return { success: true, users };
}

async function adminSetReportPermissionFirebase(uid, roleValue, activeValue) {
  const manager = await requireReportPermissionManager();
  const user = manager.user;
  const role = dbReportRole(roleValue);
  const active = activeValue === true || activeValue === 'true' || activeValue === 'Hoạt động';
  if (uid === user.uid && manager.reportAdmin && !manager.tongHopAdmin && !manager.owner && (!active || role !== 'admin')) {
    throw new Error('Bạn không thể tự thu hồi hoặc hạ quyền Quản trị Báo cáo đang sử dụng.');
  }
  const [profileSnap, oldPermSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung/${uid}`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`))
  ]);
  const profile = snapshotObject(profileSnap);
  const oldPerm = snapshotObject(oldPermSnap);
  const email = normalizeEmail(profile.email || oldPerm.email);
  if (!email) throw new Error('Tài khoản chưa đăng nhập Google nên chưa có thông tin để cấp quyền.');
  const now = Date.now();
  await set(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen/${uid}`), {
    email,
    displayName: String(profile.displayName || oldPerm.displayName || email).slice(0, 150),
    role,
    active,
    source: oldPerm.source || 'APP_ADMIN',
    createdAt: oldPerm.createdAt || now,
    updatedAt: now,
    updatedByUid: user.uid
  });
  return {
    success: true,
    message: active ? `Đã cấp quyền ${uiReportRole(role)} cho phân hệ Báo cáo.` : 'Đã thu hồi quyền Báo cáo.'
  };
}

async function adminSetDisplayNameFirebase(uid, displayNameValue) {
  const manager = await requireReportPermissionManager();
  const displayName = formatPersonName(displayNameValue);
  if (!uid) throw new Error('Không xác định được tài khoản.');
  if (displayName.length < 2 || displayName.length > 150) throw new Error('Tên hiển thị phải từ 2 đến 150 ký tự.');
  await set(ref(firebaseDatabase, `${YTE_APP_ROOT}/tenHienThi/${uid}`), {
    displayName,
    updatedAt: Date.now(),
    updatedByUid: manager.user.uid
  });
  return { success: true, displayName, message: 'Đã lưu tên hiển thị dùng chung trong Ứng dụng Phòng Y tế.' };
}

async function firebaseCall(name, ...args) {
  await authPersistenceReady;
  await authReady;
  switch (name) {
    case 'getDashboardData': return getDashboardDataFirebase(args[0]);
    case 'restoreSession': return restoreSessionFirebase();
    case 'googleLoginAccount': return loginGoogleFirebase();
    case 'logoutSession': return logoutFirebase();
    case 'getDailyData': return getDailyDataFirebase(args[0]);
    case 'adjustDailyData': return adjustDailyDataFirebase(args[0]);
    case 'deleteDailyData': return deleteDailyDataFirebase(args[0]);
    case 'getDailyDataHistory': return getDailyDataHistoryFirebase(args[0]);
    case 'getAdminUsers': return getAdminUsersFirebase();
    case 'getAdminCategories': return getAdminCategoriesFirebase();
    case 'adminSaveCategory': return adminSaveCategoryFirebase(args[1] || args[0]);
    case 'adminSetCategoryStatus': return adminSetCategoryStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserStatus': return adminSetUserStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserRole': return adminSetUserRoleFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminApproveRegistration': return adminApproveRegistrationFirebase(args[0], args[1]);
    case 'adminRejectRegistration': return adminRejectRegistrationFirebase(args[0]);
    case 'adminRevokeUser': return adminRevokeUserFirebase(args[1] || args[0]);
    case 'adminDeleteUser': return adminDeleteUserFromAppFirebase(args[1] || args[0]);
    case 'getAdminReportUsers': return getAdminReportUsersFirebase();
    case 'adminSetReportPermission': return adminSetReportPermissionFirebase(args[0], args[1], args[2]);
    case 'adminSetDisplayName': return adminSetDisplayNameFirebase(args[0], args[1]);
    default: throw new Error(`Chức năng không hợp lệ: ${name}`);
  }
}


var AUTO_SYNC_MS = 300000;
    var SILENT_SYNC_MIN_AGE_MS = 45000;
    var ENTRY_CACHE_MS = 120000;
    var ADMIN_CACHE_MS = 60000;

    var state = {
      categories:[],records:[],from:'',to:'',
      token:'FIREBASE_AUTH',user:null,authUser:null,reportPermission:null,
      syncTimer:null,syncPromise:null,lastSyncAt:0,busyCount:0,
      dailyByCode:{},loadedEntryDate:'',entryRequestId:0,
      entryCache:{},entryLoads:{},
      adminUsers:[],adminLoadedAt:0,adminPromise:null,
      adminCategories:[],categoryLoadedAt:0,categoryPromise:null,adminSection:'users',
      adminReportUsers:[],adminReportLoadedAt:0,adminReportPromise:null,
      editingCategoryCode:'',categorySaving:false,
      adjustingCode:'',adjustSaving:false,quickEntrySaving:false,quickEntryBaseline:'',deleteDailyCode:'',deleteDailySaving:false,
      historyCode:'',historyLoading:false,displayNameEditUid:'',
      dashboardLiveUnsubscribe:null,dashboardTransferStatsUnsubscribe:null,dashboardDeathStatsUnsubscribe:null,categoryLiveUnsubscribe:null,entryLiveUnsubscribe:null,entryTransferStatsUnsubscribe:null,entryDeathStatsUnsubscribe:null,
      dashboardBaseRecords:[],dashboardTransferStats:{},dashboardDeathStats:{},entryBaseRecords:[],entryTransferStats:{},entryDeathStats:{},
      liveRangeKey:'',entryLiveDate:''
    };
    var entryComposerReturnFocus=null;

    function $(id){return document.getElementById(id)}
    function publicCategoriesFromSnapshot(snap){
      var raw=snapshotObject(snap);
      return Object.keys(raw).map(function(code){var item=raw[code]||{},category={code:code,name:item.ten||code,group:item.nhom||'Khác',unit:item.donVi||'Lượt',order:Number(item.thuTu||9999),status:item.trangThai||'Hoạt động'};category.derivedKind=metricKindFromCategory(category);return category}).filter(function(item){return item.status==='Hoạt động'}).sort(function(a,b){return a.order-b.order||a.name.localeCompare(b.name,'vi')});
    }
    function dashboardRecordsFromSnapshot(snap){
      var raw=snapshotObject(snap),records=[];
      Object.keys(raw).sort().forEach(function(date){var day=raw[date]||{};Object.keys(day).forEach(function(code){var item=day[code]||{};records.push({id:date+'-'+code,date:date,code:code,name:item.ten||code,value:Number(item.giaTri||0),note:'',updatedAt:item.updatedAt||0,version:Number(item.version||0)})})});
      return records;
    }
    function dailyRecordsFromSnapshot(snap,date){
      var raw=snapshotObject(snap);
      return Object.keys(raw).map(function(code){var item=raw[code]||{};return{id:date+'-'+code,date:date,code:code,name:item.ten||code,value:Number(item.giaTri||0),note:item.ghiChu||'',updatedBy:item.updatedByName||'',updatedAt:item.updatedAt?formatDateTime(item.updatedAt):'',version:Number(item.version||0)}});
    }
    function composeDashboardRecords(){
      state.records=mergeDerivedRangeRecords(state.dashboardBaseRecords,state.categories,state.dashboardTransferStats,state.dashboardDeathStats,state.from,state.to);
    }
    function composeEntryRecords(date){
      return mergeDerivedDailyRecords(state.entryBaseRecords,state.categories,date,state.entryTransferStats,state.entryDeathStats);
    }
    function stopDashboardRealtime(){
      [state.dashboardLiveUnsubscribe,state.dashboardTransferStatsUnsubscribe,state.dashboardDeathStatsUnsubscribe].forEach(function(fn){if(typeof fn==='function')fn()});
      state.dashboardLiveUnsubscribe=null;state.dashboardTransferStatsUnsubscribe=null;state.dashboardDeathStatsUnsubscribe=null;state.liveRangeKey='';
    }
    function stopEntryRealtime(){
      [state.entryLiveUnsubscribe,state.entryTransferStatsUnsubscribe,state.entryDeathStatsUnsubscribe].forEach(function(fn){if(typeof fn==='function')fn()});
      state.entryLiveUnsubscribe=null;state.entryTransferStatsUnsubscribe=null;state.entryDeathStatsUnsubscribe=null;state.entryLiveDate='';
    }
    function startCategoryRealtime(){
      if(state.categoryLiveUnsubscribe)return;
      state.categoryLiveUnsubscribe=onValue(ref(firebaseDatabase,ROOT+'/congKhai/danhMucChiTieu'),function(snap){
        state.categories=publicCategoriesFromSnapshot(snap);populateContentFilter();composeDashboardRecords();renderAll();if(currentViewName()==='entry'){var date=$('entryDate').value;if(date&&state.entryLiveDate===date){var merged=composeEntryRecords(date);cacheDaily(date,merged);applyDailyCache(date)}renderIndicators()}
      },function(error){console.warn('Realtime danh mục:',error)});
    }
    function startDashboardRealtime(force){
      var range;try{range=getRange()}catch(error){return}
      var key=range.from+'|'+range.to;
      if(!force&&state.dashboardLiveUnsubscribe&&state.dashboardTransferStatsUnsubscribe&&state.dashboardDeathStatsUnsubscribe&&state.liveRangeKey===key)return;
      stopDashboardRealtime();state.liveRangeKey=key;state.from=range.from;state.to=range.to;
      var liveQuery=query(ref(firebaseDatabase,ROOT+'/congKhai/soLieuTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      var transferQuery=query(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/chuyenVienTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      var deathQuery=query(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/tuVongTheoNgay'),orderByKey(),startAt(range.from),endAt(range.to));
      function refresh(){composeDashboardRecords();state.lastSyncAt=Date.now();$('rangeLabel').textContent=range.label;renderAll()}
      state.dashboardLiveUnsubscribe=onValue(liveQuery,function(snap){state.dashboardBaseRecords=dashboardRecordsFromSnapshot(snap);refresh()},function(error){console.warn('Realtime tổng quan:',error)});
      state.dashboardTransferStatsUnsubscribe=onValue(transferQuery,function(snap){state.dashboardTransferStats=snapshotObject(snap);refresh()},function(error){console.warn('Realtime chuyển viện tự động:',error)});
      state.dashboardDeathStatsUnsubscribe=onValue(deathQuery,function(snap){state.dashboardDeathStats=snapshotObject(snap);refresh()},function(error){console.warn('Realtime tử vong tự động:',error)});
    }
    function startEntryRealtime(date){
      date=String(date||'');if(!state.user||!/^\d{4}-\d{2}-\d{2}$/.test(date)){stopEntryRealtime();return}
      if(state.entryLiveUnsubscribe&&state.entryTransferStatsUnsubscribe&&state.entryDeathStatsUnsubscribe&&state.entryLiveDate===date)return;
      stopEntryRealtime();state.entryLiveDate=date;
      function refreshEntry(){var records=composeEntryRecords(date);cacheDaily(date,records);if($('entryDate').value===date){applyDailyCache(date);setEntryLoadState('','ok',false)}}
      state.entryLiveUnsubscribe=onValue(ref(firebaseDatabase,ROOT+'/soLieuTheoNgay/'+date),function(snap){state.entryBaseRecords=dailyRecordsFromSnapshot(snap,date);refreshEntry()},function(error){console.warn('Realtime nhập liệu:',error);if(currentViewName()==='entry')setEntryLoadState('Mất kết nối đồng bộ trực tiếp. Ứng dụng sẽ tự kết nối lại khi mạng ổn định.','err',false)});
      state.entryTransferStatsUnsubscribe=onValue(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/chuyenVienTheoNgay/'+date),function(snap){state.entryTransferStats=snapshotObject(snap);refreshEntry()},function(error){console.warn('Realtime chuyển viện ngày:',error)});
      state.entryDeathStatsUnsubscribe=onValue(ref(firebaseDatabase,PUBLIC_REPORT_STATS_ROOT+'/tuVongTheoNgay/'+date),function(snap){state.entryDeathStats=snapshotObject(snap);refreshEntry()},function(error){console.warn('Realtime tử vong ngày:',error)});
    }
    function call(name){
      var args=Array.prototype.slice.call(arguments,1);
      return firebaseCall.apply(null,[name].concat(args)).catch(function(error){
        var messageText=error&&error.message?error.message:String(error||'Có lỗi xảy ra.');
        if(/auth\/invalid-credential|auth\/invalid-login-credentials|auth\/wrong-password|auth\/user-not-found/.test(String(error&&error.code||'')+' '+messageText))messageText='Email hoặc mật khẩu không đúng.';
        if(/auth\/email-already-in-use/.test(String(error&&error.code||'')))messageText='Email này đã được đăng ký.';
        if(/PERMISSION_DENIED|permission_denied/i.test(messageText))messageText='Bạn không có quyền thực hiện thao tác này hoặc dữ liệu vừa thay đổi ở thiết bị khác. Ứng dụng sẽ tự đồng bộ dữ liệu mới nhất.';
        throw new Error(messageText);
      });
    }
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
    function uiIcon(name){
      var icons={
        edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
        history:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/>',
        plus:'<path d="M12 5v14M5 12h14"/>',
        dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        check:'<path d="m5 12 4 4L19 6"/>'
      };
      return '<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]||'')+'</svg>';
    }
    function uiMetricIcon(category){
      var kind=metricKindFromCategory(category),text=normalizeMetricText((category&&category.name||'')+' '+(category&&category.group||'')),body='';
      if(kind==='transfer')body='<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>';
      else if(kind==='death')body='<path d="M3 12h4l2-5 4 10 2-5h6"/>';
      else if(/noi tru|kham|benh|y te|suc khoe/.test(text))body='<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"/><path d="M9 12h2l1-2 2 4 1-2h2"/>';
      else if(/thuoc|duoc/.test(text))body='<path d="m10.5 20.5-7-7a4 4 0 0 1 5.7-5.7l7 7a4 4 0 0 1-5.7 5.7Z"/><path d="m8 6 10 10"/>';
      else body='<path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>';
      return '<span class="summary-icon '+(kind?'is-'+kind:'')+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg></span>';
    }
    function isoLocal(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
    function fmtDate(value){var p=String(value||'').split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(value||'')}
    function toast(text,type){var box=$('toast');box.textContent=text;box.className='toast '+(type||'ok');box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(function(){box.hidden=true},3500)}
    function message(text,type){type=type||'ok';if(type==='ok'){clearMessage();toast(text,'ok');return}$('message').innerHTML='<div class="message '+type+'">'+esc(text)+'</div>';window.scrollTo({top:0,behavior:'smooth'});toast(text,type)}
    function clearMessage(){$('message').innerHTML=''}
    var confirmResolver=null;
    function closeConfirm(result){var layer=$('confirmLayer');if(layer.hidden)return;layer.hidden=true;document.body.style.overflow='';var resolver=confirmResolver;confirmResolver=null;if(resolver)resolver(!!result)}
    function confirmAction(options){options=options||{};if(confirmResolver)closeConfirm(false);$('confirmTitle').textContent=options.title||'Xác nhận thao tác';$('confirmMessage').textContent=options.message||'';$('confirmAccept').textContent=options.confirmText||'Xác nhận';$('confirmCancel').textContent=options.cancelText||'Quay lại';$('confirmAccept').className='btn '+(options.danger?'btn-danger':'btn-primary');$('confirmLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('confirmAccept').focus()},0);return new Promise(function(resolve){confirmResolver=resolve})}
    function setBusy(active,text){state.busyCount=Math.max(0,state.busyCount+(active?1:-1));if(active&&text)$('loadingText').textContent=text;document.body.classList.toggle('is-busy',state.busyCount>0);if(state.busyCount===0)$('loadingText').textContent='Đang xử lý...'}
    function currentViewName(){var view=document.querySelector('.view.active');return view?view.id.replace(/View$/,''):''}
    function friendlyGivenName(value){
      var text=String(value||'').trim().replace(/\s+/g,' ');
      if(!text)return 'bạn';
      if(text.indexOf('@')>=0)text=text.split('@')[0].replace(/[._-]+/g,' ').trim();
      var parts=text.split(' ').filter(Boolean);
      return parts.length?parts[parts.length-1]:'bạn';
    }
    function hasReportAccess(){return!!(state.reportPermission&&state.reportPermission.active===true&&['admin','nhaplieu','viewer'].indexOf(state.reportPermission.role)>=0)}
    function isTongHopAdmin(){return!!(state.user&&state.user.role==='Quản trị')}
    function canInputTongHop(){return!!(state.user&&state.user.role!=='Xem')}
    function isReportAdmin(){return!!(state.reportPermission&&state.reportPermission.active===true&&state.reportPermission.role==='admin')}
    function isOwnerAdmin(){return!!(state.authUser&&normalizeEmail(state.authUser.email)===OWNER_EMAIL)}
    function isAnyAppAdmin(){return isOwnerAdmin()||isTongHopAdmin()||isReportAdmin()}
    function canManageReportPermissionsUi(){return isOwnerAdmin()||isTongHopAdmin()||isReportAdmin()}

    function defaultPrivateView(){
      if(state.user)return 'dashboard';
      if(hasReportAccess())return 'reports';
      return 'home';
    }

    function showView(name){
      var isAdmin=isAnyAppAdmin();
      var hasReport=hasReportAccess();
      var hasTongHop=!!state.user,canInput=canInputTongHop();
      if(name==='admin'&&!isAdmin){name=state.authUser?defaultPrivateView():'dashboard';message('Bạn không có quyền truy cập chức năng này.','err')}
      if(name==='dashboard'&&state.authUser&&!hasTongHop&&!hasReport)name=defaultPrivateView();
      if(name==='entry'&&!canInput)name=state.authUser?defaultPrivateView():'auth';
      if(name==='reports'&&!hasReport){name=state.authUser?defaultPrivateView():'auth';message('Tài khoản chưa được cấp quyền Báo cáo.','err')}
      if(name==='home'){
        if(!state.authUser)name='dashboard';
        else if(hasTongHop||hasReport)name=defaultPrivateView();
      }
      document.querySelectorAll('.view').forEach(function(view){view.classList.remove('active')});
      var target=$(name+'View');if(target)target.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(function(button){var active=button.getAttribute('data-view')===name;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false')});
      window.scrollTo({top:0,behavior:'smooth'});
      if(name==='entry')activateEntryView();
      if(name==='admin')showAdminSection(state.adminSection||'users');
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.onViewChanged==='function')window.YTE_REPORTS.onViewChanged(name);
    }

    function setupDates(){
      var now=new Date(),today=isoLocal(now);
      $('singleDate').value=today;$('fromDate').value=today;$('toDate').value=today;$('entryDate').value=today;$('monthValue').value=today.slice(0,7);
      for(var year=now.getFullYear()-5;year<=now.getFullYear()+2;year++)$('yearValue').add(new Option(String(year),String(year)));
      $('yearValue').value=String(now.getFullYear());$('quarterValue').value=String(Math.ceil((now.getMonth()+1)/3));
    }
    function updateRangeFields(){var type=$('rangeType').value;['dateField','fromField','toField','monthField','quarterField','yearField'].forEach(function(id){$(id).hidden=true});if(type==='day')$('dateField').hidden=false;if(type==='range'){$('fromField').hidden=false;$('toField').hidden=false}if(type==='month')$('monthField').hidden=false;if(type==='quarter'){$('quarterField').hidden=false;$('yearField').hidden=false}if(type==='year')$('yearField').hidden=false}
    function getRange(){
      var type=$('rangeType').value,from,to,label;
      if(type==='day'){from=to=$('singleDate').value;label='Ngày '+fmtDate(from)}
      else if(type==='range'){from=$('fromDate').value;to=$('toDate').value;label='Từ '+fmtDate(from)+' đến '+fmtDate(to)}
      else if(type==='month'){var month=$('monthValue').value,mp=month.split('-'),lastDay=new Date(Number(mp[0]),Number(mp[1]),0).getDate();from=month+'-01';to=month+'-'+String(lastDay).padStart(2,'0');label='Tháng '+mp[1]+'/'+mp[0]}
      else if(type==='quarter'){var year=Number($('yearValue').value),quarter=Number($('quarterValue').value),startMonth=(quarter-1)*3+1,endMonth=startMonth+2,lastQuarterDay=new Date(year,endMonth,0).getDate();from=year+'-'+String(startMonth).padStart(2,'0')+'-01';to=year+'-'+String(endMonth).padStart(2,'0')+'-'+String(lastQuarterDay).padStart(2,'0');label='Quý '+quarter+'/'+year}
      else{var selectedYear=$('yearValue').value;from=selectedYear+'-01-01';to=selectedYear+'-12-31';label='Năm '+selectedYear}
      if(!from||!to)throw new Error('Vui lòng chọn đầy đủ thời gian.');if(from>to)throw new Error('Từ ngày không được lớn hơn đến ngày.');return{from:from,to:to,label:label};
    }
    function populateContentFilter(){var current=$('contentFilter').value||'all';$('contentFilter').innerHTML='<option value="all">Tất cả nội dung</option>'+state.categories.map(function(c){return'<option value="'+esc(c.code)+'">'+esc(c.name)+'</option>'}).join('');$('contentFilter').value=state.categories.some(function(c){return c.code===current})?current:'all'}
    function selectedCategories(){var code=$('contentFilter').value||'all';return code==='all'?state.categories:state.categories.filter(function(c){return c.code===code})}

    function syncData(silent,force){
      if(silent&&!force&&state.lastSyncAt&&Date.now()-state.lastSyncAt<SILENT_SYNC_MIN_AGE_MS)return Promise.resolve();
      if(state.syncPromise)return state.syncPromise;
      state.syncPromise=(async function(){
        try{
          var range=getRange();
          if(!silent)setBusy(true,'Đang tải dữ liệu...');
          var result=await call('getDashboardData',{from:range.from,to:range.to});
          if(!result||!result.success)throw new Error(result&&result.message?result.message:'Không thể tải dữ liệu.');
          state.categories=result.categories||[];state.records=result.records||[];state.from=result.from;state.to=result.to;state.lastSyncAt=Date.now();
          populateContentFilter();$('rangeLabel').textContent=range.label;renderAll();
          startCategoryRealtime();startDashboardRealtime(false);
          if(currentViewName()==='entry')renderIndicators();
          if(!silent)toast('Dữ liệu đã được cập nhật.','ok');
        }catch(error){if(!silent)message(error.message||String(error),'err')}
        finally{if(!silent)setBusy(false);state.syncPromise=null}
      })();return state.syncPromise;
    }
    function aggregate(){var totals={};state.records.forEach(function(record){totals[record.code]=(totals[record.code]||0)+Number(record.value||0)});return totals}
    function recordedCodeMap(){var map={};state.records.forEach(function(record){map[record.code]=true});return map}
    function renderAll(){renderSummary(aggregate())}
    function renderSummary(totals){
      var recorded=recordedCodeMap();
      var categories=selectedCategories().filter(function(c){return !!recorded[c.code]||!!c.derivedKind});
      if(!categories.length){$('summaryCards').innerHTML='<div class="empty dashboard-recorded-empty" style="grid-column:1/-1"><strong>Chưa có số liệu trong phạm vi này.</strong><span>Chọn thời gian khác hoặc nhập số liệu khi có phát sinh.</span></div>';return}
      $('summaryCards').innerHTML=categories.map(function(c){
        var value=Number(totals[c.code]||0),manual=state.records.some(function(record){return record.code===c.code&&record.manualOverride});
        var chip=c.derivedKind?'<span class="status-chip '+(manual?'is-adjusted':'is-auto')+'" title="Số liệu được đồng bộ từ Chuyển viện & tử vong">'+(manual?'Đã điều chỉnh':'Tự động')+'</span>':'';
        return'<article class="summary-item summary-recorded-item'+(c.derivedKind?' is-auto-derived':'')+'">'+uiMetricIcon(c)+'<div class="summary-copy"><h3>'+esc(c.name)+'</h3><p>'+esc(c.group)+'</p></div><div class="summary-value"><span class="summary-number">'+value.toLocaleString('vi-VN')+'</span><span class="summary-unit">'+esc(c.unit)+'</span>'+chip+'</div></article>';
      }).join('');
    }

    function cacheDaily(date,records){var byCode={};(records||[]).forEach(function(record){byCode[record.code]=record});state.entryCache[date]={byCode:byCode,loadedAt:Date.now()};return byCode}
    function hydrateDailyFromResult(result){if(result&&result.dailyDate){cacheDaily(result.dailyDate,result.dailyRecords||[]);if($('entryDate').value===result.dailyDate)applyDailyCache(result.dailyDate)}}
    function applyDailyCache(date){var cache=state.entryCache[date];if(!cache)return false;state.dailyByCode=cache.byCode||{};state.loadedEntryDate=date;renderIndicators();return true}
    function cacheIsFresh(date){return!!(state.entryCache[date]&&Date.now()-state.entryCache[date].loadedAt<ENTRY_CACHE_MS)}
    function setEntryLoadState(text,type,spinning){var box=$('entryLoadState');if(!spinning&&type==='ok'){box.hidden=true;box.textContent='';return}box.hidden=!text;box.className='inline-state '+(type||'');box.innerHTML=(spinning?'<span class="spinner"></span>':'')+'<span>'+esc(text||'')+'</span>'}

    function updateAuthUi(){
      var authenticated=!!state.authUser,loggedIn=!!state.user,isAdmin=isAnyAppAdmin(),canInput=canInputTongHop();
      var tongHopAdmin=isTongHopAdmin()||isOwnerAdmin(),reportAdmin=canManageReportPermissionsUi();
      var hasReport=hasReportAccess();
      var hasAnyAccess=loggedIn||hasReport;
      $('btnAccount').hidden=authenticated;$('btnTopLogout').hidden=!authenticated;if(authenticated){$('btnTopLogout').title='Đăng xuất '+String((loggedIn&&state.user&&state.user.name)||(state.authUser&&state.authUser.name)||'tài khoản');}
      var fullGreetingName=authenticated?String((loggedIn&&state.user&&state.user.name)||(state.authUser&&state.authUser.name)||'Người dùng Phòng Y tế'):'';
      var shortGreetingName=friendlyGivenName(fullGreetingName);
      if($('headerGreeting')){$('headerGreeting').hidden=!authenticated;$('headerGreeting').textContent=authenticated?'Xin chào, '+shortGreetingName+' 👋':'';$('headerGreeting').title=fullGreetingName;}
      if($('mobileGreeting')){$('mobileGreeting').hidden=!authenticated;$('mobileGreeting').textContent=authenticated?'Xin chào, '+shortGreetingName+' 👋':'';$('mobileGreeting').title=fullGreetingName;}
      if($('btnSync'))$('btnSync').hidden=authenticated&&!loggedIn;
      if($('navDashboard'))$('navDashboard').hidden=authenticated&&!loggedIn&&!hasReport;
      $('navEntry').hidden=!canInput;$('navAdmin').hidden=!isAdmin;
      if($('navReports'))$('navReports').hidden=!hasReport;
      if($('adminUsersTab'))$('adminUsersTab').hidden=!tongHopAdmin;
      if($('adminCategoriesTab'))$('adminCategoriesTab').hidden=!tongHopAdmin;
      if($('adminReportPermissionsTab'))$('adminReportPermissionsTab').hidden=!reportAdmin;
      $('userGreeting').hidden=!authenticated;
      $('userGreeting').textContent=authenticated
        ? 'Xin chào, '+shortGreetingName+' 👋'+(hasAnyAccess?'':' · Chờ cấp quyền')
        : '';
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.updateModuleUi==='function'){
        window.YTE_REPORTS.updateModuleUi({
          authenticated:authenticated,
          tongHopActive:loggedIn,
          tongHopRole:loggedIn?state.user.role:'',
          reportPermission:state.reportPermission,
          authUser:state.authUser
        });
      }
      if(!loggedIn){
        stopEntryRealtime();
        state.entryCache={};state.dailyByCode={};state.loadedEntryDate='';state.adminUsers=[];state.adminLoadedAt=0;state.adminCategories=[];state.categoryLoadedAt=0;
        if(currentViewName()==='entry')showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='admin'&&!isAdmin)showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='home'&&hasReport)showView('reports');
        return;
      }
      if(!isAdmin&&currentViewName()==='admin')showView(defaultPrivateView());
      if(currentViewName()==='home')showView('dashboard');
      $('entryUserName').textContent=state.user.name;
      $('entryUserMeta').textContent=state.user.role;
      if(canInput){
        startEntryRealtime($('entryDate').value);
        if(!applyDailyCache($('entryDate').value))loadDay({silent:true,force:false,notify:false});
      }else{
        stopEntryRealtime();
      }
    }
    function applySessionResult(result){
      result=result||{};
      state.authUser=result.authUser||null;
      state.user=result.active===true?result.user:null;
      state.reportPermission=result.reportPermission||null;
      state.categories=result.categories||state.categories;
      hydrateDailyFromResult(result);
      updateAuthUi();
      var hasReport=hasReportAccess();
      if(result.authenticated&&result.active!==true&&!hasReport&&(result.locked||result.rejected)&&result.message)message(result.message,'err');
      else if(result.authenticated&&result.active!==true&&!hasReport)clearMessage();
    }
    async function refreshCurrentSession(){
      try{var result=await call('restoreSession');applySessionResult(result);return result}catch(error){return null}
    }
    window.YTE_REFRESH_SESSION=refreshCurrentSession;
    window.YTE_APP_UI=Object.freeze({
      hasUnsavedChanges:function(){return quickEntryDirty()}
    });

    async function restore(){
      try{
        var result=await call('restoreSession');applySessionResult(result);
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterRestore==='function')await window.YTE_REPORTS.routeAfterRestore(result);
      }
      catch(error){state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi()}
    }
    async function loginGoogle(){
      setBusy(true,'Đang mở đăng nhập Google...');
      try{
        var result=await call('googleLoginAccount');
        applySessionResult(result);
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterLogin==='function')await window.YTE_REPORTS.routeAfterLogin(result);
        else showView('dashboard');
        var hasReport=!!(result.reportPermission&&result.reportPermission.active===true&&['admin','nhaplieu','viewer'].indexOf(result.reportPermission.role)>=0);
        if(result.active||hasReport)toast('Đăng nhập Google thành công.','ok');else clearMessage();
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function logout(){
      try{await call('logoutSession')}catch(error){}
      stopEntryRealtime();state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi();
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.onLogout==='function')window.YTE_REPORTS.onLogout();
      showView('dashboard');message('Đã đăng xuất.','ok')
    }

    function activateEntryView(){
      if(!state.user)return
      var date=$('entryDate').value;startEntryRealtime(date);if(applyDailyCache(date)){if(cacheIsFresh(date))setEntryLoadState('','ok',false);else{setEntryLoadState('Đang kiểm tra dữ liệu mới nhất...','',true);loadDay({silent:true,force:true,notify:false})}}else{renderIndicators();setEntryLoadState('Đang chuẩn bị dữ liệu ngày '+fmtDate(date)+'...','',true);loadDay({silent:true,force:false,notify:false})}
    }
    function entryUnitInputLabel(unit){
      var text=String(unit||'').trim();
      if(!text)return 'Số liệu *';
      return 'Số '+text.toLocaleLowerCase('vi-VN')+' *';
    }
    function entryUnitPlaceholder(unit){
      var text=String(unit||'').trim();
      return text?'Nhập số '+text.toLocaleLowerCase('vi-VN'):'Nhập số liệu';
    }
    function updateEntryDateLabel(){
      // Chỉ hiển thị ngày tại bộ chọn ngày, không lặp lại ngày ở các khối nội dung.
    }
    function renderEntryCategoryOptions(){
      var select=$('entryCategorySelect');if(!select)return;
      var current=select.value,groups={};
      state.categories.forEach(function(category){var key=category.group||'Khác';if(!groups[key])groups[key]=[];groups[key].push(category)});
      var html='<option value="">Chọn chỉ tiêu cần nhập</option>';
      Object.keys(groups).forEach(function(group){
        html+='<optgroup label="'+esc(group)+'">'+groups[group].map(function(category){return'<option value="'+esc(category.code)+'">'+esc(category.name)+(category.derivedKind?' · Tự động':' · '+esc(category.unit))+'</option>'}).join('')+'</optgroup>';
      });
      select.innerHTML=html;
      if(current&&state.categories.some(function(category){return category.code===current}))select.value=current;
      updateQuickEntrySelection(false);
    }
    function setEntrySelectedStatus(text,className){
      var chip=$('entrySelectedStatus');if(!chip)return;
      chip.className='status-chip '+(className||'');chip.textContent=text||'';chip.hidden=!text;
    }
    function resetEntrySelection(){
      if($('entryCategorySelect'))$('entryCategorySelect').value='';
      if($('entryQuickValue'))$('entryQuickValue').value='';
      state.quickEntryBaseline='';
      if($('entrySelectedInfo'))$('entrySelectedInfo').hidden=true;
      if($('entryQuickValueField'))$('entryQuickValueField').hidden=true;
      if($('entryInlineActions'))$('entryInlineActions').hidden=true;
      if($('btnEntrySelectedHistory'))$('btnEntrySelectedHistory').hidden=true;
      if($('btnEntrySelectedAdjust'))$('btnEntrySelectedAdjust').hidden=true;
      if($('btnEntrySelectedDelete'))$('btnEntrySelectedDelete').hidden=true;
      if($('btnSaveQuickEntry'))$('btnSaveQuickEntry').hidden=false;
      if($('entryQuickError'))$('entryQuickError').textContent='';
      setEntrySelectedStatus('','');
    }
    function updateQuickEntrySelection(focusValue){
      var select=$('entryCategorySelect');if(!select)return;
      var code=select.value,category=state.categories.find(function(item){return item.code===code});
      var info=$('entrySelectedInfo'),valueField=$('entryQuickValueField'),actions=$('entryInlineActions'),save=$('btnSaveQuickEntry'),adjust=$('btnEntrySelectedAdjust'),history=$('btnEntrySelectedHistory'),del=$('btnEntrySelectedDelete');
      if(!category){resetEntrySelection();return}
      var record=state.dailyByCode[code]||null,auto=!!category.derivedKind,current=record?Number(record.value||0):(auto?0:null),manual=!!(record&&record.manualOverride),autoValue=auto?Number(record?(record.autoValue==null?current:record.autoValue):0):null;
      info.hidden=false;actions.hidden=false;
      $('entrySelectedName').textContent=category.name||code;$('entrySelectedGroup').textContent=category.group||'Chỉ tiêu';$('entrySelectedUnit').textContent=category.unit||'—';
      $('entrySelectedCurrent').textContent=current==null?'Chưa ghi nhận':current.toLocaleString('vi-VN')+' '+category.unit;
      $('entrySelectedAutoRow').hidden=!auto;$('entrySelectedAuto').textContent=auto?autoValue.toLocaleString('vi-VN')+' '+category.unit:'—';
      $('entrySelectedUpdaterRow').hidden=!(record&&record.updatedBy);$('entrySelectedUpdater').textContent=record&&record.updatedBy?record.updatedBy:'—';
      if(auto)setEntrySelectedStatus(manual?'Đã điều chỉnh':'Tự động',manual?'is-adjusted':'is-auto');
      else if(record)setEntrySelectedStatus('Đã ghi nhận','is-complete');else setEntrySelectedStatus('','');
      if(adjust&&adjust.querySelector('span'))adjust.querySelector('span').textContent=auto?'Điều chỉnh số liệu':'Cập nhật số liệu';
      history.hidden=!record;
      if(auto){
        valueField.hidden=true;save.hidden=true;adjust.hidden=false;if(del)del.hidden=true;state.quickEntryBaseline='';$('entryQuickValue').value='';
      }else if(record){
        // Record thủ công đã tồn tại: thao tác rõ ràng Sửa / Xóa / Lịch sử.
        valueField.hidden=true;save.hidden=true;adjust.hidden=false;if(del)del.hidden=!isTongHopAdmin()&&!isOwnerAdmin();
        $('entryQuickValue').value=String(Number(record.value||0));state.quickEntryBaseline=code+'|'+$('entryQuickValue').value;
      }else{
        valueField.hidden=false;save.hidden=false;adjust.hidden=true;if(del)del.hidden=true;
        $('entryQuickValueLabel').childNodes[0].nodeValue=entryUnitInputLabel(category.unit);$('entryQuickValue').placeholder=entryUnitPlaceholder(category.unit);$('entryQuickValue').value='';
        save.textContent='Lưu số liệu';save.disabled=false;state.quickEntryBaseline=code+'|';
        if(focusValue)window.setTimeout(function(){$('entryQuickValue').focus();$('entryQuickValue').select()},0);
      }
      if($('entryQuickError'))$('entryQuickError').textContent='';
    }
    function setQuickEntrySaving(active){
      state.quickEntrySaving=active===true;
      ['entryCategorySelect','entryQuickValue','btnEntrySelectedAdjust','btnEntrySelectedHistory','btnEntrySelectedDelete'].forEach(function(id){var el=$(id);if(el)el.disabled=state.quickEntrySaving});
      var save=$('btnSaveQuickEntry');if(save&&!save.hidden){save.disabled=state.quickEntrySaving||!$('entryCategorySelect').value;save.textContent=state.quickEntrySaving?'Đang lưu...':(state.dailyByCode[$('entryCategorySelect').value]?'Cập nhật số liệu':'Lưu số liệu')}
      if($('entryQuickProgress'))$('entryQuickProgress').hidden=!state.quickEntrySaving;
    }
    function quickEntryDirty(){
      var code=String($('entryCategorySelect')&&$('entryCategorySelect').value||''),category=state.categories.find(function(item){return item.code===code});
      if(!category||category.derivedKind)return false;
      return code+'|'+String($('entryQuickValue').value||'')!==state.quickEntryBaseline;
    }
    function quickEntryPayload(){
      var code=String($('entryCategorySelect').value||''),category=state.categories.find(function(item){return item.code===code});
      if(!category)throw new Error('Vui lòng chọn chỉ tiêu cần nhập.');
      if(category.derivedKind)throw new Error(category.name+' được hệ thống tự động tổng hợp từ phân hệ Chuyển viện & tử vong.');
      var raw=String($('entryQuickValue').value||'').trim();if(raw==='')throw new Error('Vui lòng nhập '+entryUnitInputLabel(category.unit).replace(' *','').toLocaleLowerCase('vi-VN')+'. Có thể nhập 0.');
      var newValue=Number(raw);if(!isFinite(newValue)||newValue<0||Math.floor(newValue)!==newValue)throw new Error('Số liệu phải là số nguyên không âm.');
      var record=state.dailyByCode[code]||null;if(record&&newValue===Number(record.value||0))throw new Error('Số liệu mới đang bằng số hiện tại.');
      return{token:state.token,date:$('entryDate').value,code:code,newValue:newValue,reason:record?'Cập nhật trực tiếp trên ứng dụng':'Ghi nhận số liệu lần đầu',expectedVersion:record?Number(record.version||0):0};
    }
    async function submitQuickEntry(){
      if(state.quickEntrySaving)return;var payload;
      try{payload=quickEntryPayload()}catch(error){$('entryQuickError').textContent=error.message||String(error);return}
      $('entryQuickError').textContent='';setQuickEntrySaving(true);
      try{
        var result=await call('adjustDailyData',payload);if(result.record)state.dailyByCode[payload.code]=result.record;
        state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};renderIndicators();setQuickEntrySaving(false);setEntryLoadState('','ok',false);clearMessage();
        var savedCategory=state.categories.find(function(item){return item.code===payload.code});
        toast(savedCategory?'Đã lưu '+savedCategory.name+': '+Number(payload.newValue).toLocaleString('vi-VN')+' '+savedCategory.unit+'.':(result.message||'Đã lưu số liệu.'),'ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('entryQuickError').textContent=error.message||String(error);setQuickEntrySaving(false)}
    }
    function renderIndicators(){renderEntryCategoryOptions()}
    async function loadDay(options){
      options=options||{};if(!state.user)return
      var date=$('entryDate').value;if(!date){if(options.notify)message('Vui lòng chọn ngày nhập số liệu.','err');return}
      if(!options.force&&cacheIsFresh(date)){applyDailyCache(date);setEntryLoadState('','ok',false);return}
      if(state.entryLoads[date])return state.entryLoads[date];
      var requestId=++state.entryRequestId;$('btnLoadDay').disabled=true;setEntryLoadState('Đang kiểm tra dữ liệu mới nhất...','',true);
      var promise=(async function(){
        try{
          var result=await call('getDailyData',date,state.token);
          cacheDaily(date,result.records||[]);
          if(requestId!==state.entryRequestId||date!==$('entryDate').value)return;
          applyDailyCache(date);setEntryLoadState('','ok',false);if(options.notify)toast('Đã tải dữ liệu mới nhất.','ok')
        }catch(error){setEntryLoadState(error.message||String(error),'err',false);if(options.notify)message(error.message||String(error),'err')}
        finally{$('btnLoadDay').disabled=false;delete state.entryLoads[date]}
      })();state.entryLoads[date]=promise;return promise;
    }
    async function manualReloadDay(){
      if(state.adjustSaving||state.quickEntrySaving)return;
      await loadDay({silent:true,force:true,notify:true});
    }
    async function handleEntryDateChange(){
      if(state.adjustSaving||state.quickEntrySaving){
        $('entryDate').value=state.loadedEntryDate||$('entryDate').value;
        toast('Dữ liệu đang được lưu. Vui lòng chờ hoàn tất.','warn');
        return;
      }
      if(quickEntryDirty()&&!window.confirm('Số liệu đang nhập chưa được lưu. Bạn có muốn đổi ngày và bỏ nội dung này?')){
        $('entryDate').value=state.loadedEntryDate||$('entryDate').value;
        return;
      }
      resetEntrySelection();state.dailyByCode={};state.loadedEntryDate='';renderIndicators();
      startEntryRealtime($('entryDate').value);
      if(!applyDailyCache($('entryDate').value))await loadDay({silent:true,force:false,notify:false});
      else if(!cacheIsFresh($('entryDate').value))loadDay({silent:true,force:true,notify:false});
    }
    function setAdjustmentSaving(active){
      state.adjustSaving=active===true;
      var card=$('adjustLayer').querySelector('.adjust-card');
      var saveButton=$('adjustSave');
      var cancelButton=$('adjustCancel');
      var valueInput=$('adjustNewValue');
      var reasonInput=$('adjustReason');
      var progress=$('adjustProgress');
      $('adjustLayer').setAttribute('aria-busy',state.adjustSaving?'true':'false');
      if(card)card.classList.toggle('is-saving',state.adjustSaving);
      saveButton.disabled=state.adjustSaving;
      cancelButton.disabled=state.adjustSaving;
      valueInput.disabled=state.adjustSaving;
      if(reasonInput)reasonInput.disabled=state.adjustSaving;
      progress.hidden=!state.adjustSaving;
      saveButton.innerHTML=state.adjustSaving
        ? '<span class="adjust-save-spinner" aria-hidden="true"></span><span>Đang lưu...</span>'
        : 'Lưu thay đổi';
    }
    function openAdjustDialog(code){
      if(state.adjustSaving)return;
      var record=state.dailyByCode[code]||null;
      var category=state.categories.find(function(item){return item.code===code});
      if(!category){toast('Không tìm thấy chỉ tiêu cần cập nhật.','warn');return}
      state.adjustingCode=code;
      var isDerived=!!(category.derivedKind||(record&&record.derivedKind));
      var autoValue=isDerived?Number(record?(record.autoValue==null?record.value||0:record.autoValue):0):null;
      $('adjustTitle').textContent=(isDerived?'Điều chỉnh ':'Sửa ')+category.name;
      $('adjustContext').textContent='Ngày '+fmtDate($('entryDate').value)+' · Đơn vị: '+category.unit+' · Có thể nhập 0.';
      $('adjustCurrentValue').textContent=record?Number(record.value||0).toLocaleString('vi-VN')+' '+category.unit:(isDerived?'0 '+category.unit:'Chưa ghi nhận');
      $('adjustAutoReference').hidden=!isDerived;
      $('adjustAutoReference').textContent=isDerived?'Số liệu tự động từ Chuyển viện & tử vong: '+autoValue.toLocaleString('vi-VN')+' '+category.unit+'. Số bạn lưu sẽ là số liệu chính thức dùng cho Tổng hợp số liệu.':'';
      $('adjustReasonLabel').textContent=isDerived?'Lý do điều chỉnh *':'Lý do điều chỉnh';
      $('adjustReason').value='';
      $('adjustReason').placeholder=isDerived?'Ví dụ: Báo cáo trùng một trường hợp, đã kiểm tra lại':'Nhập lý do nếu cần lưu để đối chiếu';
      $('adjustNewValue').value=record?String(Number(record.value||0)):(isDerived?'0':'');
      $('adjustError').textContent='';
      setAdjustmentSaving(false);
      $('adjustLayer').hidden=false;
      document.body.style.overflow='hidden';
      window.setTimeout(function(){$('adjustNewValue').focus();$('adjustNewValue').select()},0);
    }
    function closeAdjustDialog(){
      if(state.adjustSaving)return;
      $('adjustLayer').hidden=true;
      state.adjustingCode='';
      $('adjustError').textContent='';
      $('adjustReason').value='';
      $('adjustAutoReference').hidden=true;
      $('adjustProgress').hidden=true;
      if($('confirmLayer').hidden)document.body.style.overflow='';
    }
    function adjustmentPayload(){
      var code=state.adjustingCode;
      var record=state.dailyByCode[code]||null;
      var category=state.categories.find(function(item){return item.code===code});
      if(!category)throw new Error('Không tìm thấy chỉ tiêu cần cập nhật.');
      var raw=String($('adjustNewValue').value||'').trim();
      if(raw==='')throw new Error('Vui lòng nhập số liệu mới. Có thể nhập 0.');
      var newValue=Number(raw);
      if(!isFinite(newValue)||newValue<0||Math.floor(newValue)!==newValue)throw new Error('Số liệu mới phải là số nguyên không âm.');
      if(record&&newValue===Number(record.value||0))throw new Error('Số liệu mới đang bằng số hiện tại.');
      var isDerived=!!(category.derivedKind||(record&&record.derivedKind));
      var typedReason=String($('adjustReason').value||'').trim();
      if(isDerived&&typedReason.length<3)throw new Error('Vui lòng nhập lý do điều chỉnh để lưu lịch sử đối chiếu.');
      var reason=typedReason||(record?'Cập nhật trực tiếp trên ứng dụng':'Ghi nhận số liệu lần đầu');
      return{
        token:state.token,
        date:$('entryDate').value,
        code:code,
        newValue:newValue,
        reason:reason,
        expectedVersion:record?Number(record.version||0):0
      };
    }
    async function submitAdjustment(){
      if(state.adjustSaving)return;
      var payload;
      try{payload=adjustmentPayload()}catch(error){$('adjustError').textContent=error.message||String(error);return}
      $('adjustError').textContent='';
      setAdjustmentSaving(true);
      try{
        var result=await call('adjustDailyData',payload);
        if(result.record)state.dailyByCode[payload.code]=result.record;
        state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};
        setAdjustmentSaving(false);
        closeAdjustDialog();
        renderIndicators();
        setEntryLoadState('','ok',false);
        clearMessage();
        toast(result.message||'Đã lưu số liệu.','ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;
        Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){
        $('adjustError').textContent=error.message||String(error);
        setAdjustmentSaving(false);
      }
    }

    function setDeleteDailySaving(active){
      state.deleteDailySaving=active===true;
      var layer=$('deleteDailyLayer'),accept=$('deleteDailyAccept'),cancel=$('deleteDailyCancel'),reason=$('deleteDailyReason'),progress=$('deleteDailyProgress');
      if(layer)layer.setAttribute('aria-busy',state.deleteDailySaving?'true':'false');
      if(accept){accept.disabled=state.deleteDailySaving;accept.textContent=state.deleteDailySaving?'Đang xóa...':'Xóa số liệu'}
      if(cancel)cancel.disabled=state.deleteDailySaving;
      if(reason)reason.disabled=state.deleteDailySaving;
      if(progress)progress.hidden=!state.deleteDailySaving;
    }
    function openDeleteDailyDialog(code){
      if(state.deleteDailySaving)return;
      if(!isTongHopAdmin()&&!isOwnerAdmin()){toast('Chỉ tài khoản Quản trị mới được xóa số liệu.','warn');return;}
      var category=state.categories.find(function(item){return item.code===code}),record=state.dailyByCode[code]||null;
      if(!category||!record){toast('Không tìm thấy số liệu cần xóa.','warn');return}
      if(category.derivedKind||(record&&record.derivedKind)){toast('Số liệu tự động không thể xóa tại màn hình Nhập liệu.','warn');return}
      state.deleteDailyCode=code;
      $('deleteDailyDate').textContent=fmtDate($('entryDate').value);
      $('deleteDailyCategory').textContent=category.name+' · '+category.unit;
      $('deleteDailyValue').textContent=Number(record.value||0).toLocaleString('vi-VN')+' '+category.unit;
      $('deleteDailyReason').value='';$('deleteDailyError').textContent='';setDeleteDailySaving(false);
      $('deleteDailyLayer').hidden=false;document.body.style.overflow='hidden';
      window.setTimeout(function(){$('deleteDailyReason').focus()},0);
    }
    function closeDeleteDailyDialog(){
      if(state.deleteDailySaving)return;
      $('deleteDailyLayer').hidden=true;state.deleteDailyCode='';$('deleteDailyReason').value='';$('deleteDailyError').textContent='';$('deleteDailyProgress').hidden=true;
      if($('confirmLayer').hidden&&$('adjustLayer').hidden&&$('dataHistoryLayer').hidden)document.body.style.overflow='';
    }
    async function submitDeleteDaily(){
      if(state.deleteDailySaving)return;
      var code=state.deleteDailyCode,category=state.categories.find(function(item){return item.code===code}),record=state.dailyByCode[code]||null;
      if(!category||!record){$('deleteDailyError').textContent='Số liệu không còn tồn tại. Vui lòng tải lại.';return}
      var reason=String($('deleteDailyReason').value||'').trim();
      if(reason.length<3){$('deleteDailyError').textContent='Vui lòng nhập lý do xóa ít nhất 3 ký tự.';$('deleteDailyReason').focus();return}
      setDeleteDailySaving(true);$('deleteDailyError').textContent='';
      try{
        var payload={token:state.token,date:$('entryDate').value,code:code,expectedVersion:Number(record.version||0),reason:reason};
        var result=await call('deleteDailyData',payload);
        delete state.dailyByCode[code];state.entryCache[payload.date]={byCode:state.dailyByCode,loadedAt:Date.now()};
        setDeleteDailySaving(false);closeDeleteDailyDialog();renderIndicators();clearMessage();toast(result.message||'Đã xóa số liệu.','ok');
        $('rangeType').value='day';updateRangeFields();$('singleDate').value=payload.date;Promise.resolve(syncData(true,true)).catch(function(){});
      }catch(error){$('deleteDailyError').textContent=error.message||String(error);setDeleteDailySaving(false)}
    }

    function renderDataHistory(items,category){
      var box=$('dataHistoryList');items=items||[];
      if(!items.length){box.innerHTML='<div class="data-history-empty"><strong>Chưa có lần điều chỉnh thủ công.</strong><span>Số liệu hiện tại đang được giữ theo nguồn tự động hoặc chưa phát sinh thay đổi.</span></div>';return}
      box.innerHTML=items.map(function(item){
        var who=esc(item.displayName||'Tài khoản được cấp quyền'),reason=esc(item.reason||'Không ghi lý do'),time=esc(item.createdAtText||'');
        var autoRef=item.autoValue==null?'':'<div class="data-history-auto">Tự động lúc điều chỉnh: '+Number(item.autoValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'')+'</div>';
        var afterText=item.afterValue==null?'Đã xóa':Number(item.afterValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'');
        return'<article class="data-history-item"><div class="data-history-top"><strong>'+Number(item.beforeValue||0).toLocaleString('vi-VN')+' '+esc(category&&category.unit||'')+' → '+afterText+'</strong><span>'+time+'</span></div><div class="data-history-action">'+esc(item.action||'Điều chỉnh')+'</div>'+autoRef+'<div class="data-history-reason">'+reason+'</div><div class="data-history-user"><strong>'+who+'</strong></div></article>'
      }).join('');
    }
    async function openDataHistoryDialog(code){
      var category=state.categories.find(function(item){return item.code===code});if(!category)return;
      state.historyCode=code;state.historyLoading=true;
      $('dataHistoryTitle').textContent='Lịch sử điều chỉnh · '+category.name;
      $('dataHistoryContext').textContent='Ngày '+fmtDate($('entryDate').value)+' · Mọi thay đổi đều ghi nhận người thực hiện và thời điểm điều chỉnh.';
      $('dataHistoryList').innerHTML='<div class="data-history-loading"><span class="spinner"></span><span>Đang tải lịch sử...</span></div>';
      $('dataHistoryLayer').hidden=false;document.body.style.overflow='hidden';
      try{var result=await call('getDailyDataHistory',{date:$('entryDate').value,code:code,token:state.token});renderDataHistory(result.items||[],category)}
      catch(error){$('dataHistoryList').innerHTML='<div class="data-history-empty is-error"><strong>Không tải được lịch sử.</strong><span>'+esc(error.message||String(error))+'</span></div>'}
      finally{state.historyLoading=false}
    }
    function closeDataHistoryDialog(){$('dataHistoryLayer').hidden=true;state.historyCode='';if($('confirmLayer').hidden&&$('adjustLayer').hidden)document.body.style.overflow=''}


    function renderAdminUsers(){
      var query=String($('adminSearch').value||'').trim().toLowerCase();
      var rows=state.adminUsers.filter(function(user){return!query||String(user.name+' '+user.username+' '+user.email+' '+user.role+' '+user.status).toLowerCase().indexOf(query)>=0});
      var pendingRows=rows.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned'||user.requestStatus==='rejected')});
      var grantedRows=rows.filter(function(user){return!user.isPending});
      var pendingCount=state.adminUsers.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned')}).length;
      $('adminCount').textContent=state.adminUsers.length+' tài khoản';
      $('adminPending').hidden=pendingCount===0;$('adminPending').textContent=pendingCount+' chờ duyệt';
      $('adminNote').hidden=true;$('adminNote').textContent='';
      if(!rows.length){$('adminUsers').innerHTML='<div class="empty">Không có tài khoản phù hợp.</div>';return}
      function avatarText(user){var name=String(user.name||user.email||'?').trim();return esc((name.charAt(0)||'?').toUpperCase())}
      function roleOptions(selected){return ['Xem','Nhập liệu','Quản trị'].map(function(role){return'<option value="'+role+'"'+(role===selected?' selected':'')+'>'+role+'</option>'}).join('')}
      function accountIdentity(user,isSelf){
        var status=user.status||'Chưa cấp';
        var role=user.role||'Chưa cấp';
        var line=status+(role&&role!=='Chưa cấp'?' · '+role:'')+(isSelf?' · Tài khoản đang đăng nhập':'');
        return'<div class="admin-account-identity"><span class="admin-account-avatar">'+avatarText(user)+'</span><div class="admin-account-person"><strong>'+esc(user.name||'Chưa có tên')+(isSelf?' <span class="admin-self-tag">(Bạn)</span>':'')+'</strong><span>'+esc(user.email||user.username||'—')+'</span><small>'+esc(line)+'</small></div></div>';
      }
      function pendingCard(user){
        var isSelf=state.user&&user.id===state.user.id;
        var requestText=user.requestStatus==='rejected'?'Đã từ chối':(user.requestStatus==='unassigned'?'Chưa cấp quyền':'Chờ duyệt');
        var selectDisabled=user.requestStatus==='rejected'?' disabled':'';
        var controls='<div class="admin-account-controls"><select class="admin-role-select" aria-label="Chọn quyền cấp cho '+esc(user.name||user.email||'tài khoản')+'"'+selectDisabled+'>'+roleOptions('Xem')+'</select>';
        if(user.requestStatus!=='rejected')controls+='<button class="btn btn-primary admin-action" data-kind="approve-selected" data-id="'+esc(user.id)+'" type="button">Cấp quyền</button>';
        if(user.requestStatus==='pending')controls+='<button class="btn btn-soft admin-action admin-inline-secondary" data-kind="reject-registration" data-id="'+esc(user.id)+'" type="button">Từ chối</button>';
        if(!isSelf)controls+='<button class="btn btn-danger admin-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>';
        controls+='<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(user.requestStatus==='pending'?'<button class="small-btn btn-soft admin-action admin-mobile-only" data-kind="reject-registration" data-id="'+esc(user.id)+'" type="button">Từ chối</button>':'')+(!isSelf?'<button class="small-btn btn-danger admin-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card is-pending">'+accountIdentity(user,isSelf)+'<div class="admin-request-meta"><span class="status-pill pending">'+requestText+'</span>'+(user.requestedAt?'<span>'+esc(user.requestedAt)+'</span>':'')+'</div>'+controls+'</article>';
      }
      function grantedCard(user){
        var isSelf=state.user&&user.id===state.user.id;
        var disabled=isSelf?' disabled':'';
        var nextStatus=user.status==='Hoạt động'?'Khóa':'Hoạt động';
        var controls='<div class="admin-account-controls"><select class="admin-role-select" aria-label="Vai trò của '+esc(user.name||user.email||'tài khoản')+'"'+disabled+'>'+roleOptions(user.role||'Xem')+'</select>'+
          '<button class="btn btn-primary admin-action" data-kind="save-role" data-id="'+esc(user.id)+'" type="button"'+disabled+'>Lưu quyền</button>'+
          (!isSelf?'<button class="btn btn-soft admin-action admin-inline-secondary" data-kind="status" data-id="'+esc(user.id)+'" data-value="'+esc(nextStatus)+'" type="button">'+(user.status==='Hoạt động'?'Khóa':'Mở khóa')+'</button><button class="btn btn-danger admin-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+
          '<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(!isSelf?'<button class="small-btn btn-soft admin-action admin-mobile-only" data-kind="status" data-id="'+esc(user.id)+'" data-value="'+esc(nextStatus)+'" type="button">'+(user.status==='Hoạt động'?'Khóa tài khoản':'Mở khóa tài khoản')+'</button><button class="small-btn btn-danger admin-action" data-kind="revoke" data-id="'+esc(user.id)+'" type="button">Thu hồi quyền</button><button class="small-btn btn-danger admin-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card">'+accountIdentity(user,isSelf)+controls+'</article>';
      }
      function section(title,desc,list,kind){
        return'<section class="admin-account-section"><div class="admin-account-section-head"><div><h3>'+title+'</h3><p>'+desc+'</p></div><span class="admin-section-count">'+list.length+'</span></div><div class="admin-account-list">'+(list.length?list.map(kind==='pending'?pendingCard:grantedCard).join(''):'<div class="admin-section-empty">Không có tài khoản nào trong nhóm này.</div>')+'</div></section>';
      }
      $('adminUsers').innerHTML='<div class="admin-account-sections">'+section('Chưa được cấp quyền','Tài khoản đang chờ duyệt, chưa được cấp quyền hoặc đã bị từ chối.',pendingRows,'pending')+section('Đã được phân quyền','Quản lý vai trò, trạng thái hoạt động và quyền sử dụng Tổng hợp số liệu.',grantedRows,'granted')+'</div>';
    }
    async function loadAdminUsers(force){
      if(!state.user||state.user.role!=='Quản trị')return
      if(!force&&state.adminUsers.length&&Date.now()-state.adminLoadedAt<ADMIN_CACHE_MS){renderAdminUsers();$('adminLoadState').hidden=true;return}
      if(state.adminPromise)return state.adminPromise;$('adminLoadState').hidden=false;$('adminLoadState').className='inline-state';$('adminLoadState').innerHTML='<span class="spinner"></span><span>Đang tải danh sách tài khoản...</span>';$('adminUsers').innerHTML='<div class="empty">Đang chuẩn bị dữ liệu quản trị...</div>';
      state.adminPromise=(async function(){try{var result=await call('getAdminUsers',state.token);state.adminUsers=result.users||[];state.adminLoadedAt=Date.now();renderAdminUsers();$('adminLoadState').hidden=true;$('adminLoadState').textContent=''}catch(error){$('adminLoadState').hidden=false;$('adminLoadState').className='inline-state err';$('adminLoadState').textContent=error.message||String(error);$('adminUsers').innerHTML='<div class="empty">Không thể tải danh sách tài khoản. Vui lòng thử lại.</div>'}finally{state.adminPromise=null}})();return state.adminPromise;
    }
    function showAdminSection(name){
      var canTongHop=isTongHopAdmin()||isOwnerAdmin(),canReport=canManageReportPermissionsUi();
      if($('adminUsersTab'))$('adminUsersTab').hidden=!canTongHop;
      if($('adminCategoriesTab'))$('adminCategoriesTab').hidden=!canTongHop;
      if($('adminReportPermissionsTab'))$('adminReportPermissionsTab').hidden=!canReport;
      if(name!=='users'&&name!=='categories'&&name!=='reportPermissions')name=canTongHop?'users':'reportPermissions';
      if((name==='users'||name==='categories')&&!canTongHop)name=canReport?'reportPermissions':'users';
      if(name==='reportPermissions'&&!canReport)name=canTongHop?'users':'reportPermissions';
      state.adminSection=name;
      document.querySelectorAll('.admin-tab').forEach(function(tab){tab.classList.toggle('active',tab.getAttribute('data-admin-tab')===name)});
      $('adminUsersPanel').hidden=name!=='users';$('adminCategoriesPanel').hidden=name!=='categories';$('adminReportPermissionsPanel').hidden=name!=='reportPermissions';
      if(name==='users')loadAdminUsers(false);else if(name==='categories')loadAdminCategories(false);else loadAdminReportUsers(false);
    }
    function renderAdminReportUsers(){
      var query=String($('adminReportSearch').value||'').trim().toLowerCase();
      var rows=state.adminReportUsers.filter(function(user){return!query||String(user.name+' '+user.email+' '+user.roleLabel+' '+user.status).toLowerCase().indexOf(query)>=0});
      $('adminReportCount').textContent=state.adminReportUsers.length+' tài khoản';
      if(!rows.length){$('adminReportUsers').innerHTML='<div class="empty">Không có tài khoản phù hợp.</div>';return}
      var currentUid=state.authUser&&state.authUser.uid?state.authUser.uid:'';
      var canChangeSelf=isTongHopAdmin()||isOwnerAdmin();
      var canDeleteAppUser=isTongHopAdmin()||isOwnerAdmin();
      var pendingRows=rows.filter(function(user){return!user.active});
      var grantedRows=rows.filter(function(user){return user.active});
      function avatarText(user){var name=String(user.name||user.email||'?').trim();return esc((name.charAt(0)||'?').toUpperCase())}
      function roleOptions(selected){return [['viewer','Xem'],['nhaplieu','Nhập liệu'],['admin','Quản trị']].map(function(pair){return'<option value="'+pair[0]+'"'+(pair[0]===selected?' selected':'')+'>'+pair[1]+'</option>'}).join('')}
      function identity(user,isSelf){
        var line=(user.status||'Chưa cấp')+(user.roleLabel?' · '+user.roleLabel:'')+(isSelf?' · Tài khoản đang đăng nhập':'');
        return'<div class="admin-account-identity"><span class="admin-account-avatar">'+avatarText(user)+'</span><div class="admin-account-person"><strong>'+esc(user.name||'Chưa có tên')+(isSelf?' <span class="admin-self-tag">(Bạn)</span>':'')+'</strong><span>'+esc(user.email||'—')+'</span><small>'+esc(line)+'</small></div></div>';
      }
      function pendingCard(user){
        var isSelf=user.id===currentUid;
        var controls='<div class="admin-account-controls"><select class="admin-report-role-select" aria-label="Chọn quyền Báo cáo cho '+esc(user.name||user.email||'tài khoản')+'">'+roleOptions('viewer')+'</select><button class="btn btn-primary admin-report-action" data-kind="grant-selected" data-id="'+esc(user.id)+'" type="button">Cấp quyền</button>';
        if(canDeleteAppUser&&!isSelf)controls+='<button class="btn btn-danger admin-report-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>';
        controls+='<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-report-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(canDeleteAppUser&&!isSelf?'<button class="small-btn btn-danger admin-report-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card is-pending">'+identity(user,isSelf)+'<div class="admin-request-meta"><span class="status-pill pending">Chưa được cấp quyền</span><span>'+esc(user.lastLogin||'Chưa có lần đăng nhập')+'</span></div>'+controls+'</article>';
      }
      function grantedCard(user){
        var isSelf=user.id===currentUid,protectSelf=isSelf&&!canChangeSelf;
        var disabled=protectSelf?' disabled':'';
        var controls='<div class="admin-account-controls"><select class="admin-report-role-select" aria-label="Quyền Báo cáo của '+esc(user.name||user.email||'tài khoản')+'"'+disabled+'>'+roleOptions(user.role||'viewer')+'</select><button class="btn btn-primary admin-report-action" data-kind="save-role" data-id="'+esc(user.id)+'" type="button"'+disabled+'>Lưu quyền</button>';
        if(!protectSelf)controls+='<button class="btn btn-soft admin-report-action admin-inline-secondary" data-kind="revoke" data-id="'+esc(user.id)+'" type="button">Thu hồi</button>';
        if(canDeleteAppUser&&!isSelf)controls+='<button class="btn btn-danger admin-report-action admin-inline-danger" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>';
        controls+='<details class="admin-account-more"><summary aria-label="Thao tác khác">•••</summary><div class="admin-row-popover"><button class="small-btn btn-soft admin-report-action" data-kind="display-name" data-id="'+esc(user.id)+'" type="button">Tên hiển thị</button>'+(!protectSelf?'<button class="small-btn btn-danger admin-report-action admin-mobile-only" data-kind="revoke" data-id="'+esc(user.id)+'" type="button">Thu hồi quyền</button>':'')+(canDeleteAppUser&&!isSelf?'<button class="small-btn btn-danger admin-report-action admin-mobile-only" data-kind="delete" data-id="'+esc(user.id)+'" type="button">Xóa tài khoản</button>':'')+'</div></details></div>';
        return'<article class="admin-account-card">'+identity(user,isSelf)+controls+'</article>';
      }
      function section(title,desc,list,kind){
        return'<section class="admin-account-section"><div class="admin-account-section-head"><div><h3>'+title+'</h3><p>'+desc+'</p></div><span class="admin-section-count">'+list.length+'</span></div><div class="admin-account-list">'+(list.length?list.map(kind==='pending'?pendingCard:grantedCard).join(''):'<div class="admin-section-empty">Không có tài khoản nào trong nhóm này.</div>')+'</div></section>';
      }
      $('adminReportUsers').innerHTML='<div class="admin-account-sections">'+section('Chưa được cấp quyền','Tài khoản đã xuất hiện trong danh bạ nhưng chưa có quyền xem Báo cáo.',pendingRows,'pending')+section('Đã được phân quyền','Quản lý quyền Xem, Nhập liệu và Quản trị cho Chuyển viện & Tử vong.',grantedRows,'granted')+'</div>';
    }
    async function loadAdminReportUsers(force){
      if(!canManageReportPermissionsUi())return;
      if(!force&&state.adminReportUsers.length&&Date.now()-state.adminReportLoadedAt<ADMIN_CACHE_MS){renderAdminReportUsers();$('adminReportLoadState').hidden=true;return}
      if(state.adminReportPromise)return state.adminReportPromise;
      $('adminReportLoadState').hidden=false;$('adminReportLoadState').className='inline-state';$('adminReportLoadState').innerHTML='<span class="spinner"></span><span>Đang tải quyền Báo cáo...</span>';$('adminReportUsers').innerHTML='<div class="empty">Đang chuẩn bị danh sách tài khoản...</div>';
      state.adminReportPromise=(async function(){try{var result=await call('getAdminReportUsers');state.adminReportUsers=result.users||[];state.adminReportLoadedAt=Date.now();renderAdminReportUsers();$('adminReportLoadState').hidden=true;$('adminReportLoadState').textContent=''}catch(error){$('adminReportLoadState').hidden=false;$('adminReportLoadState').className='inline-state err';$('adminReportLoadState').textContent=error.message||String(error);$('adminReportUsers').innerHTML='<div class="empty">Không thể tải quyền Báo cáo. Vui lòng thử lại.</div>'}finally{state.adminReportPromise=null}})();return state.adminReportPromise;
    }
    async function adminReportPermission(id,role,active){
      var label=active?(role==='admin'?'Quản trị':'Nhập liệu'):'Thu hồi';
      var confirmed=await confirmAction({title:active?'Cấp quyền Báo cáo '+label+'?':'Thu hồi quyền Báo cáo?',message:active?'Quyền này dùng chung cho cả Báo cáo chuyển viện và Báo cáo tử vong.':'Tài khoản sẽ không còn truy cập phân hệ Báo cáo. Quyền Tổng hợp số liệu và HSBA không thay đổi.',confirmText:active?'Cấp quyền':'Thu hồi quyền',danger:!active});
      if(!confirmed)return;setBusy(true,active?'Đang cấp quyền Báo cáo...':'Đang thu hồi quyền Báo cáo...');
      try{var result=await call('adminSetReportPermission',id,role,active);message(result.message||'Đã cập nhật quyền Báo cáo.','ok');state.adminReportLoadedAt=0;await loadAdminReportUsers(true);if(state.authUser&&state.authUser.uid===id)await refreshCurrentSession()}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    function openDisplayNameDialog(id){
      var user=state.adminUsers.find(function(x){return x.id===id})||state.adminReportUsers.find(function(x){return x.id===id});if(!user)return;
      state.displayNameEditUid=id;$('displayNameEmail').textContent=user.email||'—';$('displayNameInput').value=user.name||'';$('displayNameError').textContent='';$('displayNameLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('displayNameInput').focus();$('displayNameInput').select()},0)
    }
    function closeDisplayNameDialog(){$('displayNameLayer').hidden=true;state.displayNameEditUid='';$('displayNameError').textContent='';if($('confirmLayer').hidden&&$('adjustLayer').hidden&&$('dataHistoryLayer').hidden)document.body.style.overflow=''}
    async function saveDisplayName(){var id=state.displayNameEditUid,name=$('displayNameInput').value;if(!id)return;$('displayNameSave').disabled=true;$('displayNameError').textContent='';try{var result=await call('adminSetDisplayName',id,name);message(result.message||'Đã lưu tên hiển thị.','ok');closeDisplayNameDialog();state.adminLoadedAt=0;state.adminReportLoadedAt=0;await Promise.all([loadAdminUsers(true).catch(function(){}),loadAdminReportUsers(true).catch(function(){})]);await refreshCurrentSession()}catch(error){$('displayNameError').textContent=error.message||String(error)}finally{$('displayNameSave').disabled=false}}

    function renderAdminCategories(){
      var query=String($('categorySearch').value||'').trim().toLowerCase();
      var rows=state.adminCategories.filter(function(item){return!query||String(item.code+' '+item.name+' '+item.group+' '+item.unit+' '+item.status).toLowerCase().indexOf(query)>=0});
      var inactive=state.adminCategories.filter(function(item){return item.status!=='Hoạt động'}).length;
      $('categoryCount').textContent=state.adminCategories.length+' chỉ tiêu';$('categoryInactiveCount').textContent=inactive+' ngừng sử dụng';
      if(!rows.length){$('adminCategories').innerHTML='<div class="empty">Không có chỉ tiêu phù hợp.</div>';return}
      $('adminCategories').innerHTML='<table class="category-table"><thead><tr><th>Mã</th><th>Tên chỉ tiêu</th><th>Nhóm</th><th>Đơn vị</th><th>Thứ tự</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>'+rows.map(function(item){
        var active=item.status==='Hoạt động';
        var actions='<button class="small-btn btn-soft category-action" data-kind="edit" data-code="'+esc(item.code)+'">Sửa</button>'+
          '<button class="small-btn '+(active?'btn-danger':'btn-soft')+' category-action" data-kind="status" data-code="'+esc(item.code)+'" data-value="'+(active?'Ngừng hoạt động':'Hoạt động')+'">'+(active?'Xóa':'Khôi phục')+'</button>';
        var mobileMore='<details class="category-mobile-more"><summary><span>Chi tiết</span><span aria-hidden="true">•••</span></summary><div class="category-mobile-detail-grid">'+
          '<div><span>Nhóm</span><strong>'+esc(item.group)+'</strong></div>'+
          '<div><span>Đơn vị</span><strong>'+esc(item.unit)+'</strong></div>'+
          '<div><span>Thứ tự</span><strong>'+Number(item.order||0)+'</strong></div>'+
          '<div><span>Trạng thái</span><strong>'+(active?'Hoạt động':'Ngừng sử dụng')+'</strong></div>'+
          '</div><div class="category-mobile-actions">'+actions+'</div></details>';
        return'<tr class="'+(active?'':'is-inactive')+'"><td data-label="Mã"><span class="category-code">'+esc(item.code)+'</span></td><td data-label="Tên chỉ tiêu"><b>'+esc(item.name)+'</b>'+mobileMore+'</td><td data-label="Nhóm">'+esc(item.group)+'</td><td data-label="Đơn vị">'+esc(item.unit)+'</td><td data-label="Thứ tự">'+Number(item.order||0)+'</td><td data-label="Trạng thái"><span class="status-pill'+(active?'':' pending')+'">'+(active?'Hoạt động':'Ngừng sử dụng')+'</span></td><td data-label="Thao tác">'+actions+'</td></tr>';
      }).join('')+'</tbody></table>';
    }
    async function loadAdminCategories(force){
      if(!state.user||state.user.role!=='Quản trị')return;
      if(!force&&state.adminCategories.length&&Date.now()-state.categoryLoadedAt<ADMIN_CACHE_MS){renderAdminCategories();$('categoryLoadState').hidden=true;return}
      if(state.categoryPromise)return state.categoryPromise;
      $('categoryLoadState').hidden=false;$('categoryLoadState').className='inline-state';$('categoryLoadState').innerHTML='<span class="spinner"></span><span>Đang tải danh mục chỉ tiêu...</span>';$('adminCategories').innerHTML='<div class="empty">Đang chuẩn bị danh mục...</div>';
      state.categoryPromise=(async function(){try{var result=await call('getAdminCategories',state.token);state.adminCategories=result.categories||[];state.categoryLoadedAt=Date.now();renderAdminCategories();$('categoryLoadState').hidden=true;$('categoryLoadState').textContent=''}catch(error){$('categoryLoadState').hidden=false;$('categoryLoadState').className='inline-state err';$('categoryLoadState').textContent=error.message||String(error);$('adminCategories').innerHTML='<div class="empty">Không thể tải danh mục chỉ tiêu. Vui lòng thử lại.</div>'}finally{state.categoryPromise=null}})();return state.categoryPromise;
    }
    function nextCategoryOrder(){var max=0;state.adminCategories.forEach(function(item){max=Math.max(max,Number(item.order||0))});return max+1}
    function openCategoryDialog(code){
      if(state.categorySaving)return;var item=code?state.adminCategories.find(function(row){return row.code===code}):null;
      state.editingCategoryCode=item?item.code:'';$('categoryDialogTitle').textContent=item?'Sửa chỉ tiêu':'Thêm chỉ tiêu';
      $('categoryName').value=item?item.name:'';$('categoryCode').value=item?item.code:'';$('categoryCode').disabled=!!item;
      $('categoryGroup').value=item?item.group:'Khác';$('categoryUnit').value=item?item.unit:'Lượt';$('categoryOrder').value=item?String(item.order||1):String(nextCategoryOrder());$('categoryStatus').value=item&&item.status!=='Hoạt động'?'Ngừng hoạt động':'Hoạt động';
      $('categoryCodeHelp').textContent=item?'Mã chỉ tiêu được giữ cố định để bảo toàn dữ liệu lịch sử.':'Có thể để trống; hệ thống sẽ tự tạo mã từ tên chỉ tiêu.';
      $('categoryError').textContent='';$('categorySave').disabled=false;$('categoryCancel').disabled=false;$('categorySave').textContent='Lưu chỉ tiêu';$('categoryLayer').hidden=false;document.body.style.overflow='hidden';window.setTimeout(function(){$('categoryName').focus()},0);
    }
    function closeCategoryDialog(){if(state.categorySaving)return;$('categoryLayer').hidden=true;state.editingCategoryCode='';$('categoryError').textContent='';if($('confirmLayer').hidden&&$('adjustLayer').hidden)document.body.style.overflow=''}
    function categoryPayload(){
      var name=String($('categoryName').value||'').trim(),group=String($('categoryGroup').value||'').trim(),unit=String($('categoryUnit').value||'').trim(),order=Number($('categoryOrder').value),status=$('categoryStatus').value;
      if(name.length<2)throw new Error('Vui lòng nhập tên chỉ tiêu từ 2 ký tự.');if(!group)throw new Error('Vui lòng nhập nhóm chỉ tiêu.');if(!unit)throw new Error('Vui lòng nhập đơn vị tính.');if(!isFinite(order)||order<1||Math.floor(order)!==order)throw new Error('Thứ tự hiển thị phải là số nguyên từ 1 trở lên.');
      return{originalCode:state.editingCategoryCode,code:$('categoryCode').value,name:name,group:group,unit:unit,order:order,status:status};
    }
    async function submitCategory(){
      if(state.categorySaving)return;var payload;try{payload=categoryPayload()}catch(error){$('categoryError').textContent=error.message||String(error);return}
      state.categorySaving=true;$('categoryError').textContent='';$('categorySave').disabled=true;$('categoryCancel').disabled=true;$('categorySave').innerHTML='<span class="spinner"></span><span>Đang lưu...</span>';
      try{var result=await call('adminSaveCategory',state.token,payload);state.categoryLoadedAt=0;await loadAdminCategories(true);state.lastSyncAt=0;await syncData(true,true);state.categorySaving=false;closeCategoryDialog();toast(result.message||'Đã lưu chỉ tiêu.','ok')}catch(error){$('categoryError').textContent=error.message||String(error)}finally{state.categorySaving=false;$('categorySave').disabled=false;$('categoryCancel').disabled=false;$('categorySave').textContent='Lưu chỉ tiêu'}
    }
    async function setCategoryStatus(code,status){
      var isDelete=status==='Ngừng hoạt động';var confirmed=await confirmAction({title:isDelete?'Xóa chỉ tiêu khỏi danh sách?':'Khôi phục chỉ tiêu?',message:isDelete?'Chỉ tiêu sẽ không còn xuất hiện ở Tổng quan và Nhập liệu. Số liệu lịch sử vẫn được giữ nguyên.':'Chỉ tiêu sẽ xuất hiện trở lại trên giao diện nhập liệu.',confirmText:isDelete?'Xóa chỉ tiêu':'Khôi phục',danger:isDelete});if(!confirmed)return;
      setBusy(true,isDelete?'Đang xóa chỉ tiêu...':'Đang khôi phục chỉ tiêu...');try{var result=await call('adminSetCategoryStatus',state.token,code,status);state.categoryLoadedAt=0;await loadAdminCategories(true);state.lastSyncAt=0;await syncData(true,true);toast(result.message||'Đã cập nhật chỉ tiêu.','ok')}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    async function adminStatus(id,status){
      var confirmed=await confirmAction({title:(status==='Khóa'?'Khóa':'Mở khóa')+' quyền Tổng hợp Y tế?',message:status==='Khóa'?'Tài khoản sẽ không dùng được Tổng hợp số liệu cho đến khi được mở quyền lại.':'Tài khoản sẽ được dùng lại Tổng hợp số liệu.',confirmText:status==='Khóa'?'Khóa quyền':'Mở quyền',danger:status==='Khóa'});
      if(!confirmed)return;setBusy(true,'Đang cập nhật quyền...');
      try{var result=await call('adminSetUserStatus',state.token,id,status);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminRole(id,role){
      var confirmed=await confirmAction({title:'Thay đổi vai trò Tổng hợp Y tế?',message:'Vai trò chỉ thay đổi trong phân hệ Tổng hợp số liệu.',confirmText:'Cập nhật vai trò',danger:role!=='Quản trị'});
      if(!confirmed)return;setBusy(true,'Đang cập nhật vai trò...');
      try{var result=await call('adminSetUserRole',state.token,id,role);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function approveRegistration(id,role){
      var confirmed=await confirmAction({title:'Cấp quyền '+role+'?',message:'Tài khoản sẽ được phép sử dụng Tổng hợp số liệu với vai trò '+role+'. Quyền HSBA không thay đổi.',confirmText:'Cấp quyền'});
      if(!confirmed)return;setBusy(true,'Đang cấp quyền...');
      try{var result=await call('adminApproveRegistration',id,role);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function rejectRegistration(id){
      var confirmed=await confirmAction({title:'Từ chối yêu cầu cấp quyền?',message:'Tài khoản vẫn tồn tại nhưng chưa được sử dụng Tổng hợp số liệu.',confirmText:'Từ chối',danger:true});
      if(!confirmed)return;setBusy(true,'Đang từ chối yêu cầu...');
      try{var result=await call('adminRejectRegistration',id);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminRevoke(id){
      var confirmed=await confirmAction({title:'Thu hồi quyền Tổng hợp số liệu?',message:'Tài khoản sẽ không còn sử dụng Tổng hợp số liệu cho đến khi được cấp lại. Firebase Authentication, quyền HSBA và lịch sử nghiệp vụ không bị xóa.',confirmText:'Thu hồi quyền',danger:true});
      if(!confirmed)return;setBusy(true,'Đang thu hồi quyền...');
      try{var result=await call('adminRevokeUser',state.token,id);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function adminDelete(id){
      var user=state.adminUsers.find(function(item){return item.id===id})||state.adminReportUsers.find(function(item){return item.id===id})||{};
      var name=user.name||user.email||'tài khoản này';
      var confirmed=await confirmAction({title:'Xóa '+name+' khỏi ứng dụng?',message:'Người này sẽ mất quyền truy cập các phân hệ Phòng Y tế đã được cấp. Firebase Authentication và toàn bộ lịch sử dữ liệu đã tạo vẫn được giữ lại.',confirmText:'Xóa khỏi ứng dụng',danger:true});
      if(!confirmed)return;setBusy(true,'Đang xóa tài khoản khỏi ứng dụng...');
      try{
        var result=await call('adminDeleteUser',state.token,id);
        message(result.message,'ok');
        state.adminLoadedAt=0;state.adminReportLoadedAt=0;
        await Promise.all([loadAdminUsers(true).catch(function(){}),loadAdminReportUsers(true).catch(function(){})]);
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    async function initializeUi(){
      window.parent.postMessage({type:'YTE_APP_READY',version:'9.5.7'},'*');setupDates();updateRangeFields();
      document.querySelectorAll('.nav-item').forEach(function(button){button.addEventListener('click',function(){showView(button.getAttribute('data-view'))})});
      document.querySelectorAll('.admin-tab').forEach(function(tab){tab.addEventListener('click',function(){showAdminSection(tab.getAttribute('data-admin-tab'))})});
      $('btnAccount').onclick=function(){showView('auth')};$('btnTopLogout').onclick=logout;$('btnSync').onclick=function(){syncData(false)};$('btnApply').onclick=function(){syncData(false)};$('rangeType').onchange=function(){updateRangeFields()};$('contentFilter').onchange=renderAll;
      $('btnGoogleLogin').onclick=loginGoogle;
      $('confirmAccept').onclick=function(){closeConfirm(true)};$('confirmCancel').onclick=function(){closeConfirm(false)};$('confirmLayer').addEventListener('click',function(event){if(event.target===$('confirmLayer'))closeConfirm(false)});
      $('adjustCancel').onclick=closeAdjustDialog;$('adjustSave').onclick=submitAdjustment;$('adjustLayer').addEventListener('click',function(event){if(event.target===$('adjustLayer'))closeAdjustDialog()});
      $('dataHistoryClose').onclick=closeDataHistoryDialog;$('dataHistoryFooterClose').onclick=closeDataHistoryDialog;$('dataHistoryLayer').addEventListener('click',function(event){if(event.target===$('dataHistoryLayer'))closeDataHistoryDialog()});$('deleteDailyCancel').onclick=closeDeleteDailyDialog;$('deleteDailyAccept').onclick=submitDeleteDaily;$('deleteDailyLayer').addEventListener('click',function(event){if(event.target===$('deleteDailyLayer'))closeDeleteDailyDialog()});
      $('categoryCancel').onclick=closeCategoryDialog;$('categorySave').onclick=submitCategory;$('categoryLayer').addEventListener('click',function(event){if(event.target===$('categoryLayer'))closeCategoryDialog()});
      document.addEventListener('keydown',function(event){if(event.key!=='Escape')return;if(!$('deleteDailyLayer').hidden)closeDeleteDailyDialog();else if(!$('dataHistoryLayer').hidden)closeDataHistoryDialog();else if(!$('confirmLayer').hidden)closeConfirm(false);else if(!$('adjustLayer').hidden)closeAdjustDialog();else if(!$('categoryLayer').hidden)closeCategoryDialog()});
      window.addEventListener('beforeunload',function(event){if(!quickEntryDirty())return;event.preventDefault();event.returnValue=''});
      $('btnLoadDay').onclick=manualReloadDay;$('entryDate').onchange=handleEntryDateChange;
      $('entryCategorySelect').onchange=function(){updateQuickEntrySelection(true)};$('btnSaveQuickEntry').onclick=submitQuickEntry;$('btnEntrySelectedAdjust').onclick=function(){var code=$('entryCategorySelect').value;if(code)openAdjustDialog(code)};$('btnEntrySelectedDelete').onclick=function(){var code=$('entryCategorySelect').value;if(code)openDeleteDailyDialog(code)};$('btnEntrySelectedHistory').onclick=function(){var code=$('entryCategorySelect').value;if(code)openDataHistoryDialog(code)};$('entryQuickValue').addEventListener('input',function(){if($('entryQuickError'))$('entryQuickError').textContent=''});$('entryQuickValue').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();submitQuickEntry()}});
      $('btnReloadUsers').onclick=function(){loadAdminUsers(true)};$('adminSearch').oninput=renderAdminUsers;$('adminUsers').addEventListener('click',function(event){var button=event.target.closest('.admin-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id'),value=button.getAttribute('data-value'),card=button.closest('.admin-account-card');if(kind==='display-name'){openDisplayNameDialog(id);return}if(kind==='approve-selected'){var select=card&&card.querySelector('.admin-role-select');if(select)approveRegistration(id,select.value);return}if(kind==='save-role'){var roleSelect=card&&card.querySelector('.admin-role-select');if(roleSelect)adminRole(id,roleSelect.value);return}if(kind==='status')adminStatus(id,value);if(kind==='role')adminRole(id,value);if(kind==='approve-viewer')approveRegistration(id,'Xem');if(kind==='approve-entry')approveRegistration(id,'Nhập liệu');if(kind==='approve-admin')approveRegistration(id,'Quản trị');if(kind==='reject-registration')rejectRegistration(id);if(kind==='revoke')adminRevoke(id);if(kind==='delete')adminDelete(id)});
      $('btnReloadAdminReportUsers').onclick=function(){loadAdminReportUsers(true)};$('adminReportSearch').oninput=renderAdminReportUsers;$('adminReportUsers').addEventListener('click',function(event){var button=event.target.closest('.admin-report-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id'),value=button.getAttribute('data-value'),card=button.closest('.admin-account-card');if(kind==='display-name'){openDisplayNameDialog(id);return}if(kind==='grant-selected'){var select=card&&card.querySelector('.admin-report-role-select');if(select)adminReportPermission(id,select.value,true);return}if(kind==='save-role'){var roleSelect=card&&card.querySelector('.admin-report-role-select');if(roleSelect)adminReportPermission(id,roleSelect.value,true);return}if(kind==='grant-viewer')adminReportPermission(id,'viewer',true);if(kind==='grant-entry')adminReportPermission(id,'nhaplieu',true);if(kind==='grant-admin')adminReportPermission(id,'admin',true);if(kind==='role')adminReportPermission(id,value,true);if(kind==='revoke')adminReportPermission(id,'nhaplieu',false);if(kind==='delete')adminDelete(id)});
      $('displayNameCancel').onclick=closeDisplayNameDialog;$('displayNameCloseX').onclick=closeDisplayNameDialog;$('displayNameSave').onclick=saveDisplayName;$('displayNameLayer').addEventListener('click',function(event){if(event.target===$('displayNameLayer'))closeDisplayNameDialog()});
      $('btnAddCategory').onclick=function(){openCategoryDialog('')};$('btnReloadCategories').onclick=function(){loadAdminCategories(true)};$('categorySearch').oninput=renderAdminCategories;$('adminCategories').addEventListener('click',function(event){var button=event.target.closest('.category-action');if(!button)return;var kind=button.getAttribute('data-kind'),code=button.getAttribute('data-code'),value=button.getAttribute('data-value');if(kind==='edit')openCategoryDialog(code);if(kind==='status')setCategoryStatus(code,value)});
      document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-state.lastSyncAt>90000)syncData(true)});window.addEventListener('focus',function(){if(Date.now()-state.lastSyncAt>90000)syncData(true)});
      await Promise.all([restore(),syncData(false)]);startCategoryRealtime();startDashboardRealtime(false);updateAuthUi();onAuthStateChanged(firebaseAuth,function(user){if(!user&&state.authUser){state.authUser=null;state.user=null;updateAuthUi()}});
      state.syncTimer=setInterval(function(){if(!document.hidden)syncData(true)},AUTO_SYNC_MS);
    }

    function startUi(){
      initializeUi().catch(function(error){
        console.error('Khởi tạo ứng dụng thất bại:', error);
        var box=document.getElementById('message');
        if(box){box.innerHTML='<div class="message err">Không thể khởi tạo ứng dụng. Vui lòng tải lại trang. Nếu lỗi vẫn còn, mở F12 → Console và gửi nội dung lỗi cho quản trị viên.</div>';}
      });
    }

    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',startUi,{once:true});
    }else{
      startUi();
    }
