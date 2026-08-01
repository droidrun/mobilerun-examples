type SystemKey = 'BACK' | 'HOME' | 'RECENT';

type DeviceNavigationProps = {
  disabled: boolean;
  onAction: (key: SystemKey) => void;
};

const SYSTEM_ACTIONS = [
  {
    key: 'BACK',
    label: 'Back',
    path: 'M15 18l-6-6 6-6',
  },
  {
    key: 'HOME',
    label: 'Home',
    path: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  },
  {
    key: 'RECENT',
    label: 'Recent apps',
    path: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  },
] as const satisfies ReadonlyArray<{
  key: SystemKey;
  label: string;
  path: string;
}>;

export function DeviceNavigation({
  disabled,
  onAction,
}: DeviceNavigationProps) {
  return (
    <nav
      className={`device-navigation ${disabled ? '' : 'enabled'}`}
      aria-label="Android navigation"
    >
      {SYSTEM_ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          aria-label={action.label}
          title={disabled ? 'Enable manual control first' : action.label}
          disabled={disabled}
          onClick={() => onAction(action.key)}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill={action.key === 'BACK' ? 'none' : 'currentColor'}
            stroke="currentColor"
            strokeWidth={action.key === 'BACK' ? 2 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={action.path} />
          </svg>
        </button>
      ))}
    </nav>
  );
}
