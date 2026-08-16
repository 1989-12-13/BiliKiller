# B 站 API 能力整理

> 整理日期：2026-08-14
> 用途：BiliKiller 扩展的「通过 B 站 API 能获取哪些信息」参考手册。内容基于官方文档、社区文档镜像（原 `bilibili-API-collect` 及其镜像）与 BiliKiller 2026-08 真实页面实测。
> ⚠️ 所有内部接口路径与字段以真实请求为准，B 站随时可能调整或增加签名要求。

## 一、两套 API 体系

| 体系 | 文档入口 | 官方？ | 认证方式 | 适用场景 |
| --- | --- | --- | --- | --- |
| 开放平台 OPEN API | https://openhome.bilibili.com/doc | ✅ 官方 | OAuth 2.0（开发者应用审核） | 正式第三方应用、UP 主工具 |
| 前端内部接口（web-interface） | 无官方文档（原社区仓库 2026-01 因律师函删库） | ❌ 非官方 | 用户本人 Cookie，部分接口需 wbi 签名 | 浏览器扩展 / 个人脚本读取自身数据 |

关键区别：**开放平台**是有文档、需审核、按 scope 授权的合规通道；**前端内部接口**是 B 站官网 / App 自己调用的接口，没有公开文档，社区整理过但其文档仓库已被 B 站发函要求删库（2026-01）。BiliKiller 属于后者的典型场景：在 `bilibili.com` 页面上下文内、用用户自己的登录 Cookie 请求，与官网页面发起的请求同构。

## 二、官方开放平台（OPEN API）

### 2.1 接入流程

1. 开发者身份认证（个人 / 企业认证）；
2. 创建应用，审核通过后获得 `client_id` / `client_secret`；
3. 用户通过 OAuth 2.0 授权，应用获得 access_token；
4. 携带 token 调用开放接口。

### 2.2 授权

- 标准 OAuth 2.0，Web 端与移动端各有独立接入文档；
- scope 决定可访问的数据范围，用户在【管理中心】可随时撤销授权。

### 2.3 开放能力

| 能力模块 | 说明 |
| --- | --- |
| 账号授权与绑定 | B 站账号 OAuth 授权 |
| 用户管理 | 获取已授权用户的公开信息（昵称、头像、关注数、粉丝数、投稿数等） |
| 视频管理 | 视频稿件的发布、删除、查询 |
| 数据开放 | 用户授权后的投稿效果数据（播放、涨粉等） |
| 直播开放平台 | `open-live.bilibili.com`：直播互玩、H5 插件接入 |

### 2.4 限制

- 需实名 / 企业认证并通过应用审核，能力按 scope 开放，不开放私有的观看历史、推荐流等消费侧数据；
- 对 BiliKiller 这类读「本人观看行为」的扩展意义有限——官方通道拿不到观看历史。

## 三、前端内部接口（项目实际使用）

> 说明：B 站 web / App 自身使用的接口，非公开。以下整理基于社区文档镜像与实测，**仅作个人查阅，勿用于商用爬取**。

### 3.1 公共约定

- **主域名**：`https://api.bilibili.com`，直播在 `live.bilibili.com`，弹幕另见 `api.bilibili.com/x/v1/dm` 等；
- **认证**：依赖浏览器对 `bilibili.com` 域名的登录 Cookie（`SESSDATA` 为主，写操作还需 `bili_jct` 作为 CSRF token）；content script 同域 `fetch`，`credentials: 'include'` 即可自动携带；
- **返回结构**：`{ "code": number, "message": string, "ttl": number, "data": object }`，`data` 为业务数据；
- **wbi 签名**：部分读接口（如用户投稿列表、分段弹幕、高清流）要求请求签名，需要从网页/App 拿到 `img_key` / `sub_key` 做 wbi 混排 MD5 签名，社区有现成算法实现；
- **分页**：历史、动态、搜索等多用 cursor / pg / page 三类分页，cursor 类返回 `data.cursor` 供翻页。

### 3.2 常见错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| -101 | 未登录 / 凭证失效 |
| -400 | 请求错误 |
| -404 | 不存在（稿件消失、删除、越权） |
| -412 | 风控拦截（请求频率过高或触发风控，一般会要求验证码） |
| -403 / -401 | 权限不足（如 wbi 签名错误、BV 不存在） |

### 3.3 能获取的信息（按模块）

标记说明：✅ = BiliKiller 已使用；🔒 = 仅本人（需登录 Cookie）；🗝️ = 需 wbi 签名。

#### 账号与用户

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/web-interface/nav` ✅🔒 | 当前登录态 `isLogin`、昵称 `uname`、头像、硬币、大会员（VipStatus）、通知未读数 `unread` |
| `GET /x/web-interface/card?mid={mid}` | 任意用户基本信息：昵称、签名、等级、粉丝数、关注数、大会员状态 |
| `GET /x/space/wbi/arc/search?mid={mid}` 🗝️ | 某用户投稿视频列表（标题、播放量、时长），含分页 |
| `GET /x/relation/followings?vmid={mid}` | 某用户关注列表 / 本人粉丝列表 |

#### 视频信息

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/web-interface/view?bvid={bvid}` | 视频元信息：标题、简介、UP 主、分区 `tid`/`tname`、时长 `duration`、cid、播放/点赞/投币/收藏/分享/评论计数、部分还含 AI 摘要锚点 |
| `GET /x/web-interface/view/pages?bvid={bvid}` | 分 P 列表（每 P 标题、cid、时长） |
| `GET /x/player/playurl?bvid=&cid=` 🔒🗝️ | 视频流地址：各清晰度 qn、格式（dash / mp4 / flv），高清与登录态相关 |
| `GET /x/tag/info?tag_id=` / `?tag_name=` | 标签信息（名称、关注数、简介） |
| `GET /x/web-interface/view/conclusion/get?bvid=&cid=` | 视频 AI 小结（要点提取） |

#### 观看行为（本人，BiliKiller 核心数据源）

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/web-interface/history/cursor?type=archive&ps=30&max=&view_at=` ✅🔒 | **观看历史**：每条含视频标题、UP 主、分区 `tag_name`、观看时刻 `view_at`（秒）、真实观看进度 `progress`（秒）；`type` 可选 `archive`（视频）/`live`（直播）/`article`（专栏）；无限滚动：下次翻页用返回的 `cursor.max` / `cursor.view_at` |
| `GET /x/v2/history/toview` ✅🔒 | **稍后再看列表**：aid/bvid、封面、标题、UP 主、时长、预约时间 |
| `POST /x/v2/history/to_delete` 等写接口 🔒 | 删除 / 清空观看历史、管理稍后再看，需 `bili_jct` CSRF |

#### 搜索 / 热门 / 排行榜（无需登录即可读，项目刻意不展示）

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/web-interface/search/all/v2?keyword={kw}&search_type=` | 综合搜索，多分类（视频/用户/番剧/直播/专栏）分块结果 |
| `GET /x/web-interface/search/trending` | 热搜榜关键词列表 |
| `GET /x/web-interface/ranking/v2?rid={0|分区id}` | 排行榜（`rid=0` 全站，分区 id 为各分区榜） |
| `GET /x/web-interface/popular?ps=20` | 热门推荐流 |

#### 收藏 / 关注

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/v3/fav/folder/created/list-all?up_mid={mid}` | 用户创建的收藏夹元信息（名称、数量、可见性） |
| `GET /x/v3/fav/resource/list?media_id={mid}&pn=&ps=` 🔒 | 某收藏夹内视频列表 |
| `GET /x/v3/fav/folder/collected/list?up_mid={mid}` | 收藏的收藏夹 |

#### 弹幕 / 评论

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/v1/dm/list.so?oid={cid}` | 全量弹幕（XML，无需登录） |
| `GET /x/v2/dm/seg.so?oid=&segment_index=` 🗝️ | 分段弹幕（protobuf） |
| `GET /x/v2/reply?type=1&oid={aid}&sort=` | 评论列表：楼主/楼层、点赞数、回复数 |

#### 番剧 / 影视（PGC）

| 接口 | 获取信息 |
| --- | --- |
| `GET /pgc/view/web/season?season_id={seasonId}` 🔒 | 番剧/影视详情：剧集列表、单集时长、评分、播放数、追番数 |
| `GET /pgc/web/season/rank/list` | 番剧排行榜 |

#### 直播

| 接口 | 获取信息 |
| --- | --- |
| `GET /live.bilibili.com/room/v1/Room/get_info?room_id=` | 直播间：标题、热度人气、主播、分类、开播时间（无需登录） |

#### 动态 / 专栏 / 音频

| 接口 | 获取信息 |
| --- | --- |
| `GET /x/polymer/web-dynamic/v1/feed` 🔒 | 首页动态流（带 cursor 翻页） |
| `POST /x/polymer/web-dynamic/v1/detail` 🗝️ | 单条动态详情 |
| `GET /x/article/view?id={id}` | 专栏文章：标题、正文、图集 |
| `GET /audio/music-service-c/web/song/info?sid=` | 音频歌曲信息 |

### 3.4 签名（wbi）要点

- 近期新增签名要求的接口越来越多（见上标 🗝️）；
- 本质：`img_key + sub_key` 拼入特定混排表做 MD5，把 `wts`（时间戳）与 `w_rid`（签名）作为查询参数追加；
- 对扩展而言，在 content script 里先请求一个公开接口拿到 keys 再构造请求即可，但**为降低风控风险建议缓存 keys 并低频调用**。

## 四、与 BiliKiller 的对应关系

| 项目功能 | 使用的 API | 获取的数据 |
| --- | --- | --- |
| 首页问候语 | `/x/web-interface/nav` | 登录 + 真实昵称（缓存 10 分钟） |
| 首页「稍后再看」区块 | `/x/v2/history/toview` | 封面/标题/UP 主/时长（前 8 条） |

**未来可扩展方向**（仅供参考，需遵守净化理念——「仅主动观看、不展示诱导」）：

- Options 报表想补充更多维度：`/x/web-interface/card` 拉昵称/等级、`/x/v3/fav/resource/list` 统计收藏构成；
- 弹幕/评论 API 可用于「看完一集后统计弹幕密度」之类实验，注意频率控制。

## 五、合规与风险提醒

1. **前端内部接口非官方公开**：无 SLA、随时变更、可能被单方面加签名/风控；B 站 2026-01 已对整理此类文档的社区仓库发律师函要求删库；
2. **仅限本人数据**：BiliKiller 只在用户自己的浏览器里读自己的 Cookie 数据，属于个人用途；请勿批量抓取他人数据或商用；
3. **频率控制**：扩展已在 API 层缓存（导航 10 分钟）并避免高频轮询刷接口；扩展新功能应延续该策略；
4. 代码更新到云端仓库时，不要提交任何 Cookie / token / 密钥。

## 参考资源

- 哔哩哔哩开放平台文档：https://openhome.bilibili.com/doc
- 开放平台 OAuth 简介：https://open.bilibili.com/doc/4/eaf0e2b5-bde9-b9a0-9be1-019bb455701c
- 原社区 API 文档（已删库，谨慎使用镜像）：https://github.com/socialsisteryi/bilibili-API-collect
- 第三方 Python 封装库文档：https://nemo2011.github.io/bilibili-api