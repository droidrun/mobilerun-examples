import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { deviceSummarySchema, type DeviceSummary } from '@/shared/contracts';
import { createInitialRunnerState } from '@/client/runner-machine';

let devices: DeviceSummary[] = [];
mock.module('@/client/use-devices', () => ({
  useDevices: () => ({ items: devices, loading: false, error: null }),
}));
const { TaskBrief } = await import('./task-brief');

const DEVICE_ID = '67937442-41bd-4a67-a16e-e1ce86c99568';

describe('device selector', () => {
  test.each(['', undefined])('labels devices with name %p by short id', (name) => {
    devices = [deviceSummarySchema.parse({
      id: DEVICE_ID,
      ...(name === undefined ? {} : { name }),
      state: 'ready',
      type: 'dedicated_premium_device',
    })];
    const html = renderToStaticMarkup(
      <TaskBrief
        state={createInitialRunnerState()}
        run={async () => {}}
        cancel={async () => {}}
        reset={() => {}}
      />,
    );

    expect(html).toContain(`<option value="${DEVICE_ID}">67937442 · ready</option>`);
  });
});
