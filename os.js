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
    /*
     *  NO INVENTED GUEST.
     *
     *  An earlier pass put a made up diner's name on the hub. It was not from a
     *  brief, a persona or anything the client supplied, and a fabricated
     *  person's name sitting on a product demo is not a placeholder, it is a
     *  claim. The hub carries what the table actually knows about itself.
     */
    const TABLE = { number: '12', covers: 4, course: 2, courses: 5 };

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
        // Translucent, because it can be now: hero.js takes the baked MAJESTY
        // crown off the mesh underneath for the duration, so there is nothing
        // left to ghost through and the surface can behave like glass with
        // something lit behind it. Graphite rather than black — black at this
        // size reads as a hole cut in the product and gives the type nothing to
        // sit on.
        g.addColorStop(0, 'rgba(44, 41, 37, 0.90)');
        g.addColorStop(0.62, 'rgba(29, 27, 25, 0.93)');
        g.addColorStop(1, 'rgba(17, 16, 15, 0.96)');
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

    /* =========================================================================
     *  THE SURFACE
     *
     *  Frosted glass on a dark ground, type two to three times the size it was,
     *  and half the elements per screen. The previous pass was a dark theme
     *  with small type and a lot on every screen, which is why restyling it
     *  kept producing the same feeling.
     *
     *  Canvas2D has no backdrop filter, so a frosted pill is built rather than
     *  sampled: a light translucent fill, a brighter hairline along the top
     *  edge where a real sheet of glass catches the room, a darker one along
     *  the bottom, and a soft drop beneath it. Against a ground this dark it is
     *  indistinguishable from a blurred backdrop, and it costs nothing.
     * ====================================================================== */

    const TYPE = {
        display: 66,     // the one big line on a screen
        pill: 34,        // anything you can press
        meta: 22,        // the quiet line under it
        micro: 18        // tracked capitals
    };

    /** A sheet of frosted glass. */
    function glass(x, y, w, h, r, lift) {
        const l = lift == null ? 0 : lift;
        ctx.save();
        // The drop. Soft and short: the sheet is sitting ON the surface.
        ctx.beginPath();
        roundRect(x, y + 6, w, h, r);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.filter = 'blur(10px)';
        ctx.fill();
        ctx.restore();

        ctx.save();
        roundRect(x, y, w, h, r);
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(255,250,242,' + (0.115 + l * 0.075) + ')');
        g.addColorStop(1, 'rgba(255,250,242,' + (0.055 + l * 0.055) + ')');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // The two edges. This is what makes it read as a sheet rather than a
        // flat tint: light along the top, dark along the bottom.
        ctx.save();
        roundRect(x, y, w, h, r);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x + w, y + 1);
        ctx.strokeStyle = 'rgba(255,250,242,' + (0.22 + l * 0.22) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y + h - 1);
        ctx.lineTo(x + w, y + h - 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    /* -------------------------------------------------------------------------
     *  WHERE YOU ARE
     *
     *  The thing that was actually missing. A section used to announce itself
     *  with one small gold line and nothing said how you got there or what else
     *  there was, so every screen felt like a dead end.
     *
     *  Three things now carry it, and they are on every section screen in the
     *  same place:
     *
     *    1. A ring of six ticks just inside the bezel, one per destination on
     *       the dial, with the one you are in lit and long. It is the dial
     *       itself, collapsed to a position indicator: you can see there are
     *       six places and which of them this is, without leaving.
     *    2. The section name, large, as the first thing on the screen.
     *    3. A back control that names where it goes rather than pointing.
     * ---------------------------------------------------------------------- */
    function whereRing(activeIndex) {
        // Pre-scale: draw() paints this through a 1.10 scale about the centre,
        // so a radius written as "just inside the bezel" would land outside it.
        const r = (C - 28) / SCALE;
        DIAL.forEach(function (d, i) {
            const step = Math.PI * 2 / DIAL.length;
            const ang = -Math.PI / 2 + i * step;
            const live = anim('whereLit' + i, i === activeIndex ? 1 : 0, 10);
            const half = (step * 0.30) * (0.42 + live * 0.58);
            ctx.save();
            ctx.beginPath();
            ctx.arc(C, C, r, ang - half, ang + half);
            ctx.strokeStyle = live > 0.02
                ? alpha(GOLD, 0.35 + live * 0.65)
                : 'rgba(255,250,242,0.13)';
            ctx.lineWidth = 3 + live * 3;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
        });
    }

    const BAND = { title: 268, body: 372, action: 852 };

    function sectionHead(index, titleText, subText) {
        whereRing(index);
        label(titleText, C, BAND.title,
            { size: TYPE.display, weight: 300, colour: INK, align: 'center' });
        if (subText) {
            label(subText, C, BAND.title + 46,
                { size: TYPE.meta, colour: FAINT, align: 'center' });
        }
    }

    /**
     * The action band. Back names its destination, because an arrow on a screen
     * with no chrome tells you a direction and not a place. The primary action,
     * when there is one, is the only solid shape on the screen.
     */
    function actionBar(primary) {
        const bl = 'Dial';
        const bw = measure(bl, TYPE.pill - 6, 400) + 128;
        const bx = primary ? C - 124 : C;
        const a = hit('back', bx - bw / 2, BAND.action - 44, bw, 88, function () { nav('home'); });
        glass(bx - bw / 2, BAND.action - 38, bw, 76, 38, a);
        label('←', bx - bw / 2 + 40, BAND.action + 12,
            { size: 28, colour: a > 0.4 ? GOLD_SOFT : DIM });
        label(bl, bx + 20, BAND.action + 11,
            { size: TYPE.pill - 6, weight: 400, colour: a > 0.4 ? INK : 'rgba(247,244,240,0.86)' });

        if (!primary) return;
        const pw = measure(primary.label, TYPE.pill - 6, 500) + 116;
        const px = C + 124;
        const pa = primary.disabled ? 0
            : hit('primary', px - pw / 2, BAND.action - 44, pw, 88, primary.fn);
        ctx.save();
        ctx.globalAlpha = primary.disabled ? 0.3 : 1;
        ctx.beginPath();
        roundRect(px - pw / 2, BAND.action - 32, pw, 76, 38);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.filter = 'blur(10px)';
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = primary.disabled ? 0.3 : 1;
        roundRect(px - pw / 2, BAND.action - 38, pw, 76, 38);
        ctx.fillStyle = pa > 0.5 ? '#ffffff' : INK;
        ctx.fill();
        ctx.restore();
        label(primary.label, px, BAND.action + 11,
            { size: TYPE.pill - 6, weight: 500, colour: '#14100e', align: 'center' });
    }

    /** One line of glass. Label left, value right, nothing else. */
    function glassRow(id, y, left, right, o) {
        o = o || {};
        const w = 660, h = 104, x = C - w / 2;
        const a = o.fn ? hit(id, x, y, w, h, o.fn) : 0;
        glass(x, y, w, h, 52, a);
        label(clip(left, right == null ? 560 : 452, TYPE.pill, 400), x + 46, y + h / 2 + 12,
            { size: TYPE.pill, weight: 400, colour: o.muted ? DIM : INK });
        if (right != null) {
            label(String(right), x + w - 46, y + h / 2 + 12, {
                size: TYPE.pill, weight: 400, align: 'right',
                colour: o.accent ? (a > 0.4 ? GOLD_SOFT : GOLD) : INK
            });
        }
        return a;
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

    function indexOfView(v) {
        for (let i = 0; i < DIAL.length; i++) if (DIAL[i].v === v) return i;
        return -1;
    }

    /**
     * The dial.
     *
     * A thick segmented ring with an icon in each wedge, and a large light knob
     * in the middle. On a black glass disc the knob is the one element that
     * reads as hardware rather than software, so it is the brightest thing here
     * and the eye starts on it.
     *
     * The wedges carry icons only. Six labels on a ring is a wheel of words at
     * six different angles; the knob names whatever the hand is over instead,
     * so there is one label, always in the same place.
     */
    function screenHome() {
        const R0 = 172, R1 = 312, KNOB = 142;

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, R1 + 7, 0, Math.PI * 2);
        ctx.arc(C, C, R0 - 7, Math.PI * 2, 0, true);
        ctx.fillStyle = 'rgba(255,250,242,0.03)';
        ctx.fill();
        ctx.restore();

        let named = null;

        DIAL.forEach(function (d, i) {
            const step = Math.PI * 2 / DIAL.length;
            const a0 = -Math.PI / 2 - step / 2 + i * step + 0.024;
            const a1 = a0 + step - 0.048;
            const mid = (a0 + a1) / 2;

            const ix = C + Math.cos(mid) * (R0 + R1) / 2;
            const iy = C + Math.sin(mid) * (R0 + R1) / 2;
            const a = hit('dial' + i, ix - 64, iy - 64, 128, 128, function () { nav(d.v); });
            if (a > 0.5) named = d.k;

            ctx.save();
            ctx.beginPath();
            ctx.arc(C, C, R1, a0, a1);
            ctx.arc(C, C, R0, a1, a0, true);
            ctx.closePath();
            const wg = ctx.createRadialGradient(C, C, R0, C, C, R1);
            wg.addColorStop(0, 'rgba(255,250,242,' + (0.125 + a * 0.13) + ')');
            wg.addColorStop(1, 'rgba(255,250,242,' + (0.05 + a * 0.10) + ')');
            ctx.fillStyle = wg;
            ctx.fill();
            ctx.restore();

            icon(d.i, ix, iy, 56 + a * 4, a > 0.4 ? '#ffffff' : 'rgba(247,244,240,0.72)');
        });

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C + 6, KNOB + 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.filter = 'blur(16px)';
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

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, KNOB - 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20,16,14,0.10)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        const t = anim('course', TABLE.course / TABLE.courses, 4);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(C, C, KNOB + 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        label('TABLE', C, C - 34,
            { size: TYPE.micro, weight: 500, colour: 'rgba(20,16,14,0.42)', align: 'center', tracking: 7 });
        label(TABLE.number, C, C + 26,
            { size: 62, weight: 400, colour: '#14100e', align: 'center' });
        label(named || ('Course ' + TABLE.course + ' of ' + TABLE.courses), C, C + 62, {
            size: 21, weight: 500, align: 'center',
            colour: named ? 'rgba(150,112,30,0.95)' : 'rgba(20,16,14,0.4)'
        });
    }

    function screenMenu() {
        const g = MENU[state.group];
        sectionHead(indexOfView('menu'), 'Menu', g.group + ' · tap to add');

        // The category is one control, not three: it cycles. Three tabs plus
        // three dishes plus a total plus two actions was more than a screen
        // this size should ask anyone to read.
        const cw = measure(g.group, TYPE.meta, 500) + 92;
        const ca = hit('cycle', C - cw / 2, BAND.title + 66, cw, 66,
            function () { state.group = (state.group + 1) % MENU.length; });
        glass(C - cw / 2, BAND.title + 72, cw, 54, 27, ca);
        label(g.group.toUpperCase(), C, BAND.title + 107,
            { size: TYPE.micro, weight: 500, colour: ca > 0.4 ? INK : DIM, align: 'center', tracking: 5 });

        let y = BAND.body + 84;
        g.items.slice(0, 3).forEach(function (it, i) {
            glassRow('dish' + state.group + '_' + i, y, it.n, it.p, {
                accent: true,
                fn: function () {
                    const f = state.order.filter(function (o) { return o.n === it.n; })[0];
                    if (f) f.q++; else state.order.push({ n: it.n, p: it.p, q: 1 });
                    state.fired = false;
                    toast(it.n.split(',')[0] + ' added');
                }
            });
            y += 114;
        });

        const n = state.order.reduce(function (a, o) { return a + o.q; }, 0);
        actionBar(n ? { label: 'Order · ' + n, fn: function () { nav('order'); } } : null);
    }

    function screenOrder() {
        const total = state.order.reduce(function (a, i) { return a + i.q * i.p; }, 0);
        sectionHead(indexOfView('order'),
            state.fired ? 'Sent' : 'Order',
            state.fired ? 'Chef Karim has it' : (total ? 'AED ' + total.toLocaleString('en-US') : 'Nothing yet'));

        if (!state.order.length) {
            label('Everything you choose', C, 520, { size: TYPE.meta, colour: FAINT, align: 'center' });
            label('arrives here.', C, 552, { size: TYPE.meta, colour: FAINT, align: 'center' });
            actionBar({ label: 'Open the menu', fn: function () { nav('menu'); } });
            return;
        }

        let y = BAND.body + 60;
        state.order.slice(0, 3).forEach(function (o, i) {
            glassRow('item' + i, y, o.n, null, {});
            const yc = y + 52;
            ['−', '+'].forEach(function (gl, k) {
                const cx = C + (k === 0 ? 200 : 296);
                const a = hit('q' + i + '_' + k, cx - 34, yc - 34, 68, 68, function () {
                    o.q += k === 0 ? -1 : 1;
                    if (o.q <= 0) state.order.splice(i, 1);
                    state.fired = false;
                });
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, yc, 27, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,250,242,' + (0.18 + a * 0.3) + ')';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
                label(gl, cx, yc + 11, { size: 30, colour: a > 0.4 ? INK : DIM, align: 'center' });
            });
            label(String(o.q), C + 248, yc + 11,
                { size: TYPE.pill - 6, weight: 500, colour: INK, align: 'center' });
            y += 118;
        });

        actionBar(state.fired ? null : {
            label: 'Send to kitchen',
            fn: function () { state.fired = true; toast('The kitchen has your order'); }
        });
    }

    /**
     * The mood wheel. The one screen where the shape of the hardware is doing
     * real work rather than being decorated around.
     */
    function screenAmbience() {
        const m = MOODS[state.mood];
        sectionHead(indexOfView('ambience'), 'Ambience', m.k + ' · ' + m.note);

        const cy = 596, r0 = 108, r1 = 232;
        MOODS.forEach(function (mm, i) {
            const a0 = -Math.PI / 2 + i * (Math.PI * 2 / 3) + 0.04;
            const a1 = a0 + (Math.PI * 2 / 3) - 0.08;
            const mid = (a0 + a1) / 2;
            const live = anim('moodLit' + i, i === state.mood ? 1 : 0, 9);

            const hx = C + Math.cos(mid) * (r0 + r1) / 2;
            const hy = cy + Math.sin(mid) * (r0 + r1) / 2;
            const hv = hit('mood' + i, hx - 92, hy - 76, 184, 152, function () {
                state.mood = i;
                if (api.onMood) api.onMood(mm.pattern);
                toast(mm.k);
            });

            const grow = live * 20 + hv * 9;
            ctx.save();
            ctx.beginPath();
            ctx.arc(C, cy, r1 + grow, a0, a1);
            ctx.arc(C, cy, r0, a1, a0, true);
            ctx.closePath();
            ctx.fillStyle = live > 0.02
                ? 'rgba(243,239,233,' + (0.16 + live * 0.76) + ')'
                : 'rgba(255,250,242,' + (0.12 + hv * 0.09) + ')';
            ctx.fill();
            ctx.restore();

            const tx = C + Math.cos(mid) * ((r0 + r1) / 2 + grow / 2);
            const ty = cy + Math.sin(mid) * ((r0 + r1) / 2 + grow / 2);
            label(mm.k, tx, ty + 10, {
                size: 28, weight: 500, align: 'center',
                colour: live > 0.5 ? '#14100e' : (hv > 0.4 ? INK : DIM)
            });
        });

        const warm = anim('warm', m.warm, 6);
        label(Math.round(warm) + '%', C, cy + 12,
            { size: 44, weight: 300, colour: INK, align: 'center' });

        actionBar(null);
    }

    function screenService() {
        sectionHead(indexOfView('service'), 'Service', 'No hand raised, no waiting');
        // Four rows have to fit between the subtitle and the action band, so
        // they run tighter than the three-row screens do.
        let y = BAND.body + 18;
        SERVICE.forEach(function (s, i) {
            glassRow('svc' + i, y, s.k, '→', { fn: function () { toast(s.done); } });
            y += 108;
        });
        actionBar(null);
    }

    function screenBill() {
        const total = state.order.reduce(function (a, i) { return a + i.q * i.p; }, 0);
        const grand = total + Math.round(total * 0.1);
        sectionHead(indexOfView('bill'), 'Bill',
            total ? 'Including 10% service' : 'Nothing on the table yet');

        label('AED ' + grand.toLocaleString('en-US'), C, BAND.body + 132,
            { size: 92, weight: 300, colour: total ? INK : FAINT, align: 'center' });

        if (total) {
            glassRow('split', BAND.body + 206, 'Split evenly', TABLE.covers + ' ways', {
                fn: function () { toast('Split ' + TABLE.covers + ' ways'); }
            });
        }
        actionBar(total ? { label: 'Settle', fn: function () { toast('Settling, one moment'); } } : null);
    }

    function screenFeedback() {
        if (state.sent) {
            sectionHead(indexOfView('feedback'), 'Thank you', 'It reaches the floor manager tonight');
            actionBar(null);
            return;
        }

        sectionHead(indexOfView('feedback'), 'Tonight', 'How was it');

        const sw = 108;
        for (let i = 1; i <= 5; i++) {
            const x = C + (i - 3) * sw;
            const y = BAND.body + 178;
            const a = hit('star' + i, x - 52, y - 52, 104, 104, function () { state.stars = i; });
            const lit = anim('starLit' + i, i <= state.stars ? 1 : 0, 13);
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1 + lit * 0.14 + a * 0.08, 1 + lit * 0.14 + a * 0.08);
            ctx.beginPath();
            ctx.arc(0, 0, 46, 0, Math.PI * 2);
            ctx.fillStyle = lit > 0.02 ? alpha(GOLD, 0.14 + lit * 0.22)
                : 'rgba(255,250,242,' + (0.07 + a * 0.07) + ')';
            ctx.fill();
            ctx.restore();
            icon('feedback', x, y, 48,
                lit > 0.5 ? GOLD_SOFT : (a > 0.4 ? INK : 'rgba(247,244,240,0.42)'));
        }

        actionBar({
            label: 'Send', disabled: !state.stars,
            fn: function () { state.sent = true; toast('Sent, with thanks'); }
        });
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
