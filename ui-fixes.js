'use strict';

// UI production 8.0.3 — compact Google-only login

(function () {
  function prepareDashboardSearch() {
    const input = document.getElementById('dashboardSearch');
    if (!input) return;

    // Xóa dữ liệu do trình duyệt/password manager tự điền khi vừa mở trang.
    input.value = '';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-1p-ignore', 'true');

    // readonly ngăn Chrome/password manager nhầm ô tìm kiếm là ô tài khoản.
    // Chỉ mở khóa khi người dùng thật sự tương tác với ô tìm kiếm.
    const unlock = () => {
      input.readOnly = false;
      input.removeAttribute('readonly');
    };
    input.addEventListener('pointerdown', unlock, { once: true });
    input.addEventListener('keydown', unlock, { once: true });
    input.addEventListener('touchstart', unlock, { once: true, passive: true });
  }

  function clearSearchOnReturn() {
    const input = document.getElementById('dashboardSearch');
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.readOnly = true;
    input.setAttribute('readonly', '');
  }

  function init() {
    prepareDashboardSearch();
    // Một lần sau khi password manager hoàn tất phục hồi form.
    window.setTimeout(clearSearchOnReturn, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  window.addEventListener('pageshow', clearSearchOnReturn);
})();
