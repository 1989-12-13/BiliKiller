/**
 * BiliKiller 选择器配置（集中维护文件）
 *
 * 选择器于 2026-08 通过真实 bilibili 页面实测采集，每条规则附多个候选，
 * B 站改版导致净化失效时，只需更新本文件。
 *
 * 结构说明：
 * - BK_PAGES：页面类型判定（hostname + pathname）
 * - BK_SELECTOR_GROUPS：隐藏规则组，与 settings 中的开关一一对应
 *   - key：对应 settings 字段
 *   - pages：生效页面（'all' 表示全站生效）
 *   - selectors：候选选择器列表（任一命中即被隐藏）
 *   - placeholder：为 true 时由 cleaner 注入「请使用搜索」占位卡片
 */
(function () {
  'use strict';

  const BK_PAGES = {
    // 首页（推荐信息流）
    home: function (loc) {
      return loc.hostname === 'www.bilibili.com' &&
        (loc.pathname === '/' || loc.pathname === '/index.html');
    },
    // 视频播放页
    video: function (loc) {
      return loc.hostname === 'www.bilibili.com' && loc.pathname.indexOf('/video/') === 0;
    },
    // 热门 / 排行榜（/v/popular/all、/v/popular/rank/* 等）
    hot: function (loc) {
      return loc.hostname === 'www.bilibili.com' && loc.pathname.indexOf('/v/popular') === 0;
    },
    // 搜索结果页
    search: function (loc) {
      return loc.hostname === 'search.bilibili.com';
    },
  };

  const BK_SELECTOR_GROUPS = [
    {
      // 首页推荐流：整块 feed 布局 + 卡片瀑布流 + 翻页按钮
      key: 'hideHomeFeed',
      pages: ['home'],
      placeholder: true,
      selectors: [
        '.bili-header__channel', // 顶部下方二级分类导航 + 分区卡片（与顶部搜索栏 sibling，不影响顶栏）
        '.header-channel', // feed4 直接子元素：fixed 频道 tab 条（动态/热门）
        '.bili-feed4-layout', // 新版首页推荐流整体容器（2026 实测）
        '.feed-card', // 推荐视频卡片
        '.feed-roll-btn', // 「换一换 / 加载更多」
        '.floor-single-card', // 楼层卡片
        '.bili-feed4-layout .bili-video-card',
        // 旧版布局兜底
        '.video-card',
        '.proxy-blur',
        '.bili-layout',
      ],
    },
    {
      // 视频页：右侧相关视频、底部推荐
      key: 'hideRelated',
      pages: ['video'],
      selectors: [
        '.rcmd-tab', // 右侧相关推荐 Tab 容器（合集/剧集推荐，2026-08 实测：隐藏后右侧栏净高约 148px）
        '.video-pod', // 合集/剧集视频卡片容器（rcmd-tab 内）
        '.recommend-list-v1', // 新版相关视频容器（2026 实测）
        '.rec-list', // 相关视频列表
        '.video-page-card-small', // 相关视频小卡片
        // 旧版 / 其他布局兜底
        '#reco_list',
        '.video-section-list',
        '.related-video',
        '.recommend-list',
        '.left-container-under-player .video-section-list',
        '.bili-layout__recommend',
      ],
    },
    {
      // 视频页：播放结束时的「连播 / 接下来播放」推荐面板
      // 仅隐藏推荐内容，自动连播倒计时仍照常运行（纯 CSS，不改播放器行为）
      key: 'hideEndOverlay',
      pages: ['video'],
      selectors: [
        '.bpx-player-ending-related', // bpx 播放器结束面板中的「接下来播放 / 连播」推荐网格（Bilibili-Evolved 实测）
        '.bilibili-player-ending-panel-box-videos', // 旧版播放器结束面板推荐视频容器（兜底）
      ],
    },
    {
      // 热门 / 排行榜：整块榜单内容，隐藏后由 cleaner 注入占位提示
      key: 'hideHotRank',
      pages: ['hot'],
      placeholder: true,
      selectors: [
        '.popular-container', // 热门页顶层内容容器（2026 实测）
        '.rank-container', // 排行榜主体
        '.rank-list-wrap',
        '.rank-item',
        '.bili-rank',
        '.nav-tabs', // 热门页分区 Tab
        // 兜底
        '.video-list',
        '.rank-list',
      ],
    },
    {
      // 热搜榜：搜索框下拉热搜面板（全站搜索组件通用）
      key: 'hideHotSearch',
      pages: 'all',
      selectors: [
        '.trending', // 搜索下拉热搜面板（2026 实测）
        '.trendings-double',
        // 兜底
        '.hot-search',
        '.hot-list',
        '.hotword',
        '.hot-word',
      ],
    },
    {
      // 全站广告：视频页右侧广告卡片 / 底部横幅、搜索页推广位（2026 实测）
      key: 'hideAds',
      pages: 'all',
      selectors: [
        '.ad-report-inner', // 广告容器核心类（视频页实测：「豆包」广告卡片 350x97）
        '.slide-ad-exp', // 视频页右侧栏滑动广告容器（2026 实测）
        '.video-card-ad-small', // 视频页右侧小广告卡片
        '.ad-floor-exp', // 视频页右侧底部广告楼层（实测「领头像框」横幅 350x175）
        '.right-bottom-banner', // 视频页右侧底部横幅广告
        '.ad-report', // 广告容器
        // 搜索页推广位兜底
        '.bili-video-card.is-ad',
        '.admark',
      ],
    },
  ];

  globalThis.BK_PAGES = BK_PAGES;
  globalThis.BK_SELECTOR_GROUPS = BK_SELECTOR_GROUPS;
})();
