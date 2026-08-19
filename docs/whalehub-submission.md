# WhaleHub 插件提交规范

> 按 [vvlife/whalehub-dsh](https://github.com/vvlife/whalehub-dsh) README 整理。
> WhaleHub — DeepSeek Harness 社区插件市场。

## 0. 前置：必须是标准 bundle 插件

WhaleHub 校验门要求插件是**标准 DSH bundle**（一行 `dsh plugin add` 可装）：

- 根 `package.json` 声明：
  - `dsh.bundle.patch` → 根 `cordis.patch.yml`（组合层，`- insert: - id: <自身> name: '<包名>'`）
  - `main` / `exports["."]` → Node half（Cordis entry：`name`/`inject`/`apply`）
  - `exports["./client"]` + `dsh.client.platform: "web"` → client bundle（`__ModuleLoader__.load` 格式）
  - **包根 = 仓库根**，构建产物入库（`files` 声明 dsh/ client/ 等）
  - 不声明官方依赖（`@deepseek-ai/*` 由 DSH profile 闭包注入）
- 反例（被拒原因）：手动复制 `host/`+`client/` 注入 `cordis.patch.yml`、全仓无 `dsh.bundle.patch`
  → 不是 `dsh plugin add` 可装的标准插件。

安装命令示例：

```sh
dsh plugin --profile web add "github:<owner>/<repo>#<commit>&path:/"
```

## 1. 推送到 GitHub

整改后 push 到 `github.com/<owner>/<repo>`（本仓库对应 `AlloyPlane/dsh-f12-inspector`）。

## 2. 提交到 WhaleHub（二选一）

### 方式 A：提 Issue（提交插件表单，推荐，1 分钟）

URL：

```
https://github.com/vvlife/whalehub-dsh/issues/new?template=submit-plugin.yml
```

表单字段：

| 字段 | 填写 |
|---|---|
| 标题 | `[Plugin] AlloyPlane/dsh-f12-inspector` |
| GitHub 仓库地址 | `https://github.com/AlloyPlane/dsh-f12-inspector`（需公开） |
| 分类 | Web-UI（界面与皮肤）/ 工具 / 其他（按插件性质选） |
| 一句话描述 | 如"F12 元素检查器：文件树选页、元素定位、内置 HTML 编辑器" |
| 依赖 | 无（官方包自动注入） |
| 已知坑点 | 安装后需重启 DSH 等 |

底部两个确认 checkbox（"仓库公开且 README 说明安装方式"、"插件为开源免费不含恶意代码"）是模板正文里的 markdown task list——在 Write 模式下不可点击，需**切 Preview** 勾选，或把 `- [ ]` 改成 `- [x]`。然后点 **Submit new issue**。

### 方式 B：提 PR（改注册表）

直接改 `registry/plugins.json` 加入插件条目，CI 自动校验 schema（需 fork + 本地改 + PR）。

## 3. 同步 awesome 列表（可选，推荐）

也给 `awesome-deepseek-harness-plugins` 提 PR，WhaleHub 每日 cron 自动同步。

## 4. 已知坑（实测）

- 部分网络环境下 `api.github.com` 可能被封锁（503；github.com 主站可达）→ 无法 API 自动提交
  Issue/PR，只能走浏览器网页（登录 GitHub）。
- 浏览器自动化填表单时：标题/仓库用剪贴板粘贴（点输入框若点中 placeholder 中间会插入文本，
  需 Ctrl+A 全选重填）。
- 若走系统代理失败，改用直连 github.com 主站。
