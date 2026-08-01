# 项目独立重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目从 `claude-status-chip` 全面重命名为 `claude-panel-status`，包括 package.json 元数据、代码内部标识、CSS class、localStorage key、备份文件后缀、README 和 Git 仓库。

**Architecture:** 一次性全面重命名（方案 A）。所有 `cc-status` 前缀改为 `cp-status`，所有 `__cc` 内部变量改为 `__cp`。新增 localStorage 偏好迁移逻辑和备份文件兼容逻辑。

**Tech Stack:** Node.js, VSCode Extension API, 纯 JS（无构建工具）

## Global Constraints

- 项目名：`claude-panel-status`，显示名：`Claude Panel Status`
- 版本：`2.0.0`
- 代码前缀：`cc-status` → `cp-status`
- 内部变量前缀：`__cc` → `__cp`
- MARKER：`cc-status-chip` → `cp-status-panel`
- publisher 不变：`louxiaxiaohei`
- license 不变：`MIT`
- 历史设计文档不修改
- 所有测试必须在重命名后通过

---

### Task 1: package.json 元数据更新

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: 无
- Produces: 新的 package.json name/version/description/URLs，后续 Task 依赖这些值

- [ ] **Step 1: 更新 package.json 所有元数据字段**

将 `package.json` 内容替换为：

```json
{
  "name": "claude-panel-status",
  "displayName": "Claude Panel Status",
  "description": "Always-visible panel status indicator inside the Claude Code panel: model, git branch (live), context usage with progress fill, reasoning effort, extended thinking, session cost — plus a gear menu with per-item toggles and transcript-only zoom. Self-heals after Claude extension auto-updates. Non-official API source compatibility (context window fallback).",
  "version": "2.0.0",
  "publisher": "louxiaxiaohei",
  "license": "MIT",
  "author": {
    "name": "Howard Stark",
    "url": "https://github.com/LouXiaXiaoHei"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/LouXiaXiaoHei/claude-panel-status.git"
  },
  "homepage": "https://github.com/LouXiaXiaoHei/claude-panel-status#readme",
  "bugs": {
    "url": "https://github.com/LouXiaXiaoHei/claude-panel-status/issues"
  },
  "icon": "icon.png",
  "pricing": "Free",
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": [
    "Other"
  ],
  "keywords": [
    "claude",
    "claude-code",
    "statusline",
    "status bar",
    "panel"
  ],
  "main": "./extension.js",
  "activationEvents": [
    "onStartupFinished"
  ]
}
```

- [ ] **Step 2: 验证 JSON 格式正确**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "refactor: rename package to claude-panel-status v2.0.0"
```

---

### Task 2: patch-core.js 全面重命名

**Files:**
- Modify: `patch-core.js`

**Interfaces:**
- Consumes: 无
- Produces: 新的 MARKER `cp-status-panel`、新的 localStorage key `cp-status-prefs`、新的 CSS class `.cp-status-panel`、新的 `window.__cpStatus` API、新的备份后缀 `.cp-status.bak`、迁移逻辑

这是最大的改动。按区域分步执行，每步都是精确的字符串替换。

- [ ] **Step 2.1: 更新文件顶部注释**

将第 7 行：
```
// localStorage ("cc-status-prefs").
```
替换为：
```
// localStorage ("cp-status-prefs").
```

将第 9 行：
```
// A backup of the original bundle is kept next to it as index.js.cc-status.bak.
```
替换为：
```
// A backup of the original bundle is kept next to it as index.js.cp-status.bak.
```

将第 12 行：
```
//   CLI:    node patch-claude-vscode-status.js          (SessionStart hook does this)
```
替换为：
```
//   CLI:    node patch-claude-vscode-panel.js          (SessionStart hook does this)
```

将第 13-14 行：
```
//   module: require(...).run()                          (the cc-status-patcher companion VSCode
//                                                        extension calls this on startup + every 60s)
```
替换为：
```
//   module: require(...).run()                          (the cp-status-patcher companion VSCode
//                                                        extension calls this on startup + every 60s)
```

- [ ] **Step 2.2: 更新 MARKER 常量**

将第 19 行：
```javascript
const MARKER = "cc-status-chip";
```
替换为：
```javascript
const MARKER = "cp-status-panel";
```

- [ ] **Step 2.3: 更新 runtime 数组中的 localStorage key 和迁移逻辑**

将第 144 行：
```javascript
'var K="cc-status-prefs";',
```
替换为：
```javascript
'var K="cp-status-prefs";',
```

在第 144 行之后（`'var K="cp-status-prefs";',` 之后），插入迁移逻辑：
```javascript
// 迁移旧版 cc-status-prefs → cp-status-prefs
'var _op=localStorage.getItem("cc-status-prefs");if(_op&&!localStorage.getItem(K)){localStorage.setItem(K,_op);localStorage.removeItem("cc-status-prefs")}',
```

- [ ] **Step 2.4: 更新 runtime 中的 window API 名称**

将第 150 行：
```javascript
'var api=window.__ccStatus={};',
```
替换为：
```javascript
'var api=window.__cpStatus={};',
```

- [ ] **Step 2.5: 更新 runtime 中的 CSS style element ID**

将第 157 行：
```javascript
'api.applyZoom=function(){styleEl("cc-zoom").textContent=api.zoom()===1?"":"[class*=messagesContainer_]{zoom:"+api.zoom()+"}"};',
```
替换为：
```javascript
'api.applyZoom=function(){styleEl("cp-zoom").textContent=api.zoom()===1?"":"[class*=messagesContainer_]{zoom:"+api.zoom()+"}"};',
```

- [ ] **Step 2.6: 更新 runtime 中的 CSS class 和 style element ID**

将第 158 行：
```javascript
'api.applyCss=function(){var css="";for(var i=0;i<SEGS.length;i++){var k=SEGS[i][0];if(api.prefs[k]===false)css+=".cc-status-chip [data-seg="+k+"]{display:none}"}styleEl("cc-status-style").textContent=css};',
```
替换为：
```javascript
'api.applyCss=function(){var css="";for(var i=0;i<SEGS.length;i++){var k=SEGS[i][0];if(api.prefs[k]===false)css+=".cp-status-panel [data-seg="+k+"]{display:none}"}styleEl("cp-status-style").textContent=css};',
```

- [ ] **Step 2.7: 更新 runtime 中的菜单 ID**

将第 163 行：
```javascript
'var old=document.getElementById("cc-status-menu");if(old){old.remove();return}',
```
替换为：
```javascript
'var old=document.getElementById("cp-status-menu");if(old){old.remove();return}',
```

将第 165 行：
```javascript
'var mnu=document.createElement("div");mnu.id="cc-status-menu";',
```
替换为：
```javascript
'var mnu=document.createElement("div");mnu.id="cp-status-menu";',
```

- [ ] **Step 2.8: 更新 runtime 中的缩放按钮 class**

将第 186 行中的 `cc-zbtn`：
```javascript
'function zb(t,d){var b=document.createElement("button");b.type="button";b.className="cc-zbtn";
```
替换为：
```javascript
'function zb(t,d){var b=document.createElement("button");b.type="button";b.className="cp-zbtn";
```

- [ ] **Step 2.9: 更新 runtime 中的菜单样式字符串**

将第 198 行整行替换。旧值包含 `#cc-status-menu`、`.cc-zbtn`、`.cc-status-chip .cc-gear`。新值：

```javascript
'styleEl("cp-menu-style").textContent="#cp-status-menu label{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;cursor:pointer}#cp-status-menu label:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.12))}#cp-status-menu input[type=checkbox]{accent-color:var(--vscode-button-background,#0e639c);margin:0}#cp-status-menu input[type=number]{outline:none}#cp-status-menu input[type=number]:focus{border-color:var(--vscode-focusBorder,#007fd4)}#cp-status-menu .cp-zbtn{width:24px;height:24px;cursor:pointer;border-radius:5px;border:1px solid var(--vscode-widget-border,#454545);background:var(--vscode-button-secondaryBackground,#3a3d41);color:inherit;font-size:13px;line-height:1}#cp-status-menu .cp-zbtn:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)}.cp-status-panel .cp-gear{transition:transform .15s ease,opacity .15s ease}.cp-status-panel .cp-gear:hover{opacity:1;transform:rotate(45deg)}";',
```

- [ ] **Step 2.10: 更新 chip 函数中的 `__cc` → `__cp` 内部变量**

在 chip 函数的注入代码中，所有 `__cc` 前缀改为 `__cp`。具体替换（按出现顺序）：

1. `__ss.__ccCWFixed` → `__ss.__cpCWFixed` （2 处：条件判断 + 赋值）
2. `__ss.__ccLastCW` → `__ss.__cpLastCW` （3 处：赋值、条件、fallback）
3. `__ss.__ccLastT` → `__ss.__cpLastT` （5 处：赋值、条件、fallback、debug title）
4. `__ss.__ccUsageSid` → `__ss.__cpUsageSid` （4 处：赋值、读取、比较）
5. `__ss.__ccAllowZeroOnce` → `__ss.__cpAllowZeroOnce` （3 处：赋值、读取、compact 处理）
6. `__ss.__ccSetCount` → `__ss.__cpSetCount` （3 处：递增、debug title）
7. `__ss.__ccProbeGen` → `__ss.__cpProbeGen` （6 处：递增、比较、赋值）
8. `__ss.__ccProbeSid` → `__ss.__cpProbeSid` （3 处：比较、赋值）
9. `__ss.__ccWasBusy` → `__ss.__cpWasBusy` （3 处：赋值、读取）
10. `__ss.__ccBrPoll` → `__ss.__cpBrPoll` （2 处：条件、赋值）
11. `window.__ccStatus` → `window.__cpStatus` （3 处：customCW 调用、openMenu 调用）

**最安全的方式：** 在 patch-core.js 上执行全局替换 `__cc` → `__cp`，这会覆盖所有上述变量。验证替换后没有遗漏的 `__cc` 引用。

- [ ] **Step 2.11: 更新 chip 函数中的齿轮按钮 class**

将第 364 行：
```javascript
kids.push(${jsx}("button",{type:"button",className:"cc-gear",
```
替换为：
```javascript
kids.push(${jsx}("button",{type:"button",className:"cp-gear",
```

将第 365 行：
```javascript
onClick:function(ev){if(window.__ccStatus)window.__ccStatus.openMenu(ev)},
```
替换为：
```javascript
onClick:function(ev){if(window.__cpStatus)window.__cpStatus.openMenu(ev)},
```

（注：如果 Step 2.10 已全局替换 `__cc` → `__cp`，则第 365 行已自动更新。）

- [ ] **Step 2.12: 更新 run() 函数中的日志消息和备份文件后缀**

将第 375 行：
```javascript
if (!ext) return { status: "none", message: "cc-status: Claude Code VSCode extension not found — nothing to patch" };
```
替换为：
```javascript
if (!ext) return { status: "none", message: "cp-status: Claude Code VSCode extension not found — nothing to patch" };
```

将第 377 行：
```javascript
if (src.includes(MARKER)) return { status: "already", file: ext.file, message: "cc-status: already patched — " + ext.file };
```
替换为：
```javascript
if (src.includes(MARKER)) return { status: "already", file: ext.file, message: "cp-status: already patched — " + ext.file };
```

将第 381 行：
```javascript
message: "cc-status: anchor not found in " + ext.file + " — the extension bundle changed; the patch needs updating for this version.",
```
替换为：
```javascript
message: "cp-status: anchor not found in " + ext.file + " — the extension bundle changed; the patch needs updating for this version.",
```

将第 383-384 行：
```javascript
const bak = ext.file + ".cc-status.bak";
if (!fs.existsSync(bak)) fs.copyFileSync(ext.file, bak);
```
替换为：
```javascript
// 迁移旧版备份文件
const oldBak = ext.file + ".cc-status.bak";
const bak = ext.file + ".cp-status.bak";
if (fs.existsSync(oldBak) && !fs.existsSync(bak)) fs.renameSync(oldBak, bak);
if (!fs.existsSync(bak)) fs.copyFileSync(ext.file, bak);
```

将第 391 行：
```javascript
message: "cc-status: patched " + ext.file + " (backup: " + path.basename(bak) + "). Reload the VSCode window to see it.",
```
替换为：
```javascript
message: "cp-status: patched " + ext.file + " (backup: " + path.basename(bak) + "). Reload the VSCode window to see it.",
```

- [ ] **Step 2.13: 验证没有遗漏的 `cc-status` 或 `__cc` 引用**

Run: `grep -n "cc-status\|__cc" patch-core.js`
Expected: 无输出（所有旧引用已替换）

- [ ] **Step 2.14: Commit**

```bash
git add patch-core.js
git commit -m "refactor: rename cc-status to cp-status in patch-core.js

- MARKER: cc-status-chip → cp-status-panel
- localStorage: cc-status-prefs → cp-status-prefs (with migration)
- CSS classes: .cc-status-chip → .cp-status-panel, .cc-gear → .cp-gear, .cc-zbtn → .cp-zbtn
- Internal vars: __cc* → __cp*
- Backup suffix: .cc-status.bak → .cp-status.bak (with rename migration)
- Log prefix: cc-status: → cp-status:
- Window API: __ccStatus → __cpStatus"
```

---

### Task 3: extension.js 更新

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: 无
- Produces: 更新后的 CANDIDATES 路径和通知消息

- [ ] **Step 3.1: 更新文件顶部注释**

将第 1-2 行：
```javascript
// Claude Status Chip — keeps a status-chip patch applied to the Claude Code
// VSCode extension's webview across its auto-updates.
```
替换为：
```javascript
// Claude Panel Status — keeps a panel-status patch applied to the Claude Code
// VSCode extension's webview across its auto-updates.
```

将第 3-5 行：
```javascript
// The patch logic lives in patch-core.js (bundled). If the user keeps an
// editable copy at ~/.claude/patch-claude-vscode-status.js, that one wins so
// power users can tweak the chip without reinstalling this extension.
```
替换为：
```javascript
// The patch logic lives in patch-core.js (bundled). If the user keeps an
// editable copy at ~/.claude/patch-claude-vscode-panel.js, that one wins so
// power users can tweak the panel status without reinstalling this extension.
```

- [ ] **Step 3.2: 更新 CANDIDATES 路径**

将第 11-12 行：
```javascript
const CANDIDATES = [
  path.join(os.homedir(), ".claude", "patch-claude-vscode-status.js"),
```
替换为：
```javascript
const CANDIDATES = [
  path.join(os.homedir(), ".claude", "patch-claude-vscode-panel.js"),
```

- [ ] **Step 3.3: 更新通知消息**

将第 46 行：
```javascript
notifyReload("Claude status chip applied. Reload the window to activate it.");
```
替换为：
```javascript
notifyReload("Claude panel status applied. Reload the window to activate it.");
```

将第 48 行：
```javascript
vscode.window.showWarningMessage("Claude status chip: patch anchor not found in this Claude extension version — the patcher needs updating.");
```
替换为：
```javascript
vscode.window.showWarningMessage("Claude panel status: patch anchor not found in this Claude extension version — the patcher needs updating.");
```

- [ ] **Step 3.4: 验证没有遗漏的旧引用**

Run: `grep -n "cc-status\|__cc\|status chip\|Status Chip" extension.js`
Expected: 无输出

- [ ] **Step 3.5: Commit**

```bash
git add extension.js
git commit -m "refactor: rename references in extension.js"
```

---

### Task 4: test/patch-core.test.js 更新

**Files:**
- Modify: `test/patch-core.test.js`

**Interfaces:**
- Consumes: patch-core.js 中的 `__cp*` 变量名
- Produces: 更新后的测试，验证重命名后行为不变

- [ ] **Step 4.1: 更新临时目录前缀**

将第 32 行：
```javascript
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-status-probe-"));
```
替换为：
```javascript
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-status-probe-"));
```

- [ ] **Step 4.2: 全局替换 `__cc` → `__cp`**

测试文件中引用了 patch-core.js 注入代码的内部变量名，需要同步更新：

- `__ccStatus` → `__cpStatus` （多处：`window.__ccStatus` → `window.__cpStatus`）
- `__ccCWFixed` → `__cpCWFixed`
- `__ccLastT` → `__cpLastT`
- `__ccLastCW` → `__cpLastCW`
- `__ccSetCount` → `__cpSetCount`
- `__ccProbeGen` → `__cpProbeGen`

**最安全的方式：** 在 test/patch-core.test.js 上执行全局替换 `__cc` → `__cp`。

- [ ] **Step 4.3: 验证没有遗漏的旧引用**

Run: `grep -n "__cc\|cc-status" test/patch-core.test.js`
Expected: 无输出

- [ ] **Step 4.4: Commit**

```bash
git add test/patch-core.test.js
git commit -m "refactor: rename __cc to __cp in test file"
```

---

### Task 5: 运行测试验证

**Files:**
- 无文件修改

- [ ] **Step 5.1: 运行全部测试**

Run: `node --test test/patch-core.test.js`
Expected: 所有测试通过（约 12 个 test case）

- [ ] **Step 5.2: 如果测试失败，排查并修复**

常见失败原因：
- `__cc` → `__cp` 替换遗漏（检查 patch-core.js 和 test 文件）
- runtime 字符串中的 CSS 选择器/ID 不匹配
- localStorage key 不一致

修复后重新运行测试直到全部通过。

---

### Task 6: README.md 更新

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 新的 package.json name/version，新的 Open VSX 发布信息
- Produces: 更新后的 README

- [ ] **Step 6.1: 更新标题和徽章**

将第 1 行：
```markdown
# Claude Status Chip
```
替换为：
```markdown
# Claude Panel Status
```

将第 3-5 行徽章：
```markdown
[![Open VSX](https://img.shields.io/open-vsx/v/omarkara/claude-status-chip?label=Open%20VSX&color=14657a)](https://open-vsx.org/extension/omarkara/claude-status-chip)
[![Installs](https://img.shields.io/open-vsx/dt/omarkara/claude-status-chip?label=installs&color=14657a)](https://open-vsx.org/extension/omarkara/claude-status-chip)
```
替换为：
```markdown
[![Open VSX](https://img.shields.io/open-vsx/v/louxiaxiaohei/claude-panel-status?label=Open%20VSX&color=14657a)](https://open-vsx.org/extension/louxiaxiaohei/claude-panel-status)
[![Installs](https://img.shields.io/open-vsx/dt/louxiaxiaohei/claude-panel-status?label=installs&color=14657a)](https://open-vsx.org/extension/louxiaxiaohei/claude-panel-status)
```

- [ ] **Step 6.2: 更新描述段落**

将第 10-11 行：
```markdown
Adds an always-visible, colored status chip to the **Claude Code** panel's input toolbar (next to the
`/` button):
```
替换为：
```markdown
Adds an always-visible, colored panel status indicator to the **Claude Code** panel's input toolbar (next to the
`/` button):
```

将第 13 行图片 alt 文本：
```markdown
![The status chip in the Claude Code panel: model, branch, context usage, effort and cost pills next to the input box](screenshot.png)
```
替换为：
```markdown
![The panel status indicator in the Claude Code panel: model, branch, context usage, effort and cost pills next to the input box](screenshot.png)
```

- [ ] **Step 6.3: 更新 "Why this exists" 段落**

将第 33 行：
```markdown
This extension patches the Claude Code extension's webview bundle to add the chip, and re-applies
```
替换为：
```markdown
This extension patches the Claude Code extension's webview bundle to add the panel status indicator, and re-applies
```

- [ ] **Step 6.4: 更新安装说明**

将第 39 行：
```markdown
**Marketplace: [Open VSX Registry](https://open-vsx.org/extension/omarkara/claude-status-chip)**
```
替换为：
```markdown
**Marketplace: [Open VSX Registry](https://open-vsx.org/extension/louxiaxiaohei/claude-panel-status)**
```

将第 43 行：
```markdown
These editors read Open VSX directly. Extensions view → search **Claude Status Chip** → Install.
```
替换为：
```markdown
These editors read Open VSX directly. Extensions view → search **Claude Panel Status** → Install.
```

将第 51-52 行 vsix 下载命令：
```markdown
curl -LO https://open-vsx.org/api/omarkara/claude-status-chip/1.0.1/file/omarkara.claude-status-chip-1.0.1.vsix
code --install-extension omarkara.claude-status-chip-1.0.1.vsix
```
替换为：
```markdown
curl -LO https://open-vsx.org/api/louxiaxiaohei/claude-panel-status/2.0.0/file/louxiaxiaohei.claude-panel-status-2.0.0.vsix
code --install-extension louxiaxiaohei.claude-panel-status-2.0.0.vsix
```

- [ ] **Step 6.5: 更新 Notes/caveats 段落**

将第 62 行：
```markdown
  as `index.js.cc-status.bak` next to it). Unofficial — use at your own risk.
```
替换为：
```markdown
  as `index.js.cp-status.bak` next to it). Unofficial — use at your own risk.
```

将第 65-66 行：
```markdown
- Power users: drop an edited copy of the patcher at `~/.claude/patch-claude-vscode-status.js` — it
  takes precedence over the bundled one, so you can customize the chip without reinstalling.
```
替换为：
```markdown
- Power users: drop an edited copy of the patcher at `~/.claude/patch-claude-vscode-panel.js` — it
  takes precedence over the bundled one, so you can customize the panel status without reinstalling.
```

将第 67-68 行：
```markdown
- To uninstall cleanly: uninstall this extension, then restore the `.cc-status.bak` backup (or simply
  reinstall/update the Claude Code extension).
```
替换为：
```markdown
- To uninstall cleanly: uninstall this extension, then restore the `.cp-status.bak` backup (or simply
  reinstall/update the Claude Code extension).
```

- [ ] **Step 6.6: 替换 Author 段落为 Fork 声明**

将第 70-81 行整个 Author 段落：
```markdown
## Author

**Omar Kara Mohammed** — full-stack and mobile developer, AI-native product builder. I build
software with AI, ship it, and run the infrastructure under it.

- LinkedIn: [linkedin.com/in/omarkm2021](https://www.linkedin.com/in/omarkm2021)
- X: [@Omar449153](https://x.com/Omar449153)
- GitHub: [github.com/omarqra](https://github.com/omarqra)

Found it useful? A ⭐ on the repo or a rating on
[Open VSX](https://open-vsx.org/extension/omarkara/claude-status-chip) helps other Claude Code users
find it. Issues and PRs welcome.
```
替换为：
```markdown
## Author

**Howard Stark** — [GitHub](https://github.com/LouXiaXiaoHei)

Issues and PRs welcome.

> **Forked from** [omarkara/claude-status-chip](https://github.com/omarkara/claude-status-chip) — original MIT-licensed project by Omar Kara.
```

- [ ] **Step 6.7: 验证没有遗漏的旧引用**

Run: `grep -n "omarkara\|claude-status-chip\|Status Chip\|status chip\|cc-status" README.md`
Expected: 仅在 fork 声明行出现 `omarkara/claude-status-chip`（这是故意的归属引用）

- [ ] **Step 6.8: Commit**

```bash
git add README.md
git commit -m "docs: update README for claude-panel-status rename

- Title and badges updated
- Install instructions updated for new publisher/name
- Author section replaced with fork declaration
- All cc-status references updated to cp-status"
```

---

### Task 7: Git 仓库设置

**Files:**
- 无文件修改（Git 操作）

- [ ] **Step 7.1: 在 GitHub 创建新仓库**

Run: `gh repo create LouXiaXiaoHei/claude-panel-status --public --description "Always-visible panel status indicator for the Claude Code VSCode panel" --clone=false`
Expected: 仓库创建成功

- [ ] **Step 7.2: 添加新 remote 并推送**

```bash
git remote add panel-status git@github.com:LouXiaXiaoHei/claude-panel-status.git
git push panel-status fix/session-debug-state:main
```

- [ ] **Step 7.3: 更新 origin remote URL（可选）**

如果确认新仓库工作正常，可以更新 origin：
```bash
git remote set-url origin git@github.com:LouXiaXiaoHei/claude-panel-status.git
```

或者保留旧 origin 不动，使用新 remote `panel-status`。

- [ ] **Step 7.4: 在旧仓库添加迁移提示（可选）**

如果仍有旧仓库的写权限，在旧仓库 README 顶部添加：
```markdown
> ⚠️ **This project has been forked and continued as [claude-panel-status](https://github.com/LouXiaXiaoHei/claude-panel-status).** New features and updates will be published there.
```
