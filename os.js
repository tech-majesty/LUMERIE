/* =============================================================================
 *  MAJESTY OS — the interface, drawn into the screen
 *
 *  Not a panel over the canvas. A 1024 square texture, painted with Canvas2D
 *  and mapped onto a disc lying on the lamp's glass, so the interface is lit,
 *  reflected and foreshortened with the product it runs on.
 *
 *  THE GLASS IS NOT FLAT ON TOP. Measured off the model: all 256 triangles of
 *  Screen_Main_(Gold) lie within 3 degrees of one plane, and that plane is
 *  tilted 35.89 degrees toward the viewer, normal (0, 0.8102, 0.5862), centred
 *  at (0, 0.105, 0.0007). hero.js flies the camera down that normal; a straight
 *  top down shot would look at the screen edge on.
 *
 *  BECAUSE IT IS A TEXTURE, THERE ARE NO ELEMENTS. Every control is drawn, and
 *  registers a rectangle in canvas space as it is drawn. A pointer over the
 *  lamp is raycast onto the disc, the hit gives a UV, the UV is canvas pixels,
 *  and the rectangle under it is the control. Immediate mode: draw() rebuilds
 *  the picture and the hit list together, so they cannot drift apart.
 *
 *  Type is drawn at 1024 across a disc about 500 wide on screen, so roughly two
 *  texture pixels per display pixel. That is what keeps it off the grey mush a
 *  smaller texture gives.
 *
 *  THE DESIGN. Hairlines, tracked capitals, one weight of gold, and almost no
 *  fills: a filled card inside a circular bezel reads as a website pasted onto
 *  a product. The only solid shape on any screen is the single primary action.
 *
 *  MOTION. Everything that changes is eased rather than swapped. The tween
 *  registry at the bottom is two dozen lines and covers all of it: view
 *  changes crossfade and rise, hovers grow, the toast lifts, stars fill. tick()
 *  reports whether anything is still moving so hero.js knows to keep drawing.
 * ========================================================================== */
(function () {
    'use strict';

    const S = 1024;
    const C = S / 2;
    const FONT = "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    const GOLD = '#c8a04a';
    const GOLD_SOFT = '#e2c07a';
    const INK = '#f7f4f0';
    const DIM = '#a9a29a';
    const FAINT = '#6f6862';

    const COL = 320;              // half width of the content column
    const L = C - COL, R = C + COL;

    /*
     *  One dial for the whole layout's weight. Everything below is written
     *  against a 1024 design square and then scaled about the centre, so the
     *  interface can be made to sit heavier or lighter in the bezel without
     *  touching a single coordinate. Hit testing divides it back out.
     */
    // 1.10 with a 320 column keeps the far corner of the widest row 474 from
    // the centre, inside the 512 the circle allows. Pushing either further
    // clips the bottom rows against the bezel.
    const SCALE = 1.10;

    /* -------------------------------------------------------------------------
     *  The content
     *
     *  A demo, but not lorem: every screen is one of the claims the page makes
     *  further up, made touchable. "Personalized welcomes" is the greeting,
     *  "atmosphere that adapts light and mood" is Ambience, and Ambience really
     *  does relight the lamp the screen is sitting in.
     * ---------------------------------------------------------------------- */
    const GUEST = { name: 'Ms Haddad', table: '12', covers: 4, course: 2, courses: 5 };

    const MENU = [
        {
            group: 'Signatures', items: [
                { n: 'Wagyu, smoked date, sumac', d: 'A5 striploin, 45 day aged', p: 420 },
                { n: 'Hammour, saffron beurre blanc', d: 'Line caught, Musandam', p: 285 },
                { n: 'Truffle kunafa', d: 'Akkawi, Périgord truffle', p: 195 }
            ]
        },
        {
            group: 'Mezze', items: [
                { n: 'Hummus, lamb, pine', d: 'Warm, with saj bread', p: 95 },
                { n: 'Fattoush, pomegranate', d: 'Sumac, mint, purslane', p: 85 },
                { n: 'Scallop, labneh, harissa', d: 'Hokkaido, seared rare', p: 165 }
            ]
        },
        {
            group: 'Sweet', items: [
                { n: 'Rose and pistachio mille feuille', d: 'Damask rose cream', p: 110 },
                { n: 'Dark chocolate and cardamom', d: '72% Valrhona, sea salt', p: 105 }
            ]
        }
    ];

    // Each mood names a pattern that exists in pattern-engine.js.
    const MOODS = [
        { k: 'Intimate', pattern: 'Arabic', note: 'Warm, low, close', warm: 88 },
        { k: 'Golden Hour', pattern: 'Ladder', note: 'Long light, unhurried', warm: 62 },
        { k: 'Celebration', pattern: 'Data Rain', note: 'Bright, alive', warm: 34 }
    ];

    const SERVICE = [
        { k: 'Call the waiter', done: 'Yusuf is on his way' },
        { k: 'Still water', done: 'Water is coming to the table' },
        { k: 'Sommelier', done: 'Rania will be with you shortly' },
        { k: 'Request the bill', done: 'The bill is being prepared' }
    ];

    const TAGS = ['Service', 'Food', 'The room', 'The pace', 'Lighting'];

    const HOME = [
        ['Menu', 'menu'],
        ['Ambience', 'ambience'],
        ['Service', 'service'],
        ['Feedback', 'feedback']
    ];

    /* ----- state ------------------------------------------------------------ */

    const state = {
        view: 'home', pending: null,
        group: 0, order: [], fired: false,
        mood: 0, stars: 0, tags: [], sent: false,
        hover: null, toast: '', toastUntil: 0
    };

    let canvas = null, ctx = null;
    let hits = [];
    let ready = false;
    /*
     *  A state change has to force one draw even when nothing is animating.
     *  Tween TARGETS are only written during draw — asking for a value is what
     *  registers it — so a change that has not been drawn yet is invisible to
     *  stepAnims, and tick would report "nothing moving" forever. One frame
     *  breaks the circle: it registers the new targets, and the easing takes
     *  over from there.
     */
    let dirty = true;

    const api = { onMood: null, onClose: null, onChange: null };

    /* -------------------------------------------------------------------------
     *  Tweens
     *
     *  Everything animated is a named number that chases a target. Values are
     *  read during draw and stepped once a frame, so a control can animate
     *  without anything having to remember it exists: asking for its value
     *  registers it, and a control that stops being drawn simply settles.
     * ---------------------------------------------------------------------- */
    const tw = Object.create(null);

    function anim(key, target, rate) {
        let o = tw[key];
        if (!o) o = tw[key] = { v: target, t: target, r: rate || 9 };
        o.t = target;
        o.r = rate || 9;
        return o.v;
    }

    function stepAnims(dt) {
        let moving = false;
        for (const k in tw) {
            const o = tw[k];
            const d = o.t - o.v;
            if (Math.abs(d) < 0.0008) { o.v = o.t; continue; }
            // Frame rate independent exponential approach.
            o.v += d * (1 - Math.exp(-o.r * dt));
            moving = true;
        }
        return moving;
    }

    /* ----- primitives -------------------------------------------------------- */

    /*
     *  Default weight is 400, not 300. On a texture that is resampled by the
     *  GPU, a 300 at 20px loses most of its stem and reads as grey rather than
     *  as type; the earlier pass was thin everywhere and that is most of what
     *  looked cheap. 300 is now reserved for display sizes, where it is doing
     *  the job it is for.
     */
    function font(size, weight) { return (weight || 400) + ' ' + size + 'px ' + FONT; }

    function alpha(hex, a) {
        // The palette is hex; hairlines and fades need it with an alpha.
        const n = parseInt(hex.slice(1), 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
        const rr = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }

    function label(str, x, y, o) {
        o = o || {};
        ctx.save();
        ctx.font = font(o.size || 26, o.weight);
        ctx.fillStyle = o.colour || INK;
        ctx.textBaseline = 'alphabetic';
        if (o.tracking) {
            // Canvas2D letter-spacing is not universal yet, so tracked capitals
            // are drawn a glyph at a time.
            const chars = str.split('');
            let total = -o.tracking;
            chars.forEach(function (ch) { total += ctx.measureText(ch).width + o.tracking; });
            let cx = o.align === 'center' ? x - total / 2 : (o.align === 'right' ? x - total : x);
            ctx.textAlign = 'left';
            chars.forEach(function (ch) {
                ctx.fillText(ch, cx, y);
                cx += ctx.measureText(ch).width + o.tracking;
            });
            ctx.restore();
            return total;
        }
        ctx.textAlign = o.align || 'left';
        ctx.fillText(str, x, y);
        const w = ctx.measureText(str).width;
        ctx.restore();
        return w;
    }

    function measure(str, size, weight) {
        ctx.save();
        ctx.font = font(size, weight);
        const w = ctx.measureText(str).width;
        ctx.restore();
        return w;
    }

    function clip(str, max, size, weight) {
        if (measure(str, size, weight) <= max) return str;
        let s = str;
        while (s.length > 1 && measure(s + '…', size, weight) > max) s = s.slice(0, -1);
        return s + '…';
    }

    function hairline(y, from, to, a) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(from, y);
        ctx.lineTo(to, y);
        ctx.strokeStyle = 'rgba(255,250,242,' + (a == null ? 0.09 : a) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    function hit(id, x, y, w, h, fn) {
        hits.push({ id: id, x: x, y: y, w: w, h: h, fn: fn });
        return anim('h:' + id, state.hover === id ? 1 : 0, 14);
    }

    /* ----- chrome ------------------------------------------------------------ */

    function drawBase() {
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, C - 2, 0, Math.PI * 2);
        ctx.clip();

        // Not opaque. The glass underneath still has to read as glass, and the
        // lamp's own reflection in it is half of why this looks like a screen.
        const g = ctx.createRadialGradient(C, C * 0.7, 0, C, C, C);
        // Graphite, not black. Near enough opaque — the lamp's own screen
        // carries a baked MAJESTY crown and under about 0.99 it ghosts through
        // — but black at this size reads as a hole cut in the product rather
        // than as a lit surface, and it gives the type nothing to sit on.
        g.addColorStop(0, 'rgba(41, 38, 35, 0.992)');
        g.addColorStop(0.62, 'rgba(28, 26, 24, 0.995)');
        g.addColorStop(1, 'rgba(17, 16, 15, 0.998)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);

        const sh = ctx.createLinearGradient(S * 0.08, 0, S * 0.8, S * 0.72);
        sh.addColorStop(0, 'rgba(255, 250, 242, 0.10)');
        sh.addColorStop(0.55, 'rgba(255, 250, 242, 0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, 0, S, S);

        // A warm bloom low on the disc, picked up off the lamp's own light. It
        // is what stops the bottom third going flat and dead.
        const warm = ctx.createRadialGradient(C, S * 0.98, 10, C, S * 0.98, S * 0.66);
        warm.addColorStop(0, 'rgba(200, 160, 74, 0.10)');
        warm.addColorStop(1, 'rgba(200, 160, 74, 0)');
        ctx.fillStyle = warm;
        ctx.fillRect(0, 0, S, S);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, C - 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232, 214, 176, 0.26)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }


    function drawToast(fade) {
        const on = state.toast && Date.now() < state.toastUntil ? 1 : 0;
        const t = anim('toast', on, 11);
        if (t < 0.01) return;
        const y = S - 138 - t * 10;
        ctx.save();
        ctx.globalAlpha = t * fade;
        const w = Math.min(measure(state.toast, 23, 400) + 60, 560);
        roundRect(C - w / 2, y - 25, w, 50, 25);
        ctx.fillStyle = GOLD_SOFT;
        ctx.fill();
        label(clip(state.toast, w - 52, 23, 400), C, y + 8,
            { size: 23, weight: 400, colour: '#14100e', align: 'center' });
        ctx.restore();
    }

    /* -------------------------------------------------------------------------
     *  The visual language
     *
     *  A circular screen should be laid out radially. The first pass here was a
     *  column of rows with a circle drawn round it, which is the same mistake as
     *  a card inside a bezel: the shape of the hardware was decoration rather
     *  than structure.
     *
     *  So: the home screen is a dial. A hub in the middle carrying the table's
     *  state, six satellites on a ring around it, labels outside those. Inside a
     *  section, the language changes to big soft pills stacked in the middle of
     *  the disc, because that is the shape that survives being clipped by a
     *  circle, and a round control returns to the dial.
     *
     *  Everything is large. A screen a diner reaches across a laid table for is
     *  not a phone held at 30cm.
     * ---------------------------------------------------------------------- */

    /** A small context pill, the way a section announces itself. */
    function chip(str, y, id, fn) {
        const w = measure(str.toUpperCase(), 20, 400) + 62;
        const a = id ? hit(id, C - w / 2, y - 24, w, 48, fn) : 0;
        ctx.save();
        roundRect(C - w / 2, y - 24, w, 48, 24);
        ctx.fillStyle = 'rgba(255,250,242,' + (0.055 + a * 0.09) + ')';
        ctx.fill();
        ctx.restore();
        label(str.toUpperCase(), C, y + 7,
            { size: 19, weight: 500, colour: a > 0.4 ? INK : DIM, align: 'center', tracking: 5 });
        return w;
    }

    function bigTitle(str, y, size) {
        label(str, C, y, { size: size || 54, weight: 300, colour: INK, align: 'center' });  // display size, thin is right here
    }

    /**
     * The wide pill that carries every option inside a section.
     *
     * Left label, right value, and an optional fill that runs from the left the
     * way a level does. The dotted spine is what keeps it from reading as a
     * button: it says this row has positions, not one action.
     */
    function pillRow(id, y, left, right, o) {
        o = o || {};
        const w = 640, h = 96, x = C - w / 2;
        const a = hit(id, x, y, w, h, o.fn);

        ctx.save();
        roundRect(x, y, w, h, h / 2);
        ctx.fillStyle = 'rgba(255,250,242,' + (0.05 + a * 0.05) + ')';
        ctx.fill();

        if (o.fill != null) {
            ctx.save();
            roundRect(x, y, w, h, h / 2);
            ctx.clip();
            ctx.fillStyle = 'rgba(255,250,242,' + (0.07 + a * 0.04) + ')';
            ctx.fillRect(x, y, w * Math.max(0, Math.min(1, o.fill)), h);
            ctx.restore();
            // The head of the fill, as a bright bar rather than a knob.
            const hx = x + w * Math.max(0, Math.min(1, o.fill));
            ctx.beginPath();
            ctx.moveTo(hx, y + 26);
            ctx.lineTo(hx, y + h - 26);
            ctx.strokeStyle = alpha(GOLD_SOFT, 0.9);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        } else if (o.dots !== false) {
            for (let i = 1; i <= 5; i++) {
                ctx.beginPath();
                ctx.arc(x + w * (0.34 + i * 0.083), y + h / 2, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,250,242,0.16)';
                ctx.fill();
            }
        }
        ctx.restore();

        label(clip(left, 300, 30, 400), x + 42, y + h / 2 + 11,
            { size: 30, weight: 400, colour: o.muted ? DIM : INK });
        if (right != null) {
            label(String(right), x + w - 42, y + h / 2 + 11,
                { size: 30, weight: 400, colour: o.accent ? GOLD : INK, align: 'right' });
        }
        if (o.sub) {
            label(clip(o.sub, 300, 19, 400), x + 42, y + h / 2 + 34, { size: 19, colour: FAINT });
        }
        return a;
    }

    /** A round control. Solid when it is the thing to press, outlined otherwise. */
    function roundBtn(id, cx, cy, r, glyph, o) {
        o = o || {};
        const a = o.disabled ? 0 : hit(id, cx - r, cy - r, r * 2, r * 2, o.fn);
        ctx.save();
        ctx.globalAlpha = o.disabled ? 0.3 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r + a * 2, 0, Math.PI * 2);
        if (o.solid) {
            ctx.fillStyle = a > 0.5 ? '#ffffff' : INK;
            ctx.fill();
        } else {
            ctx.fillStyle = 'rgba(255,250,242,' + (0.06 + a * 0.08) + ')';
            ctx.fill();
        }
        ctx.restore();
        label(glyph, cx, cy + (o.dy == null ? 12 : o.dy), {
            size: o.size || 34, weight: 300, align: 'center',
            colour: o.solid ? '#14100e' : (a > 0.4 ? INK : DIM)
        });
        return a;
    }

    /* ----- icons, drawn as strokes ------------------------------------------ */

    function icon(name, cx, cy, s, colour) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(s / 24, s / 24);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.7;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (name === 'menu') {
            ctx.moveTo(-9, -7); ctx.lineTo(9, -7);
            ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
            ctx.moveTo(-9, 7); ctx.lineTo(3, 7);
        } else if (name === 'ambience') {
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            for (let i = 0; i < 8; i++) {
                const a = i * Math.PI / 4;
                ctx.moveTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
                ctx.lineTo(Math.cos(a) * 11.5, Math.sin(a) * 11.5);
            }
        } else if (name === 'service') {
            ctx.moveTo(-10, 5); ctx.lineTo(10, 5);
            ctx.moveTo(-8, 5); ctx.arc(0, 5, 8, Math.PI, 0);
            ctx.moveTo(0, -3); ctx.lineTo(0, -7);
        } else if (name === 'order') {
            ctx.moveTo(-7, -10); ctx.lineTo(7, -10); ctx.lineTo(7, 10);
            ctx.lineTo(4, 7.5); ctx.lineTo(0, 10); ctx.lineTo(-4, 7.5); ctx.lineTo(-7, 10);
            ctx.closePath();
            ctx.moveTo(-3.5, -5); ctx.lineTo(3.5, -5);
            ctx.moveTo(-3.5, 0); ctx.lineTo(3.5, 0);
        } else if (name === 'feedback') {
            const R = 10, r2 = 4.2;
            for (let i = 0; i < 10; i++) {
                const rad = i % 2 ? r2 : R;
                const a = -Math.PI / 2 + i * Math.PI / 5;
                const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
        } else if (name === 'bill') {
            ctx.moveTo(-11, -6.5); ctx.lineTo(11, -6.5); ctx.lineTo(11, 6.5); ctx.lineTo(-11, 6.5);
            ctx.closePath();
            ctx.moveTo(-11, -2); ctx.lineTo(11, -2);
            ctx.moveTo(-7, 3); ctx.lineTo(-2, 3);
        }
        ctx.stroke();
        ctx.restore();
    }

    /* ----- screens ------------------------------------------------------------ */

    const DIAL = [
        { k: 'Menu', i: 'menu', v: 'menu' },
        { k: 'Favourites', i: 'feedback', v: 'feedback' },
        { k: 'Order', i: 'order', v: 'order' },
        { k: 'Bill', i: 'bill', v: 'bill' },
        { k: 'Service', i: 'service', v: 'service' },
        { k: 'Ambience', i: 'ambience', v: 'ambience' }
    ];

    /**
     * The dial.
     *
     * A thick segmented ring with an icon in each wedge, and a large light knob
     * in the middle. The knob is the brightest thing on the screen on purpose:
     * on a black glass disc it is the one element that reads as hardware rather
     * than as software, and it gives the eye somewhere to start.
     *
     * The wedges carry icons only. Six labels on a ring is a wheel of words at
     * six different angles; instead the knob names whatever the hand is over,
     * so there is exactly one label on screen and it is always in the same
     * place, at the size the eye is already focused on.
     */
    function screenHome() {
        const R0 = 168, R1 = 306, GAP = 0.026;
        const KNOB = 138;

        // Ring bed, so the wedges sit in something rather than float.
        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, R1 + 6, 0, Math.PI * 2);
        ctx.arc(C, C, R0 - 6, Math.PI * 2, 0, true);
        ctx.fillStyle = 'rgba(255,250,242,0.035)';
        ctx.fill();
        ctx.restore();

        let named = null;

        DIAL.forEach(function (d, i) {
            const step = Math.PI * 2 / DIAL.length;
            // Start at the top and centre the first wedge on twelve o'clock.
            const a0 = -Math.PI / 2 - step / 2 + i * step + GAP / 2;
            const a1 = a0 + step - GAP;
            const mid = (a0 + a1) / 2;

            const ix = C + Math.cos(mid) * (R0 + R1) / 2;
            const iy = C + Math.sin(mid) * (R0 + R1) / 2;
            const a = hit('dial' + i, ix - 62, iy - 62, 124, 124, function () { nav(d.v); });
            if (a > 0.5) named = d.k;

            ctx.save();
            ctx.beginPath();
            ctx.arc(C, C, R1, a0, a1);
            ctx.arc(C, C, R0, a1, a0, true);
            ctx.closePath();
            const wg = ctx.createRadialGradient(C, C, R0, C, C, R1);
            wg.addColorStop(0, 'rgba(255,250,242,' + (0.10 + a * 0.13) + ')');
            wg.addColorStop(1, 'rgba(255,250,242,' + (0.05 + a * 0.10) + ')');
            ctx.fillStyle = wg;
            ctx.fill();
            ctx.restore();

            icon(d.i, ix, iy, 52 + a * 3,
                a > 0.4 ? '#ffffff' : 'rgba(247,244,240,0.66)');
        });

        /*
         *  The knob. A light disc with a bevel: a bright rim at the top left
         *  where the room's key would catch it, a dark one at the bottom right,
         *  and a face that falls off toward the edge. Three gradients, and it
         *  stops looking like a filled circle.
         */
        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C + 5, KNOB + 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.filter = 'blur(14px)';
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, KNOB + 7, 0, Math.PI * 2);
        const bevel = ctx.createLinearGradient(C - KNOB, C - KNOB, C + KNOB, C + KNOB);
        bevel.addColorStop(0, 'rgba(255,252,246,0.95)');
        bevel.addColorStop(0.5, 'rgba(190,183,171,0.75)');
        bevel.addColorStop(1, 'rgba(120,114,104,0.85)');
        ctx.fillStyle = bevel;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, KNOB, 0, Math.PI * 2);
        const face = ctx.createLinearGradient(C - KNOB * 0.7, C - KNOB, C + KNOB * 0.6, C + KNOB);
        face.addColorStop(0, '#fbf8f2');
        face.addColorStop(0.55, '#efeae0');
        face.addColorStop(1, '#d9d3c7');
        ctx.fillStyle = face;
        ctx.fill();
        ctx.restore();

        // Machined ring, the way a real control has a turned edge.
        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, KNOB - 13, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20,16,14,0.10)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Course progress, riding the knob's shoulder in gold.
        const t = anim('course', GUEST.course / GUEST.courses, 4);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(C, C, KNOB + 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        const sub = anim('knobSub', named ? 1 : 0, 14);
        label('TABLE ' + GUEST.table, C, C - 26,
            { size: 19, weight: 500, colour: 'rgba(20,16,14,0.45)', align: 'center', tracking: 5 });
        label(GUEST.name, C, C + 16,
            { size: 34, weight: 400, colour: '#14100e', align: 'center' });
        ctx.save();
        ctx.globalAlpha = 1;
        label(named || ('Course ' + GUEST.course + ' of ' + GUEST.courses), C, C + 50, {
            size: 19, weight: 500, align: 'center',
            colour: named
                ? 'rgba(150,112,30,' + (0.5 + sub * 0.5) + ')'
                : 'rgba(20,16,14,0.42)'
        });
        ctx.restore();
    }

    /** Every section shares this: a chip, a title, and a way back to the dial. */
    function sectionHead(chipText, titleText, titleSize) {
        chip(chipText, 210);
        if (titleText) bigTitle(titleText, 300, titleSize);
    }

    /*
     *  The way back, and it has to be obvious.
     *
     *  It was a bare arrow in a faint circle, low on the disc where the glass
     *  curves away, and it was genuinely hard to find. It is now a labelled
     *  pill in the same place on every screen, bright enough to be the second
     *  thing the eye lands on after the title.
     */
    function backPill(y) {
        // Clamped: some screens run long and would otherwise push this onto the
        // curve of the disc, where half of it is clipped by the bezel.
        const yy = Math.min(y || 838, 862);
        const str = 'Back';
        const w = measure(str, 24, 400) + 108;
        const h = 62;
        const a = hit('back', C - w / 2, yy - h / 2, w, h, function () { nav('home'); });
        ctx.save();
        roundRect(C - w / 2, yy - h / 2, w, h, h / 2);
        ctx.fillStyle = 'rgba(255,250,242,' + (0.10 + a * 0.10) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,250,242,' + (0.14 + a * 0.18) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        label('←', C - w / 2 + 34, yy + 10, { size: 26, colour: a > 0.4 ? GOLD_SOFT : DIM });
        label(str, C + 14, yy + 9, { size: 24, weight: 400, colour: a > 0.4 ? INK : 'rgba(247,244,240,0.82)' });
    }

    function screenMenu() {
        sectionHead('The menu', null);

        const gap = 18;
        let total = -gap;
        MENU.forEach(function (g) { total += measure(g.group.toUpperCase(), 20, 400) + 62 + gap; });
        let x = C - total / 2;
        MENU.forEach(function (g, i) {
            const w = measure(g.group.toUpperCase(), 20, 400) + 62;
            const live = anim('tabLit' + i, i === state.group ? 1 : 0, 11);
            const a = hit('tab' + i, x, 268, w, 48, function () { state.group = i; });
            ctx.save();
            roundRect(x, 268, w, 48, 24);
            ctx.fillStyle = live > 0.02 ? alpha(GOLD, 0.14 + live * 0.1)
                : 'rgba(255,250,242,' + (0.045 + a * 0.06) + ')';
            ctx.fill();
            if (live > 0.02) {
                ctx.strokeStyle = alpha(GOLD, live * 0.6);
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
            label(g.group.toUpperCase(), x + w / 2, 299,
                { size: 20, colour: live > 0.5 ? GOLD_SOFT : (a > 0.4 ? INK : DIM), align: 'center', tracking: 4 });
            x += w + gap;
        });

        let y = 360;
        MENU[state.group].items.forEach(function (it, i) {
            pillRow('dish' + state.group + '_' + i, y, it.n, it.p, {
                sub: it.d, dots: false, accent: true,
                fn: function () {
                    const f = state.order.filter(function (o) { return o.n === it.n; })[0];
                    if (f) f.q++; else state.order.push({ n: it.n, p: it.p, q: 1 });
                    state.fired = false;
                    toast(it.n.split(',')[0] + ' added');
                }
            });
            y += 110;
        });

        const n = state.order.reduce(function (a, o) { return a + o.q; }, 0);
        if (n) roundBtn('toOrder', C + 92, 826, 40, String(n), { fn: function () { nav('order'); }, size: 28, solid: true, dy: 10 });
        backPill();
    }

    function screenOrder() {
        sectionHead(state.fired ? 'With the kitchen' : 'Your order', null);

        if (!state.order.length) {
            bigTitle('Nothing yet', 400, 46);
            lede('Everything on the menu comes to this screen.', 452, 460);
            roundBtn('toMenu', C, 560, 52, '＋', { fn: function () { nav('menu'); }, size: 34, solid: true, dy: 12 });
            backPill();
            return;
        }

        let y = 300;
        state.order.slice(0, 3).forEach(function (o, i) {
            pillRow('item' + i, y, o.n, null, { dots: false, sub: 'AED ' + o.p });
            const yc = y + 48;
            roundBtn('q' + i + '_0', C + 214, yc, 30, '−', {
                size: 30, dy: 10, fn: function () {
                    o.q--; if (o.q <= 0) state.order.splice(i, 1);
                    state.fired = false;
                }
            });
            label(String(o.q), C + 262, yc + 10, { size: 26, colour: INK, align: 'center' });
            roundBtn('q' + i + '_1', C + 310, yc, 30, '+', {
                size: 30, dy: 10, fn: function () { o.q++; state.fired = false; }
            });
            y += 110;
        });

        const total = state.order.reduce(function (a, i) { return a + i.q * i.p; }, 0);
        label('TOTAL', C, y + 26, { size: 19, colour: FAINT, align: 'center', tracking: 5 });
        label('AED ' + Math.round(anim('total', total, 7)).toLocaleString('en-US'),
            C, y + 78, { size: 46, weight: 300, colour: INK, align: 'center' });

        if (state.fired) {
            const d = new Date();
            label('Fired at ' + String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0') + ' · Chef Karim has it',
                C, y + 128, { size: 21, colour: GOLD, align: 'center' });
        } else {
            roundBtn('fire', C, y + 152, 46, '↑', {
                solid: true, size: 34, dy: 12,
                fn: function () { state.fired = true; toast('The kitchen has your order'); }
            });
        }
        backPill(y + 152 > 780 ? 900 : 826);
    }

    /**
     * The mood wheel. Three wedges around the hub, the live one bright and
     * reaching further out. A circular control for a circular screen, and the
     * one screen where the shape of the hardware is doing real work.
     */
    function screenAmbience() {
        sectionHead('Ambience', null);

        const cy = C + 40, r0 = 96, r1 = 250;
        MOODS.forEach(function (m, i) {
            const a0 = -Math.PI / 2 + i * (Math.PI * 2 / 3) + 0.035;
            const a1 = a0 + (Math.PI * 2 / 3) - 0.07;
            const mid = (a0 + a1) / 2;
            const live = anim('moodLit' + i, i === state.mood ? 1 : 0, 9);

            // A wedge is not a rectangle, so it gets its own hit box around the
            // point the label sits at. Close enough at this size, and it keeps
            // the hit list to plain rectangles.
            const hx = C + Math.cos(mid) * (r0 + r1) / 2;
            const hy = cy + Math.sin(mid) * (r0 + r1) / 2;
            const hv = hit('mood' + i, hx - 92, hy - 76, 184, 152, function () {
                state.mood = i;
                if (api.onMood) api.onMood(m.pattern);
                toast(m.k);
            });

            const grow = live * 16 + hv * 8;
            ctx.save();
            ctx.beginPath();
            ctx.arc(C, cy, r1 + grow, a0, a1);
            ctx.arc(C, cy, r0, a1, a0, true);
            ctx.closePath();
            // The unchosen wedges are present, not hidden. Reference points at
            // a petal chart: the whole wheel reads, and the live one is simply
            // the brightest and the furthest out.
            ctx.fillStyle = live > 0.02
                ? 'rgba(240,236,230,' + (0.14 + live * 0.76) + ')'
                : 'rgba(255,250,242,' + (0.13 + hv * 0.08) + ')';
            ctx.fill();
            ctx.restore();

            const tx = C + Math.cos(mid) * ((r0 + r1) / 2 + grow / 2);
            const ty = cy + Math.sin(mid) * ((r0 + r1) / 2 + grow / 2);
            const dark = live > 0.5;
            label(m.k, tx, ty, {
                size: 27, weight: 400, align: 'center',
                colour: dark ? '#14100e' : (hv > 0.4 ? INK : DIM)
            });
            label(m.note, tx, ty + 30, {
                size: 18, align: 'center',
                colour: dark ? 'rgba(20,16,14,0.62)' : FAINT
            });
        });

        const warm = anim('warm', MOODS[state.mood].warm, 6);
        label(Math.round(warm) + '%', C, cy + 10, { size: 40, weight: 300, colour: INK, align: 'center' });
        label('WARMTH', C, cy + 42, { size: 16, colour: FAINT, align: 'center', tracking: 4 });

        backPill(890);
    }

    function screenService() {
        sectionHead('Service', 'Anything you need', 44);
        let y = 372;
        SERVICE.forEach(function (s, i) {
            pillRow('svc' + i, y, s.k, '→', { dots: false, fn: function () { toast(s.done); } });
            y += 110;
        });
        backPill(y + 40);
    }

    function screenBill() {
        sectionHead('The bill', null);
        const total = state.order.reduce(function (a, i) { return a + i.q * i.p; }, 0);
        const service = Math.round(total * 0.1);

        label('AED ' + (total + service).toLocaleString('en-US'), C, 380,
            { size: 64, weight: 300, colour: INK, align: 'center' });
        label(total ? 'Including 10% service' : 'Nothing on the table yet', C, 424,
            { size: 21, colour: FAINT, align: 'center' });

        let y = 470;
        [['Split evenly', String(GUEST.covers) + ' ways'],
        ['Add gratuity', '10%'],
        ['Email the receipt', '→']].forEach(function (r, i) {
            pillRow('bill' + i, y, r[0], r[1], {
                dots: false, muted: !total,
                fn: total ? function () { toast(r[0] + ' · noted'); } : null
            });
            y += 110;
        });
        backPill(y + 40);
    }

    function screenFeedback() {
        if (state.sent) {
            sectionHead('Thank you', null);
            bigTitle('Noted', 420, 52);
            lede('It reaches the floor manager before you have finished your coffee.', 480, 460);
            backPill(700);
            return;
        }

        sectionHead('Feedback', 'How was tonight?', 44);

        // Stars on an arc, the way the dial puts everything on an arc.
        const ar = 210, ay = C + 96;
        for (let i = 1; i <= 5; i++) {
            const ang = Math.PI * (1.18 + (i - 1) * 0.16);
            const x = C + Math.cos(ang) * ar;
            const y = ay + Math.sin(ang) * ar;
            const a = hit('star' + i, x - 44, y - 44, 88, 88, function () { state.stars = i; });
            const lit = anim('starLit' + i, i <= state.stars ? 1 : 0, 13);
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1 + lit * 0.16 + a * 0.08, 1 + lit * 0.16 + a * 0.08);
            ctx.beginPath();
            ctx.arc(0, 0, 38, 0, Math.PI * 2);
            ctx.fillStyle = lit > 0.02 ? alpha(GOLD, 0.1 + lit * 0.16)
                : 'rgba(255,250,242,' + (0.05 + a * 0.06) + ')';
            ctx.fill();
            ctx.restore();
            icon('feedback', x, y, 40, lit > 0.5 ? GOLD_SOFT : (a > 0.4 ? INK : 'rgba(247,244,240,0.42)'));
        }

        let x = C - 300, y = C + 200;
        TAGS.forEach(function (t, i) {
            const w = measure(t, 20, 300) + 52;
            if (x + w > C + 300) { x = C - 300; y += 60; }
            const on = state.tags.indexOf(t) >= 0;
            const lit = anim('tagLit' + i, on ? 1 : 0, 12);
            const a = hit('tag' + i, x, y, w, 50, function () {
                const k = state.tags.indexOf(t);
                if (k >= 0) state.tags.splice(k, 1); else state.tags.push(t);
            });
            ctx.save();
            roundRect(x, y, w, 50, 25);
            ctx.fillStyle = 'rgba(255,250,242,' + (0.045 + lit * 0.12 + a * 0.05) + ')';
            ctx.fill();
            ctx.restore();
            label(t, x + w / 2, y + 32, { size: 20, align: 'center', colour: lit > 0.5 ? INK : DIM });
            x += w + 14;
        });

        roundBtn('send', C, y + 116, 46, '→', {
            solid: true, size: 34, dy: 12, disabled: !state.stars,
            fn: function () { state.sent = true; toast('Sent, with thanks'); }
        });
        backPill(y + 116 > 800 ? 940 : 880);
    }

    const SCREENS = {
        home: screenHome, menu: screenMenu, order: screenOrder,
        ambience: screenAmbience, service: screenService,
        feedback: screenFeedback, bill: screenBill
    };

    /* ----- the loop ----------------------------------------------------------- */

    function nav(view) {
        if (state.pending || view === state.view) return;
        state.pending = view;
        state.hover = null;
        dirty = true;
    }

    function toast(msg) {
        state.toast = msg;
        state.toastUntil = Date.now() + 2600;
        dirty = true;
    }

    function draw() {
        if (!ctx) return;
        hits = [];
        drawBase();
        ctx.save();
        ctx.translate(C, C);
        ctx.scale(SCALE, SCALE);
        ctx.translate(-C, -C);

        // The view crossfades through nothing rather than sliding over itself:
        // one screen is drawn per frame, so the hit list is never ambiguous.
        const vis = anim('vis', state.pending ? 0 : 1, 13);


        ctx.save();
        ctx.globalAlpha = vis;
        ctx.translate(0, (1 - vis) * 16);
        (SCREENS[state.view] || screenHome)();
        ctx.restore();

        drawToast(1);
        ctx.restore();
    }

    /** UV to DESIGN space: the inverse of the scale draw() paints through. */
    function toCanvas(u, v) {
        return {
            x: C + (u * S - C) / SCALE,
            y: C + ((1 - v) * S - C) / SCALE
        };
    }

    function find(u, v) {
        const p = toCanvas(u, v);
        for (let i = hits.length - 1; i >= 0; i--) {
            const h = hits[i];
            if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h;
        }
        return null;
    }

    /* ----- surface ------------------------------------------------------------ */

    const OS = {
        SIZE: S,

        canvas: function () {
            if (canvas) return canvas;
            canvas = document.createElement('canvas');
            canvas.width = S;
            canvas.height = S;
            ctx = canvas.getContext('2d');
            ready = true;
            draw();
            // Webfonts land after the first paint, so the first draw can be in
            // the fallback face. Redraw once Inter Tight is available.
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function () {
                    draw();
                    if (api.onChange) api.onChange();
                });
            }
            return canvas;
        },

        /**
         * One frame. Returns true if the picture changed, which is hero.js's
         * cue to re-upload the texture and ask the renderer for a frame.
         */
        tick: function (dt) {
            if (!ready) return false;
            let live = stepAnims(Math.min(dt || 0.016, 0.05));

            if (state.pending && anim('vis', 0, 13) < 0.04) {
                state.view = state.pending;
                state.pending = null;
                live = true;
            }
            if (state.toast && Date.now() > state.toastUntil + 400) { state.toast = ''; dirty = true; }

            if (!live && !dirty) return false;
            draw();
            dirty = false;
            return true;
        },

        hover: function (u, v) {
            const id = u == null ? null : (find(u, v) || { id: null }).id;
            if (id === state.hover) return false;
            state.hover = id;
            dirty = true;
            return true;
        },

        press: function (u, v) {
            const h = find(u, v);
            if (!h || !h.fn) return false;
            h.fn();
            dirty = true;
            return true;
        },

        /** Back to the front door, so the next visitor does not open on a bill. */
        reset: function () {
            state.view = 'home';
            state.pending = null;
            state.hover = null;
            state.toast = '';
            for (const k in tw) delete tw[k];
            dirty = true;
            if (ctx) draw();
        },

        hasPointer: function () { return !!state.hover; },
        redraw: function () { draw(); dirty = false; }
    };

    Object.defineProperty(OS, 'onMood', {
        get: function () { return api.onMood; },
        set: function (f) { api.onMood = f; }
    });
    Object.defineProperty(OS, 'onChange', {
        get: function () { return api.onChange; },
        set: function (f) { api.onChange = f; }
    });

    window.MajestyOS = OS;
})();
