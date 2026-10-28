/**
 * BiliKiller 专注褪色（灰度模式，默认关闭）
 *
 * 达阈值后，用一个透明覆盖层 + backdrop-filter: grayscale(1) 让整个 B 站页面「褪色」，
 * 作为非打断式的沉浸提醒（类似手机「就寝模式」/ iOS 专注模式的视觉降饱和）。
 * - 覆盖层 pointer-events:none：不拦截任何点击，不改变布局，不影响 fixed 定位；
 * - z-index 低于胶囊 / 门闩，扩展自身 UI 保持彩色；
 * - 「临时恢复色彩」由用量胶囊设置会话级恢复时间戳（bk-gray-restore-until-sec）。
 *
 * 依赖加载顺序：
 * messages.js → player.js → selectors.js → cleaner.js → ... → reminder.js
 *   → focus-mode.js → grayscale.js → usage-pill.js
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;
  const MSG = shared.MSG;
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;

  const OVERLAY_ID = 'bk-grayscale-overlay';
  const CHECK_INTERVAL_MS = 15000;
  const RESTORE_KEY = 'bk-gray-restore-until-sec'; // 与 usage-pill.js 共享的「临时恢复」时间戳

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let overlay = null;

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
    });
  }

  function ensureOverlay() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:9998;pointer-events:none;backdrop-filter:grayscale(1);'
      );
      (document.body || document.documentElement).appendChild(overlay);
    }
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  async function restoreUntil() {
    const v = Number(await shared.sessionGet(RESTORE_KEY));
    return Number.isFinite(v) ? v : 0;
  }

  async function check() {
    if (!settings.enabled || !settings.grayscaleEnabled) {
      removeOverlay();
      return;
    }
    const atMin = Number(settings.grayscaleAtMin) || 0;
    if (atMin <= 0) {
      removeOverlay();
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < (await restoreUntil())) {
      removeOverlay();
      return; // 用户刚「临时恢复色彩」
    }

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: MSG.GET_TODAY });
    } catch (e) {
      return; // 后台暂不可用
    }
    if (!resp || !resp.ok || !resp.today) return;

    const seconds = resp.today.seconds || 0;
    if (seconds >= atMin * 60) {
      ensureOverlay();
    } else {
      removeOverlay();
    }
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    // 「临时恢复色彩」写入 local 后立即重算，无需等下一个轮询周期
    if (changes[RESTORE_KEY]) check();
    if (!changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    if (!settings.enabled || !settings.grayscaleEnabled) removeOverlay();
  });

  loadSettings();
  check();
  window.setInterval(check, CHECK_INTERVAL_MS);
})();
