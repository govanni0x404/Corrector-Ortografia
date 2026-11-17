// Reglas propias de puntuación (versión 1.2.0).
// Devuelven coincidencias con el mismo formato que LanguageTool.
var CorrectorRules = (() => {
  "use strict";

  const PARES = [
    { abre: "¿", cierra: "?" },
    { abre: "¡", cierra: "!" }
  ];
  const INICIOS_IGNORABLES = "(\"«“'—-*_[";

  function esFinDeOracion(text, i) {
    const c = text[i];
    if (c === "\n") return true;
    if (c === "." || c === "!" || c === "?") {
      const n = text[i + 1];
      return n === undefined || /[\s¿¡]/.test(n);
    }
    return false;
  }

  function esPuntuacionLT(m) {
    const cat = m.rule && m.rule.category ? m.rule.category : {};
    return /PUNCT|TYPOGRAPH|Puntuaci|Tipograf/i.test(
      (cat.id || "") + " " + (cat.name || "")
    );
  }

  function chocaConLT(propia, lt) {
    return lt.some(
      (m) =>
        esPuntuacionLT(m) &&
        propia.offset < m.offset + m.length &&
        m.offset < propia.offset + propia.length
    );
  }

  // Falta el signo de apertura (¿ o ¡) cuando la frase termina en ? o !
  function reglaSignosApertura(text, lt) {
    const out = [];
    for (const par of PARES) {
      for (let q = 0; q < text.length; q++) {
        if (text[q] !== par.cierra) continue;
        if (q > 0 && (text[q - 1] === "?" || text[q - 1] === "!")) continue;
        const next = text[q + 1];
        if (next && /[\p{L}\p{N}=\/&]/u.test(next)) continue; // parece una dirección web

        let i = q - 1;
        let encontrado = false;
        while (i >= 0 && !esFinDeOracion(text, i)) {
          if (text[i] === par.abre) {
            encontrado = true;
            break;
          }
          i--;
        }
        if (encontrado) continue;

        let s = i + 1;
        while (
          s < q &&
          (/\s/.test(text[s]) || INICIOS_IGNORABLES.includes(text[s]))
        ) {
          s++;
        }
        if (s >= q) continue;
        if (text[s] === "¿" || text[s] === "¡") continue;

        const pal = /^[\p{L}\p{N}]+/u.exec(text.slice(s, q));
        const len = pal ? pal[0].length : 1;
        const palabra = text.substr(s, len);

        const yaLoDijoLT = lt.some(
          (m) =>
            m.message &&
            m.message.includes(par.abre) &&
            m.offset >= s - 1 &&
            m.offset <= q
        );
        if (yaLoDijoLT) continue;

        out.push({
          offset: s,
          length: len,
          message: "Falta el signo de apertura ‘" + par.abre + "’.",
          replacements: [{ value: par.abre + palabra }]
        });
      }
    }
    return out;
  }

  // Conectores que, al inicio de una oración, suelen llevar coma después.
  const CONECTORES = [
    "sin embargo", "no obstante", "por lo tanto", "por tanto",
    "por consiguiente", "es decir", "o sea", "por ejemplo",
    "por otro lado", "por otra parte", "en cambio",
    "en primer lugar", "en segundo lugar", "en tercer lugar",
    "en resumen", "en conclusión", "en definitiva", "en efecto",
    "en realidad", "de hecho", "ahora bien", "además", "asimismo",
    "por cierto", "por último", "finalmente", "mientras tanto",
    "dicho esto", "aun así", "de todas formas", "de todos modos",
    "por lo visto"
  ];

  const PATRONES = [
    {
      re: /(?<=\S) +([,;])/g,
      hacer: (m) => ({
        offset: m.index,
        length: m[0].length,
        message: "Sobra un espacio antes de ‘" + m[1] + "’.",
        replacements: [{ value: m[1] }]
      })
    },
    {
      re: /(?<=\p{L})([,;])(?=\p{L})/gu,
      hacer: (m) => ({
        offset: m.index,
        length: 1,
        message: "Falta un espacio después de ‘" + m[1] + "’.",
        replacements: [{ value: m[1] + " " }]
      })
    },
    {
      re: /(?<=\p{Ll})\.(?=\p{Lu})/gu,
      hacer: (m) => ({
        offset: m.index,
        length: 1,
        message: "Falta un espacio después del punto.",
        replacements: [{ value: ". " }]
      })
    },
    {
      re: /,{2,}|;{2,}/g,
      hacer: (m) => ({
        offset: m.index,
        length: m[0].length,
        message: "Signo de puntuación repetido.",
        replacements: [{ value: m[0][0] }]
      })
    },
    {
      re: /(?<!\.)\.\.(?!\.)/g,
      hacer: (m) => ({
        offset: m.index,
        length: 2,
        message: "Dos puntos seguidos: ¿quisiste escribir puntos suspensivos?",
        replacements: [{ value: "..." }, { value: "." }]
      })
    },
    {
      re: /(?<=\p{L}) pero(?=\s)/gu,
      hacer: (m) => ({
        offset: m.index,
        length: m[0].length,
        message: "Antes de ‘pero’ suele ir una coma.",
        replacements: [{ value: ", pero" }]
      })
    },
    {
      re: new RegExp(
        "(?<=(?:^|[.!?\\n])\\s*)(" + CONECTORES.join("|") + ")(?=\\s+\\p{L})",
        "giu"
      ),
      hacer: (m) => ({
        offset: m.index,
        length: m[0].length,
        message: "Después de ‘" + m[0] + "’ suele ir una coma.",
        replacements: [{ value: m[0] + "," }]
      })
    }
  ];

  // Junta lo que dijo LanguageTool con las reglas propias.
  function merge(text, lt) {
    const lista = Array.isArray(lt) ? lt : [];
    const propias = [];
    propias.push(...reglaSignosApertura(text, lista));
    for (const p of PATRONES) {
      for (const m of text.matchAll(p.re)) {
        propias.push(p.hacer(m));
      }
    }
    const nuevas = propias.filter((o) => !chocaConLT(o, lista));
    return lista
      .concat(nuevas)
      .sort((a, b) => a.offset - b.offset || a.length - b.length);
  }

  return { merge };
})();
