/**
 * BiliKiller 热门/排行榜占位：净化后只留页面中央的一条搜索栏。
 * 零依赖（只用 document / location），由 panels.js 调度器在命中规则时调用。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 */
(function () {
  'use strict';

  const PLACEHOLDER_STYLE_ID = 'bk-placeholder-style';
  const PLACEHOLDER_ID = 'bk-hot-placeholder';

  function injectPlaceholderStyle() {
    if (document.getElementById(PLACEHOLDER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PLACEHOLDER_STYLE_ID;
    style.textContent =
      '#' + PLACEHOLDER_ID + ' { --bk-ph-card: #FFFFFF; --bk-ph-text: #18191C; --bk-ph-faint: #9499A0; --bk-ph-pink: #FB7299; --bk-ph-pink-hover: #FC8BAB; --bk-ph-ring: rgba(251,114,153,.15); --bk-ph-line: #E3E5E7; position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 99999; }' +
      'html.dark #' + PLACEHOLDER_ID + ', html.bili_dark #' + PLACEHOLDER_ID + ' { --bk-ph-card: #202123; --bk-ph-text: #E7E9EB; --bk-ph-faint: #757A81; --bk-ph-pink: #D44E7D; --bk-ph-pink-hover: #DC6D94; --bk-ph-ring: rgba(212,78,125,.3); --bk-ph-line: #2F3134; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-bar { pointer-events: auto; display: flex; gap: 8px; width: min(560px, calc(100vw - 48px)); font-family: "PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif; animation: bk-ph-in .3s ease-out; }' +
      '@keyframes bk-ph-in { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input { flex: 1; min-width: 0; height: 44px; border-radius: 8px; border: 1px solid var(--bk-ph-line); padding: 0 16px; font-family: inherit; font-size: 14px; outline: none; color: var(--bk-ph-text); background: var(--bk-ph-card); transition: border-color .15s, box-shadow .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input::placeholder { color: var(--bk-ph-faint); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input:focus { border-color: var(--bk-ph-pink); box-shadow: 0 0 0 3px var(--bk-ph-ring); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn { height: 44px; padding: 0 24px; border: none; border-radius: 8px; background: var(--bk-ph-pink); color: #FFFFFF; font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: background .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn:hover { background: var(--bk-ph-pink-hover); }';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHotPlaceholder() {
    const existing = document.getElementById(PLACEHOLDER_ID);
    if (!document.body || existing) return;

    injectPlaceholderStyle();
    const el = document.createElement('div');
    el.id = PLACEHOLDER_ID;
    el.innerHTML =
      '<div class="bk-ph-bar">' +
      '  <input class="bk-ph-input" type="search" placeholder="搜索你想看的视频…" />' +
      '  <button class="bk-ph-btn" type="button">搜索</button>' +
      '</div>';

    const goSearch = function () {
      const kw = el.querySelector('.bk-ph-input').value.trim();
      if (kw) {
        location.href = 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(kw);
      } else {
        location.href = 'https://www.bilibili.com/';
      }
    };
    el.querySelector('.bk-ph-btn').addEventListener('click', goSearch);
    el.querySelector('.bk-ph-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') goSearch();
    });
    document.body.appendChild(el);
  }

  /** 幂等卸载：仅移除占位元素，样式标签保留（与历史行为一致） */
  function removeHotPlaceholder() {
    const el = document.getElementById(PLACEHOLDER_ID);
    if (el) el.remove();
  }

  globalThis.BK_HOT_PLACEHOLDER = Object.freeze({
    ensure: ensureHotPlaceholder,
    remove: removeHotPlaceholder,
  });
})();
