# 🔍 dsh-f12-inspector

> 一个用于 **DSH（DeepSeek Harness）** Web 前端的元素检查插件：把浏览器「F12 检查元素」的交互搬进网页界面的**第三栏（右侧详情栏）**，并内置工作区文件树和 HTML 编辑器。

在 DSH Web 界面里浏览工作区、点选 HTML 页面载入预览，开启「检查模式」后**悬停高亮、点击定位**，一键拿到元素的 **CSS 选择器 / XPath / 计算样式 / outerHTML**，还能**直接改源码、刷新预览继续检查**，并把元素上下文「＋加入对话」发给 AI 让它修改。

## ✨ 功能

- **🔍 F12 元素检查**
  - 侧边栏底部「🔍 F12 检查器」按钮，点击即打开第三栏
  - 检查模式：**悬停 → 蓝色高亮 + 元素标签**，**点击 → 锁定选中**
  - 元素信息：tagName / data-dom-id / CSS 选择器 / XPath / 文本 / 尺寸 / 计算样式 / outerHTML
  - 「📋 复制选择器」一键复制；「＋ 加入对话」把元素上下文填进对话输入框发给 AI
  - 底部「协议日志」实时展示检查器内部消息（host ↔ iframe），方便调试
- **📁 工作区文件树**
  - 跟随当前会话 cwd，自动列出工程目录树，展开/折叠文件夹，点选文件载入
  - HTML 文件 → 载入预览检查；其他文本文件 → 打开编辑器
- **✏️ 内置 HTML 编辑器**（VSCode 风格，纯 JS 无依赖）
  - 语法高亮（HTML 标签 / 属性 / 字符串 / 注释）、行号栏、Tab 缩进 + 回车自动缩进、状态栏
  - 「保存」写回磁盘；「刷新预览」把改后的源码重新渲染进预览框，**继续检查改完的页面**
- **载入方式**：工作区相对路径 / 绝对路径 / 文件夹点选 / 网址
  - 输入**文件夹**路径自动列出里面的 HTML 文件，点选即可载入

## 🧩 原理

客户端插件向 DSH Web 的槽位系统注册两个槽位：

| 槽位 | 作用 |
| --- | --- |
| `sidebar.footer.action` | 侧边栏底部的「打开第三栏」按钮 |
| `details`（priority: -1） | 占据第三栏（右侧详情栏）显示检查器 |

预览页面放入 `sandbox` iframe 中。检查引擎通过 iframe 的 `contentDocument` 注入监听（`mouseover` / `click` / `keydown`），并在点击时生成元素的定位 payload（XPath / CSS 选择器 / computedStyles / inlineStyles / rect / outerHTML）。所有定位逻辑均基于标准 DOM API（`getBoundingClientRect` / `getComputedStyle` / `closest` / `previousElementSibling`）自行实现。

**宿主侧**（`dsh/index.js`）注册一个 JSON API，**所有文件访问都走 DSH 官方 `fs` 服务**：

```
POST /api/f12-inspector
  { op: 'list', path }            -> { ok, path, entries: [{ name, type, size }] }
  { op: 'read', path }            -> { ok, path, content }
  { op: 'write', path, content }  -> { ok: true }
```

路径解析与 DSH 自带文件工具一致：`''` / `'.'` → 工作区根；`'a/b'` → 相对路径；`'/abs'` → 绝对路径。

## 📦 安装

> 标准 DSH bundle 插件，一条命令即可安装（发布到 GitHub 后）：

```sh
dsh plugin --profile web add "github:AlloyPlane/dsh-f12-inspector#494a1d3&path:/"
```

> `494a1d3` 为当前发布提交号（见仓库主页，换用最新提交号亦可）。包根 = 仓库根。

或**本地目录**（包目录内执行）：

```sh
cd dsh-f12-inspector && dsh plugin --profile web add .
```

装完**重启 DSH**（`npx -y @deepseek-ai/dsh web`），浏览器打开后侧边栏底部出现 **「🔍 F12 检查器」**。

> 手动方式（旧版）：在 web profile 的 `package.json` dependencies 里 link 本包、在 `dsh.profile.bundles` 加 `dsh-f12-inspector`、`pnpm install` 后重启。

## 🚀 使用

1. 点侧边栏底部「🔍 F12 检查器」打开第三栏
2. 顶部文件树点选 HTML 文件（或输入路径 / 网址）载入
3. 页面加载后自动进入检查模式：**悬停高亮，点击选中**
4. 选中后查看元素信息，点「📋 复制选择器」或「＋ 加入对话」
5. 点「✏️ 编辑」改源码 →「保存」写回 /「刷新预览」重新检查
6. `Esc` 取消选中；「✕」清空选择

### 同源 / 跨域说明

| 页面来源 | 能否检查 |
| --- | --- |
| srcdoc / 工作区文件（走本机读取） / DSH 自身 | ✅ 完整检查 |
| 跨域网址（直接 iframe） | ⚠️ 只能显示，不能注入检查引擎（界面会提示） |

检查自己的网站 / 组件库页面时，**优先用文件树 / 载入文件**（走本机读取，无跨域限制）。

## ⚠️ 安全说明

- 所有文件读写都通过 DSH 的 `fs` 服务进行（不是裸 `node:fs`），遵循 DSH 的沙箱与权限体系；路径按 `fs.resolve` 规则解析（工作区根为相对路径基准）。
- 这仍是**本地开发工具**：`/api/f12-inspector` 暴露在工作区上。**请不要把该插件部署到公网 / 不受信任的网络环境**。

## 📄 License

[MIT](./LICENSE) © AlloyPlane

## 🧩 插件市场

本项目也按 [WhaleHub 插件市场提交规范](./docs/whalehub-submission.md) 整理，可提交到
[vvlife/whalehub-dsh](https://github.com/vvlife/whalehub-dsh) 社区市场。
