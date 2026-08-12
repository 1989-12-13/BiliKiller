/**
 * BiliKiller 净化核心
 *
 * 策略（性能优先，CSS-first）：
 * 1. document_start 即注入 display:none 规则，CSS 对后续动态渲染的节点天然生效，零重排开销；
 * 2. 钩住 history.pushState / replaceState / popstate，B 站 SPA 路由切换后按新页面重建规则；
 * 3. 节流 MutationObserver 仅作兜底（占位卡片被 SPA 重渲染移除时补回）；
 * 4. 监听 chrome.storage 变更，设置页改动即时生效，无需刷新。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const GROUPS = globalThis.BK_SELECTOR_GROUPS;
  const PAGES = globalThis.BK_PAGES;
  if (!shared || !GROUPS || !PAGES) return;

  const STYLE_ID = 'bk-cleaner-style';
  const PLACEHOLDER_STYLE_ID = 'bk-placeholder-style';
  const PLACEHOLDER_ID = 'bk-hot-placeholder';
  const HOME_STYLE_ID = 'bk-home-style';
  const HOME_PANEL_ID = 'bk-home-panel';
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let currentPage = detectPage();

  /** 依据当前 URL 判定页面类型：home / video / hot / search / null */
  function detectPage() {
    for (const name in PAGES) {
      if (Object.prototype.hasOwnProperty.call(PAGES, name) && PAGES[name](location)) {
        return name;
      }
    }
    return null;
  }

  /** 按当前页面与设置生成隐藏规则文本 */
  function buildCss() {
    if (!settings.enabled) return '';
    const rules = [];
    for (const group of GROUPS) {
      if (!settings[group.key]) continue;
      const applies = group.pages === 'all' ||
        (currentPage !== null && group.pages.indexOf(currentPage) !== -1);
      if (!applies) continue;
      for (const sel of group.selectors) {
        rules.push(sel + ' { display: none !important; }');
      }
    }
    return rules.join('\n');
  }

  function injectCss() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildCss();
  }

  /* ---------------- 热门 / 排行榜占位卡片 ---------------- */

  function placeholderNeeded(page) {
    if (!settings.enabled || currentPage !== page) return false;
    for (const group of GROUPS) {
      if (!group.placeholder || !settings[group.key]) continue;
      if (group.pages === 'all' || (Array.isArray(group.pages) && group.pages.indexOf(page) !== -1)) {
        return true;
      }
    }
    return false;
  }

  function injectPlaceholderStyle() {
    if (document.getElementById(PLACEHOLDER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PLACEHOLDER_STYLE_ID;
    style.textContent =
      '#' + PLACEHOLDER_ID + ' { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 99999; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-card { pointer-events: auto; width: min(480px, calc(100vw - 48px)); background: rgba(255,255,255,.94); backdrop-filter: blur(14px); border: 1px solid rgba(91,108,255,.12); border-radius: 20px; padding: 44px 40px; box-shadow: 0 16px 56px rgba(91,108,255,.18); text-align: center; font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif; animation: bk-ph-in .4s cubic-bezier(.21,1.02,.73,1); }' +
      '@keyframes bk-ph-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-icon { width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px; background: linear-gradient(135deg,#5B6CFF,#7C8AFF); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(91,108,255,.35); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-title { font-size: 20px; font-weight: 700; color: #1F2430; margin: 0 0 8px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-desc { font-size: 13px; color: #6B7280; line-height: 1.8; margin: 0 0 22px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-search { display: flex; gap: 10px; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input { flex: 1; height: 42px; border-radius: 12px; border: 1.5px solid #E5E7F0; padding: 0 14px; font-size: 14px; outline: none; color: #1F2430; background: #fff; transition: border-color .15s, box-shadow .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-input:focus { border-color: #5B6CFF; box-shadow: 0 0 0 3px rgba(91,108,255,.15); }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn { height: 42px; padding: 0 22px; border: none; border-radius: 12px; background: linear-gradient(135deg,#5B6CFF,#7C8AFF); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform .15s, box-shadow .15s; }' +
      '#' + PLACEHOLDER_ID + ' .bk-ph-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(91,108,255,.35); }';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensurePlaceholder() {
    // 首页：注入分区卡片面板
    if (placeholderNeeded('home')) {
      const hot = document.getElementById(PLACEHOLDER_ID);
      if (hot) hot.remove();
      removeVideoStats();
      mountHomePanel();
      return;
    }
    // 热门 / 排行榜：居中占位卡片
    if (placeholderNeeded('hot')) {
      removeHomePanel();
      removeVideoStats();
      ensureHotPlaceholder();
      return;
    }
    // 视频页：右侧栏注入观看统计面板
    if (videoStatsNeeded()) {
      removeHomePanel();
      const hotEl = document.getElementById(PLACEHOLDER_ID);
      if (hotEl) hotEl.remove();
      mountVideoStats();
      return;
    }
    // 其他页面：清理全部占位
    const hotEl = document.getElementById(PLACEHOLDER_ID);
    if (hotEl) hotEl.remove();
    removeHomePanel();
    removeVideoStats();
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

  /* ---------------- 首页卡片面板 ---------------- */

  /**
   * 首页面板样式：全部颜色收敛为 --bk-home-* CSS 变量（亮色为默认值），
   * 追加 html.dark 覆盖块适配 B 站深色模式（深色开关会在 <html> 上添加 dark 类）。
   * 变量作用域限定在 #bk-home-panel 内，不影响 B 站其余界面。
   */
  function injectHomeStyle() {
    if (document.getElementById(HOME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HOME_STYLE_ID;
    const rules = [
      '#' + HOME_PANEL_ID + ' {',
      '  --bk-home-text: #1F2430;',
      '  --bk-home-sub: #6B7280;',
      '  --bk-home-faint: #9AA1B4;',
      '  --bk-home-primary: #5B6CFF;',
      '  --bk-home-card-bg: #FFFFFF;',
      '  --bk-home-card-border: rgba(91,108,255,.08);',
      '  --bk-home-shadow: 0 8px 28px rgba(31,36,48,.05);',
      '  --bk-home-hover-shadow: 0 16px 40px rgba(91,108,255,.16);',
      '  --bk-home-input-bg: #FFFFFF;',
      '  --bk-home-input-border: #E5E7F0;',
      '  --bk-home-input-shadow: 0 6px 24px rgba(31,36,48,.06);',
      '  --bk-home-focus-ring: rgba(91,108,255,.14);',
      '  --bk-home-gradient: linear-gradient(135deg,#5B6CFF,#7C8AFF);',
      '  --bk-home-eyebrow-bg: linear-gradient(135deg, rgba(91,108,255,.10), rgba(251,114,153,.10));',
      '  position: relative; z-index: 50; box-sizing: border-box; width: 100%; max-width: 1180px; margin: 0 auto; padding: 52px 24px 72px; font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;',
      '}',
      'html.dark #' + HOME_PANEL_ID + ' {',
      '  --bk-home-text: #E8E9ED;',
      '  --bk-home-sub: #9AA1B4;',
      '  --bk-home-faint: #6B7280;',
      '  --bk-home-primary: #7C8AFF;',
      '  --bk-home-card-bg: #1E2029;',
      '  --bk-home-card-border: rgba(255,255,255,.08);',
      '  --bk-home-shadow: 0 8px 28px rgba(0,0,0,.35);',
      '  --bk-home-hover-shadow: 0 16px 40px rgba(91,108,255,.25);',
      '  --bk-home-input-bg: #17181F;',
      '  --bk-home-input-border: rgba(255,255,255,.14);',
      '  --bk-home-input-shadow: 0 6px 24px rgba(0,0,0,.30);',
      '  --bk-home-focus-ring: rgba(91,108,255,.30);',
      '  --bk-home-gradient: linear-gradient(135deg,#6C7BFF,#8B96FF);',
      '  --bk-home-eyebrow-bg: linear-gradient(135deg, rgba(91,108,255,.18), rgba(251,114,153,.18));',
      '}',
      '#' + HOME_PANEL_ID + ' .bk-home-top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 36px; align-items: stretch; margin: 0 0 44px; }',
      '@media (max-width: 900px) { #' + HOME_PANEL_ID + ' .bk-home-top { grid-template-columns: 1fr; gap: 28px; } }',
      '#' + HOME_PANEL_ID + ' .bk-home-hero { text-align: left; margin-bottom: 0; }',
      '#' + HOME_PANEL_ID + ' .bk-home-eyebrow { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 18px; padding: 6px 16px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .16em; color: var(--bk-home-primary); background: var(--bk-home-eyebrow-bg); }',
      '#' + HOME_PANEL_ID + ' .bk-home-title { margin: 0 0 12px; font-size: 32px; font-weight: 700; color: var(--bk-home-text); letter-spacing: .01em; }',
      '#' + HOME_PANEL_ID + ' .bk-home-title .bk-greeting { color: var(--bk-home-primary); }',
      '#' + HOME_PANEL_ID + ' .bk-home-desc { margin: 0 0 14px; font-size: 14px; line-height: 1.7; color: var(--bk-home-sub); }',
      '#' + HOME_PANEL_ID + ' .bk-home-quote { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 30px; padding-left: 12px; border-left: 3px solid var(--bk-home-primary); font-size: 13px; line-height: 1.6; color: var(--bk-home-sub); font-style: italic; }',
      '#' + HOME_PANEL_ID + ' .bk-home-search { display: flex; gap: 12px; justify-content: flex-start; }',
      '#' + HOME_PANEL_ID + ' .bk-home-search input { flex: 1; min-width: 0; height: 52px; padding: 0 24px; border-radius: 26px; border: 1.5px solid var(--bk-home-input-border); background: var(--bk-home-input-bg); font-size: 15px; color: var(--bk-home-text); outline: none; box-sizing: border-box; box-shadow: var(--bk-home-input-shadow); transition: border-color .15s, box-shadow .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-home-search input:focus { border-color: var(--bk-home-primary); box-shadow: 0 0 0 4px var(--bk-home-focus-ring); }',
      '#' + HOME_PANEL_ID + ' .bk-home-search button { height: 52px; padding: 0 32px; border: none; border-radius: 26px; cursor: pointer; background: var(--bk-home-gradient); color: #fff; font-size: 15px; font-weight: 600; box-shadow: 0 8px 24px rgba(91,108,255,.32); transition: transform .15s, box-shadow .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-home-search button:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(91,108,255,.42); }',
      '#' + HOME_PANEL_ID + ' .bk-home-stats { display: grid; grid-template-columns: 1fr; gap: 14px; margin: 0; align-content: center; animation: bk-home-stats-in .5s cubic-bezier(.21,1.02,.73,1) backwards; }',
      '#' + HOME_PANEL_ID + ' .bk-today-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 24px; border-radius: 18px; background: var(--bk-home-card-bg); border: 1px solid var(--bk-home-card-border); box-shadow: var(--bk-home-shadow); transition: transform .18s cubic-bezier(.21,1.02,.73,1), box-shadow .18s; }',
      '#' + HOME_PANEL_ID + ' .bk-today-item:hover { transform: translateY(-2px); box-shadow: var(--bk-home-hover-shadow); }',
      '#' + HOME_PANEL_ID + ' .bk-today-label { font-size: 14px; font-weight: 600; letter-spacing: .04em; color: var(--bk-home-sub); }',
      '#' + HOME_PANEL_ID + ' .bk-today-value { font-size: 24px; font-weight: 700; color: var(--bk-home-primary); font-variant-numeric: tabular-nums; }',
      '#' + HOME_PANEL_ID + ' .bk-today-value.is-off { font-size: 18px; color: var(--bk-home-faint); }',
      '@keyframes bk-home-stats-in { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 18px; font-size: 18px; font-weight: 700; color: var(--bk-home-text); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head .bk-wl-count { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; color: var(--bk-home-primary); background: var(--bk-home-eyebrow-bg); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }',
      '@media (max-width: 900px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: repeat(2, 1fr); } }',
      '@media (max-width: 640px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: 1fr; } }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card { display: block; text-decoration: none; background: var(--bk-home-card-bg); border: 1px solid var(--bk-home-card-border); border-radius: 18px; overflow: hidden; box-shadow: var(--bk-home-shadow); animation: bk-wl-in .5s cubic-bezier(.21,1.02,.73,1) backwards; transition: transform .18s cubic-bezier(.21,1.02,.73,1), box-shadow .18s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card:hover { transform: translateY(-4px); box-shadow: var(--bk-home-hover-shadow); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover { position: relative; display: block; aspect-ratio: 16 / 10; background: rgba(91,108,255,.06); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-dur { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(0,0,0,.62); color: #fff; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-info { display: block; padding: 12px 14px 14px; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--bk-home-text); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-meta { display: block; margin-top: 8px; font-size: 12px; color: var(--bk-home-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-status { padding: 34px 24px; border-radius: 18px; text-align: center; font-size: 14px; line-height: 1.8; color: var(--bk-home-sub); background: var(--bk-home-card-bg); border: 1px dashed var(--bk-home-card-border); }',
      '@keyframes bk-wl-in { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }',
      '#' + HOME_PANEL_ID + ' .bk-home-foot { margin: 40px 0 0; text-align: center; font-size: 12px; color: var(--bk-home-faint); }',
      '@media (max-width: 900px) { #' + HOME_PANEL_ID + ' .bk-home-hero { text-align: center; } #' + HOME_PANEL_ID + ' .bk-home-search { justify-content: center; } #' + HOME_PANEL_ID + ' .bk-home-search input { flex: none; width: min(420px, calc(100vw - 140px)); } }',
    ];
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------------- 问候语与每日一句（纯本地，零网络） ---------------- */

  /** 按时段划分问候档位：until 为当日小时边界（5 / 11 / 17 / 23） */
  var HOME_GREETINGS = [
    { until: 5, text: '夜深了' },
    { until: 11, text: '早上好' },
    { until: 17, text: '下午好' },
    { until: 23, text: '晚上好' },
  ];

  /** 本地专注格言数组：按日期取模轮换，保证每日稳定且跨天不重复策略 */
  var HOME_QUOTES = [
    '把注意力留给真正重要的事。',
    '少刷一个视频，多留一点清醒。',
    '内容可以无穷尽，时间却只有 24 小时。',
    '真正的自由，是能对推荐流说不。',
    '别让算法替你决定今天的心情。',
    '注意力的边界，就是人生的边界。',
    '好的选择，往往安静而清醒。',
    '今天也请善待自己的时间。',
  ];

  function greetingText() {
    const h = new Date().getHours();
    for (const g of HOME_GREETINGS) {
      if (h < g.until) return g.text;
    }
    return HOME_GREETINGS[0].text;
  }

  /** 按日期键取整日格言索引（字符串 hash 取模），同一天内恒定 */
  function todayQuote() {
    const key = shared.todayKey();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return HOME_QUOTES[hash % HOME_QUOTES.length];
  }

  function goSearch(kw) {
    const keyword = String(kw || '').trim();
    if (keyword) {
      location.href = 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(keyword);
    } else {
      location.href = 'https://www.bilibili.com/';
    }
  }

  /**
   * 首页面板：自愈式挂载。
   * - 首次创建后立即调用 placeHomePanel 定位；
   * - 后续 SPA 路由 / MutationObserver 触发的每次调用只做位置校验（move，不重建），
   *   即使 B 站异步渲染时序不稳定导致锚点后出现，面板也能自动挪到正确位置。
   */
  function mountHomePanel() {
    if (!document.body) return;
    let el = document.getElementById(HOME_PANEL_ID);
    if (!el) {
      injectHomeStyle();

      el = document.createElement('div');
      el.id = HOME_PANEL_ID;
      el.innerHTML =
        '<div class="bk-home-top">' +
        '  <div class="bk-home-hero">' +
        '    <p class="bk-home-eyebrow">BILIKILLER · 已移除推荐流</p>' +
        '    <h2 class="bk-home-title"><span class="bk-greeting" data-greeting>' + greetingText() + '</span>，今天想看点什么？</h2>' +
        '    <p class="bk-home-desc">推荐内容已被暂时移除，不再被「再看一个」牵着走。<br>有明确想看的，就用搜索直达。</p>' +
        '    <p class="bk-home-quote" data-quote>「' + todayQuote() + '」</p>' +
        '    <div class="bk-home-search">' +
        '      <input type="search" placeholder="搜索你想看的视频…" />' +
        '      <button type="button">搜索</button>' +
        '    </div>' +
        '  </div>' +
        '  <div id="bk-today-stats" class="bk-home-stats">' +
        '    <div class="bk-today-item" data-stat="duration">' +
        '      <span class="bk-today-label">今日已看</span>' +
        '      <span class="bk-today-value" data-value="duration">--</span>' +
        '    </div>' +
        '    <div class="bk-today-item" data-stat="reminder">' +
        '      <span class="bk-today-label">距下次提醒</span>' +
        '      <span class="bk-today-value" data-value="reminder">--</span>' +
        '    </div>' +
        '    <div class="bk-today-item" data-stat="visits">' +
        '      <span class="bk-today-label">今日访问</span>' +
        '      <span class="bk-today-value" data-value="visits">--</span>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<div id="bk-watch-later"></div>' +
        '<p class="bk-home-foot">这里只展示你主动加入「稍后再看」的视频 · 想恢复原页面，可在扩展设置中关闭「首页推荐流」</p>';

      const btn = el.querySelector('.bk-home-search button');
      const input = el.querySelector('.bk-home-search input');
      const doSearch = function () { goSearch(input.value); };
      btn.addEventListener('click', doSearch);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    }
    // 先把面板插入 DOM，再启动定时器 / 加载稍后再看——
    // loadWatchLater 依赖 #bk-watch-later 已在文档中，否则 getElementById 返回 null 直接跳过
    placeHomePanel(el);
    if (el.getAttribute('data-bk-inited') !== '1') {
      el.setAttribute('data-bk-inited', '1');
      startStatsTimer();
      loadWatchLater();
    }
  }

  /**
   * 校正首页面板位置：优先插到推荐流容器（.bili-feed4-layout）之前；
   * 锚点尚未渲染时，紧跟 B 站顶栏之后放置（内容区顶部），
   * 绝不落到 body 首位（否则会把 B 站横幅顶到页面下方）。
   * 与视频面板同理：直接挂到目标位置，不先挂 body 再移动，避免干扰 B 站组件挂载。
   */
  function placeHomePanel(el) {
    const anchor = document.querySelector('.bili-feed4-layout') || document.querySelector('.bili-layout');
    if (anchor && anchor.parentElement) {
      if (anchor.previousElementSibling !== el) {
        anchor.parentElement.insertBefore(el, anchor);
      }
      return;
    }
    const header = document.querySelector('.bili-header.large-header') || document.querySelector('.bili-header');
    if (header && header.parentElement) {
      if (header.nextElementSibling !== el) {
        header.parentElement.insertBefore(el, header.nextElementSibling);
      }
    } else {
      // 极端兜底：顶栏也不存在时保持面板在 body 末尾，不影响 B 站头部布局
      if (el.parentElement && el.parentElement !== document.body) {
        document.body.appendChild(el);
      } else if (!el.parentElement) {
        document.body.appendChild(el);
      }
    }
  }

  /* ---------------- 稍后再看 ---------------- */

  const WATCH_LATER_URL = 'https://api.bilibili.com/x/v2/history/toview';
  const WATCH_LATER_ID = 'bk-watch-later';
  const WATCH_LATER_LIMIT = 8;

  /** 秒数格式化为 H:MM:SS / MM:SS */
  function formatWatchLaterDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = m < 10 ? '0' + m : String(m);
    const ss = sec < 10 ? '0' + sec : String(sec);
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  /** 稍后再看状态降级：login=未登录 / empty=空列表 / error=加载失败 */
  function renderWatchLaterStatus(box, status) {
    const hint = {
      login: '登录 B 站后，你主动加入「稍后再看」的视频会展示在这里',
      empty: '「稍后再看」还是空的，看到想看的视频时点收藏夹加入即可',
      error: '「稍后再看」加载失败，请刷新重试',
    }[status] || '';
    box.innerHTML =
      '<div class="bk-wl-head">稍后再看</div>' +
      '<div class="bk-wl-status" data-status="' + status + '">' + hint + '</div>';
  }

  function renderWatchLater(box, data) {
    if (!data || data.code !== 0) {
      renderWatchLaterStatus(box, data && data.code === -101 ? 'login' : 'error');
      return;
    }
    const list = (data.data && data.data.list) || [];
    if (!list.length) {
      renderWatchLaterStatus(box, 'empty');
      return;
    }

    const cards = list.slice(0, WATCH_LATER_LIMIT).map(function (v) {
      const title = v.title || '未命名视频';
      const author = v.author && v.author.name ? v.author.name : '';
      const bvid = v.bvid || '';
      const href = bvid ? 'https://www.bilibili.com/video/' + bvid : 'https://www.bilibili.com/';
      const pic = v.pic || '';
      const dur = v.duration ? '<span class="bk-wl-dur">' + formatWatchLaterDuration(v.duration) + '</span>' : '';
      return '<a class="bk-wl-card" href="' + href + '" target="_blank" rel="noopener">' +
        '  <span class="bk-wl-cover">' +
        '    <img loading="lazy" src="' + pic + '" alt="' + title + '" onerror="this.style.display=\'none\'" />' +
        dur +
        '  </span>' +
        '  <span class="bk-wl-info">' +
        '    <span class="bk-wl-title">' + title + '</span>' +
        '    <span class="bk-wl-meta">' + author + '</span>' +
        '  </span>' +
        '</a>';
    }).join('');

    box.innerHTML =
      '<div class="bk-wl-head">稍后再看<span class="bk-wl-count">' + list.length + '</span></div>' +
      '<div class="bk-wl-grid">' + cards + '</div>';
  }

  function loadWatchLater() {
    const box = document.getElementById(WATCH_LATER_ID);
    if (!box) return;
    fetch(WATCH_LATER_URL, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    })
      .then(function (r) { return r.json(); })
      .then(function (j) { renderWatchLater(box, j); })
      .catch(function () { renderWatchLaterStatus(box, 'error'); });
  }

  /* ---------------- 今日状态卡 ---------------- */

  const STATS_REFRESH_MS = 30000;
  let statsTimer = null;

  /** 渲染今日统计：仅更新文本节点，不重建 DOM；后台不可用时降级为占位符 */
  function renderTodayStats(resp) {
    const box = document.getElementById('bk-today-stats');
    if (!box) return;
    const durationEl = box.querySelector('[data-value="duration"]');
    const remindEl = box.querySelector('[data-value="reminder"]');
    const visitsEl = box.querySelector('[data-value="visits"]');

    if (!resp || !resp.ok) {
      durationEl.textContent = '--';
      remindEl.textContent = '--';
      visitsEl.textContent = '--';
      return;
    }

    const seconds = Number(resp.today.seconds) || 0;
    const visits = Number(resp.today.visits) || 0;

    durationEl.textContent = shared.formatDuration(seconds);

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
      remindEl.classList.add('is-off');
    } else {
      const intervalSec = Math.max(1, Number(settings.reminderIntervalMin) || 30) * 60;
      const next = (Math.floor(seconds / intervalSec) + 1) * intervalSec;
      const remainMin = Math.max(1, Math.ceil((next - seconds) / 60));
      remindEl.textContent = remainMin + ' 分钟';
      remindEl.classList.remove('is-off');
    }

    visitsEl.textContent = visits + ' 次';
  }

  function fetchTodayStats() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      renderTodayStats(null);
      return;
    }
    chrome.runtime.sendMessage({ type: shared.MSG.GET_TODAY }, function (resp) {
      if (chrome.runtime.lastError) {
        renderTodayStats(null); // 静默降级，下轮轮询自动重试
        return;
      }
      renderTodayStats(resp);
    });
  }

  function onStatsVisibility() {
    if (document.visibilityState === 'visible') fetchTodayStats();
  }

  function startStatsTimer() {
    stopStatsTimer();
    fetchTodayStats();
    statsTimer = setInterval(fetchTodayStats, STATS_REFRESH_MS);
    document.addEventListener('visibilitychange', onStatsVisibility);
  }

  function stopStatsTimer() {
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
    document.removeEventListener('visibilitychange', onStatsVisibility);
  }

  function removeHomePanel() {
    stopStatsTimer();
    const el = document.getElementById(HOME_PANEL_ID);
    if (el) el.remove();
  }

  /* ---------------- 视频页观看统计面板 ---------------- */

  const VIDEO_STATS_ID = 'bk-video-stats';
  const VIDEO_STATS_STYLE_ID = 'bk-video-stats-style';
  let videoStatsTimer = null;

  function videoStatsNeeded() {
    return settings.enabled && currentPage === 'video';
  }

  function injectVideoStatsStyle() {
    if (document.getElementById(VIDEO_STATS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = VIDEO_STATS_STYLE_ID;
    const rules = [
      '#' + VIDEO_STATS_ID + ' {',
      '  --bk-vs-bg: #FFFFFF;',
      '  --bk-vs-text: #1F2430;',
      '  --bk-vs-sub: #6B7280;',
      '  --bk-vs-faint: #9AA1B4;',
      '  --bk-vs-primary: #5B6CFF;',
      '  --bk-vs-border: rgba(91,108,255,.08);',
      '  --bk-vs-shadow: 0 8px 28px rgba(31,36,48,.05);',
      '  box-sizing: border-box; margin: 0 0 16px; padding: 20px; border-radius: 18px; background: var(--bk-vs-bg); border: 1px solid var(--bk-vs-border); box-shadow: var(--bk-vs-shadow); font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;',
      '}',
      'html.dark #' + VIDEO_STATS_ID + ' {',
      '  --bk-vs-bg: #1E2029;',
      '  --bk-vs-text: #E8E9ED;',
      '  --bk-vs-sub: #9AA1B4;',
      '  --bk-vs-faint: #6B7280;',
      '  --bk-vs-primary: #7C8AFF;',
      '  --bk-vs-border: rgba(255,255,255,.08);',
      '  --bk-vs-shadow: 0 8px 28px rgba(0,0,0,.35);',
      '}',
      '#' + VIDEO_STATS_ID + ' .bk-vs-head { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 14px; font-weight: 700; color: var(--bk-vs-text); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-logo { width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; background: linear-gradient(135deg,#5B6CFF,#7C8AFF); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-hero { padding: 14px 16px; margin-bottom: 12px; border-radius: 14px; background: linear-gradient(135deg, rgba(91,108,255,.08), rgba(251,114,153,.08)); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-hero-label { display: block; font-size: 12px; font-weight: 600; color: var(--bk-vs-sub); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-hero-value { display: block; margin-top: 4px; font-size: 26px; font-weight: 800; color: var(--bk-vs-primary); font-variant-numeric: tabular-nums; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-cell { padding: 10px 12px; border-radius: 12px; background: var(--bk-vs-bg); border: 1px solid var(--bk-vs-border); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-cell span { display: block; font-size: 11px; color: var(--bk-vs-faint); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-cell b { display: block; margin-top: 3px; font-size: 15px; font-weight: 700; color: var(--bk-vs-text); font-variant-numeric: tabular-nums; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-compare { padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; font-size: 13px; font-weight: 600; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-compare.up { color: #16A34A; background: rgba(34,197,94,.12); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-compare.down { color: #D97706; background: rgba(245,158,11,.12); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-compare.flat { color: var(--bk-vs-sub); background: var(--bk-vs-bg); border: 1px solid var(--bk-vs-border); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-avg { margin-bottom: 14px; font-size: 12px; color: var(--bk-vs-faint); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-avg b { color: var(--bk-vs-text); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-chart { display: flex; align-items: flex-end; gap: 6px; height: 52px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-bar { flex: 1; min-width: 4px; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg,#7C8AFF,#5B6CFF); opacity: .85; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-bar.empty { background: rgba(154,161,180,.22); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-tags { margin-top: 14px; border-top: 1px solid var(--bk-vs-border); padding-top: 14px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-tags-title { margin-bottom: 12px; font-size: 13px; font-weight: 700; color: var(--bk-vs-text); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-tags-body { display: flex; align-items: center; gap: 16px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-donut { flex: none; width: 92px; height: 92px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-donut-ring { width: 92px; height: 92px; border-radius: 50%; position: relative; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-donut-ring::after { content: ""; position: absolute; inset: 24px; border-radius: 50%; background: var(--bk-vs-bg); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-donut-empty { width: 92px; height: 92px; box-sizing: border-box; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px; font-size: 11px; line-height: 1.5; color: var(--bk-vs-faint); background: var(--bk-vs-bg); border: 1px dashed var(--bk-vs-border); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--bk-vs-sub); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-legend-dot { flex: none; width: 10px; height: 10px; border-radius: 3px; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-legend-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-legend-val { flex: none; font-variant-numeric: tabular-nums; color: var(--bk-vs-text); font-weight: 600; }',
    ];
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /** 与昨日对比文案：多/少/持平，昨日无记录时给出提示 */
  function compareText(todaySec, yesterdaySec) {
    if (yesterdaySec <= 0) return '昨天还没有观看记录';
    const diff = todaySec - yesterdaySec;
    const mins = Math.max(1, Math.round(Math.abs(diff) / 60));
    if (diff === 0) return '与昨天持平';
    return diff > 0 ? '比昨天多看了 ' + mins + ' 分钟' : '比昨天少看了 ' + mins + ' 分钟';
  }

  /** 近 7 天迷你柱状图 */
  function buildMiniChart(series) {
    const max = Math.max(60, series.reduce(function (a, d) { return Math.max(a, Number(d.seconds) || 0); }, 0));
    return series.map(function (d) {
      const sec = Number(d.seconds) || 0;
      const h = sec <= 0 ? 0 : Math.max(14, Math.round((sec / max) * 100));
      return '<span class="bk-vs-bar' + (sec <= 0 ? ' empty' : '') + '" style="height:' + h + '%" title="' + d.date.slice(5) + '：' + Math.round(sec / 60) + ' 分钟"></span>';
    }).join('');
  }

  /* ---------------- 内容标签统计 ---------------- */

  const TAG_PALETTE = ['#5B6CFF', '#FB7299', '#22C55E', '#F59E0B', '#8B5CF6', '#14B8A6', '#EC4899', '#60A5FA', '#FBBF24', '#6EE7B7'];

  /** 采集当前视频页标签并写入 globalThis（多个 content script 共享同一 isolated world），供 tracker 心跳上报携带 */
  function collectCurrentVideoTags() {
    const out = [];
    document.querySelectorAll('.tag-link').forEach(function (a) {
      const t = (a.textContent || '').trim();
      if (t && t.length <= 12 && out.indexOf(t) === -1) out.push(t);
    });
    globalThis.__BK_CURRENT_TAGS = out;
    return out;
  }

  /** 标签 Map -> 排序数组，取 Top 6，其余合并为「其他」 */
  function summarizeTags(tagMap) {
    const entries = Object.keys(tagMap || {}).map(function (name) {
      return { name: name, sec: Number(tagMap[name]) || 0 };
    }).filter(function (e) { return e.sec > 0; });
    entries.sort(function (a, b) { return b.sec - a.sec; });
    const top = entries.slice(0, 6);
    const restSec = entries.slice(6).reduce(function (a, e) { return a + e.sec; }, 0);
    if (restSec > 0) top.push({ name: '其他', sec: restSec });
    return top;
  }

  /** 渲染标签时长占比扇形图（conic-gradient）与图例 */
  function renderVideoTags(respTags) {
    const box = document.getElementById(VIDEO_STATS_ID);
    if (!box) return;
    const donutEl = box.querySelector('[data-vs="donut"]');
    const legendEl = box.querySelector('[data-vs="legend"]');
    if (!donutEl || !legendEl) return;

    if (!respTags || !respTags.ok) {
      donutEl.innerHTML = '<div class="bk-vs-donut-empty">数据加载中…</div>';
      legendEl.textContent = '';
      return;
    }
    const entries = summarizeTags(respTags.tags);
    const total = entries.reduce(function (a, e) { return a + e.sec; }, 0);
    if (!total) {
      donutEl.innerHTML = '<div class="bk-vs-donut-empty">观看后<br>展示标签占比</div>';
      legendEl.textContent = '';
      return;
    }
    let cum = 0;
    const stops = entries.map(function (e, i) {
      const pct = (e.sec / total) * 100;
      const from = cum;
      cum += pct;
      return TAG_PALETTE[i % TAG_PALETTE.length] + ' ' + from.toFixed(2) + '% ' + cum.toFixed(2) + '%';
    });
    donutEl.innerHTML = '<div class="bk-vs-donut-ring" style="background: conic-gradient(' + stops.join(', ') + ')"></div>';
    legendEl.innerHTML = entries.map(function (e, i) {
      return '<div class="bk-vs-legend-item">' +
        '<span class="bk-vs-legend-dot" style="background:' + TAG_PALETTE[i % TAG_PALETTE.length] + '"></span>' +
        '<span class="bk-vs-legend-name" title="' + e.name + '">' + e.name + '</span>' +
        '<span class="bk-vs-legend-val">' + Math.round(e.sec / 60) + ' 分</span>' +
        '</div>';
    }).join('');
  }

  function renderVideoStats(respToday, respStats, respTags) {
    const box = document.getElementById(VIDEO_STATS_ID);
    if (!box) return;
    const durEl = box.querySelector('[data-vs="duration"]');
    const visitsEl = box.querySelector('[data-vs="visits"]');
    const remindEl = box.querySelector('[data-vs="reminder"]');
    const cmpEl = box.querySelector('[data-vs="compare"]');
    const avgEl = box.querySelector('[data-vs="avg"]');
    const chartEl = box.querySelector('[data-vs="chart"]');

    if (!respToday || !respToday.ok || !respStats || !respStats.ok) {
      durEl.textContent = '--';
      visitsEl.textContent = '--';
      remindEl.textContent = '--';
      cmpEl.textContent = '数据加载中…';
      cmpEl.className = 'bk-vs-compare flat';
      avgEl.textContent = '--';
      chartEl.innerHTML = '';
      renderVideoTags(null);
      return;
    }

    const seconds = Number(respToday.today.seconds) || 0;
    const visits = Number(respToday.today.visits) || 0;
    const series = respStats.series || [];

    durEl.textContent = shared.formatDuration(seconds);
    visitsEl.textContent = visits + ' 次';

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
    } else {
      const intervalSec = Math.max(1, Number(settings.reminderIntervalMin) || 30) * 60;
      const next = (Math.floor(seconds / intervalSec) + 1) * intervalSec;
      remindEl.textContent = Math.max(1, Math.ceil((next - seconds) / 60)) + ' 分钟';
    }

    const yesterdaySec = series.length >= 2 ? Number(series[series.length - 2].seconds) || 0 : 0;
    cmpEl.textContent = compareText(seconds, yesterdaySec);
    cmpEl.className = 'bk-vs-compare ' + (seconds > yesterdaySec ? 'up' : (seconds < yesterdaySec && yesterdaySec > 0 ? 'down' : 'flat'));

    const avgSec = series.length ? Math.round(series.reduce(function (a, d) { return a + (Number(d.seconds) || 0); }, 0) / series.length) : 0;
    avgEl.textContent = Math.round(avgSec / 60) + ' 分钟';

    chartEl.innerHTML = buildMiniChart(series);
    renderVideoTags(respTags);
  }

  function fetchVideoStats() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    collectCurrentVideoTags(); // 每次刷新同时采集当前标签（B 站标签可能延迟渲染）
    chrome.runtime.sendMessage({ type: shared.MSG.GET_TODAY }, function (r1) {
      if (chrome.runtime.lastError) { renderVideoStats(null, null, null); return; }
      chrome.runtime.sendMessage({ type: shared.MSG.GET_STATS, days: 7 }, function (r2) {
        if (chrome.runtime.lastError) { renderVideoStats(r1, null, null); return; }
        chrome.runtime.sendMessage({ type: shared.MSG.GET_TAGS, days: 14 }, function (r3) {
          if (chrome.runtime.lastError) { renderVideoStats(r1, r2, null); return; }
          renderVideoStats(r1, r2, r3);
        });
      });
    });
  }

  function onVideoStatsVisibility() {
    if (document.visibilityState === 'visible') fetchVideoStats();
  }

  /**
   * 视频页统计面板：自愈式挂载。
   * 关键设计：面板挂在 document.body 末尾，用 position:fixed 定位到右侧栏
   * （.right-container-inner，sticky）的视口下方，绝不插入 B 站 Vue 管理的容器
   * （.right-container / .right-container-inner / .app-v1 均实测会触发 video.js
   * 崩溃：Vue 持续更新时遍历其 children，nextSibling 为 undefined）。
   * - fixed 相对视口定位：sticky 右侧栏在视口中保持固定位置，面板同样保持，
   *   二者相对关系恒定，滚动时自然跟随，无需 scroll 监听；
   * - 仅右侧栏尺寸变化（懒加载相关推荐）时用 ResizeObserver 重算一次；
   * - document.body 不是 B 站 Vue 管理的容器，插入面板绝对安全（实测 5/5 稳定）。
   */
  function mountVideoStats() {
    if (!document.body) return;
    let el = document.getElementById(VIDEO_STATS_ID);
    if (!el) {
      injectVideoStatsStyle();
      el = document.createElement('div');
      el.id = VIDEO_STATS_ID;
      el.innerHTML =
        '<div class="bk-vs-head"><span class="bk-vs-logo">BK</span>观看统计</div>' +
        '<div class="bk-vs-hero">' +
        '  <span class="bk-vs-hero-label">今日已看</span>' +
        '  <span class="bk-vs-hero-value" data-vs="duration">--</span>' +
        '</div>' +
        '<div class="bk-vs-grid">' +
        '  <div class="bk-vs-cell"><span>今日访问</span><b data-vs="visits">--</b></div>' +
        '  <div class="bk-vs-cell"><span>距下次提醒</span><b data-vs="reminder">--</b></div>' +
        '</div>' +
        '<div class="bk-vs-compare flat" data-vs="compare">数据加载中…</div>' +
        '<div class="bk-vs-avg">近 7 天日均 <b data-vs="avg">--</b></div>' +
        '<div class="bk-vs-chart" data-vs="chart"></div>' +
        '<div class="bk-vs-tags">' +
        '  <div class="bk-vs-tags-title">内容占比 · 近 14 天</div>' +
        '  <div class="bk-vs-tags-body">' +
        '    <div class="bk-vs-donut" data-vs="donut"><div class="bk-vs-donut-empty">数据加载中…</div></div>' +
        '    <div class="bk-vs-legend" data-vs="legend"></div>' +
        '  </div>' +
        '</div>';

      // 挂到 document.body 末尾（安全容器，非 Vue 管理），后续 fixed 定位到右侧栏下方
      document.body.appendChild(el);

      collectCurrentVideoTags();
      stopVideoStatsTimer();
      fetchVideoStats();
      videoStatsTimer = setInterval(fetchVideoStats, STATS_REFRESH_MS);
      document.addEventListener('visibilitychange', onVideoStatsVisibility);
    }
    placeVideoStats(el);
  }

  /**
   * 校正视频统计面板位置：fixed 定位到 sticky 右侧栏（.right-container-inner）
   * 的视口下方。滚动时 sticky 元素相对视口位置不变，面板（fixed）亦不变，
   * 二者相对关系恒定，无需 scroll 监听。
   * 仅当右侧栏高度变化（懒加载相关推荐 / 展开收起）时由 ResizeObserver 重算。
   */
  let videoStatsAnchorObserver = null;
  function placeVideoStats(el) {
    const anchor = document.querySelector('.right-container-inner') || document.querySelector('.right-container');
    if (!anchor) {
      el.style.display = 'none';
      return;
    }
    const r = anchor.getBoundingClientRect();
    const left = Math.round(r.left);
    const width = Math.round(r.width);
    // 右侧栏容器底部有 B 站预留的 padding-bottom（相关推荐懒加载空间），
    // 直接贴容器 bottom 会在面板上方留下大段空白。改为贴「最后一个可见内容」的 bottom。
    let bottom = r.bottom;
    for (let i = anchor.children.length - 1; i >= 0; i--) {
      const c = anchor.children[i];
      const cs = getComputedStyle(c);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && c.getBoundingClientRect().height > 0) {
        bottom = c.getBoundingClientRect().bottom;
        break;
      }
    }
    const top = Math.round(bottom + 6);
    const curLeft = parseFloat(el.style.left);
    const curTop = parseFloat(el.style.top);
    // 仅视口位置/宽度变化超过阈值才更新，避免无意义重排
    if (!isFinite(curLeft) || !isFinite(curTop) ||
        Math.abs(curLeft - left) > 2 || Math.abs(curTop - top) > 2 ||
        el.style.width !== width + 'px') {
      el.style.position = 'fixed';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.width = width + 'px';
    }
    el.style.display = 'block';

    // 右侧栏尺寸变化（懒加载）时重算，避免面板被遮挡
    if (!videoStatsAnchorObserver && typeof ResizeObserver === 'function') {
      videoStatsAnchorObserver = new ResizeObserver(function () {
        const box = document.getElementById(VIDEO_STATS_ID);
        if (box) placeVideoStats(box);
      });
      videoStatsAnchorObserver.observe(anchor);
    }
  }

  function removeVideoStats() {
    if (videoStatsTimer) {
      clearInterval(videoStatsTimer);
      videoStatsTimer = null;
    }
    if (videoStatsAnchorObserver) {
      videoStatsAnchorObserver.disconnect();
      videoStatsAnchorObserver = null;
    }
    document.removeEventListener('visibilitychange', onVideoStatsVisibility);
    const el = document.getElementById(VIDEO_STATS_ID);
    if (el) el.remove();
    // 离开视频页后清空标签，避免其他页面观看时长误记入上个视频的标签
    globalThis.__BK_CURRENT_TAGS = [];
  }

  function stopVideoStatsTimer() {
    if (videoStatsTimer) {
      clearInterval(videoStatsTimer);
      videoStatsTimer = null;
    }
    document.removeEventListener('visibilitychange', onVideoStatsVisibility);
  }

  /* ---------------- SPA 路由与兜底监听 ---------------- */

  function refresh() {
    const next = detectPage();
    if (next !== currentPage) {
      currentPage = next;
      injectCss();
    }
    // 面板 DOM 注入必须经过页面就绪门闩：B 站初始化早期调用 pushState / replaceState
    // 会触发本函数，若直接注入面板会撞上顶栏异步挂载。pageReady 后每次刷新都正常执行。
    if (pageReady) {
      ensurePlaceholder();
    } else {
      onPageReady(ensurePlaceholder);
    }
  }

  let timer = null;
  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      refresh();
    }, 200);
  }

  function patchHistory(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      scheduleRefresh();
      return result;
    };
  }
  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);

  // Observer 兜底：仅在有新元素节点插入且距上次处理超过 800ms 时触发
  let lastObserverRun = 0;
  function startObserver() {
    if (!document.body) return;
    const observer = new MutationObserver(function (mutations) {
      let hasElement = false;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) { hasElement = true; break; }
        }
        if (hasElement) break;
      }
      if (!hasElement) return;
      const now = Date.now();
      if (now - lastObserverRun < 800) return;
      lastObserverRun = now;
      scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------- 设置加载与实时同步 ---------------- */

  /**
   * 页面就绪门闩（信号驱动，无硬编码等待）：
   * 实测确认 B 站 video.js 初始化（Vue mount、右侧栏渲染、播放器创建）是一个
   * 较长的异步过程，期间任何对右侧栏/body 的 DOM 注入都会破坏其内部遍历
   * （nextSibling 为 undefined 崩溃 → bili-header 顶栏挂载失败）。
   * 必须等待「video.js 初始化完成」的确定性信号：
   * - 主信号：.right-container 内已渲染出视频卡片（.video-page-card-small 等）→
   *   video.js 主流程完成（纯净环境实测该信号出现后注入任意面板元素均安全）；
   * - 兜底：document.readyState === 'complete' 后再宽限 5 秒；
   * - 极端兜底：30 秒。
   * 所有等待者共用一次轮询，就绪后统一执行。
   */
  let pageReady = false;
  let readyWaiters = [];
  let readyPollStarted = false;
  function onPageReady(fn) {
    if (pageReady) { fn(); return; }
    readyWaiters.push(fn);
    if (readyPollStarted) return;
    readyPollStarted = true;

    const videoReady = function () {
      const cards = document.querySelectorAll(
        '.right-container .video-page-card-small, .right-container .video-card, .right-container .bili-video-card'
      );
      if (cards.length > 0) return true;
      // 首页 / 热门页等无右侧栏卡片，退化为等待顶栏导航文本
      const bar = document.querySelector('.bili-header__bar');
      if (bar && (bar.textContent.indexOf('登录') !== -1 || bar.textContent.indexOf('首页') !== -1)) return true;
      return false;
    };

    const finishAll = function () {
      if (pageReady) return;
      pageReady = true;
      const fns = readyWaiters;
      readyWaiters = [];
      for (const f of fns) { try { f(); } catch (e) { /* 单点失败不影响其他等待者 */ } }
    };

    const start = Date.now();
    const poll = setInterval(function () {
      if (videoReady()) {
        clearInterval(poll);
        finishAll();
        return;
      }
      const elapsed = Date.now() - start;
      if ((document.readyState === 'complete' && elapsed > 5000) || elapsed > 30000) {
        clearInterval(poll);
        finishAll();
      }
    }, 100);
  }

  function applySettings() {
    injectCss();
    onPageReady(ensurePlaceholder);
    // 提醒开关 / 间隔变化后立即刷新状态卡文案
    if (document.getElementById(HOME_PANEL_ID)) fetchTodayStats();
    if (document.getElementById(VIDEO_STATS_ID)) fetchVideoStats();
  }

  function loadSettings() {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      if (chrome.runtime.lastError) return; // 保持默认设置
      settings = Object.assign({}, shared.DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
      applySettings();
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    applySettings();
  });

  /* ---------------- 初始化 ---------------- */

  // document_start：先以默认设置（全部开启）注入 CSS，避免推荐内容闪现
  injectCss();
  loadSettings();

  // 面板 DOM 注入统一等待页面完全加载（load 事件）后进行，避免干扰 B 站初始化
  onPageReady(function () {
    ensurePlaceholder();
    startObserver();
  });
})();
