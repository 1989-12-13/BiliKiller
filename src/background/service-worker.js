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

function addTime(seconds) {
  return serialized(async function () {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const stats = await getStats();
    const key = todayKey(0);
    const day = stats.daily[key] || { seconds: 0, visits: 0 };
    day.seconds += Math.round(seconds);
    stats.daily[key] = day;
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
    await setBadgeFromDay(day.seconds);
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

/* ---------------- 「本次连续观看」统一累计：SW 单点串行化，多标签页只上报增量 ---------------- */

const SESSION_KEY = 'bk-session-total'; // 累计秒数（chrome.storage.local）
const SESSION_LAST_KEY = 'bk-session-last'; // 最后一次上报的时间戳（毫秒）
const SESSION_IDLE_MS = 30 * 60 * 1000; // 连续 30 分钟没有播放，视为新一轮会话

function isSessionFresh(last, now) {
  return Number.isFinite(last) && last > 0 && now - last <= SESSION_IDLE_MS;
}

function addSession(seconds) {
  return serialized(async function () {
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n) || n <= 0) return;
    const data = await chrome.storage.local.get([SESSION_KEY, SESSION_LAST_KEY]);
    const now = Date.now();
    const last = Number(data && data[SESSION_LAST_KEY]);
    const cur = Number(data && data[SESSION_KEY]);
    // 空闲超过阈值就从头计数，避免「本次连续观看」跨着几小时的空档继续累加
    const base = isSessionFresh(last, now) && Number.isFinite(cur) && cur > 0 ? cur : 0;
    await chrome.storage.local.set({ [SESSION_KEY]: base + n, [SESSION_LAST_KEY]: now });
  });
}

function getSessionTotal() {
  return serialized(async function () {
    const data = await chrome.storage.local.get([SESSION_KEY, SESSION_LAST_KEY]);
    const now = Date.now();
    const last = Number(data && data[SESSION_LAST_KEY]);
    const cur = Number(data && data[SESSION_KEY]);
    return isSessionFresh(last, now) && Number.isFinite(cur) && cur > 0 ? cur : 0;
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

/* ---------------- 扩展图标徽章：实时显示今日观看分钟数 ---------------- */

/** 用当日累计秒数更新图标徽章（>99 分钟显示 99+，0 分钟清空） */
async function setBadgeFromDay(seconds) {
  try {
    const minutes = Math.floor((Number(seconds) || 0) / 60);
    const text = minutes <= 0 ? '' : (minutes > 99 ? '99+' : String(minutes));
    await chrome.action.setBadgeText({ text: text });
    await chrome.action.setBadgeBackgroundColor({ color: '#F85A54' });
  } catch (e) {
    /* action 不可用（如部分环境）时静默忽略，不影响统计主流程 */
  }
}

/** 从存储读取当日数据并刷新徽章（SW 启动 / 安装 / 跨天时调用） */
async function updateBadgeFromStorage() {
  try {
    const stats = await getStats();
    const day = stats.daily[todayKey(0)] || { seconds: 0, visits: 0 };
    await setBadgeFromDay(day.seconds);
  } catch (e) { /* 忽略 */ }
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return false;

  const handle = async function () {
    switch (msg.type) {
      case MSG.ADD_TIME:
        await addTime(Number(msg.seconds));
        return { ok: true };

      case MSG.ADD_VISIT:
        await addVisit();
        return { ok: true };

      case MSG.ADD_SESSION:
        await addSession(Number(msg.seconds));
        return { ok: true };

      case MSG.GET_SESSION:
        return { ok: true, sessionSec: await getSessionTotal() };

      case MSG.GET_TODAY: {
        const stats = await getStats();
        const key = todayKey(0);
        return {
          ok: true,
          date: key,
          today: stats.daily[key] || { seconds: 0, visits: 0 },
        };
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

      case MSG.OPEN_OPTIONS:
        await chrome.runtime.openOptionsPage();
        return { ok: true };

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

/* ---------------- 标签页存活追踪：最后一个 B 站标签页关闭时清空「本次连续观看」累计 ---------------- */

const liveTabPorts = new Set();
let pendingClearTimer = null;

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'bk-tab') return;
  liveTabPorts.add(port);
  if (pendingClearTimer) {
    clearTimeout(pendingClearTimer);
    pendingClearTimer = null;
  }
  port.onDisconnect.addListener(function () {
    liveTabPorts.delete(port);
    if (liveTabPorts.size === 0) {
      // 整页刷新会造成瞬间 disconnect→connect，延迟 3s 再清空以规避抖动；
      // 只有「最后一个 B 站标签页真正关闭/离开」时才会真正清空。
      pendingClearTimer = setTimeout(function () {
        pendingClearTimer = null;
        if (liveTabPorts.size === 0) {
          chrome.storage.local.remove([SESSION_KEY, SESSION_LAST_KEY]).catch(function () {});
        }
      }, 3000);
    }
  });
});

/* ---------------- 生命周期 ---------------- */

chrome.runtime.onInstalled.addListener(function () {
  // 合并默认设置，确保新增字段有默认值
  saveSettings({}).catch(function () {});
  pruneOldStats().catch(function () {});
  updateBadgeFromStorage().catch(function () {});
  // 安装 / 更新时重排每日清理，丢掉旧版本按创建时间计数的定时
  chrome.alarms.clear(ALARMS.DAILY_ROLLOVER, function () {
    scheduleDailyRollover();
  });
});

chrome.runtime.onStartup.addListener(function () {
  updateBadgeFromStorage().catch(function () {});
  // 浏览器重启兜底：正常关闭会触发各标签页端口断开并清空，这里再兜底清一次，避免上次累计残留
  chrome.storage.local.remove([SESSION_KEY, SESSION_LAST_KEY]).catch(function () {});
});

/**
 * 每日清理：只在 alarm 不存在时创建，避免 SW 每次唤醒都重建、把倒计时一直往后推。
 * 首次触发定在次日 0 点，之后每 24 小时一次。
 */
function scheduleDailyRollover() {
  chrome.alarms.get(ALARMS.DAILY_ROLLOVER, function (alarm) {
    if (alarm) return;
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    chrome.alarms.create(ALARMS.DAILY_ROLLOVER, {
      when: next.getTime(),
      periodInMinutes: 24 * 60,
    });
  });
}

scheduleDailyRollover();
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARMS.DAILY_ROLLOVER) {
    pruneOldStats()
      .then(updateBadgeFromStorage)
      .catch(function () {});
  }
});
