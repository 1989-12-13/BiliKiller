/**
 * BiliKiller 全局用量胶囊：B 站任意页面左下角常驻今日用量仪表。
 *
 * - 收起态：一枚小胶囊，显示「今日 X 分」，随眼可见；
 * - 展开态：今日已看 / 距下次提醒 / 今日访问 / 专注褪色状态与「临时恢复色彩」/ 打开设置；
 * - Shadow DOM 隔离 + :host-context(html.dark) / :host-context(html.bili_dark) 深色适配；
 * - 仅当 settings.enabled && settings.usagePillEnabled 时挂载，30 秒轮询 + visibilitychange 刷新。
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

  const HOST_ID = 'bk-usage-pill';
  const REFRESH_MS = 30000;
  const RESTORE_KEY = 'bk-gray-restore-until-sec'; // 与 grayscale.js 共享
  const RESTORE_SECONDS = 15 * 60;

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let hostEl = null;
  let root = null;
  let expanded = false;

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
      ensure();
    });
  }

  function compactMinutes(seconds) {
    const m = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
    if (m < 60) return m + ' 分';
    const h = Math.floor(m / 60);
    return h + ' 小时 ' + (m % 60) + ' 分';
  }

  function build() {
    if (hostEl || !document.body) return;
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText = 'all: initial; position: fixed; left: 24px; bottom: 24px; z-index: 10000;';
    root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host { all: initial; --bk-pill-card:#FFFFFF; --bk-pill-text:#18191C; --bk-pill-sub:#61666D; --bk-pill-faint:#9499A0; --bk-pill-pink:#FB7299; --bk-pill-pink-hover:#FC8BAB; --bk-pill-pink-soft:#FFF3F6; --bk-pill-line:#E3E5E7; --bk-pill-sub-bg:#F6F7F8; --bk-pill-sans:"PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif; --bk-pill-shadow:0 4px 12px rgba(0,0,0,.1); }' +
      ':host-context(html.dark), :host-context(html.bili_dark) { --bk-pill-card:#202123; --bk-pill-text:#E7E9EB; --bk-pill-sub:#A2A7AE; --bk-pill-faint:#757A81; --bk-pill-pink:#D44E7D; --bk-pill-pink-hover:#DC6D94; --bk-pill-pink-soft:#2F1A22; --bk-pill-line:#2F3134; --bk-pill-sub-bg:#242628; --bk-pill-shadow:0 4px 12px rgba(0,0,0,.5); }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.pill { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; ' +
      '  background: var(--bk-pill-card); border: 1px solid var(--bk-pill-line); box-shadow: var(--bk-pill-shadow); ' +
      '  cursor: pointer; font-family: var(--bk-pill-sans); animation: bk-pill-in .25s ease-out; }' +
      '@keyframes bk-pill-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--bk-pill-pink); flex: none; }' +
      '.label { font-size: 12px; color: var(--bk-pill-sub); }' +
      '.num { font-size: 12.5px; font-weight: 600; color: var(--bk-pill-pink); font-variant-numeric: tabular-nums; }' +
      '.panel { position: absolute; left: 0; bottom: calc(100% + 8px); width: 236px; background: var(--bk-pill-card); ' +
      '  border: 1px solid var(--bk-pill-line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 14px; ' +
      '  font-family: var(--bk-pill-sans); animation: bk-panel-in .2s ease-out; }' +
      '@keyframes bk-panel-in { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.p-head { font-size: 12px; color: var(--bk-pill-faint); margin-bottom: 6px; }' +
      '.p-hero { font-size: 22px; font-weight: 600; line-height: 1.3; color: var(--bk-pill-pink); font-variant-numeric: tabular-nums; margin-bottom: 10px; }' +
      '.p-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 12.5px; color: var(--bk-pill-sub); }' +
      '.p-row + .p-row { border-top: 1px solid var(--bk-pill-line); }' +
      '.p-row b { color: var(--bk-pill-text); font-weight: 600; font-variant-numeric: tabular-nums; }' +
      '.p-gray { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 10px 12px; border-radius: 6px; ' +
      '  background: var(--bk-pill-pink-soft); font-size: 12px; color: var(--bk-pill-text); }' +
      '.btn { border: none; border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; padding: 7px 10px; ' +
      '  transition: background .15s; }' +
      '.btn-restore { background: var(--bk-pill-pink); color: #FFFFFF; }' +
      '.btn-restore:hover { background: var(--bk-pill-pink-hover); }' +
      '.btn-settings { display: block; width: 100%; margin-top: 10px; background: var(--bk-pill-sub-bg); color: var(--bk-pill-text); }' +
      '.btn-settings:hover { background: var(--bk-pill-line); }' +
      '</style>' +
      '<div class="pill">' +
      '  <span class="dot"></span>' +
      '  <span class="label">今日</span>' +
      '  <b class="num" data-bind="num">--</b>' +
      '</div>' +
      '<div class="panel" data-bind="panel" style="display:none">' +
      '  <div class="p-head">今日用量</div>' +
      '  <div class="p-hero" data-bind="hero">--</div>' +
      '  <div class="p-row"><span>距下次提醒</span><b data-bind="reminder">--</b></div>' +
      '  <div class="p-row"><span>今日访问</span><b data-bind="visits">--</b></div>' +
      '  <div class="p-gray" data-bind="gray" style="display:none">' +
      '    <span>专注褪色中 · 整站已转为灰度</span>' +
      '    <button class="btn btn-restore" type="button">临时恢复色彩 15 分钟</button>' +
      '  </div>' +
      '  <button class="btn btn-settings" type="button">打开设置</button>' +
      '</div>';

    root.querySelector('.pill').addEventListener('click', function () {
      expanded = !expanded;
      root.querySelector('[data-bind="panel"]').style.display = expanded ? 'block' : 'none';
    });
    root.querySelector('.btn-restore').addEventListener('click', function () {
      shared.sessionSet(RESTORE_KEY, String(Math.floor(Date.now() / 1000) + RESTORE_SECONDS));
      root.querySelector('[data-bind="gray"]').style.display = 'none';
    });
    root.querySelector('.btn-settings').addEventListener('click', function () {
      // 内容脚本里没有 chrome.runtime.openOptionsPage，交给 service worker 打开
      chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS });
    });

    document.body.appendChild(hostEl);
  }

  function destroy() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      root = null;
      expanded = false;
    }
  }

  function render(resp) {
    if (!hostEl || !root) return;
    if (!resp || !resp.ok) {
      root.querySelector('[data-bind="num"]').textContent = '--';
      root.querySelector('[data-bind="hero"]').textContent = '--';
      return;
    }
    const seconds = Number(resp.today.seconds) || 0;
    const visits = Number(resp.today.visits) || 0;

    root.querySelector('[data-bind="num"]').textContent = compactMinutes(seconds);
    root.querySelector('[data-bind="hero"]').textContent = shared.formatDurationMinutes(seconds);
    root.querySelector('[data-bind="visits"]').textContent = visits + ' 次';
    root.querySelector('[data-bind="reminder"]').textContent =
      (!settings.enabled || !settings.reminderEnabled)
        ? '已关闭'
        : shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';

    // 专注褪色状态：当前已灰度时给出「临时恢复」入口；
    // 用户点过「临时恢复色彩」且尚未到期时，不显示这一块
    const grayEl = root.querySelector('[data-bind="gray"]');
    const grayActive = settings.grayscaleEnabled && Number(settings.grayscaleAtMin) > 0 &&
      seconds >= (Number(settings.grayscaleAtMin) * 60);
    grayEl.style.display = grayActive ? 'flex' : 'none';
    if (grayActive) {
      shared.sessionGet(RESTORE_KEY).then(function (value) {
        if (Number(value) > Math.floor(Date.now() / 1000)) grayEl.style.display = 'none';
      });
    }
  }

  function fetchNow() {
    if (!hostEl) return;
    chrome.runtime.sendMessage({ type: MSG.GET_TODAY }, function (resp) {
      if (chrome.runtime.lastError) { render(null); return; }
      render(resp);
    });
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') fetchNow();
  }

  function ensure() {
    if (!settings.enabled || !settings.usagePillEnabled) {
      destroy();
      return;
    }
    build();
    fetchNow();
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    ensure();
  });

  loadSettings();
  ensure();
  // document_start 时 body 可能尚未就绪，等 DOM 就绪后再尝试挂载一次
  document.addEventListener('DOMContentLoaded', ensure);
  window.addEventListener('load', ensure);
  window.setInterval(function () {
    if (hostEl) fetchNow();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisibility);
})();
