const KEY = "ignoradas";
const lista = document.getElementById("lista");
const form = document.getElementById("form");
const nueva = document.getElementById("nueva");

document.getElementById("version").textContent =
  "v" + chrome.runtime.getManifest().version;

function leer(cb) {
  chrome.storage.local.get([KEY], (r) =>
    cb(Array.isArray(r[KEY]) ? r[KEY] : [])
  );
}

function guardar(arr, cb) {
  chrome.storage.local.set({ [KEY]: arr }, cb);
}

function pintar() {
  leer((arr) => {
    lista.textContent = "";
    if (!arr.length) {
      const v = document.createElement("div");
      v.className = "vacio";
      v.textContent = "Aún no hay palabras ignoradas.";
      lista.appendChild(v);
      return;
    }
    for (const w of arr.slice().sort()) {
      const fila = document.createElement("div");
      fila.className = "fila";
      const t = document.createElement("span");
      t.textContent = w;
      const b = document.createElement("button");
      b.className = "quitar";
      b.textContent = "Quitar";
      b.addEventListener("click", () => {
        leer((actual) => guardar(actual.filter((x) => x !== w), pintar));
      });
      fila.append(t, b);
      lista.appendChild(fila);
    }
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const w = nueva.value.trim().toLowerCase();
  if (!w) return;
  leer((arr) => {
    if (!arr.includes(w)) arr.push(w);
    guardar(arr, () => {
      nueva.value = "";
      pintar();
    });
  });
});

pintar();
