import { formatTimeMin, parseTimeMin } from '../engine/index.js';
import type { ClosureSpec } from '../engine/types.js';

export type PlaybackSpeed = 1 | 2 | 5;

export const PLAYBACK_START_MIN = 360; // 06:00 IST
export const PLAYBACK_END_MIN = 1410; // 23:30 IST
export const DEFAULT_CLOCK_MIN = 420; // 07:00 IST

const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 5];
const AXIS_TICKS = [360, 540, 720, 900, 1080, 1260, 1410] as const;

interface PlaybackBarProps {
  currentTimeMin: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  closure: ClosureSpec | null;
  reducedMotion: boolean;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onScrubTime: (nextTimeMin: number) => void;
  onResetClock: () => void;
}

export function PlaybackBar({
  currentTimeMin,
  isPlaying,
  speed,
  closure,
  reducedMotion,
  onTogglePlay,
  onChangeSpeed,
  onScrubTime,
  onResetClock,
}: PlaybackBarProps) {
  const span = PLAYBACK_END_MIN - PLAYBACK_START_MIN;
  const clamped = Math.max(PLAYBACK_START_MIN, Math.min(PLAYBACK_END_MIN, currentTimeMin));
  const progressPct = ((clamped - PLAYBACK_START_MIN) / span) * 100;

  let closureBand: { leftPct: number; widthPct: number; label: string } | null = null;
  if (closure) {
    const startMin = parseTimeMin(closure.start);
    const endMin = parseTimeMin(closure.end);
    const bandStart = Math.max(PLAYBACK_START_MIN, Math.min(PLAYBACK_END_MIN, startMin));
    const bandEnd = Math.max(bandStart, Math.min(PLAYBACK_END_MIN, endMin));
    if (bandEnd > bandStart) {
      closureBand = {
        leftPct: ((bandStart - PLAYBACK_START_MIN) / span) * 100,
        widthPct: ((bandEnd - bandStart) / span) * 100,
        label: `${closure.airport} ${closure.start}–${closure.end}`,
      };
    }
  }

  return (
    <section
      aria-label="Simulation timeline and playback controls"
      className="surface-panel rounded-xl px-3.5 py-2.5 shadow-lg flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={onTogglePlay}
          aria-pressed={isPlaying}
          aria-label={isPlaying ? 'Pause simulation playback (Space)' : 'Play simulation playback (Space)'}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer shrink-0"
          style={{
            backgroundColor: isPlaying ? 'var(--storm-bg)' : 'var(--button-primary-bg)',
            color: isPlaying ? 'var(--storm-text)' : 'var(--button-primary-ink)',
            border: isPlaying ? '1px solid var(--storm)' : '1px solid transparent',
          }}
        >
          <span aria-hidden="true">{isPlaying ? '❚❚' : '▶'}</span>
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        {/* Speed Toggle */}
        <div role="group" aria-label="Playback speed" className="inline-flex items-center gap-1 shrink-0">
          {SPEEDS.map((s) => {
            const active = speed === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChangeSpeed(s)}
                aria-pressed={active}
                aria-label={`Set playback speed to ${s}x`}
                className="font-mono-tabular rounded-md border px-2 py-1 text-xs font-medium cursor-pointer"
                style={
                  active
                    ? {
                        backgroundColor: 'var(--pill-active-bg)',
                        color: 'var(--pill-active-ink)',
                        borderColor: 'var(--pill-active-bg)',
                      }
                    : {
                        backgroundColor: 'var(--panel-elevated)',
                        color: 'var(--ink)',
                        borderColor: 'var(--border)',
                      }
                }
              >
                {s}×
              </button>
            );
          })}
        </div>

        {/* Scrubber Track with Shaded Closure Band */}
        <div className="relative flex-1 min-w-[180px] flex flex-col gap-1">
          <div className="relative h-6 flex items-center">
            {/* Base track */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 h-2.5 rounded-full overflow-hidden border"
              style={{ backgroundColor: 'var(--track-bg)', borderColor: 'var(--border)' }}
            >
              {/* Elapsed progress */}
              <div
                className="absolute top-0 bottom-0 left-0 opacity-65"
                style={{ width: `${progressPct}%`, backgroundColor: 'var(--ontime)' }}
              />
              {/* Shaded Closure Band */}
              {closureBand && (
                <div
                  className="absolute top-0 bottom-0 border-x"
                  style={{
                    left: `${closureBand.leftPct}%`,
                    width: `${closureBand.widthPct}%`,
                    backgroundColor: 'var(--storm-bg)',
                    borderColor: 'var(--storm)',
                  }}
                  title={`Ground stop window: ${closureBand.label}`}
                />
              )}
            </div>

            <input
              type="range"
              min={PLAYBACK_START_MIN}
              max={PLAYBACK_END_MIN}
              step={1}
              value={Math.round(clamped)}
              onChange={(e) => onScrubTime(Number(e.target.value))}
              aria-label="Simulation clock scrubber from 06:00 to 23:30 IST"
              aria-valuetext={`${formatTimeMin(Math.round(clamped))} IST`}
              className="playback-range relative z-10 w-full cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono-tabular px-0.5" style={{ color: 'var(--muted)' }}>
            {AXIS_TICKS.map((t) => (
              <span key={t} className={t === 540 || t === 900 || t === 1260 ? 'hidden sm:inline' : ''}>
                {formatTimeMin(t)}
              </span>
            ))}
          </div>
        </div>

        {/* IST Mono Clock + Reset */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-end leading-tight">
            <span className="font-mono-tabular text-sm sm:text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {formatTimeMin(Math.round(clamped))} IST
            </span>
            <span className="font-mono-tabular text-[10px]" style={{ color: 'var(--muted)' }}>
              {isPlaying ? `Playing ${speed}×` : reducedMotion ? 'Paused · Reduced motion' : 'Paused'}
            </span>
          </div>

          <button
            type="button"
            onClick={onResetClock}
            aria-label="Reset clock to 07:00 IST"
            title="Reset clock to 07:00 IST"
            className="surface-elevated font-mono-tabular rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer"
            style={{ color: 'var(--ink)' }}
          >
            ↺ 07:00
          </button>
        </div>
      </div>
    </section>
  );
}
