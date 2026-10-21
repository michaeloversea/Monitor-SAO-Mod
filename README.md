# Monitor

本 Mod 基于 [WAOR/Monitor-SAO](https://github.com/WAOR/Monitor-SAO)，**仅支持极简探针（Monitor）**。当前版本 `v1.2.6`，主题短名保持 `sao`，升级沿用已有站点设置。

[更新记录](docs/Changelogs.md)

## Mod 功能

### 卡片线路

在「主题设置 → 服务器 → 逐服务器线路设置」选择：

- **跟随全局**：沿用全局模式和旧绑定行为。
- **自动**：显示该节点实际关联的任务，覆盖全局指定和旧单线路绑定。
- **自定义**：选择 1–8 个任务并调整顺序，覆盖全局设置。

配置按稳定的节点 ID/UUID 保存，节点改名不受影响。自定义任务失效或不再关联时显示无样本；后台成功确认自动任务变化后更新线路。卡片、大卡、迷你卡和列表共用选线规则。

全局多线路可以删除最后一个槽位或全部清空；**开启多线路且空槽位表示自动展示**，刷新后不补回。旧单线路绑定的迁移操作收纳于展开的节点编辑区。

检测任务的创建、执行和关联由极简探针后台负责，主题仅控制展示。首次取数静默等待，后台刷新或单节点临时取数失败保留最近采样，避免数据短暂消失。

### 图表、语言和资产

- 丢包色带与延迟图共用时间游标；色块悬停轻微上浮，提示对应时段的线路丢包率。开关色带保留图表实例和缩放，关闭后图表上移补位。
- 支持简体中文、繁体中文和 English；右上角切换语言，后台「外观与布局」及前台「首页」可设默认语言。访客选择优先于站点默认；节点名、任务名和用户输入保持原文。
- 资产明细使用中性底色与不同颜色圆点标签。CNY 价格与原始价格分别成列，原始价格沿用 CNY 排序；缺失汇率时仍显示原币种价格。
- 统一使用本地圆角矩形旗帜；紧凑卡片保留协调的上下留白。

### Hub 兼容

已适配极简探针 Hub 1.4.1，兼容旧 Hub 缺失历史 Swap、TCP、UDP、进程数字段的情况。WebSocket 握手失败或断开后持续轮询 `/api/nodes` 并定时重试连接。Agent 字符串按纯文本渲染；浏览器禁用存储时主题仍可运行并保存服务端设置。

主题配置通过 `/api/themes/sao/config` 保存，跨设备共享；主题重装沿用 Hub 数据库 `setting` 表中的 `theme_config:sao`。本地缓存只作为兜底。

## 安装或升级

1. 从 [本仓库 Releases](https://github.com/michaeloversea/Monitor-SAO-Mod/releases/latest) 下载 **`theme.tar.gz`**。
2. 在极简探针后台「主题管理」上传该文件并启用，无需解压。
3. 如主题卡片使用本仓库地址，可从卡片的更新按钮获取最新 Release。

## 开发与验证

使用 Node.js 22 和 npm：

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run package
```

根目录输出 `theme.tar.gz` 和带版本号的 TAR 包。`npm run package:zip` 可额外生成 ZIP；后台安装使用 TAR 包。开发预览运行 `npm run dev`，访问 `/?mock=1&pingScenario=1` 可使用匿名示例数据。增加 `&latencyDisplay=curve` 可预览曲线卡片。

主题设置 → 首页 →「首页延迟显示模式」可选择方块（默认）或曲线，单线路与多线路均沿用当前阈值和配色，并支持悬停、点按及方向键查看历史延迟与丢包率。服务器详情的 Ping 图表新增丢包柱状图：左轴为延迟 ms，右轴为丢包 %，可独立开关并保存访客偏好；柱状图使用原始加权采样，不受延迟曲线削峰平滑影响。

遵循[极简探针主题开发规范](https://monitor-document.pages.dev/dev/theme)。修改静态资源时更换版本目录或文件名，避免 CDN 缓存同 URL 的旧内容。公开文档与示例只使用匿名数据。

## 致谢与许可

- [Monitor-SAO / WAOR](https://github.com/WAOR/Monitor-SAO)：原主题与上游功能。
- [LuminaPlus / guboysky](https://github.com/guboysky/LuminaPlus)：丢包色带交互参考。
- [极简探针](https://github.com/monitor-probe/monitor)：监控服务端。

保留上游 MIT 许可与版权声明，详见 [LICENSE](LICENSE)。界面标识为 **JKSR Modded**。
