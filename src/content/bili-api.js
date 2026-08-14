/**
 * BiliKiller B 站 API 封装：观看历史 / 稍后再看 / 登录用户信息。
 * 独立缓存各接口结果，供首页面板与视频统计面板共用，避免重复请求。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → selectors.js → cleaner.js → bili-api.js → hot-placeholder.js
 *   → home-panel.js → video-stats.js → panels.js → tracker.js → reminder.js
 * - 仅依赖 BiliKillerShared（shared.startOfDay 统一时间窗口口径）；
 * - 不读 BK_CLEANER，纯数据层。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  if (!shared) return;

  const WATCH_LATER_URL = 'https://api.bilibili.com/x/v2/history/toview';
  const WATCH_LATER_LIMIT = 8;

  // B 站观看历史 API：按 tag_name（分区）聚合真实观看进度时长
  const BILI_HISTORY_URL = 'https://api.bilibili.com/x/web-interface/history/cursor';
  const BILI_HISTORY_PAGE_SIZE = 30; // 单页最大 30
  const BILI_HISTORY_MAX_PAGES = 30; // 翻页上限，防异常无限循环
  const BILI_TAGS_CACHE_MS = 5 * 60 * 1000; // 面板 30s 轮询，API 数据缓存 5 分钟避免刷屏

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

  /* ---------------- 内容分区统计（B 站观看历史 API） ---------------- */

  // API 结果缓存：面板 30s 轮询时命中缓存，避免高频请求 B 站接口
  let biliTagsCache = null;
  let biliTagsCacheAt = 0;
  let biliTagsCacheTtl = 0;

  /**
   * 通过 B 站观看历史 API 拉取近 days 天观看记录，
   * 按分区（tag_name）聚合真实观看进度（progress，单位秒）。
   * 返回 { ok, tags, days }，tags 形如 { 分区名: 秒数 }；
   * 未登录 code=-101，网络/接口失败 ok=false。
   * 时间窗口 = days 天前本地零点起，与 GET_STATS 的日期口径对齐。
   */
  function fetchBiliTags(days) {
    const now = Date.now();
    if (biliTagsCache && now - biliTagsCacheAt < biliTagsCacheTtl) {
      return Promise.resolve(biliTagsCache);
    }
    const cutoff = Math.floor(shared.startOfDay(days) / 1000);
    const tags = {};
    let pageCount = 0;
    let max = 0;
    let viewAt = Math.floor(now / 1000);

    const nextPage = function () {
      if (pageCount >= BILI_HISTORY_MAX_PAGES) {
        return Promise.resolve({ ok: true, tags: tags, days: days });
      }
      pageCount++;
      const url = BILI_HISTORY_URL +
        '?type=archive&ps=' + BILI_HISTORY_PAGE_SIZE +
        '&max=' + max + '&view_at=' + viewAt;
      return fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || j.code !== 0 || !j.data) {
            return { ok: false, code: j && j.code, tags: null, days: days };
          }
          const list = j.data.list || [];
          for (const item of list) {
            if (!item) continue;
            // 列表按时间倒序，遇到早于时间窗口的记录即收尾（后续更早）
            if (item.view_at < cutoff) {
              return { ok: true, tags: tags, days: days };
            }
            const name = item.tag_name;
            const progress = Number(item.progress) || 0;
            if (name && progress > 0) tags[name] = (tags[name] || 0) + progress;
          }
          const cursor = j.data.cursor;
          if (!cursor) return { ok: true, tags: tags, days: days };
          const nextMax = cursor.max || max;
          const nextViewAt = cursor.view_at || viewAt;
          if (nextMax === max && nextViewAt === viewAt) {
            return { ok: true, tags: tags, days: days };
          }
          max = nextMax;
          viewAt = nextViewAt;
          return nextPage();
        })
        .catch(function () {
          return { ok: false, code: null, tags: null, days: days };
        });
    };

    return nextPage().then(function (result) {
      // 成功缓存 5 分钟；失败（未登录/接口异常）缓存 1 分钟，避免轮询刷屏
      biliTagsCache = result;
      biliTagsCacheTtl = result && result.ok ? BILI_TAGS_CACHE_MS : 60 * 1000;
      biliTagsCacheAt = Date.now();
      return result;
    });
  }

  globalThis.BK_BILI_API = Object.freeze({
    fetchWatchLater: fetchWatchLater,
    fetchBiliUser: fetchBiliUser,
    fetchBiliTags: fetchBiliTags,
    WATCH_LATER_LIMIT: WATCH_LATER_LIMIT,
  });
})();
