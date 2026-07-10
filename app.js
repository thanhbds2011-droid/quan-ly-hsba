const state = {
  patients: [],
  deaths: [],
  stats: {},
  currentPatient: null,
  currentBooks: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  setTodayDefaults();
  checkApiConfig();

  if (!window.hsbaApi.isConfigured()) return;

  await Promise.allSettled([
    loadPatients(),
    loadDeaths(),
    loadStats()
  ]);

  registerServiceWorker();
}

function bindEvents() {
  $('#menuBtn').addEventListener('click', openSidebar);
  $('#overlay').addEventListener('click', closeSidebar);
  $('#syncBtn').addEventListener('click', syncAll);

  $$('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
      switchView(button.dataset.view);
      closeSidebar();
    });
  });

  $('#searchBtn').addEventListener('click', () => loadPatients($('#searchInput').value));
  $('#searchInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadPatients(event.currentTarget.value);
  });

  $('#openAddPatientBtn').addEventListener('click', () => $('#patientModal').showModal());
  $('#backToPatientsBtn').addEventListener('click', () => switchView('patients'));

  $$('.close-modal').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });

  $('#patientForm').addEventListener('submit', submitPatient);
  $('#bookForm').addEventListener('submit', submitNewBook);
  $('#closeBookForm').addEventListener('submit', submitCloseBook);
}

function checkApiConfig() {
  $('#setupNotice').classList.toggle('hidden', window.hsbaApi.isConfigured());
}

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  $('#bookForm [name="ngayBatDau"]').value = today;
  $('#closeBookForm [name="ngayKetThuc"]').value = today;
}

async function syncAll() {
  if (!window.hsbaApi.isConfigured()) {
    showToast('Chưa cấu hình URL Apps Script.', true);
    return;
  }

  await Promise.allSettled([
    loadPatients($('#searchInput').value),
    loadDeaths(),
    loadStats()
  ]);

  if (state.currentPatient) {
    await openPatient(state.currentPatient['SỐ HỒ SƠ']);
  }

  showToast('Đã đồng bộ dữ liệu.');
}

async function loadPatients(keyword = '') {
  return withLoading(async () => {
    const result = await window.hsbaApi.get('layDanhSachDoiTuong', { keyword });
    state.patients = result.data || [];
    renderPatients();
  });
}

function renderPatients() {
  const list = $('#patientsList');
  const empty = $('#patientsEmpty');
  const summary = $('#patientsSummary');

  summary.innerHTML = `
    <span class="summary-chip">${state.patients.length} đối tượng</span>
    <span class="summary-chip">${state.patients.filter(x => x['QUYỂN ĐANG MỞ']).length} hồ sơ đang mở</span>
  `;

  if (!state.patients.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  list.innerHTML = state.patients.map(patient => {
    const latest = patient['TRẠNG THÁI MỚI NHẤT'] || '';
    const statusClass = latest === window.HSBA_CONFIG.STATUS.TU_VONG
      ? 'death'
      : patient['QUYỂN ĐANG MỞ'] ? 'open' : 'closed';

    const statusLabel = latest || 'Chưa có quyển hồ sơ';

    return `
      <article class="patient-card">
        <div>
          <h3>${escapeHtml(patient['HỌ VÀ TÊN'])}</h3>
          <p><strong>Số hồ sơ:</strong> ${escapeHtml(patient['SỐ HỒ SƠ'])}</p>
          <p><strong>Năm sinh:</strong> ${escapeHtml(patient['NĂM SINH'])}</p>

          <div class="patient-meta">
            <span class="badge">Tổng quyển: ${Number(patient['TỔNG SỐ QUYỂN']) || 0}</span>
            ${patient['QUYỂN ĐANG MỞ']
              ? `<span class="badge open">Đang dùng quyển ${escapeHtml(patient['QUYỂN ĐANG MỞ'])}</span>`
              : ''}
            <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
          </div>
        </div>

        <button class="btn small" onclick="openPatient('${escapeJs(patient['SỐ HỒ SƠ'])}')">
          Xem hồ sơ
        </button>
      </article>
    `;
  }).join('');
}

async function openPatient(soHoSo) {
  return withLoading(async () => {
    const patient = state.patients.find(
      item => String(item['SỐ HỒ SƠ']).toUpperCase() === String(soHoSo).toUpperCase()
    );

    const result = await window.hsbaApi.get('layChiTietHoSo', { soHoSo });

    state.currentPatient = patient || {
      'SỐ HỒ SƠ': soHoSo,
      'HỌ VÀ TÊN': '',
      'NĂM SINH': ''
    };

    state.currentBooks = result.data || [];

    renderPatientDetail();
    switchView('detail');
  });
}

function renderPatientDetail() {
  const patient = state.currentPatient;
  const books = state.currentBooks;
  const hasOpenBook = books.some(book => !book['NGÀY KẾT THÚC']);
  const isDeath = books.some(
    book => book['TRẠNG THÁI HIỆN TẠI'] === window.HSBA_CONFIG.STATUS.TU_VONG
  );

  $('#patientDetail').innerHTML = `
    <section class="detail-header">
      <h2>${escapeHtml(patient['HỌ VÀ TÊN'])}</h2>
      <p>Số hồ sơ: <strong>${escapeHtml(patient['SỐ HỒ SƠ'])}</strong></p>
      <p>Năm sinh: <strong>${escapeHtml(patient['NĂM SINH'])}</strong></p>

      <div class="detail-actions">
        <button
          class="btn"
          ${hasOpenBook || isDeath ? 'disabled' : ''}
          onclick="openNewBookModal('${escapeJs(patient['SỐ HỒ SƠ'])}')">
          ＋ Mở quyển mới
        </button>
      </div>
    </section>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Quyển số</th>
            <th>Ngày bắt đầu</th>
            <th>Ngày kết thúc</th>
            <th>Trạng thái</th>
            <th>Mã lưu trữ</th>
            <th>File</th>
            <th>Ghi chú</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${books.length ? books.map(renderBookRow).join('') : `
            <tr>
              <td colspan="8">Đối tượng chưa có quyển hồ sơ.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderBookRow(book) {
  const isOpen = !book['NGÀY KẾT THÚC'];
  const status = book['TRẠNG THÁI HIỆN TẠI'] || '';
  const statusClass = status === window.HSBA_CONFIG.STATUS.TU_VONG
    ? 'death'
    : isOpen ? 'open' : 'closed';

  return `
    <tr>
      <td><strong>${escapeHtml(book['QUYỂN SỐ'])}</strong></td>
      <td>${escapeHtml(book['NGÀY BẮT ĐẦU'])}</td>
      <td>${escapeHtml(book['NGÀY KẾT THÚC'] || '—')}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(book['MÃ SỐ LƯU TRỮ'] || '—')}</td>
      <td>${book['FILE ĐÍNH KÈM']
        ? `<a class="file-link" href="${escapeAttr(book['FILE ĐÍNH KÈM'])}" target="_blank" rel="noopener">Mở file</a>`
        : '—'}
      </td>
      <td>${escapeHtml(book['GHI CHÚ'] || '')}</td>
      <td>
        ${isOpen
          ? `<button class="btn small danger" onclick="openCloseBookModal('${escapeJs(book['SỐ HỒ SƠ'])}', ${Number(book['QUYỂN SỐ'])})">Kết thúc</button>`
          : ''}
      </td>
    </tr>
  `;
}

function openNewBookModal(soHoSo) {
  const form = $('#bookForm');
  form.reset();
  form.elements.soHoSo.value = soHoSo;
  form.elements.ngayBatDau.value = new Date().toISOString().slice(0, 10);
  $('#bookModal').showModal();
}

function openCloseBookModal(soHoSo, quyenSo) {
  const form = $('#closeBookForm');
  form.reset();
  form.elements.soHoSo.value = soHoSo;
  form.elements.quyenSo.value = quyenSo;
  form.elements.ngayKetThuc.value = new Date().toISOString().slice(0, 10);
  $('#closeBookModal').showModal();
}

async function submitPatient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());

  await withLoading(async () => {
    const result = await window.hsbaApi.post('themDoiTuong', data);
    showToast(result.message || 'Đã thêm đối tượng.');
    form.reset();
    $('#patientModal').close();
    await loadPatients();
  });
}

async function submitNewBook(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());

  await withLoading(async () => {
    const result = await window.hsbaApi.post('themQuyenHoSo', data);
    showToast(result.message || 'Đã mở quyển mới.');
    $('#bookModal').close();
    await loadPatients();
    await openPatient(data.soHoSo);
    await loadStats();
  });
}

async function submitCloseBook(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const file = formData.get('file');
  const data = Object.fromEntries(formData.entries());
  delete data.file;

  await withLoading(async () => {
    let uploadedFileUrl = '';

    if (file && file.size) {
      const uploadResult = await window.hsbaApi.uploadFile({
        soHoSo: data.soHoSo,
        quyenSo: Number(data.quyenSo),
        file
      });

      uploadedFileUrl = uploadResult.data.fileUrl;
    }

    const result = await window.hsbaApi.post('ketThucQuyenHoSo', {
      ...data,
      quyenSo: Number(data.quyenSo),
      fileDinhKem: uploadedFileUrl
    });

    showToast(result.message || 'Đã kết thúc quyển hồ sơ.');
    $('#closeBookModal').close();

    await Promise.all([
      loadPatients(),
      loadDeaths(),
      loadStats()
    ]);

    await openPatient(data.soHoSo);
  });
}

async function loadDeaths() {
  return withLoading(async () => {
    const result = await window.hsbaApi.get('layHoSoTuVong');
    state.deaths = result.data || [];
    renderDeaths();
  }, false);
}

function renderDeaths() {
  const container = $('#deathsList');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Số hồ sơ</th>
          <th>Họ và tên</th>
          <th>Năm sinh</th>
          <th>Quyển số</th>
          <th>Ngày kết thúc</th>
          <th>Mã lưu trữ</th>
          <th>File</th>
        </tr>
      </thead>
      <tbody>
        ${state.deaths.length ? state.deaths.map(item => `
          <tr>
            <td>${escapeHtml(item['SỐ HỒ SƠ'])}</td>
            <td><strong>${escapeHtml(item['HỌ VÀ TÊN'])}</strong></td>
            <td>${escapeHtml(item['NĂM SINH'])}</td>
            <td>${escapeHtml(item['QUYỂN SỐ'])}</td>
            <td>${escapeHtml(item['NGÀY KẾT THÚC'])}</td>
            <td>${escapeHtml(item['MÃ SỐ LƯU TRỮ'])}</td>
            <td>${item['FILE ĐÍNH KÈM']
              ? `<a class="file-link" href="${escapeAttr(item['FILE ĐÍNH KÈM'])}" target="_blank" rel="noopener">Mở file</a>`
              : '—'}
            </td>
          </tr>
        `).join('') : `
          <tr><td colspan="7">Chưa có hồ sơ tử vong.</td></tr>
        `}
      </tbody>
    </table>
  `;
}

async function loadStats() {
  return withLoading(async () => {
    const result = await window.hsbaApi.get('layThongKe');
    state.stats = result.data || {};
    renderStats();
  }, false);
}

function renderStats() {
  const items = [
    ['Tổng đối tượng', state.stats.tongDoiTuong],
    ['Tổng quyển hồ sơ', state.stats.tongQuyenHoSo],
    ['Hồ sơ đang mở', state.stats.hoSoDangMo],
    ['Đã lưu kho', state.stats.hoSoDaLuuKho],
    ['Hồ sơ tử vong', state.stats.hoSoTuVong],
    ['Có file scan', state.stats.hoSoCoFile],
    ['Chưa có file scan', state.stats.hoSoChuaFile]
  ];

  $('#statsGrid').innerHTML = items.map(([label, value]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${Number(value) || 0}</strong>
    </article>
  `).join('');
}

function switchView(name) {
  $$('.view').forEach(view => view.classList.remove('active'));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));

  const map = {
    patients: '#patientsView',
    deaths: '#deathsView',
    dashboard: '#dashboardView',
    detail: '#detailView'
  };

  $(map[name] || '#patientsView').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar').setAttribute('aria-hidden', 'false');
  $('#overlay').classList.add('show');
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar').setAttribute('aria-hidden', 'true');
  $('#overlay').classList.remove('show');
}

async function withLoading(callback, showOverlay = true) {
  if (showOverlay) $('#loading').classList.remove('hidden');

  try {
    return await callback();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Có lỗi xảy ra.', true);
    throw error;
  } finally {
    if (showOverlay) $('#loading').classList.add('hidden');
  }
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3800);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
  }
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

function escapeJs(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'");
}

window.openPatient = openPatient;
window.openNewBookModal = openNewBookModal;
window.openCloseBookModal = openCloseBookModal;
