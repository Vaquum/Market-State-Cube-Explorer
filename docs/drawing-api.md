# Manual drawing model and persistence API

`src/encoding.js` exports the frozen `E.drawings` namespace. Its schema1 collection is
`{schemaVersion:1,instrument:"binance:spot:BTCUSDT",visible,objects}`. Each object has
`{id,name,a:{timeMs,priceCents},b:{timeMs,priceCents},color,visible,locked,ordinal}`.
IDs are lowercase cryptographic UUIDv4; RGB is normalized to lowercase. Anchors use
integer UTC milliseconds (2009–2100 inclusive) and integer cents (0–1,000,000,000).
Whole-collection validation rejects foreign instruments, unknown fields/schemas,
coincident anchors, duplicate IDs/ordinals and more than200 objects without mutation.

| API | Contract |
| --- | --- |
| `empty()` | A new visible empty collection. |
| `normalizeCollection(raw)`, `normalizeObject(raw)` | Fresh validated values; invalid input throws a descriptive `RangeError`. Objects sort by ordinal. |
| `newObject(collection,{a,b,color,id?,name?,visible?,locked?})` | One new object, not an appended collection. Secure ID/default name and next ordinal;200-object limit. |
| `duplicate(collection,id)` | One new visible, unlocked object with copied endpoints/RGB and a bounded unique copy name. |
| `point(timeMs,priceUSDT)` | Quantize once to nearest millisecond/cent, ties upward; reject outside the domain. |
| `translate(object,deltaTimeMs,deltaPriceUSDT)` | Quantize one delta and preserve the anchor vector; reject locked or out-of-domain movement. |
| `parseTime(text)`, `parsePrice(text)` | Integer milliseconds/cents; exact UTC `YYYY-MM-DDTHH:mm:ss[.SSS]Z` and unsigned decimal with at most2 fractional digits. Invalid dates and extra precision reject. |
| `formatTime(ms)`, `formatPrice(cents)` | UTC milliseconds and a two-digit decimal. |
| `clip(a,b,{x,y,w,h})` | Screen-space clipped `{a:{x,y},b:{x,y}}`, or null. No work proportional to endpoint distance. |
| `distance({x,y},{a,b})` | Euclidean distance to the finite screen-space segment. |
| `createStore(initial?)` | Frozen store with immutable `state`, `revision`, `nextOrdinal`, `canUndo`, `canRedo`, `undoLabel`, `redoLabel`; `commit(label,next)` returns `{changed,truncated,state}`; `undo()`/`redo()` return booleans. |

The store retains at most100 before/after object deltas plus group visibility,
not pointermove snapshots. Commits and Undo/Redo increment revision; unchanged commits
and invalid input do not. A new commit clears Redo. High-water creation ordinals do
not rewind after delete/Undo within the store. Preview state belongs to the caller.
`E.drawings.LIMITS` and `INSTRUMENT` expose the fixed model bounds and identity.

`E.role.occlusion` additionally accepts `strokes:[{a:{x,y},b:{x,y},width}]` and
optional numeric `priority`. Stroke width is positive and at most4.5CSSpx. The planner
charges the viewport-clipped solid capsule plus existing glyph `rects`, once on its
shared2px grid. It scans narrow row strips, not diagonal bounding rectangles; refusal
can stop as soon as additional cells exceed the remaining budget. Priority precedes
inherited `hot`/`rank`; omitted priority is−1 for reserved ink. `hot` remains the
budget exemption flag. All-rectangle/zero-drawing behavior is unchanged.

Complete codes with drawings use top-level `drawings` and `visualVersion:3`, sealed
by the existing content ID, behind `origo-cube:3.` or `3j.`. Explicit empty collections
are required; missing/invalid drawing payloads and outer/inner version mismatches
reject whole. Older complete-code readers reject3; legacy/v2 codes remain readable.
Chart URLs and calibration state remain version2 and carry no drawings. The existing
1MiB decoded payload cap and hostile-input/integrity checks remain in force.

`src/state.js` exposes `explorerState.drawings.load()`, `save(collection,revision?)`,
`preserve(collection)` and `recover(id)`. Load/recover return a status envelope with
`collection`, `reason`, original `raw` and validated `recoveries`; save/preserve return
`{ok,id?,reason?}` without throwing. Missing/corrupt/unsupported originals remain
unapplied. Preservation writes a pinned immutable snapshot without replacing the tab
pointer. Callers must preserve a nonempty prior collection before accepting replacement.

Protected keys use the existing `market-state-cube-explorer:` prefix:
`drawings:v1:session` in sessionStorage, and immutable `drawings:v1:record:<UUID>` plus
`drawings:v1:index` in localStorage. Each document forks its writer before writing,
while reload/duplicated tabs load their inherited session pointer. The index is a
hint reconciled from actual records, not authority to erase raced snapshots. New
records/pointers verify before pruning only older own unpinned revisions; latest2
own revisions, pinned replacements and other writers' records remain. Failed writes
retain running work/prior pointers and require an explicit Unsaved/export/retry UI.

`namedViews()`, `namedViewsStatus()` and `saveNamedViews(list)` own the protected
`drawing-views:v1:pointer`/immutable `record:<UUID>` namespace. This registry accepts
valid legacy entries and complete sealed v3 entries in one ordered list. Each entry
requires finite `span,lead,tA,tB,cut,n,m`, a positive span, and boolean `live`/`auto`
when present. Legacy entries require their chart `hash`; v3 entries require their
complete `payload`, with no code/hash fallback. Invalid metadata or payload rejects
the whole list before publication or opening; unavailable status must be surfaced.

Before a protected pointer exists the app reads legitimate legacy `views:v1` entries.
The first save migrates the complete ordered list. Once the pointer exists it is the
sole named-list authority, including an empty list after deletion. New builds never
rewrite the old namespace; foreign legacy entries remain there verbatim. One verified
pointer update publishes save/rename/delete/Undo atomically; failed writes leave the
prior ordered list authoritative. Immutable prior records remain for rollback.
Last-read baselines preserve other tabs' concurrent additions and upgraded entries;
the caller retains given order, delete-Undo position and live-camera behavior.
Legacy writers cannot erase these protected namespaces. Geometry/transactions and
preservation are covered by `tests/unit/drawings.test.js` and
`tests/unit/drawing-storage.test.js`.
