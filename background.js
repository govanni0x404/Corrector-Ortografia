const LT_URL = "http://localhost:8010/v2/check";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "check") {
    const body = new URLSearchParams({ language: "es", level: "picky", text: msg.text });
    fetch(LT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => sendResponse({ ok: true, matches: data.matches }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // mantiene abierto el canal para responder después
  }
});
