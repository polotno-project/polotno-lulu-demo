import React from 'react';
import ReactDOM from 'react-dom/client';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { Toolbar } from 'polotno/toolbar/toolbar';
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import { Workspace } from 'polotno/canvas/workspace';
import { createStore } from 'polotno/model/store';

import { luluSection } from './lulu-section';

// A paperback cover wrap editor sized from the URL, so a cover calculator can
// open it at the exact size a printer expects. All values are inches:
//
//   ?tw=6&th=9&spine=0.4504&bleed=0.125&safe=0.125&stm=0.0625&printer=KDP
//
//   tw, th   trim width and height of one cover panel
//   spine    spine width
//   bleed    bleed on the outside edges
//   safe     keep text this far inside the trim and fold lines
//   stm      spine text margin; 0 means no spine text for this page count
//
// Add ?provider=lulu&pages=200&paper=bw-white and the side panel gets a Lulu
// section that sends the cover to Lulu's Print API for checking.
//
// The page is the trimmed wrap (back + spine + front) and the bleed uses
// Polotno's own page bleed, so a PDF export with bleed comes out at the full
// size. Fold lines and safe zones are a locked guide layer left out of export.

const DPI = 300;
const params = new URLSearchParams(window.location.search);
const num = (key, fallback) => {
  const value = parseFloat(params.get(key));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const trimW = num('tw', 6);
const trimH = num('th', 9);
const spine = num('spine', 0.5105);
const bleed = num('bleed', 0.125);
const safe = num('safe', 0.5);
const spineTextMargin = num('stm', 0.125);
const printer = (params.get('printer') || 'Lulu').slice(0, 20);

// Exact, not rounded: printers check the PDF size to a thousandth of an inch.
const px = (inches) => inches * DPI;
const W = px(2 * trimW + spine);
const H = px(trimH);
const back = { x: 0, w: px(trimW) };
const spineBand = { x: px(trimW), w: px(spine) };
const front = { x: px(trimW + spine), w: px(trimW) };

// Polotno SDK needs an API key: a trial key from https://polotno.com/cabinet
// works for trying this; production use needs a paid license.
const store = createStore({ key: import.meta.env.VITE_POLOTNO_KEY, showCredit: false });
window.store = store;

store.setUnit({ unit: 'in', dpi: DPI });
store.setSize(W, H);
const page = store.addPage({ bleed: px(bleed) });
store.toggleBleed(true);

/** Fold lines, safe zones and panel labels as one SVG over the whole page. */
function guideSvg() {
  const s = px(safe);
  const m = px(spineTextMargin);
  const zone = (x, w) =>
    `<rect x="${x + s}" y="${s}" width="${Math.max(w - 2 * s, 0)}" height="${H - 2 * s}" fill="none" stroke="#16a34a" stroke-width="4" stroke-dasharray="24 18"/>`;
  const label = (x, w, text) =>
    `<text x="${x + w / 2}" y="${H - s - 40}" text-anchor="middle" font-family="sans-serif" font-size="56" fill="#9ca3af">${text}</text>`;
  const spineZone =
    m > 0
      ? `<rect x="${spineBand.x + m}" y="${s}" width="${Math.max(spineBand.w - 2 * m, 0)}" height="${H - 2 * s}" fill="none" stroke="#16a34a" stroke-width="3" stroke-dasharray="16 12"/>`
      : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    ${zone(back.x, back.w)}${zone(front.x, front.w)}${spineZone}
    <line x1="${spineBand.x}" y1="0" x2="${spineBand.x}" y2="${H}" stroke="#ef4444" stroke-width="4" stroke-dasharray="30 20"/>
    <line x1="${front.x}" y1="0" x2="${front.x}" y2="${H}" stroke="#ef4444" stroke-width="4" stroke-dasharray="30 20"/>
    ${label(back.x, back.w, 'BACK COVER')}${label(front.x, front.w, 'FRONT COVER')}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

page.addElement({
  type: 'image',
  name: 'cover-guides',
  src: guideSvg(),
  x: 0,
  y: 0,
  width: W,
  height: H,
  selectable: false,
  alwaysOnTop: true,
  showInExport: false,
});

// A starter design: background into the bleed, title and author on the front,
// a blurb on the back, and the title on the spine when it is thick enough.
page.set({ background: '#1f2a44' });
const s = px(safe) + 60;
page.addElement({
  type: 'text',
  text: 'YOUR BOOK TITLE',
  x: front.x + s,
  y: px(trimH * 0.28),
  width: front.w - 2 * s,
  fontSize: Math.round(front.w / 8),
  fontFamily: 'Oswald',
  fill: '#ffffff',
  align: 'center',
});
page.addElement({
  type: 'text',
  text: 'Author Name',
  x: front.x + s,
  y: px(trimH * 0.78),
  width: front.w - 2 * s,
  fontSize: Math.round(front.w / 16),
  fontFamily: 'Roboto',
  fill: '#cbd5e1',
  align: 'center',
});
page.addElement({
  type: 'text',
  text: 'A short description of the book goes here. Keep it inside the dashed green safe zone so the trim never cuts it.',
  x: back.x + s,
  y: px(trimH * 0.2),
  width: back.w - 2 * s,
  fontSize: Math.round(back.w / 22),
  fontFamily: 'Roboto',
  fill: '#e2e8f0',
  align: 'left',
  lineHeight: 1.4,
});
if (spineTextMargin > 0 && spineBand.w > 90) {
  const fontSize = Math.round(Math.min(spineBand.w * 0.5, 72));
  page.addElement({
    type: 'text',
    text: 'YOUR BOOK TITLE',
    x: spineBand.x + spineBand.w / 2 + fontSize / 2,
    y: px(safe) + 120,
    width: H - 2 * px(safe) - 240,
    fontSize,
    fontFamily: 'Oswald',
    fill: '#ffffff',
    align: 'center',
    rotation: 90,
  });
}
store.selectElements([]);

const LULU_PAPER_LABELS = {
  'bw-white': '60# white, black & white',
  'bw-cream': '60# cream, black & white',
  color: '80# coated white, color',
};
// Only what a cover needs: no generic templates, no resize (the printer sets
// the size), no drawing.
const COVER_SECTIONS = DEFAULT_SECTIONS.filter((s) =>
  ['text', 'photos', 'elements', 'upload', 'background', 'layers'].includes(s.name)
);
const isLulu = true;
const paper = LULU_PAPER_LABELS[params.get('paper')] ? params.get('paper') : 'bw-white';
const sections = isLulu
  ? [
      luluSection({
        trimWidth: trimW,
        trimHeight: trimH,
        pageCount: Math.round(num('pages', 200)),
        paper,
        paperLabel: LULU_PAPER_LABELS[paper],
      }),
      ...COVER_SECTIONS,
    ]
  : COVER_SECTIONS;

const App = () => (
  <PolotnoContainer style={{ width: '100vw', height: '100vh' }}>
    <SidePanelWrap>
      <SidePanel store={store} sections={sections} defaultSection={isLulu ? 'lulu' : ''} />
    </SidePanelWrap>
    <WorkspaceWrap>
      <Toolbar store={store} downloadButtonEnabled />
      <Workspace store={store} />
      <ZoomButtons store={store} />
    </WorkspaceWrap>
  </PolotnoContainer>
);

if (printer) document.title = `${printer} cover editor – Polotno`;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
