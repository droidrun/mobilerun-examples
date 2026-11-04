import { useState, type FormEvent } from 'react';
import type { PublicPreset } from '@/shared/contracts';

type ComposerProps = {
  presets: Array<PublicPreset>;
  disabled: boolean;
  start: (input: { presetId: string; message: string }) => Promise<void>;
};

export function Composer({ presets, disabled, start }: ComposerProps) {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const preset = presets.find((item) => item.id === presetId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || !presetId || disabled || sending) return;
    setSending(true);
    await start({ presetId, message: trimmed });
    setMessage('');
    setSending(false);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="chips" role="radiogroup" aria-label="What should I do?">
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === presetId}
            className={item.id === presetId ? 'chip chip-on' : 'chip'}
            onClick={() => setPresetId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="composer-row">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={preset?.hint ?? 'Describe what you need'}
          rows={2}
          maxLength={2_000}
          aria-label="Your request"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={disabled || sending || !message.trim()}>
          Ask
        </button>
      </div>
    </form>
  );
}
