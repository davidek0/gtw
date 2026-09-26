import type { Source } from "@/lib/backend";

export function SourceBadge({ source, error }: { source: Source; error?: string | undefined }) {
  const label =
    source === "backend" ? "Live · your laptop" : source === "error" ? "Can't reach laptop" : "Demo data";
  const tone =
    source === "backend"
      ? "bg-sage/15 text-sage-deep"
      : source === "error"
        ? "bg-risk/10 text-risk-deep"
        : "bg-ink/5 text-ink/60";
  return (
    <span
      title={error}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
