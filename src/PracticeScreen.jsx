import { useEffect, useRef, useState } from 'react';
import { speak, SpeechRecognitionAPI } from './speech';
import { isMatch, escapeHTML } from './utils';

export default function PracticeScreen({
  phoneme,
  voiceLang,
  initialIdx,
  onMarkWordDone,
  onBack,
  onComplete,
}) {
  const [wordIdx, setWordIdx] = useState(initialIdx);
  const [attempts, setAttempts] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState(null); // { html, type }
  const [cardState, setCardState] = useState(''); // '' (blue), 'recording' (red), 'success' (green)
  const [direction, setDirection] = useState('forward');

  const recognitionRef = useRef(null);
  const cardRef = useRef(null);
  const swipedRef = useRef(false);
  const prevIdxRef = useRef(initialIdx);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const vadRafRef = useRef(null);

  // Reset on phoneme change
  useEffect(() => {
    setWordIdx(initialIdx);
  }, [phoneme.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset per-word state when wordIdx changes; track direction for animation
  useEffect(() => {
    if (wordIdx > prevIdxRef.current) setDirection('forward');
    else if (wordIdx < prevIdxRef.current) setDirection('backward');
    prevIdxRef.current = wordIdx;
    setAttempts(0);
    setFeedback(null);
    setCardState('');
  }, [wordIdx]);

  // Trigger completion when past the last word
  useEffect(() => {
    if (wordIdx >= phoneme.words.length) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIdx]);

  // Pre-acquire mic stream once when entering the practice screen so the
  // browser only renegotiates audio routing once instead of on every press.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices || typeof window.MediaRecorder === 'undefined') return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          try {
            const ctx = new Ctx();
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            an.fftSize = 1024;
            an.smoothingTimeConstant = 0.5;
            src.connect(an);
            audioContextRef.current = ctx;
            analyserNodeRef.current = an;
          } catch {}
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
        analyserNodeRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (vadRafRef.current) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
  }, []);

  function startVAD() {
    const analyser = analyserNodeRef.current;
    const ctx = audioContextRef.current;
    if (!analyser) return;
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch {}
    }
    const buf = new Uint8Array(analyser.fftSize);
    const SILENCE_RMS = 0.02;
    const SILENCE_HOLD_MS = 700;
    const MAX_SESSION_MS = 6000;
    const sessionStart = performance.now();
    let speechStarted = false;
    let silenceStart = null;
    const tick = () => {
      vadRafRef.current = null;
      if (!analyserNodeRef.current) return;
      const rec = recognitionRef.current;
      if (!rec) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > SILENCE_RMS) {
        speechStarted = true;
        silenceStart = null;
      } else if (speechStarted) {
        if (silenceStart === null) silenceStart = now;
        if (now - silenceStart > SILENCE_HOLD_MS) {
          try { rec.stop(); } catch {}
          return;
        }
      }
      if (now - sessionStart > MAX_SESSION_MS) {
        try { rec.stop(); } catch {}
        return;
      }
      vadRafRef.current = requestAnimationFrame(tick);
    };
    vadRafRef.current = requestAnimationFrame(tick);
  }

  function stopVAD() {
    if (vadRafRef.current) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
  }

  // Swipe handling
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let startX = null, startY = null;

    const onDown = (e) => {
      startX = e.clientX;
      startY = e.clientY;
      swipedRef.current = false;
      try { card.setPointerCapture(e.pointerId); } catch {}
    };
    const onUp = (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        swipedRef.current = true;
        navigateWord(dx < 0 ? 1 : -1);
      }
    };
    const onCancel = () => { startX = null; };

    card.addEventListener('pointerdown', onDown);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onCancel);
    return () => {
      card.removeEventListener('pointerdown', onDown);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIdx, isRecording, phoneme.id]);

  function navigateWord(delta) {
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.abort(); } catch {}
    }
    setWordIdx((idx) => {
      const next = idx + delta;
      if (next < 0 || next >= phoneme.words.length) return idx;
      return next;
    });
  }

  const word = phoneme.words[wordIdx];

  function evaluatePronunciation(alternatives) {
    if (!word) return;
    const target = word.word;
    console.log('[Ship o Sheep] reconocido:', alternatives, '· objetivo:', target);
    const matched = alternatives.length > 0 && isMatch(target, alternatives[0]);
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    if (matched) {
      setCardState('success');
      setFeedback({
        html: `¡Correcto! Has dicho <span class="heard-text">${escapeHTML(alternatives[0])}</span>`,
        type: 'success',
      });
      onMarkWordDone(phoneme.id, wordIdx);
      setTimeout(() => setWordIdx((i) => i + 1), 1000);
    } else {
      setCardState('');
      const uniqueAlts = Array.from(new Set(alternatives.map((a) => a.trim()).filter(Boolean)));
      let html = `He oído <span class="heard-text">${escapeHTML(alternatives[0])}</span> en lugar de <span class="heard-text">${escapeHTML(target)}</span>. Inténtalo otra vez.`;
      if (uniqueAlts.length > 1) {
        html += `<br><small style="opacity:0.7">otras: ${escapeHTML(uniqueAlts.slice(1).join(', '))}</small>`;
      }
      setFeedback({ html, type: 'error' });
    }
  }

  function startRecording() {
    if (!SpeechRecognitionAPI) {
      setFeedback({ html: 'Tu navegador no soporta reconocimiento de voz.', type: 'error' });
      return;
    }
    if (isRecording) return;

    const rec = new SpeechRecognitionAPI();
    rec.lang = voiceLang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;

    setIsRecording(true);
    setCardState('recording');
    setFeedback(null);

    rec.onresult = (event) => {
      const results = event.results[0];
      const alts = [];
      for (let i = 0; i < results.length; i++) alts.push(results[i].transcript);
      evaluatePronunciation(alts);
    };

    rec.onnomatch = () => {
      setFeedback({ html: 'No he reconocido nada. Inténtalo otra vez.', type: 'info' });
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech') {
        setFeedback({ html: 'No te he oído. Inténtalo otra vez.', type: 'info' });
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setFeedback({ html: 'Necesito permiso para usar el micrófono.', type: 'error' });
      } else if (event.error !== 'aborted') {
        setFeedback({ html: 'Error de reconocimiento: ' + event.error, type: 'error' });
      }
    };

    rec.onend = () => {
      setIsRecording(false);
      setCardState((s) => (s === 'recording' ? '' : s));
      recognitionRef.current = null;
      stopVAD();
    };

    stopVAD();

    recognitionRef.current = rec;
    try {
      rec.start();
      startVAD();
    } catch {
      setIsRecording(false);
      setCardState('');
      setFeedback({ html: 'No se pudo iniciar la grabación.', type: 'error' });
    }
  }

  function handleCardClick() {
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (!word || isRecording) return;
    speak(word.word, false, voiceLang, () => {
      setTimeout(() => startRecording(), 200);
    });
  }

  function back() {
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.abort(); } catch {}
    }
    onBack();
  }

  if (!word) return null;

  const buttonClass = ['record-button', cardState].filter(Boolean).join(' ');
  const fbClass = feedback ? `feedback show ${feedback.type}` : 'feedback';
  const slideClass = direction === 'backward' ? 'animate-slide-in-left' : 'animate-slide-in-right';

  return (
    <div>
      <button className="back-btn" onClick={back}>← Volver al menú</button>
      <div className="practice-header">
        <div>
          <h2>{phoneme.symbol} {phoneme.name}</h2>
          <p>{phoneme.description}</p>
        </div>
        <div className="practice-progress">{wordIdx + 1} / {phoneme.words.length}</div>
      </div>

      <button
        ref={cardRef}
        type="button"
        className={buttonClass}
        title="Pulsa para oír y luego grabarte · desliza para cambiar"
        onClick={handleCardClick}
      >
        <span key={wordIdx} className={`record-button-label ${slideClass}`}>{word.word}</span>
      </button>

      <div className="word-meta" key={`meta-${wordIdx}`}>
        <div className="word-ipa">{word.ipa}</div>
        <div className="word-meaning">{word.meaning}</div>
      </div>

      <div className={fbClass} dangerouslySetInnerHTML={feedback ? { __html: feedback.html } : undefined} />
    </div>
  );
}
