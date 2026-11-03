/**
 * BiliKiller B 站 API 封装：稍后再看、观看历史，以及两处的删除操作。
 * 供首页面板使用，接口失败时由调用方降级显示。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 * - 仅依赖 BiliKillerShared；
 * - 不读 BK_CLEANER，纯数据层；
 * - 写操作需要 cookie 里的 bili_jct 作为 csrf 参数。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;

  const WATCH_LATER_URL = 'https://api.bilibili.com/x/v2/history/toview';
  const WATCH_LATER_ADD_URL = 'https://api.bilibili.com/x/v2/history/toview/add';
  const WATCH_LATER_DEL_URL = 'https://api.bilibili.com/x/v2/history/toview/del';
  const WATCH_LATER_LIMIT = 8;

  // 观看历史（本人）：面板展示前 8 条，一次多拉一页用于删除后补位
  const HISTORY_URL = 'https://api.bilibili.com/x/web-interface/history/cursor';
  const HISTORY_PAGE_SIZE = 30;
  const HISTORY_LIMIT = 8;

  /** 从 cookie 读 CSRF Token（bili_jct 不是 HttpOnly，页面上下文可读） */
  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function postForm(url, data) {
    const body = Object.keys(data).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(data[key]);
    }).join('&');
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    }).then(function (r) { return r.json(); });
  }

  function fetchWatchLater() {
    return fetch(WATCH_LATER_URL, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    }).then(function (r) { return r.json(); });
  }

  function fetchHistory(cursor) {
    let url = HISTORY_URL + '?type=archive&ps=' + HISTORY_PAGE_SIZE;
    if (cursor && (cursor.max || cursor.view_at)) {
      url += '&max=' + encodeURIComponent(cursor.max || 0) +
        '&view_at=' + encodeURIComponent(cursor.view_at || 0) +
        (cursor.business ? '&business=' + encodeURIComponent(cursor.business) : '');
    }
    return fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    }).then(function (r) { return r.json(); });
  }

  /** 加入稍后再看：按 bvid 添加，列表满 100 个时返回 90001 */
  function addWatchLater(bvid) {
    return postForm(WATCH_LATER_ADD_URL, { bvid: bvid, csrf: getCsrf() });
  }

  /** 移出稍后再看：按 aid 删除 */
  function removeWatchLater(aid) {
    return postForm(WATCH_LATER_DEL_URL, { aid: aid, csrf: getCsrf() });
  }

  globalThis.BK_BILI_API = Object.freeze({
    fetchWatchLater: fetchWatchLater,
    fetchHistory: fetchHistory,
    addWatchLater: addWatchLater,
    removeWatchLater: removeWatchLater,
    WATCH_LATER_LIMIT: WATCH_LATER_LIMIT,
    HISTORY_LIMIT: HISTORY_LIMIT,
  });
})();
