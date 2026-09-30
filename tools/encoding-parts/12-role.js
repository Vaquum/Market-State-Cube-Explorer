  // @part 12-role
  // @requires 01-util 03-result 11-lut
  // @prefix rol
  // @provides role
  // == §12 role: the mark-role table and the glyph alphabet (API.md B.9, DR-21, DD-37, DD-72) ==
  // ONE table says what each kind of mark is, in what colour role it is drawn, and how it is painted, so
  // that the plot, the footer keys and the legend swatches call the same `paint` and `tile` and a key
  // cannot drift from its mark. S2 and S3 extend the tables (the reserved rows below), they never
  // reassign an entry. No canvas is created here: the context and, for tiles, a canvas factory are
  // arguments, so Node tests pass a recording fake.

  // Below this many css px in either dimension a pattern or an outline is not resolvable: a flat fill at
  // this alpha of the ink over whatever is underneath (the surface, in the plot) stands in for it, and the
  // readout carries the tag (DR-21: "below a pixel-size threshold a flat neutral fill with the readout is
  // acceptable and documented"). The alpha is roughly the ink coverage of the hairline patterns.
  const rolFlatAlpha = 0.3;
  const rolFlatMinPx = 4;
  // The infinity plate is 10 x 10 css px (B.9); its text is "minus infinity", written with escapes because
  // this part is ASCII (only 04-text may hold a literal non-ASCII string).
  const rolInfinityText = "\u2212\u221e";

  // Roles (B.9, DD-72). `sample(lut, idx, surfaceRgb)` is the colour the LEGEND shows for the role at a
  // table index; the reserved S2/S3 rows have no S1 painter and sample nothing. `label` and
  // `accessibleName` are E.text keys, never English.
  function rolRole(id, cls, geometry, sample, owner) {
    const camel = id.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    return Object.freeze({
      id,
      class: cls,
      geometry,
      appearanceVersion: 2,
      sample,
      label: "role." + camel,
      accessibleName: "role." + camel + "Name",
      owner,
    });
  }
  const rolRoles = Object.freeze({
    "unsigned": rolRole("unsigned", "quantitative-fill", "fill", (lut, idx) => lut.unsigned.css[idx], "S1"),
    "positive": rolRole("positive", "quantitative-fill", "fill", (lut, idx) => lut.positive.css[idx], "S1"),
    "negative": rolRole("negative", "quantitative-fill", "fill", (lut, idx) => lut.negative.css[idx], "S1"),
    "midpoint": rolRole("midpoint", "quantitative-fill", "fill", (lut) => lut.midpoint.css, "S1"),
    "occupancy": rolRole("occupancy", "quantitative-outline", "outline", (lut) => lut.occupancy.css, "S1"),
    "zero-outline": rolRole("zero-outline", "quantitative-outline", "outline", (lut) => lut.zeroInk.css, "S1"),
    "unsigned-bar": rolRole("unsigned-bar", "quantitative-fill", "bar", (lut) => lut.bar.css, "S1"),
    "state-ink": rolRole("state-ink", "state", "glyph", (lut) => lut.stateInk.css, "S1"),
    // The contextual Rows band: it shares the numerical mapping of the Rows channel and differs only in its
    // fixed 16% projection (#46 6.1), so the legend samples the COMPOSITE (DD-86).
    "rows-projection": rolRole("rows-projection", "quantitative-fill", "fill", (lut, idx, surfaceRgb) => API.lut.composite("rows", API.lut.ROWS_ALPHA, surfaceRgb, lut).css[idx], "S1"),
    // Reserved: S1 never paints these; the rows are where S2 and S3 extend the table.
    "family-reference": rolRole("family-reference", "family-reference", "outline", () => null, "S2"),
    "interaction": rolRole("interaction", "interaction", "outline", () => null, "S3"),
    "region-replacement": rolRole("region-replacement", "region-replacement", "pattern", () => null, "S2"),
  });

  // Glyphs (B.9): `tag` lists the typed tags the glyph marks; `ink` names the Lut colour it is drawn in
  // ("stateInk" or "occupancy"), `ground` what a pattern paints under itself ("surface": a pattern draws its
  // own ground, so its contrast is the ink over the surface, independent of the neighbouring cell); `key` is
  // the E.text key of its label; `readout` the readout tag ("tag" = the typed tag itself); `pattern`
  // describes a tiled texture: {lines: "/" | "\\" | "x" | null, dots, period, lineWidth, dotDiameter}.
  function rolGlyph(id, tag, kind, geometry, ink, ground, key, readout, minPx, role, pattern) {
    return Object.freeze({ id, tag: Object.freeze(tag), kind, geometry, ink, ground, key, readout, minPx, s1: true, role, pattern: pattern ? Object.freeze(pattern) : null });
  }
  const rolSlateTags = ["undefined", "empty-population", "no-coarser-parent", "waiting-for-complete-parent", "no-reference", "empty-both"];
  const rolGlyphs = Object.freeze({
    "tick": rolGlyph("tick", ["finite"], "line", "1.5 px baseline tick across the bar slot", "stateInk", null, "key.zero", "zero", 0, "state-ink", null),
    "zero-outline": rolGlyph("zero-outline", ["finite"], "outline", "1 px inset outline, flat fill below 4 px", "occupancy", null, "key.zero", "zero", rolFlatMinPx, "zero-outline", null),
    "diamond": rolGlyph("diamond", ["undefined"], "hollow diamond", "6 px, 1.25 px stroke, at the baseline; drawn only when the column slot is >= 6 px, else counted", "stateInk", null, "key.undefined", "undefined", 0, "state-ink", null),
    "pattern-slate": rolGlyph("pattern-slate", rolSlateTags, "pattern tile", "45-degree hairline, 6 css px period, 1 px lines", "stateInk", "surface", "key.undefined", "tag", rolFlatMinPx, "state-ink", { lines: "/", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "pattern-dots": rolGlyph("pattern-dots", ["pending"], "pattern tile", "dots, 5 css px period, 1.25 px diameter", "stateInk", "surface", "key.pending", "pending", rolFlatMinPx, "state-ink", { lines: null, dots: true, period: 5, lineWidth: 0, dotDiameter: 1.25 }),
    "pattern-cross": rolGlyph("pattern-cross", ["failed", "invalid-input"], "pattern tile", "crosshatch, 6 css px period", "stateInk", "surface", "key.failed", "tag", rolFlatMinPx, "state-ink", { lines: "x", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "pattern-slash": rolGlyph("pattern-slash", ["unsupported"], "pattern tile", "reverse 45-degree hairline, 6 css px period", "stateInk", "surface", "key.unsupported", "unsupported", rolFlatMinPx, "state-ink", { lines: "\\", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "tri-down": rolGlyph("tri-down", ["finite"], "filled triangle", "6 px at the low edge, count in the key", "stateInk", null, "key.below", "clip-low", 0, "state-ink", null),
    "tri-up": rolGlyph("tri-up", ["finite"], "filled triangle", "6 px at the high edge, count in the key", "stateInk", null, "key.above", "clip-high", 0, "state-ink", null),
    // The infinity mark is a plate with text; tiled (period 10) it fills a Cascade cell whose child is absent.
    "infinity": rolGlyph("infinity", ["negative-infinite"], "text glyph", "minus-infinity text in a 10 x 10 plate at the low end", "stateInk", "surface", "key.negInf", "negative-infinite", 0, "state-ink", { lines: null, dots: false, period: 10, lineWidth: 1, dotDiameter: 0 }),
    "outline": rolGlyph("outline", [], "outline", "1 px inset outline", "occupancy", null, "key.outline", "occupied", 0, "occupancy", null),
  });

  // Which glyph marks a typed tag (E.result.TAGS). ONE table; `null` = no mark of its own: `finite` is filled
  // from the mapping (zero has its own glyph), `outside-support` and `hidden` draw nothing and are readout
  // only (B.1). `empty-both` shares the neutral hatch, but rows count it in the key instead of drawing it per
  // row (A-28): that is the caller's rule, not a property of the glyph.
  const rolTagGlyph = Object.freeze({
    "finite": null,
    "negative-infinite": "infinity",
    "no-reference": "pattern-slate",
    "empty-both": "pattern-slate",
    "empty-population": "pattern-slate",
    "undefined": "pattern-slate",
    "no-coarser-parent": "pattern-slate",
    "waiting-for-complete-parent": "pattern-slate",
    "outside-support": null,
    "hidden": null,
    "pending": "pattern-dots",
    "failed": "pattern-cross",
    "unsupported": "pattern-slash",
    "invalid-input": "pattern-cross",
  });

  // E.role.glyphFor (API.md A.3, C.16): the glyph id that marks a non-value tag, given the tag's index in
  // E.result.TAGS (as the encoder carries it in `out.tag`); a tag name is accepted too. Allocation-free.
  function rolGlyphFor(tagIndex) {
    const tag = typeof tagIndex === "string" ? tagIndex : API.result.TAGS[tagIndex];
    if (tag === undefined || !Object.prototype.hasOwnProperty.call(rolTagGlyph, tag)) throw new RangeError("E.role.glyphFor: unknown tag " + String(tagIndex));
    return rolTagGlyph[tag];
  }

  // Resolve what a caller calls a tile: a glyph id ("pattern-dots"), the short name ("dots") or a typed tag
  // ("pending"), so `patternFor("pending")` and `patternFor(ENC.pattern)` both work.
  function rolTileGlyph(kind) {
    let g = rolGlyphs[kind];
    if (g === undefined) g = rolGlyphs["pattern-" + kind];
    if (g === undefined && Object.prototype.hasOwnProperty.call(rolTagGlyph, kind) && rolTagGlyph[kind] !== null) g = rolGlyphs[rolTagGlyph[kind]];
    if (g === undefined || g.pattern === null) throw new RangeError("E.role.tile: " + String(kind) + " is not a pattern glyph");
    return g;
  }

  // ---- painting ----

  // The strokes of a hairline or dot texture over the box (ox, oy, w, h), in css px, as ONE path so a probe
  // sees one beginPath ... stroke()/fill() sequence per glyph. Lines run past the box by `e` so a clip (or a
  // tile edge) shows no end caps, and the lines of a tile line up across the tile edge: a 45-degree family
  // x + y = k * P (or x - y = c) with the box a multiple of P wide is periodic in both directions.
  function rolTexturePath(ctx, p, ox, oy, w, h) {
    const P = p.period;
    const e = 2;
    ctx.beginPath();
    if (p.dots) {
      const r = p.dotDiameter / 2;
      for (let cy = P / 2; cy < h + P; cy += P)
        for (let cx = P / 2; cx < w + P; cx += P) {
          if (cx - r > w || cy - r > h) continue;
          ctx.moveTo(ox + cx + r, oy + cy);
          ctx.arc(ox + cx, oy + cy, r, 0, 2 * Math.PI);
        }
      return;
    }
    if (p.lines === "/" || p.lines === "x") {
      for (let k = 0; k * P <= w + h + P; k++) {
        ctx.moveTo(ox + k * P + e, oy - e);
        ctx.lineTo(ox + k * P - h - e, oy + h + e);
      }
    }
    if (p.lines === "\\" || p.lines === "x") {
      for (let c = -Math.ceil(h / P) * P; c <= w + P; c += P) {
        ctx.moveTo(ox + c - e, oy - e);
        ctx.lineTo(ox + c + h + e, oy + h + e);
      }
    }
  }

  function rolPaintTexture(ctx, g, ox, oy, w, h, ink, ground) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, h);
    ctx.clip();
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(ox, oy, w, h);
    }
    rolTexturePath(ctx, g.pattern, ox, oy, w, h);
    if (g.pattern.dots) {
      ctx.fillStyle = ink;
      ctx.fill();
    } else {
      ctx.strokeStyle = ink;
      ctx.lineWidth = g.pattern.lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The infinity plate: a ground square, a hairline border and the text, at (ox, oy) with side `s` (10 css px
  // at scale 1, B.9).
  function rolPaintPlate(ctx, ox, oy, s, ink, ground, font) {
    ctx.save();
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(ox, oy, s, s);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
    ctx.fillStyle = ink;
    ctx.font = font || "600 " + Math.max(6, Math.round(s * 0.8)) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rolInfinityText, ox + s / 2, oy + s / 2 + 0.5);
    ctx.restore();
  }

  // E.role.paint (API.md A.3, DD-37): one glyph, centred on (x, y), `size` css px across (`opts.width` /
  // `opts.height` override the two sides of a box-like glyph: a pattern, an outline, the length of a tick).
  // `ink` is a CSS colour; `opts.ground` (a CSS colour) is painted under a pattern or the infinity plate
  // (a tile always has one, a swatch on a coloured panel wants it, a mark drawn on the surface does not).
  // Below the glyph's `minPx` a flat fill stands in for a texture or an outline (DR-21). Each glyph is one
  // beginPath ... stroke()/fill() sequence, so the test probe can classify it (TESTPLAN.md 3.3).
  function rolPaint(ctx, glyphId, x, y, size, ink, opts) {
    const g = rolGlyphs[glyphId];
    if (g === undefined) throw new RangeError("E.role.paint: unknown glyph " + String(glyphId));
    const o = opts || {};
    const w = o.width === undefined ? size : o.width;
    const h = o.height === undefined ? size : o.height;
    const ox = x - w / 2;
    const oy = y - h / 2;
    if (g.minPx > 0 && Math.min(w, h) < g.minPx) {
      ctx.save();
      ctx.globalAlpha = rolFlatAlpha;
      ctx.fillStyle = ink;
      ctx.fillRect(ox, oy, w, h);
      ctx.restore();
      return;
    }
    if (g.pattern !== null && g.id !== "infinity") {
      rolPaintTexture(ctx, g, ox, oy, w, h, ink, o.ground);
      return;
    }
    if (g.id === "infinity") {
      rolPaintPlate(ctx, x - size / 2, y - size / 2, size, ink, o.ground, o.font);
      return;
    }
    ctx.save();
    if (g.id === "zero-outline" || g.id === "outline") {
      // A 1 px line is centred on its path: inset by half a pixel so the outline lies wholly inside the cell.
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
    } else if (g.id === "tick") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + w, y);
      ctx.stroke();
    } else if (g.id === "diamond") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x, y - size / 2);
      ctx.lineTo(x + size / 2, y);
      ctx.lineTo(x, y + size / 2);
      ctx.lineTo(x - size / 2, y);
      ctx.closePath();
      ctx.stroke();
    } else {
      // tri-down points down (the value fell below the axis), tri-up points up.
      const down = g.id === "tri-down" ? 1 : -1;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(x - size / 2, y - (down * size) / 2);
      ctx.lineTo(x + size / 2, y - (down * size) / 2);
      ctx.lineTo(x, y + (down * size) / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // E.role.tile (API.md A.3, DD-37): one pattern tile as a canvas from `makeCanvas(width, height)`, DPR
  // compensated: its side is round(period * dpr) device pixels, drawn with the css-px geometry scaled to fit,
  // so the page only sets `pattern.setTransform(scale(1/dpr))`. The tile carries its own ground (`ground`,
  // normally the surface), which is why a pattern's contrast is ink over surface whatever lies next to it.
  function rolTile(kind, opts) {
    const g = rolTileGlyph(kind);
    const dpr = opts.dpr > 0 ? opts.dpr : 1;
    const P = g.pattern.period;
    const px = Math.max(1, Math.round(P * dpr));
    const canvas = opts.makeCanvas(px, px);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(px / P, px / P);
    if (g.id === "infinity") rolPaintPlate(ctx, 0, 0, P, opts.ink, opts.ground, opts.font);
    else rolPaintTexture(ctx, g, 0, 0, P, P, opts.ink, opts.ground);
    ctx.restore();
    return canvas;
  }

  // ---- keys ----

  // The legend and footer keys (B.11): id, glyph, E.text key, and which typed tags count toward it. Ids are
  // the typed tags (not every tag has a key: `finite` is a fill and `hidden` is replay, both unkeyed) plus
  // the synthetic ones the scale adds: `zero`, `clip-low`, `clip-high`, `no-calibration`, `occupied`.
  // `outside-support` has a key (a count of what lies outside the comparison support) but no swatch.
  function rolKey(glyph, key) {
    return Object.freeze({ glyph, key });
  }
  const rolKeys = Object.freeze({
    "zero": rolKey("zero-outline", "key.zero"),
    "undefined": rolKey("pattern-slate", "key.undefined"),
    "empty-population": rolKey("pattern-slate", "key.undefined"),
    "no-coarser-parent": rolKey("pattern-slate", "key.undefined"),
    "waiting-for-complete-parent": rolKey("pattern-slate", "key.open"),
    "no-reference": rolKey("pattern-slate", "key.noRef"),
    "empty-both": rolKey("pattern-slate", "key.emptyBoth"),
    "negative-infinite": rolKey("infinity", "key.negInf"),
    "clip-low": rolKey("tri-down", "key.below"),
    "clip-high": rolKey("tri-up", "key.above"),
    "pending": rolKey("pattern-dots", "key.pending"),
    "failed": rolKey("pattern-cross", "key.failed"),
    "unsupported": rolKey("pattern-slash", "key.unsupported"),
    "invalid-input": rolKey("pattern-cross", "key.invalid"),
    "outside-support": rolKey(null, "key.outside"),
    "occupied": rolKey("outline", "key.outline"),
    "no-calibration": rolKey("outline", "key.noCalibration"),
  });
  const rolUnkeyed = Object.freeze(["finite", "hidden"]);

  // The label of a key: the English text when part 04 is present and has the key, else the key itself
  // (Node tests of this part load without part 04).
  function rolLabel(path) {
    let v = API.text;
    for (const part of path.split(".")) {
      if (v === undefined || v === null) return path;
      v = v[part];
    }
    return typeof v === "string" ? v : path;
  }

  // E.role.keyEntries (API.md A.3): the key records for `tags` (ids as above), each with its count from
  // `counts` (an object keyed by id, or an array parallel to `tags`; missing = 0), in the order given. The
  // consumer keeps the entries with count > 0; ids with no key (`finite`, `hidden`) are left out, an unknown
  // id is a caller bug and throws.
  function rolKeyEntries(tags, counts) {
    const out = [];
    for (let i = 0; i < tags.length; i++) {
      const id = tags[i];
      if (rolUnkeyed.indexOf(id) >= 0) continue;
      if (!Object.prototype.hasOwnProperty.call(rolKeys, id)) throw new RangeError("E.role.keyEntries: unknown key id " + String(id));
      const k = rolKeys[id];
      let n = Array.isArray(counts) ? counts[i] : counts === null || counts === undefined ? 0 : counts[id];
      if (!(n > 0)) n = 0;
      out.push({
        id,
        glyph: k.glyph,
        role: k.glyph === null ? null : rolGlyphs[k.glyph].role,
        key: k.key,
        label: rolLabel(k.key),
        count: n,
      });
    }
    return out;
  }

  API.role = Object.freeze({
    ROLES: rolRoles,
    GLYPHS: rolGlyphs,
    paint: rolPaint,
    tile: rolTile,
    glyphFor: rolGlyphFor,
    keyEntries: rolKeyEntries,
  });
