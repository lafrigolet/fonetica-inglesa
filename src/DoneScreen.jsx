export default function DoneScreen({ phoneme, onBack }) {
  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Volver al menú</button>
      <div className="completion">
        <div className="check">✓</div>
        <h2>¡Sonido completado!</h2>
        <p>Has practicado todas las palabras de {phoneme.symbol} {phoneme.name}.</p>
        <button className="btn primary" onClick={onBack}>Volver a los sonidos</button>
      </div>
    </div>
  );
}
