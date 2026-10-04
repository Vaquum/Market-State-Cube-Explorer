# Navigation benchmark: candles-local-full

Verdict: **environment-inconclusive**

Measured on Apple M1 Max (10 cores, 64 GB), Darwin 25.6.0 arm64, Chromium 153.0.8010.12 (chromium-new-headless), viewport 1500x950, DPR 1, reduced motion reduce. Not a designated environment; not a precision certificate. The environment is inconclusive: the A/A mean-draw noise floor exceeds 0.2 ms in recorded-24h 0.428 ms, recorded-7d 0.490 ms, recorded-all 0.516 ms, recorded-old-week 0.580 ms, fake-live-24h 0.419 ms, fake-live-7d 0.360 ms, fake-live-all 0.417 ms, fake-live-old-week 0.376 ms. The A/B phases were not run.

## Environment

| what | value |
| --- | --- |
| created (UTC) | 2026-10-04T12:31:32.832Z |
| machine | Apple M1 Max, 10 cores, 64 GB, Darwin 25.6.0 arm64 |
| browser | Chromium 153.0.8010.12, chromium-new-headless |
| viewport / DPR | 1500x950 / 1, reduced motion reduce |
| timer resolution | 0.1000 ms |
| designated | no |
| CPU throttle | none |
| CI | false |
| data | bench, seed 20260924, cutoff 2026-09-24T12:02:00.000000Z, pack f60aae4c3e8c6cfd |
| config | tools/benchmark/navigation.v3.json sha256 650a8fece6fad8d0, seed 20260930 |

## Builds

| label | commit | index.html sha256 | vendor/d3.min.js sha256 |
| --- | --- | --- | --- |
| original | 8c82ca1f03d8 | 21c87648e35fde3b | f2094bbf6141b359 |
| preceding | a42face90982 | 2f2184c4f24c93a9 | f2094bbf6141b359 |
| candidate | 6b4cd29045fb | 408911775a61af06 | f2094bbf6141b359 |

Roles: original 8c82ca1, preceding a42face, candidate 6b4cd29.

## A/A noise floors (ms)

| case | mean draw | mean frame interval |
| --- | --- | --- |
| recorded-24h | 0.4279 | 0.1000 |
| recorded-7d | 0.4900 | 0.1000 |
| recorded-all | 0.5158 | 0.1000 |
| recorded-old-week | 0.5800 | 0.1000 |
| fake-live-24h | 0.4186 | 0.1000 |
| fake-live-7d | 0.3600 | 0.1000 |
| fake-live-all | 0.4171 | 0.1885 |
| fake-live-old-week | 0.3757 | 0.1000 |

Environment gate: inconclusive (limit 0.2 ms).

## Assumptions

- Paired trials: each pair is one trial of each arm of one case; the pair is the unit that is resampled.
- Percentile bootstrap of the mean paired difference, 10000 resamples, committed seed 20260930, Type-7 quantiles.
- Bonferroni over 16 comparisons (8 core cases x 2 metrics): two-sided level 0.999375, tail 0.0003125.
- The A/A noise floor comes from the original build only and is shared by every comparison.
- Screening without a signal is 'no regression detected at this resolution', not equality; an interval that spans the floor is 'inconclusive', not zero overhead.

## Limits

- B-L1: input-to-paint ends at the end of the page's draw callback; it excludes the compositor and the present latency of the display.
- B-L2: the browser coarsens timers; the measured timer resolution is recorded and is the lowest value an A/A floor can take.
- B-L3: a laptop or a shared runner is not the designated machine. A run on one is non-designated-environment evidence and cannot satisfy the operator's designated-machine requirement (O-01).
- B-L4: with 20 confirmation pairs a 99 % family-wise interval is wide; 'inconclusive' is a likely outcome and is reported as such, needing an explanation or the operator's decision (O-02).
- B-L5: headless shell and full Chrome differ; the mode is recorded and the operator's designated mode should match it.
- B-L6: the canvas bitmap is reallocated on every draw (geometry() assigns canvas.width) in both builds, so it sits inside every draw sample; the A/A floor may often exceed 0.2 ms on a laptop and 'environment-inconclusive' is a likely outcome.
- The fake cube serves synthetic trades; fake-live timing excludes network and server latency, the recorded cases measure only the page, and each build's fake keeps its server-side caches warm across the trials it serves.

