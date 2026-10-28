/**
 * BiliKiller 专注模式（可选硬上限，默认关闭）
 *
 * 开启后，当日累计观看达到 hardLimitMin 分钟时，在视频页暂停播放并弹出全屏提示，
 * 给出「回首页」与「再看 5 分钟」两个选择。
 * - 默认关闭（settings.hardLimitEnabled=false）；
 * - 「再看 5 分钟」用 chrome.storage.local 记录绝对时间戳（跨标签页共享），
 *   5 分钟后若仍在观看会再次触发；
 * - 仅拦截视频页，首页 / 搜索 / 热门等页面不受影响。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  const shared = globalThis.BiliKillerShared;
  const PAGES = globalThis.BK_PAGES;
  if (!shared || !PAGES) return;

  const MSG = shared.MSG;
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;

  const CHECK_INTERVAL_MS = 10000; // 比温和提醒更勤，尽早拦截
  const GRACE_SECONDS = 5 * 60; // 「再看 5 分钟」
  const SNOOZE_KEY = 'bk-hard-snooze-until-sec';

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let hostEl = null;

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
    });
  }

  function isVideoPage() {
    return PAGES.video(location);
  }

  function dismiss() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
  }

  async function snoozeUntil() {
    const v = Number(await shared.sessionGet(SNOOZE_KEY));
    return Number.isFinite(v) ? v : 0;
  }

  function snoozeTo(sec) {
    return shared.sessionSet(SNOOZE_KEY, String(sec));
  }

  /** 暂停主播放器视频 */
  function pauseVideoIfAny() {
    const p = globalThis.BK_PLAYER;
    if (p && typeof p.pause === 'function') p.pause();
  }

  function show(seconds, limitMin) {
    if (hostEl || !document.body) return;

    const minutes = Math.floor(seconds / 60);

    hostEl = document.createElement('div');
    hostEl.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host { all: initial; --bk-fg-card:#FFFFFF; --bk-fg-text:#18191C; --bk-fg-sub:#61666D; --bk-fg-faint:#9499A0; --bk-fg-pink:#FB7299; --bk-fg-pink-hover:#FC8BAB; --bk-fg-pink-soft:#FFF3F6; --bk-fg-line:#E3E5E7; --bk-fg-sub-bg:#F6F7F8; --bk-fg-mask:rgba(0,0,0,.5); --bk-fg-sans:"PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif; }' +
      ':host-context(html.dark), :host-context(html.bili_dark) { --bk-fg-card:#202123; --bk-fg-text:#E7E9EB; --bk-fg-sub:#A2A7AE; --bk-fg-faint:#757A81; --bk-fg-pink:#D44E7D; --bk-fg-pink-hover:#DC6D94; --bk-fg-pink-soft:#2F1A22; --bk-fg-line:#2F3134; --bk-fg-sub-bg:#242628; --bk-fg-mask:rgba(0,0,0,.65); }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.mask { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; ' +
      '  padding: 24px; background: var(--bk-fg-mask); backdrop-filter: blur(2px); }' +
      '.card { position: relative; width: min(400px, 100%); background: var(--bk-fg-card); border: 1px solid var(--bk-fg-line); ' +
      '  border-radius: 8px; padding: 32px 28px 28px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,.25); ' +
      '  font-family: var(--bk-fg-sans); animation: bk-fg-in .25s ease-out; }' +
      '@keyframes bk-fg-in { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '.icon { width: 48px; height: 48px; margin: 0 auto 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; ' +
      '  background: var(--bk-fg-pink-soft); color: var(--bk-fg-pink); }' +
      '.title { font-size: 17px; font-weight: 600; color: var(--bk-fg-text); margin-bottom: 8px; }' +
      '.text { font-size: 13px; color: var(--bk-fg-sub); line-height: 1.8; margin-bottom: 22px; }' +
      '.actions { display: flex; gap: 8px; }' +
      '.btn { flex: 1; height: 36px; border-radius: 6px; border: none; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; ' +
      '  transition: background .15s; }' +
      '.btn-home { background: var(--bk-fg-pink); color: #FFFFFF; }' +
      '.btn-home:hover { background: var(--bk-fg-pink-hover); }' +
      '.btn-5min { background: var(--bk-fg-sub-bg); color: var(--bk-fg-text); }' +
      '.btn-5min:hover { background: var(--bk-fg-line); }' +
      '.close { position: absolute; top: 10px; right: 10px; width: 24px; height: 24px; border: none; border-radius: 6px; ' +
      '  background: transparent; color: var(--bk-fg-faint); font-family: inherit; font-size: 16px; line-height: 1; cursor: pointer; ' +
      '  transition: background .15s, color .15s; }' +
      '.close:hover { background: var(--bk-fg-sub-bg); color: var(--bk-fg-text); }' +
      '</style>' +
      '<div class="mask">' +
      '  <div class="card">' +
      '    <button class="close" type="button" aria-label="关闭">×</button>' +
      '    <div class="icon">' +
      '      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" stroke="currentColor" stroke-width="2"/>' +
      '        <path d="M12 8v4M12 15h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '      </svg>' +
      '    </div>' +
      '    <p class="title">今日观看已达上限</p>' +
      '    <p class="text">今日已看 ' + minutes + ' 分钟，超过设定的 ' + limitMin + ' 分钟。视频已暂停。</p>' +
      '    <div class="actions">' +
      '      <button class="btn btn-home" type="button">回首页</button>' +
      '      <button class="btn btn-5min" type="button">再看 5 分钟</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    root.querySelector('.btn-home').addEventListener('click', function () {
      dismiss();
      location.href = 'https://www.bilibili.com/';
    });
    root.querySelector('.btn-5min').addEventListener('click', function () {
      snoozeTo(Math.floor(Date.now() / 1000) + GRACE_SECONDS);
      dismiss();
    });
    root.querySelector('.close').addEventListener('click', function () {
      snoozeTo(Math.floor(Date.now() / 1000) + GRACE_SECONDS);
      dismiss();
    });

    document.body.appendChild(hostEl);
  }

  async function check() {
    if (!settings.enabled || !settings.hardLimitEnabled) {
      dismiss();
      return;
    }
    const limitMin = Number(settings.hardLimitMin) || 0;
    if (limitMin <= 0) return;

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: MSG.GET_TODAY });
    } catch (e) {
      return; // 后台暂不可用
    }
    if (!resp || !resp.ok || !resp.today) return;

    const seconds = resp.today.seconds || 0;
    if (seconds < limitMin * 60) return; // 未达上限
    const now = Math.floor(Date.now() / 1000);
    if (now < (await snoozeUntil())) return; // 用户刚选过「再看 5 分钟」
    if (!isVideoPage()) {
      dismiss(); // 离开视频页立即撤下门闩，避免遮挡首页/搜索等其他页面
      return;
    }

    pauseVideoIfAny();
    show(seconds, limitMin);
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    if (!settings.enabled || !settings.hardLimitEnabled) dismiss();
  });

  loadSettings();
  window.setInterval(check, CHECK_INTERVAL_MS);
})();
