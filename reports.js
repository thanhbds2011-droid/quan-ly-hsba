'use strict';

import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  push,
  query,
  ref,
  orderByChild,
  startAt,
  endAt,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const CFG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(CFG.OWNER_EMAIL || '').trim().toLowerCase();
const REPORT_ROOT = 'baoCaoYTe';
const YTE_APP_ROOT = 'yTeApp';
const TONG_HOP_ROOT = 'tongHopYTe';

const app = getApps().length ? getApp() : initializeApp(CFG.FIREBASE);
const auth = getAuth(app);
const db = getDatabase(app);

const reportState = {
  user: null,
  permission: null,
  tongHopPermission: null,
  type: 'CHUYEN_VIEN',
  mode: 'list',
  reports: [],
  users: [],
  editingId: '',
  readonly: false,
  loading: false,
  initialized: false
};

function $(id) { return document.getElementById(id); }
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/\s+/g, ' ');
}
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function firstDayOfMonthIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}
function fmtDate(value) {
  const p = String(value || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(value || '');
}
function fmtDateTime(value) {
  const n = Number(value || 0);
  if (!n) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(n));
}
function monthKey(dateIso) { return String(dateIso || todayIso()).slice(0, 7); }
function roleLabel(role) {
  return role === 'admin' ? 'Quản trị' : role === 'nhaplieu' ? 'Nhập liệu' : role === 'viewer' ? 'Chỉ xem' : 'Chưa cấp';
}
function typeLabel(type) { return type === 'TU_VONG' ? 'Tử vong' : 'Chuyển viện'; }
function isOwner(user) { return !!(user && normalizeEmail(user.email) === OWNER_EMAIL); }
function validPermission(permission) {
  return !!(permission && permission.active === true && ['admin', 'nhaplieu', 'viewer'].includes(permission.role));
}
function canEditReport() {
  return validPermission(reportState.permission) && ['admin', 'nhaplieu'].includes(reportState.permission.role);
}
function canAdminReport() {
  return !!(reportState.user && (isOwner(reportState.user) || (validPermission(reportState.permission) && reportState.permission.role === 'admin')));
}
function snapshotObject(snap) { return snap && snap.exists() ? (snap.val() || {}) : {}; }
function showToast(text, type) {
  const box = $('toast');
  if (!box) return;
  box.textContent = text;
  box.className = 'toast ' + (type || 'ok');
  box.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.hidden = true; }, 3500);
}
function showInlineState(id, text, type, spinning) {
  const box = $(id);
  if (!box) return;
  box.hidden = !text;
  box.className = 'inline-state ' + (type || '');
  box.innerHTML = text ? (spinning ? '<span class="spinner"></span>' : '') + '<span>' + esc(text) + '</span>' : '';
}
function activateView(name) {
  const button = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (button) button.click();
}
function clearGlobalMessage() {
  const box = $('message');
  if (box) box.innerHTML = '';
}

async function ensureDirectoryProfile(user) {
  if (!user) return;
  const profileRef = ref(db, `${YTE_APP_ROOT}/nguoiDung/${user.uid}`);
  const snap = await get(profileRef);
  const old = snapshotObject(snap);
  const now = Date.now();
  await update(profileRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || user.email || '').slice(0, 150),
    photoURL: String(user.photoURL || old.photoURL || '').slice(0, 1000),
    provider: 'google.com',
    active: true,
    createdAt: old.createdAt || now,
    updatedAt: now,
    lastLoginAt: now
  });
}

async function ensureOwnerPermission(user) {
  if (!isOwner(user)) return;
  const permissionRef = ref(db, `${REPORT_ROOT}/phanQuyen/${user.uid}`);
  const snap = await get(permissionRef);
  const old = snapshotObject(snap);
  if (old.active === true && old.role === 'admin') return;
  const now = Date.now();
  await update(permissionRef, {
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || old.displayName || user.email || '').slice(0, 150),
    role: 'admin',
    active: true,
    source: old.source || 'OWNER_BOOTSTRAP',
    createdAt: old.createdAt || now,
    updatedAt: now
  });
}

async function refreshAccess() {
  const user = auth.currentUser;
  reportState.user = user || null;
  if (!user) {
    reportState.permission = null;
    reportState.tongHopPermission = null;
    updateModuleUi();
    return;
  }
  await ensureOwnerPermission(user);
  const [reportSnap, tongHopSnap] = await Promise.all([
    get(ref(db, `${REPORT_ROOT}/phanQuyen/${user.uid}`)),
    get(ref(db, `${TONG_HOP_ROOT}/phanQuyen/${user.uid}`))
  ]);
  reportState.permission = reportSnap.exists() ? reportSnap.val() : null;
  reportState.tongHopPermission = tongHopSnap.exists() ? tongHopSnap.val() : null;
  updateModuleUi();
}

function updateModuleUi(external) {
  if (external && external.authUser && !reportState.user) {
    reportState.user = auth.currentUser || null;
  }
  if (external && Object.prototype.hasOwnProperty.call(external, 'reportPermission')) {
    reportState.permission = external.reportPermission || reportState.permission;
  }

  const authenticated = !!(reportState.user || auth.currentUser);
  const tongHopActive = external && typeof external.tongHopActive === 'boolean'
    ? external.tongHopActive
    : !!(reportState.tongHopPermission && reportState.tongHopPermission.active === true &&
      ['admin', 'nhaplieu'].includes(reportState.tongHopPermission.role));
  const reportActive = validPermission(reportState.permission);

  if ($('navHome')) $('navHome').hidden = true;
  if ($('navReports')) $('navReports').hidden = !reportActive;
  if ($('moduleTongHopCard')) $('moduleTongHopCard').hidden = !tongHopActive;
  if ($('moduleReportCard')) $('moduleReportCard').hidden = !reportActive;
  if ($('noModuleAccess')) $('noModuleAccess').hidden = !authenticated || tongHopActive || reportActive;

  const user = reportState.user || auth.currentUser;
  if ($('homeWelcome')) {
    $('homeWelcome').textContent = user
      ? 'Xin chào, ' + String(user.displayName || user.email || '')
      : 'Chọn chức năng';
  }

  if ($('reportPermissionModeBtn')) $('reportPermissionModeBtn').hidden = true;
  if ($('btnNewReport')) {
    $('btnNewReport').hidden = !canEditReport() || reportState.type === 'CHUYEN_VIEN';
    $('btnNewReport').textContent = '+ Lập báo cáo tử vong';
  }
}

async function routeAfterLogin(result) {
  await refreshAccess();
  clearGlobalMessage();
  const tongHopActive = !!(result && result.active === true);
  const reportActive = validPermission(reportState.permission);
  if (tongHopActive) activateView('dashboard');
  else if (reportActive) activateView('reports');
  else activateView('home');
}

async function routeAfterRestore(result) {
  await refreshAccess();
  const current = document.querySelector('.view.active');
  const currentName = current ? current.id.replace(/View$/, '') : '';
  const tongHopActive = !!(result && result.active === true);
  const reportActive = validPermission(reportState.permission);
  if (!auth.currentUser) return;
  if (currentName === 'home' && (tongHopActive || reportActive)) {
    activateView(tongHopActive ? 'dashboard' : 'reports');
    return;
  }
  if (currentName === 'dashboard' || currentName === 'auth' || !currentName) {
    if (!tongHopActive && reportActive) activateView('reports');
    else if (!tongHopActive && !reportActive) activateView('home');
  }
}

function onLogout() {
  reportState.user = null;
  reportState.permission = null;
  reportState.tongHopPermission = null;
  reportState.reports = [];
  reportState.users = [];
  updateModuleUi();
}

function onViewChanged(name) {
  if (name === 'home') updateModuleUi();
  if (name === 'reports') activateReportsView();
}

window.YTE_REPORTS = {
  routeAfterLogin,
  routeAfterRestore,
  updateModuleUi,
  onLogout,
  onViewChanged,
  refreshAccess
};

function reportFilterValues() {
  const from = $('reportFromDate').value;
  const to = $('reportToDate').value;
  if (!from || !to) throw new Error('Vui lòng chọn đầy đủ khoảng thời gian.');
  if (from > to) throw new Error('Từ ngày không được lớn hơn đến ngày.');
  return {
    from,
    to,
    search: normalizeSearch($('reportSearch').value || ''),
    type: reportState.type
  };
}

async function loadReports(force) {
  if (!validPermission(reportState.permission)) {
    $('reportList').innerHTML = '<div class="empty">Tài khoản chưa được cấp quyền Báo cáo.</div>';
    return;
  }
  if (reportState.loading && !force) return;
  let filter;
  try { filter = reportFilterValues(); }
  catch (error) { showInlineState('reportLoadState', error.message, 'err', false); return; }

  reportState.loading = true;
  showInlineState('reportLoadState', 'Đang tải báo cáo...', '', true);
  try {
    const q = query(
      ref(db, `${REPORT_ROOT}/baoCao`),
      orderByChild('ngayBaoCao'),
      startAt(filter.from),
      endAt(filter.to + '\uf8ff')
    );
    const snap = await get(q);
    const raw = snapshotObject(snap);
    reportState.reports = Object.keys(raw).map((id) => ({ id, ...(raw[id] || {}) }));
    renderReports();
    showInlineState('reportLoadState', '', '', false);
  } catch (error) {
    console.error(error);
    showInlineState('reportLoadState', error.message || String(error), 'err', false);
    $('reportList').innerHTML = '<div class="empty">Không thể tải dữ liệu báo cáo.</div>';
  } finally {
    reportState.loading = false;
  }
}

function filteredReports() {
  const filter = reportFilterValues();
  return reportState.reports
    .filter((item) => item.trangThai !== 'deleted')
    .filter((item) => item.loaiBaoCao === filter.type)
    .filter((item) => {
      if (!filter.search) return true;
      const haystack = normalizeSearch([
        item.hoTenBenhNhan, item.hoTenNorm, item.diaChi, item.chanDoan,
        item.nguyenNhan, item.noiChuyen, item.noiDen, item.noiTuVong,
        item.ghiChu, item.createdByName
      ].join(' '));
      return haystack.includes(filter.search);
    })
    .sort((a, b) => String(b.ngayBaoCao || '').localeCompare(String(a.ngayBaoCao || '')) ||
      Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function renderReports() {
  let rows = [];
  try { rows = filteredReports(); } catch (error) { return; }

  const allActive = reportState.reports.filter((item) => item.trangThai !== 'deleted');
  $('reportFilteredCount').textContent = String(rows.length);
  $('reportTransferCount').textContent = String(allActive.filter((item) => item.loaiBaoCao === 'CHUYEN_VIEN').length);
  $('reportDeathCount').textContent = String(allActive.filter((item) => item.loaiBaoCao === 'TU_VONG').length);

  if (!rows.length) {
    $('reportList').innerHTML = '<div class="empty">Chưa có báo cáo phù hợp trong khoảng thời gian đã chọn.</div>';
    return;
  }

  $('reportList').innerHTML = rows.map((item) => {
    const isDeath = item.loaiBaoCao === 'TU_VONG';
    const destination = isDeath ? (item.noiTuVong || '—') : (item.noiDen || '—');
    const summary = isDeath ? (item.nguyenNhan || '') : (item.chanDoan || '');
    const canEdit = canEditReport();
    const isAdmin = canAdminReport();
    return `<article class="report-row ${isDeath ? 'is-death' : 'is-transfer'}">
      <div class="report-row-mark">${isDeath ? 'TV' : 'CV'}</div>
      <div class="report-row-main">
        <div class="report-row-title">
          <strong>${esc(item.hoTenBenhNhan || 'Chưa có họ tên')}</strong>
          <span class="report-type-pill">${esc(typeLabel(item.loaiBaoCao))}</span>
        </div>
        <div class="report-row-meta">
          <span>${esc(item.gioiTinh || '—')}</span>
          <span>${esc(item.namSinh || '—')}</span>
          <span>${esc(fmtDate(item.ngayBaoCao))}</span>
          <span>${esc(destination)}</span>
        </div>
        ${summary ? `<p>${esc(summary)}</p>` : ''}
        <div class="report-row-by">Người nhập: ${esc(item.createdByName || item.legacyNguoiNhap || '—')}</div>
      </div>
      <div class="report-row-actions">
        <button class="small-btn btn-soft report-action" data-kind="view" data-id="${esc(item.id)}">Xem</button>
        ${canEdit ? `<button class="small-btn btn-soft report-action" data-kind="edit" data-id="${esc(item.id)}">Chỉnh sửa</button>` : ''}
        ${isAdmin ? `<button class="small-btn btn-danger report-action" data-kind="delete" data-id="${esc(item.id)}">Xóa</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function setReportType(type) {
  reportState.type = type === 'TU_VONG' ? 'TU_VONG' : 'CHUYEN_VIEN';
  const isTransfer = reportState.type === 'CHUYEN_VIEN';
  document.querySelectorAll('.report-type-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-report-type') === reportState.type);
  });
  if ($('transferJourneyPanel')) $('transferJourneyPanel').hidden = !isTransfer;
  if ($('reportListPanel')) $('reportListPanel').hidden = isTransfer;
  if ($('reportPermissionPanel')) $('reportPermissionPanel').hidden = true;
  if ($('reportModeRow')) $('reportModeRow').hidden = true;
  if ($('btnNewReport')) {
    $('btnNewReport').hidden = isTransfer || !canEditReport();
    $('btnNewReport').textContent = '+ Lập báo cáo tử vong';
  }
  if ($('reportPageTitle')) $('reportPageTitle').textContent = isTransfer ? 'Theo dõi hành trình chuyển viện' : 'Báo cáo tử vong';
  if ($('reportPageSubtitle')) $('reportPageSubtitle').textContent = isTransfer
    ? 'Theo dõi đối tượng từ khi rời Trung tâm đến khi trở về hoặc kết thúc hành trình.'
    : 'Lập, tra cứu và quản lý báo cáo tử vong theo phân công chuyên môn.';
  if (isTransfer) {
    if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.setVisible === 'function') window.YTE_JOURNEYS.setVisible(true);
  } else {
    if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.setVisible === 'function') window.YTE_JOURNEYS.setVisible(false);
    loadReports(false);
  }
}

function setReportMode(mode) {
  mode = mode === 'permissions' && canAdminReport() ? 'permissions' : 'list';
  reportState.mode = mode;
  document.querySelectorAll('.report-mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-report-mode') === mode);
  });
  $('reportListPanel').hidden = mode !== 'list';
  $('reportPermissionPanel').hidden = mode !== 'permissions';
  if (mode === 'permissions') loadReportUsers(true);
}

async function activateReportsView() {
  await refreshAccess();
  if (!validPermission(reportState.permission) && !isOwner(reportState.user)) {
    activateView('home');
    return;
  }
  $('reportFromDate').value = $('reportFromDate').value || firstDayOfMonthIso();
  $('reportToDate').value = $('reportToDate').value || todayIso();
  $('reportPermissionModeBtn').hidden = true;
  if (!canAdminReport() && reportState.mode === 'permissions') setReportMode('list');
  setReportType(reportState.type);
  if (reportState.type === 'CHUYEN_VIEN' && window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.activate === 'function') {
    await window.YTE_JOURNEYS.activate();
  } else if (reportState.type === 'TU_VONG') {
    await loadReports(false);
  }
}

function resetReportForm(type) {
  reportState.editingId = '';
  reportState.readonly = false;
  reportState.type = type === 'TU_VONG' ? 'TU_VONG' : 'CHUYEN_VIEN';
  $('reportPatientName').value = '';
  $('reportGender').value = '';
  $('reportBirthYear').value = '';
  $('reportAddress').value = 'TTBTXH TÂN HIỆP';
  $('reportDiagnosis').value = '';
  $('reportTransferDate').value = todayIso();
  $('reportTransferFrom').value = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
  $('reportTransferTo').value = '';
  $('reportCause').value = '';
  $('reportDeathDate').value = todayIso();
  $('reportDeathPlace').value = '';
  $('reportNote').value = '';
  $('reportFormError').textContent = '';
  updateReportFormKind();
}

function updateReportFormKind() {
  document.querySelectorAll('.report-kind-fields').forEach((box) => {
    box.hidden = box.getAttribute('data-kind') !== reportState.type;
  });
  $('reportDialogBadge').textContent = typeLabel(reportState.type).toUpperCase();
}

function setReportFormReadonly(readonly) {
  reportState.readonly = !!readonly;
  const fields = $('reportLayer').querySelectorAll('input, select, textarea');
  fields.forEach((field) => { field.disabled = !!readonly; });
  $('reportSave').hidden = !!readonly;
  $('reportCancel').textContent = readonly ? 'Đóng' : 'Quay lại';
}

function openNewReport() {
  if (!canEditReport()) return;
  if (reportState.type === 'CHUYEN_VIEN') {
    if (window.YTE_JOURNEYS && typeof window.YTE_JOURNEYS.setSubView === 'function') window.YTE_JOURNEYS.setSubView('create');
    return;
  }
  resetReportForm(reportState.type);
  $('reportDialogTitle').textContent = 'Lập báo cáo ' + typeLabel(reportState.type).toLowerCase();
  $('reportReporter').textContent = String(reportState.user?.displayName || reportState.user?.email || '');
  setReportFormReadonly(false);
  $('reportLayer').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('reportPatientName').focus(), 0);
}

function populateReportForm(item, readonly) {
  reportState.editingId = item.id;
  reportState.type = item.loaiBaoCao === 'TU_VONG' ? 'TU_VONG' : 'CHUYEN_VIEN';
  updateReportFormKind();
  $('reportPatientName').value = item.hoTenBenhNhan || '';
  $('reportGender').value = item.gioiTinh || '';
  $('reportBirthYear').value = item.namSinh || '';
  $('reportAddress').value = item.diaChi || '';
  $('reportDiagnosis').value = item.chanDoan || '';
  $('reportTransferDate').value = item.ngayChuyenVien || item.ngayBaoCao || '';
  $('reportTransferFrom').value = item.noiChuyen || '';
  $('reportTransferTo').value = item.noiDen || '';
  $('reportCause').value = item.nguyenNhan || '';
  $('reportDeathDate').value = item.ngayTuVong || item.ngayBaoCao || '';
  $('reportDeathPlace').value = item.noiTuVong || '';
  $('reportNote').value = item.ghiChu || '';
  $('reportReporter').textContent = item.createdByName || item.legacyNguoiNhap || '—';
  $('reportDialogTitle').textContent = (readonly ? 'Chi tiết ' : 'Chỉnh sửa ') + typeLabel(reportState.type).toLowerCase();
  $('reportFormError').textContent = '';
  setReportFormReadonly(readonly);
  $('reportLayer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeReportForm() {
  $('reportLayer').hidden = true;
  document.body.style.overflow = '';
  reportState.editingId = '';
  reportState.readonly = false;
  $('reportFormError').textContent = '';
}

function reportPayload() {
  const name = String($('reportPatientName').value || '').trim();
  const gender = $('reportGender').value;
  const birth = String($('reportBirthYear').value || '').trim();
  const address = String($('reportAddress').value || '').trim();
  const note = String($('reportNote').value || '').trim();
  if (name.length < 2) throw new Error('Vui lòng nhập họ tên bệnh nhân.');
  if (!['Nam', 'Nữ'].includes(gender)) throw new Error('Vui lòng chọn giới tính.');
  if (birth.length > 50) throw new Error('Năm sinh / ngày sinh quá dài.');
  if (address.length > 300) throw new Error('Địa chỉ quá dài.');

  const common = {
    hoTenBenhNhan: name,
    hoTenNorm: normalizeSearch(name),
    gioiTinh: gender,
    namSinh: birth,
    diaChi: address,
    ghiChu: note
  };

  if (reportState.type === 'CHUYEN_VIEN') {
    const diagnosis = String($('reportDiagnosis').value || '').trim();
    const date = $('reportTransferDate').value;
    const from = String($('reportTransferFrom').value || '').trim();
    const to = String($('reportTransferTo').value || '').trim();
    if (!diagnosis) throw new Error('Vui lòng nhập chẩn đoán.');
    if (!date) throw new Error('Vui lòng chọn ngày chuyển viện.');
    if (!from) throw new Error('Vui lòng nhập nơi chuyển.');
    if (!to) throw new Error('Vui lòng nhập nơi đến.');
    return {
      ...common,
      loaiBaoCao: 'CHUYEN_VIEN',
      ngayBaoCao: date,
      chanDoan: diagnosis,
      ngayChuyenVien: date,
      noiChuyen: from,
      noiDen: to
    };
  }

  const cause = String($('reportCause').value || '').trim();
  const date = $('reportDeathDate').value;
  const place = String($('reportDeathPlace').value || '').trim();
  if (!cause) throw new Error('Vui lòng nhập nguyên nhân tử vong.');
  if (!date) throw new Error('Vui lòng chọn ngày tử vong.');
  if (!place) throw new Error('Vui lòng nhập nơi tử vong.');
  return {
    ...common,
    loaiBaoCao: 'TU_VONG',
    ngayBaoCao: date,
    nguyenNhan: cause,
    ngayTuVong: date,
    noiTuVong: place
  };
}

async function saveReport() {
  if (!canEditReport() || reportState.readonly) return;
  let payload;
  try { payload = reportPayload(); }
  catch (error) { $('reportFormError').textContent = error.message || String(error); return; }

  const user = auth.currentUser;
  if (!user) { $('reportFormError').textContent = 'Vui lòng đăng nhập lại.'; return; }
  $('reportSave').disabled = true;
  $('reportSave').textContent = 'Đang lưu...';
  try {
    const existing = reportState.editingId
      ? reportState.reports.find((item) => item.id === reportState.editingId) || null
      : null;
    if (existing && existing.trangThai === 'deleted') throw new Error('Báo cáo đã bị xóa và không thể chỉnh sửa.');

    const now = Date.now();
    const generated = reportState.editingId || ((payload.loaiBaoCao === 'TU_VONG' ? 'TV_' : 'CV_') + push(ref(db, `${REPORT_ROOT}/baoCao`)).key);
    const record = {
      ...payload,
      id: generated,
      trangThai: 'active',
      version: existing ? Number(existing.version || 0) + 1 : 1,
      createdAt: existing ? Number(existing.createdAt || now) : now,
      createdByUid: existing ? String(existing.createdByUid || user.uid) : user.uid,
      createdByEmail: existing ? String(existing.createdByEmail || normalizeEmail(user.email)) : normalizeEmail(user.email),
      createdByName: existing ? String(existing.createdByName || user.displayName || user.email || '') : String(user.displayName || user.email || ''),
      updatedAt: now,
      updatedByUid: user.uid,
      updatedByEmail: normalizeEmail(user.email),
      updatedByName: String(user.displayName || user.email || ''),
      source: existing ? String(existing.source || 'APP') : 'APP'
    };

    const historyId = push(ref(db, `${REPORT_ROOT}/lichSu/${generated}`)).key;
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${monthKey(record.ngayBaoCao)}`)).key;
    const updates = {};
    updates[`${REPORT_ROOT}/baoCao/${generated}`] = record;
    updates[`${REPORT_ROOT}/lichSu/${generated}/${historyId}`] = {
      reportId: generated,
      loaiBaoCao: record.loaiBaoCao,
      action: existing ? 'UPDATE' : 'CREATE',
      beforeJson: JSON.stringify(existing || {}),
      afterJson: JSON.stringify(record),
      uid: user.uid,
      email: normalizeEmail(user.email),
      displayName: String(user.displayName || user.email || ''),
      role: reportState.permission.role,
      createdAt: now
    };
    updates[`${REPORT_ROOT}/nhatKy/${monthKey(record.ngayBaoCao)}/${logId}`] = {
      action: existing ? 'Cập nhật báo cáo' : 'Lập báo cáo',
      content: `${typeLabel(record.loaiBaoCao)} · ${record.hoTenBenhNhan}`,
      reportId: generated,
      loaiBaoCao: record.loaiBaoCao,
      dataDate: record.ngayBaoCao,
      uid: user.uid,
      email: normalizeEmail(user.email),
      displayName: String(user.displayName || user.email || ''),
      role: reportState.permission.role,
      createdAt: now
    };
    await update(ref(db), updates);
    closeReportForm();
    showToast(existing ? 'Đã cập nhật báo cáo.' : 'Đã lưu báo cáo.', 'ok');
    await loadReports(true);
  } catch (error) {
    console.error(error);
    $('reportFormError').textContent = error.message || String(error);
  } finally {
    $('reportSave').disabled = false;
    $('reportSave').textContent = 'Lưu báo cáo';
  }
}

async function softDeleteReport(id) {
  if (!canAdminReport()) return;
  const item = reportState.reports.find((row) => row.id === id);
  if (!item) return;
  if (!window.confirm(`Xóa báo cáo ${typeLabel(item.loaiBaoCao)} của ${item.hoTenBenhNhan}? Dữ liệu sẽ được xóa mềm và vẫn còn trong lịch sử.`)) return;
  const user = auth.currentUser;
  const now = Date.now();
  const record = {
    ...item,
    trangThai: 'deleted',
    deletedAt: now,
    deletedByUid: user.uid,
    deletedByName: String(user.displayName || user.email || ''),
    updatedAt: now,
    updatedByUid: user.uid,
    updatedByEmail: normalizeEmail(user.email),
    updatedByName: String(user.displayName || user.email || ''),
    version: Number(item.version || 0) + 1
  };
  const historyId = push(ref(db, `${REPORT_ROOT}/lichSu/${id}`)).key;
  const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${monthKey(item.ngayBaoCao)}`)).key;
  const updates = {};
  updates[`${REPORT_ROOT}/baoCao/${id}`] = record;
  updates[`${REPORT_ROOT}/lichSu/${id}/${historyId}`] = {
    reportId: id,
    loaiBaoCao: item.loaiBaoCao,
    action: 'DELETE',
    beforeJson: JSON.stringify(item),
    afterJson: JSON.stringify(record),
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || user.email || ''),
    role: reportState.permission.role,
    createdAt: now
  };
  updates[`${REPORT_ROOT}/nhatKy/${monthKey(item.ngayBaoCao)}/${logId}`] = {
    action: 'Xóa báo cáo',
    content: `${typeLabel(item.loaiBaoCao)} · ${item.hoTenBenhNhan}`,
    reportId: id,
    loaiBaoCao: item.loaiBaoCao,
    dataDate: item.ngayBaoCao,
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName: String(user.displayName || user.email || ''),
    role: reportState.permission.role,
    createdAt: now
  };
  await update(ref(db), updates);
  showToast('Đã xóa báo cáo khỏi danh sách.', 'ok');
  await loadReports(true);
}

async function loadReportUsers(force) {
  if (!canAdminReport()) return;
  showInlineState('reportUserLoadState', 'Đang tải danh sách tài khoản...', '', true);
  try {
    const [directorySnap, permissionSnap] = await Promise.all([
      get(ref(db, `${YTE_APP_ROOT}/nguoiDung`)),
      get(ref(db, `${REPORT_ROOT}/phanQuyen`))
    ]);
    const directory = snapshotObject(directorySnap);
    const permissions = snapshotObject(permissionSnap);
    const uids = new Set([...Object.keys(directory), ...Object.keys(permissions)]);
    reportState.users = Array.from(uids).map((uid) => {
      const profile = directory[uid] || {};
      const permission = permissions[uid] || {};
      return {
        uid,
        name: permission.displayName || profile.displayName || permission.email || profile.email || '',
        email: permission.email || profile.email || '',
        role: permission.role || '',
        active: permission.active === true,
        lastLoginAt: profile.lastLoginAt || 0
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
    renderReportUsers();
    showInlineState('reportUserLoadState', '', '', false);
  } catch (error) {
    console.error(error);
    showInlineState('reportUserLoadState', error.message || String(error), 'err', false);
  }
}

function renderReportUsers() {
  const q = normalizeSearch($('reportUserSearch').value || '');
  const rows = reportState.users.filter((item) => !q || normalizeSearch(`${item.name} ${item.email} ${item.role}`).includes(q));
  $('reportUserCount').textContent = reportState.users.length + ' tài khoản';
  if (!rows.length) {
    $('reportUsers').innerHTML = '<div class="empty">Không có tài khoản phù hợp.</div>';
    return;
  }
  const currentUid = auth.currentUser ? auth.currentUser.uid : '';
  $('reportUsers').innerHTML = `<table class="admin-table report-permission-table">
    <thead><tr><th>Họ tên</th><th>Email</th><th>Quyền Báo cáo</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Thao tác</th></tr></thead>
    <tbody>${rows.map((item) => {
      const isSelf = item.uid === currentUid;
      let actions = '';
      if (!item.role || !item.active) {
        actions += `<button class="small-btn btn-soft report-user-action" data-kind="grant-entry" data-id="${esc(item.uid)}">Cấp Nhập liệu</button>`;
        actions += `<button class="small-btn btn-primary report-user-action" data-kind="grant-admin" data-id="${esc(item.uid)}">Cấp Quản trị</button>`;
      } else {
        const nextRole = item.role === 'admin' ? 'nhaplieu' : 'admin';
        actions += `<button class="small-btn btn-soft report-user-action" data-kind="role" data-value="${nextRole}" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>${item.role === 'admin' ? 'Hạ quyền' : 'Cấp quản trị'}</button>`;
        actions += `<button class="small-btn btn-danger report-user-action" data-kind="revoke" data-id="${esc(item.uid)}"${isSelf ? ' disabled' : ''}>Thu hồi</button>`;
      }
      return `<tr>
        <td data-label="Họ tên">${esc(item.name)}${isSelf ? ' <span class="meta">(Bạn)</span>' : ''}</td>
        <td data-label="Email">${esc(item.email)}</td>
        <td data-label="Quyền">${esc(roleLabel(item.role))}</td>
        <td data-label="Trạng thái">${item.active ? 'Hoạt động' : 'Chưa cấp'}</td>
        <td data-label="Đăng nhập gần nhất">${esc(fmtDateTime(item.lastLoginAt) || '—')}</td>
        <td data-label="Thao tác">${actions}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

async function setReportUserPermission(uid, role, active) {
  if (!canAdminReport()) return;
  const current = auth.currentUser;
  if (uid === current.uid && (!active || role !== 'admin')) throw new Error('Bạn không thể tự thu hồi hoặc hạ quyền Quản trị đang sử dụng.');
  const profileSnap = await get(ref(db, `${YTE_APP_ROOT}/nguoiDung/${uid}`));
  const profile = snapshotObject(profileSnap);
  if (!profile.email) throw new Error('Tài khoản chưa đăng nhập ứng dụng nên chưa có thông tin để cấp quyền.');
  const permRef = ref(db, `${REPORT_ROOT}/phanQuyen/${uid}`);
  const oldSnap = await get(permRef);
  const old = snapshotObject(oldSnap);
  const now = Date.now();
  await set(permRef, {
    email: normalizeEmail(profile.email),
    displayName: String(profile.displayName || profile.email || '').slice(0, 150),
    role: role || old.role || 'nhaplieu',
    active: active === true,
    source: old.source || 'REPORT_ADMIN',
    createdAt: old.createdAt || now,
    updatedAt: now,
    updatedByUid: current.uid
  });
  showToast(active ? `Đã cấp quyền ${roleLabel(role)}.` : 'Đã thu hồi quyền Báo cáo.', 'ok');
  await loadReportUsers(true);
  if (uid === current.uid) await refreshAccess();
}

async function revokeReportUser(uid) {
  return setReportUserPermission(uid, 'nhaplieu', false);
}

function initEvents() {
  if (reportState.initialized) return;
  reportState.initialized = true;
  $('reportFromDate').value = firstDayOfMonthIso();
  $('reportToDate').value = todayIso();

  document.querySelectorAll('.report-type-tab').forEach((tab) => {
    tab.addEventListener('click', () => setReportType(tab.getAttribute('data-report-type')));
  });
  document.querySelectorAll('.report-mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setReportMode(tab.getAttribute('data-report-mode')));
  });

  $('moduleTongHopCard').addEventListener('click', () => activateView('dashboard'));
  $('moduleReportCard').addEventListener('click', () => activateView('reports'));
  $('btnNewReport').addEventListener('click', openNewReport);
  $('btnReloadReports').addEventListener('click', () => loadReports(true));
  $('reportFromDate').addEventListener('change', () => loadReports(true));
  $('reportToDate').addEventListener('change', () => loadReports(true));
  $('reportSearch').addEventListener('input', renderReports);

  $('reportList').addEventListener('click', async (event) => {
    const button = event.target.closest('.report-action');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    const item = reportState.reports.find((row) => row.id === id);
    if (!item) return;
    if (kind === 'view') populateReportForm(item, true);
    if (kind === 'edit') populateReportForm(item, false);
    if (kind === 'delete') {
      try { await softDeleteReport(id); }
      catch (error) { showToast(error.message || String(error), 'err'); }
    }
  });

  $('reportCancel').addEventListener('click', closeReportForm);
  $('reportCloseX').addEventListener('click', closeReportForm);
  $('reportSave').addEventListener('click', saveReport);
  $('reportLayer').addEventListener('click', (event) => { if (event.target === $('reportLayer')) closeReportForm(); });

  $('btnReloadReportUsers').addEventListener('click', () => loadReportUsers(true));
  $('reportUserSearch').addEventListener('input', renderReportUsers);
  $('reportUsers').addEventListener('click', async (event) => {
    const button = event.target.closest('.report-user-action');
    if (!button) return;
    const uid = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    const value = button.getAttribute('data-value');
    try {
      if (kind === 'grant-entry') await setReportUserPermission(uid, 'nhaplieu', true);
      if (kind === 'grant-admin') await setReportUserPermission(uid, 'admin', true);
      if (kind === 'role') await setReportUserPermission(uid, value, true);
      if (kind === 'revoke') await revokeReportUser(uid);
    } catch (error) {
      showToast(error.message || String(error), 'err');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('reportLayer').hidden) closeReportForm();
  });
  setReportType(reportState.type);
}

function start() {
  initEvents();
  onAuthStateChanged(auth, async (user) => {
    reportState.user = user || null;
    if (!user) {
      reportState.permission = null;
      reportState.tongHopPermission = null;
      updateModuleUi();
      return;
    }
    try {
      await refreshAccess();
    } catch (error) {
      console.error('Không thể nạp quyền Báo cáo:', error);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
