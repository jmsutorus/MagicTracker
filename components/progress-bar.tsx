/**
 * A completion bar. Turns green only at 100%, so "nearly there" and "done"
 * are distinguishable at a glance rather than by reading the number.
 */
export function ProgressBar({
  percent,
  className = "",
}: {
  percent: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-muted ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${clamped >= 100 ? "bg-ok" : "bg-accent"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
