import React, { useId } from 'react';

interface SegmentedArcGaugeProps {
  value: string | number;
  subtitle: string;
  percentage: number; // 0 to 100
  segments?: number;
}

export const SegmentedArcGauge: React.FC<SegmentedArcGaugeProps> = ({
  value,
  subtitle,
  percentage,
  segments = 24,
}) => {
  const clamped = Math.max(0, Math.min(100, percentage));
  const activeCount = Math.round((clamped / 100) * segments);

  // Color progression matching the cyan-to-mint arc in the reference UI
  const getSegmentColor = (index: number, total: number, active: boolean) => {
    if (!active) return undefined;
    const ratio = index / Math.max(1, total - 1);
    if (ratio < 0.35) return '#199EC7';
    if (ratio < 0.65) return '#38C8B8';
    return '#7DE2A7';
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg
        viewBox="0 0 240 132"
        className="w-full max-w-[250px] overflow-visible"
        role="img"
        aria-label={`${value} ${subtitle} (${clamped}%)`}
      >
        {Array.from({ length: segments }).map((_, idx) => {
          const angleDeg = -90 + (idx / (segments - 1)) * 180;
          const isActive = idx < activeCount;
          const fillHex = getSegmentColor(idx, segments, isActive);
          return (
            <rect
              key={idx}
              x="116.5"
              y="10"
              width="7"
              height="24"
              rx="3"
              transform={`rotate(${angleDeg} 120 118)`}
              fill={fillHex}
              className={isActive ? '' : 'fill-slate-100 dark:fill-slate-800'}
            />
          );
        })}
      </svg>

      <div className="-mt-12 text-center">
        <p className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
          {value}
        </p>
        <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
    </div>
  );
};

interface GradientProgressBarProps {
  percent: number;
  label?: string;
}

export const GradientProgressBar: React.FC<GradientProgressBarProps> = ({
  percent,
  label = 'Progression',
}) => {
  const gradId = useId();
  const patternId = useId();
  const clamped = percent <= 0 ? 0 : Math.max(4, Math.min(100, percent));

  return (
    <div className="w-full rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 overflow-hidden">
      <svg
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className="w-full h-7 rounded-[10px]"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1798C7" />
            <stop offset="55%" stopColor="#32C5B8" />
            <stop offset="100%" stopColor="#72E5B0" />
          </linearGradient>
          <pattern
            id={patternId}
            width="4"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(28)"
          >
            <rect width="1.4" height="10" fill="#ffffff" fillOpacity="0.16" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={clamped} height="10" rx="2.5" fill={`url(#${gradId})`} />
        <rect x="0" y="0" width={clamped} height="10" rx="2.5" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};

export interface StatColumnItem {
  key: string;
  label: string;
  value: number;
  badgeText: string;
  subValue?: string;
  isHighlighted?: boolean;
  isMuted?: boolean;
}

interface StatBarColumnsProps {
  items: StatColumnItem[];
  selectedKey?: string;
  onSelectKey?: (key: string) => void;
}

export const StatBarColumns: React.FC<StatBarColumnsProps> = ({
  items,
  selectedKey,
  onSelectKey,
}) => {
  const gradHighlight = useId();
  const gradSoft = useId();
  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-7 gap-2.5 items-end pt-2">
      {items.map((item) => {
        const ratio = item.value / maxVal;
        const barHeight = Math.max(18, Math.round(ratio * 92));
        const isPeak = item.isHighlighted || selectedKey === item.key;

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelectKey?.(item.key)}
            disabled={!onSelectKey}
            className={`group flex flex-col items-center rounded-xl p-1.5 transition-colors ${
              onSelectKey ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'cursor-default'
            } ${
              selectedKey === item.key
                ? 'ring-1 ring-sky-500/70 bg-sky-50/50 dark:bg-sky-950/30'
                : ''
            }`}
          >
            <span
              className={`mb-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold font-mono tabular-nums whitespace-nowrap ${
                item.isMuted
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300'
                  : isPeak
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                  : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
              }`}
            >
              {item.badgeText}
            </span>

            <svg viewBox="0 0 44 100" className="w-full max-w-[46px] h-28">
              <defs>
                <linearGradient id={gradHighlight} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#38D399" />
                  <stop offset="100%" stopColor="#199EC7" />
                </linearGradient>
                <linearGradient id={gradSoft} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#67E8F9" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.22" />
                </linearGradient>
              </defs>
              <rect
                x="4"
                y={100 - barHeight}
                width="36"
                height={barHeight}
                rx="7"
                fill={
                  item.isMuted
                    ? '#CBD5E1'
                    : isPeak
                    ? `url(#${gradHighlight})`
                    : `url(#${gradSoft})`
                }
                className={item.isMuted ? 'dark:fill-slate-700' : ''}
              />
            </svg>

            <span className="mt-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              {item.label}
            </span>
            {item.subValue && (
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums truncate max-w-full">
                {item.subValue}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
