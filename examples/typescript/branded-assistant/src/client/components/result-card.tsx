import type { PublicPreset } from '@/shared/contracts';

type ResultCardProps = {
  preset: PublicPreset | undefined;
  /** Output that matched the preset's schema. */
  result: Record<string, unknown> | null;
  /** Output that did not match, as text. Shown collapsed. */
  rawOutput: string | null;
};

function Value({ type, value }: { type: PublicPreset['fields'][number]['type']; value: unknown }) {
  if (type === 'list') {
    const items = Array.isArray(value) ? value.map(String) : [];
    if (items.length === 0) return <dd>—</dd>;
    return (
      <dd>
        <ul>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      </dd>
    );
  }
  return <dd>{typeof value === 'string' || typeof value === 'number' ? String(value) : '—'}</dd>;
}

/** Renders validated structured output, or says it could not be read. */
export function ResultCard({ preset, result, rawOutput }: ResultCardProps) {
  if (!result) {
    return (
      <section className="result-card" aria-label="Result">
        <p className="muted">The result could not be read.</p>
        {rawOutput ? (
          <details>
            <summary>Show what came back</summary>
            <pre>{rawOutput}</pre>
          </details>
        ) : null}
      </section>
    );
  }
  return (
    <section className="result-card" aria-label="Result">
      <h3>{preset?.label ?? 'Result'}</h3>
      <dl>
        {(preset?.fields ?? []).map((field) => (
          <div key={field.key} className="result-row">
            <dt>{field.label}</dt>
            <Value type={field.type} value={result[field.key]} />
          </div>
        ))}
      </dl>
    </section>
  );
}
