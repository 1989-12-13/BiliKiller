/**
 * BiliKiller 温和提醒（内容脚本端）
 *
 * 规则：
 * - 每 15 秒向后台查询当日累计观看时长；
 * - 时长达到提醒间隔（reminderIntervalMin）的整数倍时，右下角弹出非强制提醒浮层；
 * - 「再看一会」/「休息一下」/ 关闭均只关闭浮层并延迟到下一个阈值，不做任何强制拦截。
 * - UI 使用 Shadow DOM 隔离，避免与 B 站样式互相污染。
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;
  const MSG = shared.MSG;
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;

  const CHECK_INTERVAL_MS = 15000;
  const SNOOZE_KEY = 'bk-snooze-until-sec';

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let hostEl = null;
  let shownMultiple = -1; // 已弹出过的阈值倍数，防止同一阈值重复弹出

  function loadSettings() {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      if (chrome.runtime.lastError) return;
      settings = Object.assign({}, shared.DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
    });
  }

  function snoozeUntil() {
    const v = Number(sessionStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(v) ? v : 0;
  }

  function snoozeTo(seconds) {
    try {
      sessionStorage.setItem(SNOOZE_KEY, String(seconds));
    } catch (e) { /* 隐私模式下可能不可写，忽略 */ }
  }

  function dismiss() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
  }

  function show(seconds, intervalSec) {
    if (hostEl || !document.body) return;

    hostEl = document.createElement('div');
    hostEl.style.cssText = 'all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;';
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host { all: initial; }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.card { width: 320px; background: #fff; border-radius: 18px; overflow: hidden; ' +
      '  box-shadow: 0 16px 48px rgba(31,36,48,.22), 0 0 0 1px rgba(91,108,255,.10); ' +
      '  font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; ' +
      '  animation: bk-r-in .4s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-r-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.bar { height: 5px; background: linear-gradient(90deg,#5B6CFF,#7C8AFF,#FB7299); }' +
      '.body { padding: 18px 20px 20px; position: relative; }' +
      '.title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #1F2430; margin-bottom: 8px; }' +
      '.dot { width: 8px; height: 8px; border-radius: 50%; background: #FB7299; animation: bk-r-pulse 1.6s ease-in-out infinite; }' +
      '@keyframes bk-r-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.8); } }' +
      '.close { position: absolute; top: 14px; right: 14px; width: 26px; height: 26px; border: none; border-radius: 8px; ' +
      '  background: transparent; color: #6B7280; font-size: 16px; line-height: 1; cursor: pointer; transition: background .15s; }' +
      '.close:hover { background: #F6F7FB; color: #1F2430; }' +
      '.text { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-bottom: 16px; }' +
      '.actions { display: flex; gap: 10px; }' +
      '.btn { flex: 1; height: 38px; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; ' +
      '  transition: transform .15s, box-shadow .15s; }' +
      '.btn:hover { transform: translateY(-1px); }' +
      '.btn-later { background: #EEF1FF; color: #5B6CFF; }' +
      '.btn-later:hover { box-shadow: 0 6px 16px rgba(91,108,255,.2); }' +
      '.btn-rest { background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; }' +
      '.btn-rest:hover { box-shadow: 0 6px 16px rgba(91,108,255,.4); }' +
      '</style>' +
      '<div class="card">' +
      '  <div class="bar"></div>' +
      '  <div class="body">' +
      '    <button class="close" type="button" aria-label="关闭">×</button>' +
      '    <div class="title"><span class="dot"></span>已连续观看 ' + shared.formatDuration(seconds) + '</div>' +
      '    <p class="text">内容永远刷不完，但时间和精力是有限的。<br>要不要稍作休息，或把下次提醒推迟一个间隔？</p>' +
      '    <div class="actions">' +
      '      <button class="btn btn-later" type="button">再看一会</button>' +
      '      <button class="btn btn-rest" type="button">休息一下</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    const snoozeAndClose = function () {
      snoozeTo(seconds + intervalSec);
      dismiss();
    };
    root.querySelector('.btn-later').addEventListener('click', snoozeAndClose);
    root.querySelector('.btn-rest').addEventListener('click', snoozeAndClose);
    root.querySelector('.close').addEventListener('click', snoozeAndClose);

    document.body.appendChild(hostEl);
  }

  async function check() {
    if (!settings.enabled || !settings.reminderEnabled) return;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: MSG.GET_TODAY });
    } catch (e) {
      return; // 后台暂不可用
    }
    if (!resp || !resp.ok || !resp.today) return;

    const seconds = resp.today.seconds || 0;
    const intervalSec = Math.max(1, Number(settings.reminderIntervalMin) || 30) * 60;
    if (seconds < intervalSec) return; // 未达首个阈值
    if (seconds < snoozeUntil()) return; // 用户已延迟

    const multiple = Math.floor(seconds / intervalSec);
    if (multiple === shownMultiple) return; // 该阈值已提醒过
    shownMultiple = multiple;
    show(seconds, intervalSec);
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    if (!settings.enabled || !settings.reminderEnabled) dismiss();
  });

  loadSettings();
  window.setInterval(check, CHECK_INTERVAL_MS);
})();
