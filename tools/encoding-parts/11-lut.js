  // @part 11-lut
  // @requires 01-util 02-hash 03-result
  // @prefix lut
  // @provides lut
  // == §11 lut: appearances, the 256-entry colour tables, the D11 screens and the colour arithmetic (API.md C.6, A.1) ==
  // Everything a colour on the page comes from. An APPEARANCE is a named set of stops per theme; `build`
  // turns it into one 256-entry table per role (unsigned, positive, negative, rows) plus the single-colour
  // roles, all as 8-bit sRGB, so what the legend shows and what the canvas paints are the same bytes. The
  // Lab arithmetic is written here (DR-02) and follows the d3-color convention exactly (D50 white,
  // Bradford-adapted matrices, `cbrt` with the linear toe), so that d3.lab and d3.interpolateLab can serve
  // as independent test oracles without d3 ever being loaded by the module.
  // The appearance id is the first 8 hex of the SHA-256 of the LUT bytes (DD-42): change one byte of one
  // entry and the id changes, so a shared link can say which palette it was made with.

  // d3-color's Lab constants (API.md C.6, DD-13): D50 reference white and the D65-to-D50 adapted matrices.
  const lutXn = 0.96422;
  const lutYn = 1;
  const lutZn = 0.82521;
  const lutT0 = 4 / 29;
  const lutT1 = 6 / 29;
  const lutT2 = 3 * lutT1 * lutT1;
  const lutT3 = lutT1 * lutT1 * lutT1;
  // The unsigned constant-bar colour is entry 160 (t = 0.627): the first entry whose 0.65-opacity composite
  // reaches the 3:1 boundary rule in the light theme (DD-87; the earlier entry 153 composited to 2.94).
  const lutBarIndex = 160;
  const lutRowsAlpha = 0.16;
  const lutDefault = "slate2";
  const lutEntries = 256;

  // The source constants of the two appearances (API.md Appendix A.1). Nine equally spaced stops per theme,
  // interpolated linearly in Lab. `rows` are the pre-composite stops of the Rows-band role (DD-86): the
  // bands are painted at a fixed 16% alpha, so their raw colours must be much stronger than the unsigned
  // ramp for the COMPOSITE to pass the same screens. `ramp1` has no rows stops of its own (its rows ramp is
  // its unsigned ramp and it makes no band claim): it is the baseline yellow-green-blue ramp, kept only as
  // the named comparison appearance for #48. The role hexes are the baseline buy/sell/neutral/border/muted
  // colours renamed by role (DR-02, DR-20); a unit test asserts they equal the CSS tokens.
  const lutRoleColours = {
    light: { midpoint: "#b9c2bc", positive: "#2d769c", negative: "#b3624b", occupancy: "#768d7e", stateInk: "#5c7263", surface: "#ffffff" },
    dark: { midpoint: "#5f6b64", positive: "#73b8d4", negative: "#d89777", occupancy: "#667f6f", stateInk: "#a1b5a7", surface: "#161f19" },
  };
  const lutAppearances = {
    slate2: {
      name: "slate2",
      version: 2,
      unsigned: {
        light: ["#e2e8ee", "#c9d3dd", "#a8b8c8", "#8299b0", "#5f7a95", "#435b76", "#2c4059", "#1a2b40", "#0e1a2b"],
        dark: ["#26313a", "#364552", "#495d70", "#5f7a90", "#7897af", "#96b2c8", "#b4cadb", "#d3e2ee", "#f1f6fa"],
      },
      rows: {
        light: ["#56636f", "#465868", "#384d63", "#2c4360", "#22395a", "#1a3053", "#13284b", "#0c2042", "#071739"],
        dark: ["#6f8394", "#8397a8", "#98abbc", "#adbfce", "#c0d0dd", "#d0dde8", "#dfe8f0", "#ecf2f7", "#f7fafc"],
      },
      roles: lutRoleColours,
    },
    ramp1: {
      name: "ramp1",
      version: 1,
      unsigned: {
        light: ["#f2f9c4", "#d6efb3", "#a9dcb6", "#73c6bd", "#41b0c3", "#2390bd", "#2a6aac", "#283f94", "#15205e"],
        dark: ["#1b2c33", "#18405a", "#1a5b7d", "#1f7896", "#2c969c", "#4db493", "#86cd83", "#c6e27c", "#f4f1a6"],
      },
      rows: null,
      roles: lutRoleColours,
    },
  };

  function lutFreezeDeep(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) lutFreezeDeep(value[key]);
    }
    return value;
  }
  lutFreezeDeep(lutAppearances);

  // ---- sRGB <-> Lab (API.md C.6; d3-color convention) ----

  function lutToLinear(v) {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  function lutFromLinear(v) {
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }
  function lutF(t) {
    return t > lutT3 ? Math.cbrt(t) : t / lutT2 + lutT0;
  }
  function lutFInverse(t) {
    return t > lutT1 ? t * t * t : lutT2 * (t - lutT0);
  }

  // E.lut.rgbToLab (API.md A.3): [L, a, b] of an 8-bit sRGB colour. A grey (r === g === b) takes the exact
  // shortcut X = Z = Y that d3-color takes, so a grey has a and b of exactly 0 instead of rounding noise.
  function lutRgbToLab(r, g, b) {
    const lr = lutToLinear(r);
    const lg = lutToLinear(g);
    const lb = lutToLinear(b);
    const y = lutF((0.2225045 * lr + 0.7168786 * lg + 0.0606169 * lb) / lutYn);
    let x;
    let z;
    if (lr === lg && lg === lb) {
      x = y;
      z = y;
    } else {
      x = lutF((0.4360747 * lr + 0.3850649 * lg + 0.1430804 * lb) / lutXn);
      z = lutF((0.0139322 * lr + 0.0971045 * lg + 0.7141733 * lb) / lutZn);
    }
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // E.lut.labToRgb (API.md A.3): the inverse, as UNCLAMPED floating channels in 0..255 scale. Clamping and
  // rounding belong to the ramp builder, which must know when a channel left the gamut (`clipped`).
  function lutLabToRgb(L, a, b) {
    const y = (L + 16) / 116;
    const x = y + a / 500;
    const z = y - b / 200;
    const X = lutXn * lutFInverse(x);
    const Y = lutYn * lutFInverse(y);
    const Z = lutZn * lutFInverse(z);
    return [
      lutFromLinear(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z),
      lutFromLinear(-0.9787684 * X + 1.9161415 * Y + 0.033454 * Z),
      lutFromLinear(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z),
    ];
  }

  // E.lut.deltaE2000 (API.md A.3): CIEDE2000 (Sharma, Wu and Dalal 2005) between two [L, a, b] colours.
  // Written with the paper's own step names so that each line can be checked against it; the cases the
  // paper singles out (a zero chroma, a hue difference across the 0/360 seam) are the branches below.
  function lutDeltaE2000(lab1, lab2) {
    const rad = Math.PI / 180;
    const L1 = lab1[0];
    const a1 = lab1[1];
    const b1 = lab1[2];
    const L2 = lab2[0];
    const a2 = lab2[1];
    const b2 = lab2[2];
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar7 = Math.pow((C1 + C2) / 2, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) / rad + 360) % 360;
    const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) / rad + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const Sc = 1 + 0.045 * Cbp;
    const Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    const tl = dLp / Sl;
    const tc = dCp / Sc;
    const th = dHp / Sh;
    return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
  }

  // ---- WCAG contrast and compositing (API.md A.3) ----

  function lutLuminance(rgb) {
    return 0.2126 * lutToLinear(rgb[0]) + 0.7152 * lutToLinear(rgb[1]) + 0.0722 * lutToLinear(rgb[2]);
  }

  // E.lut.contrast: the WCAG 2.x contrast ratio (L1 + 0.05) / (L2 + 0.05), lighter over darker, 1 to 21.
  function lutContrast(fgRgb, bgRgb) {
    const a = lutLuminance(fgRgb);
    const b = lutLuminance(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  // E.lut.over: source-over of fg at `alpha` on an opaque bg, rounded to 8 bit the way a canvas does (one
  // channel value of difference is the tolerance the pixel tests allow, INTEGRATION.md D.5).
  function lutOver(fgRgb, alpha, bgRgb) {
    return [
      Math.round(fgRgb[0] * alpha + bgRgb[0] * (1 - alpha)),
      Math.round(fgRgb[1] * alpha + bgRgb[1] * (1 - alpha)),
      Math.round(fgRgb[2] * alpha + bgRgb[2] * (1 - alpha)),
    ];
  }

  // E.lut.parseColor: what getComputedStyle yields for the tokens: "rgb(r, g, b)" (also the space
  // separated form, and rgba with an alpha of 1) and "#rrggbb" / "#rgb". Anything else (a colour with
  // transparency, a named or functional colour) is null: the caller must not guess a backdrop.
  function lutParseColor(css) {
    if (typeof css !== "string") return null;
    const s = css.trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
    if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
    m = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/.exec(s);
    if (!m) return null;
    if (m[4] !== undefined && !(m[4] === "1" || m[4] === "1.0" || m[4] === "100%")) return null;
    const rgb = [+m[1], +m[2], +m[3]];
    return rgb.some((v) => v > 255) ? null : rgb;
  }

  // E.lut.themeOf (API.md A.3): the theme a surface colour belongs to, from its Lab lightness (the rule of
  // baseline line 4130).
  function lutThemeOf(surfaceRgb) {
    return lutRgbToLab(surfaceRgb[0], surfaceRgb[1], surfaceRgb[2])[0] < 50 ? "dark" : "light";
  }

  // ---- ramps ----

  function lutHexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function lutRgbToHex(rgb) {
    return "#" + API.hash.hex(Uint8Array.from(rgb));
  }

  // The 256 entries of a piecewise-Lab ramp through `stops` (hex strings, equally spaced). Entry i sits at
  // position i/255 of the whole ramp, so the first entry IS the first stop and the last IS the last. Each
  // channel is clamped to 0..255 and rounded; a channel that had to be clamped by more than half a step
  // counts as a gamut clip, which the screens refuse (a clipped colour is not the colour the Lab path
  // asked for). Returns the raw bytes and the CSS strings; `state.clipped` accumulates the clip count.
  function lutRamp(stops, state) {
    const labs = stops.map((s) => {
      const c = lutHexToRgb(s);
      return lutRgbToLab(c[0], c[1], c[2]);
    });
    const rgb = new Uint8Array(lutEntries * 3);
    const css = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) {
      const x = (i / (lutEntries - 1)) * (labs.length - 1);
      const j = Math.min(labs.length - 2, Math.floor(x));
      const f = x - j;
      const p = labs[j];
      const q = labs[j + 1];
      const raw = lutLabToRgb(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f);
      for (let c = 0; c < 3; c++) {
        if (raw[c] < -0.5 || raw[c] > 255.5) state.clipped++;
        rgb[i * 3 + c] = Math.round(Math.max(0, Math.min(255, raw[c])));
      }
      css[i] = "#" + API.hash.hex(rgb.subarray(i * 3, i * 3 + 3));
    }
    Object.freeze(css);
    return { css, rgb };
  }

  function lutSingle(hex) {
    const rgb = lutHexToRgb(hex);
    return { css: lutRgbToHex(rgb), rgb };
  }

  // The appearance a caller named: a name of APPEARANCES, or (for the perturbation tests and for a future
  // custom palette) a definition object of the same shape. Anything else is a caller bug, said loudly.
  function lutResolve(appearance) {
    if (typeof appearance === "string") {
      if (!Object.prototype.hasOwnProperty.call(lutAppearances, appearance)) throw new RangeError("E.lut: unknown appearance " + JSON.stringify(appearance));
      return lutAppearances[appearance];
    }
    if (appearance !== null && typeof appearance === "object" && typeof appearance.name === "string" && appearance.unsigned && appearance.roles) return appearance;
    throw new TypeError("E.lut: an appearance is a name or a definition {name, unsigned, rows, roles}");
  }

  // The tables of one theme of one appearance, before hashing.
  function lutThemeTables(app, theme, state) {
    if (theme !== "light" && theme !== "dark") throw new RangeError("E.lut: theme is \"light\" or \"dark\"");
    const roles = app.roles[theme];
    const unsigned = lutRamp(app.unsigned[theme], state);
    const positive = lutRamp([roles.midpoint, roles.positive], state);
    const negative = lutRamp([roles.midpoint, roles.negative], state);
    // An appearance without rows stops (ramp1) shares its unsigned ramp: the same object, so `screens` can
    // tell that no band claim is made and the clip count is not doubled.
    const rows = app.rows ? lutRamp(app.rows[theme], state) : unsigned;
    return { unsigned, positive, negative, rows, roles };
  }

  // The LUT byte hash (API.md C.6, DD-42, DD-86): for the light then the dark theme the three ramps and the
  // three single colours (4626 bytes, the part whose own hashes the design reproduced independently), then
  // the two rows ramps (1536 bytes). A different Lab arithmetic, rounding or byte order changes it.
  function lutHashOf(app) {
    const state = { clipped: 0 };
    const bytes = new Uint8Array(6162);
    let at = 0;
    const themes = ["light", "dark"];
    const tables = themes.map((t) => lutThemeTables(app, t, state));
    for (let k = 0; k < 2; k++) {
      const t = tables[k];
      for (const ramp of [t.unsigned, t.positive, t.negative]) {
        bytes.set(ramp.rgb, at);
        at += ramp.rgb.length;
      }
      for (const key of ["midpoint", "occupancy", "stateInk"]) {
        bytes.set(lutHexToRgb(t.roles[key]), at);
        at += 3;
      }
    }
    for (let k = 0; k < 2; k++) {
      const rows = tables[k].rows;
      // ramp1's rows ramp is its unsigned ramp: the extension still carries its 768 bytes so the layout is
      // the same for every appearance.
      bytes.set(rows.rgb, at);
      at += rows.rgb.length;
    }
    return API.hash.hex(API.hash.sha256(bytes.subarray(0, at)));
  }

  // E.lut.appearanceId (API.md A.3, DD-42): "slate2-8f7890f7". Theme independent (the hash covers both).
  function lutAppearanceId(appearance) {
    const app = lutResolve(appearance);
    return app.name + "-" + lutHashOf(app).slice(0, 8);
  }

  // E.lut.build (API.md A.3, C.6): the Lut of one appearance in one theme. Holds no cache (DD-02): the page
  // caches by appearance id and theme. `clipped` counts the gamut-clipped channels of THIS theme's tables.
  function lutBuild(appearance, theme) {
    const app = lutResolve(appearance);
    const state = { clipped: 0 };
    const t = lutThemeTables(app, theme, state);
    const hash = lutHashOf(app);
    const midpoint = lutSingle(t.roles.midpoint);
    const occupancy = lutSingle(t.roles.occupancy);
    const stateInk = lutSingle(t.roles.stateInk);
    const bar = { css: t.unsigned.css[lutBarIndex], rgb: Array.from(t.unsigned.rgb.subarray(lutBarIndex * 3, lutBarIndex * 3 + 3)) };
    return Object.freeze({
      id: app.name + "-" + hash.slice(0, 8),
      name: app.name,
      theme,
      unsigned: t.unsigned,
      positive: t.positive,
      negative: t.negative,
      rows: t.rows,
      midpoint,
      occupancy,
      stateInk,
      zeroInk: occupancy,
      bar,
      clipped: state.clipped,
      hash,
    });
  }

  // The ramp a composite is made of: a Lut object (used as is), an appearance name or definition (built in
  // the theme of the surface), or nothing (the default appearance). Passing the Lut avoids a rebuild.
  function lutSource(source, surfaceRgb) {
    if (source !== null && typeof source === "object" && source.unsigned && source.unsigned.rgb && source.hash) return source;
    return lutBuild(source === null || source === undefined ? lutDefault : source, lutThemeOf(surfaceRgb));
  }

  // E.lut.composite (API.md A.3, DD-86): a role's 256 entries composited at `alpha` over the surface, the
  // colours the LEGEND shows for a translucent role (Rows: `composite("rows", ROWS_ALPHA, surface)`; the
  // signed arms for Rows Delta and Relative volume). The canvas paints the RAW colour at globalAlpha, and the
  // pixel test allows one channel value between the two roundings. `source` is optional (a Lut or an
  // appearance); the surface decides the theme.
  function lutComposite(role, alpha, surfaceRgb, source = null) {
    const lut = lutSource(source, surfaceRgb);
    if (role !== "unsigned" && role !== "positive" && role !== "negative" && role !== "rows") throw new RangeError("E.lut.composite: role is unsigned, positive, negative or rows");
    const ramp = lut[role];
    const rgb = new Uint8Array(lutEntries * 3);
    const css = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) {
      const c = lutOver([ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]], alpha, surfaceRgb);
      rgb[i * 3] = c[0];
      rgb[i * 3 + 1] = c[1];
      rgb[i * 3 + 2] = c[2];
      css[i] = lutRgbToHex(c);
    }
    return { css, rgb };
  }

  // ---- the D11 screens (API.md C.6) ----

  function lutEntryLabs(ramp) {
    const labs = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) labs[i] = lutRgbToLab(ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]);
    return labs;
  }

  // The unsigned-style screen of a ramp of Lab entries against the surface: idx 0 far enough from the
  // surface, adjacent entries close enough to read as a continuum, lightness moving one way (drawdown from
  // the running best, so plateaus are allowed but a reversal is not).
  function lutScreenRamp(labs, surfaceLab) {
    const dir = Math.sign(labs[lutEntries - 1][0] - surfaceLab[0]);
    let run = -Infinity;
    let reversal = 0;
    let maxAdjacent = 0;
    let maxAdjacentAt = 0;
    let finite = true;
    for (let i = 0; i < lutEntries; i++) {
      const v = dir * labs[i][0];
      if (!Number.isFinite(labs[i][0]) || !Number.isFinite(labs[i][1]) || !Number.isFinite(labs[i][2])) finite = false;
      if (v > run) run = v;
      if (run - v > reversal) reversal = run - v;
      if (i > 0) {
        const d = lutDeltaE2000(labs[i - 1], labs[i]);
        if (d > maxAdjacent) {
          maxAdjacent = d;
          maxAdjacentAt = i;
        }
      }
    }
    return { first: lutDeltaE2000(surfaceLab, labs[0]), maxAdjacent, maxAdjacentAt, reversal, finite };
  }

  // Arms: the same, measured as lightness DEPARTURE from the shared midpoint (an arm may cross the
  // midpoint's lightness in either direction, so the direction of the screen is away from the midpoint).
  function lutScreenArm(labs, midLab) {
    let run = -Infinity;
    let reversal = 0;
    let maxAdjacent = 0;
    let finite = true;
    for (let i = 0; i < lutEntries; i++) {
      const dep = Math.abs(labs[i][0] - midLab[0]);
      if (!Number.isFinite(dep)) finite = false;
      if (dep > run) run = dep;
      if (run - dep > reversal) reversal = run - dep;
      if (i > 0) maxAdjacent = Math.max(maxAdjacent, lutDeltaE2000(labs[i - 1], labs[i]));
    }
    return { departure: Math.abs(labs[lutEntries - 1][0] - midLab[0]), maxAdjacent, reversal, finite };
  }

  function lutSameRgb(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  // E.lut.screens (API.md C.6, S1-086): the D11 numbers, computed on the 8-bit OUTPUT colours, and the
  // verdict against the declared limits (first entry >= 5 from the surface, adjacent <= 2, lightness
  // reversal <= 0.2, arms starting AT the midpoint, midpoint >= 5 from the surface, no gamut-clipped
  // channel). The Rows role is screened on its 16% COMPOSITE, which is what the bands show; an appearance
  // whose rows ramp is its unsigned ramp (ramp1) makes no band claim, so its rows numbers are reported
  // (`claimed: false`) but do not decide `ok`. These are declared engineering screens, not perceptual
  // validation (D11, S1-210).
  function lutScreens(lut, surfaceRgb) {
    const surfaceLab = lutRgbToLab(surfaceRgb[0], surfaceRgb[1], surfaceRgb[2]);
    const failures = [];
    const un = lutScreenRamp(lutEntryLabs(lut.unsigned), surfaceLab);
    const unsigned = { ...un, ok: true };
    if (!un.finite) failures.push("unsigned: a non-finite entry");
    if (!(un.first >= 5)) failures.push("unsigned: entry 0 is only " + un.first.toFixed(2) + " from the surface");
    if (!(un.maxAdjacent <= 2)) failures.push("unsigned: adjacent entries " + un.maxAdjacent.toFixed(3) + " apart at " + un.maxAdjacentAt);
    if (!(un.reversal <= 0.2)) failures.push("unsigned: lightness reverses by " + un.reversal.toFixed(3));
    unsigned.ok = un.finite && un.first >= 5 && un.maxAdjacent <= 2 && un.reversal <= 0.2;
    const midRgb = lut.midpoint.rgb;
    const midLab = lutRgbToLab(midRgb[0], midRgb[1], midRgb[2]);
    const arms = {};
    for (const name of ["positive", "negative"]) {
      const ramp = lut[name];
      const labs = lutEntryLabs(ramp);
      const s = lutScreenArm(labs, midLab);
      const startsAtMidpoint = lutSameRgb([ramp.rgb[0], ramp.rgb[1], ramp.rgb[2]], midRgb);
      const ok = s.finite && startsAtMidpoint && s.maxAdjacent <= 2 && s.reversal <= 0.2;
      arms[name] = { ...s, startsAtMidpoint, ok };
      if (!startsAtMidpoint) failures.push(name + ": entry 0 is not the midpoint");
      if (!(s.maxAdjacent <= 2)) failures.push(name + ": adjacent entries " + s.maxAdjacent.toFixed(3) + " apart");
      if (!(s.reversal <= 0.2)) failures.push(name + ": departure from the midpoint reverses by " + s.reversal.toFixed(3));
      if (!s.finite) failures.push(name + ": a non-finite entry");
    }
    const midpointDistance = lutDeltaE2000(surfaceLab, midLab);
    const midpoint = { distance: midpointDistance, ok: midpointDistance >= 5 };
    if (!midpoint.ok) failures.push("midpoint is only " + midpointDistance.toFixed(2) + " from the surface");
    const claimed = lut.rows !== lut.unsigned;
    const composite = lutComposite("rows", lutRowsAlpha, surfaceRgb, lut);
    const rw = lutScreenRamp(lutEntryLabs(composite), surfaceLab);
    const rows = { ...rw, claimed, ok: rw.finite && rw.first >= 5 && rw.maxAdjacent <= 2 && rw.reversal <= 0.2 };
    if (claimed && !rows.ok) failures.push("rows (composite at " + lutRowsAlpha + "): entry 0 " + rw.first.toFixed(2) + ", adjacent " + rw.maxAdjacent.toFixed(3) + ", reversal " + rw.reversal.toFixed(3));
    const clipped = lut.clipped;
    if (clipped !== 0) failures.push(clipped + " gamut-clipped channel(s)");
    return {
      theme: lut.theme,
      surface: [surfaceRgb[0], surfaceRgb[1], surfaceRgb[2]],
      unsigned,
      positive: arms.positive,
      negative: arms.negative,
      midpoint,
      rows,
      clipped,
      failures,
      ok: failures.length === 0,
    };
  }

  API.lut = Object.freeze({
    APPEARANCES: lutAppearances,
    DEFAULT_APPEARANCE: lutDefault,
    build: lutBuild,
    appearanceId: lutAppearanceId,
    ROWS_ALPHA: lutRowsAlpha,
    composite: lutComposite,
    themeOf: lutThemeOf,
    screens: lutScreens,
    deltaE2000: lutDeltaE2000,
    rgbToLab: lutRgbToLab,
    labToRgb: lutLabToRgb,
    contrast: lutContrast,
    over: lutOver,
    parseColor: lutParseColor,
  });
