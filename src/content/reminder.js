/**
 * BiliKiller 温和提醒（内容脚本端）
 *
 * 规则：
 * - 每 15 秒向后台查询当日累计观看时长；
 * - 时长达到提醒间隔（reminderIntervalMin）的整数倍时，右下角弹出非强制提醒浮层；
 * - 「继续观看」/ 关闭：仅延迟到下一个阈值；「暂停播放」：暂停视频再延迟；
 * - 「今天不再提醒」：延迟到本地当天结束，其余时刻不再打扰；
 * - 已提醒阈值与延迟时间存入 chrome.storage.local（sessionState），按天记录、跨天失效，
 *   跨标签页共享，避免开新标签页重复打扰；
 * - UI 使用 Shadow DOM 隔离，颜色跟随 B 站深色开关（html.dark / html.bili_dark）。
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
  const SHOWN_KEY = 'bk-shown-multiple'; // 已提醒阈值（跨标签页共享，刷新后仍记住）

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let hostEl = null;

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
    });
  }

  /** 提醒状态都按天存：跨天后自动失效，昨天的延迟不会压住今天的提醒 */
  function readDayState(raw) {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && v.day === shared.todayKey()) return v;
    } catch (e) {
      /* 旧版本存的是纯数字，视为过期 */
    }
    return null;
  }

  /** 读取「已提醒过的阈值倍数」：默认 -1（今天还没提醒过） */
  async function getShownMultiple() {
    const state = readDayState(await shared.sessionGet(SHOWN_KEY));
    return state && Number.isFinite(Number(state.multiple)) ? Number(state.multiple) : -1;
  }

  function setShownMultiple(m) {
    return shared.sessionSet(SHOWN_KEY, JSON.stringify({ day: shared.todayKey(), multiple: m }));
  }

  async function snoozeUntil() {
    const state = readDayState(await shared.sessionGet(SNOOZE_KEY));
    return state && Number.isFinite(Number(state.until)) ? Number(state.until) : 0;
  }

  function snoozeTo(seconds) {
    return shared.sessionSet(SNOOZE_KEY, JSON.stringify({ day: shared.todayKey(), until: seconds }));
  }

  function dismiss() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
  }

  /** 暂停主播放器视频 */
  function pauseVideoIfAny() {
    const p = globalThis.BK_PLAYER;
    if (p && typeof p.pause === 'function') p.pause();
  }

  /** 推迟提醒到下一个阈值，并关闭浮层 */
  function snoozeAndClose(seconds, intervalSec) {
    snoozeTo(seconds + intervalSec);
    dismiss();
  }

  function show(seconds, intervalSec) {
    if (hostEl || !document.body) return;

    hostEl = document.createElement('div');
    hostEl.style.cssText = 'all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;';
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      // 颜色统一收敛为 CSS 变量：默认亮色，跟随 B 站深色开关（html.dark / html.bili_dark）
      ':host { all: initial; --bk-rem-card:#FFFFFF; --bk-rem-text:#18191C; --bk-rem-faint:#9499A0; --bk-rem-pink:#FB7299; --bk-rem-pink-hover:#FC8BAB; --bk-rem-line:#E3E5E7; --bk-rem-sub-bg:#F6F7F8; --bk-rem-sans:"PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif; --bk-rem-shadow:0 8px 24px rgba(0,0,0,.12); }' +
      ':host-context(html.dark), :host-context(html.bili_dark) { --bk-rem-card:#202123; --bk-rem-text:#E7E9EB; --bk-rem-faint:#757A81; --bk-rem-pink:#D44E7D; --bk-rem-pink-hover:#DC6D94; --bk-rem-line:#2F3134; --bk-rem-sub-bg:#242628; --bk-rem-shadow:0 8px 24px rgba(0,0,0,.5); }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.card { width: 320px; background: var(--bk-rem-card); border: 1px solid var(--bk-rem-line); border-radius: 8px; ' +
      '  overflow: hidden; box-shadow: var(--bk-rem-shadow); font-family: var(--bk-rem-sans); ' +
      '  animation: bk-r-in .25s ease-out; }' +
      '@keyframes bk-r-in { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.body { position: relative; padding: 16px; }' +
      '.title { display: flex; align-items: center; gap: 8px; padding-right: 28px; font-size: 14px; font-weight: 600; color: var(--bk-rem-text); margin-bottom: 8px; }' +
      '.mark { width: 20px; height: 20px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: 6px; ' +
      '  background: var(--bk-rem-pink); color: #FFFFFF; font-size: 11px; font-weight: 600; }' +
      '.close { position: absolute; top: 10px; right: 10px; width: 24px; height: 24px; border: none; border-radius: 6px; ' +
      '  background: transparent; color: var(--bk-rem-faint); font-family: inherit; font-size: 16px; line-height: 1; cursor: pointer; ' +
      '  transition: background .15s, color .15s; }' +
      '.close:hover { background: var(--bk-rem-sub-bg); color: var(--bk-rem-text); }' +
      '.actions { display: flex; gap: 8px; }' +
      '.btn { flex: 1; height: 32px; border-radius: 6px; border: none; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; ' +
      '  transition: background .15s, color .15s; }' +
      '.btn-later { background: var(--bk-rem-sub-bg); color: var(--bk-rem-text); }' +
      '.btn-later:hover { background: var(--bk-rem-line); }' +
      '.btn-rest { background: var(--bk-rem-pink); color: #FFFFFF; }' +
      '.btn-rest:hover { background: var(--bk-rem-pink-hover); }' +
      '.mute-today { display: block; margin: 12px auto 0; padding: 0; border: none; background: none; ' +
      '  color: var(--bk-rem-faint); font-family: inherit; font-size: 11.5px; cursor: pointer; transition: color .15s; }' +
      '.mute-today:hover { color: var(--bk-rem-text); text-decoration: underline; }' +
      '</style>' +
      '<div class="card">' +
      '  <div class="body">' +
      '    <button class="close" type="button" aria-label="关闭">×</button>' +
      '    <div class="title"><span class="mark">B</span>今日已观看 ' + shared.formatDuration(seconds) + '</div>' +
      '    <div class="actions">' +
      '      <button class="btn btn-later" type="button">继续观看</button>' +
      '      <button class="btn btn-rest" type="button">暂停播放</button>' +
      '    </div>' +
      '    <button class="mute-today" type="button">今天不再提醒</button>' +
      '  </div>' +
      '</div>';

    // 「继续观看」：仅推迟到下一个阈值，不打断播放
    root.querySelector('.btn-later').addEventListener('click', function () {
      snoozeAndClose(seconds, intervalSec);
    });
    // 「暂停播放」：先暂停视频，再推迟提醒
    root.querySelector('.btn-rest').addEventListener('click', function () {
      pauseVideoIfAny();
      snoozeAndClose(seconds, intervalSec);
    });
    // 关闭按钮：等同于「继续观看」，推迟到下一个阈值
    root.querySelector('.close').addEventListener('click', function () {
      snoozeAndClose(seconds, intervalSec);
    });
    // 「今天不再提醒」：推迟到本地当天结束
    root.querySelector('.mute-today').addEventListener('click', function () {
      const restOfDaySec = Math.max(0, Math.ceil((shared.startOfDay(-1) - Date.now()) / 1000));
      snoozeTo(seconds + restOfDaySec);
      dismiss();
    });

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
    const intervalSec = shared.reminderIntervalSec(settings.reminderIntervalMin);
    if (seconds < intervalSec) return; // 未达首个阈值
    if (seconds < (await snoozeUntil())) return; // 用户已延迟

    const multiple = Math.floor(seconds / intervalSec);
    if (multiple === (await getShownMultiple())) return; // 该阈值已提醒过
    await setShownMultiple(multiple);
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
