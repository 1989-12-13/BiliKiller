/**
 * BiliKiller 首页面板：一行今日用量 + 稍后再看，垂直居中于顶栏以下的视口，含深色模式适配。
 * 首页的搜索由 B 站顶栏自带的搜索框承担，面板不再重复提供一个。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 经 globalThis.BK_CLEANER 读取实时设置（renderTodayStats）；
 * - 经 globalThis.BK_BILI_API 拉取稍后再看。
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
   * 首页面板样式：沿用 B 站自身的设计令牌（#E3E5E7 描边、8px 圆角、
   * 哔哩哔哩粉 #FB7299），亮色为默认值，并用 html.dark / html.bili_dark
   * 覆盖块跟随 B 站深色开关。变量作用域限定在 #bk-home-panel 内，
   * 不触碰 B 站其余界面。
   *
   * 面板高度取「视口减去 B 站大号顶栏（约 156px）」，内容在其中垂直居中，
   * 让首页被清空后的留白成为上下对称的版面边距，而不是页面底部的一块空洞。
   */
  function injectHomeStyle() {
    if (document.getElementById(HOME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HOME_STYLE_ID;
    const rules = [
      '#' + HOME_PANEL_ID + ' {',
      '  --bk-home-text: #18191C;',
      '  --bk-home-faint: #9499A0;',
      '  --bk-home-pink: #FB7299;',
      '  --bk-home-pink-soft: #FFF3F6;',
      '  --bk-home-card: #FFFFFF;',
      '  --bk-home-line: #E3E5E7;',
      '  --bk-home-sub-bg: #F6F7F8;',
      '  --bk-home-sans: "PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;',
      '  position: relative; z-index: 50; box-sizing: border-box; width: 100%; min-height: calc(100vh - 156px); padding: 40px 24px; display: flex; align-items: center; justify-content: center; font-family: var(--bk-home-sans); line-height: 1.5; color: var(--bk-home-text); -webkit-font-smoothing: antialiased;',
      '}',
      'html.dark #' + HOME_PANEL_ID + ', html.bili_dark #' + HOME_PANEL_ID + ' {',
      '  --bk-home-text: #E7E9EB;',
      '  --bk-home-faint: #757A81;',
      '  --bk-home-pink: #D44E7D;',
      '  --bk-home-pink-soft: #2F1A22;',
      '  --bk-home-card: #202123;',
      '  --bk-home-line: #2F3134;',
      '  --bk-home-sub-bg: #1A1B1D;',
      '}',
      '#' + HOME_PANEL_ID + ' .bk-home-inner { box-sizing: border-box; width: 100%; max-width: 1180px; margin: 0 auto; padding: 18px 24px 24px; background: var(--bk-home-card); border: 1px solid var(--bk-home-line); border-radius: 8px; }',
      '#' + HOME_PANEL_ID + ' .bk-home-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--bk-home-line); }',
      '#' + HOME_PANEL_ID + ' .bk-home-stats { display: flex; align-items: baseline; gap: 32px; }',
      '#' + HOME_PANEL_ID + ' .bk-stat { display: flex; align-items: baseline; gap: 8px; }',
      '#' + HOME_PANEL_ID + ' .bk-stat > span { font-size: 12px; color: var(--bk-home-faint); }',
      '#' + HOME_PANEL_ID + ' .bk-stat > b { font-size: 20px; font-weight: 600; line-height: 1.2; color: var(--bk-home-text); font-variant-numeric: tabular-nums; }',
      '#' + HOME_PANEL_ID + ' .bk-stat > b.is-off { font-size: 13px; font-weight: 400; color: var(--bk-home-faint); }',
      '#' + HOME_PANEL_ID + ' .bk-home-stats .bk-stat:first-child > b { color: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head { display: flex; align-items: center; gap: 8px; margin: 18px 0 14px; font-size: 17px; font-weight: 600; color: var(--bk-home-text); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head::before { content: ""; width: 3px; height: 16px; border-radius: 2px; background: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head .bk-wl-count { font-size: 11px; font-weight: 500; padding: 1px 6px; border-radius: 4px; color: var(--bk-home-pink); background: var(--bk-home-pink-soft); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }',
      '@media (max-width: 900px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: repeat(2, 1fr); } }',
      '@media (max-width: 640px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: 1fr; } }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card { display: block; text-decoration: none; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card:hover .bk-wl-title { color: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: var(--bk-home-sub-bg); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-dur { position: absolute; right: 6px; bottom: 6px; padding: 0 5px; border-radius: 4px; background: rgba(0,0,0,.55); color: #FFFFFF; font-size: 11px; font-weight: 500; line-height: 18px; font-variant-numeric: tabular-nums; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-info { display: block; padding: 8px 2px 0; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--bk-home-text); transition: color .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-meta { display: block; margin-top: 3px; font-size: 12px; color: var(--bk-home-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-status { padding: 64px 0; text-align: center; font-size: 13px; color: var(--bk-home-faint); }',
    ];
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
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
        '<div class="bk-home-inner">' +
        '  <div class="bk-home-head">' +
        '    <div class="bk-home-stats">' +
        '      <div class="bk-stat"><span>今日已看</span><b data-value="duration">--</b></div>' +
        '      <div class="bk-stat"><span>距下次提醒</span><b data-value="reminder">--</b></div>' +
        '    </div>' +
        '  </div>' +
        '  <div id="bk-watch-later"></div>' +
        '</div>';
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

  /** 稍后再看状态降级：login=未登录 / empty=空列表 / error=加载失败 */
  function renderWatchLaterStatus(box, status) {
    const hint = {
      login: '登录后可查看「稍后再看」',
      empty: '「稍后再看」暂无内容',
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

  /* ---------------- 今日用量 ---------------- */

  let statsTimer = null;

  /** 渲染今日用量：仅更新文本节点，不重建 DOM；后台不可用时降级为占位符 */
  function renderTodayStats(resp) {
    const box = document.getElementById(HOME_PANEL_ID);
    if (!box) return;
    const durationEl = box.querySelector('[data-value="duration"]');
    const remindEl = box.querySelector('[data-value="reminder"]');

    if (!resp || !resp.ok) {
      durationEl.textContent = '--';
      remindEl.textContent = '--';
      remindEl.classList.add('is-off');
      return;
    }

    const seconds = Number(resp.today.seconds) || 0;
    const settings = cleaner.getSettings();

    durationEl.textContent = shared.formatDurationMinutes(seconds);

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
      remindEl.classList.add('is-off');
    } else {
      remindEl.textContent = shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';
      remindEl.classList.remove('is-off');
    }
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
