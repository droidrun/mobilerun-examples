import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import type { RunView } from '@/shared/contracts';
import { RunPanel, Welcome } from './app';

const RUN: RunView = {
  id: 'run-1', presetId: 'cheapest-hotel', request: 'Lisbon, 12–15 May', status: 'failed',
  steps: null, timeline: [], result: null, rawOutput: null, message: null, error: null,
  charged: 3, balance: 97, createdAt: new Date().toISOString(),
};
const unused = async () => true;

const render = (run: Partial<RunView>, pollFailing = false) =>
  renderToString(
    <RunPanel
      run={{ ...RUN, ...run }}
      name="Wren"
      title="Cheapest hotel"
      pollFailing={pollFailing}
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
  expect(render({ status: 'running', charged: null }, true)).toContain('Retrying.');
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
  expect(renderToString(<Welcome name="Wren" />)).toContain('The answer shows up here.');
});

test('a failed run with a result keeps its explanation next to the result', () => {
  const rows = [{ label: 'Hotel', value: 'Casa Azul' }];
  const html = render({ message: 'Prices changed while I looked.', result: { rows, missing: [] } });
  expect(html).toContain('Wren couldn&#x27;t do this one.');
  expect(html).toContain('Prices changed while I looked.');
  expect(html).toContain('<dt>Hotel</dt><dd>Casa Azul</dd>');
});
