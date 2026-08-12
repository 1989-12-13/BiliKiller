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
  };

  const RULE_CARDS = [
    { key: 'hideHomeFeed', icon: 'home', title: '首页推荐流', desc: '隐藏首页视频卡片瀑布流，保留顶部导航与搜索框' },
    { key: 'hideRelated', icon: 'play', title: '视频页相关视频', desc: '隐藏播放页右侧相关视频与底部推荐列表' },
    { key: 'hideHotRank', icon: 'flame', title: '热门 / 排行榜', desc: '隐藏榜单内容，替换为「请使用搜索」占位提示' },
    { key: 'hideHotSearch', icon: 'search', title: '热搜榜', desc: '隐藏搜索框下拉中的热搜面板，保留输入联想' },
    { key: 'hideAds', icon: 'shield', title: '全站广告', desc: '屏蔽视频页右侧广告卡片、底部横幅与搜索页推广位' },
  ];

  let settings = Object.assign({}, DEFAULT_SETTINGS);

  function $(sel) { return document.querySelector(sel); }

  async function loadSettings() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    settings = Object.assign({}, DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
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
      ? '当天累计观看每满 ' + v + ' 分钟，会在页面右下角弹出温和提醒，你可以自由选择「再看一会」或「休息一下」。'
      : '提醒已关闭。开启后，观看达到设定时长会收到非强制的休息提醒。';
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
    const resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATS, days: 30 });
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

  /* ---------- 初始化 ---------- */

  document.addEventListener('DOMContentLoaded', async function () {
    await loadSettings();
    buildRuleCards();
    initReminderSection();
    renderReport();
  });
})();
