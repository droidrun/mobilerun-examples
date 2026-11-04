import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { RunView } from '@/shared/contracts';
import { RunPanel } from './app';

const RUN: RunView = {
  id: 'run-1', presetId: 'cheapest-hotel', request: 'Lisbon, 12–15 May', status: 'failed',
  steps: null, timeline: [], result: null, rawOutput: null, message: null, error: null,
  charged: 3, balance: 97, createdAt: new Date().toISOString(),
};
const persona = { name: 'Wren', role: 'Trip concierge' };
const presets = [{ id: 'cheapest-hotel', label: 'Cheapest hotel', hint: '' }];
const unused = async () => true;

const render = (run: Partial<RunView> | null) =>
  renderToString(
    <RunPanel
      session={{ persona, presets, balance: 97, reservePerRun: 20, run: run && { ...RUN, ...run } }}
      loadFailed={false}
      notice={undefined}
      reload={async () => {}}
      start={unused}
      sendNote={unused}
      stop={unused}
    />,
  );

test('an active run shows Working with elapsed time, the step count once known, a note box', () => {
  const html = render({ status: 'running', steps: 4, charged: null });
  expect(html).toContain('Working… ');
  expect(html).toContain('Step 4');
  expect(html).toContain('Add a note');
  expect(render({ status: 'running', steps: 0, charged: null })).not.toContain('Step');
  expect(render({ status: 'cancelling', charged: null })).toContain('Stopping…');
});

test('a result shows the found rows and what was not found in one line', () => {
  const rows = [{ label: 'Hotel', value: 'Casa Azul' }];
  const html = render({ status: 'completed', result: { rows, missing: ['Rating', 'Good to know'] } });
  expect(html).toContain('<dt>Hotel</dt><dd>Casa Azul</dd>');
  expect(html).toContain('Not found: Rating, Good to know');
});

test("a failed run reads as the assistant's own words; without words nothing was changed", () => {
  const html = render({ message: 'I only help with travel.', rawOutput: '{\n  "answer": "Sorry."\n}' });
  expect(html).toContain('Couldn&#x27;t finish');
  expect(html).toContain('<blockquote class="reply">I only help with travel.</blockquote>');
  expect(html).toContain('&quot;Sorry.&quot;');
  expect(render({})).toContain('Nothing was booked or changed.');
  expect(render(null)).toContain('The answer shows up here.');
});
