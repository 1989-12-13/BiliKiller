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

  const STATS_REFRESH_MS = 30000;

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
      '#' + VIDEO_STATS_ID + ' .bk-vs-session { padding: 10px 12px; margin-bottom: 10px; border-radius: 12px; font-size: 13px; font-weight: 600; color: var(--bk-vs-text); background: rgba(91,108,255,.07); border: 1px solid rgba(91,108,255,.14); }',
      '#' + VIDEO_STATS_ID + ' .bk-vs-session b { color: var(--bk-vs-primary); font-variant-numeric: tabular-nums; }',
    ];
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
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

    // 数据渲染完成后重估面板高度与视口
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
        '<div class="bk-vs-session">本次连续观看 <b data-vs="session">--</b></div>' +
        '<div class="bk-vs-grid">' +
        '  <div class="bk-vs-cell"><span>距下次提醒</span><b data-vs="reminder">--</b></div>' +
        '  <div class="bk-vs-cell"><span>今日访问</span><b data-vs="visits">--</b></div>' +
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

  /* ---------------- 本次连续观看(统一累计) ----------------
   「本次连续观看」= 本次 B 站访问内，视频「实际播放」的累计时长。
   - 只要播放（state=playing）就累加，不论标签页是否可见（回到桌面 / 切标签页不算中断）；
   - 暂停 / 缓冲 / 结束 / 无视频 / 离开视频页：都不清零，只是暂停累加；
   - 总数由 SW 单点串行化累计（chrome.storage.local 的 bk-session-total，单位秒），
     内容脚本每秒只上报「增量秒数」、读回总数显示——多标签页/多视频共用一个统一计数，不会各自漂移；
   - 浏览器重启时由 SW 清空归零。
   用 performance.now() 单调时钟分段累计，避免 Date.now() 受系统改时间影响。 */
  const ADD_SESSION = shared.MSG.ADD_SESSION;
  const GET_SESSION = shared.MSG.GET_SESSION;

  let segStart = 0;    // 当前播放段起点（performance.now()），0 = 未在播放
  let pendingMs = 0;   // 尚未上报的毫秒（含亚秒余量）
  let shownSec = -1;   // 当前显示的累计秒数（来自 SW 权威值；-1 = 尚未读到）
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

  /** 每秒：结算上一段 → 若在播则重新起段 → 上报整秒增量 → 读回 SW 权威总数并显示 */
  function tick() {
    const now = performance.now();
    if (segStart) {
      pendingMs += now - segStart;
      segStart = 0;
    }
    if (player.isPlaying()) {
      segStart = now; // 若仍在播放，立即重新起段累计下一段
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
