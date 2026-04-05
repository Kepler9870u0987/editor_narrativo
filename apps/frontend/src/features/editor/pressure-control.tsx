import { useEditorStore } from './editor-store';

const PRESSURE_LABELS: Record<number, string> = {
  1: 'Blando',
  2: 'Moderato',
  3: 'Bilanciato',
  4: 'Incisivo',
  5: 'Critico',
};

export function PressureControl() {
  const pressureLevel = useEditorStore((state) => state.pressureLevel);
  const setPressureLevel = useEditorStore((state) => state.setPressureLevel);

  return (
    <div className="pressure-control">
      <span className="pressure-control__label">Feedback AI</span>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={pressureLevel}
        onChange={(e) => setPressureLevel(Number(e.target.value))}
        className="pressure-control__slider"
      />
      <span className="pressure-control__value" data-level={pressureLevel}>
        L{pressureLevel} — {PRESSURE_LABELS[pressureLevel]}
      </span>
    </div>
  );
}
