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
  const [cardState, setCardState] = useState(''); // '', 'success', 'error', 'listening'
  const [direction, setDirection] = useState('forward');

  const recognitionRef = useRef(null);
  const cardRef = useRef(null);
  const swipedRef = useRef(false);
  const prevIdxRef = useRef(initialIdx);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const lastRecordingURLRef = useRef(null);
  const mediaStartTimeoutRef = useRef(null);

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

  // Cleanup on unmount
  useEffect(() => () => {
    if (mediaStartTimeoutRef.current) {
      clearTimeout(mediaStartTimeoutRef.current);
      mediaStartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (lastRecordingURLRef.current) {
      URL.revokeObjectURL(lastRecordingURLRef.current);
      lastRecordingURLRef.current = null;
    }
  }, []);

  async function ensureMediaStream() {
    if (mediaStreamRef.current) return mediaStreamRef.current;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof window.MediaRecorder === 'undefined') return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      return stream;
    } catch {
      return null;
    }
  }

  async function startMediaRecording() {
    const stream = await ensureMediaStream();
    if (!stream) return;
    try {
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        if (recordedChunksRef.current.length === 0) return;
        if (lastRecordingURLRef.current) URL.revokeObjectURL(lastRecordingURLRef.current);
        const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        lastRecordingURLRef.current = URL.createObjectURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
    } catch {
      mediaRecorderRef.current = null;
    }
  }

  function stopMediaRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') {
      try { mr.stop(); } catch {}
    }
    if (mediaStartTimeoutRef.current) {
      clearTimeout(mediaStartTimeoutRef.current);
      mediaStartTimeoutRef.current = null;
    }
  }

  function playRecording(onDone) {
    const url = lastRecordingURLRef.current;
    if (!url) { onDone(); return; }
    const audio = new Audio(url);
    let called = false;
    const fire = () => { if (!called) { called = true; onDone(); } };
    audio.onended = fire;
    audio.onerror = fire;
    audio.play().catch(fire);
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
    let matched = false;
    for (const alt of alternatives) {
      if (isMatch(target, alt)) { matched = true; break; }
    }
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    if (matched) {
      setFeedback({
        html: `Has dicho <span class="heard-text">${escapeHTML(alternatives[0])}</span>`,
        type: 'info',
      });
    } else {
      setCardState('error');
      setTimeout(() => setCardState((s) => (s === 'error' ? '' : s)), 1500);
      let html = `He oído <span class="heard-text">${escapeHTML(alternatives[0])}</span> en lugar de <span class="heard-text">${escapeHTML(target)}</span>. Inténtalo otra vez.`;
      if (newAttempts >= 3) {
        html += '<br><small style="opacity:0.8">Pulsa "Despacio" para oírla de nuevo y fíjate en la posición de la boca.</small>';
      }
      setFeedback({ html, type: 'error' });
    }

    setTimeout(() => {
      playRecording(() => {
        setTimeout(() => {
          if (matched) {
            speak(target, false, voiceLang, () => {
              setCardState('success');
              setFeedback({
                html: `¡Correcto! Has dicho <span class="heard-text">${escapeHTML(alternatives[0])}</span>`,
                type: 'success',
              });
              onMarkWordDone(phoneme.id, wordIdx);
              setTimeout(() => setWordIdx((i) => i + 1), 1000);
            });
          } else {
            speak(target, newAttempts >= 3, voiceLang);
          }
        }, 250);
      });
    }, 700);
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
    setCardState('listening');
    setFeedback(null);

    rec.onspeechend = () => { stopMediaRecording(); };
    rec.onaudioend = () => { stopMediaRecording(); };

    rec.onresult = (event) => {
      stopMediaRecording();
      const results = event.results[0];
      const alts = [];
      for (let i = 0; i < results.length; i++) alts.push(results[i].transcript);
      evaluatePronunciation(alts);
    };

    rec.onerror = (event) => {
      stopMediaRecording();
      if (event.error === 'no-speech') {
        setFeedback({ html: 'No te he oído. Inténtalo otra vez.', type: 'info' });
        setTimeout(() => speak(word.word, false, voiceLang), 700);
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setFeedback({ html: 'Necesito permiso para usar el micrófono.', type: 'error' });
      } else if (event.error !== 'aborted') {
        setFeedback({ html: 'Error de reconocimiento: ' + event.error, type: 'error' });
      }
    };

    rec.onend = () => {
      setIsRecording(false);
      setCardState((s) => (s === 'listening' ? '' : s));
      recognitionRef.current = null;
      stopMediaRecording();
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      mediaStartTimeoutRef.current = setTimeout(() => {
        mediaStartTimeoutRef.current = null;
        if (recognitionRef.current) startMediaRecording();
      }, 250);
    } catch {
      setIsRecording(false);
      setCardState('');
      setFeedback({ html: 'No se pudo iniciar la grabación.', type: 'error' });
    }
  }

  function toggleRecord() {
    if (isRecording) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    } else {
      startRecording();
    }
  }

  function handleCardClick() {
    if (swipedRef.current) { swipedRef.current = false; return; }
    if (!word) return;
    speak(word.word, false, voiceLang);
  }

  function skip() {
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.abort(); } catch {}
    }
    setWordIdx((i) => i + 1);
  }

  function back() {
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.abort(); } catch {}
    }
    onBack();
  }

  if (!word) return null;

  const cardClass = ['word-card', cardState].filter(Boolean).join(' ');
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

      <div
        ref={cardRef}
        className={cardClass}
        title="Pulsa para oír · desliza para cambiar"
        onClick={handleCardClick}
      >
        <div key={wordIdx} className={slideClass}>
          <div className="word-ipa">{word.ipa}</div>
          <div className="word-text">{word.word}</div>
          <div className="word-meaning">{word.meaning}</div>
        </div>
      </div>

      <div className="controls">
        <button className="btn" onClick={() => speak(word.word, false, voiceLang)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.04v7.92A4.5 4.5 0 0016.5 12z" />
          </svg>
          Escuchar
        </button>
        <button className="btn" onClick={() => speak(word.word, true, voiceLang)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3z" />
          </svg>
          Despacio
        </button>
        <button className={`btn primary${isRecording ? ' recording' : ''}`} onClick={toggleRecord}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
          <span>{isRecording ? 'Escuchando…' : 'Grabar'}</span>
        </button>
      </div>

      <div className={fbClass} dangerouslySetInnerHTML={feedback ? { __html: feedback.html } : undefined} />

      <div className="skip-row">
        <button onClick={skip}>Saltar palabra</button>
      </div>
    </div>
  );
}
