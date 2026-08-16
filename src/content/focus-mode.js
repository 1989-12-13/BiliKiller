/**
 * BiliKiller 专注模式（可选硬上限，默认关闭）
 *
 * 与「温和提醒」互补的可选强化层：开启后，当日累计观看达到 hardLimitMin 分钟时，
 * 在视频页暂停播放并弹出全屏休息门闩，给出「去首页」与「再坚持 5 分钟」两个选择。
 * - 默认关闭（settings.hardLimitEnabled=false），保留「去诱导 + 温和提醒」的既有理念；
 * - 「再坚持 5 分钟」用 chrome.storage.local 记录绝对时间戳（跨标签页共享），
 *   5 分钟后若仍在观看会再次触发门闩；
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
  const GRACE_SECONDS = 5 * 60; // 「再坚持 5 分钟」
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
      ':host { all: initial; --bk-fg-card:#fff; --bk-fg-text:#1F2430; --bk-fg-sub:#6B7280; --bk-fg-soft:#F6F7FB; --bk-fg-border:rgba(91,108,255,.12); }' +
      ':host-context(html.dark) { --bk-fg-card:#1E2029; --bk-fg-text:#E8E9ED; --bk-fg-sub:#9AA1B4; --bk-fg-soft:#17181F; --bk-fg-border:rgba(255,255,255,.08); }' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.mask { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; ' +
      '  padding: 24px; background: rgba(15,17,24,.72); backdrop-filter: blur(6px); }' +
      '.card { position: relative; width: min(440px, 100%); background: var(--bk-fg-card); border-radius: 22px; ' +
      '  padding: 42px 36px 36px; text-align: center; border: 1px solid var(--bk-fg-border); ' +
      '  box-shadow: 0 24px 80px rgba(0,0,0,.4); font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; ' +
      '  animation: bk-fg-in .35s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-fg-in { from { transform: translateY(20px) scale(.97); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }' +
      '.icon { width: 60px; height: 60px; margin: 0 auto 18px; border-radius: 18px; display: flex; align-items: center; justify-content: center; ' +
      '  background: linear-gradient(135deg,#5B6CFF,#FB7299); box-shadow: 0 10px 28px rgba(91,108,255,.35); }' +
      '.title { font-size: 20px; font-weight: 700; color: var(--bk-fg-text); margin-bottom: 10px; }' +
      '.text { font-size: 13px; color: var(--bk-fg-sub); line-height: 1.8; margin-bottom: 26px; }' +
      '.actions { display: flex; gap: 10px; }' +
      '.btn { flex: 1; height: 44px; border-radius: 12px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; ' +
      '  transition: transform .15s, box-shadow .15s; }' +
      '.btn:hover { transform: translateY(-1px); }' +
      '.btn-home { background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; box-shadow: 0 8px 22px rgba(91,108,255,.32); }' +
      '.btn-5min { background: var(--bk-fg-soft); color: var(--bk-fg-text); }' +
      '.close { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border: none; border-radius: 8px; ' +
      '  background: transparent; color: var(--bk-fg-sub); font-size: 18px; line-height: 1; cursor: pointer; }' +
      '.close:hover { background: var(--bk-fg-soft); }' +
      '</style>' +
      '<div class="mask">' +
      '  <div class="card">' +
      '    <button class="close" type="button" aria-label="关闭">×</button>' +
      '    <div class="icon">' +
      '      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" stroke="#fff" stroke-width="2"/>' +
      '        <path d="M12 8v4M12 15h.01" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
      '      </svg>' +
      '    </div>' +
      '    <p class="title">今日观看已达上限</p>' +
      '    <p class="text">你已经看了 ' + minutes + ' 分钟，超过了设定的 ' + limitMin + ' 分钟目标。<br>眼睛和身体都需要休息，视频已为你暂停。</p>' +
      '    <div class="actions">' +
      '      <button class="btn btn-home" type="button">去首页休息</button>' +
      '      <button class="btn btn-5min" type="button">再坚持 5 分钟</button>' +
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
    if (now < (await snoozeUntil())) return; // 用户刚「再坚持 5 分钟」
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
