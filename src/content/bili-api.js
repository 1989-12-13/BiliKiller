/**
 * BiliKiller B 站 API 封装：稍后再看。
 * 独立缓存接口结果，供首页面板使用，避免重复请求。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 仅依赖 BiliKillerShared；
 * - 不读 BK_CLEANER，纯数据层。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;

  const WATCH_LATER_URL = 'https://api.bilibili.com/x/v2/history/toview';
  const WATCH_LATER_LIMIT = 8;

  function fetchWatchLater() {
    return fetch(WATCH_LATER_URL, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    }).then(function (r) { return r.json(); });
  }

  globalThis.BK_BILI_API = Object.freeze({
    fetchWatchLater: fetchWatchLater,
    WATCH_LATER_LIMIT: WATCH_LATER_LIMIT,
  });
})();
