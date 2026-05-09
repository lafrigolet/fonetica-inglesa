import { PHONEMES } from './phonemes';
import { SUPPORT } from './speech';

function PhonemeCard({ phoneme, progress, onSelect }) {
  const completed = Object.keys(progress).filter((k) => progress[k]).length;
  const total = phoneme.words.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed === total;

  return (
    <button
      className={`phoneme-card${isComplete ? ' complete' : ''}`}
      onClick={() => onSelect(phoneme)}
    >
      <div className="phoneme-symbol">{phoneme.symbol}</div>
      <div className="phoneme-name">{phoneme.name}</div>
      <div className="phoneme-example">{phoneme.words[0].word}, {phoneme.words[1].word}…</div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="progress-label">{completed}/{total} dominadas</div>
    </button>
  );
}

export default function HomeScreen({
  theme, onToggleTheme,
  voiceLang, onChangeVoice,
  onResetProgress,
  phonemeProgress,
  onSelectPhoneme,
}) {
  const issues = [];
  if (!SUPPORT.recognition) issues.push('reconocimiento de voz');
  if (!SUPPORT.synthesis) issues.push('síntesis de voz');

  return (
    <div>
      <header>
        <h1>Fonética inglesa</h1>
        <p>Practica los sonidos del inglés que no existen en español</p>
      </header>

      {issues.length > 0 && (
        <div className="warn-banner">
          Tu navegador no soporta {issues.join(' ni ')}. Usa Chrome, Edge o Safari para que la app funcione.
        </div>
      )}

      <div className="settings">
        <label>Voz:&nbsp;
          <select value={voiceLang} onChange={(e) => onChangeVoice(e.target.value)}>
            <option value="en-GB">Británica (en-GB)</option>
            <option value="en-US">Americana (en-US)</option>
          </select>
        </label>
        <button className="icon-btn" aria-label="Cambiar tema" onClick={onToggleTheme}>
          <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
        </button>
        <button className="icon-btn" onClick={() => {
          if (window.confirm('¿Reiniciar todo el progreso?')) onResetProgress();
        }}>Reiniciar progreso</button>
      </div>

      <div className="phoneme-grid">
        {PHONEMES.map((p) => (
          <PhonemeCard
            key={p.id}
            phoneme={p}
            progress={phonemeProgress(p.id)}
            onSelect={onSelectPhoneme}
          />
        ))}
      </div>

      <div className="footer-note">
        Concede permiso al micrófono cuando el navegador lo pida. Funciona mejor en Chrome, Edge o Safari.
      </div>
    </div>
  );
}
