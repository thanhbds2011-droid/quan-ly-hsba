'use strict';

import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const CFG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(CFG.OWNER_EMAIL || '').trim().toLowerCase();
const REPORT_ROOT = 'baoCaoYTe';
const YTE_APP_ROOT = 'yTeApp';
const CENTER_NAME = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
const OPEN_STATUSES = ['DANG_THEO_DOI', 'TAI_KHAM', 'DANG_DIEU_TRI', 'CHUYEN_TIEP_BENH_VIEN_KHAC'];
// TAI_KHAM vẫn được giữ trong OPEN_STATUSES/label để đọc dữ liệu legacy, nhưng không còn là hình thức được phép tạo mới.
const TRANSFER_TYPES = ['CAP_CUU', 'CHUYEN_VIEN', 'KHAC'];
const OTHER_DESTINATION = '__OTHER__';
const CLOSED_STATUSES = ['TU_VONG_TAI_BENH_VIEN', 'DA_VE_TRUNG_TAM'];
const ALL_STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES];

const app = getApps().length ? getApp() : initializeApp(CFG.FIREBASE);
const auth = getAuth(app);
const db = getDatabase(app);

const state = {
  permission: null,
  subView: 'tracking',
  openCases: [],
  closedCases: [],
  selectedCase: null,
  selectedCaseRaw: null,
  loading: false,
  loadedAt: 0,
  initialized: false,
  refreshTimer: null,
  createBaseline: '',
  updateBaseline: '',
  lastFocus: null,
  liveUnsubscribe: null,
  centerDeathUnsubscribe: null,
  transferStatsUnsubscribe: null,
  deathStatsUnsubscribe: null,
  displayNamesUnsubscribe: null,
  centerDeaths: [],
  transferStatsToday: {},
  deathStatsToday: {},
  displayNames: {},
  reconcileTimer: null,
  reconciling: false
};

function $(id) { return document.getElementById(id); }
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/\s+/g, ' ');
}
function normalizeBHYT(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim().slice(0, 40);
}
function formatPersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).map((word) => {
    const lower = word.toLocaleLowerCase('vi-VN');
    return lower.charAt(0).toLocaleUpperCase('vi-VN') + lower.slice(1);
  }).join(' ');
}
function markerCount(raw) {
  return Object.keys(raw || {}).filter((key) => raw[key] === true || raw[key] === 1 || raw[key] === '1').length;
}
function preferredName(uid, fallback) {
  const custom = uid && state.displayNames && state.displayNames[uid] && state.displayNames[uid].displayName;
  return String(custom || fallback || '').trim() || '—';
}
function currentDisplayName() {
  const user = auth.currentUser;
  if (!user) return '—';
  return preferredName(user.uid, (state.permission && state.permission.displayName) || user.displayName || user.email || '—');
}
async function resolveCurrentDisplayName() {
  const user = auth.currentUser;
  if (!user) return '—';
  const cached = user.uid && state.displayNames && state.displayNames[user.uid] && String(state.displayNames[user.uid].displayName || '').trim();
  if (cached) return cached.slice(0, 150);
  try {
    const snap = await get(ref(db, `${YTE_APP_ROOT}/tenHienThi/${user.uid}`));
    if (snap.exists()) {
      const value = String(snap.child('displayName').val() || '').trim();
      if (value) {
        state.displayNames[user.uid] = { ...(state.displayNames[user.uid] || {}), displayName: value };
        return value.slice(0, 150);
      }
    }
  } catch (_) {}
  return currentDisplayName().slice(0, 150);
}
function validGender(value) { return value === 'Nam' || value === 'Nữ'; }
function validBirthYear(value) {
  const year = Number(value || 0);
  return Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear();
}
function iconSvg(name, className = 'journey-btn-icon') {
  const icons = {
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    route: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H8"/><path d="m10 12-2 2 2 2"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    activity: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>'
  };
  const body = icons[name] || '';
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
function patientFactsHtml(item, options = {}) {
  const parts = [];
  if (validGender(item && item.gioiTinh)) parts.push(`<span>Giới tính: <b>${esc(item.gioiTinh)}</b></span>`);
  if (validBirthYear(item && item.namSinh)) parts.push(`<span>Sinh năm: <b>${esc(item.namSinh)}</b></span>`);
  const bhyt = String(item && item.theBHYT || '').trim();
  if (options.includeBHYT !== false) parts.push(`<span>BHYT: <b>${esc(bhyt || 'Chưa ghi nhận')}</b></span>`);
  return parts.length ? `<span class="journey-person-facts">${parts.join('<i aria-hidden="true">–</i>')}</span>` : '';
}
function isoDateAt(value) {
  const date = value instanceof Date ? value : new Date(Number(value || Date.now()));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function todayIso() { return isoDateAt(Date.now()); }
async function serverTodayIso() {
  try {
    const offsetSnap = await get(ref(db, '.info/serverTimeOffset'));
    const offset = offsetSnap.exists() ? Number(offsetSnap.val() || 0) : 0;
    return isoDateAt(Date.now() + offset);
  } catch (_) {
    return todayIso();
  }
}
function isoDateFromTimestamp(value) {
  const n = Number(value || 0);
  if (!n) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(n));
  const getPart = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}
function fmtDateTime(value) {
  const n = Number(value || 0);
  if (!n) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(n));
}
function durationText(from, to) {
  const start = Number(from || 0);
  if (!start) return '—';
  const end = Number(to || Date.now());
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${mins} phút`;
  return `${mins} phút`;
}
function hoursSince(value) {
  const n = Number(value || 0);
  return n ? Math.max(0, (Date.now() - n) / 3600000) : 0;
}
function statusLabel(status) {
  const map = {
    DANG_THEO_DOI: 'Đang theo dõi',
    TAI_KHAM: 'Tái khám',
    DANG_DIEU_TRI: 'Đang điều trị',
    CHUYEN_TIEP_BENH_VIEN_KHAC: 'Chuyển tiếp bệnh viện khác',
    TU_VONG_TAI_BENH_VIEN: 'Tử vong tại bệnh viện',
    DA_VE_TRUNG_TAM: 'Đã về Trung tâm'
  };
  return map[status] || status || '—';
}
function transferTypeLabel(type, otherText) {
  const map = {
    CAP_CUU: 'Cấp cứu',
    TAI_KHAM: 'Tái khám',
    CHUYEN_VIEN: 'Chuyển viện',
    KHAC: 'Khác'
  };
  if (type === 'KHAC' && String(otherText || '').trim()) return String(otherText).trim();
  return map[type] || 'Chưa phân loại';
}
function inferLegacyTransferType(item) {
  if (item && item.hinhThucChuyen) return item.hinhThucChuyen;
  if (item && item.trangThaiHienTai === 'TAI_KHAM') return 'TAI_KHAM';
  return 'CHUYEN_VIEN';
}
function resolvedDestination(selectId, otherId) {
  const selected = String($(selectId)?.value || '').trim();
  if (!selected) return '';
  if (selected !== OTHER_DESTINATION) return selected;
  return String($(otherId)?.value || '').trim();
}
function toggleOtherDestination(selectId, fieldId, inputId) {
  const select = $(selectId);
  const field = $(fieldId);
  const input = $(inputId);
  if (!select || !field || !input) return;
  const isOther = select.value === OTHER_DESTINATION;
  field.hidden = !isOther;
  if (!isOther) input.value = '';
}
function eventLabel(type) {
  const map = {
    MO_HANH_TRINH: 'Lập chuyển viện',
    CAP_NHAT_TRANG_THAI: 'Cập nhật trạng thái',
    CHUYEN_TIEP: 'Chuyển tiếp bệnh viện khác',
    DA_VE_TRUNG_TAM: 'Đã về Trung tâm',
    TU_VONG_TAI_BENH_VIEN: 'Tử vong tại bệnh viện'
  };
  return map[type] || type || 'Cập nhật';
}
function snapshotObject(snap) { return snap && snap.exists() ? (snap.val() || {}) : {}; }
function isOwner() {
  const user = auth.currentUser;
  return !!(user && normalizeEmail(user.email) === OWNER_EMAIL);
}
function validPermission(permission) {
  return !!(permission && permission.active === true && ['admin', 'nhaplieu', 'viewer'].includes(permission.role));
}
function canEdit() {
  return isOwner() || (validPermission(state.permission) && ['admin', 'nhaplieu'].includes(state.permission.role));
}
function canDelete() {
  return isOwner() || (validPermission(state.permission) && state.permission.role === 'admin');
}
function roleForLog() {
  if (isOwner()) return 'admin';
  return state.permission && ['admin', 'nhaplieu'].includes(state.permission.role) ? state.permission.role : 'nhaplieu';
}
function showToast(text, type) {
  const box = $('toast');
  if (!box) return;
  box.textContent = text;
  box.className = 'toast ' + (type || 'ok');
  box.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.hidden = true; }, 3800);
}
function showState(id, text, type, spinning) {
  const box = $(id);
  if (!box) return;
  box.hidden = !text;
  box.className = 'inline-state ' + (type || '');
  box.innerHTML = text ? `${spinning ? '<span class="spinner"></span>' : ''}<span>${esc(text)}</span>` : '';
}
function friendlyError(error, fallback) {
  const message = String(error && error.message ? error.message : error || '').trim();
  const technical = /(permission[_ -]?denied|firebase|network|failed to fetch|auth\/|database|internal|unavailable)/i.test(message);
  if (!message || technical) return fallback || 'Không thể thực hiện thao tác. Vui lòng kiểm tra kết nối hoặc quyền truy cập rồi thử lại.';
  return message;
}
function patientKey(name, gender, birthYear, bhyt) {
  const b = normalizeBHYT(bhyt);
  const raw = b
    ? `${normalizeText(name)}|${String(gender || '').trim()}|${Number(birthYear || 0)}|${b}`
    : `${normalizeText(name)}|${String(gender || '').trim()}|${Number(birthYear || 0)}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'P_' + (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
function caseFromRaw(id, raw) {
  const info = raw && raw.thongTin ? raw.thongTin : {};
  return {
    id,
    ...info,
    chang: raw && raw.chang ? raw.chang : {},
    lichSu: raw && raw.lichSu ? raw.lichSu : {}
  };
}
function activeDuplicate(payload) {
  const n = normalizeText(payload.doiTuong);
  const g = String(payload.gioiTinh || '').trim();
  const y = Number(payload.namSinh || 0);
  const b = normalizeBHYT(payload.theBHYT);
  for (const item of state.openCases) {
    const itemName = normalizeText(item.doiTuongNorm || item.doiTuong);
    const itemGender = String(item.gioiTinh || '').trim();
    const itemYear = Number(item.namSinh || 0);
    const itemBhyt = normalizeBHYT(item.theBHYTNorm || item.theBHYT);
    const sameProfile = itemName === n && itemGender === g && itemYear === y;
    if (b && itemBhyt && b === itemBhyt) {
      if (!sameProfile) return { conflict: true, item, message: 'Mã BHYT này đang được dùng cho một đối tượng có họ tên/giới tính/năm sinh khác. Vui lòng kiểm tra lại thông tin.' };
      return { duplicate: true, item };
    }
    if (sameProfile && (!b || !itemBhyt)) return { duplicate: true, item };
    if (sameProfile && b && itemBhyt && b !== itemBhyt) {
      return { conflict: true, item, message: 'Đối tượng cùng họ tên, giới tính và năm sinh đang có hành trình nhưng mã BHYT khác. Vui lòng kiểm tra lại trước khi tạo hành trình mới.' };
    }
  }
  return null;
}

function compareIdentity(payload, item) {
  const n = normalizeText(payload.doiTuong);
  const g = String(payload.gioiTinh || '').trim();
  const y = Number(payload.namSinh || 0);
  const b = normalizeBHYT(payload.theBHYT);
  const itemName = normalizeText(item.doiTuongNorm || item.doiTuong || item.hoTenNorm || item.hoTenBenhNhan);
  const itemGender = String(item.gioiTinh || '').trim();
  const itemYear = Number(item.namSinh || 0);
  const itemBhyt = normalizeBHYT(item.theBHYTNorm || item.theBHYT);
  const sameProfile = itemName === n && itemGender === g && itemYear === y;
  if (b && itemBhyt && b === itemBhyt) return sameProfile ? 'same' : 'conflict';
  if (sameProfile && (!b || !itemBhyt)) return 'same';
  if (sameProfile && b && itemBhyt && b !== itemBhyt) return 'conflict';
  return 'different';
}

async function deceasedDuplicate(payload) {
  for (const item of state.closedCases.filter((row) => row.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN')) {
    const match = compareIdentity(payload, item);
    if (match === 'conflict') return { conflict: true, message: 'Thông tin đối tượng trùng hồ sơ tử vong tại bệnh viện nhưng họ tên/giới tính/năm sinh/BHYT không khớp hoàn toàn. Vui lòng kiểm tra lại.' };
    if (match === 'same') return { deceased: true, label: 'tử vong tại bệnh viện' };
  }
  const reportSnap = await get(ref(db, `${REPORT_ROOT}/baoCao`));
  const raw = snapshotObject(reportSnap);
  for (const [id, src] of Object.entries(raw)) {
    if (!src || src.trangThai === 'deleted' || src.loaiBaoCao !== 'TU_VONG') continue;
    if (!(src.source === 'CENTER_DEATH' || normalizeText(src.noiTuVong) === normalizeText(CENTER_NAME))) continue;
    const item = centerDeathFromRaw(id, src);
    const match = compareIdentity(payload, item);
    if (match === 'conflict') return { conflict: true, message: 'Thông tin đối tượng trùng hồ sơ tử vong tại Trung tâm nhưng họ tên/giới tính/năm sinh/BHYT không khớp hoàn toàn. Vui lòng kiểm tra lại.' };
    if (match === 'same') return { deceased: true, label: 'tử vong tại Trung tâm' };
  }
  return null;
}
function statusClass(status) {
  if (status === 'DA_VE_TRUNG_TAM') return 'is-returned';
  if (status === 'TU_VONG_TAI_BENH_VIEN') return 'is-death';
  if (status === 'CHUYEN_TIEP_BENH_VIEN_KHAC') return 'is-transfer';
  if (status === 'DANG_DIEU_TRI') return 'is-treatment';
  if (status === 'DANG_THEO_DOI') return 'is-tracking';
  return 'is-followup';
}
function journeyRouteHtml(item) {
  const stages = Object.values(item.chang || {}).sort((a, b) => Number(a.thuTu || 0) - Number(b.thuTu || 0));
  if (!stages.length) return `<strong class="journey-route-place">${esc(CENTER_NAME)}</strong><b class="journey-route-arrow">→</b><strong class="journey-route-place">${esc(item.noiHienTai || '—')}</strong>`;
  const places = [stages[0].noiDi || CENTER_NAME];
  stages.forEach((stage) => {
    const place = stage.noiDen || '';
    if (place && normalizeText(place) !== normalizeText(places[places.length - 1])) places.push(place);
  });
  return places.map((place, index) => `${index ? '<b class="journey-route-arrow">→</b>' : ''}<strong class="journey-route-place">${esc(place)}</strong>`).join('');
}
function routeSearchText(item) {
  const stages = Object.values(item.chang || {});
  return stages.map((stage) => `${stage.noiDi || ''} ${stage.noiDen || ''}`).join(' ');
}
function formSignature(ids) {
  return ids.map((id) => {
    const el = $(id);
    if (!el) return '';
    return `${id}:${String(el.value || '')}`;
  }).join('|');
}
const CREATE_FIELD_IDS = ['journeyPatient','journeyGender','journeyBirthYear','journeyBHYT','journeyTransferType','journeyTransferTypeOther','journeyTo','journeyToOther','journeyReason','journeyDiagnosis','journeyNote'];
const UPDATE_FIELD_IDS = ['journeyUpdateStatus','journeyUpdateDestination','journeyUpdateDestinationOther','journeyUpdateReason','journeyUpdateDiagnosis','journeyReturnCondition','journeyUpdateNote'];
function isCreateDirty() { return !!state.createBaseline && formSignature(CREATE_FIELD_IDS) !== state.createBaseline; }
function isUpdateDirty() { return !!state.updateBaseline && formSignature(UPDATE_FIELD_IDS) !== state.updateBaseline; }
function confirmDiscard() {
  return window.confirm('Bạn có thay đổi chưa lưu. Bạn có muốn bỏ các thay đổi này không?');
}
function setBodyModalState(open) {
  document.body.style.overflow = open ? 'hidden' : '';
}
function restoreFocus() {
  const target = state.lastFocus;
  state.lastFocus = null;
  if (target && target.isConnected && typeof target.focus === 'function') window.setTimeout(() => target.focus(), 0);
}
function timelineBadge(event, item) {
  if (event.loaiSuKien === 'MO_HANH_TRINH') {
    return transferTypeLabel(event.hinhThucChuyen || inferLegacyTransferType(item), event.hinhThucChuyenKhac || item.hinhThucChuyenKhac);
  }
  if (event.loaiSuKien === 'CHUYEN_TIEP') return 'Chuyển tiếp';
  if (event.loaiSuKien === 'DA_VE_TRUNG_TAM') return 'Đã về Trung tâm';
  if (event.loaiSuKien === 'TU_VONG_TAI_BENH_VIEN') return 'Tử vong tại bệnh viện';
  return statusLabel(event.trangThaiSau);
}
function timelineTitle(event) {
  const from = String(event.noiTruoc || '').trim();
  const to = String(event.noiSau || '').trim();
  if (from && to && normalizeText(from) !== normalizeText(to)) return `${from} → ${to}`;
  const place = to || from;
  return place ? `Cập nhật tại ${place}` : 'Cập nhật hành trình';
}

async function refreshPermission() {
  const user = auth.currentUser;
  if (!user) {
    state.permission = null;
    return null;
  }
  const snap = await get(ref(db, `${REPORT_ROOT}/phanQuyen/${user.uid}`));
  state.permission = snap.exists() ? snap.val() : null;
  return state.permission;
}

function hospitalDeathTimestamp(item) {
  const events = Object.values(item.lichSu || {}).filter((event) => event && event.loaiSuKien === 'TU_VONG_TAI_BENH_VIEN');
  events.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return Number((events[0] && events[0].createdAt) || item.updatedAt || 0);
}
function scheduleStatisticsReconciliation() {
  if (!canEdit()) return;
  clearTimeout(state.reconcileTimer);
  state.reconcileTimer = setTimeout(() => reconcileStatisticsMarkers().catch((error) => console.warn('Đối soát thống kê:', error)), 250);
}
async function reconcileStatisticsMarkers() {
  if (state.reconciling || !canEdit()) return;
  state.reconciling = true;
  try {
    const updates = {};
    [...state.openCases, ...state.closedCases].forEach((item) => {
      const transferDate = isoDateFromTimestamp(item.ngayGioDi);
      if (transferDate && item.id) updates[`${REPORT_ROOT}/congKhaiThongKe/chuyenVienTheoNgay/${transferDate}/${item.id}`] = true;
      if (item.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN') {
        const deathDate = isoDateFromTimestamp(hospitalDeathTimestamp(item));
        if (deathDate && item.id) updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${deathDate}/HOSP_${item.id}`] = true;
      }
    });
    state.centerDeaths.forEach((item) => {
      if (item.ngayBaoCao && item.id) updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${item.ngayBaoCao}/CENTER_${item.id}`] = true;
    });
    if (Object.keys(updates).length) await update(ref(db), updates);
  } finally {
    state.reconciling = false;
  }
}

function applyJourneySnapshot(journeySnap) {
  const rawJourneys = snapshotObject(journeySnap);
  const all = Object.keys(rawJourneys).map((id) => caseFromRaw(id, rawJourneys[id]));
  state.openCases = all.filter((item) => item.trangThaiKyThuat === 'OPEN')
    .sort((a, b) => Number(a.ngayGioDi || 0) - Number(b.ngayGioDi || 0));
  state.closedCases = all.filter((item) => item.trangThaiKyThuat === 'CLOSED')
    .sort((a, b) => Number(b.ngayGioVe || b.updatedAt || 0) - Number(a.ngayGioVe || a.updatedAt || 0));
  state.loadedAt = Date.now();
  renderTracking();
  renderHistory();
  showState('journeyTrackingLoadState', '', '', false);
  scheduleStatisticsReconciliation();
}

function stopJourneyRealtime() {
  ['liveUnsubscribe','centerDeathUnsubscribe','transferStatsUnsubscribe','deathStatsUnsubscribe','displayNamesUnsubscribe'].forEach((key) => {
    if (typeof state[key] === 'function') state[key]();
    state[key] = null;
  });
}

function startJourneyRealtime() {
  if (!validPermission(state.permission) && !isOwner()) {
    stopJourneyRealtime();
    return;
  }
  if (!state.liveUnsubscribe) {
    state.liveUnsubscribe = onValue(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`), (snap) => {
      applyJourneySnapshot(snap);
    }, (error) => {
      console.error('Realtime hành trình:', error);
      showState('journeyTrackingLoadState', friendlyError(error, 'Mất kết nối đồng bộ trực tiếp. Ứng dụng sẽ tự kết nối lại khi mạng ổn định.'), 'err', false);
    });
  }
  if (!state.centerDeathUnsubscribe) {
    state.centerDeathUnsubscribe = onValue(ref(db, `${REPORT_ROOT}/baoCao`), (snap) => {
      const raw = snapshotObject(snap);
      state.centerDeaths = Object.keys(raw).map((id) => centerDeathFromRaw(id, raw[id]))
        .filter((item) => {
          const src = raw[item.id] || {};
          return src.trangThai !== 'deleted' && src.loaiBaoCao === 'TU_VONG' && (src.source === 'CENTER_DEATH' || normalizeText(src.noiTuVong) === normalizeText(CENTER_NAME));
        });
      renderHistory();
      scheduleStatisticsReconciliation();
    }, (error) => console.warn('Realtime tử vong tại Trung tâm:', error));
  }
  if (!state.transferStatsUnsubscribe) {
    state.transferStatsUnsubscribe = onValue(ref(db, `${REPORT_ROOT}/congKhaiThongKe/chuyenVienTheoNgay/${todayIso()}`), (snap) => {
      state.transferStatsToday = snapshotObject(snap); renderDashboardStats();
    }, (error) => console.warn('Realtime thống kê chuyển viện:', error));
  }
  if (!state.deathStatsUnsubscribe) {
    state.deathStatsUnsubscribe = onValue(ref(db, `${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${todayIso()}`), (snap) => {
      state.deathStatsToday = snapshotObject(snap); renderDashboardStats();
    }, (error) => console.warn('Realtime thống kê tử vong:', error));
  }
  if (!state.displayNamesUnsubscribe) {
    state.displayNamesUnsubscribe = onValue(ref(db, `${YTE_APP_ROOT}/tenHienThi`), (snap) => {
      state.displayNames = snapshotObject(snap);
      renderTracking(); renderHistory();
      if ($('journeyReporter') && auth.currentUser) $('journeyReporter').textContent = currentDisplayName();
      if ($('journeyUpdateReporter') && auth.currentUser && !$('journeyUpdateLayer')?.hidden) $('journeyUpdateReporter').textContent = currentDisplayName();
    }, (error) => console.warn('Realtime tên hiển thị:', error));
  }
}

async function loadJourneys(force) {
  if (!validPermission(state.permission) && !isOwner()) return false;
  startJourneyRealtime();
  if (!force && state.loadedAt) { renderTracking(); renderHistory(); return true; }
  if (state.loading && !force) return true;
  state.loading = true;
  showState('journeyTrackingLoadState', 'Đang tải hành trình chuyển viện...', '', true);
  try {
    const journeySnap = await get(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`));
    applyJourneySnapshot(journeySnap);
    return true;
  } catch (error) {
    console.error(error);
    showState('journeyTrackingLoadState', friendlyError(error, 'Không tải được hành trình chuyển viện. Vui lòng thử lại.'), 'err', false);
    return false;
  } finally {
    state.loading = false;
  }
}

function renderTracking() {
  const search = normalizeText($('journeyTrackingSearch')?.value || '');
  const rows = state.openCases.filter((item) => {
    if (!search) return true;
    return normalizeText([
      item.doiTuong, item.gioiTinh, item.namSinh, item.theBHYT, item.noiHienTai, statusLabel(item.trangThaiHienTai),
      transferTypeLabel(inferLegacyTransferType(item), item.hinhThucChuyenKhac),
      item.lyDoHienTai, item.tinhTrangChanDoanHienTai, item.ghiChu
    ].join(' ')).includes(search);
  });
  if ($('journeyOpenCount')) $('journeyOpenCount').textContent = String(state.openCases.length);
  if ($('journeyTrackingBadge')) $('journeyTrackingBadge').textContent = String(state.openCases.length);

  const box = $('journeyTrackingList');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="journey-empty"><strong>Không có đối tượng đang ngoài Trung tâm.</strong></div>';
    return;
  }

  box.innerHTML = rows.map((item) => {
    const canWrite = canEdit();
    const note = String(item.ghiChu || '').trim();
    return `<article class="journey-card journey-card-compact">
      <div class="journey-card-main">
        <div class="journey-card-title">
          <div class="journey-person-head">
            <div class="journey-person-name-line">${iconSvg('person','journey-person-icon')}<strong>${esc(item.doiTuong || 'Chưa có tên')}</strong>${patientFactsHtml(item)}</div>
          </div>
          <div class="journey-card-badges">
            <span class="journey-status ${statusClass(item.trangThaiHienTai)}">${esc(statusLabel(item.trangThaiHienTai))}</span>
            <span class="journey-type-pill">${esc(transferTypeLabel(inferLegacyTransferType(item), item.hinhThucChuyenKhac))}</span>
          </div>
        </div>
        <div class="journey-location journey-location-compact journey-location-italic">
          <span class="journey-location-label">${iconSvg('pin','journey-inline-icon')}Nơi hiện tại</span>
          <strong>${esc(item.noiHienTai || '—')}</strong>
        </div>
        <div class="journey-card-bottom-row">
          <details class="journey-card-details">
            <summary>Thông tin chi tiết</summary>
            <div class="journey-detail-grid-inline">
              <div><span>Rời Trung tâm</span><strong>${esc(fmtDateTime(item.ngayGioDi))}</strong></div>
              <div><span>Thời gian ngoài Trung tâm</span><strong>${esc(durationText(item.ngayGioDi))}</strong></div>
              <div><span>Lý do</span><strong>${esc(item.lyDoHienTai || '—')}</strong></div>
              <div><span>Tình trạng/chẩn đoán</span><strong>${esc(item.tinhTrangChanDoanHienTai || '—')}</strong></div>
              ${note ? `<div class="journey-detail-note"><span>Ghi chú</span><strong>${esc(note)}</strong></div>` : ''}
              <div><span>Người cập nhật</span><strong>${esc(preferredName(item.updatedByUid || item.createdByUid, item.updatedByName || item.createdByName))}</strong></div>
            </div>
          </details>
          <div class="journey-card-actions">
            ${canWrite ? `<button class="small-btn btn-primary journey-action journey-primary-action" data-kind="update" data-id="${esc(item.id)}" type="button">${iconSvg('edit')}<span>Cập nhật</span></button>
            <details class="journey-action-menu"><summary aria-label="Thao tác khác">${iconSvg('dots')}</summary><div class="journey-action-popover"><button class="journey-action" data-kind="view" data-id="${esc(item.id)}" type="button">${iconSvg('eye')}<span>Xem</span></button><button class="journey-action journey-menu-return" data-kind="return" data-id="${esc(item.id)}" type="button">${iconSvg('home')}<span>Đã về Trung tâm</span></button>${canDelete() ? `<button class="journey-action journey-menu-delete" data-kind="delete" data-id="${esc(item.id)}" type="button"><span>Xóa</span></button>` : ''}</div></details>` : `<button class="small-btn btn-soft journey-action" data-kind="view" data-id="${esc(item.id)}" type="button">${iconSvg('eye')}<span>Xem</span></button>`}
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}

function centerDeathFromRaw(id, raw) {
  const item = raw || {};
  return {
    id,
    kind: 'CENTER_DEATH',
    doiTuong: item.hoTenBenhNhan || '',
    gioiTinh: item.gioiTinh || '',
    namSinh: Number(item.namSinh || 0),
    theBHYT: item.theBHYT || '',
    nguyenNhan: item.nguyenNhan || '',
    ghiChu: item.ghiChu || '',
    ngayBaoCao: item.ngayTuVong || item.ngayBaoCao || '',
    createdAt: Number(item.createdAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    createdByUid: item.createdByUid || '',
    createdByName: item.createdByName || '',
    trangThaiHienTai: 'TU_VONG_TAI_TRUNG_TAM'
  };
}
function combinedHistoryRows() {
  const journeyRows = state.closedCases.map((item) => ({ ...item, kind: 'JOURNEY' }));
  const centerRows = state.centerDeaths.slice();
  return [...journeyRows, ...centerRows].sort((a, b) => {
    const ta = a.kind === 'CENTER_DEATH' ? Number(a.updatedAt || a.createdAt || 0) : Number(a.ngayGioVe || a.updatedAt || 0);
    const tb = b.kind === 'CENTER_DEATH' ? Number(b.updatedAt || b.createdAt || 0) : Number(b.ngayGioVe || b.updatedAt || 0);
    return tb - ta;
  });
}
function updateHistoryFilterLabels(allRows) {
  const select = $('journeyHistoryStatus');
  if (!select) return;
  const counts = {
    all: allRows.length,
    DA_VE_TRUNG_TAM: allRows.filter((x) => x.trangThaiHienTai === 'DA_VE_TRUNG_TAM').length,
    TU_VONG_TAI_BENH_VIEN: allRows.filter((x) => x.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN').length,
    TU_VONG_TAI_TRUNG_TAM: allRows.filter((x) => x.trangThaiHienTai === 'TU_VONG_TAI_TRUNG_TAM').length
  };
  Array.from(select.options).forEach((option) => {
    const base = option.value === 'all' ? 'Tất cả' : option.value === 'DA_VE_TRUNG_TAM' ? 'Đã về Trung tâm' : option.value === 'TU_VONG_TAI_BENH_VIEN' ? 'Tử vong tại bệnh viện' : 'Tử vong tại Trung tâm';
    option.textContent = `${base} (${counts[option.value] || 0})`;
  });
}
function renderDashboardStats() {
  if ($('journeyTodayTransferCount')) $('journeyTodayTransferCount').textContent = String(markerCount(state.transferStatsToday));
  if ($('journeyTodayDeathCount')) $('journeyTodayDeathCount').textContent = String(markerCount(state.deathStatsToday));
}

function latestJourneyStage(item) {
  const stages = Object.values(item && item.chang || {}).sort((a, b) => Number(a.thuTu || 0) - Number(b.thuTu || 0));
  return stages.length ? stages[stages.length - 1] : null;
}
function historyTreatmentPlace(item) {
  if (!item) return '—';
  if (item.kind === 'CENTER_DEATH') return CENTER_NAME;
  const stages = Object.values(item.chang || {}).sort((a, b) => Number(a.thuTu || 0) - Number(b.thuTu || 0));
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const place = String(stages[i] && stages[i].noiDen || '').trim();
    if (place && normalizeText(place) !== normalizeText(CENTER_NAME)) return place;
  }
  return String(item.noiHienTai || CENTER_NAME || '—');
}
function historyDiagnosis(item) {
  if (!item) return '—';
  if (item.kind === 'CENTER_DEATH') return String(item.nguyenNhan || '—');
  const latest = latestJourneyStage(item);
  return String(
    latest && latest.tinhTrangChanDoan ||
    item.tinhTrangChanDoanHienTai ||
    item.tinhTrangKhiVe ||
    item.ghiChu ||
    '—'
  );
}
function historyActionHtml(item) {
  if (item.kind === 'CENTER_DEATH') {
    const canManage = canEdit() || isOwner() || (state.permission && state.permission.role === 'admin');
    const menu = canManage ? `<details class="journey-action-menu"><summary aria-label="Thao tác khác">${iconSvg('dots')}</summary><div class="journey-action-popover">${canEdit() ? `<button class="journey-history-action" data-kind="center-death-edit" data-id="${esc(item.id)}" type="button">${iconSvg('edit')}<span>Sửa</span></button>` : ''}${(isOwner() || (state.permission && state.permission.role === 'admin')) ? `<button class="journey-history-action journey-menu-delete" data-kind="center-death-delete" data-id="${esc(item.id)}" type="button"><span>Xóa</span></button>` : ''}</div></details>` : '';
    return `<div class="journey-history-actions"><button class="small-btn btn-soft journey-history-action" data-kind="center-death-view" data-id="${esc(item.id)}" type="button">${iconSvg('eye')}<span>Xem</span></button>${menu}</div>`;
  }
  const menu = canDelete() ? `<details class="journey-action-menu"><summary aria-label="Thao tác khác">${iconSvg('dots')}</summary><div class="journey-action-popover"><button class="journey-history-action journey-menu-delete" data-kind="journey-delete" data-id="${esc(item.id)}" type="button"><span>Xóa</span></button></div></details>` : '';
  return `<div class="journey-history-actions"><button class="small-btn btn-soft journey-history-action" data-kind="view" data-id="${esc(item.id)}" type="button">${iconSvg('eye')}<span>Xem</span></button>${menu}</div>`;
}
function renderHistory() {
  const search = normalizeText($('journeyHistorySearch')?.value || '');
  const filter = $('journeyHistoryStatus')?.value || 'all';
  const allRows = combinedHistoryRows();
  updateHistoryFilterLabels(allRows);
  const rows = allRows.filter((item) => {
    if (filter !== 'all' && item.trangThaiHienTai !== filter) return false;
    if (!search) return true;
    if (item.kind === 'CENTER_DEATH') {
      return normalizeText([item.doiTuong, item.gioiTinh, item.namSinh, item.theBHYT, item.nguyenNhan, item.ghiChu, CENTER_NAME].join(' ')).includes(search);
    }
    return normalizeText([
      item.doiTuong, item.gioiTinh, item.namSinh, item.theBHYT, statusLabel(item.trangThaiHienTai),
      item.tinhTrangKhiVe, item.ghiChu, historyTreatmentPlace(item), historyDiagnosis(item), routeSearchText(item)
    ].join(' ')).includes(search);
  });

  const box = $('journeyHistoryList');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="journey-empty"><strong>Không có lịch sử phù hợp.</strong></div>';
    return;
  }

  const body = rows.map((item, index) => {
    const status = item.kind === 'CENTER_DEATH' ? 'Tử vong tại Trung tâm' : statusLabel(item.trangThaiHienTai);
    const statusClassName = item.kind === 'CENTER_DEATH' ? 'is-death' : statusClass(item.trangThaiHienTai);
    const bhxh = String(item.soBHXH || item.theBHXH || item.bhxh || item.theBHYT || '').trim();
    return `<tr class="${item.kind === 'CENTER_DEATH' ? 'is-center-death' : ''}">
      <td class="history-col-stt" data-label="STT">${index + 1}</td>
      <td class="history-col-name" data-label="Họ và tên">
        <div class="history-name-row"><span class="history-mobile-field-label">Họ và tên:</span><strong>${esc(item.doiTuong || 'Chưa có tên')}</strong></div>
      </td>
      <td class="history-col-birth" data-label="Năm sinh">${validBirthYear(item.namSinh) ? esc(item.namSinh) : '—'}</td>
      <td class="history-col-gender" data-label="Giới tính">${validGender(item.gioiTinh) ? esc(item.gioiTinh) : '—'}</td>
      <td class="history-col-insurance" data-label="BHXH"><span class="history-insurance-value">${bhxh ? esc(bhxh) : '—'}</span></td>
      <td class="history-col-status" data-label="Trạng thái"><span class="journey-status ${statusClassName}">${esc(status)}</span></td>
      <td class="history-col-actions" data-label="Thao tác">${historyActionHtml(item)}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="journey-history-table-wrap"><table class="journey-history-table journey-history-table-compact">
    <thead><tr>
      <th>STT</th><th>Họ và tên</th><th>Năm sinh</th><th>Giới tính</th><th>BHXH</th><th>Trạng thái</th><th>Thao tác</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function positionActionPopover(details) {
  if (!details || !details.open) return;
  const summary = details.querySelector('summary');
  const popover = details.querySelector('.journey-action-popover');
  if (!summary || !popover) return;
  popover.style.position = 'fixed';
  popover.style.right = 'auto';
  popover.style.bottom = 'auto';
  popover.style.zIndex = '1400';
  requestAnimationFrame(() => {
    if (!details.open) return;
    const rect = summary.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(220, Math.max(180, window.innerWidth - margin * 2));
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width))}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    const menuRect = popover.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - margin) {
      popover.style.top = `${Math.max(margin, rect.top - menuRect.height - 6)}px`;
    }
  });
}
function refreshOpenActionPopovers() {
  document.querySelectorAll('details.journey-action-menu[open]').forEach(positionActionPopover);
}
function initializeActionPopoverPositioning() {
  document.addEventListener('toggle', (event) => {
    const details = event.target && event.target.matches && event.target.matches('details.journey-action-menu') ? event.target : null;
    if (!details || !details.open) return;
    document.querySelectorAll('details.journey-action-menu[open]').forEach((other) => { if (other !== details) other.open = false; });
    positionActionPopover(details);
  }, true);
  window.addEventListener('resize', refreshOpenActionPopovers);
  window.addEventListener('scroll', refreshOpenActionPopovers, true);
  document.addEventListener('click', (event) => {
    if (event.target.closest('details.journey-action-menu')) return;
    document.querySelectorAll('details.journey-action-menu[open]').forEach((details) => { details.open = false; });
  });
}

function requestSubView(name) {
  if (state.subView === 'create' && name !== 'create' && isCreateDirty()) {
    if (!confirmDiscard()) return;
    resetCreateForm();
  }
  setSubView(name);
}

function setSubView(name) {
  name = ['tracking', 'create', 'history'].includes(name) ? name : 'tracking';
  if (name === 'create' && !canEdit()) name = 'tracking';
  state.subView = name;
  const reportsView = $('reportsView');
  if (reportsView) reportsView.setAttribute('data-journey-view', name);
  document.querySelectorAll('.journey-subtab').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-journey-view') === name);
  });
  ['tracking', 'create', 'history'].forEach((key) => {
    const panel = $('journey' + key[0].toUpperCase() + key.slice(1) + 'Panel');
    if (panel) panel.hidden = key !== name;
  });
  if (name === 'tracking') loadJourneys(false);
  if (name === 'history') loadJourneys(false);
  if (name === 'create' && !state.createBaseline) resetCreateForm();
}

function updateCreateDynamicFields() {
  const transferType = String($('journeyTransferType')?.value || '');
  const otherTypeField = $('journeyTransferTypeOtherField');
  if (otherTypeField) otherTypeField.hidden = transferType !== 'KHAC';
  if (transferType !== 'KHAC' && $('journeyTransferTypeOther')) $('journeyTransferTypeOther').value = '';
  toggleOtherDestination('journeyTo', 'journeyToOtherField', 'journeyToOther');
}

function resetCreateForm() {
  if (!$('journeyCreateForm')) return;
  $('journeyPatient').value = '';
  $('journeyGender').value = '';
  $('journeyBirthYear').value = '';
  $('journeyBirthYear').max = String(new Date().getFullYear());
  $('journeyBHYT').value = '';
  $('journeyFrom').value = CENTER_NAME;
  $('journeyTo').value = '';
  $('journeyToOther').value = '';
  $('journeyTransferType').value = '';
  $('journeyTransferTypeOther').value = '';
  $('journeyReason').value = '';
  $('journeyDiagnosis').value = '';
  $('journeyNote').value = '';
  $('journeyCreateError').textContent = '';
  $('journeySystemTime').textContent = 'Tự động ghi khi xác nhận';
  updateCreateDynamicFields();
  const user = auth.currentUser;
  $('journeyReporter').textContent = user ? currentDisplayName() : '—';
  state.createBaseline = formSignature(CREATE_FIELD_IDS);
}

function createPayload() {
  const doiTuong = formatPersonName($('journeyPatient').value || '');
  const gioiTinh = String($('journeyGender').value || '').trim();
  const namSinh = Number($('journeyBirthYear').value || 0);
  const theBHYT = normalizeBHYT($('journeyBHYT').value || '');
  const noiDen = resolvedDestination('journeyTo', 'journeyToOther');
  const lyDo = String($('journeyReason').value || '').trim();
  const tinhTrang = String($('journeyDiagnosis').value || '').trim();
  const ghiChu = String($('journeyNote').value || '').trim();
  const hinhThucChuyen = String($('journeyTransferType').value || '');
  const hinhThucChuyenKhac = hinhThucChuyen === 'KHAC' ? String($('journeyTransferTypeOther').value || '').trim() : '';
  if (doiTuong.length < 2 || doiTuong.length > 150) throw new Error('Vui lòng nhập Họ và tên từ 2 đến 150 ký tự.');
  if (!validGender(gioiTinh)) throw new Error('Vui lòng chọn Giới tính.');
  if (!validBirthYear(namSinh)) throw new Error(`Năm sinh phải từ 1900 đến ${new Date().getFullYear()}.`);
  if (theBHYT.length > 40) throw new Error('Thẻ BHYT không hợp lệ.');
  if (!TRANSFER_TYPES.includes(hinhThucChuyen)) throw new Error('Vui lòng chọn Hình thức chuyển.');
  if (hinhThucChuyen === 'KHAC' && (hinhThucChuyenKhac.length < 2 || hinhThucChuyenKhac.length > 120)) throw new Error('Vui lòng nhập Hình thức chuyển khác.');
  if (!noiDen || noiDen.length > 300) throw new Error('Vui lòng chọn hoặc nhập Nơi đến.');
  if (!lyDo || lyDo.length > 1000) throw new Error('Vui lòng nhập Lý do.');
  if (!tinhTrang || tinhTrang.length > 1500) throw new Error('Vui lòng nhập Tình trạng/chẩn đoán.');
  if (ghiChu.length > 2000) throw new Error('Ghi chú không được vượt quá 2.000 ký tự.');
  return {
    doiTuong,
    doiTuongNorm: normalizeText(doiTuong),
    gioiTinh,
    namSinh,
    theBHYT,
    theBHYTNorm: theBHYT,
    doiTuongKey: patientKey(doiTuong, gioiTinh, namSinh, theBHYT),
    noiDen,
    lyDo,
    tinhTrang,
    ghiChu,
    hinhThucChuyen,
    hinhThucChuyenKhac,
    trangThai: 'DANG_THEO_DOI'
  };
}

async function claimOpenIndex(key, caseId) {
  const indexRef = ref(db, `${REPORT_ROOT}/hanhTrinhDangMo/${key}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current == null) return caseId;
    return undefined;
  }, { applyLocally: false });
  if (!result.committed) throw new Error('Đối tượng đang có hành trình chuyển viện chưa kết thúc.');
}

async function releaseOpenIndex(key, expectedCaseId) {
  const indexRef = ref(db, `${REPORT_ROOT}/hanhTrinhDangMo/${key}`);
  await runTransaction(indexRef, (current) => current === expectedCaseId ? null : current, { applyLocally: false }).catch(() => {});
}

async function createJourney() {
  if (!canEdit()) return;
  let payload;
  try { payload = createPayload(); }
  catch (error) { $('journeyCreateError').textContent = friendlyError(error); return; }
  const user = auth.currentUser;
  if (!user) { $('journeyCreateError').textContent = 'Vui lòng đăng nhập lại.'; return; }
  $('journeyCreateError').textContent = '';
  $('journeyCreateSave').disabled = true;
  $('journeyCreateSave').textContent = 'Đang lưu...';
  try {
    const refreshed = await loadJourneys(true);
    if (!refreshed) throw new Error('Không thể kiểm tra dữ liệu hành trình mới nhất. Vui lòng kiểm tra kết nối và thử lại để tránh tạo trùng hồ sơ.');
    const duplicate = activeDuplicate(payload);
    if (duplicate && duplicate.conflict) throw new Error(duplicate.message);
    if (duplicate && duplicate.duplicate) throw new Error(`Đối tượng đang có hành trình chưa kết thúc tại ${duplicate.item.noiHienTai || 'cơ sở y tế'}.`);
    const deceased = await deceasedDuplicate(payload);
    if (deceased && deceased.conflict) throw new Error(deceased.message);
    if (deceased && deceased.deceased) throw new Error(`Đối tượng đã được ghi nhận ${deceased.label}. Không thể lập hành trình chuyển viện mới.`);

    const caseId = 'HTCV_' + push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`)).key;
    await claimOpenIndex(payload.doiTuongKey, caseId);
    const stageId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/chang`)).key;
    const historyId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/lichSu`)).key;
    const businessDate = await serverTodayIso();
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${businessDate.slice(0, 7)}`)).key;
    const displayName = await resolveCurrentDisplayName();
    const email = normalizeEmail(user.email);
    const ts = serverTimestamp();
    const info = {
      id: caseId,
      doiTuong: payload.doiTuong,
      doiTuongNorm: payload.doiTuongNorm,
      gioiTinh: payload.gioiTinh,
      namSinh: payload.namSinh,
      theBHYT: payload.theBHYT,
      theBHYTNorm: payload.theBHYTNorm,
      doiTuongKey: payload.doiTuongKey,
      hinhThucChuyen: payload.hinhThucChuyen,
      hinhThucChuyenKhac: payload.hinhThucChuyenKhac,
      noiDiBanDau: CENTER_NAME,
      noiHienTai: payload.noiDen,
      lyDoHienTai: payload.lyDo,
      tinhTrangChanDoanHienTai: payload.tinhTrang,
      ghiChu: payload.ghiChu,
      trangThaiHienTai: payload.trangThai,
      trangThaiKyThuat: 'OPEN',
      ngayGioDi: ts,
      ngayGioVe: 0,
      tinhTrangKhiVe: '',
      thuTuChang: 1,
      version: 1,
      createdAt: ts,
      createdByUid: user.uid,
      createdByEmail: email,
      createdByName: displayName,
      updatedAt: ts,
      updatedByUid: user.uid,
      updatedByEmail: email,
      updatedByName: displayName
    };
    const updates = {};
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/thongTin`] = info;
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/chang/${stageId}`] = {
      id: stageId,
      caseId,
      thuTu: 1,
      noiDi: CENTER_NAME,
      noiDen: payload.noiDen,
      hinhThucChuyen: payload.hinhThucChuyen,
      hinhThucChuyenKhac: payload.hinhThucChuyenKhac,
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
      ghiChu: payload.ghiChu,
      trangThaiSauChang: payload.trangThai,
      thoiDiem: ts,
      uid: user.uid,
      email,
      displayName
    };
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/lichSu/${historyId}`] = {
      id: historyId,
      caseId,
      loaiSuKien: 'MO_HANH_TRINH',
      trangThaiTruoc: '',
      trangThaiSau: payload.trangThai,
      noiTruoc: CENTER_NAME,
      noiSau: payload.noiDen,
      hinhThucChuyen: payload.hinhThucChuyen,
      hinhThucChuyenKhac: payload.hinhThucChuyenKhac,
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
      ghiChu: payload.ghiChu,
      tinhTrangKhiVe: '',
      uid: user.uid,
      email,
      displayName,
      createdAt: ts
    };
    updates[`${REPORT_ROOT}/congKhaiThongKe/chuyenVienTheoNgay/${businessDate}/${caseId}`] = true;
    updates[`${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}/${logId}`] = {
      action: 'Lập hành trình chuyển viện',
      content: `${payload.doiTuong} · ${CENTER_NAME} → ${payload.noiDen}`,
      reportId: caseId,
      loaiBaoCao: 'CHUYEN_VIEN',
      dataDate: businessDate,
      uid: user.uid,
      email,
      displayName,
      role: roleForLog(),
      createdAt: ts
    };
    try {
      await update(ref(db), updates);
    } catch (error) {
      await releaseOpenIndex(payload.doiTuongKey, caseId);
      throw error;
    }
    showToast('Đã lập hành trình chuyển viện.', 'ok');
    resetCreateForm();
    await loadJourneys(true);
    setSubView('tracking');
  } catch (error) {
    console.error(error);
    $('journeyCreateError').textContent = friendlyError(error, 'Không thể lưu hành trình chuyển viện. Vui lòng thử lại.');
  } finally {
    $('journeyCreateSave').disabled = false;
    $('journeyCreateSave').textContent = 'Xác nhận chuyển viện';
  }
}

async function deleteJourney(id) {
  if (!canDelete()) {
    showToast('Chỉ tài khoản Quản trị mới được xóa dữ liệu hành trình.', 'warn');
    return;
  }
  const item = findCase(id);
  if (!item) return;
  if (!window.confirm(`Xóa hành trình chuyển viện của ${item.doiTuong || 'đối tượng'}? Dữ liệu nghiệp vụ sẽ được đưa vào kho lưu vết dành cho Quản trị.`)) return;
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await get(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${id}`));
    if (!snap.exists()) throw new Error('Hành trình không còn tồn tại.');
    const raw = snap.val() || {};
    const info = raw.thongTin || {};
    const displayName = await resolveCurrentDisplayName();
    const email = normalizeEmail(user.email);
    const deletedAt = Date.now();
    const transferDate = isoDateFromTimestamp(info.createdAt || info.ngayGioDi || deletedAt);
    const historyEvents = Object.values(raw.lichSu || {});
    const deathEvent = historyEvents.filter((event) => event && event.loaiSuKien === 'TU_VONG_TAI_BENH_VIEN').sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
    const deathDate = deathEvent ? isoDateFromTimestamp(deathEvent.createdAt) : (info.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN' ? isoDateFromTimestamp(info.updatedAt || deletedAt) : '');
    const logMonth = (transferDate || todayIso()).slice(0, 7);
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${logMonth}`)).key;
    const updates = {};
    updates[`${REPORT_ROOT}/hanhTrinhDaXoa/${id}`] = {
      caseId: id,
      deletedAt,
      deletedByUid: user.uid,
      deletedByEmail: email,
      deletedByName: displayName,
      data: raw
    };
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${id}`] = null;
    if (info.doiTuongKey) updates[`${REPORT_ROOT}/hanhTrinhDangMo/${info.doiTuongKey}`] = null;
    if (transferDate) updates[`${REPORT_ROOT}/congKhaiThongKe/chuyenVienTheoNgay/${transferDate}/${id}`] = null;
    if (deathDate) updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${deathDate}/HOSP_${id}`] = null;
    updates[`${REPORT_ROOT}/nhatKy/${logMonth}/${logId}`] = {
      action: 'Xóa hành trình chuyển viện',
      content: `${info.doiTuong || item.doiTuong || 'Đối tượng'} · ${info.noiDiBanDau || CENTER_NAME} → ${info.noiHienTai || item.noiHienTai || '—'}`,
      reportId: id,
      loaiBaoCao: 'CHUYEN_VIEN',
      dataDate: transferDate || todayIso(),
      uid: user.uid,
      email,
      displayName,
      role: 'admin',
      createdAt: deletedAt
    };
    await update(ref(db), updates);
    showToast('Đã xóa hành trình và lưu bản lưu vết dành cho Quản trị.', 'ok');
    await loadJourneys(true);
  } catch (error) {
    console.error(error);
    showToast(friendlyError(error, 'Không thể xóa hành trình. Vui lòng kiểm tra quyền Quản trị và Firebase Rules.'), 'err');
  }
}

function findCase(id) {
  return [...state.openCases, ...state.closedCases].find((item) => item.id === id) || null;
}

function openUpdateDialog(id, preset) {
  if (!canEdit()) return;
  const item = findCase(id);
  if (!item || item.trangThaiKyThuat !== 'OPEN') return;
  state.selectedCase = item;
  $('journeyUpdatePatient').textContent = item.doiTuong || '—';
  $('journeyUpdateGender').textContent = validGender(item.gioiTinh) ? item.gioiTinh : 'Chưa ghi nhận';
  $('journeyUpdateBirthYear').textContent = validBirthYear(item.namSinh) ? String(item.namSinh) : 'Chưa ghi nhận';
  $('journeyUpdateBHYT').textContent = item.theBHYT || 'Chưa ghi nhận';
  $('journeyUpdateCurrentPlace').textContent = item.noiHienTai || '—';
  $('journeyUpdateCurrentStatus').textContent = statusLabel(item.trangThaiHienTai);
  $('journeyUpdateStatus').value = preset === 'DA_VE_TRUNG_TAM' ? 'DA_VE_TRUNG_TAM' : item.trangThaiHienTai;
  $('journeyUpdateDestination').value = '';
  $('journeyUpdateDestinationOther').value = '';
  $('journeyUpdateReason').value = '';
  $('journeyUpdateDiagnosis').value = '';
  $('journeyReturnCondition').value = '';
  $('journeyUpdateNote').value = '';
  $('journeyUpdateError').textContent = '';
  $('journeyUpdateSystemTime').textContent = 'Tự động ghi khi xác nhận';
  const user = auth.currentUser;
  $('journeyUpdateReporter').textContent = user ? currentDisplayName() : '—';
  updateUpdateFields();
  state.updateBaseline = formSignature(UPDATE_FIELD_IDS);
  state.lastFocus = document.activeElement;
  $('journeyUpdateLayer').hidden = false;
  setBodyModalState(true);
  window.setTimeout(() => $('journeyUpdateStatus')?.focus(), 0);
}

function updateUpdateFields() {
  const status = $('journeyUpdateStatus').value;
  const transfer = status === 'CHUYEN_TIEP_BENH_VIEN_KHAC';
  const returned = status === 'DA_VE_TRUNG_TAM';
  $('journeyUpdateDestinationField').hidden = !transfer;
  $('journeyUpdateReasonField').hidden = returned;
  $('journeyUpdateDiagnosisField').hidden = returned;
  $('journeyReturnConditionField').hidden = !returned;
  if (!transfer) {
    $('journeyUpdateDestination').value = '';
    $('journeyUpdateDestinationOther').value = '';
    $('journeyUpdateDestinationOtherField').hidden = true;
  } else {
    toggleOtherDestination('journeyUpdateDestination', 'journeyUpdateDestinationOtherField', 'journeyUpdateDestinationOther');
  }
}

function closeUpdateDialog(force = false) {
  if (!force && isUpdateDirty() && !confirmDiscard()) return false;
  $('journeyUpdateLayer').hidden = true;
  setBodyModalState(false);
  state.selectedCase = null;
  state.updateBaseline = '';
  $('journeyUpdateError').textContent = '';
  restoreFocus();
  return true;
}

function updatePayload() {
  const item = state.selectedCase;
  if (!item) throw new Error('Không xác định được hành trình cần cập nhật.');
  const status = String($('journeyUpdateStatus').value || '');
  const ghiChu = String($('journeyUpdateNote').value || '').trim();
  if (!ALL_STATUSES.includes(status)) throw new Error('Trạng thái hiện tại chưa hợp lệ.');
  if (ghiChu.length > 2000) throw new Error('Ghi chú không được vượt quá 2.000 ký tự.');

  if (status === 'DA_VE_TRUNG_TAM') {
    const tinhTrangKhiVe = String($('journeyReturnCondition').value || '').trim();
    if (!tinhTrangKhiVe || tinhTrangKhiVe.length > 1500) throw new Error('Vui lòng nhập Tình trạng khi về.');
    return { status, tinhTrangKhiVe, lyDo: '', tinhTrang: '', noiDen: CENTER_NAME, ghiChu };
  }

  const lyDo = String($('journeyUpdateReason').value || '').trim();
  const tinhTrang = String($('journeyUpdateDiagnosis').value || '').trim();
  if (!lyDo || lyDo.length > 1000) throw new Error('Vui lòng nhập Lý do.');
  if (!tinhTrang || tinhTrang.length > 1500) throw new Error('Vui lòng nhập Tình trạng/chẩn đoán.');

  let noiDen = item.noiHienTai;
  if (status === 'CHUYEN_TIEP_BENH_VIEN_KHAC') {
    noiDen = resolvedDestination('journeyUpdateDestination', 'journeyUpdateDestinationOther');
    if (!noiDen || noiDen.length > 300) throw new Error('Vui lòng chọn hoặc nhập Nơi đến khi chuyển tiếp bệnh viện khác.');
    if (normalizeText(noiDen) === normalizeText(item.noiHienTai)) throw new Error('Nơi đến mới phải khác nơi hiện tại.');
  }
  return { status, tinhTrangKhiVe: '', lyDo, tinhTrang, noiDen, ghiChu };
}

async function saveJourneyUpdate() {
  if (!canEdit() || !state.selectedCase) return;
  let payload;
  try { payload = updatePayload(); }
  catch (error) { $('journeyUpdateError').textContent = friendlyError(error); return; }
  const user = auth.currentUser;
  if (!user) { $('journeyUpdateError').textContent = 'Vui lòng đăng nhập lại.'; return; }
  $('journeyUpdateSave').disabled = true;
  $('journeyUpdateSave').textContent = 'Đang lưu...';
  try {
    const caseId = state.selectedCase.id;
    const latestSnap = await get(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}`));
    if (!latestSnap.exists()) throw new Error('Không tìm thấy hành trình.');
    const latest = caseFromRaw(caseId, latestSnap.val());
    if (latest.trangThaiKyThuat !== 'OPEN') throw new Error('Hành trình này đã kết thúc và không thể cập nhật thêm.');

    const historyId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/lichSu`)).key;
    const businessDate = await serverTodayIso();
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${businessDate.slice(0, 7)}`)).key;
    const displayName = await resolveCurrentDisplayName();
    const email = normalizeEmail(user.email);
    const ts = serverTimestamp();
    const isTransfer = payload.status === 'CHUYEN_TIEP_BENH_VIEN_KHAC';
    const isReturn = payload.status === 'DA_VE_TRUNG_TAM';
    const isDeath = payload.status === 'TU_VONG_TAI_BENH_VIEN';
    const isClosed = isReturn || isDeath;
    const nextOrder = Number(latest.thuTuChang || 1) + (isTransfer || isReturn ? 1 : 0);
    const nextInfo = {
      id: latest.id,
      doiTuong: latest.doiTuong,
      doiTuongNorm: latest.doiTuongNorm,
      theBHYT: latest.theBHYT || '',
      theBHYTNorm: latest.theBHYTNorm || '',
      doiTuongKey: latest.doiTuongKey,
      hinhThucChuyen: latest.hinhThucChuyen || inferLegacyTransferType(latest),
      hinhThucChuyenKhac: latest.hinhThucChuyenKhac || '',
      noiDiBanDau: latest.noiDiBanDau || CENTER_NAME,
      noiHienTai: isReturn ? CENTER_NAME : (isTransfer ? payload.noiDen : latest.noiHienTai),
      lyDoHienTai: isReturn ? latest.lyDoHienTai : payload.lyDo,
      tinhTrangChanDoanHienTai: isReturn ? latest.tinhTrangChanDoanHienTai : payload.tinhTrang,
      ghiChu: payload.ghiChu || latest.ghiChu || '',
      trangThaiHienTai: payload.status,
      trangThaiKyThuat: isClosed ? 'CLOSED' : 'OPEN',
      ngayGioDi: Number(latest.ngayGioDi || 0),
      ngayGioVe: isReturn ? ts : 0,
      tinhTrangKhiVe: isReturn ? payload.tinhTrangKhiVe : '',
      thuTuChang: nextOrder,
      version: Number(latest.version || 1) + 1,
      createdAt: Number(latest.createdAt || 0),
      createdByUid: latest.createdByUid,
      createdByEmail: latest.createdByEmail,
      createdByName: latest.createdByName,
      updatedAt: ts,
      updatedByUid: user.uid,
      updatedByEmail: email,
      updatedByName: displayName
    };
    if (validGender(latest.gioiTinh)) nextInfo.gioiTinh = latest.gioiTinh;
    if (validBirthYear(latest.namSinh)) nextInfo.namSinh = Number(latest.namSinh);
    const eventType = isTransfer ? 'CHUYEN_TIEP' : isReturn ? 'DA_VE_TRUNG_TAM' : isDeath ? 'TU_VONG_TAI_BENH_VIEN' : 'CAP_NHAT_TRANG_THAI';
    const updates = {};
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/thongTin`] = nextInfo;
    updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/lichSu/${historyId}`] = {
      id: historyId,
      caseId,
      loaiSuKien: eventType,
      trangThaiTruoc: latest.trangThaiHienTai || '',
      trangThaiSau: payload.status,
      noiTruoc: latest.noiHienTai || '',
      noiSau: isReturn ? CENTER_NAME : (isTransfer ? payload.noiDen : latest.noiHienTai || ''),
      hinhThucChuyen: latest.hinhThucChuyen || inferLegacyTransferType(latest),
      hinhThucChuyenKhac: latest.hinhThucChuyenKhac || '',
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
      ghiChu: payload.ghiChu,
      tinhTrangKhiVe: payload.tinhTrangKhiVe,
      uid: user.uid,
      email,
      displayName,
      createdAt: ts
    };
    if (isTransfer || isReturn) {
      const stageId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/chang`)).key;
      updates[`${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/chang/${stageId}`] = {
        id: stageId,
        caseId,
        thuTu: nextOrder,
        noiDi: latest.noiHienTai || '',
        noiDen: isReturn ? CENTER_NAME : payload.noiDen,
        hinhThucChuyen: latest.hinhThucChuyen || inferLegacyTransferType(latest),
        hinhThucChuyenKhac: latest.hinhThucChuyenKhac || '',
        lyDo: isReturn ? 'Trở về Trung tâm' : payload.lyDo,
        tinhTrangChanDoan: isReturn ? payload.tinhTrangKhiVe : payload.tinhTrang,
        ghiChu: payload.ghiChu,
        trangThaiSauChang: payload.status,
        thoiDiem: ts,
        uid: user.uid,
        email,
        displayName
      };
    }
    if (isClosed) {
      updates[`${REPORT_ROOT}/hanhTrinhDangMo/${latest.doiTuongKey}`] = null;
    }
    if (isDeath) {
      updates[`${REPORT_ROOT}/congKhaiThongKe/tuVongTheoNgay/${businessDate}/HOSP_${caseId}`] = true;
    }
    updates[`${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}/${logId}`] = {
      action: eventLabel(eventType),
      content: `${latest.doiTuong} · ${statusLabel(payload.status)}${isTransfer ? ` · ${latest.noiHienTai} → ${payload.noiDen}` : ''}`,
      reportId: caseId,
      loaiBaoCao: 'CHUYEN_VIEN',
      dataDate: businessDate,
      uid: user.uid,
      email,
      displayName,
      role: roleForLog(),
      createdAt: ts
    };
    await update(ref(db), updates);
    closeUpdateDialog(true);
    showToast(isReturn ? 'Đã xác nhận đối tượng về Trung tâm.' : isDeath ? 'Đã kết thúc hành trình với trạng thái tử vong tại bệnh viện.' : 'Đã cập nhật hành trình.', 'ok');
    await loadJourneys(true);
    setSubView(isClosed ? 'history' : 'tracking');
  } catch (error) {
    console.error(error);
    $('journeyUpdateError').textContent = friendlyError(error, 'Không thể cập nhật hành trình. Vui lòng thử lại.');
  } finally {
    $('journeyUpdateSave').disabled = false;
    $('journeyUpdateSave').textContent = 'Lưu cập nhật';
  }
}

function openDetail(id) {
  const item = findCase(id);
  if (!item) return;
  state.selectedCase = item;
  state.lastFocus = document.activeElement;
  $('journeyDetailTitle').textContent = item.doiTuong || 'Hành trình chuyển viện';
  const closed = item.trangThaiKyThuat === 'CLOSED';
  const hasDemographics = validGender(item.gioiTinh) || validBirthYear(item.namSinh);
  $('journeyDetailMeta').classList.toggle('has-demographics', hasDemographics);
  $('journeyDetailMeta').innerHTML = `
    <div class="journey-detail-summary-main">
      <div class="journey-detail-summary-facts">
        ${validGender(item.gioiTinh) ? `<span>${esc(item.gioiTinh)}</span>` : ''}
        ${validBirthYear(item.namSinh) ? `<span>Sinh năm ${esc(item.namSinh)}</span>` : ''}
        <span>BHYT ${esc(item.theBHYT || 'Chưa ghi nhận')}</span>
        <span>${esc(transferTypeLabel(inferLegacyTransferType(item), item.hinhThucChuyenKhac))}</span>
      </div>
      <span class="journey-status ${statusClass(item.trangThaiHienTai)}">${item.trangThaiHienTai === 'DA_VE_TRUNG_TAM' ? '✓ ' : ''}${esc(statusLabel(item.trangThaiHienTai))}</span>
    </div>
    <div class="journey-detail-summary-time"><span>Rời Trung tâm</span><strong>${esc(fmtDateTime(item.ngayGioDi))}</strong></div>
    ${closed ? `<div class="journey-detail-summary-time"><span>Kết thúc</span><strong>${esc(fmtDateTime(item.ngayGioVe || item.updatedAt))}</strong></div>` : ''}
    <div class="journey-detail-extra">
      <div><span>Nơi điều trị</span><strong>${esc(historyTreatmentPlace(item))}</strong></div>
      <div><span>Tình trạng / chẩn đoán</span><strong>${esc(historyDiagnosis(item))}</strong></div>
    </div>`;
  const events = Object.values(item.lichSu || {}).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  $('journeyTimeline').innerHTML = events.length ? events.map((event) => {
    const note = String(event.ghiChu || '').trim();
    const reason = String(event.lyDo || '').trim();
    const diagnosis = String(event.tinhTrangChanDoan || '').trim();
    const returnCondition = String(event.tinhTrangKhiVe || '').trim();
    const lines = [];
    if (event.loaiSuKien === 'DA_VE_TRUNG_TAM') {
      if (returnCondition) lines.push(`<p><b>Tình trạng khi về:</b> ${esc(returnCondition)}</p>`);
    } else {
      if (reason) lines.push(`<p><b>Lý do:</b> ${esc(reason)}</p>`);
      if (diagnosis) lines.push(`<p><b>Tình trạng/chẩn đoán:</b> ${esc(diagnosis)}</p>`);
    }
    if (note) lines.push(`<p><b>Ghi chú:</b> ${esc(note)}</p>`);
    const personLabel = event.loaiSuKien === 'MO_HANH_TRINH' ? 'Người nhập' : 'Người cập nhật';
    return `<div class="journey-timeline-item">
      <div class="journey-timeline-dot"></div>
      <div class="journey-timeline-card">
        <div class="journey-timeline-head"><strong>${esc(timelineTitle(event))}</strong><span>${esc(fmtDateTime(event.createdAt))}</span></div>
        <div class="journey-timeline-status ${statusClass(event.trangThaiSau)}">${esc(timelineBadge(event, item))}</div>
        ${lines.join('')}
        <div class="journey-timeline-by">${personLabel}: ${esc(preferredName(event.uid, event.displayName))}</div>
      </div>
    </div>`;
  }).join('') : '<div class="journey-empty">Chưa có lịch sử hành trình.</div>';
  $('journeyDetailLayer').hidden = false;
  setBodyModalState(true);
  window.setTimeout(() => $('journeyDetailCloseBottom')?.focus(), 0);
}

function closeDetail() {
  $('journeyDetailLayer').hidden = true;
  setBodyModalState(false);
  state.selectedCase = null;
  restoreFocus();
}

async function activate() {
  await refreshPermission();
  if (!validPermission(state.permission) && !isOwner()) return;
  if ($('journeyCreateTab')) $('journeyCreateTab').hidden = !canEdit();
  if (!state.createBaseline) resetCreateForm();
  await loadJourneys(false);
  setSubView(state.subView || 'tracking');
}

function setVisible(visible) {
  const panel = $('transferJourneyPanel');
  if (panel) panel.hidden = !visible;
  if (visible) activate().catch((error) => console.error(error));
}

function initEvents() {
  if (state.initialized) return;
  state.initialized = true;
  initializeActionPopoverPositioning();
  document.querySelectorAll('.journey-subtab').forEach((button) => {
    button.addEventListener('click', () => requestSubView(button.getAttribute('data-journey-view')));
  });
  $('journeyCreateSave')?.addEventListener('click', createJourney);
  $('journeyCreateCancel')?.addEventListener('click', () => requestSubView('tracking'));
  $('journeyCreateModeTransfer')?.addEventListener('click', () => { if (state.subView !== 'create') setSubView('create'); setTimeout(() => $('journeyPatient')?.focus(), 0); });
  $('journeyTransferType')?.addEventListener('change', updateCreateDynamicFields);
  $('journeyTo')?.addEventListener('change', updateCreateDynamicFields);
  $('journeyBHYT')?.addEventListener('input', () => { $('journeyBHYT').value = normalizeBHYT($('journeyBHYT').value); });
  $('journeyTrackingSearch')?.addEventListener('input', renderTracking);
  $('journeyTrackingReload')?.addEventListener('click', () => loadJourneys(true));
  $('journeyHistorySearch')?.addEventListener('input', renderHistory);
  $('journeyHistoryStatus')?.addEventListener('change', renderHistory);
  $('journeyHistoryReload')?.addEventListener('click', () => loadJourneys(true));
  $('btnOpenCenterDeathForm')?.addEventListener('click', () => {
    if (window.YTE_REPORTS && typeof window.YTE_REPORTS.openCenterDeathForm === 'function') window.YTE_REPORTS.openCenterDeathForm();
  });
  $('journeyTrackingList')?.addEventListener('click', (event) => {
    const button = event.target.closest('.journey-action');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    const menu = button.closest('details.journey-action-menu'); if (menu) menu.open = false;
    if (kind === 'view') openDetail(id);
    if (kind === 'update') openUpdateDialog(id, '');
    if (kind === 'return') openUpdateDialog(id, 'DA_VE_TRUNG_TAM');
    if (kind === 'delete') deleteJourney(id);
  });
  $('journeyHistoryList')?.addEventListener('click', (event) => {
    const button = event.target.closest('.journey-history-action');
    if (!button) return;
    const kind = button.getAttribute('data-kind');
    const menu = button.closest('details.journey-action-menu'); if (menu) menu.open = false;
    if (kind === 'view') openDetail(button.getAttribute('data-id'));
    if (kind === 'journey-delete') deleteJourney(button.getAttribute('data-id'));
    if (kind === 'center-death-view' && window.YTE_REPORTS && typeof window.YTE_REPORTS.openReportById === 'function') window.YTE_REPORTS.openReportById(button.getAttribute('data-id'));
    if (kind === 'center-death-edit' && window.YTE_REPORTS && typeof window.YTE_REPORTS.editReportById === 'function') window.YTE_REPORTS.editReportById(button.getAttribute('data-id'));
    if (kind === 'center-death-delete' && window.YTE_REPORTS && typeof window.YTE_REPORTS.deleteReportById === 'function') window.YTE_REPORTS.deleteReportById(button.getAttribute('data-id'));
  });
  $('journeyUpdateStatus')?.addEventListener('change', updateUpdateFields);
  $('journeyUpdateDestination')?.addEventListener('change', () => toggleOtherDestination('journeyUpdateDestination', 'journeyUpdateDestinationOtherField', 'journeyUpdateDestinationOther'));
  $('journeyUpdateCancel')?.addEventListener('click', () => closeUpdateDialog(false));
  $('journeyUpdateCloseX')?.addEventListener('click', () => closeUpdateDialog(false));
  $('journeyUpdateSave')?.addEventListener('click', saveJourneyUpdate);
  $('journeyDetailClose')?.addEventListener('click', closeDetail);
  $('journeyDetailCloseBottom')?.addEventListener('click', closeDetail);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('journeyUpdateLayer')?.hidden) closeUpdateDialog(false);
    else if (!$('journeyDetailLayer')?.hidden) closeDetail();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isCreateDirty() && !(!$('journeyUpdateLayer')?.hidden && isUpdateDirty())) return;
    event.preventDefault();
    event.returnValue = '';
  });
  state.refreshTimer = setInterval(() => {
    const panel = $('transferJourneyPanel');
    if (panel && !panel.hidden && state.subView === 'tracking') renderTracking();
  }, 60000);
}

window.YTE_JOURNEYS = {
  activate,
  setVisible,
  setSubView,
  loadJourneys,
  renderHistory,
  hasUnsavedChanges: () => isCreateDirty() || (!($('journeyUpdateLayer')?.hidden) && isUpdateDirty())
};

function start() {
  initEvents();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      stopJourneyRealtime();
      state.permission = null;
      state.openCases = [];
      state.closedCases = [];
      state.centerDeaths = [];
      state.transferStatsToday = {};
      state.deathStatsToday = {};
      state.displayNames = {};
      state.loadedAt = 0;
      return;
    }
    try {
      await refreshPermission();
      startJourneyRealtime();
      const reportsView = $('reportsView');
      const transferTab = document.querySelector('.report-type-tab[data-report-type="CHUYEN_VIEN"]');
      if (reportsView && reportsView.classList.contains('active') && transferTab && transferTab.classList.contains('active')) {
        await activate();
      }
    } catch (error) { console.error(error); }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
