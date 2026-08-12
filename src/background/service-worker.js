/**
 * BiliKiller 后台 service worker（Manifest V3）
 *
 * 职责：
 * - 汇总各标签页上报的观看时长 / 访问次数，按天写入 chrome.storage.local；
 * - 提供今日数据、近 N 天序列、设置读写等消息接口；
 * - chrome.alarms 每日清理超过保留期的历史数据；
 * - 安装时合并默认设置。
 */
importScripts('../shared/messages.js');

const shared = globalThis.BiliKillerShared;
const STORAGE_KEYS = shared.STORAGE_KEYS;
const DEFAULT_SETTINGS = shared.DEFAULT_SETTINGS;
const MSG = shared.MSG;
const ALARMS = shared.ALARMS;
const todayKey = shared.todayKey;

const RETENTION_DAYS = 90;

/* ---------------- 串行化写入，避免多标签页并发读写竞争 ---------------- */

let writeQueue = Promise.resolve();
function serialized(task) {
  const p = writeQueue.then(task);
  writeQueue = p.then(function () {}, function () {});
  return p;
}

/* ---------------- 存储读写 ---------------- */

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.SETTINGS] || {});
}

async function saveSettings(patch) {
  const next = Object.assign({}, await getSettings(), patch || {});
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

async function getStats() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  const stats = data[STORAGE_KEYS.STATS];
  return stats && typeof stats.daily === 'object' && stats.daily ? stats : { daily: {} };
}

function addTime(seconds, tags) {
  return serialized(async function () {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const stats = await getStats();
    const key = todayKey(0);
    const day = stats.daily[key] || { seconds: 0, visits: 0 };
    day.seconds += Math.round(seconds);
    // 标签时长：同一上报携带多个标签时按标签数均分，保证标签总和 ≈ 总时长
    const tagList = Array.isArray(tags)
      ? tags.filter(function (t) { return typeof t === 'string' && t.length > 0; })
      : [];
    if (tagList.length) {
      const per = Math.max(1, Math.round(seconds / tagList.length));
      if (typeof day.tags !== 'object' || !day.tags) day.tags = {};
      for (const t of tagList) day.tags[t] = (day.tags[t] || 0) + per;
    }
    stats.daily[key] = day;
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
  });
}

function addVisit() {
  return serialized(async function () {
    const stats = await getStats();
    const key = todayKey(0);
    const day = stats.daily[key] || { seconds: 0, visits: 0 };
    day.visits += 1;
    stats.daily[key] = day;
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
  });
}

/** 清理超过保留期的历史数据（跨天归档） */
function pruneOldStats() {
  return serialized(async function () {
    const stats = await getStats();
    const cutoff = todayKey(RETENTION_DAYS);
    let changed = false;
    for (const key of Object.keys(stats.daily)) {
      if (key < cutoff) {
        delete stats.daily[key];
        changed = true;
      }
    }
    if (changed) {
      await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
    }
  });
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return false;

  const handle = async function () {
    switch (msg.type) {
      case MSG.ADD_TIME:
        await addTime(Number(msg.seconds), msg.tags);
        return { ok: true };

      case MSG.ADD_VISIT:
        await addVisit();
        return { ok: true };

      case MSG.GET_TODAY: {
        const stats = await getStats();
        const key = todayKey(0);
        return {
          ok: true,
          date: key,
          today: stats.daily[key] || { seconds: 0, visits: 0 },
        };
      }

      case MSG.GET_TAGS: {
        const days = Math.min(Math.max(parseInt(msg.days, 10) || 14, 1), 365);
        const stats = await getStats();
        const tags = {};
        for (let i = days - 1; i >= 0; i--) {
          const key = todayKey(i);
          const day = stats.daily[key];
          if (day && day.tags) {
            for (const name in day.tags) {
              tags[name] = (tags[name] || 0) + day.tags[name];
            }
          }
        }
        return { ok: true, tags: tags, days: days };
      }

      case MSG.GET_STATS: {
        const days = Math.min(Math.max(parseInt(msg.days, 10) || 30, 1), 365);
        const stats = await getStats();
        const series = [];
        for (let i = days - 1; i >= 0; i--) {
          const key = todayKey(i);
          const day = stats.daily[key] || { seconds: 0, visits: 0 };
          series.push({ date: key, seconds: day.seconds, visits: day.visits });
        }
        return { ok: true, series: series };
      }

      case MSG.GET_SETTINGS:
        return { ok: true, settings: await getSettings() };

      case MSG.SAVE_SETTINGS:
        return { ok: true, settings: await saveSettings(msg.settings) };

      default:
        return { ok: false, error: 'unknown message type: ' + msg.type };
    }
  };

  handle()
    .then(sendResponse)
    .catch(function (err) {
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // 异步响应
});

/* ---------------- 生命周期 ---------------- */

chrome.runtime.onInstalled.addListener(function () {
  // 合并默认设置，确保新增字段有默认值
  saveSettings({}).catch(function () {});
  pruneOldStats().catch(function () {});
});

chrome.alarms.create(ALARMS.DAILY_ROLLOVER, { periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARMS.DAILY_ROLLOVER) {
    pruneOldStats().catch(function () {});
  }
});
