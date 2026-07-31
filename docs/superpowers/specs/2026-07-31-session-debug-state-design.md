# Session 调试状态修复设计

## 背景

状态 chip 的 context 悬浮提示需要显示 `__ccSetCount` 和 `__ccLastT`。当前 `__ss` 只在 `__ccCWFixed` 尚未设置时赋值。后续渲染会跳过该分支，导致被提升的局部变量 `__ss` 值为 `undefined`，读取 `__ss.__ccSetCount` 时中断内容渲染。

## 目标

- 保留悬浮提示中的 `[set:N|lastT:N]` 调试信息。
- 首次及后续渲染均可安全读取 session 调试状态。
- `__ccSetCount` 表示 usage signal setter 的累计调用次数。
- 不改变 context window、token 缓存、分支轮询或状态 chip 的其他行为。

## 设计

采用持久 session 状态方案：在生成的 chip IIFE 开头无条件执行 `var __ss=${sess}`，后续初始化、setter 和渲染逻辑统一通过 `__ss` 访问 session。

仅在首次安装 usage signal setter 时，将 `__ccSetCount`、`__ccLastCW` 和 `__ccLastT` 初始化为 `0`。setter 每次收到值后递增 `__ccSetCount`，不在每次调用时重置计数。

悬浮提示读取调试字段时使用数值兜底，未初始化或历史 session 缺少字段时显示 `0`，不能因调试信息导致渲染失败。

## 数据流

1. chip IIFE 获取当前 session 引用并保存为 `__ss`。
2. 首次渲染安装 usage signal setter，并初始化调试字段。
3. setter 每次调用时累计计数、缓存有效 token 数据并调用原 setter。
4. 每次渲染从同一个 session 读取累计计数和最后有效 token 数，写入 context pill 的 `title`。

## 错误处理

调试字段缺失时回退到 `0`。既有 setter 安装保护保持不变，避免重复包装 signal setter。

## 验证

- 对 `patch-core.js` 做 Node.js 语法检查。
- 提取或模拟生成的 chip 代码，验证首次渲染不报错。
- 设置 `__ccCWFixed=true` 后再次渲染，验证 `__ss` 仍然有效。
- 连续调用 setter，验证 `__ccSetCount` 单调递增且悬浮提示保留 `lastT`。
