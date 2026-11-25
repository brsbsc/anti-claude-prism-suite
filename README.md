# Anti-Claude Prism Suite

**为 [Anti-Claude](https://github.com/hongqi7/Anti-Claude)（Google Antigravity Desktop）打造的 Clean-room 可插拔扩展套件（MIT）**

在不改动 Anti-Claude 核心 `custom.js` / `custom.css` 的前提下，通过独立的 `user/extensions/` 热加载扩展机制，为 Antigravity 桌面端补充 **6 项可独立开关的视觉与效率增强模块**。

---

## 核心特性

点击顶栏新增的 **`✦ 棱镜`** 按钮即可弹出控制面板，动态贴合按钮下方且全部配置自动持久化到 `localStorage`：

1. **多套深浅主题配色（随宿主亮暗联动，不冲突）**
   - 浅色：`纯白默认` / `白昼冷晶`（冷灰蓝 + 钴蓝）/ `暖白画册`（纸张暖白 + 暖棕）
   - 深色：`暖炭默认` / `深空黑曜`（高对比冷黑）/ `暖炭玄岩`（低蓝光暖玄岩）
2. **会话大纲 + `Alt+↑/↓` 跳轮 + `/btw` 支线提问**
   - 顶栏 **`大纲`** 按钮（或快捷键 `Alt+O`）打开带实时关键词过滤的提问清单，点击秒跳并脉冲定位；
   - 悬停大纲行可点击 `btw` 一键向输入框填入 `/btw 关于「...」：`；
   - 非输入焦点下按 **`Alt+↑` / `Alt+↓`**（编辑框内 `Alt+Shift+↑/↓`）即可在超长会话中逐轮上下跳转。
3. **用量名著换算 + 12 周热力图**
   - 无侵入增强右侧概览面板的「用量统计」卡片（带 `MutationObserver` 零闪烁补挂与设置面板一键 **`定位 ↗`**）；
   - 将 Token 体量趣味换算为经典名著倍数（支持点击切换 `今日` / `近12周`），下方附 84 格 12 周 GitHub 风格主题蓝热力图。
4. **五级水墨流式吐字淡入**
   - 基于 Chromium 原生 `CSS.highlights` API 实现五档透明度淡入，零 DOM 节点包裹，流式结束自动停止 `rAF` 归零占用。
5. **输入框上方像素小伙伴（空闲自动 `0fps`）**
   - 原创内联 SVG 像素精灵（可选 `三萌` / `橘蟹` / `紫猫`），随对话状态切换弹跳 / 庆祝 / 静态打盹（空闲 5 秒完全停动画，`0fps` 零消耗），点击触发随机互动气泡。
6. **思考过程实时中文转译**
   - 支持 `关闭` / `双语对照` / `沉浸中文` 三态，展开英文思考块时自动通过守护进程后端 `translateText` RPC 翻译并 LRU 缓存，不破坏 React 原文节点。

---

## 安装与卸载

### 前置条件
- 已安装 Node.js >= 22 与 [Anti-Claude](https://github.com/hongqi7/Anti-Claude)。
- 守护进程 `core/daemon.mjs` 已启用 `user/extensions/*.{css,js}` 热加载，以及 `getUsageSummary`（支持最高 182 天）与 `translateText` RPC（参考本仓库同作者提交的 Anti-Claude 扩展接口设计）。

### 安装

```bash
git clone https://github.com/wushuai0802/anti-claude-prism-suite.git
cd anti-claude-prism-suite
node install.mjs
```

如需指定自定义 `userDir`：

```bash
node install.mjs --user-dir "/path/to/anti-claude/user"
```

### 卸载

```bash
node uninstall.mjs
```

卸载后仅移除 `prism-suite.css` 与 `prism-suite.js`，不触碰其他扩展或 Anti-Claude 原生配置。

---

## 本地测试

```bash
npm test
```

---

## 免责声明与许可

- 本项目为独立 Clean-room 原创实现，采用 **MIT License** 开源，不隶属于 Google LLC，亦不包含任何第三方 GPL 代码。
- 交互灵感参考了社区优秀项目（如 Anti-Claude、Obsidian Prism）的体验理念，所有 CSS、SVG 像素精灵与 JS 模块均为从零编写。
