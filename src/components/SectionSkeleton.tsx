import React from 'react';
import { AppSection } from '../types/dental';

interface SectionSkeletonProps {
  section: AppSection;
  label: string;
}

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    aria-hidden="true"
    className={`rounded-md bg-slate-200/80 dark:bg-slate-800 animate-pulse motion-reduce:animate-none ${className}`}
  />
);

const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
  rows = 6,
  columns = 5,
}) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
    <div className="grid grid-cols-12 gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-4 py-3">
      {Array.from({ length: columns }).map((_, idx) => (
        <div
          key={idx}
          className={idx === 0 ? 'col-span-4' : idx === columns - 1 ? 'col-span-2 flex justify-end' : 'col-span-2'}
        >
          <SkeletonBlock className="h-3 w-20" />
        </div>
      ))}
    </div>
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid grid-cols-12 items-center gap-3 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, colIdx) => (
            <div
              key={colIdx}
              className={
                colIdx === 0
                  ? 'col-span-4 space-y-1.5'
                  : colIdx === columns - 1
                  ? 'col-span-2 flex justify-end'
                  : 'col-span-2'
              }
            >
              {colIdx === 0 ? (
                <>
                  <SkeletonBlock className="h-3.5 w-3/4" />
                  <SkeletonBlock className="h-2.5 w-1/2 bg-slate-100 dark:bg-slate-800/60" />
                </>
              ) : (
                <SkeletonBlock className="h-3.5 w-2/3" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

const ToolbarSkeleton: React.FC = () => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
    <div className="flex flex-wrap items-center gap-2.5">
      <SkeletonBlock className="h-9 w-64" />
      <SkeletonBlock className="h-9 w-36" />
      <SkeletonBlock className="h-9 w-32" />
    </div>
    <SkeletonBlock className="h-9 w-40 bg-sky-100 dark:bg-sky-950/60" />
  </div>
);

export const SectionSkeleton: React.FC<SectionSkeletonProps> = ({ section, label }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Chargement de ${label}`}
      className="space-y-5"
    >
      <span className="sr-only">Chargement de la section {label} en cours...</span>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SkeletonBlock className="h-4 w-44" />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            Chargement : {label}
          </span>
        </div>
        <SkeletonBlock className="h-3 w-24" />
      </div>

      {(section === 'dashboard' || section === 'reports') && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="rounded-2xl bg-[#163B63]/90 p-5 space-y-3">
                <SkeletonBlock className="h-3 w-28 bg-white/20 dark:bg-white/20" />
                <SkeletonBlock className="h-8 w-40 bg-white/30 dark:bg-white/30" />
              </div>
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <SkeletonBlock className="h-3 w-28" />
                <SkeletonBlock className="h-7 w-36" />
              </div>
            </div>
            <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonBlock className="h-8 w-36" />
              <SkeletonBlock className="h-7 w-full rounded-xl" />
              <SkeletonBlock className="h-3 w-full bg-slate-100 dark:bg-slate-800/60" />
            </div>
            <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col items-center justify-between space-y-3">
              <div className="w-full flex justify-between">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-4 w-6" />
              </div>
              <SkeletonBlock className="h-24 w-44 rounded-t-full" />
              <SkeletonBlock className="h-3 w-full bg-slate-100 dark:bg-slate-800/60" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex justify-between">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-6 w-44 rounded-full" />
              </div>
              <div className="grid grid-cols-7 gap-2 items-end pt-4">
                {Array.from({ length: 7 }).map((_, idx) => (
                  <SkeletonBlock key={idx} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            </div>
            <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <SkeletonBlock className="h-4 w-40" />
              {Array.from({ length: 4 }).map((_, idx) => (
                <SkeletonBlock key={idx} className="h-12 w-full rounded-xl bg-slate-100 dark:bg-slate-800/60" />
              ))}
            </div>
          </div>
        </>
      )}

      {section === 'appointments' && (
        <>
          <ToolbarSkeleton />
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3 gap-3">
              <SkeletonBlock className="h-4 w-20" />
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-4 w-32" />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-3 p-3.5 items-center">
                  <SkeletonBlock className="h-3.5 w-14" />
                  <SkeletonBlock className="h-10 w-full rounded-lg" />
                  <SkeletonBlock className="h-10 w-full rounded-lg bg-slate-100 dark:bg-slate-800/60" />
                  <SkeletonBlock className="h-10 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {section === 'settings' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {Array.from({ length: 2 }).map((_, cardIdx) => (
              <div
                key={cardIdx}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <SkeletonBlock className="h-4 w-48" />
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((__, fieldIdx) => (
                    <div key={fieldIdx} className="space-y-1.5">
                      <SkeletonBlock className="h-3 w-28 bg-slate-100 dark:bg-slate-800/60" />
                      <SkeletonBlock className="h-9 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {section !== 'dashboard' &&
        section !== 'appointments' &&
        section !== 'settings' &&
        section !== 'reports' && (
          <>
            <ToolbarSkeleton />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2"
                >
                  <SkeletonBlock className="h-3 w-24" />
                  <SkeletonBlock className="h-6 w-28" />
                </div>
              ))}
            </div>
            <TableSkeleton rows={6} columns={5} />
          </>
        )}
    </div>
  );
};
