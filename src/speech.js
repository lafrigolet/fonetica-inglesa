const SpeechSynthesisAPI = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

if (SpeechSynthesisAPI) {
  SpeechSynthesisAPI.getVoices();
  SpeechSynthesisAPI.onvoiceschanged = () => SpeechSynthesisAPI.getVoices();
}

export function speak(text, slow, lang = 'en-GB') {
  if (!SpeechSynthesisAPI) return;
  SpeechSynthesisAPI.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = slow ? 0.55 : 0.9;
  utterance.pitch = 1;
  const voices = SpeechSynthesisAPI.getVoices();
  const voice = voices.find((v) => v.lang === lang)
             || voices.find((v) => v.lang.startsWith(lang.split('-')[0]));
  if (voice) utterance.voice = voice;
  SpeechSynthesisAPI.speak(utterance);
}

export const SUPPORT = {
  synthesis: !!SpeechSynthesisAPI,
  recognition: !!SpeechRecognitionAPI,
};
