import { DevicePanel } from './client/components/device-panel';
import { TaskBrief } from './client/components/task-brief';
import { useTaskRunner } from './client/use-task-runner';

export function App() {
  const { state, run, cancel, reset } = useTaskRunner();

  return (
    <main className="shell">
      <header className="masthead">
        <a className="wordmark" href="https://mobilerun.ai" aria-label="Mobilerun">
          <span className="wordmark-mark">M</span>
          <span>mobilerun</span>
        </a>
        <div className="masthead-meta">
          <span className="live-dot" aria-hidden="true" />
          SDK example / task runner
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">WATCH THE WORK HAPPEN</p>
          <h1>Run the task.<br /><em>See the device.</em></h1>
        </div>
        <p className="hero-copy">
          A server-side Mobilerun SDK call starts the task. The short-lived
          stream credentials go straight into <code>@mobilerun/react</code>.
          Your API key never reaches this page.
        </p>
      </section>

      <section className="workbench">
        <DevicePanel state={state} />
        <TaskBrief state={state} run={run} cancel={cancel} reset={reset} />
      </section>

      <footer>
        <span>Built with @mobilerun/sdk + @mobilerun/react</span>
        <a href="https://docs.mobilerun.ai">Read the documentation ↗</a>
      </footer>
    </main>
  );
}
