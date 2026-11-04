/**
 * BiliKiller 首页面板：今日用量 + 近 7 天迷你柱图 + 稍后再看 + 继续观看，
 * 垂直居中于顶栏以下的视口，含深色模式适配。
 * 首页的搜索由 B 站顶栏自带的搜索框承担，面板不再重复提供一个。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 经 globalThis.BK_CLEANER 读取实时设置（renderTodayStats）；
 * - 经 globalThis.BK_BILI_API 拉取稍后再看与观看历史；
 * - 近 7 天柱图来自 service worker 的 GET_STATS。
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
  const HISTORY_ID = 'bk-history';
  const CHART_ID = 'bk-home-chart';
  const WATCH_LATER_LIMIT = biliApi.WATCH_LATER_LIMIT;
  const HISTORY_LIMIT = biliApi.HISTORY_LIMIT;

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
      '  --bk-home-pink-weak: #FFB3CA;',
      '  --bk-home-pink-soft: #FFF3F6;',
      '  --bk-home-danger: #F85A54;',
      '  --bk-home-card: #FFFFFF;',
      '  --bk-home-line: #E3E5E7;',
      '  --bk-home-sub-bg: #F6F7F8;',
      '  --bk-home-sans: "PingFang SC","HarmonyOS_Regular","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;',
      '  position: relative; z-index: 50; box-sizing: border-box; width: 100%; min-height: calc(100vh - 156px); padding: 32px 24px; display: flex; align-items: center; justify-content: center; font-family: var(--bk-home-sans); line-height: 1.5; color: var(--bk-home-text); -webkit-font-smoothing: antialiased;',
      '}',
      'html.dark #' + HOME_PANEL_ID + ', html.bili_dark #' + HOME_PANEL_ID + ' {',
      '  --bk-home-text: #E7E9EB;',
      '  --bk-home-faint: #757A81;',
      '  --bk-home-pink: #D44E7D;',
      '  --bk-home-pink-weak: #76304B;',
      '  --bk-home-pink-soft: #2F1A22;',
      '  --bk-home-danger: #FA857F;',
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
      '#' + HOME_PANEL_ID + ' .bk-home-chart { display: flex; align-items: center; gap: 10px; }',
      '#' + HOME_PANEL_ID + ' .bk-chart-label { font-size: 11px; color: var(--bk-home-faint); }',
      '#' + HOME_PANEL_ID + ' .bk-chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 30px; }',
      '#' + HOME_PANEL_ID + ' .bk-chart-bar { display: block; width: 6px; border-radius: 2px 2px 0 0; background: var(--bk-home-pink-weak); }',
      '#' + HOME_PANEL_ID + ' .bk-chart-bar.today { background: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' #' + WATCH_LATER_ID + ', #' + HOME_PANEL_ID + ' #' + HISTORY_ID + ' { margin-top: 18px; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; font-size: 17px; font-weight: 600; color: var(--bk-home-text); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head::before { content: ""; width: 3px; height: 16px; border-radius: 2px; background: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-head .bk-wl-count { font-size: 11px; font-weight: 500; padding: 1px 6px; border-radius: 4px; color: var(--bk-home-pink); background: var(--bk-home-pink-soft); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }',
      '@media (max-width: 900px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
      '@media (max-width: 640px) { #' + HOME_PANEL_ID + ' .bk-wl-grid { grid-template-columns: minmax(0, 1fr); } }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card { display: block; min-width: 0; text-decoration: none; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card:hover .bk-wl-title { color: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-info { display: block; min-width: 0; padding: 8px 2px 0; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: var(--bk-home-sub-bg); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-dur { position: absolute; right: 6px; bottom: 8px; padding: 0 5px; border-radius: 4px; background: rgba(0,0,0,.55); color: #FFFFFF; font-size: 11px; font-weight: 500; line-height: 18px; font-variant-numeric: tabular-nums; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(0,0,0,.32); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-progress i { display: block; height: 100%; background: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-card:hover .bk-wl-actions, #' + HOME_PANEL_ID + ' .bk-wl-actions:focus-within { opacity: 1; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-actions button { width: 22px; height: 22px; padding: 0; display: grid; place-items: center; border: none; border-radius: 50%; background: rgba(0,0,0,.55); color: #FFFFFF; font-family: inherit; font-size: 14px; line-height: 1; cursor: pointer; transition: background .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-add:hover { background: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-del:hover { background: var(--bk-home-danger); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-actions button:disabled { opacity: .45; cursor: default; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-more-wrap { margin-top: 14px; text-align: center; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-more { height: 32px; padding: 0 18px; border: 1px solid var(--bk-home-line); border-radius: 6px; background: var(--bk-home-card); color: var(--bk-home-text); font-family: inherit; font-size: 12.5px; cursor: pointer; transition: background .15s, border-color .15s, color .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-more:hover { border-color: var(--bk-home-pink); color: var(--bk-home-pink); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-error { margin-top: 10px; font-size: 12px; color: var(--bk-home-danger); }',
      '#' + HOME_PANEL_ID + ' .bk-wl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; min-height: 3em; margin: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--bk-home-text); transition: color .15s; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-meta { display: block; margin-top: 3px; font-size: 12px; color: var(--bk-home-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + HOME_PANEL_ID + ' .bk-wl-status { padding: 28px 0; text-align: center; font-size: 13px; color: var(--bk-home-faint); }',
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
        '    <div class="bk-home-chart">' +
        '      <span class="bk-chart-label">近 7 天</span>' +
        '      <span class="bk-chart-bars" id="' + CHART_ID + '"></span>' +
        '    </div>' +
        '  </div>' +
        '  <div id="' + WATCH_LATER_ID + '"></div>' +
        '  <div id="' + HISTORY_ID + '"></div>' +
        '</div>';
    }
    // 先把面板插入 DOM，再启动定时器 / 加载数据——
    // 各 loader 依赖对应容器已在文档中，否则 getElementById 返回 null 直接跳过
    placeHomePanel(el);
    if (el.getAttribute('data-bk-inited') !== '1') {
      el.setAttribute('data-bk-inited', '1');
      bindCardActions(WATCH_LATER_ID, 'watchlater');
      bindCardActions(HISTORY_ID, 'history');
      startStatsTimer();
      loadWatchLater();
      loadHistory();
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

  /** B 站部分封面仍返回 http:// 地址，页面上会被当作混合内容拦掉，统一成 https */
  function toHttps(url) {
    return typeof url === 'string' && url.indexOf('http://') === 0 ? 'https://' + url.slice(7) : url;
  }

  /** 封面右上角的按钮：稍后再看是真删除，继续观看只做本地隐藏 */
  function removeButton(attr, value, label) {
    if (!value) return '';
    return '<button class="bk-wl-del" type="button" ' + attr + '="' + shared.escapeHtml(String(value)) +
      '" title="' + label + '" aria-label="' + label + '">×</button>';
  }

  /** 「加入稍后再看」按钮，挂在继续观看卡片上 */
  function addButton(bvid) {
    if (!bvid) return '';
    return '<button class="bk-wl-add" type="button" data-bvid="' + shared.escapeHtml(bvid) +
      '" title="加入稍后再看" aria-label="加入稍后再看">+</button>';
  }

  /** 封面右上角的按钮组：悬停或聚焦时出现 */
  function actionsWrap(buttons) {
    const html = buttons.filter(Boolean).join('');
    return html ? '<span class="bk-wl-actions">' + html + '</span>' : '';
  }

  /** 删除失败提示：挂在区块底部，4 秒后自动消失 */
  function showSectionError(box, text) {
    let el = box.querySelector('.bk-wl-error');
    if (!el) {
      el = document.createElement('div');
      el.className = 'bk-wl-error';
      box.appendChild(el);
    }
    el.textContent = text;
    if (el.__hideTimer) clearTimeout(el.__hideTimer);
    el.__hideTimer = setTimeout(function () { el.remove(); }, 4000);
  }

  /** 点击封面上的 ×：稍后再看走真删除，继续观看只写本地隐藏记录，都不再二次确认 */
  function requestDelete(box, kind, btn) {
    const card = btn.closest('.bk-wl-card');
    const id = kind === 'history' ? btn.getAttribute('data-kid') : btn.getAttribute('data-aid');
    if (!card || !id) return;

    if (kind === 'history') {
      hideHistoryItem(id);
      return;
    }
    removeWatchLaterItem(id, box, btn);
  }

  /** 「显示全部 / 收起」：只影响本区块的展开状态 */
  function toggleWatchLaterMore() {
    watchLaterExpanded = !watchLaterExpanded;
    renderWatchLaterSection();
  }

  function bindCardActions(boxId, kind) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.addEventListener('click', function (e) {
      const action = e.target && e.target.closest
        ? e.target.closest('.bk-wl-del, .bk-wl-add, .bk-wl-more')
        : null;
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.classList.contains('bk-wl-more')) {
        toggleWatchLaterMore();
        return;
      }
      if (action.classList.contains('bk-wl-add')) {
        requestAddToLater(action);
        return;
      }
      requestDelete(box, kind, action);
    });
  }

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
   * 默认展示前 8 条，条目更多时底部给出「显示全部 / 收起」。
   */
  let watchLaterItems = [];
  let watchLaterExpanded = false;

  function renderWatchLaterSection() {
    const box = document.getElementById(WATCH_LATER_ID);
    if (!box) return;
    if (!watchLaterItems.length) {
      renderWatchLaterStatus(box, 'empty');
      return;
    }
    const items = watchLaterExpanded ? watchLaterItems : watchLaterItems.slice(0, WATCH_LATER_LIMIT);

    const cards = items.map(function (v) {
      const title = shared.escapeHtml(v.title || '未命名视频');
      const author = shared.escapeHtml(v.author && v.author.name ? v.author.name : '');
      const bvid = shared.escapeHtml(v.bvid || '');
      const href = bvid ? 'https://www.bilibili.com/video/' + bvid : 'https://www.bilibili.com/';
      const pic = shared.escapeHtml(toHttps(v.pic || ''));
      const dur = v.duration ? '<span class="bk-wl-dur">' + shared.formatCompactDuration(v.duration) + '</span>' : '';
      const aid = Number(v.aid) || 0;
      return '<a class="bk-wl-card" href="' + href + '" target="_blank" rel="noopener">' +
        '  <span class="bk-wl-cover">' +
        '    <img loading="lazy" src="' + pic + '" alt="' + title + '" onerror="this.style.display=\'none\'" />' +
        dur + actionsWrap([removeButton('data-aid', aid, '从稍后再看移除')]) +
        '  </span>' +
        '  <span class="bk-wl-info">' +
        '    <span class="bk-wl-title">' + title + '</span>' +
        '    <span class="bk-wl-meta">' + author + '</span>' +
        '  </span>' +
        '</a>';
    }).join('');

    const more = watchLaterItems.length > WATCH_LATER_LIMIT
      ? '<div class="bk-wl-more-wrap"><button class="bk-wl-more" type="button">' +
        (watchLaterExpanded ? '收起' : '显示全部 ' + watchLaterItems.length + ' 个') +
        '</button></div>'
      : '';

    box.innerHTML =
      '<div class="bk-wl-head">稍后再看<span class="bk-wl-count">' + items.length + '</span></div>' +
      '<div class="bk-wl-grid">' + cards + '</div>' + more;
  }

  function loadWatchLater() {
    const box = document.getElementById(WATCH_LATER_ID);
    if (!box) return;
    biliApi.fetchWatchLater()
      .then(function (j) {
        if (!j || j.code !== 0) {
          renderWatchLaterStatus(box, j && j.code === -101 ? 'login' : 'error');
          return;
        }
        watchLaterItems = (j.data && j.data.list) || [];
        renderWatchLaterSection();
      })
      .catch(function () { renderWatchLaterStatus(box, 'error'); });
  }

  /** 从稍后再看真实移除；成功后从本地列表删掉，后面的条目自动补位 */
  function removeWatchLaterItem(aid, box, btn) {
    btn.disabled = true;
    biliApi.removeWatchLater(aid).then(function (res) {
      if (!res || res.code !== 0) {
        btn.disabled = false;
        showSectionError(box, res && res.code === -111 ? '登录状态已失效，请刷新页面后重试' : '移除失败，请稍后重试');
        return;
      }
      const target = Number(aid);
      watchLaterItems = watchLaterItems.filter(function (v) { return Number(v.aid) !== target; });
      renderWatchLaterSection();
    }).catch(function () {
      btn.disabled = false;
      showSectionError(box, '移除失败，请检查网络后重试');
    });
  }

  /** 加入稍后再看：成功后刷新队列，按钮短暂显示 ✓ 作为反馈 */
  function requestAddToLater(btn) {
    const bvid = btn.getAttribute('data-bvid');
    if (!bvid) return;
    const box = document.getElementById(HISTORY_ID);
    btn.disabled = true;
    biliApi.addWatchLater(bvid).then(function (res) {
      if (res && res.code === 0) {
        btn.textContent = '✓';
        setTimeout(function () {
          btn.textContent = '+';
          btn.disabled = false;
        }, 1500);
        loadWatchLater();
        return;
      }
      btn.disabled = false;
      let message = '加入失败，请稍后重试';
      if (res && res.code === -111) message = '登录状态已失效，请刷新页面后重试';
      else if (res && res.code === 90001) message = '稍后再看已满（上限 100 个）';
      else if (res && res.code === 90003) message = '该视频已失效';
      showSectionError(box, message);
    }).catch(function () {
      btn.disabled = false;
      showSectionError(box, '加入失败，请检查网络后重试');
    });
  }

  /* ---------------- 继续观看（本人观看历史，非推荐） ---------------- */

  function renderHistoryStatus(box, status) {
    const hint = {
      login: '登录后可查看观看记录',
      empty: '暂无观看记录',
      error: '观看记录加载失败，请刷新重试',
    }[status] || '';
    box.innerHTML =
      '<div class="bk-wl-head">继续观看</div>' +
      '<div class="bk-wl-status" data-status="' + status + '">' + hint + '</div>';
  }

  /** 从历史条目里取展示字段：接口字段有两种写法，逐级兜底 */
  function historyHref(v) {
    const bvid = (v.history && v.history.bvid) || v.bvid || '';
    if (bvid) return 'https://www.bilibili.com/video/' + bvid;
    return typeof v.uri === 'string' && v.uri.indexOf('https://www.bilibili.com/') === 0 ? v.uri : '';
  }

  const HIDDEN_KEY = 'bk-hidden-history'; // 本地隐藏记录：kid -> 时间戳
  const HIDDEN_MAX = 200;
  const HIDDEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  let historyItems = [];
  let historyCursor = null;
  let hiddenHistory = new Set();
  let historyState = 'idle'; // idle | loading | ready | login | error

  /** 从历史条目拼 kid：archive_avid / pgc_ssid / live_roomid */
  function historyKid(v) {
    const business = (v.history && v.history.business) || 'archive';
    const id = Number(v.kid) || Number(v.history && v.history.oid) || 0;
    return id > 0 ? business + '_' + id : '';
  }

  /** 读本地隐藏记录：30 天后自动过期，避免永久藏住同一批视频 */
  function readHiddenHistory() {
    return shared.sessionGet(HIDDEN_KEY).then(function (raw) {
      let list = [];
      try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
      const cutoff = Date.now() - HIDDEN_TTL_MS;
      const set = new Set();
      for (const item of list) {
        if (item && typeof item.kid === 'string' && Number(item.at) > cutoff) set.add(item.kid);
      }
      return set;
    }).catch(function () { return new Set(); });
  }

  function persistHiddenHistory(kid) {
    return shared.sessionGet(HIDDEN_KEY).then(function (raw) {
      let list = [];
      try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
      list.push({ kid: kid, at: Date.now() });
      const cutoff = Date.now() - HIDDEN_TTL_MS;
      list = list.filter(function (item) { return item && item.kid && Number(item.at) > cutoff; });
      if (list.length > HIDDEN_MAX) list = list.slice(-HIDDEN_MAX);
      return shared.sessionSet(HIDDEN_KEY, JSON.stringify(list));
    });
  }

  /** 当前可见的 8 条：过滤掉本地隐藏的条目 */
  function visibleHistory() {
    return historyItems.filter(function (v) { return !hiddenHistory.has(historyKid(v)); }).slice(0, HISTORY_LIMIT);
  }

  /** 继续观看卡片：与稍后再看同款，封面底部多一条观看进度 */
  function renderHistorySection() {
    const box = document.getElementById(HISTORY_ID);
    if (!box) return;
    if (historyState === 'login' || historyState === 'error') {
      renderHistoryStatus(box, historyState);
      return;
    }
    const items = visibleHistory();
    if (!items.length) {
      renderHistoryStatus(box, 'empty');
      return;
    }

    const cards = items.map(function (v) {
      const href = historyHref(v);
      if (!href) return '';
      const title = shared.escapeHtml(v.title || '未命名视频');
      const author = shared.escapeHtml(v.author_name || '');
      const pic = shared.escapeHtml(toHttps(v.cover || ''));
      const duration = Number(v.duration) || 0;
      const progress = Number(v.progress) || 0;
      const finished = Number(v.is_finish) === 1;
      const percent = !finished && duration > 0 && progress > 0
        ? Math.min(100, Math.round((progress / duration) * 100))
        : 0;
      const dur = duration ? '<span class="bk-wl-dur">' + shared.formatCompactDuration(duration) + '</span>' : '';
      const bar = percent > 0 ? '<span class="bk-wl-progress"><i style="width:' + percent + '%"></i></span>' : '';
      const meta = author + (percent > 0 ? (author ? ' · ' : '') + '已看 ' + percent + '%' : '');
      const bvid = (v.history && v.history.bvid) || v.bvid || '';
      return '<a class="bk-wl-card" href="' + shared.escapeHtml(href) + '" target="_blank" rel="noopener">' +
        '  <span class="bk-wl-cover">' +
        '    <img loading="lazy" src="' + pic + '" alt="' + title + '" onerror="this.style.display=\'none\'" />' +
        dur + bar + actionsWrap([
          addButton(bvid),
          removeButton('data-kid', historyKid(v), '从首页移除（不影响观看记录）'),
        ]) +
        '  </span>' +
        '  <span class="bk-wl-info">' +
        '    <span class="bk-wl-title">' + title + '</span>' +
        '    <span class="bk-wl-meta">' + meta + '</span>' +
        '  </span>' +
        '</a>';
    }).filter(Boolean).join('');

    box.innerHTML =
      '<div class="bk-wl-head">继续观看<span class="bk-wl-count">' + items.length + '</span></div>' +
      '<div class="bk-wl-grid">' + cards + '</div>';
  }

  /** 拉一页历史；返回 { ok, items, cursor }，失败时带接口 code */
  function fetchHistoryPage(cursor) {
    return biliApi.fetchHistory(cursor).then(function (j) {
      if (!j || j.code !== 0) return { ok: false, code: j && j.code };
      const list = (j.data && j.data.list) || [];
      const c = (j.data && j.data.cursor) || null;
      const next = c && (c.max || c.view_at) ? { max: c.max, view_at: c.view_at, business: c.business } : null;
      return { ok: true, items: list, cursor: next };
    }).catch(function () { return { ok: false, code: null }; });
  }

  /** 继续翻页，直到可见条目够 8 条或没有更多 */
  function fillHistory() {
    if (!historyCursor) return Promise.resolve();
    return fetchHistoryPage(historyCursor).then(function (res) {
      if (!res.ok) return;
      if (!res.items.length) { historyCursor = null; return; }
      historyItems = historyItems.concat(res.items);
      historyCursor = res.cursor;
      if (visibleHistory().length < HISTORY_LIMIT && historyCursor) return fillHistory();
    });
  }

  function loadHistory() {
    historyState = 'loading';
    historyItems = [];
    historyCursor = null;
    readHiddenHistory().then(function (set) {
      hiddenHistory = set;
      return fetchHistoryPage(null);
    }).then(function (res) {
      if (!res.ok) {
        historyState = res.code === -101 ? 'login' : 'error';
        renderHistorySection();
        return;
      }
      historyState = 'ready';
      historyItems = res.items;
      historyCursor = res.cursor;
      return fillHistory().then(renderHistorySection);
    }).catch(function () {
      historyState = 'error';
      renderHistorySection();
    });
  }

  /** 本地隐藏一条：写记录并重渲染（后面的条目自动补位），可见不足 8 条时继续翻页 */
  function hideHistoryItem(kid) {
    persistHiddenHistory(kid).then(function () {
      hiddenHistory.add(kid);
      renderHistorySection();
      if (visibleHistory().length < HISTORY_LIMIT) fillHistory().then(renderHistorySection);
    });
  }

  /* ---------------- 近 7 天迷你柱图 ---------------- */

  function renderChart(series) {
    const box = document.getElementById(CHART_ID);
    if (!box || !series || !series.length) return;
    const max = Math.max(60, ...series.map(function (d) { return Number(d.seconds) || 0; }));
    box.innerHTML = series.map(function (d, i) {
      const sec = Number(d.seconds) || 0;
      const h = sec > 0 ? Math.max(3, Math.round((sec / max) * 30)) : 2;
      const today = i === series.length - 1;
      const tip = shared.escapeHtml(d.date.slice(5) + '：' + Math.round(sec / 60) + ' 分钟');
      return '<span class="bk-chart-bar' + (today ? ' today' : '') + '" style="height:' + h + 'px" title="' + tip + '"></span>';
    }).join('');
  }

  function fetchChart() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: shared.MSG.GET_STATS, days: 7 }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok) renderChart(resp.series);
    });
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
    if (document.visibilityState === 'visible') {
      fetchTodayStats();
      fetchChart();
    }
  }

  function startStatsTimer() {
    stopStatsTimer();
    fetchTodayStats();
    fetchChart();
    statsTimer = setInterval(function () {
      fetchTodayStats();
      fetchChart();
    }, STATS_REFRESH_MS);
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
