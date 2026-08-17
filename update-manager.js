'use strict';

(function () {
  const cfg = window.YTE_APP_CONFIG || {};
  const currentVersion = String(cfg.VERSION || '9.5.7');
  const CHECK_INTERVAL_MS = 60000;
  const DISMISS_TTL_MS = 15 * 60 * 1000;
  let registration = null;
  let reloadOnControllerChange = false;
  let latestRelease = null;
  let checkTimer = null;
  let checking = false;

  function compareVersions(a, b) {
    const pa = String(a || '').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '').split('.').map((n) => Number(n) || 0);
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i += 1) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  function dismissed(version) {
    try {
      const raw = sessionStorage.getItem('yte-update-dismissed');
      if (!raw) return false;
      const value = JSON.parse(raw);
      return value && value.version === version && Date.now() - Number(value.at || 0) < DISMISS_TTL_MS;
    } catch (_) { return false; }
  }

  function rememberDismiss(version) {
    try {
      sessionStorage.setItem('yte-update-dismissed', JSON.stringify({ version, at: Date.now() }));
    } catch (_) {}
  }

  function ensureBanner() {
    let banner = document.getElementById('appUpdateBanner');
    if (banner) return banner;
    banner = document.createElement('section');
    banner.id = 'appUpdateBanner';
    banner.className = 'app-update-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="app-update-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg></div>
      <div class="app-update-copy">
        <strong id="appUpdateTitle">Có phiên bản mới</strong>
        <span id="appUpdateMessage">Ứng dụng đã có bản cập nhật mới.</span>
      </div>
      <div class="app-update-actions">
        <button id="appUpdateLater" class="btn btn-ghost app-update-later" type="button">Để sau</button>
        <button id="appUpdateNow" class="btn btn-primary app-update-now" type="button">Cập nhật ngay</button>
      </div>`;
    document.body.appendChild(banner);
    banner.querySelector('#appUpdateLater').addEventListener('click', () => {
      const version = banner.dataset.version || latestRelease?.version || '';
      if (version) rememberDismiss(version);
      banner.hidden = true;
    });
    banner.querySelector('#appUpdateNow').addEventListener('click', applyUpdate);
    return banner;
  }

  function showBanner(release, force) {
    const version = String(release?.version || 'mới');
    if (!force && dismissed(version)) return;
    latestRelease = release || { version };
    const banner = ensureBanner();
    banner.dataset.version = version;
    banner.querySelector('#appUpdateTitle').textContent = `Có phiên bản mới v${version}`;
    banner.querySelector('#appUpdateMessage').textContent = String(
      release?.message || 'Bản cập nhật đã sẵn sàng. Nhấn “Cập nhật ngay” để sử dụng phiên bản mới.'
    );
    banner.querySelector('#appUpdateNow').disabled = false;
    banner.querySelector('#appUpdateNow').textContent = 'Cập nhật ngay';
    banner.hidden = false;
  }

  function hideBanner() {
    const banner = document.getElementById('appUpdateBanner');
    if (banner) banner.hidden = true;
  }

  async function fetchReleaseInfo() {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return null;
      const info = await response.json();
      if (!info || !info.version) return null;
      return info;
    } catch (_) { return null; }
  }

  function inspectRegistration(reg) {
    if (!reg) return;
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) {
      showBanner(latestRelease || { version: 'mới' });
    }
    if (reg.installing) watchInstalling(reg.installing);
    reg.addEventListener('updatefound', () => {
      if (reg.installing) watchInstalling(reg.installing);
    });
  }

  function watchInstalling(worker) {
    if (!worker || worker.__yteWatched) return;
    worker.__yteWatched = true;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        const release = latestRelease || { version: 'mới' };
        showBanner(release, true);
      }
    });
  }

  async function checkForUpdate() {
    if (checking) return;
    checking = true;
    try {
      const release = await fetchReleaseInfo();
      if (release) latestRelease = release;
      if (registration) {
        try { await registration.update(); } catch (_) {}
      }
      if (registration?.waiting && navigator.serviceWorker.controller) {
        showBanner(release || latestRelease || { version: 'mới' });
        return;
      }
      if (release && compareVersions(release.version, currentVersion) > 0) {
        showBanner(release);
      } else if (release && compareVersions(release.version, currentVersion) <= 0 && !registration?.waiting) {
        hideBanner();
      }
    } finally {
      checking = false;
    }
  }

  function hasUnsavedChanges() {
    const guards = [
      window.YTE_APP_UI && window.YTE_APP_UI.hasUnsavedChanges,
      window.YTE_REPORTS && window.YTE_REPORTS.hasUnsavedChanges,
      window.YTE_JOURNEYS && window.YTE_JOURNEYS.hasUnsavedChanges
    ];
    return guards.some((guard) => {
      try { return typeof guard === 'function' && guard(); }
      catch (_) { return false; }
    });
  }

  async function applyUpdate() {
    const banner = ensureBanner();
    const button = banner.querySelector('#appUpdateNow');
    if (hasUnsavedChanges()) {
      const proceed = window.confirm('Bạn đang có dữ liệu chưa lưu. Nếu cập nhật ngay, nội dung đang nhập có thể bị mất. Bạn có muốn tiếp tục cập nhật?');
      if (!proceed) return;
    }
    button.disabled = true;
    button.textContent = 'Đang cập nhật...';
    try {
      if (registration) {
        await registration.update().catch(() => {});
      }
      const waiting = registration?.waiting;
      if (waiting) {
        reloadOnControllerChange = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      // Nếu worker đang install, chờ tối đa 8 giây để chuyển sang waiting.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !registration?.waiting) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (registration?.waiting) {
        reloadOnControllerChange = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      // Fallback an toàn: tải lại bằng network. Không xóa dữ liệu/cache thủ công.
      location.reload();
    } catch (_) {
      button.disabled = false;
      button.textContent = 'Cập nhật ngay';
    }
  }

  async function start() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './',
        updateViaCache: 'none'
      });
      inspectRegistration(registration);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadOnControllerChange) return;
        reloadOnControllerChange = false;
        location.reload();
      });
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'YTE_SW_VERSION' && data.version && compareVersions(data.version, currentVersion) > 0) {
          showBanner({ version: data.version, message: data.message || '' });
        }
      });
      await checkForUpdate();
      clearInterval(checkTimer);
      checkTimer = setInterval(() => {
        if (!document.hidden && navigator.onLine !== false) checkForUpdate();
      }, CHECK_INTERVAL_MS);
      window.addEventListener('focus', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForUpdate();
      });
    } catch (error) {
      console.warn('Không khởi tạo được cơ chế cập nhật ứng dụng:', error);
    }
  }

  window.YTE_UPDATE_MANAGER = Object.freeze({
    check: checkForUpdate,
    currentVersion
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}());
