const KEY_PALABRAS = "ignoradas";
const KEY_SITIOS = "sitiosApagados";

document.getElementById("version").textContent =
  "v" + chrome.runtime.getManifest().version;

function leer(clave, cb) {
  chrome.storage.local.get([clave], (r) =>
    cb(Array.isArray(r[clave]) ? r[clave] : [])
  );
}

function guardar(clave, arr, cb) {
  chrome.storage.local.set({ [clave]: arr }, cb);
}

function mensajeVacio(contenedor, texto) {
  const v = document.createElement("div");
  v.className = "vacio";
  v.textContent = texto;
  contenedor.appendChild(v);
}

function crearFila(texto, claseBoton, textoBoton, alClic) {
  const fila = document.createElement("div");
  fila.className = "fila";
  const t = document.createElement("span");
  t.textContent = texto;
  const b = document.createElement("button");
  b.className = claseBoton;
  b.textContent = textoBoton;
  b.addEventListener("click", alClic);
  fila.append(t, b);
  return fila;
}

/* ---------- Sitio actual ---------- */

let sitioActual = null;

function claveDeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "") || null;
  } catch (e) {
    return null;
  }
}

function pintarSitioActual() {
  const cont = document.getElementById("sitioActual");
  cont.textContent = "";
  if (!sitioActual) {
    mensajeVacio(cont, "Esta página no admite el corrector.");
    return;
  }
  leer(KEY_SITIOS, (apagados) => {
    const label = document.createElement("label");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !apagados.includes(sitioActual);
    const txt = document.createElement("span");
    const poner = () => {
      txt.textContent =
        (chk.checked ? "Activado en " : "Desactivado en ") + sitioActual;
    };
    poner();
    chk.addEventListener("change", () => {
      leer(KEY_SITIOS, (actual) => {
        const nuevo = actual.filter((x) => x !== sitioActual);
        if (!chk.checked) nuevo.push(sitioActual);
        guardar(KEY_SITIOS, nuevo, () => {
          poner();
          pintarSitios();
        });
      });
    });
    label.append(chk, txt);
    cont.appendChild(label);
  });
}

/* ---------- Sitios desactivados ---------- */

function pintarSitios() {
  const cont = document.getElementById("listaSitios");
  leer(KEY_SITIOS, (arr) => {
    cont.textContent = "";
    if (!arr.length) {
      mensajeVacio(cont, "Ningún sitio desactivado.");
      return;
    }
    for (const h of arr.slice().sort()) {
      cont.appendChild(
        crearFila(h, "activar", "Activar", () => {
          leer(KEY_SITIOS, (actual) =>
            guardar(
              KEY_SITIOS,
              actual.filter((x) => x !== h),
              () => {
                pintarSitios();
                pintarSitioActual();
              }
            )
          );
        })
      );
    }
  });
}

/* ---------- Palabras ignoradas ---------- */

function pintarPalabras() {
  const cont = document.getElementById("lista");
  leer(KEY_PALABRAS, (arr) => {
    cont.textContent = "";
    if (!arr.length) {
      mensajeVacio(cont, "Aún no hay palabras ignoradas.");
      return;
    }
    for (const w of arr.slice().sort()) {
      cont.appendChild(
        crearFila(w, "quitar", "Quitar", () => {
          leer(KEY_PALABRAS, (actual) =>
            guardar(
              KEY_PALABRAS,
              actual.filter((x) => x !== w),
              pintarPalabras
            )
          );
        })
      );
    }
  });
}

document.getElementById("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nueva = document.getElementById("nueva");
  const w = nueva.value.trim().toLowerCase();
  if (!w) return;
  leer(KEY_PALABRAS, (arr) => {
    if (!arr.includes(w)) arr.push(w);
    guardar(KEY_PALABRAS, arr, () => {
      nueva.value = "";
      pintarPalabras();
    });
  });
});

/* ---------- Inicio ---------- */

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  sitioActual = tabs && tabs[0] ? claveDeUrl(tabs[0].url) : null;
  pintarSitioActual();
});
pintarSitios();
pintarPalabras();
