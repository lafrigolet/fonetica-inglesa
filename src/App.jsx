import { useState } from 'react';
import HomeScreen from './HomeScreen';
import PracticeScreen from './PracticeScreen';
import DoneScreen from './DoneScreen';
import { useTheme } from './useTheme';
import { useProgress } from './useProgress';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { markWordDone, reset, phonemeProgress } = useProgress();
  const [voiceLang, setVoiceLang] = useState('en-GB');
  const [screen, setScreen] = useState('home');
  const [activePhoneme, setActivePhoneme] = useState(null);
  const [initialIdx, setInitialIdx] = useState(0);

  function selectPhoneme(p) {
    const progress = phonemeProgress(p.id);
    const firstUndone = p.words.findIndex((_, i) => !progress[i]);
    setInitialIdx(firstUndone >= 0 ? firstUndone : 0);
    setActivePhoneme(p);
    setScreen('practice');
  }

  function backToHome() {
    setScreen('home');
    setActivePhoneme(null);
  }

  return (
    <div className="container">
      {screen === 'home' && (
        <HomeScreen
          theme={theme}
          onToggleTheme={toggleTheme}
          voiceLang={voiceLang}
          onChangeVoice={setVoiceLang}
          onResetProgress={reset}
          phonemeProgress={phonemeProgress}
          onSelectPhoneme={selectPhoneme}
        />
      )}
      {screen === 'practice' && activePhoneme && (
        <PracticeScreen
          phoneme={activePhoneme}
          voiceLang={voiceLang}
          initialIdx={initialIdx}
          onMarkWordDone={markWordDone}
          onBack={backToHome}
          onComplete={() => setScreen('done')}
        />
      )}
      {screen === 'done' && activePhoneme && (
        <DoneScreen phoneme={activePhoneme} onBack={backToHome} />
      )}
    </div>
  );
}
