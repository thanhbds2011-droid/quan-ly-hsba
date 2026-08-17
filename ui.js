'use strict';

/**
 * Shared interaction layer — production 9.2.1.
 * Owns cross-module UX only: search autofill protection, textarea sizing,
 * mobile keyboard safety, dialog focus management and overflow menus.
 * No Firebase or business logic belongs in this file.
 */
(function () {
  const MOBILE_QUERY = '(max-width: 760px)';
  const EDITABLE_SELECTOR = 'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select';
  const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const dialogState = new WeakMap();

  function isEditable(target) {
    return !!(target && target.matches && target.matches(EDITABLE_SELECTOR));
  }

  function resizeTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.style.height = 'auto';
    const maxHeight = 240;
    textarea.style.height = `${Math.min(maxHeight, Math.max(76, textarea.scrollHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function setupTextareaAutoGrow() {
    document.querySelectorAll('textarea').forEach((textarea) => {
      resizeTextarea(textarea);
      textarea.addEventListener('input', () => resizeTextarea(textarea));
    });
    window.YTE_RESIZE_TEXTAREA = resizeTextarea;
  }

  function setupMobileKeyboardSafety() {
    let blurTimer = null;

    document.addEventListener('focusin', (event) => {
      if (!isEditable(event.target) || !window.matchMedia(MOBILE_QUERY).matches) return;
      clearTimeout(blurTimer);
      document.body.classList.add('keyboard-open');
      window.setTimeout(() => {
        try { event.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
      }, 160);
    });

    document.addEventListener('focusout', () => {
      clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!isEditable(document.activeElement)) document.body.classList.remove('keyboard-open');
      }, 140);
    });

    if (window.visualViewport) {
      const update = () => {
        if (!window.matchMedia(MOBILE_QUERY).matches) {
          document.body.classList.remove('keyboard-open');
          return;
        }
        const keyboardLikelyOpen = window.innerHeight - window.visualViewport.height > 140;
        document.body.classList.toggle('keyboard-open', keyboardLikelyOpen || isEditable(document.activeElement));
      };
      window.visualViewport.addEventListener('resize', update);
      window.visualViewport.addEventListener('scroll', update);
    }
  }

  function visibleFocusable(dialog) {
    return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
      if (element.hidden) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function openDialog(dialog) {
    if (dialogState.has(dialog)) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogState.set(dialog, { previous });
    document.body.classList.add('dialog-open');
    const focusables = visibleFocusable(dialog);
    const preferred = dialog.querySelector('[autofocus]') || focusables[0];
    if (preferred) window.setTimeout(() => preferred.focus({ preventScroll: true }), 0);
  }

  function closeDialog(dialog) {
    const stored = dialogState.get(dialog);
    if (!stored) return;
    dialogState.delete(dialog);
    const anyOpen = Array.from(document.querySelectorAll('[role="dialog"]')).some((item) => !item.hidden);
    document.body.classList.toggle('dialog-open', anyOpen);
    if (stored.previous && stored.previous.isConnected) {
      window.setTimeout(() => {
        try { stored.previous.focus({ preventScroll: true }); } catch (_) {}
      }, 0);
    }
  }

  function setupDialogFocus() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    dialogs.forEach((dialog) => {
      if (!dialog.hidden) openDialog(dialog);
      const observer = new MutationObserver(() => {
        if (dialog.hidden) closeDialog(dialog);
        else openDialog(dialog);
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ['hidden'] });

      dialog.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const focusables = visibleFocusable(dialog);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    });
  }

  function closeOtherMenus(except) {
    document.querySelectorAll('details.journey-action-menu[open]').forEach((menu) => {
      if (menu !== except) menu.removeAttribute('open');
    });
  }

  function setupOverflowMenus() {
    document.addEventListener('toggle', (event) => {
      const menu = event.target;
      if (menu && menu.matches && menu.matches('details.journey-action-menu') && menu.open) closeOtherMenus(menu);
    }, true);

    document.addEventListener('pointerdown', (event) => {
      const menu = event.target.closest && event.target.closest('details.journey-action-menu');
      if (!menu) closeOtherMenus(null);
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest && event.target.closest('.journey-action-popover button')) {
        const menu = event.target.closest('details.journey-action-menu');
        if (menu) menu.removeAttribute('open');
      }
    });
  }

  function init() {
    setupTextareaAutoGrow();
    setupMobileKeyboardSafety();
    setupDialogFocus();
    setupOverflowMenus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
