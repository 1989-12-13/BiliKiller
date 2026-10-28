/**
 * BiliKiller 选项页逻辑：净化规则分项开关、提醒设置、近 30 天使用报表。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;
  const DEFAULT_SETTINGS = shared.DEFAULT_SETTINGS;
  const MSG = shared.MSG;

  const ICONS = {
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/></svg>',
    play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg>',
    flame: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3.5 5 5.2 5 9.2A5 5 0 0 1 7 12.2c0-1.9.9-3.4 2-5 .4 1.1 1.3 1.9 2.4 2.1C11.2 6.6 11.5 4.7 12 3z"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9.5 12l1.8 1.8 3.2-3.6"/></svg>',
    danmaku: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/><path d="M6 9h7"/><path d="M6 12h9"/></svg>',
    comment: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };

  const RULE_CARDS = [
    { key: 'hideHomeFeed', icon: 'home', title: '首页推荐流', desc: '隐藏首页视频卡片瀑布流，保留顶部导航与搜索框' },
    { key: 'hideRelated', icon: 'play', title: '视频页相关视频', desc: '隐藏播放页右侧相关视频与底部推荐列表' },
    { key: 'hideCollectionNav', icon: 'play', title: '合集/剧集导航', desc: '隐藏视频页右侧合集/剧集列表（开启后无法切换下一个视频）' },
    { key: 'hideEndOverlay', icon: 'shield', title: '视频结尾连播推荐', desc: '隐藏播放结束时弹出的「接下来播放 / 连播」推荐，自动连播倒计时照常运行' },
    { key: 'hideHotRank', icon: 'flame', title: '热门 / 排行榜', desc: '隐藏榜单内容，替换为「请使用搜索」占位提示' },
    { key: 'hideHotSearch', icon: 'search', title: '热搜榜', desc: '隐藏搜索框下拉中的热搜面板，保留输入联想' },
    { key: 'hideAds', icon: 'shield', title: '全站广告', desc: '屏蔽视频页右侧广告卡片、底部横幅与搜索页推广位' },
    { key: 'hideDanmaku', icon: 'danmaku', title: '弹幕（沉浸观看）', desc: '隐藏视频页弹幕层，只留画面与声音，回归内容本身（不影响播放）' },
    { key: 'hideComments', icon: 'comment', title: '评论区（沉浸观看）', desc: '隐藏视频页评论区，屏蔽情绪化与引战内容的注意力黑洞' },
  ];

  let settings = Object.assign({}, DEFAULT_SETTINGS);

  function $(sel) { return document.querySelector(sel); }

  /* ---------- 滑杆进度 ---------- */

  /** 把当前取值换算成已选区间宽度，写入 --fill 供轨道渐变使用 */
  function paintRange(range) {
    const min = Number(range.min);
    const max = Number(range.max);
    const value = Number(range.value);
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
    range.style.setProperty('--fill', percent + '%');
  }

  function initRanges() {
    const ranges = document.querySelectorAll('input[type="range"]');
    for (const range of ranges) {
      paintRange(range);
      range.addEventListener('input', function () { paintRange(range); });
    }
  }

  async function loadSettings() {
    settings = await shared.getSettings();
  }

  async function persist() {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  /* ---------- 净化规则卡片 ---------- */

  function buildRuleCards() {
    const wrap = $('#rule-cards');
    wrap.textContent = '';
    for (const rule of RULE_CARDS) {
      const card = document.createElement('div');
      card.className = 'rule-card' + (settings[rule.key] ? ' on' : '');

      const icon = document.createElement('div');
      icon.className = 'rule-icon';
      icon.innerHTML = ICONS[rule.icon];

      const text = document.createElement('div');
      text.className = 'rule-text';
      const h3 = document.createElement('h3');
      h3.textContent = rule.title;
      const p = document.createElement('p');
      p.textContent = rule.desc;
      text.append(h3, p);

      const sw = document.createElement('label');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(settings[rule.key]);
      input.addEventListener('change', async function () {
        settings[rule.key] = input.checked;
        card.classList.toggle('on', input.checked);
        await persist();
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      sw.append(input, slider);

      card.append(icon, text, sw);
      wrap.appendChild(card);
    }
  }

  /* ---------- 提醒设置 ---------- */

  function updatePreview() {
    const v = Number(settings.reminderIntervalMin) || 30;
    $('#reminder-preview').textContent = settings.reminderEnabled
      ? '每累计观看 ' + v + ' 分钟，页面右下角弹出提醒。'
      : '提醒已关闭。';
  }

  function initReminderSection() {
    const toggle = $('#reminder-enabled');
    const range = $('#interval-range');

    toggle.checked = Boolean(settings.reminderEnabled);
    range.value = String(settings.reminderIntervalMin);
    $('#interval-value').textContent = String(settings.reminderIntervalMin);
    updatePreview();

    toggle.addEventListener('change', async function () {
      settings.reminderEnabled = toggle.checked;
      updatePreview();
      await persist();
    });

    range.addEventListener('input', function () {
      $('#interval-value').textContent = range.value;
      settings.reminderIntervalMin = Number(range.value);
      updatePreview();
    });
    range.addEventListener('change', async function () {
      settings.reminderIntervalMin = Number(range.value);
      await persist();
    });
  }

  /* ---------- 专注模式 ---------- */

  function initHardLimitSection() {
    const toggle = $('#hard-limit-enabled');
    const range = $('#hard-limit-range');
    const value = $('#hard-limit-value');

    toggle.checked = Boolean(settings.hardLimitEnabled);
    range.value = String(settings.hardLimitMin);
    value.textContent = String(settings.hardLimitMin);

    toggle.addEventListener('change', async function () {
      settings.hardLimitEnabled = toggle.checked;
      await persist();
    });
    range.addEventListener('input', function () {
      value.textContent = range.value;
      settings.hardLimitMin = Number(range.value);
    });
    range.addEventListener('change', async function () {
      settings.hardLimitMin = Number(range.value);
      await persist();
    });
  }

  /* ---------- 专注褪色 ---------- */

  function initGrayscaleSection() {
    const toggle = $('#grayscale-enabled');
    const range = $('#grayscale-range');
    const value = $('#grayscale-value');

    toggle.checked = Boolean(settings.grayscaleEnabled);
    range.value = String(settings.grayscaleAtMin);
    value.textContent = String(settings.grayscaleAtMin);

    toggle.addEventListener('change', async function () {
      settings.grayscaleEnabled = toggle.checked;
      await persist();
    });
    range.addEventListener('input', function () {
      value.textContent = range.value;
      settings.grayscaleAtMin = Number(range.value);
    });
    range.addEventListener('change', async function () {
      settings.grayscaleAtMin = Number(range.value);
      await persist();
    });
  }

  /* ---------- 全局用量胶囊 ---------- */

  function initUsagePillSection() {
    const toggle = $('#usage-pill-enabled');
    toggle.checked = Boolean(settings.usagePillEnabled);
    toggle.addEventListener('change', async function () {
      settings.usagePillEnabled = toggle.checked;
      await persist();
    });
  }

  /* ---------- 使用报表 ---------- */

  function renderChart30(series) {
    const wrap = $('#chart-30d');
    wrap.textContent = '';
    const max = Math.max(60, ...series.map(function (d) { return d.seconds; }));

    for (const d of series) {
      const col = document.createElement('div');
      col.className = 'col30';
      const minutes = Math.round(d.seconds / 60);
      col.dataset.tip = d.date.slice(5) + ' · ' + minutes + ' 分钟 · ' + (d.visits || 0) + ' 次访问';

      const bar = document.createElement('div');
      bar.className = 'bar30' + (d.seconds <= 0 ? ' empty' : '');
      const h = d.seconds <= 0 ? 1 : Math.max(2, (d.seconds / max) * 100);
      bar.style.height = h + '%';

      col.appendChild(bar);
      wrap.appendChild(col);
    }

    const axis = $('#chart-axis');
    axis.textContent = '';
    const from = document.createElement('span');
    from.textContent = series[0].date.slice(5);
    const to = document.createElement('span');
    to.textContent = '今天';
    axis.append(from, to);
  }

  async function renderReport() {
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATS, days: 30 });
    } catch (e) {
      resp = null; // 后台暂不可用，保持静态占位
    }
    if (!resp || !resp.ok) return;
    const series = resp.series;

    const weekSeconds = series.slice(-7).reduce(function (a, d) { return a + d.seconds; }, 0);
    const totalSeconds = series.reduce(function (a, d) { return a + d.seconds; }, 0);
    const totalVisits = series.reduce(function (a, d) { return a + (d.visits || 0); }, 0);

    $('#week-total').textContent = shared.formatDuration(weekSeconds);
    $('#avg-daily').textContent = shared.formatDuration(Math.round(totalSeconds / 30));
    $('#total-visits').textContent = totalVisits + ' 次';

    renderChart30(series);
  }

  /* ---------- 数据管理（导出 / 导入 / 清空统计） ---------- */

  function initDataSection() {
    $('#export-btn').addEventListener('click', async function () {
      const data = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bilikiller-backup-' + shared.todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $('#import-btn').addEventListener('click', function () {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async function () {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
          await chrome.storage.local.set(parsed);
          // 同步今日徽章，避免刷新前显示旧值
          const key = shared.todayKey();
          const day = parsed[shared.STORAGE_KEYS.STATS] && parsed[shared.STORAGE_KEYS.STATS].daily
            ? parsed[shared.STORAGE_KEYS.STATS].daily[key] || { seconds: 0 }
            : { seconds: 0 };
          const minutes = Math.floor((day.seconds || 0) / 60);
          try {
            await chrome.action.setBadgeText({ text: minutes > 0 ? (minutes > 99 ? '99+' : String(minutes)) : '' });
          } catch (e) { /* 忽略 */ }
          alert('导入成功，页面将刷新。');
          location.reload();
        } catch (e) {
          alert('导入失败：文件格式不正确。');
        }
      };
      input.click();
    });

    $('#reset-btn').addEventListener('click', async function () {
      if (!confirm('确定清空全部观看统计吗？净化设置会保留。')) return;
      await chrome.storage.local.remove(shared.STORAGE_KEYS.STATS);
      try {
        await chrome.action.setBadgeText({ text: '' });
      } catch (e) { /* 忽略 */ }
      renderReport();
    });
  }

  /* ---------- 初始化 ---------- */

  document.addEventListener('DOMContentLoaded', async function () {
    await loadSettings();
    buildRuleCards();
    initReminderSection();
    initHardLimitSection();
    initGrayscaleSection();
    initUsagePillSection();
    initRanges();
    initDataSection();
    renderReport();
  });
})();
