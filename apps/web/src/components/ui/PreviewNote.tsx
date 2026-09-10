/**
 * What the public deployment says about the one thing it cannot do.
 *
 * Every scenario in the catalogue was run against every policy by the real
 * engine and exported, so selecting a scenario and a policy here plays a real
 * run. What it cannot do is *compose* one: the override controls derive a
 * scenario spec nobody has ever executed, and inventing its outcome in the
 * browser is exactly the thing this project does not do.
 *
 * So those controls are hidden rather than shown broken, and this says why -
 * next to the point that matters, which is that the ten catalogue scenarios
 * already are the fault cases the overrides exist to approximate.
 */

export function PreviewNote() {
  return (
    <section
      className="rounded-[14px] border px-4 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-blue) 30%, transparent)',
        background: 'color-mix(in srgb, var(--color-blue) 6%, white)',
      }}
      role="note"
    >
      <p className="text-[13px] font-semibold leading-snug">
        Pick a scenario and a policy. Both play immediately.
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[color:var(--color-muted)]">
        Every combination below was executed by the CONTINUA engine and is replayed here exactly as
        recorded. Fault injection and workload overrides compose a scenario nobody has run, so they
        are not offered: the ten scenarios cover those cases directly, from a sudden Wi-Fi drop to
        the complete loss of every path.
      </p>
    </section>
  );
}
