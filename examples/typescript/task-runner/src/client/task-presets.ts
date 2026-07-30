export const TASK_PRESETS = [
  {
    id: 'device',
    eyebrow: '01 / DEVICE',
    title: 'System profile',
    task:
      'Open the device settings and report the device model and Android version. Finish with a concise structured summary.',
  },
  {
    id: 'smoke',
    eyebrow: '02 / APP',
    title: 'Settings smoke test',
    task:
      'Open the Settings app, navigate to the main system information screen, and confirm that it loads without an error.',
  },
  {
    id: 'custom',
    eyebrow: '03 / CUSTOM',
    title: 'Blank canvas',
    task: '',
  },
] as const;

export type TaskPreset = (typeof TASK_PRESETS)[number];
