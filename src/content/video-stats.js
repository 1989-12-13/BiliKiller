/**
 * BiliKiller 视频页观看统计面板：今日已看 + 每日目标进度 / 本次连续观看 /
 * 距下次提醒 / 今日目标状态（含连续达标天数）/ 与昨日对比 / 今日分区占比环形图。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → selectors.js → cleaner.js → bili-api.js → hot-placeholder.js
 *   → home-panel.js → video-stats.js → panels.js → tracker.js → reminder.js
 * - 经 globalThis.BK_CLEANER 读取实时设置与页面类型（videoStatsNeeded）；
 * - 经 globalThis.BK_BILI_API 拉取分区占比（fetchBiliTags）。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const cleaner = globalThis.BK_CLEANER;
  const biliApi = globalThis.BK_BILI_API;
  if (!shared || !cleaner || !biliApi) return;

  const VIDEO_STATS_ID = 'bk-video-stats';
  const VIDEO_STATS_STYLE_ID = 'bk-video-stats-style';

  const STATS_REFRESH_MS = 30000;

  const TAG_PALETTE = ['#5B6CFF', '#FB7299', '#22C55E', '#F59E0B', '#8B5CF6', '#14B8A6', '#EC4899', '#60A5FA', '#FBBF24', '#6EE7B7'];

  let videoStatsTimer = null;
  let videoStatsAnchorObserver = null;

  function videoStatsNeeded() {
    const settings = cleaner.getSettings();
    return settings.enabled && cleaner.getPage() === 'video';
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
      '#' + VIDEO_STATS_ID + ' .bk-vs-limits { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--bk-vs-border); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress { height: 7px; border-radius: 999px; overflow: hidden; background: rgba(154,161,180,.18); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-fill { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg,#22C55E,#5B6CFF); transition: width .4s ease; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-fill.over { background: linear-gradient(90deg,#F59E0B,#EF4444); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-label { margin-top: 7px; font-size: 12px; color: var(--bk-vs-faint); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-label b { color: var(--bk-vs-text); font-weight: 600; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-label.over { color: #EF4444; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-progress-label.over b { color: #EF4444; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-session { padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; font-size: 13px; font-weight: 600; color: var(--bk-vs-text); background: rgba(91,108,255,.07); border: 1px solid rgba(91,108,255,.14); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-session b { color: var(--bk-vs-primary); font-variant-numeric: tabular-nums; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-session-hint { display: block; margin-top: 3px; font-size: 11.5px; font-weight: 400; color: var(--bk-vs-faint); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-goal { padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; font-size: 13px; font-weight: 600; }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-goal.ok { color: #16A34A; background: rgba(34,197,94,.10); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-goal.over { color: #EF4444; background: rgba(239,68,68,.10); }',
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

  /**
   * 今日目标状态：返回 { text, cls } 或 null（无可比数据时隐藏）。
   * streak = 从昨天起连续「不超目标」的天数（今天不看，避免目标未定局就要求今天也达标）。
   */
  function goalStatus(seconds, limitSec, series) {
    let streak = 0;
    for (let i = series.length - 2; i >= 0; i--) {
      if ((Number(series[i].seconds) || 0) <= limitSec) streak++;
      else break;
    }
    if (seconds > limitSec) {
      return { text: '今日已超出目标 ' + Math.round((seconds - limitSec) / 60) + ' 分钟', cls: 'over' };
    }
    return { text: streak > 0 ? '今日在目标内 · 已连续 ' + streak + ' 天达成' : '今日在目标内', cls: 'ok' };
  }

  /* ---------------- 内容分区统计（B 站观看历史 API） ---------------- */

  /** 分区 Map -> 排序数组，取 Top 6，其余合并为「其他」 */
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

  /** 渲染分区时长占比扇形图（conic-gradient）与图例 */
  function renderVideoTags(respTags) {
    const box = document.getElementById(VIDEO_STATS_ID);
    if (!box) return;
    const donutEl = box.querySelector('[data-vs="donut"]');
    const legendEl = box.querySelector('[data-vs="legend"]');
    if (!donutEl || !legendEl) return;

    if (!respTags) {
      donutEl.innerHTML = '<div class="bk-vs-donut-empty">数据加载中…</div>';
      legendEl.textContent = '';
      return;
    }
    if (!respTags.ok) {
      const hint = respTags.code === -101
        ? '登录 B 站后<br>展示分区占比'
        : '分区数据<br>加载失败';
      donutEl.innerHTML = '<div class="bk-vs-donut-empty">' + hint + '</div>';
      legendEl.textContent = '';
      return;
    }
    const entries = summarizeTags(respTags.tags);
    const total = entries.reduce(function (a, e) { return a + e.sec; }, 0);
    if (!total) {
      donutEl.innerHTML = '<div class="bk-vs-donut-empty">观看后<br>展示分区占比</div>';
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
    const fillEl = box.querySelector('[data-vs="progress-fill"]');
    const labelEl = box.querySelector('[data-vs="progress-label"]');
    const goalEl = box.querySelector('[data-vs="goal"]');

    if (!respToday || !respToday.ok || !respStats || !respStats.ok) {
      durEl.textContent = '--';
      visitsEl.textContent = '--';
      remindEl.textContent = '--';
      cmpEl.textContent = '数据加载中…';
      cmpEl.className = 'bk-vs-compare flat';
      if (fillEl) { fillEl.style.width = '0%'; fillEl.className = 'bk-vs-progress-fill'; }
      if (labelEl) { labelEl.textContent = ''; labelEl.className = 'bk-vs-progress-label'; }
      if (goalEl) { goalEl.style.display = 'none'; }
      renderVideoTags(null);
      placeVideoStats(box);
      return;
    }

    const seconds = Number(respToday.today.seconds) || 0;
    const visits = Number(respToday.today.visits) || 0;
    const series = respStats.series || [];
    const settings = cleaner.getSettings();
    const limitSec = (Number(settings.dailyLimitMin) || 0) * 60;

    durEl.textContent = shared.formatDurationMinutes(seconds);
    visitsEl.textContent = visits + ' 次';

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
    } else {
      remindEl.textContent = shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';
    }

    // 每日目标进度条：unfilled=主色渐变；超过目标后切换为红色警示
    if (limitSec > 0) {
      const pct = Math.min(100, (seconds / limitSec) * 100);
      const over = seconds > limitSec;
      fillEl.style.width = pct.toFixed(1) + '%';
      fillEl.className = 'bk-vs-progress-fill' + (over ? ' over' : '');
      labelEl.className = 'bk-vs-progress-label' + (over ? ' over' : '');
      labelEl.innerHTML = over
        ? '已超每日目标 <b>' + Math.round((seconds - limitSec) / 60) + '</b> 分钟'
        : '每日目标 <b>' + settings.dailyLimitMin + '</b> 分钟 · 还剩 <b>' + Math.ceil((limitSec - seconds) / 60) + '</b> 分钟';
    } else {
      fillEl.style.width = '0%';
      fillEl.className = 'bk-vs-progress-fill';
      labelEl.textContent = '';
      labelEl.className = 'bk-vs-progress-label';
    }

    // 今日目标状态：达标 / 超目标 / 无目标（隐藏）
    if (limitSec > 0 && series.length >= 1) {
      const goal = goalStatus(seconds, limitSec, series);
      goalEl.style.display = '';
      goalEl.textContent = goal.text;
      goalEl.className = 'bk-vs-goal ' + goal.cls;
    } else {
      goalEl.style.display = 'none';
    }

    const yesterdaySec = series.length >= 2 ? Number(series[series.length - 2].seconds) || 0 : 0;
    cmpEl.textContent = compareText(seconds, yesterdaySec);
    cmpEl.className = 'bk-vs-compare ' + (seconds > yesterdaySec ? 'up' : (seconds < yesterdaySec && yesterdaySec > 0 ? 'down' : 'flat'));

    renderVideoTags(respTags);
    // 数据渲染完成后重估面板高度与视口，必要时切换紧凑模式 / 重定位
    placeVideoStats(box);
  }

  function fetchVideoStats() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: shared.MSG.GET_TODAY }, function (r1) {
      if (chrome.runtime.lastError) { renderVideoStats(null, null, null); return; }
      chrome.runtime.sendMessage({ type: shared.MSG.GET_STATS, days: 30 }, function (r2) {
        if (chrome.runtime.lastError) { renderVideoStats(r1, null, null); return; }
        biliApi.fetchBiliTags(1).then(function (r3) {
          renderVideoStats(r1, r2, r3);
        }, function () {
          renderVideoStats(r1, r2, null);
        });
      });
    });
  }

  function onVideoStatsVisibility() {
    if (document.visibilityState === 'visible') {
      fetchVideoStats();
    } else {
      // 切走页面立刻断开连续观看，不必等下一秒的 tick 才反应
      sessionAnchor = 0;
      const el = document.getElementById(VIDEO_STATS_ID);
      const sessionEl = el && el.querySelector('[data-vs="session"]');
      if (sessionEl) sessionEl.textContent = '--';
    }
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
        '  <div class="bk-vs-limits">' +
        '    <div class="bk-vs-progress"><span class="bk-vs-progress-fill" data-vs="progress-fill"></span></div>' +
        '    <div class="bk-vs-progress-label" data-vs="progress-label"></div>' +
        '  </div>' +
        '</div>' +
        '<div class="bk-vs-session">本次连续观看 <b data-vs="session">--</b><span class="bk-vs-session-hint">切走页面即重新计时</span></div>' +
        '<div class="bk-vs-grid">' +
        '  <div class="bk-vs-cell"><span>距下次提醒</span><b data-vs="reminder">--</b></div>' +
        '  <div class="bk-vs-cell"><span>今日访问</span><b data-vs="visits">--</b></div>' +
        '</div>' +
        '<div class="bk-vs-goal" data-vs="goal" style="display:none"></div>' +
        '<div class="bk-vs-compare flat" data-vs="compare">数据加载中…</div>' +
        '<div class="bk-vs-tags">' +
        '  <div class="bk-vs-tags-title">分区占比 · 今日</div>' +
        '  <div class="bk-vs-tags-body">' +
        '    <div class="bk-vs-donut" data-vs="donut"><div class="bk-vs-donut-empty">数据加载中…</div></div>' +
        '    <div class="bk-vs-legend" data-vs="legend"></div>' +
        '  </div>' +
        '</div>';

      // 挂到 document.body 末尾（安全容器，非 Vue 管理），后续 fixed 定位到右侧栏下方
      document.body.appendChild(el);

      stopVideoStatsTimer();
      fetchVideoStats();
      videoStatsTimer = setInterval(fetchVideoStats, STATS_REFRESH_MS);
      document.addEventListener('visibilitychange', onVideoStatsVisibility);
    }
    startSessionTimer();
    placeVideoStats(el);
  }

  /**
   * 校正视频统计面板位置：fixed 定位到 sticky 右侧栏（.right-container-inner）
   * 的视口下方。滚动时 sticky 元素相对视口位置不变，面板（fixed）亦不变，
   * 二者相对关系恒定，无需 scroll 监听。
   * 仅当右侧栏高度变化（懒加载相关推荐 / 展开收起）时由 ResizeObserver 重算。
   */
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

  /* ---------------- 本次连续观看(面板本地计时) ----------------
   "本次连续观看"= 页面保持可见且处于视频页的连续时长。
   - 用时间戳而非自增计数，避免 setInterval 漂移；
   - 切走页面（visibilityState !== visible）或离开视频页即视为会话断开，归零重计；
   - video→video 的 SPA 跳转不重建面板，计时自然延续；
   - removeVideoStats 时停表并归零。 */
  let sessionAnchor = 0;
  let sessionTimer = null;

  function updateSession() {
    const el = document.getElementById(VIDEO_STATS_ID);
    const sessionEl = el && el.querySelector('[data-vs="session"]');
    if (!sessionEl) return;
    if (document.visibilityState !== 'visible' || cleaner.getPage() !== 'video') {
      sessionAnchor = 0;
      sessionEl.textContent = '--';
      return;
    }
    if (!sessionAnchor) sessionAnchor = Date.now();
    sessionEl.textContent = shared.formatDuration(Math.floor((Date.now() - sessionAnchor) / 1000));
  }

  function startSessionTimer() {
    if (sessionTimer) return;
    updateSession();
    sessionTimer = setInterval(updateSession, 1000);
  }

  function stopSessionTimer() {
    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
    sessionAnchor = 0;
  }

  function stopVideoStatsTimer() {
    if (videoStatsTimer) {
      clearInterval(videoStatsTimer);
      videoStatsTimer = null;
    }
    document.removeEventListener('visibilitychange', onVideoStatsVisibility);
  }

  function removeVideoStats() {
    stopVideoStatsTimer();
    stopSessionTimer();
    if (videoStatsAnchorObserver) {
      videoStatsAnchorObserver.disconnect();
      videoStatsAnchorObserver = null;
    }
    const el = document.getElementById(VIDEO_STATS_ID);
    if (el) el.remove();
  }

  function refreshStats() {
    if (document.getElementById(VIDEO_STATS_ID)) fetchVideoStats();
  }

  globalThis.BK_VIDEO_STATS = Object.freeze({
    needed: videoStatsNeeded,
    ensure: mountVideoStats,
    remove: removeVideoStats,
    refreshStats: refreshStats,
  });
})();
