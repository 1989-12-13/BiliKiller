/**
 * BiliKiller 净化核心
 *
 * 策略（性能优先，CSS-first）：
 * 1. document_start 即注入 display:none 规则，CSS 对后续动态渲染的节点天然生效，零重排开销；
 * 2. 钩住 history.pushState / replaceState / popstate，B 站 SPA 路由切换后按新页面重建规则；
 * 3. 节流 MutationObserver 仅作兜底（占位卡片被 SPA 重渲染移除时补回）；
 * 4. 监听 chrome.storage 变更，设置页改动即时生效，无需刷新。
 *
 * 面板（首页卡片 / 热门占位 / 视频统计）已拆至 panels.js：
 * - 本文件经 globalThis.BK_CLEANER 暴露实时设置与页面类型供面板模块读取；
 * - 面板挂载 / 统计刷新经 globalThis.BK_PANELS 调度（见 refresh / applySettings）。
 *
 * 依赖加载顺序（manifest content_scripts 数组顺序）：
 * messages.js → player.js → selectors.js → cleaner.js → bili-api.js
 *   → hot-placeholder.js → home-panel.js → video-stats.js → panels.js
 *   → tracker.js → reminder.js → focus-mode.js → grayscale.js → usage-pill.js
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const GROUPS = globalThis.BK_SELECTOR_GROUPS;
  const PAGES = globalThis.BK_PAGES;
  if (!shared || !GROUPS || !PAGES) return;

  const STYLE_ID = 'bk-cleaner-style';
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;

  let settings = Object.assign({}, shared.DEFAULT_SETTINGS);
  let currentPage = detectPage();

  /** 依据当前 URL 判定页面类型：home / video / hot / search / null */
  function detectPage() {
    for (const name in PAGES) {
      if (Object.prototype.hasOwnProperty.call(PAGES, name) && PAGES[name](location)) {
        return name;
      }
    }
    return null;
  }

  /** 按当前页面与设置生成隐藏规则文本 */
  function buildCss() {
    if (!settings.enabled) return '';
    const rules = [];
    for (const group of GROUPS) {
      if (!settings[group.key]) continue;
      const applies = group.pages === 'all' ||
        (currentPage !== null && group.pages.indexOf(currentPage) !== -1);
      if (!applies) continue;
      for (const sel of group.selectors) {
        rules.push(sel + ' { display: none !important; }');
      }
    }
    return rules.join('\n');
  }

  function injectCss() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildCss();
  }

  /* ---------------- 面板调度（实现见 panels.js） ---------------- */

  /** 按当前页面与设置裁决并挂载 / 清理各面板 */
  function ensurePanels() {
    const panels = globalThis.BK_PANELS;
    if (panels && typeof panels.ensurePanels === 'function') {
      panels.ensurePanels();
    }
  }

  /** 设置变化后刷新已挂载面板的统计文案 */
  function refreshStats() {
    const panels = globalThis.BK_PANELS;
    if (panels && typeof panels.refreshStats === 'function') {
      panels.refreshStats();
    }
  }

  /* ---------------- SPA 路由与兜底监听 ---------------- */

  function refresh() {
    const next = detectPage();
    if (next !== currentPage) {
      currentPage = next;
      injectCss();
    }
    // 面板 DOM 注入必须经过页面就绪门闩：B 站初始化早期调用 pushState / replaceState
    // 会触发本函数，若直接注入面板会撞上顶栏异步挂载。pageReady 后每次刷新都正常执行。
    if (pageReady) {
      ensurePanels();
    } else {
      onPageReady(ensurePanels);
    }
  }

  let timer = null;
  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      refresh();
    }, 200);
  }

  function patchHistory(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      scheduleRefresh();
      return result;
    };
  }
  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);

  // Observer 兜底：仅在有新元素节点插入且距上次处理超过 800ms 时触发
  let lastObserverRun = 0;
  function startObserver() {
    if (!document.body) return;
    const observer = new MutationObserver(function (mutations) {
      let hasElement = false;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) { hasElement = true; break; }
        }
        if (hasElement) break;
      }
      if (!hasElement) return;
      const now = Date.now();
      if (now - lastObserverRun < 800) return;
      lastObserverRun = now;
      scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------- 页面就绪门闩 ---------------- */

  /**
   * 页面就绪门闩（信号驱动，无硬编码等待）：
   * 实测确认 B 站 video.js 初始化（Vue mount、右侧栏渲染、播放器创建）是一个
   * 较长的异步过程，期间任何对右侧栏/body 的 DOM 注入都会破坏其内部遍历
   * （nextSibling 为 undefined 崩溃 → bili-header 顶栏挂载失败）。
   * 必须等待「video.js 初始化完成」的确定性信号：
   * - 主信号：.right-container 内已渲染出视频卡片（.video-page-card-small 等）→
   *   video.js 主流程完成（纯净环境实测该信号出现后注入任意面板元素均安全）；
   * - 兜底：document.readyState === 'complete' 后再宽限 5 秒；
   * - 极端兜底：30 秒。
   * 所有等待者共用一次轮询，就绪后统一执行。
   */
  let pageReady = false;
  let readyWaiters = [];
  let readyPollStarted = false;
  function onPageReady(fn) {
    if (pageReady) { fn(); return; }
    readyWaiters.push(fn);
    if (readyPollStarted) return;
    readyPollStarted = true;

    const videoReady = function () {
      const cards = document.querySelectorAll(
        '.right-container .video-page-card-small, .right-container .video-card, .right-container .bili-video-card'
      );
      if (cards.length > 0) return true;
      // 首页 / 热门页等无右侧栏卡片，退化为等待顶栏导航文本
      const bar = document.querySelector('.bili-header__bar');
      if (bar && (bar.textContent.indexOf('登录') !== -1 || bar.textContent.indexOf('首页') !== -1)) return true;
      return false;
    };

    const finishAll = function () {
      if (pageReady) return;
      pageReady = true;
      const fns = readyWaiters;
      readyWaiters = [];
      for (const f of fns) { try { f(); } catch (e) { /* 单点失败不影响其他等待者 */ } }
    };

    const start = Date.now();
    const poll = setInterval(function () {
      if (videoReady()) {
        clearInterval(poll);
        finishAll();
        return;
      }
      const elapsed = Date.now() - start;
      if ((document.readyState === 'complete' && elapsed > 5000) || elapsed > 30000) {
        clearInterval(poll);
        finishAll();
      }
    }, 100);
  }

  /* ---------------- 设置加载与实时同步 ---------------- */

  function applySettings() {
    injectCss();
    onPageReady(ensurePanels);
    // 提醒开关 / 间隔变化后立即刷新状态卡文案
    refreshStats();
  }

  function loadSettings() {
    shared.getSettings(function (merged) {
      settings = merged;
      applySettings();
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = Object.assign({}, shared.DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    applySettings();
  });

  /* ---------------- 初始化 ---------------- */

  // document_start：先以默认设置（全部开启）注入 CSS，避免推荐内容闪现
  injectCss();
  loadSettings();

  // 面板 DOM 注入统一等待页面完全加载（load 事件）后进行，避免干扰 B 站初始化
  onPageReady(function () {
    ensurePanels();
    startObserver();
  });

  /* ---------------- 标签页存活端口：SW 据此判断是否还有 B 站标签页 ---------------- */

  function connectTabPort() {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'bk-tab' });
    } catch (e) {
      setTimeout(connectTabPort, 2000);
      return;
    }
    port.onDisconnect.addListener(function () {
      // 端口断开：可能是 SW 被回收，也可能是本页面卸载。
      // 页面卸载时本内容脚本上下文会被销毁、定时器取消，不会真的重连；
      // SW 被回收时则短暂延迟后重连，重新登记本标签页，避免 SW 误判「没有 B 站标签页」。
      setTimeout(connectTabPort, 1000);
    });
  }
  connectTabPort();

  /* ---------------- 对外接口（供 panels.js 读取实时状态） ---------------- */

  globalThis.BK_CLEANER = Object.freeze({
    /** 返回当前生效设置（含默认值合并） */
    getSettings: function () { return settings; },
    /** 返回当前页面类型：home / video / hot / search / null */
    getPage: function () { return currentPage; },
  });
})();
