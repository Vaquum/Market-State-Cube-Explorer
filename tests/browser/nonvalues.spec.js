"use strict";
// Oracle: the selected last day traded rows 200..205; row 210 traded only three days earlier.
// A disjoint canvas/selection must not create missing-reference or infinite values in a period's own profile.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");
test.use({ reducedMotion: "reduce" });
const stream = S.disjoint();

for (const period of ["1d", "all"]) {
  test(`${period}: disjoint visible data does not invent non-value background marks`, async ({ page, probe, fakeFor, surface }) => {
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    await page.goto(fake.url + "/" + S.address({ cols: stream.early, rows: [196, 214], rowsKind: "relvol", period, selection: { cols: stream.early, rows: [199, 212] }, extra: "&vis=2" }));
    await S.atRest(page, fake, probe);
    const details = await surface.details("rows");
    const counts = JSON.parse(details.fields.rowRelvolCounts.value);
    expect(counts.finite).toBe(period === "1d" ? 6 : 7);
    expect(counts.negativeInfinite).toBe(0);
    expect(counts.noReference).toBe(0);
    expect(counts.emptyBoth).toBe(period === "1d" ? 0 : 4);
    const keys = await surface.keys();
    for (const id of ["negative-infinite", "no-reference"]) expect(keys.find((k) => k.key === id)?.count ?? 0).toBe(0);
    const colours = await S.bandColours(page), frame = (await probe.frames()).at(-1);
    const bands = frame.styles.filter((s) => s.op === "fillRect" && s.alpha === colours.alpha);
    expect(bands.reduce((n, s) => n + s.count, 0)).toBe(period === "1d" ? 6 : 7);
  });
}
