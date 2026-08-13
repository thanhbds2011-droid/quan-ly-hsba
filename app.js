'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
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
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : '';
}
function dbRole(role) {
  return role === 'Quản trị' || role === 'admin' ? 'admin' : 'nhaplieu';
}
function uiReportRole(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Chỉ xem' : 'Chưa cấp';
}
function dbReportRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'quản trị' || value === 'quan tri') return 'admin';
  if (value === 'viewer' || value === 'chỉ xem' || value === 'chi xem') return 'viewer';
  return 'nhaplieu';
}
function uiStatus(active) {
  return active === true ? 'Hoạt động' : 'Khóa';
}
function snapshotObject(snapshot) {
  return snapshot && snapshot.exists() ? (snapshot.val() || {}) : {};
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
    displayName: String(user.displayName || user.email || '').slice(0, 150),
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
  if (!user) throw new Error('Chưa xác định được tài khoản Firebase.');
  const requestRef = ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${user.uid}`);
  const snap = await get(requestRef);
  const existing = snapshotObject(snap);
  if (existing.status === 'pending' || existing.status === 'approved') return existing;

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

  const reportActive = validModulePermission(reportPermission);

  if (permission && (permission.role === 'admin' || permission.role === 'nhaplieu')) {
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
          name: user.displayName || user.email || '',
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
          name: user.displayName || user.email || '',
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
        name: user.displayName || user.email || '',
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
        name: user.displayName || user.email || '',
        provider: providerId(user)
      },
      user: null,
      reportPermission: reportPermission,
      categories: []
    };
  }

  // Giữ tương thích với các yêu cầu cấp quyền Tổng hợp số liệu đã tồn tại trước đây,
  // nhưng không tự tạo yêu cầu mới. Người dùng mới được ghi vào yTeApp/nguoiDung
  // để Quản trị viên có thể cấp đúng phân hệ.
  const requestSnap = await get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy/${user.uid}`));
  const request = snapshotObject(requestSnap);
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
      name: user.displayName || user.email || '',
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
  user.appPermission = permission;
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
      status: item.trangThai || 'Hoạt động'
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
      status: item.trangThai || 'Hoạt động'
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
  const dataQuery = query(
    ref(firebaseDatabase, `${ROOT}/congKhai/soLieuTheoNgay`),
    orderByKey(),
    startAt(from),
    endAt(to)
  );
  const snap = await get(dataQuery);
  const raw = snapshotObject(snap);
  const records = [];
  Object.keys(raw).sort().forEach((date) => {
    const day = raw[date] || {};
    Object.keys(day).forEach((code) => {
      const item = day[code] || {};
      records.push({
        id: `${date}-${code}`,
        date,
        code,
        name: item.ten || code,
        value: Number(item.giaTri || 0),
        note: '',
        updatedAt: item.updatedAt || 0,
        version: Number(item.version || 0)
      });
    });
  });
  return { success: true, from, to, categories, records, generatedAt: formatDateTime(new Date()) };
}

async function getDailyDataFirebase(dateValue) {
  await requireAppUser();
  const date = String(dateValue || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày nhập số liệu không hợp lệ.');
  const snap = await get(ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}`));
  const raw = snapshotObject(snap);
  const records = Object.keys(raw).map((code) => {
    const item = raw[code] || {};
    return {
      id: `${date}-${code}`,
      date,
      code,
      name: item.ten || code,
      value: Number(item.giaTri || 0),
      note: item.ghiChu || '',
      updatedBy: item.updatedByName || '',
      updatedAt: item.updatedAt ? formatDateTime(item.updatedAt) : '',
      version: Number(item.version || 0)
    };
  });
  return { success: true, date, records };
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
  const recordRef = ref(firebaseDatabase, `${ROOT}/soLieuTheoNgay/${date}/${code}`);
  const currentSnap = await get(recordRef);
  const current = snapshotObject(currentSnap);
  const currentVersion = Number(current.version || 0);
  if (currentVersion !== expectedVersion) {
    throw new Error('Số liệu vừa được cập nhật từ nơi khác. Vui lòng tải lại dữ liệu ngày.');
  }
  const beforeValue = currentSnap.exists() ? Number(current.giaTri || 0) : 0;
  if (currentSnap.exists() && beforeValue === newValue) throw new Error('Số liệu mới đang bằng số hiện tại.');

  const nextVersion = expectedVersion + 1;
  const action = currentSnap.exists() ? 'Điều chỉnh' : 'Ghi nhận';
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
  updates[`${ROOT}/lichSu/${monthKey(date)}/${historyRef.key}`] = {
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
  updates[`${ROOT}/nhatKy/${monthKey(date)}/${logRef.key}`] = {
    action: action === 'Ghi nhận' ? 'Ghi nhận số liệu' : 'Điều chỉnh số liệu',
    content: `Ngày ${date} - ${category.ten || code}: ${currentSnap.exists() ? beforeValue : 'Chưa ghi nhận'} → ${newValue}`,
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
      throw new Error('Số liệu vừa được cập nhật từ nơi khác. Vui lòng tải lại dữ liệu ngày.');
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
      version: nextVersion
    },
    message: action === 'Ghi nhận' ? 'Đã ghi nhận số liệu.' : 'Đã lưu thay đổi.'
  };
}

async function registerAccountFirebase(payload) {
  payload = payload || {};
  const fullName = String(payload.fullName || '').trim();
  const username = normalizeUsername(payload.username);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');
  if (fullName.length < 2) throw new Error('Vui lòng nhập đầy đủ họ và tên.');
  if (!email || !email.includes('@')) throw new Error('Địa chỉ email chưa hợp lệ.');
  if (password.length < 6) throw new Error('Mật khẩu Firebase phải có ít nhất 6 ký tự.');

  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  await updateProfile(credential.user, { displayName: fullName });
  const result = await resolveApplicationAccess(credential.user, { displayName: fullName, username });
  result.message = 'Đăng ký Firebase thành công. Yêu cầu cấp quyền Tổng hợp Y tế đã được gửi đến Quản trị viên.';
  return result;
}

async function loginAccountFirebase(payload) {
  payload = payload || {};
  const email = normalizeEmail(payload.identifier);
  const password = String(payload.password || '');
  if (!email || !password) throw new Error('Vui lòng nhập email và mật khẩu.');
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return resolveApplicationAccess(credential.user);
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

async function requestPasswordResetFirebase(identifier) {
  const email = normalizeEmail(identifier);
  if (!email || !email.includes('@')) throw new Error('Vui lòng nhập email đã đăng ký.');
  await sendPasswordResetEmail(firebaseAuth, email);
  return { success: true, message: 'Firebase đã gửi liên kết đặt lại mật khẩu đến email của bạn.' };
}

async function changePasswordFirebase(payload) {
  const user = firebaseAuth.currentUser;
  if (!user || !user.email) throw new Error('Vui lòng đăng nhập lại.');
  if (providerId(user) !== 'password') {
    throw new Error('Tài khoản đăng nhập bằng Google không sử dụng mật khẩu riêng của ứng dụng.');
  }
  const currentPassword = String(payload && payload.currentPassword || '');
  const newPassword = String(payload && payload.newPassword || '');
  if (newPassword.length < 6) throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
  return { success: true, message: 'Đã đổi mật khẩu Firebase.' };
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
  const [permissionSnap, requestSnap, directorySnap] = await Promise.all([
    get(ref(firebaseDatabase, `${ROOT}/phanQuyen`)),
    get(ref(firebaseDatabase, `${ROOT}/yeuCauDangKy`)),
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`))
  ]);
  const permissions = snapshotObject(permissionSnap);
  const requests = snapshotObject(requestSnap);
  const directory = snapshotObject(directorySnap);
  const allUids = new Set([
    ...Object.keys(directory),
    ...Object.keys(permissions),
    ...Object.keys(requests)
  ]);
  const users = [];
  allUids.forEach((uid) => {
    const item = permissions[uid] || {};
    const request = requests[uid] || {};
    const profile = directory[uid] || {};
    const hasPermission = !!permissions[uid];
    const requestStatus = request.status || (hasPermission ? 'approved' : 'unassigned');
    users.push({
      id: uid,
      uid,
      name: item.displayName || request.displayName || profile.displayName || item.email || request.email || profile.email || '',
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
  const snap = await get(permissionRef);
  if (!snap.exists()) throw new Error('Không tìm thấy quyền tài khoản.');
  await update(permissionRef, { role, updatedAt: Date.now(), updatedByUid: admin.uid });
  const item = snap.val() || {};
  await writeAuditLog(admin, 'Thay đổi vai trò', `${item.email || uid} → ${uiRole(role)}`, '');
  return { success: true, message: 'Đã cập nhật vai trò Tổng hợp Y tế.' };
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
  return { success: true, message: 'Đã thu hồi quyền Tổng hợp Y tế. Firebase Authentication và quyền HSBA (nếu có) được giữ nguyên.' };
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
  const [directorySnap, permissionSnap] = await Promise.all([
    get(ref(firebaseDatabase, `${YTE_APP_ROOT}/nguoiDung`)),
    get(ref(firebaseDatabase, `${REPORT_ROOT}/phanQuyen`))
  ]);
  const directory = snapshotObject(directorySnap);
  const permissions = snapshotObject(permissionSnap);
  const uids = new Set([...Object.keys(directory), ...Object.keys(permissions)]);
  const users = Array.from(uids).map((uid) => {
    const profile = directory[uid] || {};
    const permission = permissions[uid] || {};
    return {
      id: uid,
      uid,
      name: permission.displayName || profile.displayName || permission.email || profile.email || '',
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

async function firebaseCall(name, ...args) {
  await authPersistenceReady;
  await authReady;
  switch (name) {
    case 'getDashboardData': return getDashboardDataFirebase(args[0]);
    case 'restoreSession': return restoreSessionFirebase();
    case 'loginAccount': return loginAccountFirebase(args[0]);
    case 'googleLoginAccount': return loginGoogleFirebase();
    case 'registerAccount': return registerAccountFirebase(args[0]);
    case 'requestPasswordReset': return requestPasswordResetFirebase(args[0]);
    case 'logoutSession': return logoutFirebase();
    case 'getDailyData': return getDailyDataFirebase(args[0]);
    case 'adjustDailyData': return adjustDailyDataFirebase(args[0]);
    case 'changePassword': return changePasswordFirebase(args[0]);
    case 'getAdminUsers': return getAdminUsersFirebase();
    case 'getAdminCategories': return getAdminCategoriesFirebase();
    case 'adminSaveCategory': return adminSaveCategoryFirebase(args[1] || args[0]);
    case 'adminSetCategoryStatus': return adminSetCategoryStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserStatus': return adminSetUserStatusFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminSetUserRole': return adminSetUserRoleFirebase(args[1] || args[0], args[2] || args[1]);
    case 'adminApproveRegistration': return adminApproveRegistrationFirebase(args[0], args[1]);
    case 'adminRejectRegistration': return adminRejectRegistrationFirebase(args[0]);
    case 'adminDeleteUser': return adminRevokeUserFirebase(args[1] || args[0]);
    case 'getAdminReportUsers': return getAdminReportUsersFirebase();
    case 'adminSetReportPermission': return adminSetReportPermissionFirebase(args[0], args[1], args[2]);
    default: throw new Error(`Chức năng Firebase không hợp lệ: ${name}`);
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
      adjustingCode:'',adjustSaving:false
    };

    function $(id){return document.getElementById(id)}
    function call(name){
      var args=Array.prototype.slice.call(arguments,1);
      return firebaseCall.apply(null,[name].concat(args)).catch(function(error){
        var messageText=error&&error.message?error.message:String(error||'Có lỗi xảy ra.');
        if(/auth\/invalid-credential|auth\/invalid-login-credentials|auth\/wrong-password|auth\/user-not-found/.test(String(error&&error.code||'')+' '+messageText))messageText='Email hoặc mật khẩu không đúng.';
        if(/auth\/email-already-in-use/.test(String(error&&error.code||'')))messageText='Email này đã tồn tại trên Firebase Authentication.';
        if(/PERMISSION_DENIED|permission_denied/i.test(messageText))messageText='Bạn không có quyền thực hiện thao tác này hoặc dữ liệu vừa thay đổi. Vui lòng tải lại.';
        throw new Error(messageText);
      });
    }
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
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
    function hasReportAccess(){return!!(state.reportPermission&&state.reportPermission.active===true&&['admin','nhaplieu','viewer'].indexOf(state.reportPermission.role)>=0)}
    function isTongHopAdmin(){return!!(state.user&&state.user.role==='Quản trị')}
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
      var hasTongHop=!!state.user;
      if(name==='admin'&&!isAdmin){name=state.authUser?defaultPrivateView():'dashboard';message('Bạn không có quyền truy cập chức năng này.','err')}
      if(name==='dashboard'&&state.authUser&&!hasTongHop)name=defaultPrivateView();
      if(name==='entry'&&!hasTongHop)name=state.authUser?defaultPrivateView():'auth';
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
          if(currentViewName()==='entry')renderIndicators();
          if(!silent)toast('Dữ liệu đã được cập nhật.','ok');
        }catch(error){if(!silent)message(error.message||String(error),'err')}
        finally{if(!silent)setBusy(false);state.syncPromise=null}
      })();return state.syncPromise;
    }
    function aggregate(){var totals={};state.records.forEach(function(record){totals[record.code]=(totals[record.code]||0)+Number(record.value||0)});return totals}
    function categoryMatches(category,query){return!query||String(category.name+' '+category.group+' '+category.unit).toLowerCase().indexOf(query)>=0}
    function renderAll(){renderSummary(aggregate())}
    function recordedCodeMap(){var map={};state.records.forEach(function(record){map[record.code]=true});return map}
    function renderSummary(totals){
      var query=String($('dashboardSearch').value||'').trim().toLowerCase(),recorded=recordedCodeMap(),categories=selectedCategories().filter(function(c){return categoryMatches(c,query)});
      if(!categories.length){$('summaryCards').innerHTML='<div class="empty" style="grid-column:1/-1">Không có chỉ tiêu phù hợp.</div>';return}
      $('summaryCards').innerHTML=categories.map(function(c){
        var hasRecord=!!recorded[c.code],value=Number(totals[c.code]||0),status=hasRecord?(value>0?'Có phát sinh':'Đã ghi nhận 0'):'Chưa ghi nhận',statusClass=hasRecord?(value>0?'':' zero'):' missing';
        return'<article class="summary-item'+(hasRecord?'':' is-unrecorded')+'"><div><h3>'+esc(c.name)+'</h3><p>'+esc(c.group)+' · '+esc(c.unit)+'</p></div><div class="summary-value"><span class="summary-number'+(hasRecord?'':' is-missing')+'">'+(hasRecord?value.toLocaleString('vi-VN'):'—')+'</span><span class="data-status'+statusClass+'">'+status+'</span></div></article>';
      }).join('');
    }

    function cacheDaily(date,records){var byCode={};(records||[]).forEach(function(record){byCode[record.code]=record});state.entryCache[date]={byCode:byCode,loadedAt:Date.now()};return byCode}
    function hydrateDailyFromResult(result){if(result&&result.dailyDate){cacheDaily(result.dailyDate,result.dailyRecords||[]);if($('entryDate').value===result.dailyDate)applyDailyCache(result.dailyDate)}}
    function applyDailyCache(date){var cache=state.entryCache[date];if(!cache)return false;state.dailyByCode=cache.byCode||{};state.loadedEntryDate=date;renderIndicators();$('loadedDate').textContent='';return true}
    function cacheIsFresh(date){return!!(state.entryCache[date]&&Date.now()-state.entryCache[date].loadedAt<ENTRY_CACHE_MS)}
    function setEntryLoadState(text,type,spinning){var box=$('entryLoadState');if(!spinning&&type==='ok'){box.hidden=true;box.textContent='';return}box.hidden=!text;box.className='inline-state '+(type||'');box.innerHTML=(spinning?'<span class="spinner"></span>':'')+'<span>'+esc(text||'')+'</span>'}

    function updateAuthUi(){
      var authenticated=!!state.authUser,loggedIn=!!state.user,isAdmin=isAnyAppAdmin();
      var tongHopAdmin=isTongHopAdmin()||isOwnerAdmin(),reportAdmin=canManageReportPermissionsUi();
      var hasReport=hasReportAccess();
      var hasAnyAccess=loggedIn||hasReport;
      $('btnAccount').hidden=authenticated;$('btnTopLogout').hidden=!authenticated;
      if($('btnSync'))$('btnSync').hidden=authenticated&&!loggedIn;
      if($('navDashboard'))$('navDashboard').hidden=authenticated&&!loggedIn;
      if($('navHome'))$('navHome').hidden=true;
      $('navEntry').hidden=!loggedIn;$('navAdmin').hidden=!isAdmin;
      if($('navReports'))$('navReports').hidden=!hasReport;
      if($('adminUsersTab'))$('adminUsersTab').hidden=!tongHopAdmin;
      if($('adminCategoriesTab'))$('adminCategoriesTab').hidden=!tongHopAdmin;
      if($('adminReportPermissionsTab'))$('adminReportPermissionsTab').hidden=!reportAdmin;
      $('userGreeting').hidden=!authenticated;
      $('userGreeting').textContent=authenticated
        ? 'Xin chào, '+(loggedIn?state.user.name:(state.authUser.name||state.authUser.email))+(hasAnyAccess?'':' · Chờ cấp quyền')
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
        state.entryCache={};state.dailyByCode={};state.loadedEntryDate='';state.adminUsers=[];state.adminLoadedAt=0;state.adminCategories=[];state.categoryLoadedAt=0;
        if(currentViewName()==='entry')showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='admin'&&!isAdmin)showView(authenticated?defaultPrivateView():'dashboard');
        if(currentViewName()==='home'&&hasReport)showView('reports');
        return;
      }
      if(!isAdmin&&currentViewName()==='admin')showView(defaultPrivateView());
      if(currentViewName()==='home')showView('dashboard');
      $('entryUserName').textContent=state.user.name;
      $('entryUserMeta').textContent=state.user.email+' · '+state.user.role;
      $('btnChangePassword').hidden=state.user.provider!=='password';
      $('changePasswordBox').hidden=true;
      if(!applyDailyCache($('entryDate').value))loadDay({silent:true,force:false,notify:false});
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

    async function restore(){
      try{
        var result=await call('restoreSession');applySessionResult(result);
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterRestore==='function')await window.YTE_REPORTS.routeAfterRestore(result);
      }
      catch(error){state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi()}
    }
    async function login(){
      setBusy(true,'Đang đăng nhập Firebase...');
      try{
        var result=await call('loginAccount',{identifier:$('loginIdentifier').value,password:$('loginPassword').value,entryDate:$('entryDate').value});
        applySessionResult(result);clearMessage();
        if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.routeAfterLogin==='function')await window.YTE_REPORTS.routeAfterLogin(result);else showView('dashboard');
        var hasReport=!!(result.reportPermission&&result.reportPermission.active===true&&['admin','nhaplieu','viewer'].indexOf(result.reportPermission.role)>=0);
        if(result.active||hasReport)toast('Đăng nhập thành công.','ok');else clearMessage();
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
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
    async function register(){
      if($('regPassword').value!==$('regConfirm').value){message('Mật khẩu nhập lại chưa khớp.','err');return}
      setBusy(true,'Đang tạo tài khoản Firebase...');
      try{
        var result=await call('registerAccount',{fullName:$('regName').value,username:$('regUsername').value,email:$('regEmail').value,password:$('regPassword').value,entryDate:$('entryDate').value});
        applySessionResult(result);showView('dashboard');message(result.message||'Đã gửi yêu cầu cấp quyền.','warn');
      }catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function requestReset(){
      setBusy(true,'Đang gửi email đặt lại mật khẩu...');
      try{var result=await call('requestPasswordReset',$('forgotIdentifier').value);message(result.message||'Đã gửi email đặt lại mật khẩu.','ok');switchAuth('login')}
      catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }
    async function logout(){
      try{await call('logoutSession')}catch(error){}
      state.authUser=null;state.user=null;state.reportPermission=null;updateAuthUi();
      if(window.YTE_REPORTS&&typeof window.YTE_REPORTS.onLogout==='function')window.YTE_REPORTS.onLogout();
      showView('dashboard');message('Đã đăng xuất.','ok')
    }
    function switchAuth(name){document.querySelectorAll('.auth-tab').forEach(function(tab){tab.classList.toggle('active',tab.getAttribute('data-auth-tab')===name)});document.querySelectorAll('.auth-panel').forEach(function(panel){panel.classList.remove('active')});$(name+'Panel').classList.add('active')}

    function activateEntryView(){
      if(!state.user)return
      var date=$('entryDate').value;if(applyDailyCache(date)){if(cacheIsFresh(date))setEntryLoadState('','ok',false);else{setEntryLoadState('Đang kiểm tra dữ liệu mới nhất...','',true);loadDay({silent:true,force:true,notify:false})}}else{renderIndicators();setEntryLoadState('Đang chuẩn bị dữ liệu ngày '+fmtDate(date)+'...','',true);loadDay({silent:true,force:false,notify:false})}
    }
    function updateEntryStats(){
      var positiveCount=0,zeroCount=0,recordedCount=0,total=state.categories.length;
      state.categories.forEach(function(category){
        var record=state.dailyByCode[category.code];
        if(!record)return;
        recordedCount++;
        if(Number(record.value||0)>0)positiveCount++;else zeroCount++;
      });
      $('positiveIndicatorCount').textContent=String(positiveCount);
      $('zeroIndicatorCount').textContent=String(zeroCount);
      $('unrecordedIndicatorCount').textContent=String(Math.max(0,total-recordedCount));
    }
    function renderIndicators(){
      if(!state.categories.length){
        $('indicatorGrid').innerHTML='<div class="empty">Chưa có danh mục chỉ tiêu.</div>';
        updateEntryStats();
        return;
      }
      var rows=state.categories.map(function(category){
        var record=state.dailyByCode[category.code];
        var hasRecord=!!record;
        var current=hasRecord?Number(record.value||0):0;
        var savedState=hasRecord?(current>0?'Có phát sinh':'Đã ghi nhận 0'):'Chưa ghi nhận';
        var savedClass=hasRecord?(current>0?'':' zero'):' unrecorded';
        var buttonLabel='✎ Chỉnh sửa';
        return'<div id="c_'+esc(category.code)+'" class="indicator-row" data-search="'+esc((category.name+' '+category.group+' '+category.unit).toLowerCase())+'">'+
          '<div class="entry-cell" data-label="Chỉ tiêu"><div><span class="indicator-name">'+esc(category.name)+'</span><span class="indicator-group">'+esc(category.group)+' · <span class="unit-pill">'+esc(category.unit)+'</span></span></div></div>'+
          '<div class="entry-cell" data-label="Số liệu hiện tại"><div class="saved-value-wrap"><span class="saved-amount'+savedClass+'">'+(hasRecord?current.toLocaleString('vi-VN'):'—')+'</span><span class="saved-state">'+savedState+'</span></div></div>'+
          '<div class="entry-cell" data-label="Thao tác"><div class="row-actions"><button class="adjust-btn adjust-data" data-adjust-code="'+esc(category.code)+'" type="button">'+buttonLabel+'</button></div></div>'+
        '</div>';
      });
      $('indicatorGrid').innerHTML=rows.length?rows.join(''):'<div class="empty">Không có chỉ tiêu phù hợp.</div>';
      updateEntryStats();
      filterIndicatorRows();
    }
    function filterIndicatorRows(){var query=String($('entrySearch').value||'').trim().toLowerCase(),visible=0;document.querySelectorAll('#indicatorGrid .indicator-row').forEach(function(row){var show=!query||String(row.getAttribute('data-search')||'').indexOf(query)>=0;row.hidden=!show;if(show)visible++});var noMatch=$('entryNoMatch');if(!visible&&state.categories.length){if(!noMatch)$('indicatorGrid').insertAdjacentHTML('beforeend','<div id="entryNoMatch" class="empty">Không có chỉ tiêu phù hợp.</div>')}else if(noMatch)noMatch.remove()}
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
      if(state.adjustSaving)return;
      await loadDay({silent:true,force:true,notify:true});
    }
    async function handleEntryDateChange(){
      if(state.adjustSaving){
        $('entryDate').value=state.loadedEntryDate||$('entryDate').value;
        toast('Dữ liệu đang được lưu. Vui lòng chờ hoàn tất.','warn');
        return;
      }
      state.dailyByCode={};state.loadedEntryDate='';renderIndicators();
      if(!applyDailyCache($('entryDate').value))await loadDay({silent:true,force:false,notify:false});
      else if(!cacheIsFresh($('entryDate').value))loadDay({silent:true,force:true,notify:false});
    }
    function setAdjustmentSaving(active){
      state.adjustSaving=active===true;
      var card=$('adjustLayer').querySelector('.adjust-card');
      var saveButton=$('adjustSave');
      var cancelButton=$('adjustCancel');
      var valueInput=$('adjustNewValue');
      var progress=$('adjustProgress');
      $('adjustLayer').setAttribute('aria-busy',state.adjustSaving?'true':'false');
      if(card)card.classList.toggle('is-saving',state.adjustSaving);
      saveButton.disabled=state.adjustSaving;
      cancelButton.disabled=state.adjustSaving;
      valueInput.disabled=state.adjustSaving;
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
      $('adjustTitle').textContent='Chỉnh sửa '+category.name;
      $('adjustContext').textContent='Ngày '+fmtDate($('entryDate').value)+' · Đơn vị: '+category.unit+' · Có thể nhập 0.';
      $('adjustCurrentValue').textContent=record?Number(record.value||0).toLocaleString('vi-VN')+' '+category.unit:'Chưa ghi nhận';
      $('adjustNewValue').value=record?String(Number(record.value||0)):'';
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
      var reason=record?'Cập nhật trực tiếp trên ứng dụng':'Ghi nhận số liệu lần đầu';
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
        $('loadedDate').textContent='';
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

    async function saveNewPassword(){if($('newPassword').value!==$('newPasswordConfirm').value){message('Mật khẩu nhập lại chưa khớp.','err');return}setBusy(true,'Đang đổi mật khẩu...');try{var result=await call('changePassword',{token:state.token,currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});$('changePasswordBox').hidden=true;message(result.message||'Đã đổi mật khẩu.','ok');await logout()}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}}

    function renderAdminUsers(){
      var query=String($('adminSearch').value||'').trim().toLowerCase();
      var rows=state.adminUsers.filter(function(user){return!query||String(user.name+' '+user.username+' '+user.email+' '+user.role+' '+user.status).toLowerCase().indexOf(query)>=0});
      var pendingCount=state.adminUsers.filter(function(user){return user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned')}).length;
      $('adminCount').textContent=state.adminUsers.length+' tài khoản';
      $('adminPending').hidden=pendingCount===0;$('adminPending').textContent=pendingCount+' chờ duyệt';
      $('adminNote').hidden=pendingCount===0;
      $('adminNote').textContent=pendingCount?'Có '+pendingCount+' tài khoản đã đăng nhập Google và chưa được cấp quyền Tổng hợp số liệu.':'';
      if(!rows.length){$('adminUsers').innerHTML='<div class="empty">Không có tài khoản phù hợp.</div>';return}
      $('adminUsers').innerHTML='<table class="admin-table admin-user-table"><thead><tr><th>Họ tên</th><th>Tài khoản</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Yêu cầu</th><th>Thao tác</th></tr></thead><tbody>'+rows.map(function(user){
        var isSelf=state.user&&user.id===state.user.id;
        var actions='';
        if(user.isPending&&(user.requestStatus==='pending'||user.requestStatus==='unassigned')){
          actions+='<button class="small-btn btn-soft admin-action" data-kind="approve-entry" data-id="'+esc(user.id)+'">Duyệt Nhập liệu</button>';
          actions+='<button class="small-btn btn-primary admin-action" data-kind="approve-admin" data-id="'+esc(user.id)+'">Duyệt Quản trị</button>';
          if(user.requestStatus==='pending')actions+='<button class="small-btn btn-danger admin-action" data-kind="reject-registration" data-id="'+esc(user.id)+'">Từ chối</button>';
        }else if(!user.isPending){
          var nextStatus=user.status==='Hoạt động'?'Khóa':'Hoạt động';
          var nextRole=user.role==='Quản trị'?'Nhập liệu':'Quản trị';
          actions+='<button class="small-btn btn-soft admin-action" data-kind="status" data-id="'+esc(user.id)+'" data-value="'+esc(nextStatus)+'"'+(isSelf?' disabled':'')+'>'+(user.status==='Hoạt động'?'Khóa':'Mở khóa')+'</button>';
          actions+='<button class="small-btn btn-soft admin-action" data-kind="role" data-id="'+esc(user.id)+'" data-value="'+esc(nextRole)+'"'+(isSelf?' disabled':'')+'>'+(user.role==='Quản trị'?'Hạ quyền':'Cấp quản trị')+'</button>';
          actions+='<button class="small-btn btn-danger admin-action" data-kind="delete" data-id="'+esc(user.id)+'"'+(isSelf?' disabled':'')+'>Thu hồi quyền</button>';
        }
        var requestText=user.requestStatus==='rejected'?'Đã từ chối':(user.requestStatus==='unassigned'?'Chưa cấp':'Chờ duyệt');
        var requestLabel=user.isPending
          ? '<span class="status-pill pending">'+requestText+'</span><div class="meta">'+esc(user.requestedAt||'')+'</div>'
          : '<span class="status-pill">'+esc(user.requestStatus==='approved'?'Đã duyệt':'Đang sử dụng')+'</span>';
        return'<tr><td data-label="Họ tên">'+esc(user.name)+(isSelf?' <span class="meta">(Bạn)</span>':'')+'</td><td data-label="Tài khoản">'+esc(user.username||'—')+'</td><td data-label="Email">'+esc(user.email)+'</td><td data-label="Vai trò">'+esc(user.role||'Chưa cấp')+'</td><td data-label="Trạng thái">'+esc(user.status)+'</td><td data-label="Yêu cầu">'+requestLabel+'</td><td data-label="Thao tác">'+actions+'</td></tr>';
      }).join('')+'</tbody></table>';
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
      $('adminReportUsers').innerHTML='<table class="admin-table admin-report-table"><thead><tr><th>Họ tên</th><th>Email</th><th>Quyền Báo cáo</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Thao tác</th></tr></thead><tbody>'+rows.map(function(user){
        var isSelf=user.id===currentUid,protectSelf=isSelf&&!canChangeSelf,actions='';
        if(!user.active){
          actions+='<button class="small-btn btn-soft admin-report-action" data-kind="grant-entry" data-id="'+esc(user.id)+'">Cấp Nhập liệu</button>';
          actions+='<button class="small-btn btn-primary admin-report-action" data-kind="grant-admin" data-id="'+esc(user.id)+'">Cấp Quản trị</button>';
        }else{
          var nextRole=user.role==='admin'?'nhaplieu':'admin';
          actions+='<button class="small-btn btn-soft admin-report-action" data-kind="role" data-value="'+esc(nextRole)+'" data-id="'+esc(user.id)+'"'+(protectSelf?' disabled':'')+'>'+(user.role==='admin'?'Hạ quyền':'Cấp quản trị')+'</button>';
          actions+='<button class="small-btn btn-danger admin-report-action" data-kind="revoke" data-id="'+esc(user.id)+'"'+(protectSelf?' disabled':'')+'>Thu hồi</button>';
        }
        return'<tr><td data-label="Họ tên">'+esc(user.name||'—')+(isSelf?' <span class="meta">(Bạn)</span>':'')+'</td><td data-label="Email">'+esc(user.email||'—')+'</td><td data-label="Quyền Báo cáo">'+esc(user.roleLabel||'Chưa cấp')+'</td><td data-label="Trạng thái">'+esc(user.status||'Chưa cấp')+'</td><td data-label="Đăng nhập gần nhất">'+esc(user.lastLogin||'—')+'</td><td data-label="Thao tác">'+actions+'</td></tr>';
      }).join('')+'</tbody></table>';
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
        return'<tr class="'+(active?'':'is-inactive')+'"><td data-label="Mã"><span class="category-code">'+esc(item.code)+'</span></td><td data-label="Tên chỉ tiêu"><b>'+esc(item.name)+'</b></td><td data-label="Nhóm">'+esc(item.group)+'</td><td data-label="Đơn vị">'+esc(item.unit)+'</td><td data-label="Thứ tự">'+Number(item.order||0)+'</td><td data-label="Trạng thái"><span class="status-pill'+(active?'':' pending')+'">'+(active?'Hoạt động':'Ngừng sử dụng')+'</span></td><td data-label="Thao tác">'+actions+'</td></tr>';
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
    async function adminDelete(id){
      var confirmed=await confirmAction({title:'Thu hồi quyền Tổng hợp số liệu?',message:'Quyền sử dụng Tổng hợp số liệu sẽ bị thu hồi.',confirmText:'Thu hồi quyền',danger:true});
      if(!confirmed)return;setBusy(true,'Đang thu hồi quyền...');
      try{var result=await call('adminDeleteUser',state.token,id);message(result.message,'ok');state.adminLoadedAt=0;await loadAdminUsers(true)}catch(error){message(error.message||String(error),'err')}finally{setBusy(false)}
    }

    async function initializeUi(){
      window.parent.postMessage({type:'YTE_APP_READY',version:'8.1.0'},'*');setupDates();updateRangeFields();
      document.querySelectorAll('.nav-item').forEach(function(button){button.addEventListener('click',function(){showView(button.getAttribute('data-view'))})});
      document.querySelectorAll('.auth-tab').forEach(function(tab){tab.addEventListener('click',function(){switchAuth(tab.getAttribute('data-auth-tab'))})});
      document.querySelectorAll('.admin-tab').forEach(function(tab){tab.addEventListener('click',function(){showAdminSection(tab.getAttribute('data-admin-tab'))})});
      $('btnAccount').onclick=function(){showView('auth')};$('btnTopLogout').onclick=logout;$('btnSync').onclick=function(){syncData(false)};$('btnApply').onclick=function(){syncData(false)};$('rangeType').onchange=updateRangeFields;$('contentFilter').onchange=renderAll;$('dashboardSearch').oninput=function(){renderSummary(aggregate())};
      $('btnLogin').onclick=login;$('btnGoogleLogin').onclick=loginGoogle;$('btnRegister').onclick=register;$('btnRequestReset').onclick=requestReset;
      $('confirmAccept').onclick=function(){closeConfirm(true)};$('confirmCancel').onclick=function(){closeConfirm(false)};$('confirmLayer').addEventListener('click',function(event){if(event.target===$('confirmLayer'))closeConfirm(false)});
      $('adjustCancel').onclick=closeAdjustDialog;$('adjustSave').onclick=submitAdjustment;$('adjustLayer').addEventListener('click',function(event){if(event.target===$('adjustLayer'))closeAdjustDialog()});
      $('categoryCancel').onclick=closeCategoryDialog;$('categorySave').onclick=submitCategory;$('categoryLayer').addEventListener('click',function(event){if(event.target===$('categoryLayer'))closeCategoryDialog()});
      document.addEventListener('keydown',function(event){if(event.key!=='Escape')return;if(!$('confirmLayer').hidden)closeConfirm(false);else if(!$('adjustLayer').hidden)closeAdjustDialog();else if(!$('categoryLayer').hidden)closeCategoryDialog()});
      $('btnLoadDay').onclick=manualReloadDay;$('entryDate').onchange=handleEntryDateChange;$('entrySearch').oninput=filterIndicatorRows;
      $('indicatorGrid').addEventListener('click',function(event){var button=event.target.closest('.adjust-data');if(button)openAdjustDialog(button.getAttribute('data-adjust-code'))});
      $('btnChangePassword').onclick=function(){$('changePasswordBox').hidden=false};$('btnCloseChange').onclick=function(){$('changePasswordBox').hidden=true};$('btnSavePassword').onclick=saveNewPassword;
      $('btnReloadUsers').onclick=function(){loadAdminUsers(true)};$('adminSearch').oninput=renderAdminUsers;$('adminUsers').addEventListener('click',function(event){var button=event.target.closest('.admin-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id'),value=button.getAttribute('data-value');if(kind==='status')adminStatus(id,value);if(kind==='role')adminRole(id,value);if(kind==='approve-entry')approveRegistration(id,'Nhập liệu');if(kind==='approve-admin')approveRegistration(id,'Quản trị');if(kind==='reject-registration')rejectRegistration(id);if(kind==='delete')adminDelete(id)});
      $('btnReloadAdminReportUsers').onclick=function(){loadAdminReportUsers(true)};$('adminReportSearch').oninput=renderAdminReportUsers;$('adminReportUsers').addEventListener('click',function(event){var button=event.target.closest('.admin-report-action');if(!button)return;var kind=button.getAttribute('data-kind'),id=button.getAttribute('data-id'),value=button.getAttribute('data-value');if(kind==='grant-entry')adminReportPermission(id,'nhaplieu',true);if(kind==='grant-admin')adminReportPermission(id,'admin',true);if(kind==='role')adminReportPermission(id,value,true);if(kind==='revoke')adminReportPermission(id,'nhaplieu',false)});
      $('btnAddCategory').onclick=function(){openCategoryDialog('')};$('btnReloadCategories').onclick=function(){loadAdminCategories(true)};$('categorySearch').oninput=renderAdminCategories;$('adminCategories').addEventListener('click',function(event){var button=event.target.closest('.category-action');if(!button)return;var kind=button.getAttribute('data-kind'),code=button.getAttribute('data-code'),value=button.getAttribute('data-value');if(kind==='edit')openCategoryDialog(code);if(kind==='status')setCategoryStatus(code,value)});
      document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-state.lastSyncAt>90000)syncData(true)});window.addEventListener('focus',function(){if(Date.now()-state.lastSyncAt>90000)syncData(true)});
      await Promise.all([restore(),syncData(false)]);updateAuthUi();onAuthStateChanged(firebaseAuth,function(user){if(!user&&state.authUser){state.authUser=null;state.user=null;updateAuthUi()}});
      if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
        navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(function(){});
      }
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
