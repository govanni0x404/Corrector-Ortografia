// Subrayado ondulado sobre textarea e input (versión 1.5.0).
// Pone una capa transparente encima de la caja, con el mismo texto,
// y subraya solo las palabras con error. La capa no recibe clics.
var CorrectorSubrayado = (() => {
  "use strict";

  const entradas = new Map(); // caja de texto -> su capa
  let pendiente = false;

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
    // si la caja tiene barra de desplazamiento, el texto tiene menos ancho
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

  function ocultar(el) {
    const e = entradas.get(el);
    if (!e) return;
    e.visible = false;
    e.spans = [];
    e.host.style.display = "none";
  }

  // tipoDe(m) debe devolver "orto" (rojo) u otro valor (azul)
  function pintar(el, text, matches, tipoDe) {
    if (!matches.length) {
      ocultar(el);
      return;
    }
    const e = entradas.get(el) || crearEntrada(el);
    e.spans = [];
    e.contenido.textContent = "";

    let pos = 0;
    for (const m of matches) {
      if (m.length < 1 || m.offset < pos) continue; // se salta lo que se traslapa
      if (m.offset > pos) {
        e.contenido.appendChild(document.createTextNode(text.slice(pos, m.offset)));
      }
      const span = document.createElement("span");
      span.className = "e " + (tipoDe(m) === "orto" ? "orto" : "otro");
      span.textContent = text.substr(m.offset, m.length);
      e.contenido.appendChild(span);
      e.spans.push({ m, span });
      pos = m.offset + m.length;
    }
    if (pos < text.length) {
      e.contenido.appendChild(document.createTextNode(text.slice(pos)));
    }

    e.visible = true;
    copiarEstilos(e);
    reposicionar(e);
  }

  // ¿Hay un error subrayado en la posición idx del texto?
  function buscarEn(el, idx) {
    const e = entradas.get(el);
    if (!e || !e.visible) return null;
    for (const s of e.spans) {
      if (idx >= s.m.offset && idx <= s.m.offset + s.m.length) {
        const rects = s.span.getClientRects();
        const rect = rects.length ? rects[0] : s.span.getBoundingClientRect();
        return { m: s.m, rect };
      }
    }
    return null;
  }

  return { pintar, ocultar, buscarEn };
})();
