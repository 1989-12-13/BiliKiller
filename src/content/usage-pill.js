/**
 * BiliKiller 全局用量胶囊：B 站任意页面左下角常驻今日用量仪表。
 *
 * - 收起态：一枚小胶囊，显示「今日 X 分」，随眼可见；
 * - 展开态：今日已看 / 距下次提醒 / 今日访问 / 专注褪色状态与「临时恢复色彩」/ 打开设置；
 * - Shadow DOM 隔离 + :host-context(html.dark) 深色适配；
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
      ':host { all: initial; --bk-pill-bg:#FFFFFF; --bk-pill-text:#1F2430; --bk-pill-sub:#6B7280; --bk-pill-primary:#5B6CFF; --bk-pill-border:rgba(91,108,255,.14); --bk-pill-shadow:0 12px 32px rgba(31,36,48,.16); --bk-pill-soft:#F6F7FB; }' +
      ':host-context(html.dark) { --bk-pill-bg:#1E2029; --bk-pill-text:#E8E9ED; --bk-pill-sub:#9AA1B4; --bk-pill-primary:#7C8AFF; --bk-pill-border:rgba(255,255,255,.12); --bk-pill-shadow:0 12px 32px rgba(0,0,0,.5); --bk-pill-soft:#17181F; }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.pill { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; ' +
      '  background: var(--bk-pill-bg); border: 1px solid var(--bk-pill-border); box-shadow: var(--bk-pill-shadow); ' +
      '  cursor: pointer; font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; ' +
      '  animation: bk-pill-in .4s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-pill-in { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--bk-pill-primary); flex: none; }' +
      '.num { font-size: 13px; font-weight: 700; color: var(--bk-pill-text); font-variant-numeric: tabular-nums; }' +
      '.panel { position: absolute; left: 0; bottom: calc(100% + 12px); width: 252px; background: var(--bk-pill-bg); ' +
      '  border: 1px solid var(--bk-pill-border); border-radius: 18px; box-shadow: var(--bk-pill-shadow); padding: 16px; ' +
      '  font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; ' +
      '  animation: bk-panel-in .3s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-panel-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.p-head { font-size: 12px; font-weight: 700; letter-spacing: .08em; color: var(--bk-pill-sub); margin-bottom: 8px; }' +
      '.p-hero { font-size: 26px; font-weight: 800; color: var(--bk-pill-primary); font-variant-numeric: tabular-nums; margin-bottom: 12px; }' +
      '.p-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 12.5px; color: var(--bk-pill-sub); }' +
      '.p-row b { color: var(--bk-pill-text); font-weight: 600; font-variant-numeric: tabular-nums; }' +
      '.p-gray { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 10px 12px; border-radius: 12px; ' +
      '  background: rgba(154,161,180,.12); font-size: 12px; color: var(--bk-pill-text); }' +
      '.btn { border: none; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; padding: 8px 12px; ' +
      '  transition: transform .15s, box-shadow .15s; }' +
      '.btn:hover { transform: translateY(-1px); }' +
      '.btn-restore { background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; box-shadow: 0 6px 16px rgba(91,108,255,.3); }' +
      '.btn-settings { display: block; width: 100%; margin-top: 12px; background: var(--bk-pill-soft); color: var(--bk-pill-text); }' +
      '</style>' +
      '<div class="pill">' +
      '  <span class="dot"></span>' +
      '  <span class="num" data-bind="num">--</span>' +
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
    });
    root.querySelector('.btn-settings').addEventListener('click', function () {
      try { chrome.runtime.openOptionsPage(); } catch (e) { /* 忽略 */ }
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

    root.querySelector('[data-bind="num"]').textContent = '今日 ' + compactMinutes(seconds);
    root.querySelector('[data-bind="hero"]').textContent = shared.formatDurationMinutes(seconds);
    root.querySelector('[data-bind="visits"]').textContent = visits + ' 次';
    root.querySelector('[data-bind="reminder"]').textContent =
      (!settings.enabled || !settings.reminderEnabled)
        ? '已关闭'
        : shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';

    // 专注褪色状态：当前已灰度时给出「临时恢复」入口
    const grayEl = root.querySelector('[data-bind="gray"]');
    const grayActive = settings.grayscaleEnabled && Number(settings.grayscaleAtMin) > 0 &&
      seconds >= (Number(settings.grayscaleAtMin) * 60);
    grayEl.style.display = grayActive ? 'flex' : 'none';
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
