import { useCallback, useState } from 'react';

function load() {
  try { return JSON.parse(localStorage.getItem('phon-progress') || '{}'); }
  catch { return {}; }
}

function save(p) {
  try { localStorage.setItem('phon-progress', JSON.stringify(p)); } catch {}
}

export function useProgress() {
  const [progress, setProgress] = useState(load);

  const markWordDone = useCallback((phonemeId, wordIdx) => {
    setProgress((prev) => {
      const next = { ...prev, [phonemeId]: { ...(prev[phonemeId] || {}), [wordIdx]: true } };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try { localStorage.removeItem('phon-progress'); } catch {}
    setProgress({});
  }, []);

  const phonemeProgress = useCallback((id) => progress[id] || {}, [progress]);

  return { progress, markWordDone, reset, phonemeProgress };
}
