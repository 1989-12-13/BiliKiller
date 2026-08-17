/**
 * BiliKiller 视频页观看统计面板：今日已看 / 本次连续观看 / 距下次提醒 / 今日访问。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 经 globalThis.BK_CLEANER 读取实时设置与页面类型（videoStatsNeeded）。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const cleaner = globalThis.BK_CLEANER;
  const player = globalThis.BK_PLAYER;
  if (!shared || !cleaner || !player) return;

  const VIDEO_STATS_ID = 'bk-video-stats';
  const VIDEO_STATS_STYLE_ID = 'bk-video-stats-style';
  const VIDEO_STATS_PAD_ID = 'bk-video-stats-pad';
  const PANEL_GAP = 16;

  const STATS_REFRESH_MS = 30000;

  let videoStatsTimer = null;
  let lastPad = 0;

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
      '  box-sizing: border-box; margin: 0; padding: 20px; border-radius: 18px; background: var(--bk-vs-bg); border: 1px solid var(--bk-vs-border); box-shadow: var(--bk-vs-shadow); font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;',
      '  position: fixed; z-index: 10; top: 0; left: 0; will-change: transform;',
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
      '#' + VIDEO_STATS_ID + ' .bk-vs-session { padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; font-size: 13px; font-weight: 600; color: var(--bk-vs-text); background: rgba(91,108,255,.07); border: 1px solid rgba(91,108,255,.14); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-session b { color: var(--bk-vs-primary); font-variant-numeric: tabular-nums; }',
    ];
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function setAnchorPadding(px) {
    let padStyle = document.getElementById(VIDEO_STATS_PAD_ID);
    if (!padStyle) {
      padStyle = document.createElement('style');
      padStyle.id = VIDEO_STATS_PAD_ID;
      (document.head || document.documentElement).appendChild(padStyle);
    }
    const css = '.right-container-inner { padding-top: ' + px + 'px !important; }';
    if (padStyle.textContent !== css) {
      padStyle.textContent = css;
      lastPad = px;
    }
  }

  function removeAnchorPadding() {
    const padStyle = document.getElementById(VIDEO_STATS_PAD_ID);
    if (padStyle) padStyle.remove();
    lastPad = 0;
  }

  function renderVideoStats(respToday) {
    const box = document.getElementById(VIDEO_STATS_ID);
    if (!box) return;
    const durEl = box.querySelector('[data-vs="duration"]');
    const visitsEl = box.querySelector('[data-vs="visits"]');
    const remindEl = box.querySelector('[data-vs="reminder"]');

    if (!respToday || !respToday.ok) {
      durEl.textContent = '--';
      visitsEl.textContent = '--';
      remindEl.textContent = '--';
      placeVideoStats(box);
      return;
    }

    const seconds = Number(respToday.today.seconds) || 0;
    const visits = Number(respToday.today.visits) || 0;
    const settings = cleaner.getSettings();

    durEl.textContent = shared.formatDurationMinutes(seconds);
    visitsEl.textContent = visits + ' 次';

    if (!settings.enabled || !settings.reminderEnabled) {
      remindEl.textContent = '已关闭';
    } else {
      remindEl.textContent = shared.nextReminderMinutes(seconds, settings.reminderIntervalMin) + ' 分钟';
    }

    placeVideoStats(box);
  }

  function fetchVideoStats() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: shared.MSG.GET_TODAY }, function (resp) {
      if (chrome.runtime.lastError) { renderVideoStats(null); return; }
      renderVideoStats(resp);
    });
  }

  function onVideoStatsVisibility() {
    if (document.visibilityState === 'visible') {
      fetchVideoStats();
    }
  }

  /**
   * 面板挂在 body 末尾（非 Vue 容器），position:fixed 定位。
   * 核心：scroll 监听中始终设置 top = rci.getBoundingClientRect().top（视口坐标）。
   * - rci 未 sticky 时：r.top 随滚动连续变化，面板 fixed 平滑跟随；
   * - rci sticky 生效时：r.top 恒定，面板视口位置恒定。
   * fixed 不随文档滚动，只由 style 决定位置，滚动同步无跳动。
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
        '<div class="bk-vs-session">本次连续观看 <b data-vs="session">--</b></div>' +
        '<div class="bk-vs-grid">' +
        '  <div class="bk-vs-cell"><span>距下次提醒</span><b data-vs="reminder">--</b></div>' +
        '  <div class="bk-vs-cell"><span>今日访问</span><b data-vs="visits">--</b></div>' +
        '</div>';

      document.body.appendChild(el);

      stopVideoStatsTimer();
      fetchVideoStats();
      videoStatsTimer = setInterval(fetchVideoStats, STATS_REFRESH_MS);
      document.addEventListener('visibilitychange', onVideoStatsVisibility);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }
    placeVideoStats(el);
    startSessionTimer();
  }

  function onScroll() {
    // 直接同步更新，不等 rAF：scroll 事件在帧渲染前触发，
    // 同一帧内直接改 transform 会被本帧渲染，无额外一帧延迟。
    const el = document.getElementById(VIDEO_STATS_ID);
    if (el) updatePanelPosition(el);
  }

  /** 只更新面板视口位置（transform 合成层动画，不触发 reflow） */
  function updatePanelPosition(el) {
    const anchor = document.querySelector('.right-container-inner') || document.querySelector('.right-container');
    if (!anchor || !anchor.parentElement) {
      el.style.display = 'none';
      return;
    }
    const r = anchor.getBoundingClientRect();
    const left = Math.round(r.left);
    const width = Math.round(r.width);
    const top = Math.round(r.top);

    el.style.width = width + 'px';
    el.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
    el.style.display = 'block';
  }

  /** 完整校正：定位 + 测量面板高度 + 更新 padding */
  function placeVideoStats(el) {
    updatePanelPosition(el);

    const anchor = document.querySelector('.right-container-inner') || document.querySelector('.right-container');
    if (!anchor || !anchor.parentElement) {
      removeAnchorPadding();
      return;
    }

    // 测量面板高度（仅数据渲染后调用，滚动时走 updatePanelPosition）
    el.style.visibility = 'hidden';
    const panelH = el.getBoundingClientRect().height;
    el.style.visibility = '';

    const pad = Math.round(panelH + PANEL_GAP);
    if (pad !== lastPad) setAnchorPadding(pad);
  }

  /* ---------------- 本次连续观看(统一累计) ---------------- */
  const ADD_SESSION = shared.MSG.ADD_SESSION;
  const GET_SESSION = shared.MSG.GET_SESSION;

  let segStart = 0;
  let pendingMs = 0;
  let shownSec = -1;
  let sessionTimer = null;
  let unsubPlayer = null;

  function sendAdd(sec) {
    try {
      const p = chrome.runtime.sendMessage({ type: ADD_SESSION, seconds: sec });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* 忽略 */ }
  }

  function renderSession() {
    const el = document.getElementById(VIDEO_STATS_ID);
    const sessionEl = el && el.querySelector('[data-vs="session"]');
    if (!sessionEl) return;
    sessionEl.textContent = shownSec <= 0 ? '--' : shared.formatDuration(shownSec);
  }

  function readTotal() {
    try {
      chrome.runtime.sendMessage({ type: GET_SESSION }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (resp && resp.ok) {
          shownSec = Number(resp.sessionSec) || 0;
          renderSession();
        }
      });
    } catch (e) { /* 忽略 */ }
  }

  function tick() {
    const now = performance.now();
    if (segStart) {
      pendingMs += now - segStart;
      segStart = 0;
    }
    if (player.isPlaying()) {
      segStart = now;
    }
    const sec = Math.floor(pendingMs / 1000);
    if (sec > 0) {
      pendingMs -= sec * 1000;
      sendAdd(sec);
    }
    readTotal();
  }

  function startSessionTimer() {
    if (sessionTimer) return;
    unsubPlayer = player.onChange(function () { tick(); });
    readTotal();
    tick();
    sessionTimer = setInterval(tick, 1000);
  }

  function stopSessionTimer() {
    if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
    if (unsubPlayer) { unsubPlayer(); unsubPlayer = null; }
    if (segStart) { pendingMs += performance.now() - segStart; segStart = 0; }
    const sec = Math.floor(pendingMs / 1000);
    if (sec > 0) sendAdd(sec);
    pendingMs = 0;
    shownSec = -1;
  }

  window.addEventListener('pagehide', function () {
    if (segStart) { pendingMs += performance.now() - segStart; segStart = 0; }
    const sec = Math.floor(pendingMs / 1000);
    if (sec > 0) sendAdd(sec);
    pendingMs = 0;
  });

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
    removeAnchorPadding();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
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
