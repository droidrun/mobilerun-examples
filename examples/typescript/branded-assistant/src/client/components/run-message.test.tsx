import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { RunView } from '@/shared/contracts';
import { RunMessage } from './run-message';

const run: RunView = {
  id: 'run-1',
  presetId: 'hotel',
  request: 'Write me a poem',
  status: 'failed',
  steps: 1,
  timeline: [],
  result: null,
  rawOutput: null,
  message: null,
  error: null,
  charged: 3,
  balance: 97,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function render(overrides: Partial<RunView>): string {
  return renderToString(
    <RunMessage
      run={{ ...run, ...overrides }}
      preset={undefined}
      isActive={false}
      reply={async () => true}
      cancel={async () => {}}
    />,
  );
}

describe('run message', () => {
  test('a failed task with output reads as the assistant declining, with its words as the reply', () => {
    const html = render({
      message: 'I only help with travel.',
      rawOutput: '{\n  "answer": "Sorry, that is outside what I can do."\n}',
    });
    expect(html).toContain("Couldn&#x27;t finish");
    expect(html).toContain("The assistant couldn&#x27;t do this one.");
    expect(html).toContain('<blockquote class="assistant-reply">I only help with travel.</blockquote>');
    expect(html).toContain('Sorry, that is outside what I can do.');
    expect(html).not.toContain('[object Object]');
  });

  test('an active run shows Working with elapsed time even when no steps are reported', () => {
    const html = render({ status: 'running', steps: null, charged: null });
    expect(html).toContain('Working…');
    expect(html).toContain('class="elapsed"');
    expect(render({ status: 'cancelling', charged: null })).toContain('Stopping…');
    expect(render({ status: 'completed' })).not.toContain('Working…');
  });

  test('a failed task with no words says nothing was changed', () => {
    expect(render({})).toContain('Nothing was booked or changed.');
  });
});
