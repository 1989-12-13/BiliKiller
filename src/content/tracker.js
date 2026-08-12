/**
 * BiliKiller 时长统计（内容脚本端）
 *
 * 规则：
 * - 仅在页面可见（visibilityState === 'visible'）时按秒累计，后台标签页不计时长；
 * - 每累计 15 秒心跳上报一次；页面隐藏 / 关闭时立即上报，避免数据丢失；
 * - 每次文档加载计一次访问（SPA 内跳转不重复计数）。
 */
(function () {
  'use strict';

  // 只统计顶层页面，避免 iframe 重复计数
  if (window.top !== window) return;

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;
  const MSG = shared.MSG;

  const HEARTBEAT_SECONDS = 15;
  let pendingSeconds = 0;

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
    if (pendingSeconds <= 0) return;
    const seconds = pendingSeconds;
    pendingSeconds = 0;
    // 携带当前视频标签（cleaner 采集后写入 globalThis，多个 content script 共享同一环境）
    const tags = Array.isArray(globalThis.__BK_CURRENT_TAGS) ? globalThis.__BK_CURRENT_TAGS : undefined;
    send({ type: MSG.ADD_TIME, seconds: seconds, tags: tags });
  }

  window.setInterval(function () {
    if (document.visibilityState === 'visible') {
      pendingSeconds += 1;
      if (pendingSeconds >= HEARTBEAT_SECONDS) flush();
    }
  }, 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  // 访问计数：每次文档加载一次
  send({ type: MSG.ADD_VISIT });
})();
