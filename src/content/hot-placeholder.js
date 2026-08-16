/**
 * BiliKiller 热门/排行榜占位卡：净化后注入「请使用搜索」居中卡片。
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
      '#' + PLACEHOLDER_ID + ' { --bk-ph-card: rgba(255,255,255,.94); --bk-ph-text: #1F2430; --bk-ph-sub: #6B7280; --bk-ph-input-bg: #fff; --bk-ph-input-border: #E5E7F0; --bk-ph-border: rgba(91,108,255,.12); --bk-ph-shadow: 0 16px 56px rgba(91,108,255,.18); position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 99999; }' +
      'html.dark #' + PLACEHOLDER_ID + ' { --bk-ph-card: rgba(30,32,41,.94); --bk-ph-text: #E8E9ED; --bk-ph-sub: #9AA1B4; --bk-ph-input-bg: #17181F; --bk-ph-input-border: rgba(255,255,255,.14); --bk-ph-border: rgba(255,255,255,.08); --bk-ph-shadow: 0 16px 56px rgba(0,0,0,.5); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-card { pointer-events: auto; width: min(480px, calc(100vw - 48px)); background: var(--bk-ph-card); backdrop-filter: blur(14px); border: 1px solid var(--bk-ph-border); border-radius: 20px; padding: 44px 40px; box-shadow: var(--bk-ph-shadow); text-align: center; font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; animation: bk-ph-in .4s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-ph-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-icon { width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px; background: linear-gradient(135deg,#5B6CFF,#7C8AFF); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(91,108,255,.35); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-title { font-size: 20px; font-weight: 700; color: var(--bk-ph-text); margin: 0 0 8px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-desc { font-size: 13px; color: var(--bk-ph-sub); line-height: 1.8; margin: 0 0 22px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-search { display: flex; gap: 10px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input { flex: 1; height: 42px; border-radius: 12px; border: 1.5px solid var(--bk-ph-input-border); padding: 0 14px; font-size: 14px; outline: none; color: var(--bk-ph-text); background: var(--bk-ph-input-bg); transition: border-color .15s, box-shadow .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input:focus { border-color: #5B6CFF; box-shadow: 0 0 0 3px rgba(91,108,255,.15); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn { height: 42px; padding: 0 22px; border: none; border-radius: 12px; background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform .15s, box-shadow .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(91,108,255,.35); }';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHotPlaceholder() {
    const existing = document.getElementById(PLACEHOLDER_ID);
    if (!document.body || existing) return;

    injectPlaceholderStyle();
    const el = document.createElement('div');
    el.id = PLACEHOLDER_ID;
    el.innerHTML =
      '<div class="bk-ph-card">' +
      '  <div class="bk-ph-icon">' +
      '    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '      <circle cx="11" cy="11" r="7" stroke="#fff" stroke-width="2.2"/>' +
      '      <path d="M16.5 16.5L21 21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
      '    </svg>' +
      '  </div>' +
      '  <p class="bk-ph-title">这里已被 BiliKiller 净化</p>' +
      '  <p class="bk-ph-desc">热门与排行榜会不断放大「再看一个」的冲动。<br>有明确想看的内容时，直接用搜索抵达。</p>' +
      '  <div class="bk-ph-search">' +
      '    <input class="bk-ph-input" type="search" placeholder="搜索你真正想看的视频…" />' +
      '    <button class="bk-ph-btn" type="button">搜索</button>' +
      '  </div>' +
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
