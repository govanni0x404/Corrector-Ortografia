// Subrayado ondulado (versión 1.6.0).
// - textarea / input: capa transparente encima de la caja.
// - contenteditable (WhatsApp, Gmail, Claude): resaltados de CSS, sin tocar el HTML.
var CorrectorSubrayado = (() => {
  "use strict";

  const entradas = new Map(); // textarea/input -> su capa
  const editables = new Map(); // contenteditable -> { items }
  let pendiente = false;
  let estiloEditableListo = false;

  const ESTILO = `
    .caja{box-sizing:border-box;overflow:hidden;border-style:solid;border-color:transparent;pointer-events:none;}
    .scroller{box-sizing:border-box;pointer-events:none;}
    .contenido{color:transparent;margin:0;pointer-events:none;}
    .e{text-decoration-line:underline;text-decoration-style:wavy;text-decoration-thickness:1.5px;text-decoration-skip-ink:none;}
    .orto{text-decoration-color:#dc2626;}
    .otro{text-decoration-color:#2563eb;}
  `;

  const FUENTE = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
    "fontStretch", "fontKerning", "fontFeatureSettings", "letterSpacing",
    "wordSpacing", "textTransform", "textIndent", "textAlign", "direction",
    "lineHeight", "tabSize", "textRendering"
  ];

  // Errores muy cortos (una coma, un punto): se amplía un carácter a cada lado.
  function ampliar(text, m, pos) {
    let ini = m.offset;
    let fin = m.offset + m.length;
    if (m.length < 3 && !/\p{L}/u.test(text.substr(m.offset, m.length))) {
      if (ini > pos && text[ini - 1] !== "\n") ini--;
      if (fin < text.length && text[fin] !== "\n") fin++;
    }
    return { ini, fin };
  }

  /* ================= textarea / input ================= */

  function crearEntrada(el) {
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:absolute;pointer-events:none;z-index:2147483646;display:none;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" + ESTILO + "</style>" +
      '<div class="caja"><div class="scroller"><div class="contenido"></div></div></div>';

    const e = {
      el,
      host,
      caja: shadow.querySelector(".caja"),
      scroller: shadow.querySelector(".scroller"),
      contenido: shadow.querySelector(".contenido"),
      spans: [],
      visible: false
    };

    document.documentElement.appendChild(host);
    el.addEventListener("scroll", () => sincronizarScroll(e), { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (e.visible) {
          copiarEstilos(e);
          reposicionar(e);
        }
      }).observe(el);
    }
    entradas.set(el, e);
    return e;
  }

  function copiarEstilos(e) {
    const el = e.el;
    const cs = getComputedStyle(el);
    const esInput = el.tagName === "INPUT";

    for (const p of FUENTE) e.contenido.style[p] = cs[p];
    e.contenido.style.whiteSpace = esInput ? "pre" : "pre-wrap";
    e.contenido.style.overflowWrap = esInput ? "normal" : "break-word";
    e.contenido.style.wordBreak = cs.wordBreak;

    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    e.caja.style.borderWidth = bt + "px " + br + "px " + bb + "px " + bl + "px";
    e.caja.style.display = esInput ? "flex" : "block";
    e.caja.style.alignItems = esInput ? "center" : "";

    e.scroller.style.paddingTop = cs.paddingTop;
    e.scroller.style.paddingLeft = cs.paddingLeft;
    e.scroller.style.paddingBottom = cs.paddingBottom;
    const barra = Math.max(0, el.offsetWidth - el.clientWidth - bl - br);
    e.scroller.style.paddingRight = (parseFloat(cs.paddingRight) || 0) + barra + "px";
    e.scroller.style.width = esInput ? "auto" : "100%";
    e.scroller.style.flex = esInput ? "0 0 auto" : "";
  }

  function sincronizarScroll(e) {
    e.scroller.style.transform =
      "translate(" + -e.el.scrollLeft + "px," + -e.el.scrollTop + "px)";
  }

  function quitar(e) {
    e.visible = false;
    e.host.remove();
    entradas.delete(e.el);
  }

  function reposicionar(e) {
    const el = e.el;
    if (!el.isConnected) {
      quitar(e);
      return;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) {
      e.host.style.display = "none";
      return;
    }
    if (!e.visible) return;
    e.host.style.display = "block";
    e.host.style.left = r.left + window.scrollX + "px";
    e.host.style.top = r.top + window.scrollY + "px";
    e.caja.style.width = el.offsetWidth + "px";
    e.caja.style.height = el.offsetHeight + "px";
    sincronizarScroll(e);
  }

  function programarReposicion() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      for (const e of Array.from(entradas.values())) {
        if (e.visible) reposicionar(e);
      }
    });
  }

  window.addEventListener("scroll", programarReposicion, true);
  window.addEventListener("resize", programarReposicion);

  // Devuelve true si se dibujó algo.
  function pintar(el, text, matches, tipoDe) {
    if (!matches.length) {
      ocultar(el);
      return false;
    }
    const e = entradas.get(el) || crearEntrada(el);
    e.spans = [];
    e.contenido.textContent = "";

    let pos = 0;
    for (const m of matches) {
      if (m.length < 1 || m.offset < pos) continue;
      const { ini, fin } = ampliar(text, m, pos);
      if (ini > pos) {
        e.contenido.appendChild(document.createTextNode(text.slice(pos, ini)));
      }
      const span = document.createElement("span");
      span.className = "e " + (tipoDe(m) === "orto" ? "orto" : "otro");
      span.textContent = text.slice(ini, fin);
      e.contenido.appendChild(span);
      e.spans.push({ m, span, ini, fin });
      pos = fin;
    }
    if (pos < text.length) {
      e.contenido.appendChild(document.createTextNode(text.slice(pos)));
    }

    e.visible = true;
    copiarEstilos(e);
    reposicionar(e);
    return true;
  }

  /* ================= contenteditable ================= */

  function soportaResaltado() {
    return (
      typeof Highlight !== "undefined" &&
      typeof CSS !== "undefined" &&
      !!CSS.highlights
    );
  }

  function prepararEstiloEditable() {
    if (estiloEditableListo) return;
    const st = document.createElement("style");
    st.textContent =
      "::highlight(corrector-orto){text-decoration:underline wavy #dc2626;}" +
      "::highlight(corrector-otro){text-decoration:underline wavy #2563eb;}";
    (document.head || document.documentElement).appendChild(st);
    estiloEditableListo = true;
  }

  function puntoEn(segs, pos, esFin) {
    for (const s of segs) {
      const dentro = esFin
        ? pos > s.start && pos <= s.start + s.len
        : pos >= s.start && pos < s.start + s.len;
      if (dentro) return { node: s.node, offset: pos - s.start };
    }
    return null;
  }

  function reconstruirResaltados() {
    if (!soportaResaltado()) return;
    const orto = new Highlight();
    const otro = new Highlight();
    for (const ent of editables.values()) {
      for (const it of ent.items) {
        (it.tipo === "orto" ? orto : otro).add(it.range);
      }
    }
    CSS.highlights.set("corrector-orto", orto);
    CSS.highlights.set("corrector-otro", otro);
  }

  // Devuelve true si se dibujó algo.
  function pintarEditable(el, segs, text, matches, tipoDe) {
    if (!soportaResaltado() || !segs) return false;
    prepararEstiloEditable();

    const items = [];
    let pos = 0;
    for (const m of matches) {
      if (m.length < 1 || m.offset < pos) continue;
      const { ini, fin } = ampliar(text, m, pos);
      const a = puntoEn(segs, ini, false);
      const b = puntoEn(segs, fin, true);
      if (!a || !b) continue;
      const range = document.createRange();
      try {
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
      } catch (e) {
        continue;
      }
      items.push({
        m,
        range,
        ini,
        fin,
        tipo: tipoDe(m) === "orto" ? "orto" : "otro"
      });
      pos = fin;
    }

    if (!items.length) {
      ocultar(el);
      return false;
    }
    editables.set(el, { items });
    reconstruirResaltados();
    return true;
  }

  /* ================= común ================= */

  function ocultar(el) {
    const e = entradas.get(el);
    if (e) {
      e.visible = false;
      e.spans = [];
      e.host.style.display = "none";
    }
    if (editables.has(el)) {
      editables.delete(el);
      reconstruirResaltados();
    }
  }

  // ¿Hay un error subrayado en la posición idx del texto?
  function buscarEn(el, idx) {
    const e = entradas.get(el);
    if (e && e.visible) {
      for (const s of e.spans) {
        if (idx >= s.ini && idx <= s.fin) {
          const rects = s.span.getClientRects();
          return {
            m: s.m,
            rect: rects.length ? rects[0] : s.span.getBoundingClientRect()
          };
        }
      }
    }
    const ed = editables.get(el);
    if (ed) {
      for (const it of ed.items) {
        if (idx >= it.ini && idx <= it.fin) {
          const rects = it.range.getClientRects();
          if (!rects.length) continue;
          return { m: it.m, rect: rects[0] };
        }
      }
    }
    return null;
  }

  return { pintar, pintarEditable, ocultar, buscarEn };
})();
