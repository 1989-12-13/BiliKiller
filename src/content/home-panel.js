/**
 * BiliKiller 首页面板：搜索引导 + 今日状态卡 + 稍后再看。
 * 含问候语（登录昵称 / 时段）、每日一句、深色模式适配。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 经 globalThis.BK_CLEANER 读取实时设置（renderTodayStats）；
 * - 经 globalThis.BK_BILI_API 拉取登录昵称与稍后再看。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const cleaner = globalThis.BK_CLEANER;
  const biliApi = globalThis.BK_BILI_API;
  if (!shared || !cleaner || !biliApi) return;

  const HOME_STYLE_ID = 'bk-home-style';
  const HOME_PANEL_ID = 'bk-home-panel';
  const WATCH_LATER_ID = 'bk-watch-later';
  const WATCH_LATER_LIMIT = biliApi.WATCH_LATER_LIMIT;

  const STATS_REFRESH_MS = 30000;

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

  /** 更新首页问候语：登录后显示「早上好，昵称」等，未登录/失败保持通用时段问候 */
  function applyGreeting() {
    const el = document.querySelector('#' + HOME_PANEL_ID + ' [data-greeting]');
    if (!el) return;
    biliApi.fetchBiliUser().then(function (user) {
      const base = greetingText();
      el.textContent = user.ok ? base + '，' + user.name : base;
    });
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
      applyGreeting();
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

  /**
   * 稍后再看卡片渲染：B 站 API 返回的 title / author / pic / bvid 均来自用户上传内容，
   * 视为不可信文本，统一经 escapeHtml 转义后再拼入 HTML，杜绝注入执行。
   */
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
      const title = shared.escapeHtml(v.title || '未命名视频');
      const author = shared.escapeHtml(v.author && v.author.name ? v.author.name : '');
      const bvid = shared.escapeHtml(v.bvid || '');
      const href = bvid ? 'https://www.bilibili.com/video/' + bvid : 'https://www.bilibili.com/';
      const pic = shared.escapeHtml(v.pic || '');
      const dur = v.duration ? '<span class="bk-wl-dur">' + shared.formatCompactDuration(v.duration) + '</span>' : '';
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
    biliApi.fetchWatchLater()
      .then(function (j) { renderWatchLater(box, j); })
      .catch(function () { renderWatchLaterStatus(box, 'error'); });
  }

  /* ---------------- 今日状态卡 ---------------- */

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
    const settings = cleaner.getSettings();

    durationEl.textContent = shared.formatDurationMinutes(seconds);

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
      remindEl.classList.add('is-off');
    } else {
      remindEl.textContent = shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';
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

  function refreshStats() {
    if (document.getElementById(HOME_PANEL_ID)) fetchTodayStats();
  }

  globalThis.BK_HOME_PANEL = Object.freeze({
    ensure: mountHomePanel,
    remove: removeHomePanel,
    refreshStats: refreshStats,
  });
})();
