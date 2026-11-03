# BiliKiller

哔哩哔哩防沉迷浏览器扩展，适用于 Chrome 与 Edge，Manifest V3。

扩展隐藏站点上的推荐内容，首页换为你自己的稍后再看与观看记录；记录播放时长，按阈值提醒休息，并提供按天的报表。设置与数据都保存在本机。

## 功能

### 净化

| 位置 | 行为 |
| --- | --- |
| 首页 | 隐藏推荐信息流与二级分类导航，换成一张内容卡 |
| 视频页 | 隐藏右侧相关视频与底部推荐列表 |
| 热门 / 排行榜 | 隐藏榜单，替换为页面中央的一条搜索栏 |
| 搜索页 | 保留搜索结果，隐藏热搜等推荐位 |
| 全站广告 | 屏蔽视频页右侧广告卡片、底部横幅与搜索页推广位 |
| 弹幕与评论区 | 可选隐藏，默认关闭，不影响播放 |

### 首页内容卡

| 区块 | 说明 |
| --- | --- |
| 今日用量 | 「今日已看 / 距下次提醒」与近 7 天柱图，每 30 秒刷新 |
| 稍后再看 | 稍后再看列表，默认展示 8 条，底部「显示全部 N 个 / 收起」可展开全部（站点上限 100 个）；卡片右上角的 × 直接移出，后面的条目自动补位 |
| 继续观看 | 你的观看记录中的最近视频，含封面、标题、UP 主与进度条；右上角的 + 加入稍后再看，× 只在首页隐藏该视频（记录保存在本机，30 天后过期），不改动 B 站观看记录，隐藏后自动补下一条 |

### 统计与提醒

| 功能 | 说明 |
| --- | --- |
| 使用统计 | 标签页可见、页面为播放页且正在播放时计时：投稿视频、番剧影视、放映厅、播放列表、课堂与直播。暂停、缓冲、切走标签页、首页 / 搜索 / 热门页、静音预览与总开关关闭都不计时。数据按天保存，每天 0 点清理 90 天前的记录 |
| 观看提醒 | 每满设定阈值（默认 30 分钟，可调 10–120 分钟）弹出提醒：「继续观看」只延迟到下一个阈值，「暂停播放」暂停视频后延迟，「今天不再提醒」推迟到当天结束。延迟状态按天记录，跨天失效 |
| 专注模式 | 默认关闭。当日观看满设定分钟数（默认 90，可调 30–240 分钟）时，视频页暂停播放并弹出全屏提示，可选「回首页」或「再看 5 分钟」 |
| 专注褪色 | 观看满设定分钟数（默认 60，可调 15–240 分钟）后整站转为灰度，点击与滚动不受影响；在用量胶囊里可临时恢复色彩 15 分钟 |
| 视频页统计面板 | 播放页右栏显示今日已看、本次连续观看（全站统一计数，空闲 30 分钟后重新计算）与距下次提醒，每 30 秒刷新 |
| 图标徽章 | 图标右下角显示今日分钟数，超过 99 显示 99+ |

### 设置与数据

| 界面 | 说明 |
| --- | --- |
| Popup | 今日时长、访问次数、近 7 天趋势与各功能开关；高度 600px，开关区在中间滚动，设置入口固定在底部 |
| Options | 各功能分项开关、提醒间隔与阈值、近 30 天报表，以及导出、导入与清空 |
| 全局用量胶囊 | 任意页面左下角显示今日分钟数，点开可看今日已看、距下次提醒与今日访问；褪色生效时可临时恢复色彩 15 分钟，底部有「打开设置」 |

### 外观

- 配色取自站点：品牌粉 `#FB7299`，文字 `#18191C / #61666D / #9499A0`，描边 `#E3E5E7`，圆角 8px，字体为苹方与鸿蒙。
- Popup 与 Options 跟随系统深浅色；注入页面的面板跟随站点的 `html.bili_dark`（兼容旧版 `html.dark`）。

## 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 打开 bilibili.com。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单 |
| `CHANGELOG.md` | 开发日志 |
| `docs/bilibili-api.md` | 使用的 B 站接口与参数说明 |
| `icons/` | 16 / 32 / 48 / 128 图标 |
| `src/shared/messages.js` | 消息类型、storage key、默认设置与通用工具，content script 与 service worker 共用 |
| `src/background/service-worker.js` | 时长聚合写盘、过期清理、消息路由 |
| `src/content/player.js` | 探测主播放器，维护播放、缓冲、暂停、结束与无视频状态 |
| `src/content/selectors.js` | 全部隐藏规则的选择器配置 |
| `src/content/cleaner.js` | 注入隐藏样式、跟随单页路由、页面就绪后调度面板 |
| `src/content/bili-api.js` | 稍后再看与观看历史的接口封装 |
| `src/content/hot-placeholder.js` | 热门与排行榜的占位卡 |
| `src/content/home-panel.js` | 首页内容卡：今日用量、近 7 天柱图、稍后再看与继续观看 |
| `src/content/video-stats.js` | 视频页统计面板 |
| `src/content/panels.js` | 按页面与设置决定各面板的挂载与清理 |
| `src/content/tracker.js` | 播放时长累计、上报与访问计数 |
| `src/content/reminder.js` | 提醒浮层与延迟逻辑 |
| `src/content/focus-mode.js` | 专注模式的暂停与提示 |
| `src/content/grayscale.js` | 专注褪色的整站灰度 |
| `src/content/usage-pill.js` | 左下角用量胶囊与临时恢复色彩 |
| `src/popup/` | 工具栏弹出页 |
| `src/options/` | 设置页 |
| `tools/gen-icons.ps1` | 图标生成脚本 |
| `tools/check-syntax.mjs` | 语法校验，遍历 `src` 下的 JS 并校验 `manifest.json` |
| `.playwright/e2e.config.json` | 端到端验证使用的 playwright-cli 配置 |

## 实现方式

- 无构建、零依赖：原生 JavaScript、HTML 与 CSS，加载目录即可运行。
- 净化依靠 CSS：`document_start` 注入隐藏规则，动态节点出现后同样生效；监听 `pushState` 与 `popstate` 跟随单页路由；`MutationObserver` 只做兜底。
- 计时：`player.js` 以播放器事件维护状态，`tracker.js` 只在播放时用 `performance.now()` 累计毫秒，每 15 秒上报整秒；页面隐藏或卸载时立即上报；service worker 串行化写盘，多个标签页不会互相覆盖。
- 提醒状态保存在 `chrome.storage.local`，多标签页共享，按天记录。
- 作用范围：content script 只匹配 `*://*.bilibili.com/*`；各项功能都能在设置页单独关闭。

## 选择器维护

B 站改版导致净化失效时，更新 `src/content/selectors.js`：

1. 打开失效页面，用开发者工具定位推荐容器的 class。
2. 在对应规则组（`hideHomeFeed`、`hideRelated`、`hideHotRank`、`hideHotSearch`）的 `selectors` 数组开头添加新选择器。
3. 保留旧选择器作为兜底，其他文件无需改动。

选择器于 2026-08 按线上页面采集：首页 `.bili-feed4-layout`、视频页 `.recommend-list-v1`、热门页 `.popular-container`、热搜 `.trending`。

## 验证

语法校验：

```powershell
node tools/check-syntax.mjs
```

端到端验证使用 `.playwright/e2e.config.json`，以持久化上下文加载本目录为未打包扩展。仓库路径与本机不同时，修改配置里的 `--load-extension` 与 `--disable-extensions-except` 两项：

```powershell
playwright-cli --config=.playwright/e2e.config.json open https://www.bilibili.com/
```

## 隐私

- 设置、统计与隐藏记录都写入本机 `chrome.storage.local`。
- 需要联网的只有 B 站自己的接口（稍后再看、观看历史），请求携带浏览器现有的登录 Cookie，不经过第三方服务器。

## 已知限制

- 继续观看的隐藏记录只存在当前浏览器，换设备或清除扩展数据后失效，30 天后自动恢复显示。
- 稍后再看的移除直接作用于 B 站账号，点击即生效。
