/**
 * BiliKiller 时长统计（内容脚本端）——真实观看口径：
 * - 仅在「视频页可见 + 主播放器实际播放（state=playing）」时累计；
 * - 暂停 / 缓冲（waiting）/ 结束 / 切走标签页 / 离开视频页 均不计时；
 * - 事件驱动 + performance.now() 精确到毫秒累计，15 秒心跳把整秒上报给 SW，亚秒余量保留到下一轮；
 * - 每次文档加载计一次访问（SPA 内跳转不重复计数）。
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  const shared = globalThis.BiliKillerShared;
  const player = globalThis.BK_PLAYER;
  const PAGES = globalThis.BK_PAGES;
  if (!shared || !player || !PAGES) return;
  const MSG = shared.MSG;

  const HEARTBEAT_MS = 15000;

  let pendingMs = 0;      // 尚未上报的累计毫秒（亚秒余量保留）
  let segStart = 0;       // 当前「累计段」起点（performance.now()），0 = 未在累计
  let accumulating = false;
  let lastPageVideo = PAGES.video(location);

  function isVideoPage() {
    return PAGES.video(location);
  }

  function send(message) {
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') {
        p.catch(function () { /* service worker 暂不可用时忽略 */ });
      }
    } catch (e) {
      /* 扩展被重载等场景，忽略 */
    }
  }

  function flush() {
    // 若正在累计，先把运行中的段落结算进 pendingMs（checkpoint），保证持续播放时也能周期上报
    if (accumulating) {
      const now = performance.now();
      pendingMs += now - segStart;
      segStart = now;
    }
    if (pendingMs >= 1000) {
      const seconds = Math.floor(pendingMs / 1000);
      pendingMs -= seconds * 1000;
      send({ type: MSG.ADD_TIME, seconds: seconds });
    }
  }

  function start() {
    if (!accumulating) {
      segStart = performance.now();
      accumulating = true;
    }
  }

  function stop() {
    if (accumulating) {
      pendingMs += performance.now() - segStart;
      accumulating = false;
    }
    flush();
  }

  function shouldAccumulate() {
    return document.visibilityState === 'visible' && isVideoPage() && player.isPlaying();
  }

  function recompute() {
    if (shouldAccumulate()) start();
    else stop();
  }

  // 播放状态变化时立即重算（playing → 开始累计；pause/waiting/ended → 停止累计）
  player.onChange(function () {
    recompute();
  });
  document.addEventListener('visibilitychange', recompute);
  window.addEventListener('pagehide', stop);

  // 1 秒兜底：捕捉 SPA 路由切换（离开视频页立即停止并上报）与遗漏的初始状态
  window.setInterval(function () {
    const video = isVideoPage();
    if (video !== lastPageVideo) {
      lastPageVideo = video;
    }
    recompute();
  }, 1000);

  // 心跳：定期把已累计的整秒上报（亚秒余量保留）
  window.setInterval(flush, HEARTBEAT_MS);

  recompute();

  // 访问计数：每次文档加载一次
  send({ type: MSG.ADD_VISIT });
})();
