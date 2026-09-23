import { useEffect, useRef, useState } from 'react';

export function CircularProgress({ percent }: { percent: number | undefined }) {
  const [displayPercent, setDisplayPercent] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const target = percent ?? 0;
    const animate = () => {
      setDisplayPercent((current) => {
        const diff = target - current;
        if (Math.abs(diff) < 0.5) return target;
        // ease toward target slowly rather than jumping
        return current + diff * 0.06;
      });
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [percent]);

  // Once the network transfer reports 100% AND the animated ring has
  // actually caught up to 100%, switch to the indeterminate "finishing" spinner.
  useEffect(() => {
    if ((percent ?? 0) >= 100 && displayPercent >= 99.5) {
      setFinishing(true);
    }
  }, [percent, displayPercent]);

  const isIndeterminate = percent === undefined || finishing;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = isIndeterminate
    ? circumference * 0.25
    : circumference * (1 - displayPercent / 100);

  return (
    <div className="flex h-full items-center justify-center gap-1.5">
      <svg
        viewBox="0 0 100 100"
        className="h-4/5 aspect-square shrink-0"
        style={{
          transform: 'rotate(-90deg)',
          animation: isIndeterminate ? 'circular-progress-spin 2.2s linear infinite' : undefined,
        }}
      >
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={10} />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: isIndeterminate ? undefined : 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      <span className="font-mono text-[10px] tabular-nums text-zinc-300">
        {isIndeterminate ? 'Analyzing...' : `Uploading... ${Math.round(displayPercent)}%`}
      </span>
      <style>{`
        @keyframes circular-progress-spin {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
      `}</style>
    </div>
  );
}