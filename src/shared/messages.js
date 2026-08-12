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
    hideHotRank: true, // 热门 / 排行榜页占位提示
    hideHotSearch: true, // 搜索页热搜与推荐位
    hideAds: true, // 全站广告（视频页广告卡片 / 搜索推广位）
    reminderEnabled: true, // 温和提醒总开关
    reminderIntervalMin: 30, // 提醒间隔（分钟）
  });

  const MSG = Object.freeze({
    ADD_TIME: 'bk:add-time', // content -> SW：上报累计观看秒数 { seconds, tags?: string[] }
    ADD_VISIT: 'bk:add-visit', // content -> SW：页面加载计一次访问
    GET_TODAY: 'bk:get-today', // popup/options -> SW：今日 { seconds, visits }
    GET_STATS: 'bk:get-stats', // popup/options -> SW：近 N 天序列 { days }
    GET_TAGS: 'bk:get-tags', // 视频面板 -> SW：近 N 天标签时长聚合 { days }
    GET_SETTINGS: 'bk:get-settings',
    SAVE_SETTINGS: 'bk:save-settings',
  });

  const ALARMS = Object.freeze({
    DAILY_ROLLOVER: 'bk-daily-rollover',
  });

  /** 返回本地时区 YYYY-MM-DD 日期键，offsetDays 为向前偏移的天数 */
  function todayKey(offsetDays) {
    const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
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

  global.BiliKillerShared = Object.freeze({
    STORAGE_KEYS: STORAGE_KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MSG: MSG,
    ALARMS: ALARMS,
    todayKey: todayKey,
    formatDuration: formatDuration,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
