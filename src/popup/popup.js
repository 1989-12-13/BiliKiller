/**
 * BiliKiller 弹窗页逻辑：今日时长、7 天趋势、快捷开关。
 */
(function () {
  'use strict';

  const shared = globalThis.BiliKillerShared;
  const SETTINGS_KEY = shared.STORAGE_KEYS.SETTINGS;
  const DEFAULT_SETTINGS = shared.DEFAULT_SETTINGS;
  const MSG = shared.MSG;

  const TOGGLE_ITEMS = [
    { key: 'hideHomeFeed', label: '首页推荐流' },
    { key: 'hideRelated', label: '视频页相关视频' },
    { key: 'hideHotRank', label: '热门 / 排行榜' },
    { key: 'hideHotSearch', label: '热搜榜' },
    { key: 'hideAds', label: '全站广告' },
    { key: 'reminderEnabled', label: '温和提醒' },
  ];

  const WEEKDAYS = '日一二三四五六';

  function $(sel) { return document.querySelector(sel); }

  async function getSettings() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
  }

  async function saveSetting(key, value) {
    const settings = await getSettings();
    settings[key] = value;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  function buildToggles(settings) {
    const wrap = $('#toggles');
    wrap.textContent = '';
    for (const item of TOGGLE_ITEMS) {
      const row = document.createElement('div');
      row.className = 'toggle-row';

      const name = document.createElement('span');
      name.className = 'toggle-name';
      name.textContent = item.label;

      const sw = document.createElement('label');
      sw.className = 'switch switch-sm';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(settings[item.key]);
      input.addEventListener('change', function () {
        saveSetting(item.key, input.checked);
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      sw.append(input, slider);

      row.append(name, sw);
      wrap.appendChild(row);
    }
  }

  function renderChart(series) {
    const chart = $('#chart-7d');
    chart.textContent = '';
    const max = Math.max(60, ...series.map(function (d) { return d.seconds; }));

    series.forEach(function (d, i) {
      const col = document.createElement('div');
      col.className = 'col' + (i === series.length - 1 ? ' today' : '');
      const minutes = Math.round(d.seconds / 60);
      col.title = d.date.slice(5) + '：' + minutes + ' 分钟';

      const bar = document.createElement('div');
      bar.className = 'bar' + (d.seconds <= 0 ? ' empty' : '');
      const h = d.seconds <= 0 ? 2 : Math.max(4, Math.round((d.seconds / max) * 100));
      bar.style.height = h + '%';

      const day = document.createElement('span');
      day.className = 'day';
      day.textContent = WEEKDAYS[new Date(d.date + 'T00:00:00').getDay()];

      col.append(bar, day);
      chart.appendChild(col);
    });
  }

  async function render() {
    const results = await Promise.all([
      getSettings(),
      chrome.runtime.sendMessage({ type: MSG.GET_TODAY }),
      chrome.runtime.sendMessage({ type: MSG.GET_STATS, days: 7 }),
    ]);
    const settings = results[0];
    const todayResp = results[1];
    const statsResp = results[2];

    $('#toggle-enabled').checked = Boolean(settings.enabled);
    buildToggles(settings);

    const today = (todayResp && todayResp.today) || { seconds: 0, visits: 0 };
    $('#today-duration').textContent = shared.formatDuration(today.seconds);
    $('#today-visits').textContent = '访问 ' + (today.visits || 0) + ' 次';

    if (!settings.enabled || !settings.reminderEnabled) {
      $('#next-reminder').textContent = '提醒已关闭';
    } else {
      const intervalSec = Math.max(1, Number(settings.reminderIntervalMin) || 30) * 60;
      const next = (Math.floor(today.seconds / intervalSec) + 1) * intervalSec;
      const remainMin = Math.max(1, Math.ceil((next - today.seconds) / 60));
      $('#next-reminder').textContent = '距下次提醒 ' + remainMin + ' 分钟';
    }

    if (statsResp && statsResp.ok) {
      renderChart(statsResp.series);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('#toggle-enabled').addEventListener('change', function (e) {
      saveSetting('enabled', e.target.checked);
    });
    $('#open-options').addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });
    render();
  });
})();
