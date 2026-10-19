/** Shared vertical demo engine — closed-corpus chat + local upload (browser-only). */
(async function () {
  const cfg = window.NYYO_VERTICAL || {};
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("q");
  const sendBtn = document.getElementById("send");
  const chipsEl = document.getElementById("chips");
  const uploadInput = document.getElementById("local-upload");
  const uploadStatus = document.getElementById("upload-status");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.scrollTo(0, 0);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  if (cfg.synonyms && window.NyyoBM25) NyyoBM25.setSynonyms(cfg.synonyms);

  const examples = cfg.questions || [];
  examples.forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = q;
    b.addEventListener("click", () => ask(q));
    chipsEl.appendChild(b);
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightHtml(snippet, query) {
    const toks = (NyyoBM25.contentTokens(query) || []).filter((t) => t.length > 2);
    let html = escapeHtml(snippet);
    const uniq = Array.from(new Set(toks)).sort((a, b) => b.length - a.length);
    for (const t of uniq.slice(0, 8)) {
      const re = new RegExp("\\b(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[a-z]*)\\b", "gi");
      html = html.replace(re, "<mark>$1</mark>");
    }
    return html;
  }

  function addMsg(role, html) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML =
      '<div class="who">' + (role === "user" ? "You" : "Nyyo industry demo") + "</div>" + html;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addTyping() {
    const div = document.createElement("div");
    div.className = "msg bot";
    div.id = "typing-indicator";
    div.innerHTML =
      '<div class="who">Nyyo industry demo</div><div class="typing-row" aria-label="Thinking"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  let baseDocs = [];
  let userDocs = [];
  let index = null;

  function rebuild() {
    const all = baseDocs.concat(userDocs);
    index = NyyoBM25.buildIndex(all);
  }

  try {
    const docs = window.NYYO_DOCS || (await (await fetch("./data/docs.json")).json());
    baseDocs = docs;
    rebuild();
    addMsg(
      "bot",
      "Hi — I answer only from this <strong>" +
        escapeHtml(cfg.name || "industry") +
        "</strong> synthetic sample corpus. Closed corpus · no open web. Click a suggestion or type a question. Citations show the exact passage."
    );
  } catch (e) {
    addMsg("bot", "Could not load sample docs. Open this page via GitHub Pages.");
    return;
  }

  let busy = false;

  function ask(query) {
    query = (query || "").trim();
    if (!query || !index || busy) return;
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    addMsg("user", escapeHtml(query));

    const ans = NyyoBM25.answer(index, query, 3);
    let html = "<p>" + escapeHtml(ans.text) + "</p>";
    if (ans.citations.length) {
      html += '<div class="citations"><div class="cite-label">Sources (closed corpus)</div>';
      ans.citations.forEach((c) => {
        html +=
          '<div class="cite"><strong>' +
          escapeHtml(c.title) +
          "</strong> · " +
          escapeHtml(c.source) +
          "<br><span class=\"passage\">" +
          highlightHtml(c.snippet || c.full || "", query) +
          "</span></div>";
      });
      html += "</div>";
    }
    html +=
      '<p class="disclaimer-inline">Demo only — human review required before any professional use.</p>';

    const delay = reduceMotion ? 0 : 420 + Math.min(550, query.length * 10);
    const typing = reduceMotion ? null : addTyping();

    setTimeout(() => {
      if (typing) typing.remove();
      addMsg("bot", html);
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }, delay);
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      ask(inputEl.value);
      inputEl.value = "";
    });
  }
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        ask(inputEl.value);
        inputEl.value = "";
      }
    });
  }

  if (uploadInput) {
    uploadInput.addEventListener("change", async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      let added = 0;
      for (const f of files) {
        if (f.size > 400000) {
          if (uploadStatus) uploadStatus.textContent = f.name + " skipped (too large for browser demo).";
          continue;
        }
        const text = await f.text();
        const id = "local-" + Date.now() + "-" + added;
        userDocs.push({
          id: id,
          title: f.name,
          source: "local-upload (browser only · not sent anywhere)",
          text: text.slice(0, 50000),
        });
        added++;
      }
      rebuild();
      if (uploadStatus) {
        uploadStatus.textContent =
          added +
          " local file(s) indexed in this browser tab only. Nothing uploaded to Nyyo servers. Refresh to clear.";
      }
      addMsg(
        "bot",
        "Indexed <strong>" +
          added +
          "</strong> local file(s) in-browser. Ask a question — answers can now cite your upload plus the sample corpus."
      );
      uploadInput.value = "";
    });
  }

  // Expose for automated QA
  window.__nyyoAsk = ask;
  window.__nyyoGetIndex = () => index;
})();
