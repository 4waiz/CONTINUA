'use client';

/**
 * Full-frame caption cards for the demo video.
 *
 * These are rendered by the product itself, in the product's own type and
 * palette, from `public/video/cards.json` — which `scripts/build_video_cards.py`
 * extracts verbatim from the recorded runs and experiments. Nothing here
 * computes a result, and nothing here has a hard-coded number: if the extract
 * is missing a field the card renders `—` and the capture script refuses to
 * continue, because a blank on screen is the one failure this project cannot
 * ship.
 *
 * Laid out at a fixed 1920×1080 and scaled to fit, so a card looks identical
 * whatever the browser window happens to be. Type sizes are chosen for a
 * viewer watching at half size on a laptop, not for a desktop reader.
 */

import { useEffect, useState } from 'react';

type Cards = Record<string, CardData>;

interface CardData {
  id: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  [key: string]: unknown;
}

interface Row {
  label: string;
  baseline: number;
  continua: number;
  format: Format;
  better_is: 'lower' | 'higher';
  note?: string;
}

type Format = 'int' | 'seconds' | 'percent' | 'bytes' | 'units' | 'number' | 'ratio';

function fmt(value: number | null | undefined, format: Format): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (format) {
    case 'int':
      return String(Math.round(value));
    case 'seconds':
      return `${value.toFixed(2)} s`;
    case 'percent':
      return `${value.toFixed(1)} %`;
    case 'bytes':
      return `${(value / 1e6).toFixed(1)} MB`;
    case 'units':
      return value.toFixed(2);
    case 'ratio':
      return value.toFixed(3);
    default:
      return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  }
}

/** A win is green, a loss is amber. Losses are never hidden. */
function verdict(row: { baseline: number; continua: number; better_is: string }): 'win' | 'loss' | 'tie' {
  if (row.baseline === row.continua) return 'tie';
  const continuaWins =
    row.better_is === 'lower' ? row.continua < row.baseline : row.continua > row.baseline;
  return continuaWins ? 'win' : 'loss';
}

export function VideoCard({ cardId }: { cardId: string }) {
  const [cards, setCards] = useState<Cards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/video/cards.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: { cards: Cards }) => setCards(payload.cards))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const card = cards?.[cardId];
  const ready = Boolean(card);

  return (
    <div
      className="grid min-h-screen place-items-center bg-[color:var(--color-bg)]"
      data-capture-ready={ready ? 'true' : 'false'}
      data-card={cardId}
    >
      <div className="relative aspect-[16/9] w-full max-w-[1920px] overflow-hidden bg-[color:var(--color-bg)]">
        <div className="absolute inset-0 origin-top-left" style={{ width: 1920, height: 1080, transform: 'scale(var(--card-scale, 1))' }}>
          <CardScaler />
          {error ? (
            <div className="grid h-full place-items-center p-24 text-[28px] text-[color:var(--color-bad)]">
              video/cards.json unavailable ({error}). Run{' '}
              <code className="ml-2">python scripts/build_video_cards.py</code>
            </div>
          ) : !card ? (
            <div className="grid h-full place-items-center text-[24px] text-[color:var(--color-muted)]">
              loading evidence…
            </div>
          ) : (
            <Frame card={card}>
              {cardId === 'compare' ? <Compare card={card} /> : null}
              {cardId === 'ablation' ? <Ablation card={card} /> : null}
              {cardId === 'results' ? <Results card={card} /> : null}
              {cardId === 'scope' ? <Scope card={card} /> : null}
            </Frame>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Fits the fixed 1920×1080 layout into whatever viewport the capture browser
 * gives us. A CSS variable rather than a re-layout, so the design is pixel
 * identical at every capture size.
 */
function CardScaler() {
  useEffect(() => {
    const apply = () => {
      const parent = document.querySelector<HTMLElement>('[data-card]');
      if (!parent) return;
      const box = parent.getBoundingClientRect();
      const scale = Math.min(box.width / 1920, box.height / 1080);
      parent.style.setProperty('--card-scale', String(scale));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  return null;
}

function Frame({ card, children }: { card: CardData; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col px-[96px] py-[72px]">
      <header className="flex items-start justify-between">
        <div>
          {card.kicker ? (
            <div className="text-[17px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
              {card.kicker}
            </div>
          ) : null}
          <h1 className="mt-3 text-[58px] font-semibold leading-[1.05] tracking-[-0.03em]">{card.title}</h1>
          {card.subtitle ? (
            <p className="mt-3 max-w-[1280px] text-[22px] leading-[1.4] text-[color:var(--color-muted)]">
              {card.subtitle as string}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 rounded-[12px] border border-[color:var(--color-line-strong)] bg-white px-4 py-2 text-[15px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted)]">
          Simulation
        </div>
      </header>
      <div className="mt-9 min-h-0 flex-1">{children}</div>
    </div>
  );
}

/* --- compare ------------------------------------------------------------- */

function Compare({ card }: { card: CardData }) {
  const rows = card.rows as Row[];
  const against = card.against_us as Row[];
  const columns = card.columns as string[];

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid grid-cols-[1fr_320px_320px] items-end gap-x-8 border-b border-[color:var(--color-line-strong)] pb-3 text-[18px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
        <div />
        <div className="text-right">{columns[0]}</div>
        <div className="text-right text-[color:var(--color-blue)]">{columns[1]}</div>
      </div>

      {rows.map((row) => {
        const v = verdict(row);
        return (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_320px_320px] items-baseline gap-x-8 border-b border-[color:var(--color-line)] pb-4"
          >
            <div className="text-[26px]">{row.label}</div>
            <div className="metric text-right text-[34px] text-[color:var(--color-muted)]">
              {fmt(row.baseline, row.format)}
            </div>
            <div
              className="metric text-right text-[40px] font-semibold"
              style={{ color: v === 'win' ? 'var(--color-good)' : v === 'loss' ? 'var(--color-warn)' : 'inherit' }}
            >
              {fmt(row.continua, row.format)}
            </div>
          </div>
        );
      })}

      <div className="mt-auto grid grid-cols-[1fr_320px_320px] gap-x-8 rounded-[14px] border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/[0.07] px-6 py-4">
        <div className="col-span-3 mb-2 text-[16px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-warn)]">
          Where CONTINUA is worse
        </div>
        {against.map((row) => (
          <Fragmentish key={row.label} row={row} />
        ))}
      </div>

      <p className="text-[19px] leading-[1.4] text-[color:var(--color-muted)]">{card.footnote as string}</p>
    </div>
  );
}

function Fragmentish({ row }: { row: Row }) {
  return (
    <>
      <div className="text-[21px]">
        {row.label}
        {row.note ? <span className="ml-3 text-[17px] text-[color:var(--color-muted)]">— {row.note}</span> : null}
      </div>
      <div className="metric text-right text-[25px] text-[color:var(--color-muted)]">{fmt(row.baseline, row.format)}</div>
      <div className="metric text-right text-[25px] font-semibold text-[color:var(--color-warn)]">
        {fmt(row.continua, row.format)}
      </div>
    </>
  );
}

/* --- ablation ------------------------------------------------------------ */

interface Variant {
  label: string;
  note: string;
  interruption_s: number | null;
  cost_units: number | null;
  satellite_mb: number | null;
  congestion_control_miss_pct: number | null;
}

function Ablation({ card }: { card: CardData }) {
  const variants = card.variants as Variant[];
  const reading = card.reading as string[];
  const predictor = card.predictor as {
    kicker: string;
    rows: { label: string; heuristic: number | null; learned: number | null; format: Format }[];
    reading: string;
  };

  return (
    <div className="grid h-full grid-cols-[1.35fr_1fr] gap-10">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1.5fr_repeat(4,1fr)] gap-x-4 border-b border-[color:var(--color-line-strong)] pb-2 text-[14px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          <div />
          <div className="text-right">Interruption</div>
          <div className="text-right">Cost</div>
          <div className="text-right">Satellite</div>
          <div className="text-right">Miss % (cong.)</div>
        </div>
        {variants.map((variant, index) => (
          <div
            key={variant.label}
            className="grid grid-cols-[1.5fr_repeat(4,1fr)] items-baseline gap-x-4 border-b border-[color:var(--color-line)] pb-3"
            style={{ opacity: index === 0 ? 1 : 0.92 }}
          >
            <div>
              <div className={`text-[22px] ${index === 0 ? 'font-semibold text-[color:var(--color-blue)]' : ''}`}>
                {variant.label}
              </div>
              <div className="text-[15px] text-[color:var(--color-muted)]">{variant.note}</div>
            </div>
            <div className="metric text-right text-[24px]">{fmt(variant.interruption_s, 'seconds')}</div>
            <div className="metric text-right text-[24px]">{fmt(variant.cost_units, 'units')}</div>
            <div className="metric text-right text-[24px]">
              {variant.satellite_mb === null ? '—' : `${variant.satellite_mb.toFixed(1)} MB`}
            </div>
            <div className="metric text-right text-[24px]">
              {fmt(variant.congestion_control_miss_pct, 'percent')}
            </div>
          </div>
        ))}
        <ul className="mt-3 space-y-2.5">
          {reading.map((line) => (
            <li key={line} className="flex gap-3 text-[21px] leading-[1.35]">
              <span className="mt-[10px] h-[7px] w-[7px] shrink-0 rounded-full bg-[color:var(--color-violet)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-[16px] border border-[color:var(--color-line)] bg-white p-7">
        <div className="text-[15px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted)]">
          {predictor.kicker}
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-[color:var(--color-line-strong)] pb-2 text-[14px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          <div />
          <div className="w-[120px] text-right">Heuristic</div>
          <div className="w-[120px] text-right">Learned</div>
        </div>
        {predictor.rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 border-b border-[color:var(--color-line)] py-3"
          >
            <div className="text-[19px]">{row.label}</div>
            <div className="metric w-[120px] text-right text-[23px]">{fmt(row.heuristic, row.format)}</div>
            <div className="metric w-[120px] text-right text-[23px]">{fmt(row.learned, row.format)}</div>
          </div>
        ))}
        <p className="mt-5 text-[19px] leading-[1.4] text-[color:var(--color-muted)]">{predictor.reading}</p>
      </div>
    </div>
  );
}

/* --- results ------------------------------------------------------------- */

interface Cell {
  mean: number | null;
  ci: [number, number] | null;
}

interface ResultRow {
  label: string;
  format: Format;
  better_is: 'lower' | 'higher';
  wifi: Record<string, Cell | null>;
  congestion: Record<string, Cell | null>;
}

function Results({ card }: { card: CardData }) {
  const rows = card.rows as ResultRow[];
  const scenarios = card.scenarios as { key: 'wifi' | 'congestion'; label: string }[];
  const columns = card.columns as string[];
  const policies = ['B0', 'B2', 'P1'];

  return (
    <div className="flex h-full flex-col gap-7">
      <div className="grid flex-1 grid-cols-2 gap-10">
        {scenarios.map((scenario) => (
          <div key={scenario.key} className="flex flex-col">
            <div className="text-[24px] font-semibold">{scenario.label}</div>
            <div className="mt-3 grid grid-cols-[1.35fr_repeat(3,1fr)] gap-x-3 border-b border-[color:var(--color-line-strong)] pb-2 text-[13px] font-semibold uppercase tracking-[0.09em] text-[color:var(--color-muted)]">
              <div />
              {columns.map((column, index) => (
                <div key={column} className={`text-right ${index === 2 ? 'text-[color:var(--color-blue)]' : ''}`}>
                  {column}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[1.35fr_repeat(3,1fr)] items-baseline gap-x-3 border-b border-[color:var(--color-line)] py-[9px]"
              >
                <div className="text-[18px] leading-[1.25]">{row.label}</div>
                {policies.map((policy) => {
                  const cell = row[scenario.key][policy];
                  const best = policy === 'P1';
                  return (
                    <div key={policy} className="text-right">
                      <div
                        className={`metric text-[22px] ${best ? 'font-semibold text-[color:var(--color-blue)]' : ''}`}
                      >
                        {fmt(cell?.mean, row.format)}
                      </div>
                      {cell?.ci ? (
                        <div className="metric text-[13px] leading-tight text-[color:var(--color-muted)]">
                          [{cell.ci[0].toFixed(cell.ci[0] < 10 ? 2 : 1)}, {cell.ci[1].toFixed(cell.ci[1] < 10 ? 2 : 1)}]
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="rounded-[14px] border border-[color:var(--color-line)] bg-white px-7 py-5 text-[21px] leading-[1.4]">
        {card.honesty as string}
      </p>
    </div>
  );
}

/* --- scope --------------------------------------------------------------- */

function Scope({ card }: { card: CardData }) {
  const items = card.items as { head: string; body: string; source: string }[];
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid flex-1 grid-cols-2 gap-x-10 gap-y-6">
        {items.map((item) => (
          <div key={item.head} className="border-l-[3px] border-[color:var(--color-line-strong)] pl-6">
            <div className="text-[26px] font-semibold leading-[1.2]">{item.head}</div>
            <p className="mt-2 text-[20px] leading-[1.38] text-[color:var(--color-muted)]">{item.body}</p>
            <div className="mt-2 font-[family-name:var(--font-mono)] text-[14px] text-[color:var(--color-muted)]">
              {item.source}
            </div>
          </div>
        ))}
      </div>
      <p className="rounded-[14px] border border-[color:var(--color-blue)]/30 bg-[color:var(--color-blue)]/[0.06] px-7 py-5 text-[22px] leading-[1.35]">
        {card.next as string}
      </p>
    </div>
  );
}
