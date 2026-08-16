/**
 * BiliKiller B 站 API 封装：稍后再看 / 登录用户信息。
 * 独立缓存各接口结果，供首页面板共用，避免重复请求。
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

  // B 站登录态/用户信息 API：首页问候语展示真实昵称
  const BILI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
  const BILI_NAV_CACHE_MS = 10 * 60 * 1000; // 昵称基本不变，缓存 10 分钟

  /* ---------------- 稍后再看 ---------------- */

  function fetchWatchLater() {
    return fetch(WATCH_LATER_URL, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    }).then(function (r) { return r.json(); });
  }

  /* ---------------- 登录用户信息 ---------------- */

  // 登录态/用户名缓存：首页多轮 mount 时命中，避免重复请求
  let biliNavCache = null;
  let biliNavCacheAt = 0;

  /**
   * 通过 B 站 nav API 获取当前登录用户信息。
   * 返回 { ok, name }：登录时 name 为真实昵称，未登录（code -101）或失败时 ok=false。
   * 结果缓存 10 分钟。
   */
  function fetchBiliUser() {
    const now = Date.now();
    if (biliNavCache && now - biliNavCacheAt < BILI_NAV_CACHE_MS) {
      return Promise.resolve(biliNavCache);
    }
    return fetch(BILI_NAV_URL, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const isLogin = Boolean(j && j.data && j.data.isLogin);
        const name = isLogin && j.data.uname ? String(j.data.uname) : '';
        const result = { ok: isLogin && name !== '', name: name };
        biliNavCache = result;
        biliNavCacheAt = Date.now();
        return result;
      })
      .catch(function () {
        const result = { ok: false, name: '' };
        biliNavCache = result;
        biliNavCacheAt = Date.now();
        return result;
      });
  }

  globalThis.BK_BILI_API = Object.freeze({
    fetchWatchLater: fetchWatchLater,
    fetchBiliUser: fetchBiliUser,
    WATCH_LATER_LIMIT: WATCH_LATER_LIMIT,
  });
})();
