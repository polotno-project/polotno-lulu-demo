import React from 'react';
import { SectionTab } from 'polotno/side-panel';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from 'polotno/primitives';

// Lulu mode (?provider=lulu): export the cover as a PDF with bleed and have
// Lulu's Print API check it, through the demo backend that holds the Lulu
// keys. Lulu returns the cover size it expects and validates the file against
// the book's pod_package_id and page count. Nothing is printed.

const API = (import.meta.env.VITE_POD_API || 'http://localhost:8787').replace(/\/$/, '');

/** Inline styles: the published CSS only ships `pn:` utilities. */
const styles = {
  panel: { display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto', paddingBottom: 24 },
  label: { fontSize: 12, fontWeight: 500, opacity: 0.75 },
  spec: { fontSize: 13, margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12, lineHeight: 1.45, opacity: 0.65, margin: 0 },
  progress: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '10px 12px', background: '#f4f4f4' },
  error: { fontSize: 13, color: '#b42318', margin: 0 },
  dialog: { maxWidth: 760, width: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' },
  verdict: (ok) => ({
    padding: '12px 14px',
    fontSize: 14,
    fontWeight: 600,
    background: ok ? '#e8f5e9' : '#fdecea',
    color: ok ? '#1b5e20' : '#b42318',
  }),
  request: { marginTop: 18 },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    margin: '6px 0 0',
    padding: 12,
    background: '#f4f4f4',
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
};

const show = (value) =>
  JSON.stringify(value, (k, v) => (typeof v === 'string' && v.length > 100 ? `${v.slice(0, 60)}…` : v), 2);

function Result({ result, onClose }) {
  const ok = result.validation.status === 'NORMALIZED' && !result.validation.errors.length;
  const { width, height } = result.expected;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent style={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Back from Lulu</DialogTitle>
          <DialogDescription>
            Lulu&apos;s Print API (sandbox) checked the cover PDF this editor just exported. Nothing was printed.
          </DialogDescription>
        </DialogHeader>
        <div style={styles.verdict(ok)}>
          {ok
            ? `Lulu accepted the cover for ${result.pod_package_id}.`
            : `Lulu rejected the cover file.${result.validation.errors.length ? ` ${result.validation.errors.join('; ')}` : ''}`}
        </div>
        <p style={{ ...styles.spec, marginTop: 12 }}>
          Lulu expects a {Number(width).toFixed(3)} × {Number(height).toFixed(3)} in cover for this book, bleed
          included.
        </p>
        {result.requests.map((r) => (
          <div key={r.endpoint} style={styles.request}>
            <span style={styles.label}>{r.title}</span>
            <pre style={styles.code}>{`${r.endpoint}\n${show(r.body)}\n\n→ ${show(r.response)}`}</pre>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

export function luluSection(book) {
  const Panel = ({ store }) => {
    const [step, setStep] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [result, setResult] = React.useState(null);

    const check = async () => {
      setError(null);
      setStep('Exporting the cover PDF with bleed…');
      try {
        store.selectElements([]);
        const pdf = await store.toPDFDataURL({ includeBleed: true });
        setStep('Lulu is checking the file. This takes up to a minute…');
        const res = await fetch(`${API}/lulu/check-cover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdf, ...book }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Lulu request failed');
        setResult(json);
      } catch (e) {
        console.error('lulu check failed', e);
        setError(e?.message || 'Something went wrong');
      } finally {
        setStep(null);
      }
    };

    return (
      <div style={styles.panel}>
        <div>
          <span style={styles.label}>Book</span>
          <p style={styles.spec}>
            {book.trimWidth} × {book.trimHeight} in paperback, {book.pageCount} pages
            <br />
            {book.paperLabel}
          </p>
        </div>
        <Button onClick={step ? undefined : check} aria-busy={!!step}>
          {step ? 'Checking with Lulu…' : 'Check with Lulu'}
        </Button>
        {step && (
          <div role="status" style={styles.progress}>
            <Spinner />
            {step}
          </div>
        )}
        {error && <p style={styles.error}>{error}</p>}
        <p style={styles.hint}>
          Exports this cover as a PDF with bleed and sends it to Lulu&apos;s Print API, which checks it against the
          book&apos;s size, paper and page count.
        </p>
        {result && <Result result={result} onClose={() => setResult(null)} />}
      </div>
    );
  };

  return {
    name: 'lulu',
    Tab: (props) => (
      <SectionTab name="Lulu" {...props}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M4 3h9l3 3v11H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="m7 11 2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </SectionTab>
    ),
    Panel,
  };
}
