import type { PublicPreset } from '@/shared/contracts';

type ResultCardProps = {
  preset: PublicPreset | undefined;
  result: Record<string, unknown>;
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
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return <dd>{text}</dd>;
}

/** Renders the structured output with the labels the preset declares. */
export function ResultCard({ preset, result }: ResultCardProps) {
  const fields = preset?.fields ?? [];
  return (
    <section className="result-card" aria-label="Result">
      <h3>{preset?.label ?? 'Result'}</h3>
      <dl>
        {fields.map((field) => (
          <div key={field.key} className="result-row">
            <dt>{field.label}</dt>
            <Value type={field.type} value={result[field.key]} />
          </div>
        ))}
      </dl>
    </section>
  );
}
