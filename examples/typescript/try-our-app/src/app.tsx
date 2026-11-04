import { logoDataUri } from './client/brand';
import { DemoPanel } from './client/components/demo-panel';
import { PhoneFrame } from './client/components/phone-frame';
import { useBrand } from './client/use-brand';
import { useDemo } from './client/use-demo';

export function App() {
  const brand = useBrand();
  const { state, start, end, refreshStream, reset } = useDemo();

  if (!brand) return <main className="shell" aria-busy="true" />;

  const logoSrc = logoDataUri(brand);

  return (
    <main className="shell">
      <header className="masthead">
        <img src={logoSrc} alt="" width="32" height="32" />
        <span>{brand.name}</span>
      </header>

      <section className="stage">
        <div className="copy">
          <DemoPanel
            brand={brand}
            state={state}
            onStart={start}
            onEnd={end}
            onReset={reset}
          />
        </div>
        <PhoneFrame state={state} logoSrc={logoSrc} onStreamHealed={refreshStream} />
      </section>
    </main>
  );
}
