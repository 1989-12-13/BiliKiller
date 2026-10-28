/**
 * BiliKiller 播放器状态模块（content scripts 共享）：
 * 统一探测主播放器 video，维护真实播放状态，作为「累计观看」与「连续观看」的单一事实来源。
 *
 * 状态机（state）：
 * - 'playing'：实际播放中（画面在走）；
 * - 'waiting'：缓冲/卡顿中（用户仍在看，但画面没走，不计时）；
 * - 'paused' ：用户或系统暂停；
 * - 'ended'  ：播放结束；
 * - 'none'   ：页面无主播放器 video。
 *
 * 状态由 video 事件驱动（playing/waiting/pause/ended/emptied），不靠轮询判断，
 * 因此能把「缓冲」与「播放」严格区分开；1 秒轮询仅用于捕捉 B 站 SPA 换视频导致的 video 元素替换。
 *
 * 依赖加载顺序：messages.js → player.js → selectors.js → ...
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  // 投稿视频 / 番剧 / 播放列表 / 课堂 / 直播（直播播放器在 .player-ctnr 内）
  const MAIN_SELECTORS = '#bilibili-player video, .bpx-player-video-wrap video, .bpx-player video, .player-ctnr video';

  let currentVideo = null;
  let state = 'none'; // playing | waiting | paused | ended | none
  const listeners = [];

  function setState(next) {
    if (state === next) return;
    state = next;
    for (const cb of listeners) {
      try { cb(state, currentVideo); } catch (e) { /* 单个监听异常不影响其它 */ }
    }
  }

  /** 元素是否看起来「正在播放」（不含「缓冲」判断，仅用于初始推断） */
  function isPlayingEl(v) {
    return !!(v && v.currentTime > 0 && !v.paused && !v.ended && v.readyState >= 2);
  }

  function findMainVideo() {
    const mains = document.querySelectorAll(MAIN_SELECTORS);
    for (let i = 0; i < mains.length; i++) {
      if (mains[i] && mains[i].isConnected) return mains[i];
    }
    // 兜底：任意「非静音且正在播放」的 video（排除侧栏悬浮静音预览）
    const all = document.querySelectorAll('video');
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      if (v && v.isConnected && isPlayingEl(v) && !v.muted) return v;
    }
    return null;
  }

  function bind(v) {
    const onPlaying = function () { setState('playing'); };
    const onWaiting = function () { setState('waiting'); };
    const onPause = function () { setState('paused'); };
    const onEnded = function () { setState('ended'); };
    const onEmptied = function () { setState('paused'); };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('emptied', onEmptied);
    v.__bkUnbind = function () {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('emptied', onEmptied);
    };
  }

  /** 依据元素当前属性推断初始状态（仅在元素首次被发现时用一次） */
  function initialOf(v) {
    if (!v) return 'none';
    if (v.ended) return 'ended';
    if (v.paused) return 'paused';
    if (isPlayingEl(v)) return 'playing';
    return 'waiting';
  }

  function sync() {
    const v = findMainVideo();
    if (v !== currentVideo) {
      if (currentVideo && currentVideo.__bkUnbind) currentVideo.__bkUnbind();
      currentVideo = v;
      if (v) bind(v);
      setState(initialOf(v));
    }
    // 同一元素时，状态由事件维护，绝不在此轮询覆盖（否则会把「缓冲」误判为「播放」）
  }

  setInterval(sync, 1000);

  function pause() {
    if (currentVideo && typeof currentVideo.pause === 'function') currentVideo.pause();
  }

  globalThis.BK_PLAYER = Object.freeze({
    /** 当前状态：playing | waiting | paused | ended | none */
    state: function () { return state; },
    /** 是否「实际播放中」（画面在走） */
    isPlaying: function () { return state === 'playing'; },
    /** 当前主播放器 video 元素（可能为 null） */
    getVideo: function () { return currentVideo; },
    /** 订阅状态变化，返回取消订阅函数 */
    onChange: function (cb) {
      listeners.push(cb);
      return function () {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    /** 暂停主播放器（非视频页无主播放器时为 no-op） */
    pause: pause,
  });

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);
})();
