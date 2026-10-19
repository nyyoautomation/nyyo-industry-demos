/** Minimal BM25 for in-browser RAG over JSON chunks. No API keys. Vertical-aware via NyyoBM25.setSynonyms(). */
(function (global) {
  const STOP = new Set([
    "a","an","the","is","are","was","were","be","been","being","do","does","did",
    "how","what","when","where","why","which","who","whom","your","you","my","our",
    "i","me","we","they","them","it","its","of","in","on","at","to","for","from",
    "with","by","about","into","over","after","before","and","or","but","if","than",
    "then","so","as","this","that","these","those","can","could","would","should",
    "will","just","only","also","very","more","most","any","all","each","every",
  ]);

  let EXTRA_SYNONYMS = []; // [{re: RegExp, words: string[]}, ...]

  function setSynonyms(list) {
    EXTRA_SYNONYMS = Array.isArray(list) ? list : [];
  }

  function stem(tok) {
    if (tok.length <= 3) return tok;
    if (tok.endsWith("ies") && tok.length > 4) return tok.slice(0, -3) + "y";
    if (tok.endsWith("ing") && tok.length > 5) return tok.slice(0, -3);
    if (tok.endsWith("ers") && tok.length > 5) return tok.slice(0, -1);
    if (tok.endsWith("ies")) return tok.slice(0, -3) + "y";
    if (tok.endsWith("es") && tok.length > 4) {
      const base = tok.slice(0, -2);
      if (base.endsWith("s") || base.endsWith("sh") || base.endsWith("ch") || base.endsWith("x")) return base;
      if (tok.endsWith("ses") || tok.endsWith("zes")) return tok.slice(0, -2);
      return base;
    }
    if (tok.endsWith("s") && !tok.endsWith("ss") && tok.length > 3) return tok.slice(0, -1);
    return tok;
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/gi, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(stem);
  }

  function contentTokens(text) {
    return tokenize(text).filter((t) => !STOP.has(t) && t.length > 1);
  }

  function expandQuery(query) {
    const q = String(query || "").toLowerCase();
    const extra = [];
    for (const syn of EXTRA_SYNONYMS) {
      try {
        const re = syn.re instanceof RegExp ? syn.re : new RegExp(syn.pattern, syn.flags || "i");
        if (re.test(q)) extra.push.apply(extra, syn.words || []);
      } catch (e) { /* ignore bad synonym */ }
    }
    return query + " " + extra.join(" ");
  }

  function buildIndex(docs) {
    const N = docs.length;
    const df = Object.create(null);
    const docsTokens = docs.map((d) => {
      const titleToks = contentTokens(d.title);
      const bodyToks = contentTokens(d.text);
      const tokens = titleToks.concat(titleToks).concat(titleToks).concat(bodyToks);
      const tf = Object.create(null);
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
      return {
        id: d.id,
        title: d.title,
        source: d.source,
        text: d.text,
        tf,
        len: Math.max(bodyToks.length, 1),
        titleSet: new Set(titleToks),
      };
    });
    const avgdl = docsTokens.reduce((s, d) => s + d.len, 0) / Math.max(N, 1);
    return { docs: docsTokens, df, N, avgdl, k1: 1.5, b: 0.75 };
  }

  function score(index, query) {
    const qTokens = contentTokens(expandQuery(query));
    if (!qTokens.length) return [];
    const { docs, df, N, avgdl, k1, b } = index;
    const results = [];
    for (const doc of docs) {
      let s = 0;
      for (const t of qTokens) {
        const f = doc.tf[t] || 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5));
        const denom = f + k1 * (1 - b + b * (doc.len / avgdl));
        s += idf * ((f * (k1 + 1)) / denom);
        if (doc.titleSet.has(t)) s += idf * 0.85;
      }
      if (s > 0) results.push({ ...doc, score: s });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  function splitSentences(text) {
    const parts = String(text || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    return parts.map((s) => s.trim()).filter(Boolean);
  }

  function isQuestionSentence(sent) {
    const t = sent.trim();
    if (/\?\s*$/.test(t)) return true;
    return /^(how|what|when|where|why|which|who|can|do|does|is|are|will)\b/i.test(t);
  }

  function sentenceScore(sent, qSet) {
    const toks = contentTokens(sent);
    let overlap = 0;
    for (const t of toks) if (qSet.has(t)) overlap++;
    let bonus = 0;
    if (/\b(takes?|is|are|include|accept|available|within|eur|percent|hours?|days?|must|required|deadline)\b/i.test(sent)) bonus += 0.5;
    if (isQuestionSentence(sent)) bonus -= 3;
    const dens = toks.length ? overlap / toks.length : 0;
    return overlap + bonus + dens;
  }

  function highlightPassage(text, query) {
    const qSet = new Set(contentTokens(expandQuery(query)));
    const sentences = splitSentences(text);
    let best = sentences[0] || text;
    let bestScore = -1;
    for (const s of sentences) {
      const sc = sentenceScore(s, qSet);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    // Wrap matching tokens in <mark> for UI (caller escapes then rewrites)
    return best;
  }

  function answer(index, query, topK) {
    topK = topK || 3;
    const hits = score(index, query).slice(0, topK);
    if (!hits.length) {
      return {
        text: "I couldn't find that in this industry sample corpus. Try one of the suggested questions, or upload a local .txt/.md file (stays in your browser).",
        citations: [],
      };
    }
    const best = hits[0];
    const qSet = new Set(contentTokens(expandQuery(query)));
    const sentences = splitSentences(best.text);
    const ranked = sentences
      .map((sent) => ({ sent, score: sentenceScore(sent, qSet) }))
      .sort((a, b) => b.score - a.score);

    let candidates = ranked.filter((r) => r.score > 0 && !isQuestionSentence(r.sent));
    if (!candidates.length) candidates = ranked.filter((r) => !isQuestionSentence(r.sent));
    if (!candidates.length) candidates = ranked.slice(0, 1);
    let picked = candidates.slice(0, 1);
    if (picked[0] && picked[0].score < 0.5) {
      const firstDecl = sentences.find((s) => !isQuestionSentence(s));
      if (firstDecl) picked = [{ sent: firstDecl, score: 1 }];
    }
    // Prefer 1–2 high-scoring sentences for richer answers
    if (candidates.length > 1 && candidates[1].score >= Math.max(1, candidates[0].score * 0.55)) {
      picked = candidates.slice(0, 2);
    }
    const body = picked.map((r) => r.sent.trim()).join(" ");
    return {
      text: body,
      citations: hits.map((h) => ({
        id: h.id,
        title: h.title,
        source: h.source,
        score: Math.round(h.score * 100) / 100,
        snippet: highlightPassage(h.text, query),
        full: h.text,
      })),
    };
  }

  global.NyyoBM25 = { buildIndex, score, answer, tokenize, contentTokens, setSynonyms, expandQuery };
})(typeof window !== "undefined" ? window : globalThis);
