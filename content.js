(() => {
  "use strict";

  const VERSION = "1.2.2";
  const DEBOUNCE_MS = 600;
  const MAX_SUGGESTIONS = 5;
  const MAX_CHARS = 20000;
  const PANEL_W = 320;

  let timer = null;
  let reqId = 0;
  let host = null;
  let lastEl = null;
  let lastText = "";
  const els = {};

  /* ---------- Panel ---------- */

  function ensurePanel() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;display:block;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .panel{width:320px;max-height:340px;display:flex;flex-direction:column;background:#fff;color:#1f2937;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.4 system-ui,sans-serif;}
        .head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;}
        .close{border:0;background:none;font-size:18px;cursor:pointer;color:#6b7280;}
        .body{overflow:auto;padding:8px 10px;}
        .item{padding:6px 0;border-bottom:1px solid #f3f4f6;}
        .word{font-weight:600;color:#b91c1c;}
        .msg{color:#4b5563;margin:2px 0 4px;}
        .sug{margin:2px 4px 2px 0;padding:2px 8px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:12px;cursor:pointer;font-size:12px;}
        .sug:hover{background:#dbeafe;}
        .ok{color:#15803d;}
        .foot{text-align:center;font-size:11px;color:#9ca3af;padding:4px 0 6px;border-top:1px solid #e5e7eb;}
      </style>
      <div class="panel">
        <div class="head"><span>Corrector de ortografía</span><button class="close" title="Cerrar">×</button></div>
        <div class="body"></div>
        <div class="foot">v${VERSION}</div>
      </div>`;
    els.body = shadow.querySelector(".body");
    const closeBtn = shadow.querySelector(".close");
    closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    closeBtn.addEventListener("click", hidePanel);
    document.documentElement.appendChild(host);
  }

  function hidePanel() {
    if (host) host.style.display = "none";
  }

  function positionPanel(el) {
    const r = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(r.left, window.innerWidth - PANEL_W - margin)
    );
    host.style.left = left + "px";
    host.style.right = "auto";
    if (r.top > 360) {
      // hay espacio arriba de la caja: el panel va encima
      host.style.top = "auto";
      host.style.bottom = window.innerHeight - r.top + margin + "px";
    } else {
      // poco espacio arriba: el panel va debajo
      host.style.bottom = "auto";
      host.style.top =
        Math.min(r.bottom + margin, window.innerHeight - 120) + "px";
    }
  }

  function showPanel(el) {
    ensurePanel();
    host.style.display = "block";
    if (el) positionPanel(el);
  }

  function showMessage(el, text, cls) {
    showPanel(el);
    els.body.textContent = "";
    const p = document.createElement("div");
    p.textContent = text;
    if (cls) p.className = cls;
    els.body.appendChild(p);
  }

  /* ---------- Detectar y leer campos de texto ---------- */

  function getField(target) {
    let node = target;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === "TEXTAREA") return node;
    if (node.tagName === "INPUT") {
      return ["text", "search"].includes((node.type || "").toLowerCase())
        ? node
        : null;
    }
    if (node.isContentEditable) {
      // subir hasta la caja editable "madre"
      while (node.parentElement && node.parentElement.isContentEditable) {
        node = node.parentElement;
      }
      return node;
    }
    return null;
  }

  function isEditableDiv(el) {
    return el.tagName !== "TEXTAREA" && el.tagName !== "INPUT";
  }

  const BLOCK_TAGS = new Set([
    "DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
    "BLOCKQUOTE", "PRE", "TR"
  ]);

  // Recorre la caja y arma el texto, recordando en qué nodo vive cada pedazo.
  function extractContent(root) {
    const segs = [];
    let text = "";

    function addNewline() {
      if (text.length && !text.endsWith("\n")) text += "\n";
    }

    function walk(node) {
      if (node.nodeType === 3) {
        const t = node.nodeValue;
        if (t.length) {
          segs.push({ node, start: text.length, len: t.length });
          text += t;
        }
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === "BR") {
        text += "\n";
        return;
      }
      const block = BLOCK_TAGS.has(node.tagName);
      if (block) addNewline();
      for (const c of node.childNodes) walk(c);
      if (block) addNewline();
    }

    walk(root);
    return { text, segs };
  }

  function readField(el) {
    if (isEditableDiv(el)) {
      const { text, segs } = extractContent(el);
      return { text: text.slice(0, MAX_CHARS), segs };
    }
    return { text: el.value.slice(0, MAX_CHARS), segs: null };
  }

  /* ---------- Aplicar una corrección ---------- */

  function pointAt(segs, pos, isEnd) {
    for (const s of segs) {
      const dentro = isEnd
        ? pos > s.start && pos <= s.start + s.len
        : pos >= s.start && pos < s.start + s.len;
      if (dentro) return { node: s.node, offset: pos - s.start };
    }
    return null;
  }

  function setValue(el, value) {
    try {
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    } catch (e) {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyFix(el, offset, length, word, replacement) {
    const now = readField(el);
    // Si el texto cambió desde que se revisó, se vuelve a revisar y no se toca nada.
    if (now.text.substr(offset, length) !== word) {
      check(el);
      return;
    }

    if (now.segs) {
      // Caja contenteditable
      const a = pointAt(now.segs, offset, false);
      const b = pointAt(now.segs, offset + length, true);
      if (!a || !b) {
        check(el);
        return;
      }
      el.focus();
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand("insertText", false, replacement);
      } catch (e) {}
      if (!ok) {
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // Algunos editores (WhatsApp) no avisan con "input": se revisa de nuevo solo.
      schedule(el, 150);
      return;
    }

    // textarea / input
    const nuevo =
      el.value.slice(0, offset) + replacement + el.value.slice(offset + length);
    setValue(el, nuevo);
    el.focus();
    try {
      const pos = offset + replacement.length;
      el.setSelectionRange(pos, pos);
    } catch (e) {}
  }

  /* ---------- Mostrar resultados ---------- */

  function render(el, text, matches) {
    if (!matches.length) {
      hidePanel();
      return;
    }
    showPanel(el);
    els.body.textContent = "";
    for (const m of matches) {
      const word = text.substr(m.offset, m.length);
      const item = document.createElement("div");
      item.className = "item";

      const w = document.createElement("span");
      w.className = "word";
      w.textContent = word.trim() ? word : "(espacio)";

      const msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = m.message;

      item.append(w, msg);

      for (const r of m.replacements.slice(0, MAX_SUGGESTIONS)) {
        const b = document.createElement("button");
        b.className = "sug";
        b.textContent = r.value;
        // evita que el clic le quite el foco a la caja de texto
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          applyFix(el, m.offset, m.length, word, r.value);
          item.remove();
          if (!els.body.querySelector(".item")) hidePanel();
        });
        item.appendChild(b);
      }
      els.body.appendChild(item);
    }
  }

  /* ---------- Revisar ---------- */

  function check(el) {
    const { text } = readField(el);
    if (!text.trim()) {
      lastEl = el;
      lastText = "";
      hidePanel();
      return;
    }
    if (el === lastEl && text === lastText) return; // nada nuevo que revisar

    const id = ++reqId;
    try {
      chrome.runtime.sendMessage({ type: "check", text }, (resp) => {
        if (chrome.runtime.lastError) {
          lastText = "";
          showMessage(el, "Error: " + chrome.runtime.lastError.message);
          return;
        }
        if (id !== reqId) return; // llegó una respuesta vieja, se ignora
        if (!resp || !resp.ok) {
          lastText = "";
          showMessage(
            el,
            "No pude hablar con LanguageTool. ¿Está encendido el contenedor?"
          );
          return;
        }
        lastEl = el;
        lastText = text;
        render(el, text, typeof CorrectorRules !== "undefined" ? CorrectorRules.merge(text, resp.matches) : resp.matches);
      });
    } catch (e) {
      // pasa cuando se recarga la extensión y la página quedó con la versión vieja
      showMessage(el, "La extensión se actualizó. Recarga esta página (F5).");
    }
  }

  function schedule(el, delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => check(el), delay);
  }

  document.addEventListener(
    "input",
    (e) => {
      const el = getField(e.target);
      if (el) schedule(el);
    },
    true
  );

  // Algunos sitios (WhatsApp) vacían la caja al enviar sin avisar con "input".
  document.addEventListener(
    "keyup",
    (e) => {
      const el = getField(e.target);
      if (el && isEditableDiv(el)) schedule(el);
    },
    true
  );
})();
