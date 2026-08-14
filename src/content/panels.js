/**
 * BiliKiller 面板调度器：按当前页面与设置裁决各面板的挂载 / 清理。
 * 各面板实现已拆至独立文件，本文件仅保留决策与调度：
 * - 首页卡片面板 → BK_HOME_PANEL
 * - 热门 / 排行榜占位卡 → BK_HOT_PLACEHOLDER
 * - 视频页观看统计面板 → BK_VIDEO_STATS
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → selectors.js → cleaner.js → bili-api.js → hot-placeholder.js
 *   → home-panel.js → video-stats.js → panels.js → tracker.js → reminder.js
 * - 经 globalThis.BK_CLEANER 读取实时设置与页面类型（由 cleaner.js 维护并随 storage 变化同步）；
 * - 对外经 globalThis.BK_PANELS 暴露调度入口（ensurePanels / refreshStats），
 *   由 cleaner.js 的 SPA 路由与设置监听在运行时调用。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const cleaner = globalThis.BK_CLEANER;
  const GROUPS = globalThis.BK_SELECTOR_GROUPS;
  const HOT = globalThis.BK_HOT_PLACEHOLDER;
  const HOME = globalThis.BK_HOME_PANEL;
  const VS = globalThis.BK_VIDEO_STATS;
  if (!shared || !cleaner || !GROUPS || !HOT || !HOME || !VS) return;

  /** 当前页面是否命中「启用占位卡片」的净化规则 */
  function placeholderNeeded(page) {
    const settings = cleaner.getSettings();
    if (!settings.enabled || cleaner.getPage() !== page) return false;
    for (const group of GROUPS) {
      if (!group.placeholder || !settings[group.key]) continue;
      if (group.pages === 'all' || (Array.isArray(group.pages) && group.pages.indexOf(page) !== -1)) {
        return true;
      }
    }
    return false;
  }

  /* ---------------- 面板调度（由 cleaner.js 的 SPA 路由 / 设置监听驱动） ---------------- */

  /**
   * 按当前页面与设置裁决并挂载 / 清理各面板。
   * 命中规则：首页 → 首页卡片面板；热门 / 排行榜 → 居中占位卡；视频页 → 右侧统计面板；
   * 其余页面 → 清理全部占位。
   * 注意：分支采用 early-return 而非「先全量 remove 再 mount」——
   * 保留 home / video 面板「已挂载即只挪位置、不重建」的自愈式设计（data-bk-inited），
   * 避免同页刷新时每次 tear-down / 重建 / 重新拉取稍后再看与状态卡。
   */
  function ensurePanels() {
    if (placeholderNeeded('home')) {
      HOT.remove();
      VS.remove();
      HOME.ensure();
      return;
    }
    if (placeholderNeeded('hot')) {
      HOME.remove();
      VS.remove();
      HOT.ensure();
      return;
    }
    if (VS.needed()) {
      HOME.remove();
      HOT.remove();
      VS.ensure();
      return;
    }
    // 其他页面：清理全部占位
    HOT.remove();
    HOME.remove();
    VS.remove();
  }

  /** 设置变化后刷新已挂载面板的统计文案（cleaner.js applySettings 调用） */
  function refreshStats() {
    HOME.refreshStats();
    VS.refreshStats();
  }

  globalThis.BK_PANELS = Object.freeze({
    ensurePanels: ensurePanels,
    refreshStats: refreshStats,
  });
})();
