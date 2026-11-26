---
name: prism-upstream-absorb
description: 执行 Anti-Claude Prism Suite 上游雷达候选更新的 Clean-Room 选择性融合标准作业流。当用户从 Prism 工作台复制粘贴“上游更新融合指令”或要求评估融合 upstream.json 监控源更新时使用。
---

# Prism 上游更新 Clean-Room 选择性吸收标准作业流

本技能用于处理用户从 Prism 工作台「上游雷达（Upstream Radar）」面板勾选并复制的**上游更新融合指令**，确保每一次吸收都严格受控、协议合规且零冗余污染。

## 1. 核心吸收准则：只看勾选项，未勾选一律跳过

1. **严格遵从用户勾选范围**：仅评估与实现用户在融合指令中明确勾选（`[x]` 或显式指定 commit/特性）的条目；
2. **默认跳过未选与杂项**：用户未勾选的候选功能、上游专属品牌文案、打包发布流水线、说明文档噪音一律跳过，严禁顺手全盘照搬或夹带额外重构；
3. **前置核对边界配置**：动手前先读取仓库根目录 `upstream.json` 对应监控源的 `role`、`license`、`absorptionPolicy`、`adoptionBoundary`、`watchedPaths` 与 `excludedPaths`。

## 2. 开源协议与安全隔离红线矩阵

针对不同角色与许可证的上游仓库，必须执行对应的 Clean-Room 门禁：

- **MIT 协议上游（`host-runtime` / `feature-reference` / `ecosystem-watch`）**
  - 仅吸收有实际价值的守护进程钩子兼容适配或精悍交互特性；
  - 必须改写为符合本仓库架构的 **零外部 npm 运行时依赖**（仅使用 Node.js >= 22 内置模块与原生 Web API）实现，拒绝引入重型第三方包。
- **Apache-2.0 协议上游（如 `browser-cua-reference`）**
  - 优先采用 Clean-Room 方式独立实现扩展桥协议交互与无障碍快照压缩算法；
  - **强制署名红线**：若确需直接复用或派生任何 Apache-2.0 代码片段，必须保留上游版权声明与变更说明，并同步登记至根目录 `THIRD_PARTY_NOTICES.md`。
- **GPL-3.0 / AGPL 协议上游（`inspiration-only`）**
  - **绝对源码隔离**：仅允许从 Release Notes 或界面效果描述中借鉴视觉排版、配色与动效交互构思，由本仓库从零独立编写代码；
  - **严禁读取其源码目录（如 `excludedPaths` 中的 `src/`、`styles.css`），严禁复制、翻译或移植任何一行 GPL 代码**。
- **CUA 桌面与浏览器无障碍操控参考上游（`cua-reference` / `browser-cua-reference` / 安全策略参考源）**
  - **严禁引入任何预编译二进制文件**（包括但不限于 `.exe`、`.dll`、`.node`、`.dylib`、`bin/`、`native/` 产物）或捆绑重型浏览器驱动；
  - **严禁开启遥测与高危裸露工具**：外部兼容桥接必须强制设置 `ANONYMIZED_TELEMETRY=false`，默认排除 `Shell`、`Registry`、`FileSystem`、`Process` 等高危系统面，并保留操控边缘胶囊提示（`control_overlay`）与显式用户授权（`control_consent`）机制。

## 3. 五步标准执行流水线（SOP）

1. **解析指令与确认边界**
   - 提取目标上游键名、基线至目标版本区间及用户勾选的具体条目，复核上述协议与二进制红线。
2. **只读契约与思路审阅**
   - 仅针对勾选项关联的 `watchedPaths` 或公开变更摘要做只读对比分析，提炼最小可逆实现方案，不污染本地无关模块。
3. **Clean-Room 独立编码落地**
   - 在纯 Node.js 内置模块与零个人隐私硬编码约束下完成本地代码编写；凡涉及双端同步配置文件（如根 `upstream.json` 与 `plugin/upstream.json`），必须保持字节级完全一致。
4. **双端语法校验与回归自测**
   - 对全部新增/修改脚本执行 `node --check` 语法校验；
   - 运行项目测试套件（覆盖桌面扩展侧与 MCP 插件服务端核心单测），确认原有功能与新融合项全部通过，且无任何私有路径、IP 或凭据残留。
5. **同步上游基线并交付回执**
   - 验证全部绿灯后，执行 `node scripts/check-upstream.mjs --sync-baseline`（或指定本次已完成评估的上游键名）更新基线标签与 commit，并再次校验根 `upstream.json` 与 `plugin/upstream.json` 完全一致；
   - 向用户输出简明回执：已融合勾选项、已跳过的未勾选项、协议/安全合规核验结果及测试通过摘要。
