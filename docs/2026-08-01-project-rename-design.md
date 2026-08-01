# Claude Panel Status — 项目独立重命名设计

**日期：** 2026-08-01
**状态：** 已批准

## 背景

当前项目 `claude-status-chip` fork 自 `omarkara/claude-status-chip`，但已大量偏离原项目：非官方 API 兼容、context 百分比显示、compact/clear 检测、transcript usage 回退等。为方便后续独立开发和功能扩展，需要将项目完全独立出来。

## 决策摘要

| 项目 | 旧值 | 新值 |
|------|------|------|
| 项目名 | `claude-status-chip` | `claude-panel-status` |
| 显示名 | Claude Status Chip | Claude Panel Status |
| 起始版本 | 1.1.0 | 2.0.0 |
| 代码前缀 | `cc-status` | `cp-status` |
| Open VSX 发布者 | omarkara | louxiaxiaohei |
| 仓库 | LouXiaXiaoHei/claude-status-chip | LouXiaXiaoHei/claude-panel-status |

## 方案选择

**选定：方案 A — 一次性全面重命名**

理由：项目已大幅偏离原项目，既然决定独立就应一步到位。localStorage 偏好丢失是小问题（加迁移逻辑即可），代码一致性是长期收益。

备选方案：
- 方案 B（外重内轻）：只改外部标识，代码保留 cc-status — 不够独立
- 方案 C（渐进式）：加兼容层过渡 — 增加复杂度，最终仍需清理

## 详细设计

### 1. package.json 元数据变更

| 字段 | 旧值 | 新值 |
|------|------|------|
| `name` | `claude-status-chip` | `claude-panel-status` |
| `displayName` | `Claude Status Chip` | `Claude Panel Status` |
| `version` | `1.1.0` | `2.0.0` |
| `description` | ...chip... + "Fork with..." | 更新为 panel 措辞，去掉 fork 描述 |
| `repository.url` | ...claude-status-chip.git | ...claude-panel-status.git |
| `homepage` | ...claude-status-chip#readme | ...claude-panel-status#readme |
| `bugs.url` | ...claude-status-chip/issues | ...claude-panel-status/issues |
| `keywords` | `["claude","claude-code","statusline","status bar"]` | `["claude","claude-code","statusline","status bar","panel"]` |

不变字段：`publisher`（louxiaxiaohei）、`license`（MIT）、`author`、`engines`、`categories`、`activationEvents`。

### 2. 代码内部标识重命名

所有 `cc-status` → `cp-status` 的映射：

| 位置 | 旧值 | 新值 |
|------|------|------|
| MARKER 常量 | `"cc-status-chip"` | `"cp-status-panel"` |
| localStorage key | `"cc-status-prefs"` | `"cp-status-prefs"` |
| CSS class 前缀 | `.cc-status-chip` | `.cp-status-panel` |
| CSS style element ID | `cc-status-style` | `cp-status-style` |
| 菜单 ID | `cc-status-menu` | `cp-status-menu` |
| 菜单 style ID | `cc-menu-style` | `cp-menu-style` |
| 齿轮按钮 class | `.cc-gear` | `.cp-gear` |
| 缩放按钮 class | `.cc-zbtn` | `.cp-zbtn` |
| 备份文件后缀 | `.cc-status.bak` | `.cp-status.bak` |
| 日志消息前缀 | `cc-status:` | `cp-status:` |
| 用户自定义 patcher 路径 | `~/.claude/patch-claude-vscode-status.js` | `~/.claude/patch-claude-vscode-panel.js` |
| extension.js 注释 | `Claude Status Chip` | `Claude Panel Status` |
| test 临时目录前缀 | `cc-status-probe-` | `cp-status-probe-` |

#### localStorage 偏好迁移

在 patch-core.js 的注入代码中，初始化偏好时加迁移逻辑：

```javascript
// 迁移旧版 cc-status-prefs → cp-status-prefs
var oldPrefs = localStorage.getItem("cc-status-prefs");
var newPrefs = localStorage.getItem("cp-status-prefs");
if (oldPrefs && !newPrefs) {
  localStorage.setItem("cp-status-prefs", oldPrefs);
  localStorage.removeItem("cc-status-prefs");
}
```

#### 备份文件兼容

在 patch-core.js 的 run() 函数中，检测到旧的 `.cc-status.bak` 时将其重命名为 `.cp-status.bak`：

```javascript
const oldBak = ext.file + ".cc-status.bak";
const newBak = ext.file + ".cp-status.bak";
if (fs.existsSync(oldBak) && !fs.existsSync(newBak)) {
  fs.renameSync(oldBak, newBak);
}
```

### 3. README 和文档更新

- 标题改为 `# Claude Panel Status`
- Open VSX 徽章和链接更新为 `louxiaxiaohei/claude-panel-status`
- 安装说明中的 vsix URL 和 `code --install-extension` 命令更新
- 新增 fork 声明段落：`> **Forked from** [omarkara/claude-status-chip](https://github.com/omarkara/claude-status-chip) — original MIT-licensed project by Omar Kara.`
- 描述中 "chip" 措辞改为 "panel status indicator"
- 历史设计文档（docs/ 目录）不修改

### 4. Git 仓库和发布

- 在 GitHub 创建新仓库 `LouXiaXiaoHei/claude-panel-status`
- 推送完整 git 历史到新仓库
- 旧仓库 README 顶部加迁移提示指向新仓库
- 本地 remote URL 更新为新仓库
- Open VSX 以 `louxiaxiaohei.claude-panel-status` 发布，版本 2.0.0

### 5. 不涉及的事项

- LICENSE 文件内容不修改
- .gitignore 不修改
- 测试框架和构建流程不修改
- 历史设计文档不修改

## 影响范围

| 文件 | 变更类型 |
|------|----------|
| `package.json` | 元数据全面更新 |
| `patch-core.js` | 标识重命名 + 迁移逻辑 + 备份兼容 |
| `extension.js` | 注释更新 |
| `test/patch-core.test.js` | 临时目录前缀更新 |
| `README.md` | 标题、链接、安装说明、fork 声明 |
| `AGENTS.md` | 项目名引用更新（如有） |

## 风险和缓解

| 风险 | 缓解措施 |
|------|----------|
| localStorage 偏好丢失 | 迁移逻辑自动复制旧 key 到新 key |
| 旧备份文件不识别 | 自动重命名 .cc-status.bak → .cp-status.bak |
| patch-core.js 注入代码改错导致白屏 | 逐项替换 + 运行测试验证 |
| Open VSX 新发布需要审核 | 提前发布，不影响代码变更 |
