(() => {
  "use strict";

  const VERSION = "1.0.0";
  const DEBOUNCE_MS = 600;
  const MAX_SUGGESTIONS = 5;

  let timer = null;
  let reqId = 0;
  let host = null;
  const els = {};

  function ensurePanel() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block;";
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
    shadow.querySelector(".close").addEventListener("click", hidePanel);
    document.documentElement.appendChild(host);
  }

  function hidePanel() {
    if (host) host.style.display = "none";
  }

  function showPanel() {
    ensurePanel();
    host.style.display = "block";
  }

  function showMessage(text, cls) {
    showPanel();
    els.body.textContent = "";
    const p = document.createElement("div");
    p.textContent = text;
    if (cls) p.className = cls;
    els.body.appendChild(p);
  }

  function isTextField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      return ["text", "search"].includes((el.type || "").toLowerCase());
    }
    return false;
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
    // Si el texto cambió desde que se revisó, se vuelve a revisar y no se toca nada.
    if (el.value.substr(offset, length) !== word) {
      check(el);
      return;
    }
    const nuevo =
      el.value.slice(0, offset) + replacement + el.value.slice(offset + length);
    setValue(el, nuevo);
    el.focus();
    try {
      const pos = offset + replacement.length;
      el.setSelectionRange(pos, pos);
    } catch (e) {}
  }

  function render(el, text, matches) {
    if (!matches.length) {
      showMessage("✔ Sin errores", "ok");
      return;
    }
    showPanel();
    els.body.textContent = "";
    for (const m of matches) {
      const word = text.substr(m.offset, m.length);
      const item = document.createElement("div");
      item.className = "item";

      const w = document.createElement("span");
      w.className = "word";
      w.textContent = word;

      const msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = m.message;

      item.append(w, msg);

      for (const r of m.replacements.slice(0, MAX_SUGGESTIONS)) {
        const b = document.createElement("button");
        b.className = "sug";
        b.textContent = r.value;
        b.addEventListener("click", () =>
          applyFix(el, m.offset, m.length, word, r.value)
        );
        item.appendChild(b);
      }
      els.body.appendChild(item);
    }
  }

  function check(el) {
    const text = el.value;
    if (!text.trim()) {
      hidePanel();
      return;
    }
    const id = ++reqId;
    chrome.runtime.sendMessage({ type: "check", text }, (resp) => {
      if (chrome.runtime.lastError) {
        showMessage("Error: " + chrome.runtime.lastError.message);
        return;
      }
      if (id !== reqId) return; // llegó una respuesta vieja, se ignora
      if (!resp || !resp.ok) {
        showMessage(
          "No pude hablar con LanguageTool. ¿Está encendido el contenedor?"
        );
        return;
      }
      render(el, text, resp.matches);
    });
  }

  document.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!isTextField(el)) return;
      clearTimeout(timer);
      timer = setTimeout(() => check(el), DEBOUNCE_MS);
    },
    true
  );
})();
