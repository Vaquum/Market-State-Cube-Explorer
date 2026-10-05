# Manual drawing model and persistence API

`src/encoding.js` exports the frozen `E.drawings` namespace. Its schema1 collection is
`{schemaVersion:1,instrument:"binance:spot:BTCUSDT",visible,objects}`. Each object has
`{id,name,a:{timeMs,priceCents},b:{timeMs,priceCents},color,visible,locked,ordinal,label?}`.
IDs are lowercase cryptographic UUIDv4; RGB is normalized to lowercase. Optional
labels are plain text: surrounding whitespace is trimmed, at most80 Unicode code
points are accepted, and controls/unpaired surrogates reject. Empty/missing labels
are omitted from normalized objects. Labels inherit line RGB; inventory names remain
independent. Anchors use integer UTC milliseconds (2009–2100 inclusive) and integer cents (0–1,000,000,000).
Whole-collection validation rejects foreign instruments, unknown fields/schemas,
coincident anchors, duplicate IDs/ordinals and more than200 objects without mutation.

| API | Contract |
| --- | --- |
| `empty()` | A new visible empty collection. |
| `normalizeCollection(raw)`, `normalizeObject(raw)` | Fresh validated values; invalid input throws a descriptive `RangeError`. Objects sort by ordinal. |
| `newObject(collection,{a,b,color,id?,name?,label?,visible?,locked?})` | One new object, not an appended collection. Secure ID/default name and next ordinal;200-object limit. |
| `duplicate(collection,id)` | One new visible, unlocked object with copied endpoints/RGB/label and a bounded unique copy name. |
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

Optional labels are an additive schema1/code3 field. Unlabeled object/code bytes stay
unchanged. Pre-label readers reject labeled collections/codes as unsupported; they
never silently drop text. Session, recovery and named-View snapshots preserve labels
through the existing whole-collection validation.

Complete codes with drawings use top-level `drawings` and `visualVersion:3`, sealed
by the existing content ID, behind `origo-cube:3.` or `3j.`. Explicit empty collections
are required; missing/invalid drawing payloads and outer/inner version mismatches
reject whole. Older complete-code readers reject3; legacy/v2 codes remain readable.
Chart URLs and calibration state remain version2 and carry no drawings. The existing
1MiB decoded payload cap and hostile-input/integrity checks remain in force.

`src/state.js` exposes `explorerState.drawings.load()`, `save(collection,revision?)`,
`preserve(collection)` and `recover(id)`. Load/recover return a status envelope with
`collection`, `reason`, original `raw` and validated `recoveries`; save/preserve return
`{ok,id?,expired?,reason?}` without throwing. Missing/corrupt/unsupported required data
is never applied. Preservation writes a prior-replacement recovery without changing
the current tab snapshot. Callers must preserve a nonempty prior collection before
accepting replacement. Recovery collections are immutable; normalize them before editing.

Protected keys use the existing `market-state-cube-explorer:` prefix. The complete
`drawings:v1:session` snapshot in sessionStorage now has
`{storageVersion:2,id,writer,revision,collection}` and is the current tab's authority.
Reload/duplicate tabs retain those exact collection bytes even after their old local
recovery expires or is corrupt. Each document forks its writer before writing. A v1
session pointer migrates to a verified complete snapshot when its valid record is
read; failed migration returns an explicit error and retains its original bytes.
Storage identities use `crypto.randomUUID()` or secure UUIDv4 `getRandomValues()`.

Local recovery records remain immutable `drawings:v1:record:<UUID>`; their version1
shape adds nonnegative integer `createdAt` (legacy absence reads as0). The index is
an advisory inventory reconciled from actual validated records. Successful saves
retain at most24 ordinary recoveries across documents, including the current writer's
latest2, plus the8 newest prior-replacement recoveries. Pinned means reserved from
ordinary pruning, not permanent archive. Older recoveries expire on successful writes;
use complete codes for permanent copies. Unknown/corrupt recovery originals are preserved. Before a new ordinary save replaces an
unreadable session, a verified byte-for-byte `drawings:v1:unreadable-session:<SHA256>`
copy preserves it; the digest hashes the JSON string so lone UTF16 units stay distinct,
deduplicates retries, and never overwrites conflicting or unreadable prior copies. Backup failure leaves the original
session authoritative and the new running work Unsaved.
The recovery validator caches at most64 immutable records and checks raw bytes before
reuse, so rewritten/corrupt data always revalidates. Failed writes retain the previous
complete tab snapshot and require explicit Unsaved/export/retry UI.

`namedViews()`, `namedViewsStatus()` and synchronous `saveNamedViews(list)` own
`drawing-views:v2:record:<UUID>`. This registry accepts valid legacy entries and complete
sealed v3 entries in one ordered list. Each entry requires finite
`span,lead,tA,tB,cut,n,m`, a positive span, and boolean `live`/`auto` when present.
Legacy entries require their chart `hash`; v3 entries require their complete `payload`,
with no code/hash fallback. Invalid required metadata or payload rejects the entire
registry before publication or opening; unavailable status must be surfaced.

`namedViews({snapshot:true})` returns one status/entries envelope and establishes the
private deletion baseline from exactly that snapshot. When protected storage is
absent, the snapshot includes validated legacy entries from the same read. The UI
uses this one operation; publication by another tab during or after it cannot change
the baseline independently of the displayed list. Default `namedViews()` returns
the same entries array, including validated legacy Views before first publication.
Both forms adopt a separate private copy as the deletion baseline.
`namedViewsStatus()` remains diagnostic and does not adopt a baseline. Failed
snapshot reads remain explicit and never fall back to legacy data. A failed
mutation read blocks saving until a successful `namedViews()` reread, even if storage
recovers meanwhile. Diagnostic reads neither set nor clear that guard; write failure
alone does not block an otherwise valid retry.

Each immutable version2 record is `{storageVersion:2,id,writer,clock,cells}`. A cell is
`{name,value,valueStamp:[clock,writer],position,orderStamp:[clock,writer]}`; null `value`
is a deletion marker containing no authored payload. The last-read private baseline
identifies the caller's changed/deleted names. Unchanged stale entries cannot resurrect
a deletion or downgrade an upgraded view. One verified record write atomically publishes
the caller's transaction; there is no shared v2 pointer. Readers merge independently
versioned cells across published records. Truly concurrent additions and edits to
different names survive; same-name conflicts choose the greater logical clock, then
lexicographically greater writer UUID. Position has its own version, preserving the
caller order and delete-Undo position without coupling unrelated payload edits.

Compaction removes a full record only when a retained complete snapshot dominates
every value and order version. Sequential use keeps at most2 full snapshots; concurrent
undominated branches remain until a subsequent merged save covers them. Small null
markers retain deletion causality for paused publishers; they grow with distinct
historically deleted names. Deleted full payloads and obsolete registry snapshots are
reclaimed. Expiring those markers without serialized publisher membership could revive
an old deleted name, so this synchronous API preserves them. If GC invalidates both
bounded read attempts, the read fails explicitly with a retry reason and applies no
legacy or empty fallback.

With no v2 publication, `drawing-views:v1:pointer` and its required v1 record remain
readable migration sources; if absent, the app reads legitimate `views:v1` entries.
The first save migrates the complete list. Once a v2 record exists, its merged registry
is sole authority, including an empty list after deletion. Successful migration prunes
obsolete validated v1 full snapshots while retaining the required v1 pointer record and
unreadable/foreign originals. New builds never rewrite legacy namespaces. Quota failure
before atomic publication changes no authoritative names. Legacy writers cannot erase
these protected namespaces. Geometry/transactions and preservation are covered by
`tests/unit/drawings.test.js`, `tests/unit/drawing-storage.test.js` and
`tests/unit/persistence-named-mutation.test.js`.
