(() => {
  "use strict";

  const VERSION = "1.5.0";
  const DEBOUNCE_MS = 600;
  const MAX_SUGGESTIONS = 5;
  const MAX_CHARS = 20000;
  const PANEL_W = 320;

  let timer = null;
  let reqId = 0;
  let host = null;
  let burbuja = null;
  let lastEl = null;
  let lastText = "";
  let lastMatches = [];
  const els = {};

  /* ---------- Estilo compartido (panel y burbuja) ---------- */

  const ESTILO = `
    .panel{width:320px;max-height:340px;display:flex;flex-direction:column;background:#fff;color:#1f2937;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.4 system-ui,sans-serif;}
    .head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;}
    .close{border:0;background:none;font-size:18px;cursor:pointer;color:#6b7280;}
    .body{overflow:auto;padding:8px 10px;}
    .item{padding:6px 0;border-bottom:1px solid #f3f4f6;}
    .word{font-weight:600;color:#b91c1c;}
    .msg{color:#4b5563;margin:2px 0 4px;}
    .sug{margin:2px 4px 2px 0;padding:2px 8px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:12px;cursor:pointer;font-size:12px;}
    .sug:hover{background:#dbeafe;}
    .ign{margin:2px 4px 2px 0;padding:2px 8px;border:1px solid #6b7280;background:#f9fafb;color:#4b5563;border-radius:12px;cursor:pointer;font-size:12px;}
    .ign:hover{background:#f3f4f6;}
    .ok{color:#15803d;}
    .foot{text-align:center;font-size:11px;color:#9ca3af;padding:4px 0 6px;border-top:1px solid #e5e7eb;}
  `;

  /* ---------- Palabras ignoradas ---------- */

  const KEY_IGNORADAS = "ignoradas";
  let ignoradas = new Set();

  function cargarIgnoradas() {
    try {
      chrome.storage.local.get([KEY_IGNORADAS], (r) => {
        if (chrome.runtime.lastError) return;
        ignoradas = new Set(
          Array.isArray(r[KEY_IGNORADAS]) ? r[KEY_IGNORADAS] : []
        );
      });
    } catch (e) {}
  }
  cargarIgnoradas();

  try {
    chrome.storage.onChanged.addListener((cambios, area) => {
      if (area === "local" && cambios[KEY_IGNORADAS]) {
        ignoradas = new Set(cambios[KEY_IGNORADAS].newValue || []);
        lastText = ""; // fuerza una nueva revisión
      }
    });
  } catch (e) {}

  function esPalabraDesconocida(m) {
    return (
      (m.type && m.type.typeName === "UnknownWord") ||
      (m.rule &&
        typeof m.rule.id === "string" &&
        m.rule.id.startsWith("MORFOLOGIK"))
    );
  }

  function puedeIgnorarse(text, m) {
    return (
      esPalabraDesconocida(m) &&
      /^[\p{L}\p{N}'’-]+$/u.test(text.substr(m.offset, m.length))
    );
  }

  function filtrarIgnoradas(text, matches) {
    return matches.filter(
      (m) =>
        !(
          puedeIgnorarse(text, m) &&
          ignoradas.has(text.substr(m.offset, m.length).toLowerCase())
        )
    );
  }

  function ignorarPalabra(palabra) {
    ignoradas.add(palabra.toLowerCase());
    try {
      chrome.storage.local.set({ [KEY_IGNORADAS]: Array.from(ignoradas) });
    } catch (e) {}
  }

  /* ---------- Sitios desactivados ---------- */

  const KEY_SITIOS = "sitiosApagados";
  const SITIO = location.hostname.replace(/^www\./, "");
  let sitioApagado = false;

  try {
    chrome.storage.local.get([KEY_SITIOS], (r) => {
      if (chrome.runtime.lastError) return;
      const arr = Array.isArray(r[KEY_SITIOS]) ? r[KEY_SITIOS] : [];
      sitioApagado = arr.includes(SITIO);
    });
    chrome.storage.onChanged.addListener((cambios, area) => {
      if (area === "local" && cambios[KEY_SITIOS]) {
        sitioApagado = (cambios[KEY_SITIOS].newValue || []).includes(SITIO);
        if (sitioApagado) {
          hidePanel();
          ocultarBurbuja();
          if (lastEl) ocultarSubrayado(lastEl);
        } else {
          lastText = ""; // al reactivar, se revisa de nuevo
        }
      }
    });
  } catch (e) {}

  /* ---------- Panel ---------- */

  function ensurePanel() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;display:block;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${ESTILO}</style>
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
      host.style.top = "auto";
      host.style.bottom = window.innerHeight - r.top + margin + "px";
    } else {
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

  /* ---------- Burbuja junto a la palabra subrayada ---------- */

  function ensureBurbuja() {
    if (burbuja) return;
    const h = document.createElement("div");
    h.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;display:none;";
    const shadow = h.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${ESTILO}</style><div class="panel"><div class="body"></div></div>`;
    burbuja = { host: h, body: shadow.querySelector(".body") };
    document.documentElement.appendChild(h);
  }

  function ocultarBurbuja() {
    if (burbuja) burbuja.host.style.display = "none";
  }

  function mostrarBurbuja(el, text, m, rect) {
    ensureBurbuja();
    burbuja.body.textContent = "";
    burbuja.body.appendChild(crearTarjeta(el, text, m, ocultarBurbuja));
    const h = burbuja.host;
    h.style.display = "block";
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - PANEL_W - 8)
    );
    h.style.left = left + "px";
    h.style.right = "auto";
    if (rect.bottom + 180 > window.innerHeight && rect.top > 180) {
      h.style.top = "auto";
      h.style.bottom = window.innerHeight - rect.top + 4 + "px";
    } else {
      h.style.bottom = "auto";
      h.style.top = rect.bottom + 4 + "px";
    }
  }

  /* ---------- Subrayado (solo textarea e input) ---------- */

  function tipoDe(m) {
    return esPalabraDesconocida(m) ||
      (m.rule && m.rule.issueType === "misspelling")
      ? "orto"
      : "otro";
  }

  function ocultarSubrayado(el) {
    if (
      typeof CorrectorSubrayado !== "undefined" &&
      el &&
      !isEditableDiv(el)
    ) {
      CorrectorSubrayado.ocultar(el);
    }
  }

  function subrayar(el, text, matches) {
    if (typeof CorrectorSubrayado === "undefined" || isEditableDiv(el)) return;
    // si el texto cambió mientras se revisaba, no se dibuja nada
    if (readField(el).text !== text) return;
    CorrectorSubrayado.pintar(el, text, matches, tipoDe);
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
    if (now.text.substr(offset, length) !== word) {
      check(el);
      return;
    }

    if (now.segs) {
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

    const nuevo =
      el.value.slice(0, offset) + replacement + el.value.slice(offset + length);
    setValue(el, nuevo);
    el.focus();
    try {
      const pos = offset + replacement.length;
      el.setSelectionRange(pos, pos);
    } catch (e) {}
  }

  /* ---------- Tarjetas y panel ---------- */

  // Una tarjeta = un error con sus sugerencias. alUsar() se llama al usarla.
  function crearTarjeta(el, text, m, alUsar) {
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

    for (const r of (m.replacements || []).slice(0, MAX_SUGGESTIONS)) {
      const b = document.createElement("button");
      b.className = "sug";
      b.textContent = r.value;
      // evita que el clic le quite el foco a la caja de texto
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        applyFix(el, m.offset, m.length, word, r.value);
        alUsar();
      });
      item.appendChild(b);
    }

    if (puedeIgnorarse(text, m)) {
      const ig = document.createElement("button");
      ig.className = "ign";
      ig.textContent = "Ignorar";
      ig.title = "No volver a marcar esta palabra";
      ig.addEventListener("mousedown", (e) => e.preventDefault());
      ig.addEventListener("click", () => {
        ignorarPalabra(word);
        alUsar();
        lastText = "";
        schedule(el, 150);
      });
      item.appendChild(ig);
    }

    return item;
  }

  function render(el, text, matches) {
    if (!matches.length) {
      hidePanel();
      return;
    }
    showPanel(el);
    els.body.textContent = "";
    for (const m of matches) {
      const item = crearTarjeta(el, text, m, () => {
        item.remove();
        if (!els.body.querySelector(".item")) hidePanel();
      });
      els.body.appendChild(item);
    }
  }

  /* ---------- Revisar ---------- */

  function check(el) {
    if (sitioApagado) {
      hidePanel();
      ocultarSubrayado(el);
      return;
    }
    const { text } = readField(el);
    if (!text.trim()) {
      lastEl = el;
      lastText = "";
      lastMatches = [];
      hidePanel();
      ocultarSubrayado(el);
      return;
    }
    if (el === lastEl && text === lastText) {
      // nada nuevo que revisar; solo se vuelve a dibujar el subrayado
      subrayar(el, text, lastMatches);
      return;
    }

    const id = ++reqId;
    try {
      chrome.runtime.sendMessage({ type: "check", text }, (resp) => {
        if (chrome.runtime.lastError) {
          lastText = "";
          ocultarSubrayado(el);
          showMessage(el, "Error: " + chrome.runtime.lastError.message);
          return;
        }
        if (id !== reqId) return; // llegó una respuesta vieja, se ignora
        if (!resp || !resp.ok) {
          lastText = "";
          ocultarSubrayado(el);
          showMessage(
            el,
            "No pude hablar con LanguageTool. ¿Está encendido el contenedor?"
          );
          return;
        }
        const todas =
          typeof CorrectorRules !== "undefined"
            ? CorrectorRules.merge(text, resp.matches)
            : resp.matches;
        const lista = filtrarIgnoradas(text, todas);
        lastEl = el;
        lastText = text;
        lastMatches = lista;
        render(el, text, lista);
        subrayar(el, text, lista);
      });
    } catch (e) {
      showMessage(el, "La extensión se actualizó. Recarga esta página (F5).");
    }
  }

  function schedule(el, delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => check(el), delay);
  }

  /* ---------- Eventos ---------- */

  document.addEventListener(
    "input",
    (e) => {
      const el = getField(e.target);
      if (!el) return;
      ocultarBurbuja();
      ocultarSubrayado(el); // mientras escribes, el subrayado viejo ya no sirve
      schedule(el);
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

  // Clic dentro de una palabra subrayada: aparece la burbuja con sugerencias.
  document.addEventListener(
    "click",
    (e) => {
      if (e.target === (burbuja && burbuja.host) || e.target === host) return;
      const el = getField(e.target);
      if (!el || isEditableDiv(el)) {
        ocultarBurbuja();
        return;
      }
      const idx = el.selectionStart;
      if (idx == null || idx !== el.selectionEnd) {
        ocultarBurbuja();
        return;
      }
      const hit =
        typeof CorrectorSubrayado !== "undefined"
          ? CorrectorSubrayado.buscarEn(el, idx)
          : null;
      if (!hit) {
        ocultarBurbuja();
        return;
      }
      mostrarBurbuja(el, readField(el).text, hit.m, hit.rect);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") ocultarBurbuja();
    },
    true
  );

  window.addEventListener("scroll", ocultarBurbuja, true);
})();
