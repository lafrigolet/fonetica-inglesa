export function normalize(s) {
  return s.toLowerCase().trim().replace(/[^a-z']/g, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) m[i][j] = m[i - 1][j - 1];
      else m[i][j] = 1 + Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]);
    }
  }
  return m[b.length][a.length];
}

export function isMatch(target, heard) {
  const t = normalize(target);
  const h = normalize(heard);
  if (!h) return false;
  if (t === h) return true;
  const heardWords = h.split(/\s+/).filter(Boolean);
  if (heardWords.includes(t)) return true;
  if (t.length >= 6 && levenshtein(t, h) <= 1) return true;
  for (const w of heardWords) {
    if (w === t) return true;
    if (t.length >= 6 && levenshtein(t, w) <= 1) return true;
  }
  return false;
}

export function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
