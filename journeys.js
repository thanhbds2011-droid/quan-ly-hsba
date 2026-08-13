'use strict';

import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  get,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const CFG = window.YTE_APP_CONFIG || {};
const OWNER_EMAIL = String(CFG.OWNER_EMAIL || '').trim().toLowerCase();
const REPORT_ROOT = 'baoCaoYTe';
const CENTER_NAME = 'Trung tâm Bảo trợ xã hội Tân Hiệp';
const OPEN_STATUSES = ['TAI_KHAM', 'DANG_DIEU_TRI', 'CHUYEN_TIEP_BENH_VIEN_KHAC'];
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
  legacyTransfers: [],
  selectedCase: null,
  selectedCaseRaw: null,
  loading: false,
  loadedAt: 0,
  initialized: false,
  refreshTimer: null
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
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(value) {
  const p = String(value || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(value || '');
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
    TAI_KHAM: 'Tái khám',
    DANG_DIEU_TRI: 'Đang điều trị',
    CHUYEN_TIEP_BENH_VIEN_KHAC: 'Chuyển tiếp bệnh viện khác',
    TU_VONG_TAI_BENH_VIEN: 'Tử vong tại bệnh viện',
    DA_VE_TRUNG_TAM: 'Đã về Trung tâm'
  };
  return map[status] || status || '—';
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
function patientKey(name, bhyt) {
  const raw = `${normalizeText(name)}|${normalizeBHYT(bhyt)}`;
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
function activeDuplicate(name, bhyt) {
  const n = normalizeText(name);
  const b = normalizeBHYT(bhyt);
  return state.openCases.find((item) => {
    if (b && item.theBHYTNorm && normalizeBHYT(item.theBHYTNorm) === b) return true;
    return normalizeText(item.doiTuongNorm || item.doiTuong) === n;
  }) || null;
}
function statusClass(status) {
  if (status === 'DA_VE_TRUNG_TAM') return 'is-returned';
  if (status === 'TU_VONG_TAI_BENH_VIEN') return 'is-death';
  if (status === 'CHUYEN_TIEP_BENH_VIEN_KHAC') return 'is-transfer';
  if (status === 'DANG_DIEU_TRI') return 'is-treatment';
  return 'is-followup';
}
function journeyRouteHtml(item) {
  const stages = Object.values(item.chang || {}).sort((a, b) => Number(a.thuTu || 0) - Number(b.thuTu || 0));
  if (!stages.length) return `<span>${esc(CENTER_NAME)}</span><b>→</b><span>${esc(item.noiHienTai || '—')}</span>`;
  const places = [stages[0].noiDi || CENTER_NAME];
  stages.forEach((stage) => {
    const place = stage.noiDen || '';
    if (place && normalizeText(place) !== normalizeText(places[places.length - 1])) places.push(place);
  });
  return places.map((place, index) => `${index ? '<b>→</b>' : ''}<span>${esc(place)}</span>`).join('');
}
function staleBadge(item) {
  const hours = hoursSince(item.updatedAt || item.ngayGioDi);
  if (hours >= 24) return `<span class="journey-alert danger">Chưa cập nhật ${Math.floor(hours)} giờ</span>`;
  if (hours >= 12) return `<span class="journey-alert warn">Chưa cập nhật ${Math.floor(hours)} giờ</span>`;
  return '<span class="journey-alert ok">Đang được theo dõi</span>';
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

async function loadJourneys(force) {
  if (!validPermission(state.permission) && !isOwner()) return;
  if (!force && state.loadedAt && Date.now() - state.loadedAt < 30000) { renderTracking(); renderHistory(); return; }
  if (state.loading && !force) return;
  state.loading = true;
  showState('journeyTrackingLoadState', 'Đang tải hành trình chuyển viện...', '', true);
  try {
    const [journeySnap, legacySnap] = await Promise.all([
      get(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`)),
      get(ref(db, `${REPORT_ROOT}/baoCao`))
    ]);
    const rawJourneys = snapshotObject(journeySnap);
    const rawLegacy = snapshotObject(legacySnap);
    const all = Object.keys(rawJourneys).map((id) => caseFromRaw(id, rawJourneys[id]));
    state.openCases = all.filter((item) => item.trangThaiKyThuat === 'OPEN')
      .sort((a, b) => Number(a.ngayGioDi || 0) - Number(b.ngayGioDi || 0));
    state.closedCases = all.filter((item) => item.trangThaiKyThuat === 'CLOSED')
      .sort((a, b) => Number(b.ngayGioVe || b.updatedAt || 0) - Number(a.ngayGioVe || a.updatedAt || 0));
    state.legacyTransfers = Object.keys(rawLegacy).map((id) => ({ id, ...(rawLegacy[id] || {}) }))
      .filter((item) => item.loaiBaoCao === 'CHUYEN_VIEN' && item.trangThai !== 'deleted')
      .sort((a, b) => String(b.ngayBaoCao || '').localeCompare(String(a.ngayBaoCao || '')));
    state.loadedAt = Date.now();
    renderTracking();
    renderHistory();
    showState('journeyTrackingLoadState', '', '', false);
  } catch (error) {
    console.error(error);
    showState('journeyTrackingLoadState', error.message || String(error), 'err', false);
  } finally {
    state.loading = false;
  }
}

function renderTracking() {
  const search = normalizeText($('journeyTrackingSearch')?.value || '');
  const rows = state.openCases.filter((item) => {
    if (!search) return true;
    return normalizeText([
      item.doiTuong, item.theBHYT, item.noiHienTai, statusLabel(item.trangThaiHienTai),
      item.lyDoHienTai, item.tinhTrangChanDoanHienTai
    ].join(' ')).includes(search);
  });
  const stale12 = state.openCases.filter((item) => hoursSince(item.updatedAt || item.ngayGioDi) >= 12).length;
  const over24 = state.openCases.filter((item) => hoursSince(item.ngayGioDi) >= 24).length;
  if ($('journeyOpenCount')) $('journeyOpenCount').textContent = String(state.openCases.length);
  if ($('journeyStaleCount')) $('journeyStaleCount').textContent = String(stale12);
  if ($('journeyOver24Count')) $('journeyOver24Count').textContent = String(over24);
  if ($('journeyTrackingBadge')) $('journeyTrackingBadge').textContent = String(state.openCases.length);

  const box = $('journeyTrackingList');
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="journey-empty"><strong>Không có đối tượng đang theo dõi.</strong><span>Các hành trình chưa kết thúc sẽ xuất hiện tại đây.</span></div>';
    return;
  }
  box.innerHTML = rows.map((item) => {
    const canWrite = canEdit();
    return `<article class="journey-card">
      <div class="journey-card-main">
        <div class="journey-card-title">
          <div>
            <strong>${esc(item.doiTuong || 'Chưa có tên')}</strong>
            <span class="journey-bhyt">BHYT: ${esc(item.theBHYT || 'Chưa ghi nhận')}</span>
          </div>
          <span class="journey-status ${statusClass(item.trangThaiHienTai)}">${esc(statusLabel(item.trangThaiHienTai))}</span>
        </div>
        <div class="journey-location">
          <span>Hiện tại</span>
          <strong>${esc(item.noiHienTai || '—')}</strong>
        </div>
        <div class="journey-meta-grid">
          <div><span>Rời Trung tâm</span><strong>${esc(fmtDateTime(item.ngayGioDi))}</strong></div>
          <div><span>Đã ngoài Trung tâm</span><strong>${esc(durationText(item.ngayGioDi))}</strong></div>
          <div><span>Cập nhật gần nhất</span><strong>${esc(fmtDateTime(item.updatedAt))}</strong></div>
          <div><span>Người cập nhật</span><strong>${esc(item.updatedByName || item.createdByName || '—')}</strong></div>
        </div>
        <div class="journey-diagnosis"><span>Tình trạng/chẩn đoán</span><p>${esc(item.tinhTrangChanDoanHienTai || '—')}</p></div>
        <div class="journey-card-foot">${staleBadge(item)}</div>
      </div>
      <div class="journey-card-actions">
        <button class="small-btn btn-soft journey-action" data-kind="view" data-id="${esc(item.id)}" type="button">Xem hành trình</button>
        ${canWrite ? `<button class="small-btn btn-soft journey-action" data-kind="update" data-id="${esc(item.id)}" type="button">Cập nhật</button>
        <button class="small-btn btn-primary journey-action" data-kind="return" data-id="${esc(item.id)}" type="button">Đã về Trung tâm</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderHistory() {
  const search = normalizeText($('journeyHistorySearch')?.value || '');
  const filter = $('journeyHistoryStatus')?.value || 'all';
  const currentRows = state.closedCases.filter((item) => {
    if (filter !== 'all' && item.trangThaiHienTai !== filter) return false;
    if (!search) return true;
    return normalizeText([item.doiTuong, item.theBHYT, item.noiHienTai, statusLabel(item.trangThaiHienTai), item.tinhTrangKhiVe].join(' ')).includes(search);
  });
  const legacyRows = filter === 'all' ? state.legacyTransfers.filter((item) => {
    if (!search) return true;
    return normalizeText([item.hoTenBenhNhan, item.noiChuyen, item.noiDen, item.chanDoan, item.legacyNguoiNhap, item.createdByName].join(' ')).includes(search);
  }) : [];

  if ($('journeyReturnedCount')) $('journeyReturnedCount').textContent = String(state.closedCases.filter((x) => x.trangThaiHienTai === 'DA_VE_TRUNG_TAM').length);
  if ($('journeyHospitalDeathCount')) $('journeyHospitalDeathCount').textContent = String(state.closedCases.filter((x) => x.trangThaiHienTai === 'TU_VONG_TAI_BENH_VIEN').length);
  if ($('journeyLegacyCount')) $('journeyLegacyCount').textContent = String(state.legacyTransfers.length);

  const box = $('journeyHistoryList');
  if (!box) return;
  const currentHtml = currentRows.map((item) => `<article class="journey-history-card">
    <div class="journey-history-mark ${statusClass(item.trangThaiHienTai)}">${item.trangThaiHienTai === 'DA_VE_TRUNG_TAM' ? '✓' : 'TV'}</div>
    <div class="journey-history-main">
      <div class="journey-card-title"><div><strong>${esc(item.doiTuong)}</strong><span class="journey-bhyt">BHYT: ${esc(item.theBHYT || 'Chưa ghi nhận')}</span></div><span class="journey-status ${statusClass(item.trangThaiHienTai)}">${esc(statusLabel(item.trangThaiHienTai))}</span></div>
      <div class="journey-history-line">${journeyRouteHtml(item)}</div>
      <div class="journey-row-meta"><span>Đi: ${esc(fmtDateTime(item.ngayGioDi))}</span><span>${item.ngayGioVe ? `Về: ${esc(fmtDateTime(item.ngayGioVe))}` : `Kết thúc: ${esc(fmtDateTime(item.updatedAt))}`}</span></div>
    </div>
    <div class="journey-history-actions"><button class="small-btn btn-soft journey-history-action" data-kind="view" data-id="${esc(item.id)}" type="button">Xem hành trình</button></div>
  </article>`).join('');

  const legacyHtml = legacyRows.map((item) => `<article class="journey-history-card is-legacy">
    <div class="journey-history-mark legacy">CV</div>
    <div class="journey-history-main">
      <div class="journey-card-title"><div><strong>${esc(item.hoTenBenhNhan || '—')}</strong><span class="journey-bhyt">Dữ liệu chuyển viện trước khi triển khai hành trình</span></div><span class="journey-status legacy">Dữ liệu cũ</span></div>
      <div class="journey-history-line"><span>${esc(item.noiChuyen || '—')}</span><b>→</b><span>${esc(item.noiDen || '—')}</span></div>
      <div class="journey-row-meta"><span>Ngày: ${esc(fmtDate(item.ngayChuyenVien || item.ngayBaoCao))}</span><span>Người nhập: ${esc(item.createdByName || item.legacyNguoiNhap || '—')}</span></div>
      ${item.chanDoan ? `<p class="journey-legacy-note">${esc(item.chanDoan)}</p>` : ''}
    </div>
  </article>`).join('');

  box.innerHTML = currentHtml + legacyHtml || '<div class="journey-empty"><strong>Chưa có lịch sử phù hợp.</strong><span>Điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.</span></div>';
}

function setSubView(name) {
  name = ['tracking', 'create', 'history'].includes(name) ? name : 'tracking';
  if (name === 'create' && !canEdit()) name = 'tracking';
  state.subView = name;
  document.querySelectorAll('.journey-subtab').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-journey-view') === name);
  });
  ['tracking', 'create', 'history'].forEach((key) => {
    const panel = $('journey' + key[0].toUpperCase() + key.slice(1) + 'Panel');
    if (panel) panel.hidden = key !== name;
  });
  if (name === 'tracking') loadJourneys(false);
  if (name === 'history') loadJourneys(false);
  if (name === 'create') resetCreateForm();
}

function resetCreateForm() {
  if (!$('journeyCreateForm')) return;
  $('journeyPatient').value = '';
  $('journeyBHYT').value = '';
  $('journeyFrom').value = CENTER_NAME;
  $('journeyTo').value = '';
  $('journeyReason').value = '';
  $('journeyDiagnosis').value = '';
  $('journeyInitialStatus').value = 'TAI_KHAM';
  $('journeyCreateError').textContent = '';
  $('journeySystemTime').textContent = 'Tự động ghi thời điểm thực tế khi lưu';
  const user = auth.currentUser;
  $('journeyReporter').textContent = user ? String(user.displayName || user.email || '—') : '—';
}

function createPayload() {
  const doiTuong = String($('journeyPatient').value || '').trim();
  const theBHYT = normalizeBHYT($('journeyBHYT').value || '');
  const noiDen = String($('journeyTo').value || '').trim();
  const lyDo = String($('journeyReason').value || '').trim();
  const tinhTrang = String($('journeyDiagnosis').value || '').trim();
  const trangThai = String($('journeyInitialStatus').value || '');
  if (doiTuong.length < 2 || doiTuong.length > 150) throw new Error('Vui lòng nhập Đối tượng từ 2 đến 150 ký tự.');
  if (theBHYT.length > 40) throw new Error('Thẻ BHYT không hợp lệ.');
  if (!noiDen || noiDen.length > 300) throw new Error('Vui lòng nhập Nơi đến.');
  if (!lyDo || lyDo.length > 1000) throw new Error('Vui lòng nhập Lý do.');
  if (!tinhTrang || tinhTrang.length > 1500) throw new Error('Vui lòng nhập Tình trạng/chẩn đoán.');
  if (!['TAI_KHAM', 'DANG_DIEU_TRI'].includes(trangThai)) throw new Error('Trạng thái khi lập chuyển viện chưa hợp lệ.');
  return {
    doiTuong,
    doiTuongNorm: normalizeText(doiTuong),
    theBHYT,
    theBHYTNorm: theBHYT,
    doiTuongKey: patientKey(doiTuong, theBHYT),
    noiDen,
    lyDo,
    tinhTrang,
    trangThai
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
  catch (error) { $('journeyCreateError').textContent = error.message || String(error); return; }
  const user = auth.currentUser;
  if (!user) { $('journeyCreateError').textContent = 'Vui lòng đăng nhập lại.'; return; }
  $('journeyCreateError').textContent = '';
  $('journeyCreateSave').disabled = true;
  $('journeyCreateSave').textContent = 'Đang lưu...';
  try {
    await loadJourneys(true);
    const duplicate = activeDuplicate(payload.doiTuong, payload.theBHYT);
    if (duplicate) throw new Error(`Đối tượng đang có hành trình chưa kết thúc tại ${duplicate.noiHienTai || 'cơ sở y tế'}.`);

    const caseId = 'HTCV_' + push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien`)).key;
    await claimOpenIndex(payload.doiTuongKey, caseId);
    const stageId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/chang`)).key;
    const historyId = push(ref(db, `${REPORT_ROOT}/hanhTrinhChuyenVien/${caseId}/lichSu`)).key;
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}`)).key;
    const displayName = String(user.displayName || user.email || '').slice(0, 150);
    const email = normalizeEmail(user.email);
    const ts = serverTimestamp();
    const info = {
      id: caseId,
      doiTuong: payload.doiTuong,
      doiTuongNorm: payload.doiTuongNorm,
      theBHYT: payload.theBHYT,
      theBHYTNorm: payload.theBHYTNorm,
      doiTuongKey: payload.doiTuongKey,
      noiDiBanDau: CENTER_NAME,
      noiHienTai: payload.noiDen,
      lyDoHienTai: payload.lyDo,
      tinhTrangChanDoanHienTai: payload.tinhTrang,
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
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
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
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
      tinhTrangKhiVe: '',
      uid: user.uid,
      email,
      displayName,
      createdAt: ts
    };
    updates[`${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}/${logId}`] = {
      action: 'Lập hành trình chuyển viện',
      content: `${payload.doiTuong} · ${CENTER_NAME} → ${payload.noiDen}`,
      reportId: caseId,
      loaiBaoCao: 'CHUYEN_VIEN',
      dataDate: todayIso(),
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
    $('journeyCreateError').textContent = error.message || String(error);
  } finally {
    $('journeyCreateSave').disabled = false;
    $('journeyCreateSave').textContent = 'Xác nhận chuyển viện';
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
  $('journeyUpdateBHYT').textContent = item.theBHYT || 'Chưa ghi nhận';
  $('journeyUpdateCurrentPlace').textContent = item.noiHienTai || '—';
  $('journeyUpdateCurrentStatus').textContent = statusLabel(item.trangThaiHienTai);
  $('journeyUpdateStatus').value = preset === 'DA_VE_TRUNG_TAM' ? 'DA_VE_TRUNG_TAM' : item.trangThaiHienTai;
  $('journeyUpdateDestination').value = '';
  $('journeyUpdateReason').value = '';
  $('journeyUpdateDiagnosis').value = '';
  $('journeyReturnCondition').value = '';
  $('journeyUpdateError').textContent = '';
  $('journeyUpdateSystemTime').textContent = 'Tự động ghi thời điểm thực tế khi xác nhận';
  const user = auth.currentUser;
  $('journeyUpdateReporter').textContent = user ? String(user.displayName || user.email || '—') : '—';
  updateUpdateFields();
  $('journeyUpdateLayer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function updateUpdateFields() {
  const status = $('journeyUpdateStatus').value;
  const transfer = status === 'CHUYEN_TIEP_BENH_VIEN_KHAC';
  const returned = status === 'DA_VE_TRUNG_TAM';
  $('journeyUpdateDestinationField').hidden = !transfer;
  $('journeyUpdateReasonField').hidden = returned;
  $('journeyUpdateDiagnosisField').hidden = returned;
  $('journeyReturnConditionField').hidden = !returned;
  if (returned) {
    $('journeyUpdateDestination').value = CENTER_NAME;
  }
}

function closeUpdateDialog() {
  $('journeyUpdateLayer').hidden = true;
  document.body.style.overflow = '';
  state.selectedCase = null;
  $('journeyUpdateError').textContent = '';
}

function updatePayload() {
  const item = state.selectedCase;
  if (!item) throw new Error('Không xác định được hành trình cần cập nhật.');
  const status = String($('journeyUpdateStatus').value || '');
  if (!ALL_STATUSES.includes(status)) throw new Error('Trạng thái hiện tại chưa hợp lệ.');
  if (status === 'DA_VE_TRUNG_TAM') {
    const tinhTrangKhiVe = String($('journeyReturnCondition').value || '').trim();
    if (!tinhTrangKhiVe || tinhTrangKhiVe.length > 1500) throw new Error('Vui lòng nhập Tình trạng khi về.');
    return { status, tinhTrangKhiVe, lyDo: '', tinhTrang: '', noiDen: CENTER_NAME };
  }
  const lyDo = String($('journeyUpdateReason').value || '').trim();
  const tinhTrang = String($('journeyUpdateDiagnosis').value || '').trim();
  if (!lyDo || lyDo.length > 1000) throw new Error('Vui lòng nhập Lý do.');
  if (!tinhTrang || tinhTrang.length > 1500) throw new Error('Vui lòng nhập Tình trạng/chẩn đoán.');
  let noiDen = item.noiHienTai;
  if (status === 'CHUYEN_TIEP_BENH_VIEN_KHAC') {
    noiDen = String($('journeyUpdateDestination').value || '').trim();
    if (!noiDen || noiDen.length > 300) throw new Error('Vui lòng nhập Nơi đến khi chuyển tiếp bệnh viện khác.');
    if (normalizeText(noiDen) === normalizeText(item.noiHienTai)) throw new Error('Nơi đến mới phải khác nơi hiện tại.');
  }
  return { status, tinhTrangKhiVe: '', lyDo, tinhTrang, noiDen };
}

async function saveJourneyUpdate() {
  if (!canEdit() || !state.selectedCase) return;
  let payload;
  try { payload = updatePayload(); }
  catch (error) { $('journeyUpdateError').textContent = error.message || String(error); return; }
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
    const logId = push(ref(db, `${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}`)).key;
    const displayName = String(user.displayName || user.email || '').slice(0, 150);
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
      noiDiBanDau: latest.noiDiBanDau || CENTER_NAME,
      noiHienTai: isReturn ? CENTER_NAME : (isTransfer ? payload.noiDen : latest.noiHienTai),
      lyDoHienTai: isReturn ? latest.lyDoHienTai : payload.lyDo,
      tinhTrangChanDoanHienTai: isReturn ? latest.tinhTrangChanDoanHienTai : payload.tinhTrang,
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
      lyDo: payload.lyDo,
      tinhTrangChanDoan: payload.tinhTrang,
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
        lyDo: isReturn ? 'Trở về Trung tâm' : payload.lyDo,
        tinhTrangChanDoan: isReturn ? payload.tinhTrangKhiVe : payload.tinhTrang,
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
    updates[`${REPORT_ROOT}/nhatKy/${todayIso().slice(0, 7)}/${logId}`] = {
      action: eventLabel(eventType),
      content: `${latest.doiTuong} · ${statusLabel(payload.status)}${isTransfer ? ` · ${latest.noiHienTai} → ${payload.noiDen}` : ''}`,
      reportId: caseId,
      loaiBaoCao: 'CHUYEN_VIEN',
      dataDate: todayIso(),
      uid: user.uid,
      email,
      displayName,
      role: roleForLog(),
      createdAt: ts
    };
    await update(ref(db), updates);
    closeUpdateDialog();
    showToast(isReturn ? 'Đã xác nhận đối tượng về Trung tâm.' : isDeath ? 'Đã kết thúc hành trình với trạng thái tử vong tại bệnh viện.' : 'Đã cập nhật hành trình.', 'ok');
    await loadJourneys(true);
    setSubView(isClosed ? 'history' : 'tracking');
  } catch (error) {
    console.error(error);
    $('journeyUpdateError').textContent = error.message || String(error);
  } finally {
    $('journeyUpdateSave').disabled = false;
    $('journeyUpdateSave').textContent = 'Lưu cập nhật';
  }
}

function openDetail(id) {
  const item = findCase(id);
  if (!item) return;
  state.selectedCase = item;
  $('journeyDetailTitle').textContent = item.doiTuong || 'Hành trình chuyển viện';
  $('journeyDetailMeta').innerHTML = `
    <div><span>Thẻ BHYT</span><strong>${esc(item.theBHYT || 'Chưa ghi nhận')}</strong></div>
    <div><span>Trạng thái</span><strong>${esc(statusLabel(item.trangThaiHienTai))}</strong></div>
    <div><span>Rời Trung tâm</span><strong>${esc(fmtDateTime(item.ngayGioDi))}</strong></div>
    <div><span>${item.trangThaiHienTai === 'DA_VE_TRUNG_TAM' ? 'Ngày giờ về' : 'Cập nhật cuối'}</span><strong>${esc(fmtDateTime(item.ngayGioVe || item.updatedAt))}</strong></div>`;
  const events = Object.values(item.lichSu || {}).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  $('journeyTimeline').innerHTML = events.length ? events.map((event) => {
    const move = event.noiTruoc && event.noiSau && normalizeText(event.noiTruoc) !== normalizeText(event.noiSau)
      ? `<div class="journey-timeline-route"><span>${esc(event.noiTruoc)}</span><b>→</b><span>${esc(event.noiSau)}</span></div>` : '';
    const body = event.loaiSuKien === 'DA_VE_TRUNG_TAM'
      ? `<p><b>Tình trạng khi về:</b> ${esc(event.tinhTrangKhiVe || '—')}</p>`
      : `<p><b>Lý do:</b> ${esc(event.lyDo || '—')}</p><p><b>Tình trạng/chẩn đoán:</b> ${esc(event.tinhTrangChanDoan || '—')}</p>`;
    return `<div class="journey-timeline-item">
      <div class="journey-timeline-dot"></div>
      <div class="journey-timeline-card">
        <div class="journey-timeline-head"><strong>${esc(eventLabel(event.loaiSuKien))}</strong><span>${esc(fmtDateTime(event.createdAt))}</span></div>
        ${move}
        <div class="journey-timeline-status">${esc(statusLabel(event.trangThaiSau))}</div>
        ${body}
        <div class="journey-timeline-by">Người nhập: ${esc(event.displayName || '—')}</div>
      </div>
    </div>`;
  }).join('') : '<div class="journey-empty">Chưa có lịch sử hành trình.</div>';
  $('journeyDetailLayer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('journeyDetailLayer').hidden = true;
  document.body.style.overflow = '';
  state.selectedCase = null;
}

async function activate() {
  await refreshPermission();
  if (!validPermission(state.permission) && !isOwner()) return;
  if ($('journeyCreateTab')) $('journeyCreateTab').hidden = !canEdit();
  resetCreateForm();
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
  document.querySelectorAll('.journey-subtab').forEach((button) => {
    button.addEventListener('click', () => setSubView(button.getAttribute('data-journey-view')));
  });
  $('journeyCreateSave')?.addEventListener('click', createJourney);
  $('journeyCreateCancel')?.addEventListener('click', () => setSubView('tracking'));
  $('journeyBHYT')?.addEventListener('input', () => { $('journeyBHYT').value = normalizeBHYT($('journeyBHYT').value); });
  $('journeyTrackingSearch')?.addEventListener('input', renderTracking);
  $('journeyTrackingReload')?.addEventListener('click', () => loadJourneys(true));
  $('journeyHistorySearch')?.addEventListener('input', renderHistory);
  $('journeyHistoryStatus')?.addEventListener('change', renderHistory);
  $('journeyHistoryReload')?.addEventListener('click', () => loadJourneys(true));
  $('journeyTrackingList')?.addEventListener('click', (event) => {
    const button = event.target.closest('.journey-action');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const kind = button.getAttribute('data-kind');
    if (kind === 'view') openDetail(id);
    if (kind === 'update') openUpdateDialog(id, '');
    if (kind === 'return') openUpdateDialog(id, 'DA_VE_TRUNG_TAM');
  });
  $('journeyHistoryList')?.addEventListener('click', (event) => {
    const button = event.target.closest('.journey-history-action');
    if (!button) return;
    if (button.getAttribute('data-kind') === 'view') openDetail(button.getAttribute('data-id'));
  });
  $('journeyUpdateStatus')?.addEventListener('change', updateUpdateFields);
  $('journeyUpdateCancel')?.addEventListener('click', closeUpdateDialog);
  $('journeyUpdateCloseX')?.addEventListener('click', closeUpdateDialog);
  $('journeyUpdateSave')?.addEventListener('click', saveJourneyUpdate);
  $('journeyUpdateLayer')?.addEventListener('click', (event) => { if (event.target === $('journeyUpdateLayer')) closeUpdateDialog(); });
  $('journeyDetailClose')?.addEventListener('click', closeDetail);
  $('journeyDetailCloseBottom')?.addEventListener('click', closeDetail);
  $('journeyDetailLayer')?.addEventListener('click', (event) => { if (event.target === $('journeyDetailLayer')) closeDetail(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('journeyUpdateLayer')?.hidden) closeUpdateDialog();
    else if (!$('journeyDetailLayer')?.hidden) closeDetail();
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
  loadJourneys
};

function start() {
  initEvents();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.permission = null;
      state.openCases = [];
      state.closedCases = [];
      state.loadedAt = 0;
      return;
    }
    try {
      await refreshPermission();
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
