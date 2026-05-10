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
  const TARGET_REPETITIONS = 10;
  const SLOT_HEIGHT = 240;
  const SLOT_HEIGHT_MOBILE = 200;

  const [wordIdx, setWordIdx] = useState(initialIdx);
  const [attempts, setAttempts] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState(null); // { html, type }
  const [cardState, setCardState] = useState(''); // '' (blue), 'recording' (red), 'success' (green)
  const [direction, setDirection] = useState('forward');
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const recognitionRef = useRef(null);
  const cardRef = useRef(null);
  const carouselRef = useRef(null);
  const swipedRef = useRef(false);
  const prevIdxRef = useRef(initialIdx);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const vadRafRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const lastRecordingURLRef = useRef(null);
  const activeAudioRef = useRef(null);
  const pendingPlaybackRef = useRef(false);
  const handledRef = useRef(false);

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
    setSuccessCount(0);
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
  // On mobile (coarse pointer + no hover) we skip this entirely: the engine's
  // own audio pipeline can't share the mic with our getUserMedia stream and
  // ends up receiving silence (visible as audiostart→audioend with no
  // soundstart/speechstart). VAD and recording playback are unavailable
  // there as a result, but the recognizer itself works.
  useEffect(() => {
    const isMobileLike = typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    if (isMobileLike) return;

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
    if (activeAudioRef.current) {
      try { activeAudioRef.current.pause(); activeAudioRef.current.src = ''; } catch {}
      activeAudioRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (lastRecordingURLRef.current) {
      URL.revokeObjectURL(lastRecordingURLRef.current);
      lastRecordingURLRef.current = null;
    }
  }, []);

  function startMediaRecording() {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    try {
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        if (recordedChunksRef.current.length > 0) {
          if (lastRecordingURLRef.current) URL.revokeObjectURL(lastRecordingURLRef.current);
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          lastRecordingURLRef.current = URL.createObjectURL(blob);
        }
        if (pendingPlaybackRef.current) {
          pendingPlaybackRef.current = false;
          playRecording();
        }
      };
      mr.start(100);
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
  }

  function stopPlayback() {
    const a = activeAudioRef.current;
    if (a) {
      try { a.pause(); a.src = ''; } catch {}
      activeAudioRef.current = null;
    }
  }

  function playRecording() {
    const url = lastRecordingURLRef.current;
    if (!url) return;
    stopPlayback();
    const audio = new Audio(url);
    activeAudioRef.current = audio;
    const clear = () => {
      if (activeAudioRef.current === audio) activeAudioRef.current = null;
    };
    audio.onended = clear;
    audio.onerror = clear;
    audio.play().catch(clear);
  }

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

  // Carousel drag handling — finger follows the track, snaps on release
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    let startX = null, startY = null;
    let dragging = false;

    const slotHeight = window.matchMedia('(max-width: 480px)').matches
      ? SLOT_HEIGHT_MOBILE
      : SLOT_HEIGHT;

    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      swipedRef.current = false;
      dragging = false;
      try { carousel.setPointerCapture(e.pointerId); } catch {}
    };
    const onMove = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) {
        dragging = true;
        setIsDragging(true);
      }
      if (dragging) {
        let limited = dy;
        if (wordIdx === 0 && dy > 0) limited = dy * 0.35;
        if (wordIdx === phoneme.words.length - 1 && dy < 0) limited = dy * 0.35;
        setDragOffset(limited);
      }
    };
    const onUp = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      startX = null;
      startY = null;
      if (dragging) {
        dragging = false;
        setIsDragging(false);
        setDragOffset(0);
        if (Math.abs(dy) > slotHeight / 4 && Math.abs(dy) > Math.abs(dx)) {
          swipedRef.current = true;
          navigateWord(dy < 0 ? 1 : -1);
        }
      }
    };
    const onCancel = () => {
      startX = null; startY = null;
      if (dragging) {
        dragging = false;
        setIsDragging(false);
        setDragOffset(0);
      }
    };

    carousel.addEventListener('pointerdown', onDown);
    carousel.addEventListener('pointermove', onMove);
    carousel.addEventListener('pointerup', onUp);
    carousel.addEventListener('pointercancel', onCancel);
    return () => {
      carousel.removeEventListener('pointerdown', onDown);
      carousel.removeEventListener('pointermove', onMove);
      carousel.removeEventListener('pointerup', onUp);
      carousel.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIdx, isRecording, phoneme.id, phoneme.words.length]);

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

  function goToWord(target) {
    if (target === wordIdx || target < 0 || target >= phoneme.words.length) return;
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.abort(); } catch {}
    }
    setWordIdx(target);
  }

  const word = phoneme.words[wordIdx];

  function evaluatePronunciation(alternatives) {
    if (!word) return;
    const target = word.word;
    console.log('[Ship o Sheep] reconocido:', alternatives, '· objetivo:', target);
    const matched = alternatives.some((alt) => isMatch(target, alt));
    setAttempts((a) => a + 1);

    if (matched) {
      handledRef.current = true;
      const newCount = successCount + 1;
      setSuccessCount(newCount);
      setCardState('success');
      const heard = `<span class="heard-text">${escapeHTML(alternatives[0])}</span>`;
      if (newCount >= TARGET_REPETITIONS) {
        setFeedback({
          html: `¡Lo dominas! ${TARGET_REPETITIONS}/${TARGET_REPETITIONS} - Has dicho ${heard}.`,
          type: 'success',
        });
        onMarkWordDone(phoneme.id, wordIdx);
        setTimeout(() => setWordIdx((i) => i + 1), 1200);
      } else {
        const remaining = TARGET_REPETITIONS - newCount;
        const veces = remaining === 1 ? 'vez' : 'veces';
        const queda = remaining === 1 ? 'queda' : 'quedan';
        setFeedback({
          html: `¡Enhorabuena! ${newCount}/${TARGET_REPETITIONS} - Te ${queda} ${remaining} ${veces}. ¡Repítelo!`,
          type: 'success',
        });
        setTimeout(() => setCardState((s) => (s === 'success' ? '' : s)), 1000);
      }
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

    rec.onstart = () => { console.log('[SR] onstart'); };
    rec.onaudiostart = () => { console.log('[SR] onaudiostart'); };
    rec.onsoundstart = () => { console.log('[SR] onsoundstart'); };
    rec.onspeechstart = () => { console.log('[SR] onspeechstart'); };
    rec.onspeechend = () => { console.log('[SR] onspeechend'); };
    rec.onsoundend = () => { console.log('[SR] onsoundend'); };
    rec.onaudioend = () => { console.log('[SR] onaudioend'); };

    rec.onresult = (event) => {
      console.log('[SR] onresult', event);
      const results = event.results[0];
      const alts = [];
      for (let i = 0; i < results.length; i++) alts.push(results[i].transcript);
      evaluatePronunciation(alts);
    };

    rec.onnomatch = (event) => {
      console.log('[SR] onnomatch', event);
    };

    rec.onerror = (event) => {
      console.log('[SR] onerror', event.error, event);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        handledRef.current = true;
        setFeedback({ html: 'Necesito permiso para usar el micrófono.', type: 'error' });
      } else if (event.error === 'aborted') {
        handledRef.current = true;
      } else if (event.error !== 'no-speech') {
        handledRef.current = true;
        setFeedback({ html: 'Error de reconocimiento: ' + event.error, type: 'error' });
      }
    };

    rec.onend = () => {
      console.log('[SR] onend');
      setIsRecording(false);
      setCardState((s) => (s === 'recording' ? '' : s));
      recognitionRef.current = null;
      stopVAD();

      if (!handledRef.current) {
        setFeedback({ html: 'No se ha reconocido, intenta otra vez.', type: 'error' });
        pendingPlaybackRef.current = true;
      }

      const mr = mediaRecorderRef.current;
      const wasRecording = mr && mr.state === 'recording';
      if (wasRecording) {
        // mr.onstop will fire async, set the URL and trigger the playback.
        stopMediaRecording();
      } else if (pendingPlaybackRef.current) {
        // No live recorder — play whatever URL we have right now (may be empty).
        pendingPlaybackRef.current = false;
        playRecording();
      }
    };

    stopVAD();
    stopPlayback();
    pendingPlaybackRef.current = false;
    handledRef.current = false;

    recognitionRef.current = rec;
    try {
      rec.start();
      startMediaRecording();
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

  const words = phoneme.words;
  const slotPx = typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches
    ? SLOT_HEIGHT_MOBILE : SLOT_HEIGHT;
  const trackOffset = -slotPx / 2 - wordIdx * slotPx + dragOffset;

  return (
    <div>
      <button className="back-btn" onClick={back}>← Volver al menú</button>
      <div className="practice-header">
        <div>
          <h2>{phoneme.symbol} {phoneme.name}</h2>
          <p>{phoneme.description}</p>
        </div>
        <div className="practice-progress">{wordIdx + 1} / {words.length}</div>
      </div>

      <div className="feedback-slot">
        <div className={fbClass} dangerouslySetInnerHTML={feedback ? { __html: feedback.html } : undefined} />
      </div>

      <div className="word-carousel" ref={carouselRef}>
        <div
          className={`carousel-track${isDragging ? '' : ' snapping'}`}
          style={{ transform: `translateY(${trackOffset}px)` }}
        >
          {words.map((w, i) => {
            const isCenter = i === wordIdx;
            return (
              <div className="carousel-slot" key={i}>
                <button
                  type="button"
                  ref={isCenter ? cardRef : undefined}
                  className={isCenter ? buttonClass : 'record-button inactive'}
                  onClick={() => {
                    if (swipedRef.current) { swipedRef.current = false; return; }
                    if (isCenter) handleCardClick();
                    else goToWord(i);
                  }}
                  title={isCenter ? 'Pulsa para oír y luego grabarte' : `Ir a "${w.word}"`}
                  tabIndex={Math.abs(i - wordIdx) <= 1 ? 0 : -1}
                  aria-hidden={Math.abs(i - wordIdx) > 1}
                >
                  <div className="word-meta" key={`meta-${wordIdx}`}>
                    <div className="word-ipa">{word.ipa}</div>
                    <div className="word-meaning">{word.meaning}</div>
                  </div>
                  
                  <span className="record-button-label">{w.word}</span>
                  {isCenter && (
                    <span className="record-button-counter">
                      <span key={successCount} className="record-button-counter-num">
                        {Math.max(0, TARGET_REPETITIONS - successCount)}
                      </span>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>


    </div>
  );
}
