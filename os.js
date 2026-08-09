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

    function font(size, weight) { return (weight || 300) + ' ' + size + 'px ' + FONT; }

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
        // Near enough opaque. The lamp's own screen carries a baked MAJESTY
        // crown, and at anything under about 0.99 it ghosts up through the
        // interface and reads as a printing fault rather than as glass.
        g.addColorStop(0, 'rgba(11, 10, 9, 0.992)');
        g.addColorStop(0.7, 'rgba(7, 6, 6, 0.995)');
        g.addColorStop(1, 'rgba(4, 4, 4, 0.998)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);

        const sh = ctx.createLinearGradient(S * 0.1, 0, S * 0.75, S * 0.66);
        sh.addColorStop(0, 'rgba(255, 250, 242, 0.07)');
        sh.addColorStop(0.5, 'rgba(255, 250, 242, 0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, 0, S, S);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(C, C, C - 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232, 214, 176, 0.18)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    /** Course progress, as an arc following the bezel. The circle is the UI. */
    function drawProgress() {
        const r = C - 34;
        const from = Math.PI * 1.18, to = Math.PI * 1.82;
        const t = anim('course', GUEST.course / GUEST.courses, 4);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(C, C, r, from, to);
        ctx.strokeStyle = 'rgba(255,250,242,0.10)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(C, C, r, from, from + (to - from) * t);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
    }

    function drawTopBar(fade) {
        const y = 152;
        ctx.save();
        ctx.globalAlpha = fade;

        const d = new Date();
        label(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
            C, y, { size: 22, colour: FAINT, align: 'center', tracking: 4 });

        if (state.view !== 'home' && !state.pending) {
            const h = hit('back', C - 232, y - 40, 76, 72, function () { nav('home'); });
            label('←', C - 194, y + 8, { size: 30, colour: h > 0.4 ? INK : DIM, align: 'center' });
            hairline(y + 20, C - 214, C - 174, 0.06 + h * 0.22);
        }

        const n = state.order.reduce(function (a, i) { return a + i.q; }, 0);
        const cartIn = anim('cartIn', n ? 1 : 0, 10);
        if (cartIn > 0.01) {
            const h = hit('cart', C + 156, y - 40, 76, 72, function () { nav('order'); });
            ctx.globalAlpha = fade * cartIn;
            ctx.beginPath();
            ctx.arc(C + 194, y - 8, 21 + h * 2, 0, Math.PI * 2);
            ctx.fillStyle = GOLD;
            ctx.fill();
            label(String(n || ''), C + 194, y, { size: 22, weight: 500, colour: '#14100e', align: 'center' });
        }
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

    /* ----- shared blocks ------------------------------------------------------ */

    function eyebrow(str, y) {
        label(str.toUpperCase(), C, y, { size: 19, colour: GOLD, align: 'center', tracking: 6 });
    }

    function heading(str, y, size) {
        label(str, C, y, { size: size || 46, weight: 300, colour: INK, align: 'center' });
    }

    function lede(str, y, max) {
        const words = str.split(' ');
        const lines = [];
        let line = '';
        words.forEach(function (w) {
            const t = line ? line + ' ' + w : w;
            if (measure(t, 23, 300) > (max || 500) && line) { lines.push(line); line = w; }
            else line = t;
        });
        if (line) lines.push(line);
        lines.forEach(function (l, i) {
            label(l, C, y + i * 32, { size: 23, colour: FAINT, align: 'center' });
        });
        return y + lines.length * 32;
    }

    /**
     * A line in a list. No card, no fill: a hairline above, and on hover a gold
     * tick grows from the left edge while the row eases across to meet it.
     */
    function listRow(id, y, h, fn) {
        const a = hit(id, L - 16, y, (R - L) + 32, h, fn);
        hairline(y, L, R, 0.09 + a * 0.06);
        if (a > 0.01) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(L - 14, y + h / 2 - 11 * a);
            ctx.lineTo(L - 14, y + h / 2 + 11 * a);
            ctx.strokeStyle = alpha(GOLD, a);
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
        }
        return a;
    }

    /** The one solid shape on a screen. Outlined at rest, filled on hover. */
    function action(str, y, enabled, id, fn) {
        const a = enabled ? hit(id, C - 150, y - 34, 300, 68, fn) : 0;
        const w = measure(str, 25, 400) + 86;
        ctx.save();
        ctx.globalAlpha = enabled ? 1 : 0.32;
        roundRect(C - w / 2, y - 33, w, 66, 33);
        ctx.fillStyle = 'rgba(247,244,240,' + (0.06 + a * 0.94) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(247,244,240,' + (0.34 - a * 0.34) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        const mix = a;
        label(str, C, y + 9, {
            size: 25, weight: 400, align: 'center',
            colour: 'rgb(' + Math.round(247 - 227 * mix) + ',' + Math.round(244 - 228 * mix) + ',' + Math.round(240 - 226 * mix) + ')'
        });
    }

    /* ----- screens ------------------------------------------------------------ */

    function screenHome() {
        eyebrow('Good evening', 296);
        heading(GUEST.name, 358, 52);
        label('Table ' + GUEST.table + ' · ' + GUEST.covers + ' covers · Course ' +
            GUEST.course + ' of ' + GUEST.courses,
            C, 400, { size: 21, colour: FAINT, align: 'center' });

        let y = 452;
        HOME.forEach(function (t, i) {
            const a = listRow('home' + i, y, 82, function () { nav(t[1]); });
            label(t[0], L + a * 10, y + 52, { size: 30, weight: 300, colour: INK });
            ctx.save();
            ctx.globalAlpha = 0.25 + a * 0.75;
            label('→', R - a * 10, y + 52, { size: 24, colour: a > 0.4 ? GOLD : FAINT, align: 'right' });
            ctx.restore();
            y += 82;
        });
        hairline(y, L, R);
    }

    function screenMenu() {
        eyebrow('The menu', 268);

        // Categories as one line of type, not as tabs. The active one is bright
        // and carries a rule; the rest step back.
        const gap = 34;
        let total = -gap;
        MENU.forEach(function (g) { total += measure(g.group, 24, 400) + gap; });
        let x = C - total / 2;
        MENU.forEach(function (g, i) {
            const w = measure(g.group, 24, 400);
            const a = hit('tab' + i, x - 10, 300, w + 20, 46, function () { state.group = i; });
            const live = i === state.group ? 1 : 0;
            const lit = anim('tabLit' + i, live, 10);
            label(g.group, x, 330, {
                size: 24, weight: 400,
                colour: lit > 0.5 ? INK : (a > 0.4 ? DIM : FAINT)
            });
            if (lit > 0.01) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x + w / 2 - (w / 2 + 4) * lit, 344);
                ctx.lineTo(x + w / 2 + (w / 2 + 4) * lit, 344);
                ctx.strokeStyle = alpha(GOLD, lit);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }
            x += w + gap;
        });

        let y = 392;
        MENU[state.group].items.forEach(function (it, i) {
            const a = listRow('dish' + state.group + '_' + i, y, 104, function () {
                const f = state.order.filter(function (o) { return o.n === it.n; })[0];
                if (f) f.q++; else state.order.push({ n: it.n, p: it.p, q: 1 });
                state.fired = false;
                toast(it.n.split(',')[0] + ' added');
            });
            const dx = a * 10;
            label(clip(it.n, 430, 26, 300), L + dx, y + 44, { size: 26, weight: 300, colour: INK });
            label(clip(it.d, 430, 20, 300), L + dx, y + 74, { size: 20, colour: FAINT });
            label(String(it.p), R - dx, y + 50,
                { size: 24, colour: a > 0.4 ? GOLD_SOFT : GOLD, align: 'right' });
            y += 104;
        });
        hairline(y, L, R);
        label('AED · tap to add', C, y + 40, { size: 18, colour: FAINT, align: 'center', tracking: 3 });
    }

    function screenOrder() {
        eyebrow(state.fired ? 'With the kitchen' : 'Your order', 262);

        if (!state.order.length) {
            lede('Nothing yet. Everything on the menu comes to this screen.', 350, 460);
            action('Open the menu', 470, true, 'toMenu', function () { nav('menu'); });
            return;
        }

        let y = 320;
        state.order.forEach(function (o, i) {
            listRow('item' + i, y, 92, null);
            label(clip(o.n, 380, 25, 300), L, y + 40, { size: 25, weight: 300, colour: INK });
            label('AED ' + o.p, L, y + 70, { size: 19, colour: FAINT });

            [['−', -1, 0], ['+', 1, 1]].forEach(function (b) {
                const cx = R - (b[2] === 0 ? 108 : 16);
                const a = hit('q' + i + '_' + b[2], cx - 26, y + 20, 52, 52, function () {
                    o.q += b[1];
                    if (o.q <= 0) state.order.splice(i, 1);
                    state.fired = false;
                });
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, y + 46, 22, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,250,242,' + (0.12 + a * 0.3) + ')';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
                label(b[0], cx, y + 55, { size: 24, colour: a > 0.4 ? INK : DIM, align: 'center' });
            });
            label(String(o.q), R - 62, y + 55, { size: 23, colour: INK, align: 'center' });
            y += 92;
        });
        hairline(y, L, R);

        y += 46;
        label('TOTAL', L, y, { size: 18, colour: FAINT, tracking: 4 });
        const total = state.order.reduce(function (a, i) { return a + i.q * i.p; }, 0);
        label('AED ' + anim('total', total, 7).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            R, y + 4, { size: 30, weight: 300, colour: INK, align: 'right' });

        if (state.fired) {
            const d = new Date();
            label('Fired at ' + String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0') + ' · Chef Karim has it',
                C, y + 78, { size: 21, colour: GOLD, align: 'center' });
        } else {
            action('Send to the kitchen', y + 88, true, 'fire', function () {
                state.fired = true;
                toast('The kitchen has your order');
            });
        }
    }

    function screenAmbience() {
        eyebrow('Ambience', 262);
        lede('The table sets its own light. The room follows.', 306, 480);

        let y = 372;
        MOODS.forEach(function (m, i) {
            const a = listRow('mood' + i, y, 100, function () {
                state.mood = i;
                if (api.onMood) api.onMood(m.pattern);
                toast(m.k);
            });
            const lit = anim('moodLit' + i, i === state.mood ? 1 : 0, 9);
            const dx = a * 10;
            label(m.k, L + 30 + dx, y + 46, {
                size: 27, weight: 300,
                colour: lit > 0.5 ? INK : (a > 0.4 ? INK : DIM)
            });
            label(m.note, L + 30 + dx, y + 74, { size: 20, colour: FAINT });

            // The live mood is a dot that fills, not a highlighted card.
            ctx.save();
            ctx.beginPath();
            ctx.arc(L + 8, y + 50, 6, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,250,242,0.2)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            if (lit > 0.01) {
                ctx.beginPath();
                ctx.arc(L + 8, y + 50, 6 * lit, 0, Math.PI * 2);
                ctx.fillStyle = GOLD;
                ctx.fill();
            }
            ctx.restore();
            y += 100;
        });
        hairline(y, L, R);

        const warm = anim('warm', MOODS[state.mood].warm, 6);
        const bw = R - L;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(L, y + 44);
        ctx.lineTo(R, y + 44);
        ctx.strokeStyle = 'rgba(255,250,242,0.12)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(L, y + 44);
        ctx.lineTo(L + bw * warm / 100, y + 44);
        const lg = ctx.createLinearGradient(L, 0, R, 0);
        lg.addColorStop(0, GOLD);
        lg.addColorStop(1, GOLD_SOFT);
        ctx.strokeStyle = lg;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
        label('WARMTH ' + Math.round(warm) + '%', C, y + 84,
            { size: 18, colour: FAINT, align: 'center', tracking: 4 });
    }

    function screenService() {
        eyebrow('Service', 262);
        lede('No hand raised, no eye caught, no waiting.', 306, 480);

        let y = 372;
        SERVICE.forEach(function (s, i) {
            const a = listRow('svc' + i, y, 96, function () { toast(s.done); });
            label(s.k, L + a * 10, y + 56, { size: 26, weight: 300, colour: INK });
            ctx.save();
            ctx.globalAlpha = 0.28 + a * 0.72;
            label('→', R - a * 10, y + 56, { size: 22, colour: a > 0.4 ? GOLD : FAINT, align: 'right' });
            ctx.restore();
            y += 96;
        });
        hairline(y, L, R);
    }

    function screenFeedback() {
        if (state.sent) {
            eyebrow('Thank you', 380);
            lede('It reaches the floor manager before you have finished your coffee.', 436, 460);
            action('Back to the table', 566, true, 'fbBack', function () { nav('home'); });
            return;
        }

        eyebrow('Feedback', 274);
        heading('How was tonight?', 336, 40);

        const sw = 76;
        for (let i = 1; i <= 5; i++) {
            const cx = C + (i - 3) * sw;
            const a = hit('star' + i, cx - sw / 2, 388, sw, 80, function () { state.stars = i; });
            const lit = anim('starLit' + i, i <= state.stars ? 1 : 0, 13);
            ctx.save();
            ctx.translate(cx, 436);
            ctx.scale(1 + lit * 0.1 + a * 0.06, 1 + lit * 0.1 + a * 0.06);
            label('★', 0, 16, {
                size: 48, align: 'center',
                colour: lit > 0.02
                    ? 'rgba(200,160,74,' + lit + ')'
                    : 'rgba(255,250,242,' + (0.14 + a * 0.14) + ')'
            });
            ctx.restore();
        }

        let x = L, y = 506;
        TAGS.forEach(function (t, i) {
            const w = measure(t, 20, 300) + 44;
            if (x + w > R) { x = L; y += 56; }
            const on = state.tags.indexOf(t) >= 0;
            const lit = anim('tagLit' + i, on ? 1 : 0, 12);
            const a = hit('tag' + i, x, y, w, 46, function () {
                const k = state.tags.indexOf(t);
                if (k >= 0) state.tags.splice(k, 1); else state.tags.push(t);
            });
            ctx.save();
            roundRect(x, y, w, 46, 23);
            ctx.fillStyle = 'rgba(255,250,242,' + (lit * 0.13) + ')';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,250,242,' + (0.11 + a * 0.13 + lit * 0.1) + ')';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
            label(t, x + w / 2, y + 29, {
                size: 20, align: 'center',
                colour: lit > 0.5 ? INK : DIM
            });
            x += w + 12;
        });

        action('Send', y + 118, state.stars > 0, 'send', function () {
            state.sent = true;
            toast('Sent, with thanks');
        });
    }

    const SCREENS = {
        home: screenHome, menu: screenMenu, order: screenOrder,
        ambience: screenAmbience, service: screenService, feedback: screenFeedback
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
        // The progress arc follows the bezel, so it is drawn before the scale:
        // it belongs to the hardware, not to the layout.
        drawProgress();

        ctx.save();
        ctx.translate(C, C);
        ctx.scale(SCALE, SCALE);
        ctx.translate(-C, -C);

        // The view crossfades through nothing rather than sliding over itself:
        // one screen is drawn per frame, so the hit list is never ambiguous.
        const vis = anim('vis', state.pending ? 0 : 1, 13);

        drawTopBar(vis);

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
