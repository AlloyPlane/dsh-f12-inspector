# 🔍 dsh-f12-inspector

<div align="center">

[**简体中文**](README.md) · **[English](README.en.md)**

</div>

> An **element inspection plugin** for the **DSH (DeepSeek Harness)** web UI: it brings a browser-style "F12 inspect element" workflow into the right **details column**, with a built-in workspace file tree and an HTML editor.

Browse your workspace in the DSH web UI, pick an HTML page into a live preview, turn on **inspect mode** to **hover-highlight and click-to-lock** any element, and grab its **CSS selector / XPath / computed styles / outerHTML** in one click. You can also **edit the source, refresh the preview, and keep inspecting**, or send the element context to the AI via "add to chat".

## ✨ Features

- **🔍 F12 element inspection**
  - A "🔍 F12 检查器" button at the sidebar footer opens the third (details) column
  - Inspect mode: **hover → blue highlight + element tag**, **click → lock selection**
  - Element info: tagName / data-dom-id / CSS selector / XPath / text / size / computed styles / outerHTML
  - "📋 复制选择器" copies the selector; "＋ 加入对话" fills the composer draft with the element context for the AI
  - A protocol log at the bottom shows the inspector's host ↔ iframe messages for debugging
- **📁 Workspace file tree**
  - Follows the active session cwd, lists the project tree, expand/collapse folders, click a file to load it
  - HTML files → load into the preview for inspection; other text files → open in the editor
- **✏️ Built-in HTML editor** (VSCode-style, pure JS, no dependencies)
  - Syntax highlighting (tags / attributes / strings / comments), line-number gutter, Tab indent + Enter auto-indent, status bar
  - "Save" writes back to disk; "Refresh preview" re-renders the edited source and **lets you keep inspecting the changed page**
- **Load options**: workspace-relative path / absolute path / folder picker / URL
  - Typing a **folder** path lists the HTML files inside for one-click loading

## 🧩 How it works

The client plugin registers two slots in the DSH web slot system:

| Slot | Role |
| --- | --- |
| `sidebar.footer.action` | The "open third column" button at the sidebar footer |
| `details` (priority: -1) | Occupies the third (right details) column with the inspector |

The preview page lives in a `sandbox` iframe. The inspection engine attaches listeners (`mouseover` / `click` / `keydown`) through the iframe's `contentDocument`, and on click builds an element payload (XPath / CSS selector / computedStyles / inlineStyles / rect / outerHTML). All locating logic is an original implementation on standard DOM APIs (`getBoundingClientRect` / `getComputedStyle` / `closest` / `previousElementSibling`).

**Host side** (`dsh/index.js`) registers a JSON API — **all file access goes through DSH's official `fs` service**:

```
POST /api/f12-inspector
  { op: 'list', path }            -> { ok, path, entries: [{ name, type, size }] }
  { op: 'read', path }            -> { ok, path, content }
  { op: 'write', path, content }  -> { ok: true }
```

Path resolution matches DSH's own file tools: `''` / `'.'` → workspace root; `'a/b'` → relative; `'/abs'` → absolute.

## 📦 Installation

> A standard DSH bundle plugin — installable with one command after publishing to GitHub:

```sh
dsh plugin --profile web add "github:AlloyPlane/dsh-f12-inspector#v1.1.0&path:/"
```

> `v1.1.0` is the current release tag (you may use the latest commit hash instead). The package root is the repository root.

Or from a **local directory** (run inside the package):

```sh
cd dsh-f12-inspector && dsh plugin --profile web add .
```

After installing, **restart DSH** (`npx -y @deepseek-ai/dsh web`); the **"🔍 F12 检查器"** button appears at the bottom of the sidebar.

> Legacy manual install: link this package in the web profile's `package.json` `dependencies`, add `dsh-f12-inspector` to `dsh.profile.bundles`, `pnpm install`, then restart.

## 🚀 Usage

1. Click "🔍 F12 检查器" at the bottom of the sidebar to open the third column
2. Pick an HTML file from the file tree (or type a path / URL) to load it
3. The page auto-enters inspect mode after loading: **hover to highlight, click to select**
4. Read the element info, then hit "📋 复制选择器" or "＋ 加入对话"
5. Click "✏️ 编辑" to edit the source → "Save" writes back / "Refresh preview" re-inspects
6. `Esc` cancels selection; "✕" clears it

### Same-origin / cross-origin note

| Page source | Inspectable? |
| --- | --- |
| srcdoc / workspace file (local read) / DSH itself | ✅ fully inspectable |
| Cross-origin URL (direct iframe) | ⚠️ display-only, engine cannot be injected (the UI will warn) |

When inspecting your own site / component demos, **prefer the file tree / file load** (local read, no cross-origin limits).

## ⚠️ Security note

- All file reads/writes go through the DSH `fs` service (not raw `node:fs`), following DSH's sandbox and permission model; paths resolve via `fs.resolve` (workspace root is the relative base).
- This is still a **local dev tool**: `/api/f12-inspector` is exposed on the workspace. **Do not deploy it to public / untrusted networks.**

## 🧡 Acknowledgements

- The workspace file tree and built-in editor **design** are inspired by [lak321/dsh-filetree](https://github.com/lak321/dsh-filetree) (MIT). See [ACKNOWLEDGEMENTS.md](./ACKNOWLEDGEMENTS.md) for the attribution.

## 📄 License

[MIT](./LICENSE) © AlloyPlane

## 🧩 Plugin marketplace

This project is also prepared for the [WhaleHub plugin marketplace](https://github.com/vvlife/whalehub-dsh) per the [submission guide](./docs/whalehub-submission.md).
