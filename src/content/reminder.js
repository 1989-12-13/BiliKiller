/**
 * BiliKiller 温和提醒（内容脚本端）
 *
 * 规则：
 * - 每 15 秒向后台查询当日累计观看时长；
 * - 时长达到提醒间隔（reminderIntervalMin）的整数倍时，右下角弹出非强制提醒浮层；
 * - 「再看一会」/ 关闭：仅延迟到下一个阈值；「休息一下」：暂停视频再延迟；
 * - 「今天不再提醒」：延迟到本地当天结束，其余时刻不再打扰；
 * - 已提醒阈值与延迟时间存入 chrome.storage.local（sessionState），跨标签页共享，避免开新标签页重复打扰；
 * - UI 使用 Shadow DOM 隔离，颜色跟随 B 站深色开关（:host-context(html.dark)）。
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

  /** 提醒文案按提醒次数（阈值倍数）轮换，避免每次弹窗千篇一律 */
  const REMINDER_TEXTS = [
    '内容永远刷不完，但时间和精力是有限的。<br>要不要稍作休息，或把下次提醒推迟一个间隔？',
    '你已经专注看了很久，眼睛和身体都需要透口气。<br>起来活动一下、喝口水吧。',
    '算法总想让你「再看一个」，但今天的目标你心里清楚。<br>要不先停在这里？',
    '连续观看很容易忘记时间，此刻停下也是不错的选择。<br>休息片刻再继续。',
  ];

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let hostEl = null;

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
    });
  }

  /** 读取「已提醒过的阈值倍数」：默认 -1（未提醒过） */
  async function getShownMultiple() {
    const v = Number(await shared.sessionGet(SHOWN_KEY));
    return Number.isFinite(v) ? v : -1;
  }

  function setShownMultiple(m) {
    return shared.sessionSet(SHOWN_KEY, String(m));
  }

  async function snoozeUntil() {
    const v = Number(await shared.sessionGet(SNOOZE_KEY));
    return Number.isFinite(v) ? v : 0;
  }

  function snoozeTo(seconds) {
    return shared.sessionSet(SNOOZE_KEY, String(seconds));
  }

  function dismiss() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
  }

  /** 暂停主播放器视频（「休息一下」：停下播放，缓解「再看一个」的惯性） */
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

    // 提醒文案按第几次提醒（阈值倍数）轮换
    const text = REMINDER_TEXTS[Math.floor(seconds / intervalSec) % REMINDER_TEXTS.length];

    hostEl = document.createElement('div');
    hostEl.style.cssText = 'all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;';
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      // 颜色统一收敛为 CSS 变量：默认亮色，:host-context(html.dark) 跟随 B 站深色开关
      ':host { all: initial; --bk-rem-card:#fff; --bk-rem-text:#1F2430; --bk-rem-sub:#6B7280; --bk-rem-soft:#F6F7FB; --bk-rem-later-bg:#EEF1FF; --bk-rem-later-text:#5B6CFF; --bk-rem-shadow:0 16px 48px rgba(31,36,48,.22), 0 0 0 1px rgba(91,108,255,.10); }' +
      ':host-context(html.dark) { --bk-rem-card:#1E2029; --bk-rem-text:#E8E9ED; --bk-rem-sub:#9AA1B4; --bk-rem-soft:#17181F; --bk-rem-later-bg:#17181F; --bk-rem-later-text:#7C8AFF; --bk-rem-shadow:0 16px 48px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.card { width: 320px; background: var(--bk-rem-card); border-radius: 18px; overflow: hidden; ' +
      '  box-shadow: var(--bk-rem-shadow); ' +
      '  font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; ' +
      '  animation: bk-r-in .4s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-r-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.bar { height: 5px; background: linear-gradient(90deg,#5B6CFF,#7C8AFF,#FB7299); }' +
      '.body { padding: 18px 20px 20px; position: relative; }' +
      '.title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--bk-rem-text); margin-bottom: 8px; }' +
      '.dot { width: 8px; height: 8px; border-radius: 50%; background: #FB7299; animation: bk-r-pulse 1.6s ease-in-out infinite; }' +
      '@keyframes bk-r-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.8); } }' +
      '.close { position: absolute; top: 14px; right: 14px; width: 26px; height: 26px; border: none; border-radius: 8px; ' +
      '  background: transparent; color: var(--bk-rem-sub); font-size: 16px; line-height: 1; cursor: pointer; transition: background .15s; }' +
      '.close:hover { background: var(--bk-rem-soft); color: var(--bk-rem-text); }' +
      '.text { font-size: 12.5px; color: var(--bk-rem-sub); line-height: 1.7; margin-bottom: 16px; }' +
      '.actions { display: flex; gap: 10px; }' +
      '.btn { flex: 1; height: 38px; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; ' +
      '  transition: transform .15s, box-shadow .15s; }' +
      '.btn:hover { transform: translateY(-1px); }' +
      '.btn-later { background: var(--bk-rem-later-bg); color: var(--bk-rem-later-text); }' +
      '.btn-later:hover { box-shadow: 0 6px 16px rgba(91,108,255,.2); }' +
      '.btn-rest { background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; }' +
      '.btn-rest:hover { box-shadow: 0 6px 16px rgba(91,108,255,.4); }' +
      '.mute-today { display: block; margin: 14px auto 0; padding: 0; border: none; background: none; ' +
      '  color: var(--bk-rem-sub); font-size: 11.5px; cursor: pointer; opacity: .75; transition: opacity .15s; }' +
      '.mute-today:hover { opacity: 1; text-decoration: underline; }' +
      '</style>' +
      '<div class="card">' +
      '  <div class="bar"></div>' +
      '  <div class="body">' +
      '    <button class="close" type="button" aria-label="关闭">×</button>' +
      '    <div class="title"><span class="dot"></span>今日已观看 ' + shared.formatDuration(seconds) + '</div>' +
      '    <p class="text">' + text + '</p>' +
      '    <div class="actions">' +
      '      <button class="btn btn-later" type="button">再看一会</button>' +
      '      <button class="btn btn-rest" type="button">休息一下</button>' +
      '    </div>' +
      '    <button class="mute-today" type="button">今天不再提醒</button>' +
      '  </div>' +
      '</div>';

    // 「再看一会」：仅推迟到下一个阈值，不打断播放
    root.querySelector('.btn-later').addEventListener('click', function () {
      snoozeAndClose(seconds, intervalSec);
    });
    // 「休息一下」：先暂停视频，再推迟提醒——用动作打破连续观看的惯性
    root.querySelector('.btn-rest').addEventListener('click', function () {
      pauseVideoIfAny();
      snoozeAndClose(seconds, intervalSec);
    });
    // 关闭按钮：等同于「再看一会」，推迟到下一个阈值
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
