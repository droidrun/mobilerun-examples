import { logoDataUri } from './client/brand';
import { DemoPanel } from './client/components/demo-panel';
import { PhoneFrame } from './client/components/phone-frame';
import { useDemo } from './client/use-demo';
import { brand } from './shared/brand';

const logoSrc = logoDataUri(brand);

export function App() {
  const { state, start, end, refreshStream, reset } = useDemo();

  return (
    <main className="shell">
      <header className="masthead">
        <img src={logoSrc} alt="" width="32" height="32" />
        <span>{brand.name}</span>
      </header>

      <section className="stage">
        <div className="copy">
          <DemoPanel state={state} onStart={start} onEnd={end} onReset={reset} />
        </div>
        <PhoneFrame state={state} logoSrc={logoSrc} onStreamHealed={refreshStream} />
      </section>
    </main>
  );
}
