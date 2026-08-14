/**
 * BiliKiller 共享常量：storage key、消息类型、默认设置与通用工具。
 * 该文件同时被内容脚本（manifest 按序注入的第一个文件）
 * 与后台 service worker（importScripts）加载，挂载到 globalThis.BiliKillerShared。
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'settings',
    STATS: 'stats',
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true, // 功能总开关
    hideHomeFeed: true, // 首页推荐流
    hideRelated: true, // 视频页相关视频 / 底部推荐
    hideEndOverlay: true, // 视频页播放结束连播推荐（仅隐藏，自动连播不受影响）
    hideHotRank: true, // 热门 / 排行榜页占位提示
    hideHotSearch: true, // 搜索页热搜与推荐位
    hideAds: true, // 全站广告（视频页广告卡片 / 搜索推广位）
    reminderEnabled: true, // 温和提醒总开关
    reminderIntervalMin: 30, // 提醒间隔（分钟）
    dailyLimitMin: 60, // 每日观看目标（分钟），视频页面板展示达成进度
  });

  const MSG = Object.freeze({
    ADD_TIME: 'bk:add-time', // content -> SW：上报累计观看秒数 { seconds }
    ADD_VISIT: 'bk:add-visit', // content -> SW：页面加载计一次访问
    GET_TODAY: 'bk:get-today', // popup/options -> SW：今日 { seconds, visits }
    GET_STATS: 'bk:get-stats', // popup/options -> SW：近 N 天序列 { days }
    // series 按日期升序（旧→新），最后一项为今天。popup/options/video-panel 均依赖该顺序
    // （series[last]=今天、series[last-1]=昨天、series[0]=最早），改动需同步三处消费方。
    GET_SETTINGS: 'bk:get-settings',
    SAVE_SETTINGS: 'bk:save-settings',
  });

  const ALARMS = Object.freeze({
    DAILY_ROLLOVER: 'bk-daily-rollover',
  });

  /** 本地零点对应的时间戳（毫秒）；offsetDays：0=今天本地零点，1=昨天…，-1=明天… */
  function startOfDay(offsetDays) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (offsetDays) d.setDate(d.getDate() - offsetDays);
    return d.getTime();
  }

  /**
   * 本地时区「日期键」，格式 YYYY-MM-DD。
   * offsetDays：0=今天，1=昨天，-1=明天。先归位到本地零点再用 setDate 加减天数，
   * 避免用毫秒固定偏移在夏令时切换（跨时区/部分国家）时产生日期偏移。
   */
  function todayKey(offsetDays) {
    const d = new Date(startOfDay(offsetDays));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** 将秒数格式化为「X 小时 Y 分 / Y 分 Z 秒 / Z 秒」 */
  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + sec + ' 秒';
    return sec + ' 秒';
  }

  /** 将秒数格式化为紧凑的 H:MM:SS / MM:SS（供「稍后再看」卡片使用） */
  function formatCompactDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = m < 10 ? '0' + m : String(m);
    const ss = sec < 10 ? '0' + sec : String(sec);
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  /** 将秒数格式化为分钟级精度：X 小时 Y 分 / Y 分 / 0 分（不含秒，供「今日已看」等累计展示） */
  function formatDurationMinutes(seconds) {
    const m = Math.floor(Math.max(0, Math.floor(Number(seconds) || 0)) / 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0 ? h + ' 小时 ' + mm + ' 分' : mm + ' 分';
  }

  /**
   * 读取设置并合并默认值。兼容两种调用方式：
   * - getSettings(cb)：回调风格，cb(settings)；
   * - await getSettings()：Promise 风格，resolve(settings)。
   * storage 不可读或读取失败时同样返回合并后的默认设置，保证各端行为一致。
   */
  function getSettings(cb) {
    const merge = function (data) {
      return Object.assign({}, DEFAULT_SETTINGS, (data && data[STORAGE_KEYS.SETTINGS]) || {});
    };
    const onDone = function (resolve) {
      return function (data) {
        const failed = chrome.runtime && chrome.runtime.lastError;
        resolve(merge(failed ? null : data));
      };
    };
    if (typeof cb === 'function') {
      chrome.storage.local.get(STORAGE_KEYS.SETTINGS, onDone(cb));
      return;
    }
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.SETTINGS, onDone(resolve));
    });
  }

  /** 提醒间隔分钟数 → 秒数（非法值回退 30 分钟） */
  function reminderIntervalSec(intervalMin) {
    return Math.max(1, Number(intervalMin) || 30) * 60;
  }

  /**
   * 距下次提醒的剩余分钟数（至少 1 分钟）：
   * 当日累计观看 seconds 后，到下一个 intervalMin 分钟整数倍阈值还差多少分钟。
   * 全端唯一实现，避免提醒公式在多个文件里漂移。
   */
  function nextReminderMinutes(seconds, intervalMin) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const intervalSec = reminderIntervalSec(intervalMin);
    const next = (Math.floor(s / intervalSec) + 1) * intervalSec;
    return Math.max(1, Math.ceil((next - s) / 60));
  }

  /** HTML 特殊字符转义：将不可信字符串安全拼入 HTML 字符串/属性 */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.BiliKillerShared = Object.freeze({
    STORAGE_KEYS: STORAGE_KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MSG: MSG,
    ALARMS: ALARMS,
    todayKey: todayKey,
    startOfDay: startOfDay,
    formatDuration: formatDuration,
    formatCompactDuration: formatCompactDuration,
    formatDurationMinutes: formatDurationMinutes,
    getSettings: getSettings,
    reminderIntervalSec: reminderIntervalSec,
    nextReminderMinutes: nextReminderMinutes,
    escapeHtml: escapeHtml,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
