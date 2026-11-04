import type { TimelineEntry } from '@/shared/contracts';

export function ProgressTimeline({ entries }: { entries: Array<TimelineEntry> }) {
  if (entries.length === 0) return null;
  return (
    <ol className="timeline" aria-label="Progress">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className={`timeline-${entry.kind}`}>
          <span className="timeline-dot" aria-hidden="true" />
          <span>{entry.kind === 'user' ? `You: ${entry.text}` : entry.text}</span>
        </li>
      ))}
    </ol>
  );
}
