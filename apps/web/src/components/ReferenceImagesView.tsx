'use client';

/**
 * The ATP 2026 EDGE supporting materials, as a browsable page.
 *
 * Two design decisions worth stating.
 *
 * **This page scrolls.** Every other page in the application is one fixed
 * viewport, because an operator watching a run must not have to scroll past the
 * thing that just changed. A gallery is the opposite: it is a document, its
 * length is its content, and pinning it to one screen would mean either ten
 * postage stamps or a carousel that hides nine of them.
 *
 * **Two of the slides are marked superseded.** Slides 8 and 9 report results
 * that were produced before the engine existed, and they disagree with the
 * measured experiments now in this repository - the satellite-share figure even
 * has the ordering the wrong way round. They are still shown, because deleting
 * inconvenient history is its own kind of dishonesty, but each one carries a
 * note and a link to the measured result. Where the two disagree, the
 * measurement wins.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandHeader } from './AppShell';

interface Slide {
  slide: number;
  title: string;
  summary: string;
  superseded: boolean;
  full: string;
  thumb: string;
  width: number;
  height: number;
}

interface Manifest {
  set: string;
  team: string;
  count: number;
  note: string;
  slides: Slide[];
}

export function ReferenceImagesView() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Slide | null>(null);

  useEffect(() => {
    fetch('/reference/manifest.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(setManifest)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  // Escape closes the lightbox; without it the only way out is the button,
  // which is a poor experience on a full-screen overlay.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    // Not `.app-shell`: this page is a document and is allowed to scroll.
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-6 py-5">
      <BrandHeader />

      <header className="max-w-[860px]">
        <h2 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">
          Supporting materials
        </h2>
        <p className="mt-1.5 text-[15px] text-[color:var(--color-muted)]">
          Ten engineering sheets from the ATP 2026 EDGE proposal.
        </p>
      </header>

      {/* One line. The detail sits on the two slides it actually concerns. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px]">
        <span
          className="cursor-help rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: '#9a6606', background: 'color-mix(in srgb, var(--color-warn) 13%, white)' }}
          title="Drawn while the design was being worked out, before the engine produced any measurements."
        >
          Preliminary
        </span>
        <span className="text-[color:var(--color-muted)]">
          Two sheets report results the measured experiments now supersede.
        </span>
        <Link href="/experiments" className="font-semibold text-[color:var(--color-blue)]">
          Measured results →
        </Link>
      </div>

      {error && (
        <p className="text-[13.5px] text-[color:var(--color-bad)]">
          Could not load the image manifest ({error}). Run{' '}
          <code className="font-[family-name:var(--font-mono)]">node scripts/build-reference-images.mjs</code>.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {(manifest?.slides ?? []).map((slide) => (
          <figure key={slide.slide} className="card flex flex-col overflow-hidden">
            <button
              type="button"
              onClick={() => setLightbox(slide)}
              className="group relative block w-full cursor-zoom-in overflow-hidden bg-[color:var(--color-surface-muted)]"
              aria-label={`Open ${slide.title} full size`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static
                  export has no image optimiser, and these are pre-sized WebP. */}
              <img
                src={slide.thumb}
                alt={`Supporting material ${slide.slide} of 10 - ${slide.title}`}
                width={slide.width}
                height={slide.height}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full transition-transform duration-300 group-hover:scale-[1.015]"
              />
            </button>

            <figcaption className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="metric text-[11px] font-bold tracking-[0.08em] text-[color:var(--color-faint)]">
                  {String(slide.slide).padStart(2, '0')} / 10
                </span>
                {slide.superseded && (
                  <span
                    className="cursor-help rounded-full px-2 py-[2px] text-[11px] font-semibold uppercase tracking-[0.06em]"
                    style={{
                      color: '#9a6606',
                      background: 'color-mix(in srgb, var(--color-warn) 14%, white)',
                    }}
                    title="Figures on this sheet predate the engine and disagree with the measured experiments. See the Experiments page."
                  >
                    Superseded
                  </span>
                )}
              </div>
              <h3 className="text-[16px] font-semibold leading-tight">{slide.title}</h3>
              <p className="text-[13px] leading-relaxed text-[color:var(--color-muted)]">
                {slide.summary}
              </p>

            </figcaption>
          </figure>
        ))}
      </div>

      <footer className="border-t border-[color:var(--color-line)] pt-4 text-[12.5px] text-[color:var(--color-muted)]">
        <Link href="/" className="font-semibold text-[color:var(--color-blue)]">
          ← Mission dashboard
        </Link>
      </footer>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title}
          className="fixed inset-0 z-50 flex flex-col bg-[rgba(17,29,58,0.82)] p-4 backdrop-blur-sm md:p-8"
          onClick={() => setLightbox(null)}
        >
          <div className="mb-3 flex shrink-0 items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] opacity-70">
                Supporting material {lightbox.slide} of 10
              </p>
              <h3 className="truncate text-[18px] font-semibold">{lightbox.title}</h3>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[11px] border border-white/25 px-3.5 py-1.5 text-[13.5px] font-semibold text-white hover:bg-white/10"
              onClick={(event) => {
                event.stopPropagation();
                setLightbox(null);
              }}
            >
              Close ✕
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img
            src={lightbox.full}
            alt={`Supporting material ${lightbox.slide} of 10 - ${lightbox.title}`}
            className="min-h-0 flex-1 rounded-[12px] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
