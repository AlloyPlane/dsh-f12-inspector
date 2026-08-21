// dsh-f12-inspector web client.
//
// Puts a browser-style "F12" element inspection into the third (right
// details) column of the DSH web GUI:
//   - A sidebar footer action "🔍 F12 检查器" opens the details column.
//   - The details column shows an inspector: browse the workspace file tree,
//     load a page (workspace file / local path / URL / pasted HTML) into a
//     preview iframe, hover to locate, click to lock, and read tag / XPath /
//     CSS selector / computed styles / outerHTML.
//   - "复制选择器" copies the selector; "加入对话" fills the composer draft
//     with the element context so the agent can modify it.
//   - "编辑" opens a built-in HTML editor (VSCode-style overlay) with Save
//     (writes back through the host fs service) and Refresh (re-render the
//     preview from the edited source, then keep inspecting).
//
// Element inspection engine (STYLE_KEYS / getXPath / getCssSelector /
// buildElementPayload) is an original implementation built on the standard
// DOM APIs (getBoundingClientRect / getComputedStyle / closest /
// previousElementSibling), following the same interaction pattern browsers
// expose in their built-in devtools.
window.__ModuleLoader__.load({ id: "dsh-f12-inspector", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  const react = require("react");

  const NS = "f12-inspector";
  const name = "f12-inspector";
  const inject = ["slots", "layout"];

  const HTML_EXT = /\.(html?|xhtml|svg)$/i;

  /* ================================================================
     Cross-component bridge: the chat turn-tail "🔍 F12 预览" action
     sends a produced file path here; the inspector panel (mounted in
     the details column) registers a listener to load it into preview.
     ================================================================ */
  const panelLoadListeners = new Set();
  const queuedLoads = [];
  let openDetailsImpl = null;
  function requestF12Load(path) {
    if (panelLoadListeners.size > 0) {
      panelLoadListeners.forEach((fn) => fn(path));
      return;
    }
    queuedLoads.push(path);
    if (openDetailsImpl) { try { openDetailsImpl(); } catch (e) { /* ignore */ } }
  }

  /* ================================================================
     File API via the host route (POST /api/f12-inspector)
     ================================================================ */
  function api(op, path, content) {
    return fetch("/api/f12-inspector", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, path, content }),
    }).then((r) => r.json().catch(() => ({ ok: false, error: "HTTP " + r.status })))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  }

  /* ================================================================
     Element inspection engine
     ================================================================ */
  const STYLE_KEYS = [
    'display','position','top','right','bottom','left',
    'width','height','min-width','min-height','max-width','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'color','background-color','background-image','font-size','font-weight','font-family',
    'border','border-radius','box-shadow','gap','flex','align-items','justify-content'
  ];

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    while (el && el.nodeType === 1) {
      let idx = 1; let sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  function getCssSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    while (el && el.nodeType === 1) {
      let selector = el.tagName.toLowerCase();
      if (el.id) { selector += '#' + el.id; parts.unshift(selector); break; }
      const cls = (el.className || '').toString().replace(/f12-inspect-[\w-]+/g, '').trim().split(/\s+/).filter(Boolean);
      if (cls.length) selector += '.' + cls.join('.');
      const parent = el.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(s => s.tagName === el.tagName);
        if (sibs.length > 1) selector += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      parts.unshift(selector);
      el = parent;
    }
    return parts.join(' > ');
  }

  function buildElementPayload(t) {
    const rect = t.getBoundingClientRect();
    const computed = window.getComputedStyle(t);
    const styles = {}, inline = {};
    STYLE_KEYS.forEach(k => {
      styles[k] = computed.getPropertyValue(k);
      const iv = t.style.getPropertyValue(k);
      if (iv) inline[k] = iv;
    });
    const parentEl = t.parentElement;
    let siblingIndex = 0;
    if (parentEl) for (let si = 0; si < parentEl.children.length; si++) if (parentEl.children[si] === t) { siblingIndex = si; break; }
    return {
      tagName: t.tagName,
      textContent: (t.textContent || '').trim().substring(0, 120),
      className: (t.className || '').toString().replace(/f12-inspect-[\w-]+/g, '').trim(),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      xpath: getXPath(t),
      selector: getCssSelector(t),
      domId: t.getAttribute('data-dom-id') || null,
      computedStyles: styles,
      inlineStyles: inline,
      outerHtml: (t.outerHTML || '').substring(0, 200),
      parentXpath: parentEl ? getXPath(parentEl) : '',
      siblingIndex
    };
  }

  /* ================================================================
     Styles (injected once)
     ================================================================ */
  const css = [
    ".f12-root{display:flex;flex-direction:column;height:100%;min-height:0;font-family:inherit}",
    ".f12-hdr{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #2d333b;background:#161b22}",
    ".f12-urlrow{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid #2d333b;flex-wrap:wrap}",
    ".f12-inp{flex:1;min-width:140px;padding:5px 9px;font-size:12px;color:#e6edf3;background:#21262d;border:1px solid #3d444d;border-radius:6px;outline:none}",
    ".f12-btn{padding:5px 10px;font-size:12px;color:#e6edf3;background:#21262d;border:1px solid #3d444d;border-radius:6px;cursor:pointer;white-space:nowrap}",
    ".f12-btn:hover{background:#30363d}",
    ".f12-btn:disabled{opacity:.45;cursor:default}",
    ".f12-btn-active{background:#1f6feb;border-color:#1f6feb;color:#fff}",
    ".f12-btn-primary{background:#238636;border-color:#238636;color:#fff}",
    ".f12-row{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid #2d333b;align-items:center;flex-wrap:wrap}",
    ".f12-label{font-size:11px;color:#8b949e}",
    ".f12-err{padding:4px 10px;color:#f85149;font-size:11px}",
    ".f12-toast{padding:4px 10px;color:#3fb950;font-size:11px}",
    ".f12-diag{padding:3px 10px;color:#58a6ff;font-size:10.5px;font-family:Consolas,Menlo,monospace;border-bottom:1px dashed rgba(45,51,59,.6)}",
    ".f12-preview{flex:1;min-height:0;position:relative;background:#0d1117;display:flex}",
    ".f12-iframe{flex:1;width:100%;height:100%;border:none;background:#fff}",
    ".f12-toolbtn{min-width:26px;height:26px;padding:0 7px;font-size:13px;font-weight:400;color:#24292f;background:transparent;border:none;border-radius:5px;cursor:pointer;line-height:1;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}",
    ".f12-toolbtn:hover{background:#f0f0f0}",
    ".f12-toolbtn:active{background:#e0e0e0}",
    ".f12-toolsel{font-size:12px;color:#24292f;background:#fff;border:1px solid #e1e4e8;border-radius:5px;height:26px;padding:0 4px;cursor:pointer;outline:none}",
    ".f12-toolbtn-ai{min-width:26px;height:26px;padding:0 9px;font-size:13px;font-weight:600;color:#1f6feb;background:transparent;border:none;border-radius:5px;cursor:pointer;line-height:1;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}",
    ".f12-toolbtn-ai:hover{background:#eaf2ff}",
    ".f12-inline-edit{outline:2px solid #1f6feb;outline-offset:1px;border-radius:2px;min-height:1em;cursor:text}",
    ".f12-empty{margin:auto;color:#8b949e;font-size:12px;text-align:center;padding:20px;line-height:1.8}",
    ".f12-info{border-top:1px solid #2d333b;padding:8px 10px;max-height:42%;overflow:auto;font-size:11.5px;font-family:Consolas,Menlo,monospace}",
    ".f12-info-label{color:#8b949e;font-size:11px;margin-bottom:4px}",
    ".f12-kv{color:#e6edf3;line-height:1.6;word-break:break-all}",
    ".f12-kvk{color:#7ee787}",
    ".f12-log{border-top:1px solid #2d333b;padding:6px 10px;max-height:20%;overflow:auto;font-size:10.5px;font-family:Consolas,Menlo,monospace;color:#8b949e}",
    ".f12-log-line{padding:2px 0;border-bottom:1px dashed rgba(45,51,59,.6)}",
    ".f12-status{display:flex;gap:8px;align-items:center;padding:5px 10px;border-top:1px solid #2d333b;font-size:11px;color:#8b949e}",
    ".f12-dot{width:8px;height:8px;border-radius:50%}",
    // file tree
    ".f12tree{padding:6px 10px;border-bottom:1px solid #2d333b;max-height:38%;overflow:auto;font-size:12px}",
    ".f12tree-hd{display:flex;align-items:center;gap:6px;color:#8b949e;font-size:11px;margin-bottom:4px}",
    ".f12tr-row{display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:4px;cursor:pointer;white-space:nowrap}",
    ".f12tr-row:hover{background:rgba(127,127,127,.15)}",
    ".f12tr-ic{width:12px;text-align:center;flex-shrink:0;color:#8b949e}",
    ".f12tr-name{overflow:hidden;text-overflow:ellipsis}",
    ".f12tr-tag{margin-left:auto;font-size:9px;color:#58a6ff;background:rgba(88,166,255,.12);padding:0 4px;border-radius:3px}",
    ".f12tr-children{padding-left:13px}",
    // editor
    ".f12ed-bar{display:flex;gap:8px;align-items:center;padding:6px 12px;background:#323233;color:#cccccc;flex-shrink:0;border-bottom:1px solid #3c3c3c;font-size:12px}",
    ".f12ed-fn{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".f12ed-dirty{color:#e2c08d}",
    ".f12ed-body{flex:1;display:flex;min-height:0;background:#1e1e1e;color:#d4d4d4}",
    ".f12ed-gutter{width:48px;flex-shrink:0;background:#1e1e1e;color:#858585;text-align:right;padding:8px 6px 8px 0;font:13px/1.6 ui-monospace,Consolas,monospace;user-select:none;overflow:hidden;border-right:1px solid #2d2d2d}",
    ".f12ed-main{flex:1;position:relative;min-width:0;overflow:hidden}",
    ".f12ed-hl{position:absolute;top:0;left:0;right:0;bottom:0;margin:0;padding:8px 0;font:13px/1.6 ui-monospace,Consolas,monospace;white-space:pre;color:#d4d4d4;pointer-events:none;overflow:hidden}",
    ".f12ed-ta{position:absolute;top:0;left:0;width:100%;height:100%;resize:none;border:0;outline:none;padding:8px 0;background:transparent;color:transparent;caret-color:#aeafad;font:13px/1.6 ui-monospace,Consolas,monospace;white-space:pre;overflow:auto;scrollbar-width:thin;scrollbar-color:#424242 transparent}",
    ".f12ed-ta::-webkit-scrollbar{width:12px;height:12px}",
    ".f12ed-ta::-webkit-scrollbar-thumb{background:#424242;border-radius:6px;border:3px solid #1e1e1e}",
    ".f12ed-ta::selection{background:rgba(38,79,120,.6)}",
    ".f12ed-status{display:flex;gap:16px;padding:3px 12px;background:#007acc;color:#fff;font-size:11px;flex-shrink:0}",
    ".f12ed-status span:last-child{margin-left:auto}",
    // highlight colors
    ".f12ed-hl .f12-t{color:#569cd6}.f12ed-hl .f12-a{color:#9cdcfe}.f12ed-hl .f12-s{color:#ce9178}.f12ed-hl .f12-c{color:#6a9955}.f12ed-hl .f12-k{color:#c586c0}",
    // fullscreen overlay (covers the whole browser viewport)
    ".f12-fullscreen{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;z-index:9999;background:#0d1117}",
    // chat turn-tail produced files + F12 preview
    ".f12-prod{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 0;font-size:12px}",
    ".f12-prod-label{color:#8b949e;font-size:11px;flex-shrink:0}",
    ".f12-prod-chip{border:1px solid #30363d;background:#161b22;color:#e6edf3;font-size:11.5px;padding:1px 8px;border-radius:10px;cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".f12-prod-chip:hover{background:#21262d}",
    ".f12-prod-div{color:#484f58}",
    ".f12-prod-preview{border-color:#1f6feb;color:#58a6ff}",
    ".f12-prod-preview:hover{background:rgba(31,111,235,.15)}",
    // selection action bar + AI component-modify dialog
    ".f12-selbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid #2d333b;border-bottom:1px solid #2d333b;flex-wrap:wrap;background:#161b22}",
    ".f12-selbar-tag{font-family:monospace;font-size:11px;color:#d29922;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".f12-ai{border:1px solid #1f6feb;background:#161b22;border-radius:10px;margin:8px 10px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.4)}",
    ".f12-ai-hd{display:flex;align-items:center;font-weight:700;font-size:13px;margin-bottom:8px}",
    ".f12-ai-target{font-family:monospace;font-size:11px;color:#8b949e;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 8px;margin-bottom:8px;word-break:break-all}",
    ".f12-ai-outer{max-height:70px;overflow:auto;color:#8b949e;margin-top:4px;white-space:pre-wrap}",
    ".f12-ai-ta{width:100%;height:72px;resize:vertical;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:12px;font-family:inherit;outline:none}",
    ".f12-ai-ta:focus{border-color:#1f6feb}",
    ".f12-ai-actions{display:flex;align-items:center;gap:8px;margin-top:8px}",
    ".f12-ai-hint{color:#8b949e;font-size:11px;flex:1}",
  ].join("");
  const tagId = "dsh-f12-inspector/styles";
  if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css=\"" + tagId + "\"]")) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-f12-inspector";
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ================================================================
     HTML highlighting + VSCode-style editor (pure DOM, no deps)
     ================================================================ */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function spanTag(tag) {
    if (/^<!/.test(tag)) return '<span class="f12-k">' + esc(tag) + '</span>';
    const m = tag.match(/^(<\/?)([a-zA-Z][\w-]*)/);
    if (!m) return esc(tag);
    let out = '<span class="f12-t">' + esc(m[1] + m[2]) + '</span>';
    const rest = tag.slice(m[0].length);
    const re = /([a-zA-Z_:][\w:.-]*)(\s*=\s*)?("[^"]*"|'[^']*')?/g;
    let mm, pos = 0;
    while ((mm = re.exec(rest))) {
      if (mm.index > pos) out += esc(rest.slice(pos, mm.index));
      const name = mm[1], eq = mm[2] || "", val = mm[3] || "";
      out += '<span class="f12-a">' + esc(name) + '</span>' + esc(eq) + (val ? '<span class="f12-s">' + esc(val) + '</span>' : '');
      pos = mm.index + mm[0].length;
    }
    out += esc(rest.slice(pos));
    return out;
  }
  function highlightHtml(src) {
    let out = "", i = 0, n = src.length;
    while (i < n) {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end === -1) { out += '<span class="f12-c">' + esc(src.slice(i)) + '</span>'; break; }
        out += '<span class="f12-c">' + esc(src.slice(i, end + 3)) + '</span>';
        i = end + 3;
        continue;
      }
      if (src[i] === "<") {
        let j = i + 1, inQ = null;
        while (j < n) {
          const c = src[j];
          if (inQ) { if (c === inQ) inQ = null; }
          else if (c === '"' || c === "'") inQ = c;
          else if (c === ">") break;
          j++;
        }
        out += spanTag(src.slice(i, Math.min(j + 1, n)));
        i = j + 1;
        continue;
      }
      const next = src.indexOf("<", i);
      const text = next === -1 ? src.slice(i) : src.slice(i, next);
      out += esc(text);
      i = next === -1 ? n : next;
    }
    return out;
  }

  function CodeEditor({ value, onChange, onCursor }) {
    const hlRef = react.useRef(null);
    const taRef = react.useRef(null);
    const gutRef = react.useRef(null);
    react.useEffect(() => {
      if (hlRef.current) hlRef.current.innerHTML = highlightHtml(value) + "\n";
    }, [value]);
    function onScroll(e) {
      if (hlRef.current) { hlRef.current.scrollTop = e.target.scrollTop; hlRef.current.scrollLeft = e.target.scrollLeft; }
      if (gutRef.current) gutRef.current.scrollTop = e.target.scrollTop;
    }
    function onWheel(e) {
      const ta = taRef.current;
      if (!ta || e.target === ta) return;
      ta.scrollTop += e.deltaY; ta.scrollLeft += e.deltaX;
    }
    function report() {
      const ta = taRef.current;
      if (!ta || !onCursor) return;
      const upTo = value.slice(0, ta.selectionStart);
      onCursor({ line: (upTo.match(/\n/g) || []).length + 1, col: ta.selectionStart - upTo.lastIndexOf("\n") });
    }
    function onKeyDown(e) {
      const ta = taRef.current;
      if (!ta) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        onChange(value.slice(0, s) + "    " + value.slice(en));
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4; });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const s = ta.selectionStart;
        const ls = value.lastIndexOf("\n", s - 1) + 1;
        const line = value.slice(ls, s);
        const m = line.match(/^[ \t]*/);
        const indent = m ? m[0] : "";
        onChange(value.slice(0, s) + "\n" + indent + value.slice(s));
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 + indent.length; });
        return;
      }
    }
    const lineCount = value.split("\n").length;
    const gutter = [];
    for (let i = 1; i <= lineCount; i++) gutter.push(i);
    return react.createElement("div", { className: "f12ed-body" },
      react.createElement("div", { ref: gutRef, className: "f12ed-gutter", onWheel },
        react.createElement("div", null, gutter.join("\n"))),
      react.createElement("div", { className: "f12ed-main", onWheel },
        react.createElement("pre", { ref: hlRef, className: "f12ed-hl" }),
        react.createElement("textarea", {
          ref: taRef, className: "f12ed-ta", value, spellCheck: false, wrap: "off",
          onChange: (ev) => onChange(ev.target.value), onScroll, onKeyDown, onKeyUp: report, onClick: report,
        })));
  }

  /* ================================================================
     File tree (workspace browser)
     ================================================================ */
  function FileTree({ root, tree, expanded, onToggle, onOpen, busy }) {
    const rootLabel = root ? String(root).split(/[/\\]/).filter(Boolean).pop() || root : "工作区";
    const entries = tree[root];
    function renderEntries(path, list) {
      return (list || []).map((e) => {
        const childPath = path ? path + "/" + e.name : e.name;
        const isDir = e.type === 'dir';
        const isOpen = !!expanded[childPath];
        const isHtml = e.type === 'file' && HTML_EXT.test(e.name);
        return react.createElement("div", { key: childPath },
          react.createElement("div", { className: "f12tr-row", onClick: () => (isDir ? onToggle(childPath, isOpen) : onOpen(childPath, e)) },
            react.createElement("span", { className: "f12tr-ic" }, isDir ? (isOpen ? "▾" : "▸") : (isHtml ? "◆" : "·")),
            react.createElement("span", { className: "f12tr-name" }, e.name),
            isHtml ? react.createElement("span", { className: "f12tr-tag" }, "HTML") : null),
          isDir && isOpen && tree[childPath]
            ? react.createElement("div", { className: "f12tr-children" }, renderEntries(childPath, tree[childPath]))
            : null);
      });
    }
    return react.createElement("div", { className: "f12tree" },
      react.createElement("div", { className: "f12tree-hd" },
        react.createElement("span", null, "📁 工程: " + rootLabel),
        react.createElement("span", { style: { marginLeft: "auto", display: "flex", gap: 6 } },
          react.createElement("button", { className: "f12-btn", style: { padding: "1px 8px" }, onClick: () => onToggle("__reload__", false) }, "刷新"))),
      busy ? react.createElement("div", { className: "f12-label" }, "加载中…") : null,
      entries ? renderEntries(root, entries)
        : react.createElement("div", { className: "f12-label" }, busy ? "" : "（空目录或无权限）"));
  }

  /* ================================================================
     F12 Inspector panel (registered into the details slot)
     ================================================================ */
  function F12InspectorPanel(props) {
    // Follow the active session cwd (workspace root) so the file tree /
    // default load root follows the current project.
    const session = (props && props.useSession) ? props.useSession((s) => s) : null;
    const cwd = (session && session.cwd) || "";

    const [url, setUrl] = react.useState("");
    const [mode, setMode] = react.useState("off"); // off | edit (inspect mode)
    const modeRef = react.useRef("off");
    modeRef.current = mode;
    const [sel, setSel] = react.useState(null);
    const [logs, setLogs] = react.useState([]);
    const [toast, setToast] = react.useState("");
    const [error, setError] = react.useState("");
    const iframeRef = react.useRef(null);
    const [doc, setDoc] = react.useState(null);
    const docRef = react.useRef(null);
    const [loaded, setLoaded] = react.useState(false);
    const [loadTarget, setLoadTarget] = react.useState("");
    const [dirFiles, setDirFiles] = react.useState(null);
    const dirPathRef = react.useRef("");
    const [textEditing, setTextEditing] = react.useState(false);
    const [inlineEditing, setInlineEditing] = react.useState(false);
    const [floatBar, setFloatBar] = react.useState(null);   // {x, y, hasSel} 选中文本工具栏
    const inlineElRef = react.useRef(null);
    const floatBarRef = react.useRef(null);
    const hoverTag = react.useRef(null);
    const selTag = react.useRef(null);
    const hoverBox = react.useRef(null);
    const selBox = react.useRef(null);
    const hoverEl = react.useRef(null);
    const selEl = react.useRef(null);
    const clickLog = react.useRef([]);
    const lastClickRef = react.useRef("");
    const [diag, setDiag] = react.useState("");
    // fullscreen state: when true the whole inspector covers the browser viewport
    const [fullscreen, setFullscreen] = react.useState(false);

    // file tree state (hidden by default so the rendered page dominates)
    const [treeOpen, setTreeOpen] = react.useState(false);
    // protocol log state (dev-only, hidden by default; toggle in toolbar)
    const [showLog, setShowLog] = react.useState(false);
    // element-info state (dev-only, hidden by default; toggle in toolbar)
    const [showInfo, setShowInfo] = react.useState(false);
    const [treeMap, setTreeMap] = react.useState({});
    const [expanded, setExpanded] = react.useState({});
    const [treeBusy, setTreeBusy] = react.useState(false);

    // editor state
    const [editing, setEditing] = react.useState(false);
    const [editPath, setEditPath] = react.useState("");
    const [editContent, setEditContent] = react.useState("");
    const [dirty, setDirty] = react.useState(false);
    const [saving, setSaving] = react.useState(false);
    const [cursor, setCursor] = react.useState({ line: 1, col: 1 });
    // source of the currently loaded page (for edit/refresh)
    const srcRef = react.useRef({ path: "", content: "" });

    // AI component-modify dialog state (select element -> DSH edits ONLY it)
    const [aiOpen, setAiOpen] = react.useState(false);
    const [aiText, setAiText] = react.useState("");
    const [aiBusy, setAiBusy] = react.useState(false); // waiting for DSH edit -> auto refresh
    const aiTimerRef = react.useRef(null);

    const pushLog = (dir, type, brief) => {
      setLogs(prev => [{ dir, type, brief, ts: Date.now() }, ...prev].slice(0, 50));
    };

    // ---- workspace tree ----
    react.useEffect(() => {
      setTreeBusy(true);
      api("list", cwd || "").then((r) => {
        setTreeBusy(false);
        if (r && r.ok) setTreeMap({ [cwd || ""]: r.entries });
        else if (r && r.error) setError("文件树: " + r.error);
      });
    }, [cwd]);

    function reloadTree() {
      setTreeBusy(true);
      api("list", cwd || "").then((r) => {
        setTreeBusy(false);
        if (r && r.ok) setTreeMap({ [cwd || ""]: r.entries });
      });
    }

    function toggleDir(path, isOpen) {
      if (isOpen) {
        const nx = { ...expanded }; nx[path] = false; setExpanded(nx);
        return;
      }
      const nx = { ...expanded }; nx[path] = true; setExpanded(nx);
      if (!treeMap[path]) {
        api("list", path).then((r) => {
          if (r && r.ok) setTreeMap(prev => ({ ...prev, [path]: r.entries }));
        });
      }
    }

    function openTreeFile(path, entry) {
      if (HTML_EXT.test(entry.name)) {
        loadFileByPath(path);
      } else {
        openEditor(path);
      }
    }

    // ---- inspect engine ----
    const clearDocHighlights = () => {
      const d = docRef.current;
      if (!d) return;
      try {
        d.querySelectorAll('.f12-inspect-hover').forEach(e => e.classList.remove('f12-inspect-hover'));
        d.querySelectorAll('.f12-inspect-selected').forEach(e => e.classList.remove('f12-inspect-selected'));
      } catch { /* detached */ }
    };

    const clearAll = () => {
      setSel(null);
      setStyleEdit(null);
      setTextEditing(false);
      if (selTag.current) { selTag.current.remove(); selTag.current = null; }
      if (hoverTag.current) { hoverTag.current.remove(); hoverTag.current = null; }
      if (selBox.current) { selBox.current.remove(); selBox.current = null; }
      if (hoverBox.current) { hoverBox.current.remove(); hoverBox.current = null; }
      selEl.current = null; hoverEl.current = null;
      clearDocHighlights();
    };

    function describeEl(el) {
      const s = getCssSelector(el);
      const domId = el.getAttribute && el.getAttribute('data-dom-id');
      return domId ? el.tagName.toLowerCase() + '[data-dom-id="' + domId + '"]' : s;
    }

    function showTag(el, text, bg, fg) {
      if (hoverTag.current) { hoverTag.current.remove(); }
      if (selTag.current) { selTag.current.remove(); }
      const wrap = iframeRef.current && iframeRef.current.parentElement;
      if (!wrap) return;
      const r = el.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const tag = document.createElement('div');
      tag.textContent = text;
      Object.assign(tag.style, {
        position: 'absolute', zIndex: 9999, fontSize: 11, fontFamily: 'Consolas, Menlo, monospace',
        padding: '2px 8px', borderRadius: 4, background: bg, color: fg, pointerEvents: 'none',
        whiteSpace: 'nowrap', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis',
      });
      tag.style.left = Math.max(0, (r.left - w.left)) + 'px';
      tag.style.top = Math.max(0, (r.top - w.top - 22)) + 'px';
      wrap.appendChild(tag);
      if (bg === '#1f6feb') hoverTag.current = tag; else selTag.current = tag;
    }

    // Parent-side frame ("框框") helpers — guaranteed visible regardless of
    // the preview document's own CSS.
    function makeBox(border, bg) {
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'absolute', zIndex: 9998, pointerEvents: 'none',
        boxSizing: 'border-box', border: '2px solid ' + border, background: bg,
        display: 'none',
      });
      return box;
    }
    function placeBox(box, el) {
      const wrap = iframeRef.current && iframeRef.current.parentElement;
      if (!wrap || !el) return;
      const r = el.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = (r.left - w.left) + 'px';
      box.style.top = (r.top - w.top) + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }
    function onScroll() {
      if (hoverBox.current && hoverEl.current) placeBox(hoverBox.current, hoverEl.current);
      if (selBox.current && selEl.current) placeBox(selBox.current, selEl.current);
    }

    // Listeners bound to the preview document.
    function onMouseOver(e) {
      if (modeRef.current !== 'edit') return;
      const t = e.target && e.target.closest ? e.target.closest('body *') : null;
      const curDoc = docRef.current;
      if (!t || !curDoc || t === curDoc.body || t === curDoc.documentElement) return;
      clearDocHighlights();
      t.classList.add('f12-inspect-hover');
      const wrap = iframeRef.current && iframeRef.current.parentElement;
      if (wrap && !hoverBox.current) { hoverBox.current = makeBox('#1f6feb', 'rgba(31,111,235,.10)'); wrap.appendChild(hoverBox.current); }
      hoverEl.current = t;
      if (hoverBox.current) placeBox(hoverBox.current, t);
      showTag(t, describeEl(t), '#1f6feb', '#fff');
      pushLog('iframe→host', 'inspect:hover', describeEl(t));
    }
    function onMouseOut() {
      if (modeRef.current !== 'edit') return;
      clearDocHighlights();
      if (hoverTag.current) { hoverTag.current.remove(); hoverTag.current = null; }
      if (hoverBox.current) { hoverBox.current.style.display = 'none'; }
      hoverEl.current = null;
    }
    function onClick(e) {
      // 点击即选中：不依赖检查模式开关（mode 只管悬停高亮）
      clickLog.current.push('click:' + (e.isTrusted ? 'T' : 'S') + ':' + (e.target && e.target.tagName));
      lastClickRef.current = (e.isTrusted ? '真实点击' : '合成') + ' → ' + (e.target && e.target.tagName) + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
      setDiag(lastClickRef.current);
      const t = e.target && e.target.closest ? e.target.closest('body *') : null;
      const curDoc = docRef.current;
      if (!t || !curDoc || t === curDoc.body || t === curDoc.documentElement) { clearAll(); return; }
      // 就地编辑中点击其他元素 → 先完成编辑
      if (inlineEditing && inlineElRef.current && inlineElRef.current !== t) {
        commitInlineEdit();
      }
      // 用户刚拖选了一段文字（selection 非空）→ 不干扰选择，让浮动工具栏出现
      let hasSelection = false;
      try {
        const sel = curDoc.getSelection();
        hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
      } catch { /* ignore */ }
      if (hasSelection) {
        onSelectionChange();
        return;
      }
      e.preventDefault(); e.stopPropagation();
      clearDocHighlights();
      t.classList.add('f12-inspect-selected');
      let payload;
      try {
        payload = buildElementPayload(t);
      } catch (err) {
        payload = {
          tagName: t.tagName,
          textContent: (t.textContent || '').trim().substring(0, 120),
          className: (t.className || '').toString(),
          selector: describeEl(t),
          xpath: '',
          rect: { width: 0, height: 0, left: 0, top: 0 },
          domId: null,
          outerHtml: '',
        };
      }
      setSel(payload);
      // 选中即浮现：自动展开信息面板
      setShowInfo(true);
      if (hoverBox.current) hoverBox.current.style.display = 'none';
      const wrap = iframeRef.current && iframeRef.current.parentElement;
      if (wrap && !selBox.current) { selBox.current = makeBox('#d29922', 'rgba(210,153,34,.12)'); wrap.appendChild(selBox.current); }
      selEl.current = t;
      if (selBox.current) placeBox(selBox.current, t);
      showTag(t, describeEl(t), '#d29922', '#0d1117');
      // 单击文字元素 → 自动进入就地编辑（点进去就能打字，Word/PPT 体验）
      const tag = t.tagName;
      const textLike = /^(P|H1|H2|H3|H4|H5|H6|SPAN|DIV|A|LI|TD|TH|LABEL|STRONG|EM|B|I|U|SMALL|BLOCKQUOTE|PRE|CODE)$/i.test(tag);
      const hasDirectText = Array.from(t.childNodes).some(n => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
      if (textLike && hasDirectText && !inlineEditing) {
        enterInlineEdit(t);
        setToast("✏️ 正在就地编辑：直接打字/删字，点空白处或 Esc 完成");
      }
      pushLog('iframe→host', 'inspect:select', payload.tagName + ' · ' + (payload.selector || ''));
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { clearAll(); pushLog('host→iframe', 'inspect:clear', ''); }
    }

    function attachInspect(d) {
      if (!d) return;
      docRef.current = d;
      setDoc(d);
      d.addEventListener('mouseover', onMouseOver, true);
      d.addEventListener('mouseover', onMouseOver);
      d.addEventListener('mouseout', onMouseOut, true);
      d.addEventListener('mouseout', onMouseOut);
      d.addEventListener('click', onClick, true);
      d.addEventListener('click', onClick);
      d.addEventListener('dblclick', onDblClick, true);
      d.addEventListener('dblclick', onDblClick);
      d.addEventListener('keydown', onKeyDown, true);
      d.addEventListener('keydown', onKeyDown);
      d.addEventListener('keyup', (e) => { onSelectionChange(); if (e.key === 'Escape' && inlineEditing) commitInlineEdit(); }, true);
      d.addEventListener('keyup', (e) => { onSelectionChange(); if (e.key === 'Escape' && inlineEditing) commitInlineEdit(); });
      d.addEventListener('mouseup', onSelectionChange, true);
      d.addEventListener('mouseup', onSelectionChange);
      d.addEventListener('scroll', onScroll, true);
    }
    function detachInspect() {
      if (!doc) return;
      try {
        doc.removeEventListener('mouseover', onMouseOver, true);
        doc.removeEventListener('mouseover', onMouseOver);
        doc.removeEventListener('mouseout', onMouseOut, true);
        doc.removeEventListener('mouseout', onMouseOut);
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('click', onClick);
        doc.removeEventListener('keydown', onKeyDown, true);
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('scroll', onScroll, true);
      } catch { /* detached */ }
      docRef.current = null;
      setDoc(null);
    }

    // ---- load page ----
    function loadHtml(content, target, srcPath) {
      detachInspect();
      setSel(null);
      setLoaded(false);
      setMode('off');
      setError("");
      setEditing(false);
      srcRef.current = { path: srcPath || "", content };
      if (iframeRef.current) iframeRef.current.srcdoc = content;
      setLoadTarget(target);
    }

    async function loadFileByPath(p) {
      setError("");
      const r = await api("read", p);
      if (!r || !r.ok) { setError((r && r.error) || "读取失败"); return; }
      if (HTML_EXT.test(p)) {
        loadHtml(r.content, "文件 " + (r.path || p), r.path || p);
        pushLog('host→iframe', 'inspect:request', '载入 ' + (r.path || p));
      } else {
        openEditor(r.path || p, r.content);
      }
    }

    // 把 file:///D:/... 这类本地地址转成 D:/... 路径（也兼容 /D:/... 形式）
    function normalizeLocalPath(p) {
      let s = p.trim();
      // file:///D:/x  ->  D:/x
      if (/^file:\/\//i.test(s)) {
        s = s.replace(/^file:\/\//i, '');
        // Windows 盘符前可能残留一个前导斜杠：/D:/x -> D:/x
        if (/^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
        // 路径里的反斜杠统一为正斜杠
        s = s.replace(/\\/g, '/');
        return s;
      }
      // 纯 Windows 路径 D:\x 或 D:/x → 保留（host 已支持）
      return s;
    }

    async function loadFile() {
      const raw = url.trim();
      if (!raw) { setError("请先输入路径（工作区相对 / 绝对 / file:// 地址）或网址"); return; }
      setError("");
      if (/^https?:\/\//i.test(raw)) { loadUrl(); return; }
      const p = normalizeLocalPath(raw);
      // 先按目录尝试：能列出条目 → 快速点选
      const listing = await api("list", p);
      if (listing && listing.ok && Array.isArray(listing.entries)) {
        dirPathRef.current = listing.path || p;
        setDirFiles(listing.entries);
        setLoadTarget("文件夹 " + (listing.path || p) + "（点选载入）");
        pushLog('host→iframe', 'inspect:request', '列出文件夹 ' + (listing.path || p));
        return;
      }
      // 否则按文件读取（HTML → 预览，其他文本 → 编辑器）
      await loadFileByPath(p);
    }

    function pickDirFile(f) {
      setDirFiles(null);
      loadFileByPath((dirPathRef.current ? dirPathRef.current + "/" : "") + f.name);
    }

    function loadUrl() {
      const u = url.trim();
      if (!u) { setError("请输入网址"); return; }
      setError("");
      detachInspect();
      setSel(null);
      setLoaded(false);
      setEditing(false);
      srcRef.current = { path: "", content: "" };
      const ifr = iframeRef.current;
      if (!ifr) return;
      let href;
      try { href = new URL(u, location.href).href; } catch { href = u; }
      ifr.src = href;
      setLoadTarget("网址 " + href);
      pushLog('host→iframe', 'inspect:request', '导航到 ' + href);
    }

    // Inject the highlight frame CSS into the preview document so the
    // hovered/selected element gets a visible box ("框框") around it.
    function injectInspectCss(d) {
      try {
        if (!d.getElementById('f12-inspect-style')) {
          const st = d.createElement('style');
          st.id = 'f12-inspect-style';
          st.textContent = '.f12-inspect-hover{outline:2px solid #1f6feb !important;outline-offset:0;background:rgba(31,111,235,.10) !important}'
            + '.f12-inspect-selected{outline:2px solid #d29922 !important;outline-offset:0;background:rgba(210,153,34,.12) !important}';
          (d.head || d.documentElement).appendChild(st);
        }
      } catch { /* ignore */ }
    }

    function onIframeLoad() {
      setLoaded(true);
      const d = iframeRef.current && iframeRef.current.contentDocument;
      let inspectable = false;
      try {
        if (d && d.body) {
          attachInspect(d);
          injectInspectCss(d);
          inspectable = true;
          const ifr = iframeRef.current;
          setDiag('引擎已就绪 · iframe ' + (ifr ? Math.round(ifr.clientWidth) + 'x' + Math.round(ifr.clientHeight) : '?') + ' · 点击元素即可选中');
          pushLog('iframe→host', 'inspect:ready', '检查引擎已注入预览 iframe');
        } else {
          setDiag('⚠ 页面可显示但无法注入检查引擎（可能是跨域页面）');
          pushLog('iframe→host', 'inspect:ready', '跨域页面：无法注入检查引擎');
        }
      } catch {
        setDiag('⚠ 页面可显示但无法注入检查引擎（可能是跨域页面）');
        pushLog('iframe→host', 'inspect:ready', '跨域页面：无法注入检查引擎');
      }
      setMode(inspectable ? 'edit' : 'off');
    }

    // ---- editor ----
    function openEditor(path, content) {
      if (content === undefined) {
        api("read", path).then((r) => {
          if (r && r.ok) { setEditPath(r.path || path); setEditContent(r.content); setDirty(false); setEditing(true); setError(""); }
          else setError((r && r.error) || "读取失败");
        });
        return;
      }
      setEditPath(path); setEditContent(content); setDirty(false); setEditing(true); setError("");
    }

    function startEditLoaded() {
      const src = srcRef.current;
      if (!src.content) { setError("当前页面没有可编辑源码（请从文件载入）"); return; }
      setEditPath(src.path); setEditContent(src.content); setDirty(false); setEditing(true);
    }

    function saveEdit() {
      if (!editPath) return;
      setSaving(true);
      api("write", editPath, editContent).then((r) => {
        setSaving(false);
        if (r && r.ok) { setDirty(false); setToast("✅ 已保存 " + editPath); }
        else setError("保存失败: " + ((r && r.error) || "unknown"));
      });
    }

    function refreshPreview() {
      // apply edited source to the preview iframe, then back to inspect mode
      srcRef.current = { path: editPath, content: editContent };
      setEditing(false);
      detachInspect();
      setSel(null);
      setLoaded(false);
      setMode('off');
      if (iframeRef.current) iframeRef.current.srcdoc = editContent;
      setLoadTarget("编辑预览 " + (editPath || ""));
      pushLog('host→iframe', 'inspect:request', '刷新预览 ' + (editPath || ""));
    }

    function copySelector() {
      if (!sel) return;
      copyText(sel.selector);
      setToast("✅ 已复制选择器: " + sel.selector);
      pushLog('host→iframe', 'inspect:copy', '复制 ' + sel.selector);
    }

    function addToChat() {
      if (!sel) return;
      const text = "[F12 选中元素] 请帮我修改这个页面元素：\n"
        + "- 标签: " + sel.tagName + "\n"
        + "- CSS 选择器: " + sel.selector + "\n"
        + "- XPath: " + sel.xpath + "\n"
        + (sel.domId ? "- data-dom-id: " + sel.domId + "\n" : "")
        + (sel.textContent ? "- 文本: " + sel.textContent.substring(0, 50) + "\n" : "")
        + "- 尺寸: " + sel.rect.width + "×" + sel.rect.height + " @ (" + sel.rect.left + "," + sel.rect.top + ")\n"
        + "- 外联HTML: " + (sel.outerHtml || "").substring(0, 120) + "\n"
        + "请告诉我你想怎么改（改文字/样式/位置/删掉…）";
      let filled = false;
      try {
        const inputActions = props.inputActions;
        const input = props.input;
        if (inputActions && typeof inputActions.setDraft === 'function') {
          const current = input && typeof input.draft === 'string' ? input.draft : "";
          inputActions.setDraft(current.trim() ? current + "\n" + text : text);
          filled = true;
        }
      } catch { /* draft not available */ }
      pushLog('iframe→host', 'inspect:add-to-chat', sel.selector);
      setToast(filled ? "✅ 已填入对话输入框，直接发送给我即可" : "已复制元素信息（未能自动填入输入框）");
      if (!filled) copyText(text);
    }

    /* ============ 第一梯队：截图+代码发对话 / 复制完整信息 / 改样式 / 改文字 ============ */

    // 复制完整信息（outerHTML + selector + xpath + 计算样式）
    function copyFullInfo() {
      if (!sel) return;
      const el = selEl.current;
      let stylesText = '';
      if (el) {
        try {
          const cs = getComputedStyle(el);
          const keys = ['display','position','width','height','margin','padding','color','background-color','font-size','font-weight','border','border-radius','box-shadow','gap'];
          stylesText = keys.map(k => '  ' + k + ': ' + cs.getPropertyValue(k)).join('\n');
        } catch { /* ignore */ }
      }
      const info = "[F12 元素完整信息]\n"
        + "标签: " + sel.tagName + "\n"
        + "CSS 选择器: " + sel.selector + "\n"
        + "XPath: " + sel.xpath + "\n"
        + (sel.domId ? "data-dom-id: " + sel.domId + "\n" : "")
        + "文本: " + (sel.textContent || "(空)") + "\n"
        + "尺寸: " + sel.rect.width + "×" + sel.rect.height + " @ (" + sel.rect.left + "," + sel.rect.top + ")\n"
        + (stylesText ? "计算样式:\n" + stylesText + "\n" : "")
        + "HTML: " + (sel.outerHtml || "");
      copyText(info);
      setToast("✅ 已复制完整信息（含计算样式）");
      pushLog('iframe→host', 'inspect:copy-full', sel.selector);
    }

    // 截取选中元素截图（canvas 裁剪 iframe 区域）
    function captureElementScreenshot() {
      const ifr = iframeRef.current;
      const el = selEl.current;
      if (!ifr || !el) return null;
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) { setToast("⚠ 元素太小无法截图"); return null; }
        const hadSel = el.classList.contains('f12-inspect-selected');
        if (hadSel) el.classList.remove('f12-inspect-selected');
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
        const ctx2 = canvas.getContext('2d');
        ctx2.drawImage(ifr, rect.left, rect.top, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
        if (hadSel) el.classList.add('f12-inspect-selected');
        return canvas.toDataURL('image/png');
      } catch (err) {
        setToast("⚠ 截图失败: " + String((err && err.message) || err).slice(0, 60));
        return null;
      }
    }

    function dataURLtoBlob(dataUrl) {
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const n = bstr.length;
      const u8arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
      return new Blob([u8arr], { type: mime });
    }

    // 截图 + 代码 一起加入对话（多模态）
    function addToChatWithScreenshot() {
      if (!sel) return;
      const text = "[F12 选中元素] 请帮我修改这个页面元素：\n"
        + "- 标签: " + sel.tagName + "\n"
        + "- CSS 选择器: " + sel.selector + "\n"
        + "- XPath: " + sel.xpath + "\n"
        + (sel.domId ? "- data-dom-id: " + sel.domId + "\n" : "")
        + (sel.textContent ? "- 文本: " + sel.textContent.substring(0, 50) + "\n" : "")
        + "- 尺寸: " + sel.rect.width + "×" + sel.rect.height + " @ (" + sel.rect.left + "," + sel.rect.top + ")\n"
        + "随附该元素的截图，请结合截图帮我修改。";
      let got = 0;
      try {
        const inputActions = props.inputActions;
        const input = props.input;
        if (inputActions && typeof inputActions.setDraft === 'function') {
          const current = input && typeof input.draft === 'string' ? input.draft : "";
          inputActions.setDraft(current.trim() ? current + "\n" + text : text);
          got++;
        }
      } catch { /* draft not available */ }
      try {
        const dataUrl = captureElementScreenshot();
        if (dataUrl && props.conversation && props.inputActions) {
          const blob = dataURLtoBlob(dataUrl);
          const file = new File([blob], 'f12-element.png', { type: 'image/png' });
          const atts = props.conversation.createDraftImages([file]);
          if (atts && atts.length && typeof props.inputActions.addImages === 'function') {
            props.inputActions.addImages(atts.map(a => a.id));
            got++;
          }
        }
      } catch { /* screenshot attach failed */ }
      pushLog('iframe→host', 'inspect:add-to-chat-img', sel.selector + (got > 1 ? ' + 截图' : ''));
      setToast(got > 1 ? "✅ 元素代码+截图已加入对话，发送给我即可" : (got === 1 ? "✅ 代码已加入对话（截图附加失败）" : "已复制元素信息"));
      if (got === 0) copyText(text);
    }

    // 直接改文字
    function startTextEdit() {
      const el = selEl.current;
      if (!el) return;
      setTextEditing(true);
      setToast("✏️ 输入新文字，按回车确认，Esc 取消");
      pushLog('host→iframe', 'inspect:text-edit', sel.selector);
    }

    function commitTextEdit() {
      const el = selEl.current;
      if (!el || !textEditing) return;
      const input = document.getElementById('f12-text-input');
      if (input && input.value.trim() !== '') {
        el.textContent = input.value;
        setSel(prev => prev ? { ...prev, textContent: input.value } : prev);
        setToast("✅ 文字已修改（仅预览）");
        pushLog('host→iframe', 'inspect:text-commit', input.value.slice(0, 30));
      }
      setTextEditing(false);
    }

    /* ============ 就地实时编辑（Word/PPT 风格） ============
       双击文字元素 → contenteditable 就地打字删字（所见即所得）
       在预览里选中一段文字 → 浮动工具栏（加粗/颜色/字号）即时生效
    */

    // 进入就地编辑（单击文字 / 双击 都走这里）
    function enterInlineEdit(t) {
      const curDoc = docRef.current;
      if (!t || !curDoc) return;
      // 只对文本容器就地编辑（避免把整个页面变成可编辑）
      const tag = t.tagName;
      const editable = !/^(HTML|BODY|SCRIPT|STYLE|IFRAME|FORM|INPUT|TEXTAREA|SELECT|BUTTON)$/i.test(tag);
      if (!editable) { toast1("⚠ 这个元素不适合就地编辑"); return; }
      // 记录原始内容，进入编辑
      inlineElRef.current = t;
      t.classList.add('f12-inline-edit');
      t.contentEditable = 'true';
      t.focus();
      setInlineEditing(true);
      setFloatBar(null);
      // 把光标放到点击处
      try {
        const r = document.createRange();
        const sel = curDoc.getSelection();
        r.selectNodeContents(t);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch { /* ignore */ }
      pushLog('host→iframe', 'inspect:inline-edit', t.tagName);
    }

    // 双击进入就地编辑（兼容保留）
    function onDblClick(e) {
      const t = e.target && e.target.closest ? e.target.closest('body *') : null;
      const curDoc = docRef.current;
      if (!t || !curDoc || t === curDoc.body || t === curDoc.documentElement) return;
      e.preventDefault(); e.stopPropagation();
      enterInlineEdit(t);
    }

    function toast1(msg) { setToast(msg); }

    // 完成就地编辑
    function commitInlineEdit() {
      const el = inlineElRef.current;
      if (!el) return;
      try { el.contentEditable = 'false'; } catch { /* ignore */ }
      el.classList.remove('f12-inline-edit');
      const newText = (el.textContent || '').trim();
      setSel(prev => prev ? { ...prev, textContent: newText } : prev);
      inlineElRef.current = null;
      setInlineEditing(false);
      pushLog('host→iframe', 'inspect:inline-commit', newText.slice(0, 30));
    }

    // 选中文本时显示浮动工具栏（Word/PPT 风格）
    function onSelectionChange() {
      const curDoc = docRef.current;
      if (!curDoc) return;
      const sel = curDoc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        // 无选区 → 隐藏工具栏（除非正在就地编辑）
        if (!inlineEditing) setFloatBar(null);
        return;
      }
      // 选区在 iframe 内
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (!curDoc.contains(container)) { setFloatBar(null); return; }
      // 计算工具栏位置（选区上方）
      const rect = range.getBoundingClientRect();
      const wrap = iframeRef.current && iframeRef.current.parentElement;
      const wrapRect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
      setFloatBar({
        x: Math.max(0, rect.left - wrapRect.left + rect.width / 2 - 70),
        y: Math.max(0, rect.top - wrapRect.top - 40),
        hasSel: true,
      });
    }

    // 对选中文本应用样式（execCommand 即时生效）
    function applySelectionStyle(cmd, value) {
      const curDoc = docRef.current;
      if (!curDoc) return;
      try {
        curDoc.execCommand('styleWithCSS', false, 'true');
        if (cmd === 'foreColor' || cmd === 'backColor' || cmd === 'fontSize' || cmd === 'fontName') {
          curDoc.execCommand(cmd, false, value);
        } else {
          curDoc.execCommand(cmd, false, null);
        }
        setToast("✅ 已应用到选中文字（仅预览）");
        pushLog('host→iframe', 'inspect:sel-style', cmd + (value ? '=' + value : ''));
        // 应用后保持选中，工具栏还在
        onSelectionChange();
      } catch (err) {
        setToast("⚠ 应用失败: " + String((err && err.message) || err).slice(0, 40));
      }
    }

    // 清除选中文字的样式（移除所有内联样式）
    function clearSelectionStyle() {
      const curDoc = docRef.current;
      if (!curDoc) return;
      try {
        curDoc.execCommand('removeFormat', false, null);
        setToast("↩️ 已清除选中文字格式");
        pushLog('host→iframe', 'inspect:sel-clear', '');
      } catch { /* ignore */ }
    }

    // 获取当前选区元素的字号（用于 - / + 显示）
    function getSelectionFontSize() {
      const curDoc = docRef.current;
      if (!curDoc) return 16;
      const sel = curDoc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return 16;
      try {
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node.nodeType === 3 ? node.parentElement : node;
        const fs = el && getComputedStyle(el).fontSize;
        return fs ? Math.round(parseFloat(fs)) : 16;
      } catch { return 16; }
    }

    // 字号 +/-（用 span 包裹选中文字精确设 px）
    function adjustSelectionFontSize(delta) {
      const curDoc = docRef.current;
      if (!curDoc) return;
      const sel = curDoc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setToast("⚠ 请先选中文字"); return; }
      const base = getSelectionFontSize();
      const next = Math.max(8, Math.min(72, base + delta));
      try {
        curDoc.execCommand('styleWithCSS', false, 'true');
        curDoc.execCommand('fontSize', false, '3'); // 先落一个锚点
        // 用 span 精确设像素
        const range = sel.getRangeAt(0);
        const span = curDoc.createElement('span');
        span.style.fontSize = next + 'px';
        try { range.surroundContents(span); }
        catch { /* 跨元素选区 fallback 已用 fontSize */ }
        setToast("🔤 字号 → " + next + "px");
        pushLog('host→iframe', 'inspect:sel-fontsize', next + 'px');
        onSelectionChange();
      } catch (err) {
        setToast("⚠ 字号调整失败");
      }
    }

    // 文本对齐（左/中/右）
    function alignSelection(dir) {
      const curDoc = docRef.current;
      if (!curDoc) return;
      try {
        const cmd = dir === 'left' ? 'justifyLeft' : dir === 'center' ? 'justifyCenter' : 'justifyRight';
        curDoc.execCommand(cmd, false, null);
        setToast("↔ 已" + (dir === 'left' ? '左' : dir === 'center' ? '居中' : '右') + "对齐");
        pushLog('host→iframe', 'inspect:sel-align', dir);
        onSelectionChange();
      } catch (err) {
        setToast("⚠ 对齐失败");
      }
    }

    // 删除选中文字
    function deleteSelectionText() {
      const curDoc = docRef.current;
      if (!curDoc) return;
      try {
        curDoc.execCommand('delete', false, null);
        setToast("🗑 已删除选中文字");
        pushLog('host→iframe', 'inspect:sel-delete', '');
        onSelectionChange();
      } catch { /* ignore */ }
    }

    // AI 编辑：把选中文字的上下文发到对话（我是 agent，接收你的修改要求后改源文件）
    function aiEditSelection() {
      const curDoc = docRef.current;
      if (!curDoc) return;
      const sel = curDoc.getSelection();
      const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : '';
      if (!selectedText) { setToast("⚠ 请先选中要修改的文字"); return; }
      // 找到选区所在元素 → 定位信息
      let loc = { selector: '', xpath: '' };
      try {
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node.nodeType === 3 ? node.parentElement : node;
        if (el && el.closest) {
          const target = el.closest('p, h1, h2, h3, h4, h5, h6, span, div, li, td, th, a, strong, em, blockquote, pre, code') || el;
          loc.selector = getCssSelector(target);
          loc.xpath = getXPath(target);
          selEl.current = target;
        }
      } catch { /* ignore */ }
      const text = "[F12 选中文字] 我选中了这段文字：\n"
        + "「" + selectedText.substring(0, 80) + "」\n"
        + "- 元素: " + (selEl.current ? selEl.current.tagName : '?') + "\n"
        + "- CSS 选择器: " + loc.selector + "\n"
        + "- XPath: " + loc.xpath + "\n"
        + "你想怎么改？直接告诉我就行（改文字/样式/对齐/删掉…），我会修改源文件。";
      let filled = false;
      try {
        const inputActions = props.inputActions;
        const input = props.input;
        if (inputActions && typeof inputActions.setDraft === 'function') {
          const current = input && typeof input.draft === 'string' ? input.draft : "";
          inputActions.setDraft(current.trim() ? current + "\n" + text : text);
          filled = true;
        }
      } catch { /* draft not available */ }
      setToast(filled ? "🤖 已把选中文字发给 AI，请告诉我怎么改" : "已复制（未能自动填入输入框）");
      pushLog('host→iframe', 'inspect:ai-edit', loc.selector);
      if (!filled) copyText(text);
    }

    function stopAiWatch() {
      if (aiTimerRef.current) { clearInterval(aiTimerRef.current); aiTimerRef.current = null; }
      setAiBusy(false);
    }

    function sendAiModify() {
      if (!sel) return;
      const instruction = aiText.trim();
      if (!instruction) { setError("请先输入你想怎么改这个组件"); return; }
      const src = srcRef.current;
      const outer = (sel.outerHtml || "").substring(0, 1200);
      const text = "[F12 AI 修改] 请只针对下面这一个组件进行修改，页面其他任何部分一律不要动：\n"
        + "- 标签: " + sel.tagName + "\n"
        + "- CSS 选择器: " + sel.selector + "\n"
        + "- XPath: " + (sel.xpath || "") + "\n"
        + "- 当前 outerHTML:\n" + outer + "\n"
        + "修改要求（用户原话）:\n" + instruction + "\n"
        + "请只修改这一个组件（它的 HTML / 类名 / 内联样式 / 相关 CSS 规则），改完把改动写回源文件，并简要说明改了哪些文件与内容。";
      let filled = false;
      try {
        const inputActions = props.inputActions;
        const input = props.input;
        if (inputActions && typeof inputActions.setDraft === 'function') {
          const current = input && typeof input.draft === 'string' ? input.draft : "";
          inputActions.setDraft(current.trim() ? current + "\n" + text : text);
          filled = true;
          if (typeof inputActions.submit === 'function') { try { inputActions.submit(); } catch { /* ignore */ } }
        }
      } catch { /* draft not available */ }
      setAiOpen(false);
      setAiText("");
      pushLog('host→iframe', 'inspect:ai-modify', sel.selector);
      if (!filled) { copyText(text); setToast("未能自动发送，已复制指令到剪贴板"); return; }
      setToast("🤖 已发送给 DSH：只改选中的这个组件，改完自动刷新预览");
      // watch the loaded source file for edits -> auto reload preview
      stopAiWatch();
      if (src.path) {
        setAiBusy(true);
        const deadline = Date.now() + 180000;
        aiTimerRef.current = setInterval(async () => {
          try {
            if (srcRef.current.path !== src.path) { stopAiWatch(); return; }
            const r = await api("read", src.path);
            if (r && r.ok && typeof r.content === "string" && r.content !== srcRef.current.content) {
              stopAiWatch();
              loadHtml(r.content, "文件 " + src.path, src.path);
              setToast("✅ 源码已更新，预览已自动刷新");
            } else if (Date.now() > deadline) {
              stopAiWatch();
            }
          } catch { if (Date.now() > deadline) stopAiWatch(); }
        }, 2000);
      }
    }

    react.useEffect(() => {
      if (!toast) return;
      const t = setTimeout(() => setToast(""), 2200);
      return () => clearTimeout(t);
    }, [toast]);

    react.useEffect(() => () => { detachInspect(); }, []);

    // Receive "在 F12 预览" requests from the chat turn-tail action. The
    // effect runs once; loadFileByPath is hoisted and only touches stable
    // refs/setters, so the captured first-render closure is safe.
    react.useEffect(() => {
      const fn = (p) => { loadFileByPath(p); };
      panelLoadListeners.add(fn);
      while (queuedLoads.length) { const p = queuedLoads.shift(); fn(p); }
      return () => { panelLoadListeners.delete(fn); };
    }, []);

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return true;
        }
      } catch { /* fall through */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        return true;
      } catch { return false; }
    }

    const closeDetails = props.closeDetails;
    const activeBtn = mode === 'edit' ? "f12-btn f12-btn-active" : "f12-btn";
    const canEdit = !!(srcRef.current.content);

    return react.createElement("div", { className: "f12-root" + (fullscreen ? " f12-fullscreen" : "") },
      // header
      react.createElement("div", { className: "f12-hdr" },
        react.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#e6edf3" } }, "🔍 F12 检查器"),
        react.createElement("span", { className: "f12-label", style: { marginLeft: 4 } }, "载入页面后点元素即选中"),
        react.createElement("button", {
          type: "button", title: fullscreen ? "退出全屏（还原）" : "全屏",
          style: { marginLeft: "auto", height: 26, padding: "0 8px", borderRadius: 6, border: "none", cursor: "pointer", background: "transparent", color: fullscreen ? "#e3b341" : "#8b949e", fontSize: 12 },
          onClick: () => setFullscreen(!fullscreen),
        }, fullscreen ? "⤢ 还原" : "⛶ 全屏"),
        react.createElement("button", {
          type: "button", title: "关闭第三栏",
          style: { width: 26, height: 26, borderRadius: 6, border: "none", cursor: "pointer", background: "transparent", color: "#8b949e", fontSize: 16, lineHeight: 1 },
          onClick: () => { try { closeDetails(); } catch (e) { /* column may be unavailable */ } },
        }, "✕")),

      // url row
      react.createElement("div", { className: "f12-urlrow" },
        react.createElement("input", {
          className: "f12-inp", value: url,
          placeholder: "路径 / 网址 / file:// 地址 (如 file:///D:/x.html)",
          onChange: (e) => setUrl(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') loadFile(); },
        }),
        react.createElement("button", { className: "f12-btn", onClick: loadFile, title: "载入本地文件（相对工作区或绝对路径）" }, "📄 载入"),
        react.createElement("button", { className: "f12-btn", onClick: loadUrl, title: "打开网址" }, "🌐 网址")),

      // toolbar row
      react.createElement("div", { className: "f12-row" },
        react.createElement("button", {
          className: activeBtn, disabled: !loaded && !editing,
          onClick: () => {
            const next = mode === 'edit' ? 'off' : 'edit';
            setMode(next);
            pushLog(next === 'edit' ? 'host→iframe' : 'iframe→host', 'inspect:state', next === 'edit' ? '编辑模式开启' : '编辑模式关闭');
          },
          title: "开启编辑模式：在预览里悬停/点击元素，用边框圈出要改的组件",
        }, "🖱 编辑模式"),
        react.createElement("button", {
          className: "f12-btn", disabled: !canEdit,
          onClick: startEditLoaded, title: "编辑当前页面源码（VSCode 风格）",
        }, "✏️ 编辑"),
        react.createElement("button", {
          className: "f12-btn", onClick: () => setTreeOpen(!treeOpen),
          title: "显示/隐藏工作区文件树",
        }, treeOpen ? "📁 文件▾" : "📁 文件▸"),
        react.createElement("button", {
          className: "f12-btn", onClick: () => setShowLog(!showLog),
          title: "显示/隐藏协议日志（开发者调试用）",
        }, showLog ? "🕮 协议▾" : "🕮 协议▸"),
        react.createElement("button", {
          className: "f12-btn", onClick: () => setShowInfo(!showInfo),
          title: "显示/隐藏定位信息（选择器/XPath/尺寸）",
        }, showInfo ? "ℹ️ 信息▾" : "ℹ️ 信息▸"),
        react.createElement("span", { className: "f12-label", style: { marginLeft: "auto" } },
          mode === 'edit' ? "开启中 · Esc 取消" : (loaded ? "未开启" : "")),
        react.createElement("button", { className: "f12-btn", onClick: clearAll, title: "清除选择" }, "✕")),

      // file tree
      treeOpen ? react.createElement(FileTree, {
        root: cwd || "", tree: treeMap, expanded, onToggle: (p, isOpen) => { if (p === "__reload__") reloadTree(); else toggleDir(p, isOpen); }, onOpen: openTreeFile, busy: treeBusy,
      }) : null,

      // quick folder pick
      dirFiles ? react.createElement("div", { className: "f12tree" },
        react.createElement("div", { className: "f12tree-hd" }, react.createElement("span", null, loadTarget || "文件夹"), react.createElement("span", { style: { marginLeft: "auto" } }, "点选载入：")),
        dirFiles.map((f, i) => react.createElement("div", { key: i, className: "f12tr-row", onClick: () => { pickDirFile(f); } },
          react.createElement("span", { className: "f12tr-ic" }, "◆"),
          react.createElement("span", { className: "f12tr-name" }, f.name),
          react.createElement("span", { className: "f12tr-tag" }, f.size + "B"))),
      ) : null,

      error ? react.createElement("div", { className: "f12-err" }, "⚠ " + error) : null,
      toast ? react.createElement("div", { className: "f12-toast" }, toast) : null,
      diag ? react.createElement("div", { className: "f12-diag" }, "🔎 " + diag) : null,

      // preview / editor body
      editing
        ? react.createElement(react.Fragment, null,
            react.createElement("div", { className: "f12ed-bar" },
              react.createElement("span", { className: "f12ed-fn" }, editPath || "(未命名)"),
              dirty ? react.createElement("span", { className: "f12ed-dirty" }, "● 未保存") : null,
              react.createElement("button", { className: "f12-btn f12-btn-primary", disabled: !dirty || saving, onClick: saveEdit }, saving ? "保存中" : "保存"),
              react.createElement("button", { className: "f12-btn", onClick: refreshPreview }, "刷新预览"),
              react.createElement("button", { className: "f12-btn", onClick: () => setEditing(false), title: "回到检查视图（不保存）" }, "返回")),
            react.createElement(CodeEditor, { value: editContent, onChange: (v) => { setEditContent(v); setDirty(true); }, onCursor: setCursor }),
            react.createElement("div", { className: "f12ed-status" },
              react.createElement("span", null, "HTML"),
              react.createElement("span", null, "UTF-8"),
              react.createElement("span", null, "Ln " + cursor.line + ", Col " + cursor.col)))
        : react.createElement("div", { className: "f12-preview" },
            loaded
              ? null
              : react.createElement("div", { className: "f12-empty" },
                  react.createElement("div", {}, "🛠 F12 元素检查器"),
                  react.createElement("div", {}, "· 在左侧文件树点选 HTML 文件，或"),
                  react.createElement("div", {}, "· 顶部输入文件路径 / 网址载入"),
                  react.createElement("div", {}, "· 载入后悬停高亮、点击选中元素"),
                  react.createElement("div", { style: { marginTop: 8 } }, loadTarget ? "当前: " + loadTarget : "尚未载入页面"),
                ),
            react.createElement("iframe", { ref: iframeRef, className: "f12-iframe", onLoad: onIframeLoad, sandbox: "allow-same-origin allow-scripts allow-forms allow-popups", title: "F12 检查预览" }),
            // 选中文本浮动工具栏（Word/PPT 风格，覆盖在预览上方）
            floatBar && floatBar.hasSel
              ? react.createElement("div", { ref: floatBarRef, style: { position: "absolute", left: floatBar.x, top: floatBar.y, zIndex: 99999, display: "flex", alignItems: "center", gap: 2, background: "#fff", border: "1px solid #e1e4e8", borderRadius: 8, padding: "4px", boxShadow: "0 4px 16px rgba(0,0,0,.15)", maxWidth: "calc(100% - 20px)", flexWrap: "wrap" } },
                  // 字体选择
                  react.createElement("select", { className: "f12-toolsel", title: "字体", onMouseDown: (e) => e.preventDefault(), onChange: (ev) => { if (ev.target.value) applySelectionStyle('fontName', ev.target.value); } },
                    react.createElement("option", { value: "" }, "字体"),
                    react.createElement("option", { value: "sans-serif" }, "无衬线"),
                    react.createElement("option", { value: "serif" }, "衬线"),
                    react.createElement("option", { value: "monospace" }, "等宽"),
                    react.createElement("option", { value: "'Microsoft YaHei', sans-serif" }, "微软雅黑"),
                    react.createElement("option", { value: "'SimSun', serif" }, "宋体"),
                  ),
                  react.createElement("span", { style: { width: 1, background: "#e1e4e8", margin: "0 2px", alignSelf: "stretch" } }),
                  // 字号 - / 数字 / +
                  react.createElement("button", { className: "f12-toolbtn", title: "减小字号", onMouseDown: (e) => e.preventDefault(), onClick: () => adjustSelectionFontSize(-2) }, "−"),
                  react.createElement("span", { style: { fontSize: 13, color: "#24292f", padding: "0 3px", minWidth: 20, textAlign: "center" } }, getSelectionFontSize() + ""),
                  react.createElement("button", { className: "f12-toolbtn", title: "增大字号", onMouseDown: (e) => e.preventDefault(), onClick: () => adjustSelectionFontSize(2) }, "+"),
                  react.createElement("span", { style: { width: 1, background: "#e1e4e8", margin: "0 2px", alignSelf: "stretch" } }),
                  // 加粗
                  react.createElement("button", { className: "f12-toolbtn", style: { fontWeight: 700 }, title: "加粗", onMouseDown: (e) => e.preventDefault(), onClick: () => applySelectionStyle('bold') }, "B"),
                  // 对齐下拉
                  react.createElement("select", { className: "f12-toolsel", title: "对齐", onMouseDown: (e) => e.preventDefault(), onChange: (ev) => { if (ev.target.value) alignSelection(ev.target.value); } },
                    react.createElement("option", { value: "" }, "≡"),
                    react.createElement("option", { value: "left" }, "左对齐"),
                    react.createElement("option", { value: "center" }, "居中对齐"),
                    react.createElement("option", { value: "right" }, "右对齐"),
                  ),
                  react.createElement("span", { style: { width: 1, background: "#e1e4e8", margin: "0 2px", alignSelf: "stretch" } }),
                  // 删除选中文字
                  react.createElement("button", { className: "f12-toolbtn", title: "删除选中文字", onMouseDown: (e) => e.preventDefault(), onClick: () => deleteSelectionText() }, "🗑"),
                  // AI 编辑
                  react.createElement("button", { className: "f12-toolbtn-ai", title: "把选中文字发给 AI 修改", onMouseDown: (e) => e.preventDefault(), onClick: () => aiEditSelection() }, "✦ AI 编辑"),
                )
              : null,
          ),

      // selection action bar (always visible when an element is selected)
      sel && !editing ? react.createElement("div", { className: "f12-selbar" },
        react.createElement("span", { className: "f12-selbar-tag" }, "选中: " + (sel.tagName || "?") + " " + (sel.selector || "")),
        react.createElement("button", { className: "f12-btn f12-btn-primary", onClick: () => { setAiText(""); setAiOpen(true); } }, "🤖 AI 修改"),
        react.createElement("button", { className: "f12-btn", onClick: copySelector }, "📋 复制选择器"),
        react.createElement("button", { className: "f12-btn", onClick: addToChat }, "＋ 加入对话"),
        aiBusy ? react.createElement("span", { className: "f12-ai-hint", style: { marginLeft: "auto", color: "#d29922" } }, "🤖 DSH 修改中… 改完自动刷新预览") : null,
      ) : null,

      // AI component-modify dialog: ask DSH to change ONLY this element
      aiOpen && sel ? react.createElement("div", { className: "f12-ai" },
        react.createElement("div", { className: "f12-ai-hd" },
          react.createElement("span", null, "🤖 AI 修改组件"),
          react.createElement("button", { className: "f12-btn", style: { marginLeft: "auto", padding: "1px 8px" }, onClick: () => setAiOpen(false) }, "✕")),
        react.createElement("div", { className: "f12-ai-target" },
          react.createElement("div", null, react.createElement("span", { className: "f12-kvk" }, "元素"), "  ", sel.tagName + " " + (sel.selector || "")),
          react.createElement("div", null, react.createElement("span", { className: "f12-kvk" }, "XPath"), "  ", sel.xpath || ""),
          react.createElement("div", { className: "f12-ai-outer" }, (sel.outerHtml || "").substring(0, 400))),
        react.createElement("textarea", { className: "f12-ai-ta", placeholder: "告诉 DSH 你想怎么改这个组件（只改它，页面其他地方不动），例如：\n· 按钮颜色太暗，改成蓝色圆角\n· 卡片间距太挤，标题再大一点\n· 这个区块整体左移、背景改浅灰", value: aiText, onChange: (e) => setAiText(e.target.value) }),
        react.createElement("div", { className: "f12-ai-actions" },
          react.createElement("span", { className: "f12-ai-hint" }, "发送给 DSH：只改这一个组件 · 改完自动刷新预览"),
          react.createElement("button", { className: "f12-btn f12-btn-primary", onClick: sendAiModify }, "发送给 DSH →")),
      ) : null,

      // element info (dev-only, hidden by default; toggle via ℹ️ 信息)
      sel && showInfo && !editing ? react.createElement("div", { className: "f12-info" },
        react.createElement("div", { className: "f12-info-label" }, "定位信息（inspect payload）"),
        react.createElement("div", { className: "f12-kv" },
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "tagName"), "  ", sel.tagName),
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "domId"), "  ", sel.domId || "null"),
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "selector"), "  ", sel.selector),
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "xpath"), "  ", sel.xpath),
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "text"), "  ", (sel.textContent || "(空)").substring(0, 60)),
          react.createElement("div", {}, react.createElement("span", { className: "f12-kvk" }, "rect"), "  ", sel.rect.width + "×" + sel.rect.height + " @ (" + sel.rect.left + "," + sel.rect.top + ")"),
        ),
        react.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" } },
          react.createElement("button", { className: "f12-btn f12-btn-primary", onClick: addToChatWithScreenshot }, "🖼 截图+代码 → 对话"),
          react.createElement("button", { className: "f12-btn", onClick: copyFullInfo }, "📋 复制完整信息"),
          react.createElement("button", { className: "f12-btn", onClick: copySelector }, "📋 复制选择器"),
          react.createElement("button", { className: "f12-btn", onClick: addToChat }, "＋ 加入对话"),
        ),
        // 选中即浮现：文字编辑（直接显示，无需按钮）
        react.createElement("div", { style: { marginTop: 8 } },
          react.createElement("div", { className: "f12-info-label" }, "✏️ 改文字（回车确认，Esc 取消）"),
          react.createElement("div", { style: { display: "flex", gap: 6 } },
            react.createElement("input", { id: "f12-text-input", style: { flex: 1, padding: "5px 9px", fontSize: 12, color: "#e6edf3", background: "#21262d", border: "1px solid #3d444d", borderRadius: 6, outline: "none" }, defaultValue: (sel.textContent || "").substring(0, 80), onKeyDown: (ev) => { if (ev.key === 'Enter') commitTextEdit(); if (ev.key === 'Escape') setTextEditing(false); }, placeholder: "输入新文字…" }),
            react.createElement("button", { className: "f12-btn", onClick: commitTextEdit }, "✓ 确认"),
          ),
        ),
      ) : null,

      // protocol log (dev-only, hidden by default; toggle via 🕮 协议)
      showLog ? react.createElement("div", { className: "f12-log" },
        react.createElement("div", { style: { color: "#8b949e", marginBottom: 4, fontSize: 10 } }, "协议日志（inspect）"),
        logs.length === 0
          ? react.createElement("div", {}, "等待操作…")
          : logs.map((l, i) => react.createElement("div", { key: i, className: "f12-log-line" },
              react.createElement("span", { style: { color: "#d29922" } }, l.dir + " "),
              react.createElement("span", { style: { color: "#58a6ff" } }, l.type + " "),
              react.createElement("span", {}, l.brief || ""),
            )),
      ) : null,

      // status
      react.createElement("div", { className: "f12-status" },
        react.createElement("span", { className: "f12-dot", style: { background: mode === 'edit' ? "#3fb950" : "#8b949e" } }),
        react.createElement("span", {}, mode === 'edit' ? "编辑模式已开启 · 悬停圈选组件" : (sel ? "已选中 1 个元素" : "未选中元素")),
        aiBusy ? react.createElement("span", { style: { color: "#d29922" } }, "· 🤖 等待 DSH 修改") : null,
        react.createElement("span", { style: { marginLeft: "auto" } }, "dsh-f12-inspector"),
      ),
    );
  }

  /* ================================================================
     Sidebar footer action: open the details (third) column
     ================================================================ */
  function F12FooterAction(props) {
    const openDetails = props.openDetails;
    return react.createElement("button", {
      type: "button",
      title: "打开 F12 元素检查器（第三栏）",
      style: {
        width: "100%", padding: "6px 10px", fontSize: 12, textAlign: "left",
        color: "#e6edf3", background: "transparent", border: "none", cursor: "pointer",
        borderRadius: 6, display: "flex", alignItems: "center", gap: 8,
      },
      onClick: () => { try { openDetails(); } catch (e) { /* column may be unavailable */ } },
    },
      react.createElement("span", { style: { fontSize: 13 } }, "🔍"),
      react.createElement("span", {}, "F12 检查器"),
    );
  }

  /* ================================================================
     Chat turn-tail: produced files + "🔍 F12 预览" buttons
     ================================================================ */
  function producedForClosingLocal(data, seq) {
    if (!data || !Array.isArray(data.produced)) return [];
    const seen = new Set(); const out = [];
    for (const p of data.produced) {
      if (!p || typeof p.path !== "string") continue;
      if (typeof seq === "number" && p.seq > seq) continue;
      if (seen.has(p.path)) continue;
      seen.add(p.path); out.push(p.path);
    }
    return out;
  }
  function basenameLocal(p) {
    const at = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return at === -1 ? p : p.slice(at + 1);
  }
  function ProducedFilesWithF12(props) {
    const matched = props.matched || [];
    const openFile = props.openFile;
    const htmlPaths = matched.filter((p) => HTML_EXT.test(p));
    return react.createElement("div", { className: "f12-prod" },
      react.createElement("span", { className: "f12-prod-label" }, "📦 产物"),
      matched.map((p) => react.createElement("button", {
        key: p, type: "button", className: "f12-prod-chip", title: "打开 " + p,
        onClick: () => { if (openFile) { try { openFile(p); } catch (e) { /* ignore */ } } },
      }, basenameLocal(p))),
      htmlPaths.length ? react.createElement(react.Fragment, null,
        react.createElement("span", { className: "f12-prod-div" }, "·"),
        htmlPaths.map((p) => react.createElement("button", {
          key: "f12:" + p, type: "button", className: "f12-prod-chip f12-prod-preview",
          title: "在 F12 插件中预览 " + p,
          onClick: () => requestF12Load(p),
        }, "🔍 F12 " + basenameLocal(p))),
      ) : null,
    );
  }

  /* ================================================================
     apply
     ================================================================ */
  function apply(ctx) {
    const layout = ctx.layout;
    openDetailsImpl = () => { try { layout.openDetails(); } catch (e) { /* panel may be unavailable */ } };

    // 1) Sidebar footer action to open the third column.
    ctx.slots.inject("sidebar.footer.action", () =>
      ctx.slots.register({
        name: "sidebar.footer.action",
        id: "f12-open",
        order: 90,
        locale: NS,
        inject: () => ({ openDetails: () => { try { layout.openDetails(); } catch (e) { /* panel may be unavailable */ } } }),
      }, F12FooterAction));

    // 2) The inspector itself: details slot at a lower priority than
    //    ui-conversation's DetailsPanel (default 0), so it wins the shadow.
    //    conversation: createDraftImages(files) lets "截图+代码一起发对话"
    //    attach the element screenshot as an image in the composer.
    let conversation = null;
    try { conversation = ctx.get('conversation'); } catch (e) { /* not ready yet */ }
    ctx.slots.inject("details", () =>
      ctx.slots.register({
        name: "details",
        id: "f12-inspector",
        priority: -1,
        locale: NS,
        inject: () => ({ closeDetails: () => { try { layout.closeDetails(); } catch (e) { /* panel may be unavailable */ } } }),
      }, (props) => react.createElement(F12InspectorPanel, Object.assign({}, props, { conversation }))),
    );

    // 3) Chat turn-tail: when the agent produced files, show them as chips
    //    (same as ui-deliverables) PLUS "🔍 F12" preview buttons for HTML.
    //    priority -1 wins the chain election ahead of ui-deliverables (0).
    ctx.slots.inject("conversation.chat.turnTail", () =>
      ctx.slots.register({
        name: "conversation.chat.turnTail",
        priority: -1,
        locale: NS,
        select: (owner) => {
          const data = owner && owner.turn && owner.turn.data ? owner.turn.data.get("deliverables") : undefined;
          const paths = producedForClosingLocal(data, owner && owner.seq);
          return paths.length ? paths : null;
        },
      }, ProducedFilesWithF12));
  }

  Object.defineProperty(exports, "name", { value: name });
  Object.defineProperty(exports, "inject", { value: inject });
  Object.defineProperty(exports, "apply", { value: apply });
  module.exports = exports;
  return module.exports;
}});
