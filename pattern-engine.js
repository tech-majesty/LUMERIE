/* =============================================================================
 *  pattern-engine.js — Majesty procedural pattern engine.
 *
 *  ONE source of truth, loaded by BOTH the storefront (index.html) and the
 *  Pattern Studio. Patterns are CODE, not baked images: the pattern is computed
 *  in a fragment shader from the lamp's own surface coordinates, so adding one
 *  means adding a recipe object below — no texture bake, no GLB re-export, no
 *  R2 upload.
 *
 *  How a pattern is defined
 *  ------------------------
 *  Every generator is a GLSL body that sets  float a  (0..1 coverage) from:
 *     th   angle around the lamp, -PI..PI, 0 = front (rotate-aware)
 *     h    height, 0 at the bottom edge .. 1 at the top edge
 *     hz   height within the pattern's own zone, 0..1
 *     u    0..1 once around the lamp
 *     aa   antialias width in hz units
 *     aau  antialias width in u units
 *     sz   feature-size ramp, sizeBot at the bottom .. sizeTop at the top
 *
 *  h is TILT-AWARE: the lamp's top rim is a steep slant (Y swings 0.519 at the
 *  front to 2.062 at the back) while the base is flat. Normalising against the
 *  measured edge curves makes a constant-h contour hug the slanted rim up top
 *  and flatten toward the base, instead of ringing the lamp at a constant Y.
 *
 *  Exposed as window.MajestyPatterns. Plain script, no build step.
 * ============================================================================= */
(function (global) {
  'use strict';

  // Common params every generator gets, so all of them have height control.
  // sizeBot/sizeTop scale the pattern's feature size — motif size for the
  // motif patterns, line thickness for the line patterns — interpolated up
  // the zone. Generators can override these defaults via commonDefaults.
  const COMMON_PARAMS = {
      sizeBot: { label: 'Size at bottom', min: .05, max: 3, step: .01, val: 1, dp: 2 },
      sizeTop: { label: 'Size at top', min: .05, max: 3, step: .01, val: 1, dp: 2 },
      zFrom: { label: 'Zone bottom', min: 0, max: 1, step: .01, val: 0, dp: 2 },
      zTo: { label: 'Zone top', min: 0, max: 1, step: .01, val: 1, dp: 2 },
      tilt: { label: 'Follow edge tilt', min: 0, max: 1, step: .01, val: 1, dp: 2 }
  };

  // Generator params whose meaning is "how big" — these get multiplied by
  // the sizeBot..sizeTop ramp automatically, so no generator body needs to
  // know the feature exists.
  const SCALABLE = ['thick', 'bandThick', 'size', 'rad', 'tipThick', 'midThick', 'edgeSize'];

  // Merged param spec for a generator: its own params, then the common
  // ones with any per-generator default overrides applied.
  function paramsFor(type) {
      const gen = GENERATORS[type];
      const common = {};
      for (const [k, p] of Object.entries(COMMON_PARAMS)) {
          const ov = gen.commonDefaults && gen.commonDefaults[k];
          common[k] = (ov === undefined) ? p : Object.assign({}, p, { val: ov });
      }
      return { own: gen.params, common };
  }

  const GENERATORS = {
      ladder: {
          label: 'Ladder — rungs + spine',
          params: {
              rungs: { label: 'Rung count', min: 2, max: 40, step: 1, val: 11 },
              thick: { label: 'Rung thickness', min: .02, max: .8, step: .01, val: .2, dp: 2 },
              splitAt: { label: 'Banded/split divide', min: 0, max: 1, step: .01, val: .34, dp: 2 },
              gapDeg: { label: 'Spine channel width', min: 0, max: 60, step: .5, val: 8, unit: '°', dp: 1 },
              spineW: { label: 'Spine line width', min: 0, max: 30, step: .5, val: 2, unit: '°', dp: 1 },
              spineSep: { label: 'Spine separation', min: 0, max: 40, step: .5, val: 8, unit: '°', dp: 1 },
              spineBot: { label: 'Spine bottom', min: 0, max: 1, step: .01, val: .3, dp: 2 },
              spineTop: { label: 'Spine top', min: 0, max: 1, step: .01, val: 1, dp: 2 },
              bands: { label: 'Bottom bands', min: 0, max: 8, step: 1, val: 3 },
              bandThick: { label: 'Band thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 }
          },
          glsl: `
    float gap   = radians(p_gapDeg) * 0.5;
    float inGap = 1.0 - smoothstep(gap, gap + radians(0.5), abs(th));
    // rungs above the divide, interrupted by the central channel
    if (hz > p_splitAt) {
      float t = (hz - p_splitAt) / max(1e-4, 1.0 - p_splitAt);
      a = max(a, lineWave(t * p_rungs - 0.5, p_thick, aa * p_rungs) * (1.0 - inGap));
    }
    // TWO vertical lines, one down each edge of the channel, rather than a
    // single line on the centre — matches the reference lamp, where the rungs
    // stop against a pair of verticals with a dark gap between them.
    if (p_spineW > 0.0 && hz >= p_spineBot && hz <= p_spineTop) {
      float sw  = radians(p_spineW) * 0.5;
      float sep = radians(p_spineSep) * 0.5;
      float d   = abs(abs(th) - sep);          // distance to the nearer vertical
      a = max(a, 1.0 - smoothstep(sw, sw + radians(0.4), d));
    }
    // uninterrupted bands below the divide
    if (hz < p_splitAt && p_bands > 0.0) {
      float t = hz / max(1e-4, p_splitAt);
      a = max(a, lineWave(t * p_bands - 0.5, p_bandThick, aa * p_bands));
    }`
      },
      stripes: {
          label: 'Stripes — horizontal rings',
          params: {
              rows: { label: 'Ring count', min: 2, max: 60, step: 1, val: 18 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 },
              grade: { label: 'Spacing gradient', min: -1, max: 1, step: .01, val: 0, dp: 2 }
          },
          glsl: `
    // grade > 0 packs the rings toward the top, < 0 toward the bottom
    float t = pow(clamp(hz, 0.0, 1.0), exp(p_grade * 1.2));
    a = max(a, lineWave(t * p_rows - 0.5, p_thick, aa * p_rows * 1.6));`
      },
      fluting: {
          label: 'Fluting — vertical reeds',
          params: {
              cols: { label: 'Reed count', min: 3, max: 90, step: 1, val: 34 },
              thick: { label: 'Line thickness', min: .02, max: .9, step: .01, val: .35, dp: 2 },
              fade: { label: 'Fade at top', min: 0, max: 1, step: .01, val: 0, dp: 2 }
          },
          glsl: `
    float f = lineWave(u * p_cols, p_thick, aau * p_cols);
    a = max(a, f * (1.0 - p_fade * hz));`
      },
      grid: {
          label: 'Grid — rings + verticals',
          params: {
              rows: { label: 'Ring count', min: 2, max: 40, step: 1, val: 12 },
              cols: { label: 'Vertical count', min: 2, max: 80, step: 1, val: 24 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 }
          },
          glsl: `
    a = max(a, lineWave(hz * p_rows - 0.5, p_thick, aa * p_rows * 1.6));
    a = max(a, lineWave(u * p_cols, p_thick, aau * p_cols));`
      },
      brick: {
          label: 'Brick — offset courses',
          params: {
              rows: { label: 'Course count', min: 2, max: 40, step: 1, val: 12 },
              cols: { label: 'Bricks per course', min: 2, max: 40, step: 1, val: 14 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .14, dp: 2 },
              offset: { label: 'Course offset', min: 0, max: 1, step: .01, val: .5, dp: 2 }
          },
          glsl: `
    float row = floor(hz * p_rows);
    a = max(a, lineWave(hz * p_rows, p_thick, aa * p_rows * 1.6));
    a = max(a, lineWave(u * p_cols + mod(row, 2.0) * p_offset, p_thick, aau * p_cols));`
      },
      chevron: {
          label: 'Chevron — V rows',
          params: {
              rows: { label: 'Row count', min: 2, max: 30, step: 1, val: 9 },
              cols: { label: 'Zig count', min: 1, max: 40, step: 1, val: 10 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 },
              amp: { label: 'V depth', min: 0, max: 1.5, step: .01, val: .5, dp: 2 }
          },
          glsl: `
    float zig = abs(fract(u * p_cols) - 0.5) * 2.0;
    a = max(a, lineWave(hz * p_rows - zig * p_amp, p_thick, aa * p_rows * 1.6));`
      },
      herringbone: {
          label: 'Herringbone — alternating',
          params: {
              rows: { label: 'Band count', min: 2, max: 30, step: 1, val: 10 },
              cols: { label: 'Weave density', min: 2, max: 40, step: 1, val: 14 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 },
              sep: { label: 'Band separators', min: 0, max: 1, step: 1, val: 1 }
          },
          glsl: `
    float row = floor(hz * p_rows);
    float s   = mod(row, 2.0) > 0.5 ? 1.0 : -1.0;
    a = max(a, lineWave(u * p_cols + s * fract(hz * p_rows), p_thick, aau * p_cols));
    if (p_sep > 0.5) a = max(a, lineWave(hz * p_rows, p_thick * 0.7, aa * p_rows * 1.6));`
      },
      wave: {
          label: 'Wave — rippled rings',
          params: {
              rows: { label: 'Ring count', min: 2, max: 40, step: 1, val: 12 },
              freq: { label: 'Ripples around', min: 1, max: 24, step: 1, val: 6 },
              amp: { label: 'Ripple depth', min: 0, max: 1, step: .01, val: .3, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 },
              phase: { label: 'Phase drift', min: 0, max: 2, step: .01, val: 0, dp: 2 }
          },
          glsl: `
    float ph = u * p_freq * 2.0 * PI + hz * p_phase * 2.0 * PI;
    a = max(a, lineWave(hz * p_rows + sin(ph) * p_amp, p_thick, aa * p_rows * 1.6));`
      },
      arches: {
          label: 'Arches — Moorish row',
          params: {
              cols: { label: 'Arch count', min: 2, max: 30, step: 1, val: 10 },
              rows: { label: 'Tiers', min: 1, max: 8, step: 1, val: 2 },
              archH: { label: 'Arch height', min: .1, max: 1, step: .01, val: .62, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 },
              legs: { label: 'Show legs', min: 0, max: 1, step: 1, val: 1 }
          },
          glsl: `
    // Cell-space pattern: the distance field is in cell units, so the
    // antialias width has to be converted from hz units too (1 cell = 1/rows).
    float aac  = max(aa * p_rows, 0.0006);
    float cx   = fract(u * p_cols) - 0.5;
    float rowT = fract(hz * p_rows);
    float dome = sqrt(max(0.0, 0.25 - cx * cx)) * 2.0;   // 0..1 semicircle
    float prof = dome * p_archH;
    a = max(a, lineAt(rowT - prof, p_thick * 0.5, aac));
    if (p_legs > 0.5) {
      float leg = lineWave(u * p_cols + 0.5, p_thick * 0.9, aau * p_cols);
      a = max(a, leg * (1.0 - smoothstep(p_archH * 0.5, p_archH * 0.5 + 0.02, rowT)));
    }`
      },
      scales: {
          label: 'Scales — fish scale',
          params: {
              cols: { label: 'Scales around', min: 2, max: 40, step: 1, val: 16 },
              rows: { label: 'Scale rows', min: 2, max: 30, step: 1, val: 10 },
              rad: { label: 'Scale radius', min: .2, max: .9, step: .01, val: .5, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);   // cell-space antialias
    float row = floor(hz * p_rows);
    float cx  = fract(u * p_cols + mod(row, 2.0) * 0.5) - 0.5;
    float cy  = fract(hz * p_rows) - 0.5;
    float d   = length(vec2(cx, cy));
    a = max(a, lineAt(d - p_rad * 0.5, p_thick * 0.5, aac));`
      },
      honeycomb: {
          label: 'Honeycomb — hex lattice',
          params: {
              cols: { label: 'Cells around', min: 2, max: 40, step: 1, val: 14 },
              rows: { label: 'Cell rows', min: 2, max: 30, step: 1, val: 10 },
              size: { label: 'Cell size', min: .2, max: .9, step: .01, val: .46, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);   // cell-space antialias
    float row = floor(hz * p_rows);
    vec2 f = vec2(fract(u * p_cols + mod(row, 2.0) * 0.5) - 0.5, fract(hz * p_rows) - 0.5);
    float hex = max(abs(f.x) * 0.866 + abs(f.y) * 0.5, abs(f.y));
    a = max(a, lineAt(hex - p_size * 0.5, p_thick * 0.5, aac));`
      },
      diamond: {
          label: 'Diamond — lattice',
          params: {
              rows: { label: 'Row count', min: 2, max: 30, step: 1, val: 10 },
              cols: { label: 'Column count', min: 2, max: 40, step: 1, val: 14 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 },
              single: { label: 'Single direction', min: 0, max: 1, step: 1, val: 0 }
          },
          glsl: `
    float t = hz * p_rows, uu = u * p_cols;
    a = max(a, lineWave(t + uu, p_thick, aa * p_rows * 1.6));
    if (p_single < 0.5) a = max(a, lineWave(t - uu, p_thick, aa * p_rows * 1.6));`
      },
      triangles: {
          label: 'Triangles — outlined',
          params: {
              cols: { label: 'Triangles around', min: 2, max: 40, step: 1, val: 14 },
              rows: { label: 'Triangle rows', min: 1, max: 30, step: 1, val: 8 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .16, dp: 2 },
              alt: { label: 'Alternate flip', min: 0, max: 1, step: 1, val: 1 }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);   // cell-space antialias
    float row = floor(hz * p_rows);
    float y   = fract(hz * p_rows);
    if (p_alt > 0.5 && mod(row, 2.0) > 0.5) y = 1.0 - y;
    float x   = fract(u * p_cols) - 0.5;
    float w   = p_thick * 0.5;
    a = max(a, lineAt(y - 0.5 + 0.5, w, aac));                 // base of each cell
    a = max(a, lineAt((1.0 - y) - abs(x) * 2.0, w, aac));      // the two sides`
      },
      sunburst: {
          label: 'Sunburst — fanned rays',
          params: {
              rays: { label: 'Ray count', min: 2, max: 60, step: 1, val: 26 },
              origin: { label: 'Fan origin', min: -2, max: 1, step: .01, val: -.7, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .9, step: .01, val: .14, dp: 2 },
              spread: { label: 'Spread', min: .2, max: 6, step: .01, val: 2.4, dp: 2 }
          },
          glsl: `
    // Rays radiating from a virtual point below (or above) the pattern.
    // Use the ANGLE from that origin, not x/y: a ratio blows up near the
    // origin, while atan stays bounded and keeps the line width sane.
    float ox  = fract(u + 0.5) - 0.5;
    float oy  = max(hz - p_origin, 0.015);
    float ang = atan(ox * p_spread, oy);
    float rv  = ang / PI * p_rays;
    float w   = fwidth(rv) * 0.7;
    // Where the rays converge tighter than a pixel, fade out instead of
    // smearing to solid — the honest result for unresolvable detail.
    a = max(a, lineWave(rv, p_thick, clamp(w, 0.0006, 0.25))
               * (1.0 - smoothstep(0.16, 0.34, w)));`
      },
      decofan: {
          label: 'Deco fan — nested arcs',
          params: {
              rings: { label: 'Arc count', min: 2, max: 40, step: 1, val: 12 },
              cols: { label: 'Fans around', min: 1, max: 24, step: 1, val: 6 },
              aspect: { label: 'Arc flatten', min: .2, max: 4, step: .01, val: 1.4, dp: 2 },
              thick: { label: 'Line thickness', min: .02, max: .8, step: .01, val: .18, dp: 2 }
          },
          glsl: `
    float cx = (fract(u * p_cols) - 0.5) * p_aspect;
    float d  = length(vec2(cx, hz * 1.0));
    a = max(a, lineWave(d * p_rings, p_thick, aa * p_rings * 1.6));`
      },
      dots: {
          label: 'Dots — perforation',
          params: {
              rows: { label: 'Row count', min: 2, max: 40, step: 1, val: 14 },
              cols: { label: 'Column count', min: 2, max: 60, step: 1, val: 24 },
              size: { label: 'Dot size', min: .02, max: .5, step: .01, val: .2, dp: 2 },
              stagger: { label: 'Stagger rows', min: 0, max: 1, step: 1, val: 1 },
              ring: { label: 'Outline only', min: 0, max: 1, step: 1, val: 0 }
          },
          glsl: `
    float row = floor(hz * p_rows);
    vec2 c = vec2(fract(u * p_cols + mod(row, 2.0) * 0.5 * p_stagger) - 0.5,
                  fract(hz * p_rows) - 0.5);
    float d = length(c);
    if (p_ring > 0.5) a = max(a, lineAt(d - p_size, p_size * 0.5, aa * 1.6));
    else              a = max(a, 1.0 - smoothstep(p_size, p_size + aa * p_rows * 2.0, d));`
      },
      // --- motif / halftone family -------------------------------------
      // These are filled shapes with a size gradient up the lamp. `grad`
      // is the size multiplier at the TOP of the zone: >1 grows upward,
      // <1 shrinks upward, 1 is uniform.
      crosses: {
          label: 'Crosses — plus / X grid',
          params: {
              cols: { label: 'Motifs around', min: 2, max: 30, step: 1, val: 10 },
              rows: { label: 'Motif rows', min: 2, max: 30, step: 1, val: 12 },
              size: { label: 'Motif size', min: .1, max: 1.4, step: .01, val: .78, dp: 2 },
              thick: { label: 'Arm thickness', min: .05, max: .8, step: .01, val: .3, dp: 2 },
              alt: { label: 'Alternate + and X', min: 0, max: 1, step: 1, val: 1 },
              spin: { label: 'Motif spin', min: 0, max: 90, step: 1, val: 0, unit: '°' }
          },
          commonDefaults: { sizeBot: 1, sizeTop: 2.1 },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);
    float row = floor(hz * p_rows);
    vec2  c   = vec2(fract(u * p_cols) - 0.5, fract(hz * p_rows) - 0.5);
    float L   = max(p_size * 0.5, 0.004);
    float T   = max(p_thick * 0.25, 0.002);
    float spin = radians(p_spin) + ((p_alt > 0.5 && mod(row, 2.0) > 0.5) ? 0.7853982 : 0.0);
    vec2  q   = rot2(c, spin);
    float r   = min(T * 0.75, L * 0.4);            // corner rounding
    float d   = min(sdBox(q, vec2(max(L - r, 0.001), max(T - r, 0.001))),
                    sdBox(q, vec2(max(T - r, 0.001), max(L - r, 0.001)))) - r;
    a = max(a, fillSDF(d, aac));`
      },
      fourstar: {
          label: 'Four-point stars — astroid',
          params: {
              cols: { label: 'Motifs around', min: 2, max: 40, step: 1, val: 14 },
              rows: { label: 'Motif rows', min: 2, max: 40, step: 1, val: 16 },
              size: { label: 'Motif size', min: .1, max: 1.6, step: .01, val: .92, dp: 2 },
              // lower exponent = deeper concave sides = sharper points
              sharp: { label: 'Point sharpness', min: .2, max: 1.2, step: .01, val: .42, dp: 2 },
              stagger: { label: 'Stagger rows', min: 0, max: 1, step: 1, val: 1 },
              spin: { label: 'Motif spin', min: 0, max: 90, step: 1, val: 0, unit: '°' }
          },
          commonDefaults: { sizeBot: 1, sizeTop: .28 },
          glsl: `
    float aac = max(aa * p_rows, 0.0008);
    float row = floor(hz * p_rows);
    vec2  c   = vec2(fract(u * p_cols + mod(row, 2.0) * 0.5 * p_stagger) - 0.5,
                     fract(hz * p_rows) - 0.5);
    c = rot2(c, radians(p_spin));
    float R   = max(p_size * 0.5, 0.004);
    // Astroid: |x|^e + |y|^e = R^e. e < 1 gives cusps on the axes and
    // concave sides — the four-point star shape.
    float e   = p_sharp;
    float f   = pow(abs(c.x), e) + pow(abs(c.y), e) - pow(R, e);
    a = max(a, 1.0 - smoothstep(0.0, aac * 2.5, f));`
      },
      tristar: {
          label: 'Tri-star — 3 sharp points',
          params: {
              cols: { label: 'Motifs around', min: 2, max: 30, step: 1, val: 12 },
              rows: { label: 'Motif rows', min: 2, max: 30, step: 1, val: 12 },
              size: { label: 'Motif size', min: .1, max: 2, step: .01, val: 1.02, dp: 2 },
              // small exponent keeps each lobe wide; large pinches it to a spike
              sharp: { label: 'Point sharpness', min: .1, max: 4, step: .05, val: .55, dp: 2 },
              flip: { label: 'Flip alternate rows', min: 0, max: 1, step: 1, val: 1 },
              spin: { label: 'Motif spin', min: 0, max: 120, step: 1, val: 90, unit: '°' }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0008);
    float row = floor(hz * p_rows);
    vec2  c   = vec2(fract(u * p_cols + mod(row, 2.0) * 0.5) - 0.5, fract(hz * p_rows) - 0.5);
    float spin = radians(p_spin) + ((p_flip > 0.5 && mod(row, 2.0) > 0.5) ? PI : 0.0);
    c = rot2(c, spin);
    float R   = max(p_size * 0.5, 0.004);
    // three lobes: cos(3a) is positive on three arcs 120 deg apart
    float ang = atan(c.y, c.x);
    float lobe = pow(max(0.0, cos(3.0 * ang)), p_sharp);
    float rr  = R * lobe;
    a = max(a, 1.0 - smoothstep(rr - aac, rr + aac, length(c)));`
      },
      triprong: {
          label: 'Tri-prong — Y motif',
          params: {
              cols: { label: 'Motifs around', min: 2, max: 30, step: 1, val: 9 },
              rows: { label: 'Motif rows', min: 2, max: 30, step: 1, val: 10 },
              size: { label: 'Arm length', min: .1, max: 1.4, step: .01, val: .82, dp: 2 },
              tipThick: { label: 'Thickness at tip', min: .005, max: .3, step: .005, val: .085, dp: 3 },
              midThick: { label: 'Thickness at hub', min: .005, max: .3, step: .005, val: .035, dp: 3 },
              spin: { label: 'Motif spin', min: 0, max: 360, step: 1, val: 90, unit: '°' }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);
    float row = floor(hz * p_rows);
    vec2  c   = vec2(fract(u * p_cols + mod(row, 2.0) * 0.5) - 0.5, fract(hz * p_rows) - 0.5);
    float L   = max(p_size * 0.5, 0.004);
    float d   = 1e6;
    for (int i = 0; i < 3; i++) {
      float ang = radians(p_spin) + float(i) * 2.0943951;   // 120 deg apart
      vec2  arm = vec2(cos(ang), sin(ang)) * L;
      float hh;
      float dd = sdSegH(c, arm, hh);
      // taper: thin at the hub, swelling to a rounded tip
      d = min(d, dd - mix(p_midThick, p_tipThick, hh));
    }
    a = max(a, fillSDF(d, aac));`
      },
      trihalftone: {
          label: 'Triangle halftone',
          params: {
              cols: { label: 'Triangles around', min: 2, max: 40, step: 1, val: 15 },
              rows: { label: 'Triangle rows', min: 2, max: 40, step: 1, val: 17 },
              size: { label: 'Triangle size', min: .05, max: 2, step: .01, val: 1.25, dp: 2 },
              // a ratio, not a size — kept out of SCALABLE so it is not
              // multiplied by the size ramp a second time
              edgeRatio: { label: 'Shrink away from peak', min: .02, max: 2.5, step: .01, val: .12, dp: 2 },
              mid: { label: 'Peak position', min: 0, max: 1, step: .01, val: .58, dp: 2 },
              updown: { label: 'Alternate up/down', min: 0, max: 1, step: 1, val: 1 }
          },
          glsl: `
    float aac = max(aa * p_rows, 0.0006);
    float row = floor(hz * p_rows);
    float uu  = u * p_cols + mod(row, 2.0) * 0.5;
    vec2  c   = vec2(fract(uu) - 0.5, fract(hz * p_rows) - 0.5);
    if (p_updown > 0.5 && mod(floor(uu), 2.0) > 0.5) c.y = -c.y;
    // size peaks at p_mid and falls off either side, giving a halftone band
    float t   = 1.0 - abs(hz - p_mid) / max(p_mid, 1.0 - p_mid + 1e-4);
    float g   = mix(p_edgeRatio, 1.0, clamp(t, 0.0, 1.0));
    float s   = max(p_size * g, 0.002);
    float d   = sdTri(c / s, 0.42) * s;
    a = max(a, fillSDF(d, aac));`
      },
      dashes: {
          label: 'Dashes — vertical data rain',
          params: {
              cols: { label: 'Column count', min: 4, max: 90, step: 1, val: 42 },
              segs: { label: 'Dashes per column', min: 4, max: 90, step: 1, val: 34 },
              thick: { label: 'Column thickness', min: .02, max: .9, step: .01, val: .3, dp: 2 },
              fill: { label: 'Dash length', min: .1, max: 1, step: .01, val: .62, dp: 2 },
              density: { label: 'Density at bottom', min: 0, max: 1, step: .01, val: .95, dp: 2 },
              densTop: { label: 'Density at top', min: 0, max: 1, step: .01, val: .06, dp: 2 },
              seed: { label: 'Seed', min: 0, max: 60, step: 1, val: 7 }
          },
          glsl: `
    float col  = floor(u * p_cols);
    float bar  = lineWave(u * p_cols, p_thick, aau * p_cols);
    // per-column offset so the columns do not line up into rows
    float y    = hz * p_segs + hash11(col + p_seed) * 17.0;
    float seg  = floor(y);
    float prob = mix(p_density, p_densTop, clamp(hz, 0.0, 1.0));
    float on   = step(hash21(vec2(col + p_seed, seg)), prob);
    float wseg = max(aa * p_segs, 0.002);
    float dash = 1.0 - smoothstep(p_fill * 0.5 - wseg, p_fill * 0.5 + wseg, abs(fract(y) - 0.5));
    a = max(a, bar * on * dash);`
      },
      truchet: {
          label: 'Truchet — arc maze',
          params: {
              cols: { label: 'Cells around', min: 3, max: 60, step: 1, val: 22 },
              rows: { label: 'Cell rows', min: 3, max: 60, step: 1, val: 24 },
              thick: { label: 'Stroke thickness', min: .02, max: .9, step: .01, val: .26, dp: 2 },
              seed: { label: 'Seed', min: 0, max: 60, step: 1, val: 3 },
              bias: { label: 'Orientation bias', min: 0, max: 1, step: .01, val: .5, dp: 2 }
          },
          glsl: `
    // Classic Truchet: each cell holds two quarter arcs joining opposite
    // edge midpoints, flipped at random. Thick stroke reads as connected
    // pills; thin stroke reads as a labyrinth.
    float aac = max(aa * p_rows, 0.0006);
    float row = floor(hz * p_rows);
    float col = floor(u * p_cols);
    vec2  c   = vec2(fract(u * p_cols) - 0.5, fract(hz * p_rows) - 0.5);
    if (hash21(vec2(col + p_seed, row)) > p_bias) c.x = -c.x;
    float d1  = abs(length(c - vec2(-0.5, -0.5)) - 0.5);
    float d2  = abs(length(c - vec2( 0.5,  0.5)) - 0.5);
    float d   = min(d1, d2) - p_thick * 0.5;
    a = max(a, fillSDF(d, aac));`
      },
      image: {
          label: 'Custom image tile…',
          params: {},
          glsl: `
    float iu = u * p_tileX;
    float iv = hz * p_tileY;
    vec4 s = texture2D(tileMap, vec2(fract(iu), fract(iv)));
    float m = s.a;
    if (p_inv > 0.5) m = 1.0 - m;
    a = max(a, m);`
      }
  };

  // Shared GLSL helpers + the pattern shader skeleton.
  const SHADER_HEAD = `
        #define PI 3.141592653589793
        #define NH 6
        varying vec3 vLocal;
        uniform float topA[NH];
        uniform float topB[NH];
        uniform float botA[NH];
        uniform float botB[NH];
        // Fourier evaluation of a measured edge profile. Written as a macro
        // because GLSL ES 1.0 can't take float arrays as function parameters.
        #define EDGE(A, B, t) ( A[0] \\
  + A[1]*cos(      t) + B[1]*sin(      t) \\
  + A[2]*cos(2.0 * t) + B[2]*sin(2.0 * t) \\
  + A[3]*cos(3.0 * t) + B[3]*sin(3.0 * t) \\
  + A[4]*cos(4.0 * t) + B[4]*sin(4.0 * t) \\
  + A[5]*cos(5.0 * t) + B[5]*sin(5.0 * t) )
        // one line every 1.0 in x, width t as a fraction of the period
        float lineWave(float x, float t, float w) {
  float d = abs(fract(x) - 0.5);          // 0 at the centre of each period
  return 1.0 - smoothstep(t * 0.5 - w, t * 0.5 + w, d);
        }
        // coverage for a line lying where the signed distance v is zero
        float lineAt(float v, float t, float w) {
  return 1.0 - smoothstep(t * 0.5 - w, t * 0.5 + w, abs(v));
        }
        // a single band centred on y0
        float band(float h, float y0, float t, float w) {
  return 1.0 - smoothstep(t * 0.5 - w, t * 0.5 + w, abs(h - y0));
        }

        // ---- motif helpers: signed distance fields + hashes ----------------
        // Filled shapes (rather than line art) for the halftone/motif patterns.
        float fillSDF(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
        vec2  rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
        float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
        float sdSeg(vec2 p, vec2 b) {                    // segment from origin to b
  float h = clamp(dot(p, b) / max(dot(b, b), 1e-6), 0.0, 1.0);
  return length(p - b * h);
        }
        float sdSegH(vec2 p, vec2 b, out float hOut) {   // same, reporting position along it
  float h = clamp(dot(p, b) / max(dot(b, b), 1e-6), 0.0, 1.0);
  hOut = h;
  return length(p - b * h);
        }
        float sdTri(vec2 p, float r) {                   // equilateral, pointing up
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
        }
        float hash11(float n) { return fract(sin(n * 12.9898) * 43758.5453123); }
        float hash21(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      `;

  function buildPatternShader(type, forBake) {
      const gen = GENERATORS[type];
      const { own, common } = paramsFor(type);
      // Generator params arrive as u_p_* and are re-declared inside main()
      // as p_* — pre-multiplied by the size ramp where the name says it is
      // a size. That way every generator body gets sizeBot/sizeTop for free.
      const uniformDecls =
          Object.keys(own).map(k => `uniform float u_p_${k};`).join('\n') + '\n' +
          Object.keys(common).map(k => `uniform float p_${k};`).join('\n');
      const localDecls = Object.keys(own)
          .map(k => `          float p_${k} = u_p_${k}${SCALABLE.indexOf(k) >= 0 ? ' * sz' : ''};`)
          .join('\n');
      const extra = type === 'image'
          ? 'uniform sampler2D tileMap;\nuniform float p_tileX;\nuniform float p_tileY;\nuniform float p_inv;'
          : '';
      // Bake pass: place the vertex by its UV, not by the camera.
      const vert = forBake ? `
  varying vec3 vLocal;
  uniform vec2 uvOffset;
  void main() {
    vLocal = position;
    vec2 p = uv + uvOffset;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }` : `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

      const frag = `
  ${SHADER_HEAD}
  ${uniformDecls}
  ${extra}
  uniform vec3  glowColor;
  uniform float glowStrength;
  uniform float yMin;
  uniform float yMax;
  uniform float bakeMode;
  uniform float p_rot;
  void main() {
    // Geometry angle: atan(x, z) puts 0 on +Z, the face the camera starts
    // on. The edge profiles are properties of the mesh, so they are always
    // evaluated at the true angle — only the pattern rotates.
    float thGeo = atan(vLocal.x, vLocal.z);
    float th    = mod(thGeo - radians(p_rot) + PI, 2.0 * PI) - PI;

    float yT = EDGE(topA, topB, thGeo);
    float yB = EDGE(botA, botB, thGeo);

    float hFlat = (vLocal.y - yMin) / max(1e-4, yMax - yMin);   // constant-Y rings
    float hFit  = (vLocal.y - yB)   / max(1e-4, yT - yB);       // follows both edges
    float h     = clamp(mix(hFlat, hFit, p_tilt), -0.5, 1.5);

    // Zone clip, then hz runs 0..1 inside the zone.
    float zLo = min(p_zFrom, p_zTo), zHi = max(p_zFrom, p_zTo);
    if (h < zLo || h > zHi) discard;
    float hz = (h - zLo) / max(1e-4, zHi - zLo);

    float u   = (th + PI) / (2.0 * PI);
    float aa  = max(fwidth(hz) * 0.9, 0.0004);
    float aau = fwidth(u) * 0.9;
    if (aau > 0.1 || aau <= 0.0) aau = 0.0008;   // kill the wrap seam spike

    // Feature-size ramp: bottom of the zone to the top.
    float sz = max(mix(p_sizeBot, p_sizeTop, clamp(hz, 0.0, 1.0)), 0.001);
  ${localDecls}

    float a = 0.0;
    ${gen.glsl}
    a = clamp(a, 0.0, 1.0);
    if (a < 0.004) discard;
    if (bakeMode > 0.5) {
      // Bake: white art + alpha, exactly like the existing PNGs.
      gl_FragColor = vec4(1.0, 1.0, 1.0, a);
    } else {
      gl_FragColor = vec4(glowColor * glowStrength, a);
    }
  }`;
      return { vert, frag };
  }

  // Measure where the sleeve actually starts and ends as a function of
  // angle, then fit each edge with a short Fourier series. Done from the
  // real geometry so it adapts to any model, not just this lamp.
  const NH = 6;
  function computeEdgeProfile(geometry) {
      const pos = geometry.attributes.position;
      // Deliberately coarse. A bin has to contain enough vertices to see
      // BOTH edges — with too many bins, a thinly-populated bin can hold
      // only base vertices, and then max(y) reports a bottom value as if
      // it were the top edge. ~145 verts per bin here.
      const NB = 64;
      const top = new Float32Array(NB).fill(-1e9);
      const bot = new Float32Array(NB).fill(1e9);
      const cnt = new Uint32Array(NB);
      for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const th = Math.atan2(x, z);
          let b = Math.floor((th + Math.PI) / (2 * Math.PI) * NB) % NB;
          if (b < 0) b += NB;
          if (y > top[b]) top[b] = y;
          if (y < bot[b]) bot[b] = y;
          cnt[b]++;
      }
      // A bin is only trustworthy if it is properly populated.
      const mean = pos.count / NB;
      const ok = b => cnt[b] >= Math.max(6, mean * 0.2);
      for (let b = 0; b < NB; b++) {
          if (ok(b)) continue;
          for (let d = 1; d < NB; d++) {
              const l = (b - d + NB) % NB, r = (b + d) % NB;
              if (ok(l)) { top[b] = top[l]; bot[b] = bot[l]; break; }
              if (ok(r)) { top[b] = top[r]; bot[b] = bot[r]; break; }
          }
      }
      // Circular 3-tap median filter — removes any remaining single-bin spike.
      const median3 = arr => {
          const out = arr.slice();
          for (let b = 0; b < NB; b++) {
              const t = [arr[(b - 1 + NB) % NB], arr[b], arr[(b + 1) % NB]].sort((x, y) => x - y);
              out[b] = t[1];
          }
          return out;
      };
      const topS = median3(top), botS = median3(bot);
      top.set(topS); bot.set(botS);
      const fit = vals => {
          const A = new Array(NH).fill(0), B = new Array(NH).fill(0);
          for (let k = 0; k < NH; k++) {
              let sc = 0, ss = 0;
              for (let i = 0; i < NB; i++) {
                  const th = (i + 0.5) / NB * 2 * Math.PI - Math.PI;
                  sc += vals[i] * Math.cos(k * th);
                  ss += vals[i] * Math.sin(k * th);
              }
              if (k === 0) A[0] = sc / NB;
              else { A[k] = 2 * sc / NB; B[k] = 2 * ss / NB; }
          }
          // Report the worst error so the UI can be honest about the fit.
          let res = 0;
          for (let i = 0; i < NB; i++) {
              const th = (i + 0.5) / NB * 2 * Math.PI - Math.PI;
              let s = A[0];
              for (let k = 1; k < NH; k++) s += A[k] * Math.cos(k * th) + B[k] * Math.sin(k * th);
              res = Math.max(res, Math.abs(vals[i] - s));
          }
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < NB; i++) { if (vals[i] < lo) lo = vals[i]; if (vals[i] > hi) hi = vals[i]; }
          return { A, B, res, swing: hi - lo };
      };
      const t = fit(top), b = fit(bot);
      return { topA: t.A, topB: t.B, botA: b.A, botB: b.B, topRes: t.res, topSwing: t.swing, botRes: b.res, botSwing: b.swing };
  }
  // ===========================================================================
  //  Recipes — the coded patterns. Add one entry per pattern; nothing else.
  //  These come straight from the studio's "Copy pattern recipe" button.
  // ===========================================================================
  const RECIPES = {
    // Example, and a live demonstration that a pattern needs no texture:
    // this is the client's Ladder motif, defined purely in code.
    'Ladder': {
      majestyPatternRecipe: 1,
      name: 'Ladder',
      generator: 'ladder',
      params: {
        rungs: 11, thick: 0.2, splitAt: 0.34, gapDeg: 8, spineW: 2, spineSep: 8,
        spineBot: 0.3, spineTop: 1, bands: 3, bandThick: 0.18
      },
      placement: { sizeBot: 1, sizeTop: 1, zFrom: 0, zTo: 1, tilt: 1 },
      rotateDeg: 0,
      emission: { colour: '#ff9a36', strength: 50, roughness: 0.5 },
      // Icon for the storefront's pattern picker. Same 100x100 viewBox and
      // currentColor convention as the buttons already in index.html.
      icon: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" ' +
            'stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
            '<line x1="18" y1="24" x2="42" y2="24"/><line x1="58" y1="24" x2="82" y2="24"/>' +
            '<line x1="18" y1="38" x2="42" y2="38"/><line x1="58" y1="38" x2="82" y2="38"/>' +
            '<line x1="18" y1="52" x2="42" y2="52"/><line x1="58" y1="52" x2="82" y2="52"/>' +
            '<line x1="42" y1="20" x2="42" y2="70"/><line x1="58" y1="20" x2="58" y2="70"/>' +
            '<line x1="16" y1="70" x2="84" y2="70"/><line x1="16" y1="82" x2="84" y2="82"/></svg>'
    }
  };

  const GENERIC_ICON = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" ' +
    'stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
    '<rect x="22" y="22" width="56" height="56" rx="8"/>' +
    '<path d="M22,58 L40,42 L58,58 L70,48 L78,56"/></svg>';

  /** Resolve a recipe's slider values into the flat map buildPatternShader wants. */
  function recipeValues(recipe) {
    const spec = paramsFor(recipe.generator);
    const values = {};
    for (const [k, p] of Object.entries(spec.own)) {
      values[k] = (recipe.params && recipe.params[k] != null) ? recipe.params[k] : p.val;
    }
    for (const [k, p] of Object.entries(spec.common)) {
      values[k] = (recipe.placement && recipe.placement[k] != null) ? recipe.placement[k] : p.val;
    }
    return values;
  }

  /**
   * Build the uniform set for a recipe. `edges` comes from computeEdgeProfile();
   * pass null on a model whose edges have not been measured and the pattern
   * falls back to flat, constant-Y bands.
   */
  function makeUniforms(THREE, recipe, edges, opts) {
    opts = opts || {};
    const type = recipe.generator;
    const values = recipeValues(recipe);
    const e = edges || {
      topA: [2, 0, 0, 0, 0, 0], topB: [0, 0, 0, 0, 0, 0],
      botA: [-2, 0, 0, 0, 0, 0], botB: [0, 0, 0, 0, 0, 0]
    };
    const em = recipe.emission || {};
    const colour = new THREE.Color(em.colour || '#ff9a36');

    const u = {
      glowColor: { value: colour },
      glowStrength: { value: opts.glowStrength != null ? opts.glowStrength : 1.0 },
      yMin: { value: opts.yMin != null ? opts.yMin : -2.0333 },
      yMax: { value: opts.yMax != null ? opts.yMax : 2.0624 },
      bakeMode: { value: 0 },
      p_rot: { value: recipe.rotateDeg || 0 },
      topA: { value: e.topA.slice() }, topB: { value: e.topB.slice() },
      botA: { value: e.botA.slice() }, botB: { value: e.botB.slice() },
      uvOffset: { value: new THREE.Vector2(0, 0) }
    };
    const spec = paramsFor(type);
    for (const k of Object.keys(spec.own)) u['u_p_' + k] = { value: values[k] };
    for (const k of Object.keys(spec.common)) u['p_' + k] = { value: values[k] };
    if (type === 'image') {
      u.tileMap = { value: opts.tileMap || null };
      const t = recipe.imageTile || {};
      u.p_tileX = { value: t.repeatAround != null ? t.repeatAround : 4 };
      u.p_tileY = { value: t.repeatVertical != null ? t.repeatVertical : 3 };
      u.p_inv = { value: t.invert ? 1 : 0 };
    }
    return u;
  }

  /**
   * Ready-to-use material for the lamp's pattern sleeve.
   *
   * Emissive-looking and double-sided with BLEND, matching the baked pattern
   * materials in the GLB (emissive [1, 0.605, 0.214], strength 50, roughness
   * 0.5) so a coded pattern sits in the scene exactly like a shipped one and
   * blooms through the site's selective-bloom pass unchanged.
   */
  /**
   * SITE material — for the storefront, where a coded pattern must be
   * indistinguishable from a baked one.
   *
   * This is a real MeshStandardMaterial configured exactly like the shipped
   * pattern materials (same emissive colour, same emissiveIntensity, same
   * BLEND + double-sided), with the procedural mask injected via
   * onBeforeCompile. Because it is the same material class, it goes through the
   * identical path: lighting, envMap, ACES tonemapping, sRGB encoding, and the
   * selective-bloom pass. Only the coverage comes from code instead of a PNG.
   *
   * A raw ShaderMaterial cannot match: it writes gl_FragColor directly and so
   * skips tonemapping and output encoding entirely.
   */
  function makeSiteMaterial(THREE, recipe, edges, opts) {
    opts = opts || {};
    const built = buildPatternShader(recipe.generator, false);
    const uniforms = makeUniforms(THREE, recipe, edges, opts);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      metalness: opts.metalness != null ? opts.metalness : 0,
      roughness: opts.roughness != null ? opts.roughness : 0.5,
      emissive: new THREE.Color(opts.emissive != null ? opts.emissive : 0xffa500),
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 10
    });

    // Pull just the declarations (uniforms + helpers) out of the generated
    // fragment shader, and the pattern body, so they can be spliced into the
    // standard material rather than replacing it.
    const frag = built.frag;
    const declEnd = frag.indexOf('void main()');
    const decls = frag.slice(0, declEnd)
      .replace(/varying\s+vec3\s+vLocal\s*;/g, '')        // declared below instead
      + '\nvarying vec3 vLocalPat;\n';
    const bodyStart = frag.indexOf('{', declEnd) + 1;
    const bodyEnd = frag.lastIndexOf('}');
    const body = frag.slice(bodyStart, bodyEnd)
      // the generated body ends by writing gl_FragColor; we only want `a`
      .replace(/if\s*\(bakeMode[\s\S]*$/, '')
      .replace(/vLocal/g, 'vLocalPat');

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vLocalPat;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLocalPat = position;');

      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', decls + '\nvoid main() {')
        // spliced where diffuseColor and totalEmissiveRadiance both exist, so the
        // mask drives BOTH the alpha and the emissive contribution
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          '  {\n' + body + '\n' +
          '    if (a < 0.004) discard;\n' +
          '    diffuseColor.a *= a;\n' +
          '    totalEmissiveRadiance *= a;\n' +
          '  }');
    };

    mat.userData.patternUniforms = uniforms;
    mat.customProgramCacheKey = () => 'majesty-pattern-' + recipe.generator;
    return mat;
  }

  function makeMaterial(THREE, recipe, edges, opts) {
    opts = opts || {};
    const built = buildPatternShader(recipe.generator, false);
    const em = recipe.emission || {};
    // glTF emissiveStrength ~50 is far past what a preview can show literally;
    // map it into a sane display range, same as the studio does.
    const strength = em.strength != null ? em.strength : 50;
    const uniforms = makeUniforms(THREE, recipe, edges, Object.assign({
      glowStrength: 0.6 + (strength / 50) * 1.4
    }, opts));

    return new THREE.ShaderMaterial({
      vertexShader: built.vert,
      fragmentShader: built.frag,
      uniforms: uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      extensions: { derivatives: true }
    });
  }

  global.MajestyPatterns = {
    version: 1,
    GENERATORS: GENERATORS,
    COMMON_PARAMS: COMMON_PARAMS,
    SCALABLE: SCALABLE,
    SHADER_HEAD: SHADER_HEAD,
    paramsFor: paramsFor,
    buildPatternShader: buildPatternShader,
    computeEdgeProfile: computeEdgeProfile,
    recipeValues: recipeValues,
    makeUniforms: makeUniforms,
    makeMaterial: makeMaterial,
    makeSiteMaterial: makeSiteMaterial,
    RECIPES: RECIPES,
    /** names of the coded patterns, for building UI */
    codedNames: function () { return Object.keys(RECIPES); },
    iconFor: function (name) {
      const r = RECIPES[name];
      return (r && r.icon) ? r.icon : GENERIC_ICON;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
