# BiliKiller

哔哩哔哩防沉迷浏览器扩展（Chrome / Edge，Manifest V3）。

核心思路是「去诱导 + 温和提醒」：移除 B 站页面中所有推荐性内容、仅保留主动搜索，同时自动记录使用时长，达到阈值时弹出可关闭/延迟的温和提醒，并提供历史使用报表。

## 功能

| 功能 | 说明 |
| --- | --- |
| 首页净化 | 隐藏推荐信息流与二级分类导航，替换为数字健康风格的「搜索引导 + 今日状态卡 + 稍后再看」面板 |
| 视频页净化 | 隐藏右侧相关视频、底部推荐列表 |
| 热门/排行榜净化 | 隐藏榜单内容，显示「请使用搜索」的温和占位卡片（内置搜索框） |
| 搜索页净化 | 保留搜索结果，隐藏热搜榜等推荐位 |
| 使用统计 | 仅累计页面可见时长（后台标签页不计时），按天持久化，自动清理 90 天前数据 |
| 温和提醒 | 观看时长每达到设定阈值（默认 30 分钟，可配置 10–120 分钟）弹出非强制提醒，可「再看一会」或「休息一下」 |
| Popup | 今日观看时长、访问次数、近 7 天迷你趋势图、各净化功能快捷开关 |
| Options | 分项开关各隐藏规则、配置提醒间隔、查看近 30 天历史报表柱状图 |
| 今日状态卡 | 首页面板中部新增「今日已看 / 距下次提醒 / 今日访问」实时仪表盘，每 30 秒刷新，提醒关闭时显示「已关闭」 |
| 深色模式适配 | 自动跟随 B 站深色开关（`<html class="dark">`），面板全部颜色采用 CSS 变量，亮/暗双主题无缝切换，无白块刺眼 |
| 动态问候与每日一句 | 标题区按时段显示「早上好/下午好/晚上好/夜深了」，下方每日轮换一句本地专注格言，零网络请求 |
| 稍后再看 | 首页展示你主动加入 B 站「稍后再看」的视频（封面 / 标题 / UP 主 / 时长），未登录、为空或加载失败时显示温和引导，延续「仅主动观看」理念 |
| 全站广告 | 屏蔽视频页右侧广告卡片与底部横幅、搜索页推广位等广告容器，与净化规则相互独立可单独开关 |
| 视频页观看统计 | 播放页右侧栏（广告与相关推荐被净化后留白处）注入「观看统计」面板：今日已看 / 今日访问 / 距下次提醒 / 与昨日对比（多看了/少看了）/ 近 7 天日均与迷你趋势图，每 30 秒自动刷新 |
| 内容标签统计 | 自动采集所看视频的标签（`.tag-link`），心跳上报时长时按标签均分累计（`stats.daily[].tags`），面板展示近 14 天「主要标签时长占比」扇形图（conic-gradient 环形图 + 图例色块/名称/分钟），Top 6 外合并为「其他」 |

## 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）；
2. 开启右上角「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择本目录（包含 `manifest.json` 的文件夹）；
4. 访问 bilibili.com 即可生效。

## 目录结构

```
BiliKiller/
├── manifest.json                    # MV3 清单
├── icons/                           # 16/32/48/128 图标
├── src/
│   ├── shared/messages.js           # 消息类型、storage key、默认设置（content 与 SW 共用）
│   ├── background/service-worker.js # 时长聚合写盘、历史清理、消息路由
│   ├── content/
│   │   ├── selectors.js             # 全部隐藏规则的选择器配置（集中维护）
│   │   ├── cleaner.js               # CSS 注入 + SPA 路由钩子 + 热门页占位卡片
│   │   ├── tracker.js               # 可见时长累计、心跳上报、访问计数
│   │   └── reminder.js              # 温和提醒浮层（Shadow DOM）与延迟逻辑
│   ├── popup/                       # 弹出页
│   └── options/                     # 选项页
└── tools/gen-icons.ps1              # 图标生成脚本
```

## 技术要点

- **零依赖、无构建**：原生 JS + HTML + CSS，直接加载即可运行。
- **CSS-first 净化**：`document_start` 注入隐藏规则，CSS 对动态节点天然生效、零重排开销；钩住 `history.pushState` / `popstate` 适配 SPA 路由；节流 MutationObserver 仅作兜底。
- **写入节流**：时长每 15 秒心跳上报一次 + 页面隐藏/卸载时立即上报，service worker 串行化写入避免多标签页竞争。
- **爆炸半径控制**：content scripts 仅匹配 `*://*.bilibili.com/*`，不影响其他网站；所有功能均可在选项页独立关闭。

## 选择器维护指南

B 站改版导致净化失效时，只需更新 `src/content/selectors.js`：

1. 打开失效页面，用开发者工具定位推荐内容容器的真实 class；
2. 在对应规则组（`hideHomeFeed` / `hideRelated` / `hideHotRank` / `hideHotSearch`）的 `selectors` 数组**头部**追加新选择器；
3. 保留旧选择器作为兜底，无需改动其他文件。

选择器于 2026-08 通过真实 bilibili 页面实测采集（首页 `.bili-feed4-layout`、视频页 `.recommend-list-v1`、热门页 `.popular-container`、热搜 `.trending`）。

## 端到端验证

仓库自带 playwright-cli 验证配置 `.playwright/e2e.config.json`（以持久化上下文加载本目录为未打包扩展）。修改选择器后可快速回归：

```powershell
playwright-cli --config=.playwright/e2e.config.json open https://www.bilibili.com/
```

2026-08-11 已通过真实 Chromium 验证：首页推荐流隐藏且搜索框保留、热门页显示搜索占位卡片、搜索页结果保留、视频页相关推荐隐藏、时长统计与提醒倒计时在 Popup 正确显示、Options 页规则卡片/间隔滑块/30 天报表正常渲染。

2026-08-11 首页面板三项增强（今日状态卡 / 深色模式 / 问候与格言）已通过持久化上下文实测断言：问候「晚上好」按时段正确、每日一句本地轮换、状态卡「1 小时 17 分 / 距下次提醒 已关闭 / 今日访问 8 次」与 popup 公式一致（注入 4500 秒时计算为 15 分钟）、`<html class="dark">` 注入后面板背景 `#1E2029`、文字 `#E8E9ED`、次级 `#9AA1B4` 全量切换；亮色下卡片 `#FFFFFF`、文字 `#1F2430`、输入框白底 `#E5E7F0` 边框；热门页占位卡片与首页面板互斥（切换路由时正确移除/挂载）；视频页相关推荐隐藏且无占位残留；搜索页结果 50 条保留、热搜组件未渲染。

2026-08-11 首页面板重构为「搜索栏（左）+ 状态卡（右）」双栏布局，状态卡竖排三张独立卡片，移动端（≤900px）自动降级为居中单列堆叠；同时将原 8 张分区卡片替换为「稍后再看」视频区块（真实 API `api.bilibili.com/x/v2/history/toview`）：未登录显示「登录 B 站后…」引导（实测返回 code -101）、空列表显示空状态、加载失败显示错误提示；通过注入 mock 数据实测渲染 3 张视频卡片（封面 / 标题 / UP 主 / `1:02:05` 等时长格式化 / 跳转 `bilibili.com/video/{bvid}`），深色模式下卡片 `#1E2029`、标题 `#E8E9ED` 适配正常。

2026-08-11 新增「全站广告」屏蔽（实测视频页右侧存在独立广告容器：`.ad-report-inner` 内「豆包」广告卡片 350x97、`.ad-floor-exp`/`.right-bottom-banner` 底部「领头像框」横幅 350x175，均不在相关视频隐藏规则覆盖范围内）：`hideAds` 规则组与默认设置、Options 规则卡片（第 5 张「全站广告」）、Popup 快捷开关同步新增；实测开启后视频页全部广告容器 `display:none`，关闭后恢复 `block`（开关联动即时生效），顶部导航与搜索结果（50 条）均未被误伤。

2026-08-12 根治「视频页顶栏偶尔消失」（根因经系统性对照实验确认：B 站视频页 Vue 持续更新时遍历右侧栏相关容器 children，扩展若向 `.right-container` / `.right-container-inner` / `.app-v1` 等任意位置插入面板元素，都会破坏其内部遍历（`nextSibling` 为 undefined 崩溃 → bili-header 顶栏挂载失败），且与注入时机无关——纯净浏览器在 DOMContentLoaded / header 出现后注入同样崩溃）：视频统计面板最终改为**挂在 `document.body` 末尾（非 Vue 管理容器）+ `position: fixed` 视口定位到 sticky 右侧栏（`.right-container-inner`）下方**。fixed 与 sticky 同在视口坐标系，滚动时相对关系恒定、无需任何定时器/scroll 监听（消除粘滞感）；仅右侧栏尺寸变化时由 `ResizeObserver` 重算一次（消除遮挡/显示不全）。实测：视频页连续 5 次刷新 header 100% 存在 + 面板 100% 挂载、console 0 errors、面板紧贴 sticky 底部（gap 恒 16、宽 350 对齐）、滚动/懒加载后位置正确不遮挡、数据/标签图/深色模式正常；首页回归（顶栏 / 面板 / 状态卡 / 稍后再看 / 横幅 top 0）全部正常。注：中途一次「面板不挂载」问题为 `placeVideoStats` 改 fixed 后遗漏 `document.body.appendChild(el)`，已修复。后续按用户反馈将面板间距收敛：原定位贴 `.right-container-inner` 容器 `bottom` 虽代码 gap=2px，但 B 站该容器自带 `padding-bottom: 250px`（相关推荐懒加载预留空间），视觉上仍有大段空白；现改为定位到容器内「最后一个可见内容」的 bottom，视觉间距 2px（实测 panelTop 214 = 弹幕框 bottom 212 + 2），滚动后恒定。

2026-08-12 修复「首页稍后再看不显示」（根因：自愈式挂载重构时，`loadWatchLater()` 仍留在 `placeHomePanel(el)` 之前调用，此时 `#bk-watch-later` 容器尚未插入 DOM，`getElementById` 返回 null 导致函数直接 return、fetch 从未发出；`startStatsTimer` 因有 30s 轮询兜底未受影响）：调整挂载顺序为先 `placeHomePanel(el)` 再初始化，并用 `data-bk-inited` 标记保证只初始化一次。实测：未登录首页稍后再看恢复「登录 B 站后…」引导，状态卡（1 小时 15 分 / 15 分钟 / 6 次）、顶栏、刷新稳定性全部正常。

2026-08-12 新增「内容标签统计」：视频页 cleaner 采集 `.tag-link` 标签写入 `globalThis.__BK_CURRENT_TAGS`（多个 content script 共享同一 isolated world），tracker 心跳上报 `ADD_TIME` 携带 `tags`，SW `addTime` 按标签数均分累计到 `stats.daily[].tags`，新增 `GET_TAGS` 消息返回近 N 天标签聚合；视频统计面板新增「内容占比 · 近 14 天」区块（conic-gradient 环形扇形图 + 图例）。实测：真实视频页采集 4 个标签（八嘎/发现《年轮说》/搞笑/配音小剧场），等待心跳后 `GET_TAGS` 返回各标签累计秒数；注入差异化数据后扇形图百分比精确（科技 49.88% / 音乐 31% / 知识 12.5% / 游戏 6%，图例分钟 40/25/10/5）；深色模式环形中心挖空与面板同色 `#1E2029`；离开视频页清空标签，首页回归正常。注意：验证环境持久化 profile 可能缓存旧 SW（`importScripts` 加载的共享常量），修改 SW 相关文件后建议用全新 profile（`open --profile=<新目录>`）验证。

2026-08-11 使用 Edge（`playwright-cli open --browser=msedge`，配置 `.playwright/e2e.config.json` 中 `browserName` 需保持 `chromium`，通过 `--browser=msedge` 命令行映射）实测通过：Edge 151 下扩展 ID 与 Chrome 一致，首页面板（横幅 top 0 / 面板 top 155 / 位于 `.bili-feed4-layout` 前）、状态卡（1 小时 15 分 / 15 分钟 / 6 次）、视频页统计面板（右侧栏末尾、对比「比昨天多看了 56 分钟」）、广告屏蔽（`.ad-report-inner` / `.slide-ad-exp` / `.ad-floor-exp` / `.right-bottom-banner` 全部 `none`）、深色模式（面板 `#1E2029`）、热门页占位与面板互斥均正常。

2026-08-11 修复「视频页顶栏消失」问题（根因：B 站视频页顶栏由异步模块 `bili-header.umd.js` 在 DOMContentLoaded 之后才挂载，内容脚本若在其挂载过程中往 DOM 注入面板元素，会改变 B 站 Vue 初始化依赖的 DOM 结构，导致 `video.js` 报 `Cannot read properties of undefined (reading 'style')`、header 模块报 `already mounted` / `nextSibling null`，顶栏组件挂载崩溃且不会自愈；实验确认：DOM 注入彻底禁用时顶栏正常，`patchHistory` 钩子 / CSS 注入 / MutationObserver 均非诱因，注入时机才是关键）：引入 `onPageReady` 门闩，所有面板 DOM 注入（`ensurePlaceholder`）统一延迟到 `DOMContentLoaded` 后 800ms（等 B 站同步 + 异步初始化完成）再执行，CSS 注入仍在 `document_start` 立即执行防推荐流闪现。实测：视频页顶栏恢复（导航文本正常）、统计面板挂载、相关推荐隐藏、console 0 errors（此前 2 errors 消失），连续多次刷新稳定；首页（顶栏 / 面板 / 横幅 top 0）、热门页（顶栏 / 占位卡片）全部回归正常。

2026-08-11 修复「刷新后布局漂移」问题（根因：内容脚本在 B 站 SPA 异步渲染完成前注入，锚点未出现时兜底插到 `body` 首位/末尾，且「已挂载即返回」的守卫导致位置错误后永不自愈）：首页面板与视频统计面板均改为**自愈式挂载**——面板创建后由 `placeHomePanel` / `placeVideoStats` 在每次路由刷新时校验位置并 move 校正（不重建 DOM）；首页锚点（`.bili-feed4-layout`）缺失时面板紧跟顶栏放置（绝不插 body 首位，避免顶掉 B 站横幅），视频锚点（`.right-container-inner`）缺失时面板临时隐藏待命。实测：手动把两面板错位到 `body` 末尾后触发路由刷新均自动归位（首页面板回到 `.bili-feed4-layout` 前 top=155、视频面板回到右侧栏末尾 top=230）；首页 / 视频页连续刷新多次横幅（top 0）与面板位置完全一致。

2026-08-11 新增视频页「观看统计」面板：复用 `GET_TODAY` / `GET_STATS(days=7)` 数据链路，追加到播放页右侧栏 `.right-container-inner` 底部（UP 主信息 / 弹幕框之下，广告与相关推荐被净化后的留白处），含今日已看（`formatDuration`）、今日访问、距下次提醒（与 popup 同公式）、与昨日对比（多/少/持平 + 绿色 up / 橙色 down 样式）、近 7 天日均、7 根迷你趋势柱（高度按最大日归一化）；独立 30s 轮询 + `visibilitychange` 刷新，随 SPA 路由挂载/移除（视频页挂载、离开即移除，与首页面板/热门占位互斥）；实测注入 7 天数据后：今日 4500 秒 →「1 小时 15 分 / 6 次 / 15 分钟 / 比昨天多看了 55 分钟 / 日均 36 分钟 / 7 柱」，今日 600 秒（< 昨日 1200）→「比昨天少看了 10 分钟」+ down 类；深色下卡片 `#1E2029`、主色 `#7C8AFF`、对比绿 `#16A34A`。

## 隐私

所有数据仅存储在本地 `chrome.storage.local`，不上传任何服务器，无任何网络请求。
