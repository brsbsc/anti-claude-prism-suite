# Changelog

## 0.5.4 - 2026-11-26

- **修复「账号接力」页签展开手风琴后被压扁裁切且无滚动条的问题**：
  - [plugin/ui/app.html](plugin/ui/app.html) 中 `.relay-scroll` 子元素新增 `flex-shrink: 0` 与底部留白，防止 Flex 列布局在展开「槽位交接记忆 / 上游更新雷达」时强行压缩卡片高度导致内容裁切；同时为 `.list-scroll` 补充清晰的 6px 细滚动条样式。

## 0.5.3 - 2026-11-26

- **常驻轮次圆点目录避让滚动条与分屏拖拽条**：
  - [extensions/prism-suite-fx.js](extensions/prism-suite-fx.js) 中 `positionOutlineRail()` 按视口实际滚动条宽度 + `16px` 安全留白向内偏移，并给对话视口挂载轻量 `ResizeObserver`，拖动分屏边框或开关右侧栏时实时平滑避让，不再与滚动条滑块重叠干扰。
- **输入框流光边框新增「常驻流光 / 仅生成时」模式切换**：
  - 默认切为「常驻流光」：开启开关后窗口聚焦即柔和流动，AI 生成时自动加速提亮，失焦/最小化自动 0fps 休眠；也可随时在子面板切回「仅生成时」纯生成态模式。
- **备用账号卡片视觉层级区分**：
  - [plugin/ui/app.html](plugin/ui/app.html) 为备用/离线账号卡片新增独立 `.is-account-slot` 卡片表面底色、清晰边框、微阴影与中性左侧标识条，与纯白背景及下方工具/手风琴区形成清晰分层，同时保留当前在线主账号的蓝色高亮主视觉。

## 0.5.2 - 2026-11-26

- **修复热重载后 `✦ 棱镜` 面板丢失「视觉特效与排版」「效率交互与多语言」设置**：
  - 根因：Anti-Claude 按文件名 `localeCompare` 顺序加载扩展（`prism-suite-fx.js → prism-suite-workflow.js → prism-suite.js`）；热重载整包注入时，前两个子模块先挂到旧总线，随后 `prism-suite.js` 重建总线并执行旧清理钩子，把刚注册的分组一并注销且无重挂机制；
  - 修复：[extensions/prism-suite-fx.js](extensions/prism-suite-fx.js)、[extensions/prism-suite-workflow.js](extensions/prism-suite-workflow.js) 与 [extensions/prism-suite.js](extensions/prism-suite.js) 升级为持久化模块注册表 `window.__agPrismModules`（带实例令牌防重复挂载），任何加载/热重载顺序下都会自动把全部 3 个模块完整挂载到最新总线。
- **服务端直读本机只读 LevelDB 实时额度缓存，彻底解决卡片停在「正在同步」**：
  - 在 [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 新增零依赖、纯只读 `readLocalAntigravityQuotaCache`（按 `mtime+size` 缓存加速），在 `accounts_status` 读取时直接解析 Antigravity `Local Storage/leveldb` 中最新的 `ag_claude_ux_quota_cache_v1` 快照，严格按 `accountKey` 绑定邮箱匹配防串号，彻底绕过 MCP App 沙箱 `iframe` 隔离；
  - 在 [plugin/ui/app.html](plugin/ui/app.html) 升级账号卡片额度直观展示：红/琥珀/绿双进度条（5h / 7d 剩余与精确重置倒计时）+ 独立 `Gemini` / `Claude/GPT` 分家族额度胶囊与同步时间标签。
- **账号切换聚焦严格绑定对应按钮（不再劫持常规工作台打开）**：
  - 仅点击「切号 / 账号接力」关联按钮（`✦ 棱镜 → ⚡ 切号`、低额度提醒 `⚡ 去切号`、设置页返回条 `⚡ 账号接力`）时切换并聚焦「账号接力」且不污染 `lastTab`；
  - 普通「工作台」入口与侧边栏打开时清理残留跳转意图，并只记忆/恢复常规工作台页签（`目录浏览 / 最近产物 / 收藏夹 / 历史检索`）。

## 0.5.1 - 2026-11-26

- **全自动精准实时额度同步（免手动填写 · 防串号 · 分模型家族）**：
  - [extensions/prism-suite.js](extensions/prism-suite.js) 优先直读 Anti-Claude 结构化额度缓存 `localStorage['ag_claude_ux_quota_cache_v1']`（零延迟、无需打开右侧概览面板，DOM 正则降级兜底），直接提取精确的 `5h` / `weekly` 剩余百分比、秒级 `resetTime.seconds`、订阅等级 `tierName`、Gemini/Claude 分家族池与 `accountKey` 绑定邮箱，同时一并增强输入框额度光环（`quotaRing`）与 5h/7d 低额度交接提醒；
  - [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 与 [plugin/server/index.mjs](plugin/server/index.mjs) 新增 `expectedEmail` 防串号核验（切号未重启期间若旧缓存邮箱与当前活跃账号不一致则自动安全跳过，绝不串写）及 `tierName` / `families` 持久化；
  - [plugin/ui/app.html](plugin/ui/app.html) 自动在卡片展示订阅等级徽章、精确 5h/7d 进度条与分家族剩余额度，并清晰区分在线自动同步与离线回血推算说明。

## 0.5.0 - 2026-11-26

- **切号后自动安全重启 Antigravity + Windows 凭据库防 `exit 1` 加固与 `0ms` 多级缓存**：
  - 新增 `plugin/server/relaunch-client.mjs` 与 app-only 工具 `accounts_relaunch_client`：脱离 WSL/MCP 进程树经 Explorer COM → WMI → `Start-Process` 三级投递优雅重启 Antigravity（快照原始 PID 绝不误杀新实例，自动探测并保留 `--remote-debugging-port=0` 扩展挂载参数），支持切后自动重启持久化开关与一键立即重启按钮；
  - 根治 WSL2 下 `Windows 凭据管理器调用失败: exit 1`：安装器（`install.mjs` & `installer/win/PrismSuiteInstaller.cs`）升级为**原地增量覆盖保留根目录 inode**，守护进程启动即 `chdir(homedir)`，`account-vault.mjs` 新增 `resolveSafeExecCwd`、`resolveWslInteropEnv`、PowerShell 单次批量事务与 `120s/60s` 脱敏元数据缓存（实机热读取由 `~2200ms` 降至 `0ms`，`accounts.json` 外部 `mtime` 变更自动失效缓存），并支持对未捕获新号切走前自动建槽防丢。
- **实时额度自动桥接 + `✦ 棱镜` 账号胶囊一键直达**：
  - 主扩展 `prism-suite.js` 与工作台 `app.html` 建立脱敏 `postMessage` 双向通信桥（绝不传凭据）：主界面监测到的 5h / 7d 剩余百分比与重置倒计时自动增量同步写入当前账号卡片（配合 `prism_quota_sync`）；
  - `✦ 棱镜` 控制面板顶部新增「当前账号 & 实时额度胶囊 + `⚡ 切号` 一键直达账号接力」入口，顶栏 `工作台` 按钮优先拉起右侧分屏并动态展示当前账号与额度摘要；工作台自动记忆上次停留页签（`lastTab`）。
- **工作台 UI 精修、60fps 微动效、纯键盘流与代码行号区间引用**：
  - `app.html` / `inline.html` 建立宿主 CSS 变量桥接、顶部 `2px` 流光进度条（SWR 静默刷新不闪白）、`requestAnimationFrame` 60fps 倒计时进度条、长列表 `content-visibility: auto`、手风琴记忆与窄分屏顶栏单行不折行；
  - 「目录浏览」升级可点击路径面包屑 + `Ctrl/Cmd+L` 编辑双态、未截断目录 `0ms` 本地过滤（含中文 IME 保护）及 **`↑ / ↓ / Enter / Backspace` 纯键盘导航**；代码预览新增 **一键复制全文** 与 **点击行号 / `Shift+点击` 选中行区间生成 `@path#L10-L25` 精确引用给 AI**。
- **Windows 图形安装器同步加固（`installer/win/PrismSuiteInstaller.cs`）**：
  - 升级版本号与原地增量更新保 inode 策略，新增桌面/开始菜单快捷方式 `--remote-debugging-port=0` 只读自检提示。

- **彻底修复小精灵遮挡输入区上方交互控件缺漏（`extensions/prism-suite`）**：
  - 将障碍扫描范围从仅 3 层父容器扩大至主对话交互区域，覆盖输入区上方动态弹出的 `ask_question` 选择卡（麦克风 / 跳过 / 提交 ↵）、工具审批条与折叠控件；
  - 新增障碍签名动态追踪与可用宽度评估，按钮密集时自动带着 `+N` 徽章平滑向下缩回藏起（`data-yield="1"`）并在卡片消失后探头回归；鼠标进入交互带即时触发闪避（`💨`）与收起浮窗，`.ag-ps-more-badge` 动态跟随安全空位绝不挡按钮。
- **主备多账号半自动倒计时安全接力（默认关闭，物理隔离会话与凭据）**：
  - 新增 `plugin/server/account-vault.mjs`：通过 OS 原生凭据管理器隔离命名空间（Windows `prism-suite:account:<id>`、WSL2 `prism-suite:wsl:<distro>:account:<id>`、macOS Keychain、Linux Secret Service）存取 OAuth 凭据，PowerShell 经 `-EncodedCommand` + `stdin` JSON 零插值调用 `advapi32.dll`，内存凭据用后 `.fill(0)` 清零，强校验 `id_token_email` 防串号并在异常时原子回滚；**100% 不触碰 Antigravity 本地 SQLite、`/brain/` 与 workspace**；
  - 新增 `plugin/server/account-manager.mjs` 与 `scripts/prism-accounts.mjs`：提供 `switch.lock` 跨进程并发锁、主号唯一性、5h 跨家族提示、模型兼容守卫、主号恢复滞回提醒、`--dry-run` 预演及切前 4 要素交接快照；
  - **Prism 工作台新增第 5 标签页「账号接力」**（所有账号工具严格标记 `visibility: ['app']` 对模型不可见）：支持显式安全确认开启、一键捕获主/备账号、5 秒可暂停/取消倒计时切号横幅、与切后重开回跳指引。
- **零依赖槽位交接记忆 + 外部 `memory-mcp` 联动桥（`handoff-memory.mjs`）**：
  - 随 `prism-files` MCP Server 向模型暴露 3 个轻量工具 `prism_memory_store` / `prism_memory_list` / `prism_memory_search`，按 `handoff:<project>:<slot>` **严格时间倒序**精确拉取最新进度，写入前自动脱敏私钥 / API Key / GitHub Token / JWT；
  - 工作台支持一键复制标准化外部 `memory_store` 同步指令与切后 `接力` 续写提示，随仓附通用开源规则模板 `templates/multi-account-handoff.rule.md`。
- **择优筛选版上游更新雷达（Upstream Radar）**：
  - 升级 `upstream.json`（v2，同步 `plugin/upstream.json`）纳入 `hongqi7/Anti-Claude`、`WhiteBr1ck/agy-powertools`、`RMvdesi/obsidian-prism`、`anglee0323/agy-switch` 四个上游并各自明确边界；
  - 升级 `plugin/server/upstream-radar.mjs` 与 `scripts/check-upstream.mjs`（Compare API + 三分类：`兼容性必看 / 实用新功能候选 / 建议跳过` + `--markdown` / `--sync-baseline` + GPL Clean-Room 警示），坚持**只吸收有益部分、供用户决定是否融合、绝不照搬照抄**；
  - 工作台按需点击检查 + 新增 `.github/workflows/upstream-watch.yml` 每周定时巡检并在发现 `HIGH`/`MEDIUM` 变更时幂等更新唯一候选清单 Issue。

## 0.4.1 - 2026-11-25

- **全项目四模型联合审计加固（P0/P1/P2 全清）**：
  - **Prism 文件工作台 2.0 安全边界升级**：`open_prism_files` 与同步文件接口全链路拦截未授权 UNC/SMB 与设备前缀；`searchTranscripts` 改为**先脱敏再匹配截取**（彻底杜绝私钥/Token 中段泄露）；`resolveHomeAndBrain` 对 `brainDir` 递归 `realpathSync` 归一化（防软链/联接点绕过只读保护）；`isSensitivePath` 拦截 Windows NTFS ADS（`::$DATA`）与尾随点/空格绕过；WSL UNC `.localhost`/`wsl$` 自动转换与 `.cmd` 显式参数安全启动；`inline.html`「打开方式 ▾」弹出时动态同步 iframe 高度防裁切；`app.html` Markdown 引用块递归上限 16 层。
  - **核心总线 & 交互体验加固**：补齐 `unregisterPanelSection` / `unregisterOutlineAction`、去除 `setPref` 冗余二次渲染、大纲点击防外层误关且重构为无嵌套合规 HTML、思考译文盒弱引用精确清理、统一高优 `Escape` 浮层栈、`keepOverviewOpen` 限定仅 `/c/<id>` 会话路由生效、禁止原位编辑自动点击通用 `Undo/Revert`、修复 `cleanCopy` 对异步 `navigator.clipboard.writeText` 支持、修复安装器 `C:\` 盘符根路径与 `--plugin-dir` 嵌套问题。
- **小精灵主动避障 + 指针闪避 + 防遮挡质感浮窗**：
  - 新增输入框周边控件障碍检测，自动将小精灵停靠并漫游在安全区域；当鼠标指针靠近踩中胶囊 `^` / `×` 等按钮的小精灵时，触发短距灵动快跑让位（`💨` 微表情 + 穿透点击不挡操作）；
  - 移除原生 `title` 提示，全面切换为正上方预留间隙、绝不遮挡指针的圆角毛玻璃状态浮窗（带运行中/待命状态色点）。
- **手动切号自动回跳上次会话 + 5h/7d 额度交接提醒**：
  - 默认零风险记住进入 `/settings` 前最后一个 `/c/<id>` 会话路由，停留在设置页时浮现「返回上次会话 ↩ / 留在设置」一键回跳条（可选开启安全倒计时自动回跳，绝不盲关未知弹窗、100% 保留全部会话记录）；
  - 新增 5h ≤ 10%（建议先切另一模型家族）与 7d ≤ 5%（提示存交接并切备用号，一键复制交接指令）轻量化去重提醒条。

## 0.4.0 - 2026-11-25

- **模块化事件总线与零卡顿性能加固（`window.__agPrismBus v4`）**：
  - 核心扩展 `prism-suite.js` 发布加载顺序无关的版本化总线（支持 `AbortController` 热重载无残留清理），将新功能清晰拆分为 `prism-suite-fx.{js,css}` 与 `prism-suite-workflow.{js,css}`；
  - 新增 `<html>` 属性与 CSS 变量脏检查、已完成历史轮次 `WeakMap` 缓存、CJK 输入法组合态（`compositionstart/end`）与触屏拖动期防抖礼让；
  - 新增主题自适应自定义悬浮提示（`data-ag-ps-tip`）与控制面板底部按需 **GitHub 新版本检查胶囊**。
- **视觉特效、排版与侧栏细节（`prism-suite-fx`）**：
  - **工作时输入框流光边框（Border Beam，默认关闭）**：基于单共享 `rAF` 调度器的 Canvas 2D 圆角矩形周长彗星流光，支持 `theme / gemini / aurora / prism / neon / quota` 6 套配色与「试用 3s」即时预览，空闲/隐藏/失焦严格 `0fps` 停帧；
  - **输入框额度光环（默认关闭）**：0fps 静态 SVG 外框顺时针展示 `5h / 周 / 较低项` 剩余额度，工作时与流光边框自动平滑互斥切换；
  - **ThinkingOrb 3D 粒子任务进度球（默认关闭）**：预分配 128 颗 Fibonacci 球面粒子随思考/工具/输出/完成态形变，悬停带视差倾角，收敛 1.2s 自动停帧，支持与像素萌宠共存或替换；
  - **实用排版与交互**：用户消息气泡着色（5 色系 + `10%–100%` 滑条 + 自动对比度）、紧凑排版开关、后台完成窗口标题 `(N)` 未读数提醒、项目默认展示会话数、切换会话保持右侧概览展开、多轮对话侧边常驻圆点目录。
- **效率工作流、多语言与会话分支（`prism-suite-workflow` + `scripts/fork-session.mjs`）**：
  - **对话图片右键三连**：右键会话图片弹出主题菜单，支持「引用到输入框」「复制图片（PNG）」「保存图片」；
  - **回复复制过滤折叠摘要**：点击回复复制按钮自动滤除已折叠思考/工具摘要，完整保留代码块与原生打勾动效；
  - **SSH 粘贴自动解析**：在 SSH Host 弹窗粘贴 `ssh -p 端口 用户@主机` 自动提取并丢弃附带密码；
  - **2.34–2.35 & Swarm 增量多语言补全**：支持 `关 / 简 / 繁 / 英` 切换与 `WeakMap` 无损还原，零全局 `MutationObserver`；
  - **原位消息编辑补位 & 历史轮次分支**：轮次悬停提供快捷「编辑」（优先联动 Anti-Claude 原生 Undo 编辑，不可用时启动乐观锁原位编辑器）与「分支」（同步接入大纲抽屉，附零依赖回环 CDP 脚本 `scripts/fork-session.mjs`）。
- **Prism 文件工作台 2.0（`prism-files` MCP App）**：
  - **修复 Windows 含空格/逗号/盘符根目录资源管理器定位**：原生 `win32` 改用 `/select,"<path>"` + `windowsVerbatimArguments: true`，WSL 采用双参数 `['/select,', winPath]` 规避引号转义；
  - **可选私网 LAN NAS/SMB 路径支持（默认关闭）**：开启前强制校验全部 DNS 解析 IP 与字面量均属 RFC1918 / Tailscale CGNAT / ULA / 环回 / `wsl$`，严格拦截公网主机防 NTLM 凭据泄漏；
  - **「打开方式 ▾」动态探测本机编辑器与终端**：自动识别 VS Code、Cursor、Windsurf、Antigravity、Zed、JetBrains、Windows Terminal、Git Bash 等并支持 `#L:C` 行列号直达，Windows `.cmd/.bat` 经元字符拦截后显式经 `cmd.exe /d /s /c` 安全启动（规避 Node 22 `EINVAL`）；
  - **跨历史会话脱敏全文检索**：工作台新增第 4 标签页 **`历史检索`**，在符号链接根牢笼与时间/体积预算内检索本地 `transcript.jsonl`（支持 `全部 / 正文 / 代码与命令` 筛选），自动脱敏 API Key / Token / 私钥片段。

## 0.3.0 - 2026-11-25

- **全新融合 · Prism 文件工作台（原生 Antigravity MCP App 插件，零外部依赖）**：
  - **侧边栏 & 全局三合一工作台（`open_prism_files`）**：支持工作区文件树浏览、`Ctrl/Cmd+L` 路径直达、实时检索、隐藏文件切换、代码/Markdown（渲染预览 + 带 SHA-256 乐观锁的安全原位编辑）/图片双栏分屏预览、**划词引用给 AI**（`ui/update-model-context`）、一键在 Antigravity 原生标签页打开（`com.google.antigravity/toggle-aux-pane`）、**`~/.gemini/antigravity/brain` 最近产物速查**与持久化收藏夹；
  - **消息流内联文件卡片（`show_files_inline`）**：产出文件时直接在对话中渲染交互卡片，支持一键原生打开、引用上下文，以及 **全平台双击高亮定位系统文件管理器**（Windows `explorer.exe /select,`、WSL 自动 `wslpath -w` 桥接 Windows 资源管理器、macOS `open -R`、Linux `xdg-open`）；
  - **严格安全与零上下文膨胀**：模型仅见 2 个轻量工具，其余 7 个交互工具均设为 `visibility: ["app"]`；预览与写入均前置拦截 `.env`/密钥/`.codex`/`.claude`/`.ssh` 等凭据路径，且 `brain/` 产物目录强制只读。
- **Windows 一键图形化安装器 `.exe`（零运行库依赖）**：
  - 新增纯 C# WinForms 安装器源码（`installer/win/PrismSuiteInstaller.cs`）与一键打包脚本（`scripts/build-win-exe.ps1`），内置全量扩展与插件资源，双击自动探测 Windows Anti-Claude 目录、Windows 插件目录与 **WSL 真实 `$HOME` 插件目录**，支持「一键安装 / 更新」与「干净卸载」；
  - 新增 GitHub Actions Release 工作流（`.github/workflows/release.yml`），打 Tag 自动构建并发布 `Anti-Claude-Prism-Suite-Setup.exe` 与 SHA-256 校验文件。
- **一体化 CLI 安装/卸载**：`node install.mjs` 与 `node uninstall.mjs` 现默认同步部署/清理 Anti-Claude 扩展与 `prism-files` MCP App 插件（支持 `--extensions-only` / `--plugin-only`）。

## 0.2.4 - 2026-11-25

- **控制面板与大纲视觉精修**：
  - 将「像素小伙伴」子设置归组进柔和浅底内嵌子面板（`.ag-ps-subpanel`），主开关与子设置层次一目了然；
  - 分段选择器升级为克制的「轨道 + 浮起白/暗块」风格，收敛视觉强调色，仅把主题主色留给激活开关、当前配色框与滑块拇指；
  - 去掉弹窗与大纲标题旁的灰色装饰胶囊，改用 `tabular-nums` 排版元数据，并定制 `4px` 细轨滑块与 `160ms` 缓出浮层入场微动效（严格遵守 `prefers-reduced-motion`）。
- **新增 2 套护眼配色 + 双色圆点色卡**：深浅配色扩展为 `2×2` 网格并升级「底色 + 强调色」双色预览圆点，新增浅色 **`松雾青岚`**（雾青纸底 + 苍松翠绿）与深色 **`深海墨蓝`**（午夜海蓝底 + 冰海青蓝），热力图与配额全自动联动。
- **像素伙伴对话气泡 60fps 零开销跟随**：将气泡锚定至说话小精灵外层容器并附底部小尖角与左右防裁切对齐。

## 0.2.3 - 2026-11-25

- **像素伙伴 5 项零开销趣味体验升级**：
  - **伙伴性格档位（`温顺` / `活泼`）**：温顺模式仅慢速踱步与轻跳不翻滚；活泼模式全开前空翻、滚翻冲刺、集体波浪翻与击掌互动；
  - **头顶状态微表情**：零额外 RPC，自动联动当前上下文水位与阶段——深度思考 `💡`、工具执行 `🔧`、高水位/缓存塌陷提醒 `💦`、空闲休眠纯静态 `zZ`；
  - **同伴擦肩击掌**：漫游落地时 O(N) 轻量距离检测（6 秒冷却），擦肩相遇时面对面轻跳击掌并弹出 `🤝 / ⚡`；
  - **摸头 5 连击彩蛋**：2 秒内连点同一小精灵 5 次触发原地三连空翻与专属傲娇台词（零全局 `mousemove` 监听）；
  - **高 TTFT 长等待发呆 + 首字惊醒**：发问超过 8 秒未出首字原地轻晃打盹，首字吐出瞬间全员弹跳惊醒恢复全速巡逻。

## 0.2.2 - 2026-11-25

- **像素伙伴工作态漫游跑跳、杂技动作与 `tok/s` 变速（独立开关，默认开启）**：AI 或蜂群/子 Agent 工作时，小精灵沿输入框顶边全宽透明轨道自主随机小跑、**360° 前空翻跟头**、**翻滚冲刺**、**二段连跳**、**开心摇摆**、高跳与左右张望，运动速度与步频随实时 **`tok/s`** 动态变速（`0.75× ~ 2.05×`）；任务完成归位瞬间全体错峰触发**波浪式集体翻跟头**庆祝，点击任意小精灵也会随机表演彩蛋动作，闲时 5 秒后自动恢复 `0fps` 零定时器休眠。
- **像素伙伴无级大小调节**：控制面板新增 `16px ~ 36px`（步进 `2px`）实时无级滑块与一键复位（默认 `24px`），底部锚点自动贴合输入框顶边不偏移。
- **动态 Agent 数量模式（固定 / 跟随 Agent + 1~3 只保底）**：新增「跟随 Agent」数量模式，直接复用 Anti-Claude 实时下发的蜂群与子 Agent 谱系（零额外 RPC/SQLite 开销），按 `1 主控 + 存活蜂群/子 Agent` 自动增减精灵（上限 8 只 + `+N` 徽章），并支持自定义 **`1~3 只保底数量`** 防止无子 Agent 时空屏；扩充至 6 种原创 `12×11` 像素萌物（橘蟹 / 紫猫 / 蓝史莱姆 / 绿蛙 / 金雏 / 粉兔），支持按单个 Agent 实时 `running` 状态独立跑跳与悬停查看名称。

## 0.2.1 - 2026-11-25

- **思考翻译视觉柔化**：移除译文块的灰底色块、粗蓝左竖线与醒目标题，改用与 Antigravity 原生思考流融为一体的轻灰无框排版；沉浸模式下完全贴合原生视觉，仅在顶部右侧保留极淡的 `查看原文` 按钮。
- **README 实机预览**：补充控制面板、用量统计（14 天柱图 + 名著换算 + 12 周热力图）与输入框三萌像素小伙伴三张 2x 高清实机截图。

## 0.2.0 - 2026-11-25

- **彻底消除输入框打字迟滞（性能优化）**：移除常驻 `document.body` 的全局 `MutationObserver`，水墨淡入改为仅在 AI 生成态监听 `[data-testid="autoscroll-viewport"]`（与输入框完全隔离，打字 0 回调），复用 5 个固定 `Highlight` 对象并限频至 30fps，支持 `prefers-reduced-motion`；后台 `tickAll` 放宽至 2.4s 并加入输入静默礼让（打字后 1.8s 不扫 DOM）与页面隐藏暂停；概览补挂观察器去掉 `subtree: true`。
- **扩展隔离与翻译稳定性（交叉审计 P0 修复）**：
  - 守护进程加载扩展前通过 `node:vm` 预检语法错误并用独立 `try/catch` 隔离，单扩展异常绝不波及 `custom.js`；
  - 翻译 RPC 改为按段落/句边界 ≤ 950 字符短分片顺序合并（支持最长 10,000 字，杜绝 HTTP 414）；
  - 思考翻译不再在流式生成中每 1.4s 重复发请求，折叠后自动清理译文不残留，沉浸模式下每块新增「看原文 / 隐藏原文」一键切换按钮。
- **交互与视觉打磨（交叉审计 P1 修复）**：
  - 浮卡与大纲动态贴合按钮正下方 8px，支持 `Esc` 关闭并归还焦点、`window.resize` 自动重定位；
  - 浅色模式下点选深色配色（或反之）提供即时反馈提示；
  - `Alt+↑/↓` 跳轮改为每次基于当前视口位置重新计算，大纲高亮当前阅读轮次；`/btw` 填入失败自动降级复制剪贴板；
  - 12 周热力图严格按周一~周日对齐自然周，补齐 `partial` 续拉，新增连续活跃天数（Streak）、活跃日均与《四库全书》大额换算标尺。
- **上游双仓伴随更新体系**：新增 `upstream.json` 与 `npm run check-upstream`（`scripts/check-upstream.mjs`），一键追踪 `hongqi7/Anti-Claude` 与 `RMvdesi/obsidian-prism` 上游动态并核查本地底座接口兼容性。

## 0.1.0 - 2026-11-25

- 首次发布 **Anti-Claude Prism Suite**（Clean-room 独立可扩展插件套件）。
- 支持四套深浅主题、会话大纲与 `Alt+↑/↓` 跳轮、用量名著换算与 12 周热力图、五级水墨流式吐字淡入、输入框 0fps 像素小伙伴、思考过程实时中文转译，以及 `install.mjs` / `uninstall.mjs`。
