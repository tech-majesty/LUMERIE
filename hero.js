/* =============================================================================
 *  MAJESTY — landing page behaviour
 *
 *  Four jobs:
 *
 *  1. The hero. It mounts the ONE ThreeViewer this page has — the same rig,
 *     stage and logo light the configurator uses — and parks its camera on a
 *     still, head-on close-up of the top of the lamp.
 *
 *  2. The LUMERIE wordmark, which lives in the 3D scene rather than in the
 *     DOM so the lamp occludes it with real depth. See the note above it.
 *
 *  3. Opening the configurator in place. No navigation: its chrome is a fixed
 *     overlay on this document and script.js drives the same viewer, so the
 *     lamp never reloads and never leaves the screen.
 *
 *  4. Page chrome: preloader, sticky nav, mobile menu, scroll reveals, and not
 *     burning a GPU on an off-screen canvas.
 * ========================================================================== */
(function () {
    'use strict';

    /* -------------------------------------------------------------------------
     *  Hero framing
     *
     *  The camera does not move. No orbit, no drift, no pointer parallax — a
     *  still, head-on close-up on the top of the lamp, which is where the ring,
     *  the shade and the emboss all are. Anything that moves on its own here
     *  reads as a turntable render rather than a photograph.
     *
     *  The pose is derived from the viewport rather than hardcoded, because a
     *  fixed world position frames correctly at one aspect ratio and crops at
     *  every other:
     *
     *      visibleHeight = 2 · d · tan(fov / 2)
     *
     *  FRAME_H is how much of the world the frame should cover vertically. The
     *  lamp is 0.362 tall, so 0.40 crops the base and fills the frame with the
     *  top of the product; FRAME_AIM is where the centre of that frame sits on
     *  the model, measured from its middle.
     *
     *  The finish never changes: red body, golden ring.
     * ---------------------------------------------------------------------- */
    const FRAME_H = { wide: 0.40, narrow: 0.60 };
    const FRAME_AIM = { wide: 0.075, narrow: 0.045 };

    // Where the lamp starts on a fresh page load. It is NOT restored on exit:
    // see closeConfigurator.
    const FINISH = { base: 'Red', rim: 'Golden Ring', pattern: 'Arabic' };

    // How much of the lamp goes into the floor's reflection. 1 is untouched.
    const REFLECTION_DIM = 0.35;

    const CONFIGURATOR_Z = 3;     // ThreeViewer.cameraAngles.front.pos.z
    const framing = { dist: 2.3, aimY: 0.075, panX: 0 };

    function computeFraming() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        const halfFov = (c.fov * Math.PI) / 360;
        const wide = window.innerWidth >= 900;

        const frameH = wide ? FRAME_H.wide : FRAME_H.narrow;
        framing.dist = frameH / (2 * Math.tan(halfFov));
        framing.aimY = wide ? FRAME_AIM.wide : FRAME_AIM.narrow;
        framing.panX = 0;
    }

    let viewer = null;
    let heroVisible = true;
    let cfgOpen = false;
    let animating = false;

    /* ---------------------------------------------------------------------- */

    function el(id) { return document.getElementById(id); }

    function setProgress(pct) {
        const fill = el('preFill');
        const text = el('prePct');
        const v = Math.max(0, Math.min(100, Math.round(pct)));
        if (fill) fill.style.width = v + '%';
        if (text) text.textContent = String(v).padStart(2, '0');
    }

    function dismissPreloader() {
        setProgress(100);
        const pre = el('preloader');
        if (!pre) return;
        // Let the bar visibly reach 100 before the curtain lifts, or the jump
        // from ~90 reads as the loader being wrong rather than done.
        setTimeout(function () {
            pre.classList.add('done');
            document.body.classList.add('ready');
            setTimeout(function () { pre.remove(); }, 1000);
        }, 380);
    }

    /* ---------------------------------------------------------------------- */

    /* -------------------------------------------------------------------------
     *  Scroll parallax
     *
     *  Scrolling down drops the whole view, which sends the lamp UP the frame —
     *  faster than the page itself is moving, so it reads as depth rather than
     *  as the section simply leaving.
     *
     *  The wordmark comes along for free and correctly. It is a world object
     *  0.9 units further back, so the same camera pan moves it less on screen
     *  than it moves the lamp. That difference IS the parallax; nothing has to
     *  be animated separately.
     * ---------------------------------------------------------------------- */
    const PARALLAX_RISE = 0.6;   // share of a half-frame-height at full scroll
    let scrollProgress = 0;

    function parallaxDrop() {
        if (!viewer || !viewer.camera) return 0;
        const halfHeight = framing.dist * Math.tan((viewer.camera.fov * Math.PI) / 360);
        return scrollProgress * PARALLAX_RISE * halfHeight;
    }

    /** Park the camera on the hero pose. Straight on, no roll, no lateral offset. */
    function applyHeroCamera() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        const y = framing.aimY - parallaxDrop();
        c.position.set(framing.panX, y, framing.dist);
        c.lookAt(framing.panX, y, 0);
        viewer.requestRender();
    }

    /**
     * Read the hero's share of the scroll. Returns whether it moved.
     *
     * Split out because undock() needs it too: the scroll handler bails while
     * the canvas is docked, so by the time it comes back scrollProgress is
     * whatever it was when the first panel took the camera — 1, if you have
     * scrolled anywhere near the middle of the page. Applying the hero pose
     * against that stale value parks the camera a whole parallax drop away
     * from where the scroll position says it belongs.
     */
    function updateScrollProgress() {
        const h = window.innerHeight || 1;
        const next = Math.min(1, Math.max(0, window.scrollY / h));
        if (Math.abs(next - scrollProgress) < 0.0005) return false;
        scrollProgress = next;
        return true;
    }

    function initScrollParallax() {
        let queued = false;
        const onScroll = function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                // While the canvas is docked into a panel further down the
                // page the camera belongs to that panel, not to the hero.
                if (cfgOpen || animating || activeDock || osOpen) return;
                if (updateScrollProgress()) applyHeroCamera();
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* -------------------------------------------------------------------------
     *  Smooth scrolling, and a snap that only nudges
     *
     *  Two things at once, both about the wheel and only about the wheel.
     *
     *  1. WEIGHT. The wheel writes to a target and the page eases toward it, so
     *     a notch of the wheel arrives as a short decelerating move instead of
     *     a jump. GAIN below 1 makes the same gesture travel less far, which is
     *     what "slightly slower" means; EASE is how quickly the page catches up
     *     with where the wheel has already asked it to be.
     *
     *  2. SNAP, minimally. CSS scroll snapping was removed because even
     *     `proximity` grabs the page mid-gesture. This does the opposite: it
     *     waits until the wheel has been still for a moment AND the easing has
     *     landed, and only then, only if a panel edge is already within 14% of
     *     the viewport, does it move — through the same easing, at a gentler
     *     rate, so it reads as the page settling rather than as a magnet.
     *
     *  Only the wheel is intercepted. Touch has its own momentum and hijacking
     *  it is how sites end up feeling broken; keyboard, scrollbar dragging and
     *  anchor links all still scroll natively, and the loop resyncs from the
     *  real scroll position whenever it is not the one driving.
     *
     *  window.scrollTo(x, y) obeys the document's CSS scroll-behavior, which is
     *  `smooth` — so per-frame writes would each start their own animation and
     *  the page would lag seconds behind the wheel. The document is switched to
     *  `auto` for the duration of the loop and switched back after, which
     *  leaves anchor links smooth.
     * ---------------------------------------------------------------------- */
    const SCROLL_GAIN = 0.78;    // wheel travel multiplier
    const SCROLL_EASE = 0.10;    // share of the remaining distance per frame
    const SNAP_EASE = 0.055;     // gentler: the snap should not feel driven
    const SNAP_IDLE_MS = 150;    // quiet wheel before a snap is considered
    const SNAP_RANGE = 0.14;     // share of viewport height, max snap distance

    let ssTarget = 0;
    let ssRAF = 0;
    let ssLastWheel = 0;
    let ssPos = 0;
    let ssLastWrite = 0;
    let ssSnapping = false;
    let ssSnapDone = false;

    function scrollMax() {
        return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    /** Wheel deltas arrive in pixels, lines or pages depending on the device. */
    function wheelPixels(e) {
        if (e.deltaMode === 1) return e.deltaY * 16;
        if (e.deltaMode === 2) return e.deltaY * (window.innerHeight || 1);
        return e.deltaY;
    }

    function nearestPanelTop() {
        const vh = window.innerHeight || 1;
        const reach = vh * SNAP_RANGE;
        let best = null;
        let bestGap = reach;
        document.querySelectorAll('.hero, .vp').forEach(function (panel) {
            const gap = panel.getBoundingClientRect().top;
            if (Math.abs(gap) < Math.abs(bestGap)) { bestGap = gap; best = panel; }
        });
        if (!best || Math.abs(bestGap) < 1) return null;
        return Math.min(scrollMax(), Math.max(0, window.scrollY + bestGap));
    }

    function ssStop() {
        if (ssRAF) { cancelAnimationFrame(ssRAF); ssRAF = 0; }
        document.documentElement.style.scrollBehavior = '';
    }

    function ssFrame() {
        ssRAF = requestAnimationFrame(ssFrame);
        if (cfgOpen) { ssStop(); return; }

        // Someone else moved the page — an anchor, openConfigurator's jump to
        // the top, the browser restoring a position. Whoever it was outranks a
        // wheel gesture that has already been let go of, and without this the
        // loop drags the page straight back to a target nobody asked for. The
        // tolerance is for the browser rounding our sub-pixel write to a device
        // pixel, which is also why the loop keeps its own float position rather
        // than reading scrollY back: at the tail of a move the per-frame step is
        // a fraction of a pixel, and a read-back loop stalls there forever.
        if (Math.abs(window.scrollY - ssLastWrite) > 3) { ssStop(); return; }

        const now = (window.performance && performance.now ? performance.now() : 0);
        const gap = ssTarget - ssPos;

        if (Math.abs(gap) < 0.5) {
            if (now - ssLastWheel < SNAP_IDLE_MS) return;
            if (ssSnapDone) {
                // Land ON the edge. Stopping at "within half a pixel" leaves a
                // hairline of the previous panel at the top of the window.
                if (ssSnapping) { ssPos = ssLastWrite = ssTarget; window.scrollTo(0, ssTarget); }
                ssStop();
                return;
            }
            const snapTo = nearestPanelTop();
            ssSnapDone = true;
            if (snapTo === null) { ssStop(); return; }
            ssTarget = snapTo;
            ssSnapping = true;
            return;
        }

        ssPos += gap * (ssSnapping ? SNAP_EASE : SCROLL_EASE);
        ssLastWrite = ssPos;
        window.scrollTo(0, ssPos);
    }

    function initSmoothScroll() {
        // Touch scrolling already has momentum and a rubber band, and taking it
        // over is how a page ends up fighting the finger. Reduced motion means
        // the browser's own scrolling, unmodified.
        if (window.matchMedia('(pointer: coarse)').matches) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        window.addEventListener('wheel', function (e) {
            if (cfgOpen || e.ctrlKey) return;   // ctrl+wheel is a zoom gesture
            e.preventDefault();

            const now = (window.performance && performance.now ? performance.now() : 0);
            // Not driving yet, or the page was moved by something else since the
            // last notch: pick up from wherever it actually is.
            if (!ssRAF || Math.abs(ssTarget - window.scrollY) > window.innerHeight) {
                ssPos = ssTarget = window.scrollY;
            }
            ssTarget = Math.min(scrollMax(), Math.max(0, ssTarget + wheelPixels(e) * SCROLL_GAIN));
            ssLastWheel = now;
            ssSnapping = false;
            ssSnapDone = false;

            if (!ssRAF) {
                ssPos = ssLastWrite = window.scrollY;
                document.documentElement.style.scrollBehavior = 'auto';
                ssRAF = requestAnimationFrame(ssFrame);
            }
        }, { passive: false });

        // Anything that is not the wheel — an anchor, a keypress, the scrollbar
        // — should not have to fight a stale target.
        ['pointerdown', 'keydown'].forEach(function (type) {
            window.addEventListener(type, function () { if (ssRAF) ssStop(); }, { passive: true });
        });
    }

    /**
     * Stop the viewer tweening to its own 'front' pose.
     *
     * ThreeViewer fires setCameraAngle('front') the moment the model lands,
     * which starts a 1.5s gsap tween on camera.position. Left alone it drags
     * the hero pose away over the first second and a half.
     */
    function claimCamera() {
        if (window.gsap) gsap.killTweensOf(viewer.camera.position);
    }

    /* -------------------------------------------------------------------------
     *  The wordmark
     *
     *  It lives IN the scene, on a plane behind the lamp, rather than as DOM
     *  text behind a transparent canvas. Two reasons, one forced and one won:
     *
     *  Forced: the canvas cannot be transparent. The selective-bloom chain ends
     *  in a mix pass that adds base + bloom and an FXAA pass after it, and the
     *  composited result comes out with alpha 255 regardless of the renderer's
     *  clear alpha — measured, not assumed. Making it transparent would mean
     *  rewriting passes that the configurator shares.
     *
     *  Won: in the scene it gets real depth, so the lamp occludes it exactly;
     *  it is tone-mapped with everything else instead of sitting outside the
     *  grade; and the Reflector picks it up, so the word appears in the floor
     *  under the lamp. None of that is available to DOM text.
     * ---------------------------------------------------------------------- */
    const WORD = 'LUMERIE';
    const WORD_TEX = { w: 4096, h: 1024 };
    const WORD_Z = -0.9;          // world units behind the lamp
    const WORD_Y = 0.055;
    let wordPlane = null;

    function drawWordTexture() {
        const c = document.createElement('canvas');
        c.width = WORD_TEX.w;
        c.height = WORD_TEX.h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#efe6d7';

        // Measure at an arbitrary size, then scale so the word fills the
        // texture width. Doing it by measurement rather than a hardcoded size
        // keeps it correct whichever font actually resolved.
        const font = function (px) {
            return '600 ' + px + 'px Archivo, "Helvetica Neue", Arial, sans-serif';
        };
        ctx.font = font(600);
        const measured = ctx.measureText(WORD).width || 1;
        ctx.font = font(600 * (c.width * 0.97) / measured);
        ctx.fillText(WORD, c.width / 2, c.height / 2 + c.height * 0.02);

        return c;
    }

    function buildWordmark() {
        if (!viewer || !viewer.scene) return;

        const texture = new THREE.CanvasTexture(drawWordTexture());
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = viewer.renderer.capabilities.getMaxAnisotropy();

        wordPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                // No depth write: it is a backdrop element, and writing depth
                // would let it clip the floor's reflection of itself.
                depthWrite: false,
                // Outside the grade. ACES pulls #efe6d7 down to a mid grey,
                // which reads as a watermark rather than a wordmark; the point
                // of this element is that it is the brightest thing behind the
                // lamp. The floor still reflects it either way.
                toneMapped: false,
                opacity: 0.95
            })
        );
        wordPlane.name = 'HeroWordmark';
        wordPlane.position.set(0, WORD_Y, WORD_Z);
        wordPlane.renderOrder = -5;
        viewer.scene.add(wordPlane);
        window.__heroWord = wordPlane;
        sizeWordmark();

        // Webfonts land after first paint, so the first draw can be Helvetica.
        // Redraw once Archivo is actually available.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                if (!wordPlane) return;
                wordPlane.material.map.image = drawWordTexture();
                wordPlane.material.map.needsUpdate = true;
                viewer.requestRender();
            });
        }
    }

    /**
     * Size and place the plane against the frame it is actually seen in.
     *
     * Both are computed at the PLANE's depth, not the model's — it sits 0.9
     * units further back, where the frame is correspondingly wider. Vertical
     * placement is expressed as a fraction of frame height so it means the same
     * thing on a laptop and a phone.
     */
    function sizeWordmark() {
        if (!wordPlane || !viewer) return;
        const c = viewer.camera;
        const halfFov = (c.fov * Math.PI) / 360;
        const depth = framing.dist - WORD_Z;
        const halfHeight = depth * Math.tan(halfFov);
        const halfWidth = halfHeight * c.aspect;

        const wide = window.innerWidth >= 900;
        const width = 2 * halfWidth * (wide ? 0.94 : 0.86);
        wordPlane.scale.set(width, width * (WORD_TEX.h / WORD_TEX.w), 1);
        wordPlane.position.x = framing.panX;
        if (viewer) viewer.requestRender();

        // 0 is the top of the frame, 1 the bottom. The camera aims at the top
        // of the lamp, so the frame centre is already high on the product and
        // the word wants to sit a little above it.
        const frac = wide ? 0.30 : 0.22;
        wordPlane.position.y = framing.aimY + (0.5 - frac) * 2 * halfHeight;
    }

    /* -------------------------------------------------------------------------
     *  The lamp again, further down the page
     *
     *  Two panels — Our story and Precision — show the real model rather than
     *  a render, and they do it with the hero's canvas:
     *  #threeCanvasContainer is re-parented into whichever panel is on screen
     *  and put back in the hero when neither is. Re-parenting a canvas keeps
     *  its GL context, so this costs one DOM move and one resize. A viewer per
     *  panel would cost a context, a copy of the 6.7 MB model and a set of
     *  composer targets EACH, for two sections of scrolling.
     *
     *  The two panels are nowhere near each other, so only one is ever on
     *  screen and there is never anything to arbitrate.
     *
     *  Above 900px only. Below it the splits collapse to a single column, so
     *  the lamp would land behind the type instead of beside it; landing.css
     *  shows the render there instead.
     *
     *  Framing is a crop-in on the top of the product, the way the hero is,
     *  rather than the configurator's whole-object shot: the ring, the glass
     *  and the top of the sleeve fill the frame and the base runs off the
     *  bottom. The camera dollies vertically across the pass, so the lamp
     *  rides up the frame faster than the panel is moving.
     *
     *  Unlike the hero, this camera is never still. Two out-of-phase
     *  oscillations drift the yaw and the pitch, and the pointer adds to both.
     *  The MODEL still never turns — the shot moves around a fixed object,
     *  which reads as a camera on a head rather than as a turntable.
     * ---------------------------------------------------------------------- */
    /*
     *  A DOCK ENTRY, FIELD BY FIELD
     *
     *  frameH is how much of the world the frame covers vertically, in the
     *  same units as the hero's FRAME_H: the lamp is 0.362 tall, so ~0.27 is a
     *  close-up on its top three quarters. aimY is the world height the camera
     *  looks at — positive is up the product, and it is what puts the ring in
     *  the frame and the base out of it.
     *
     *  rise is the parallax travel across the pass, as a share of frame height.
     *  It is small here on purpose: the shot is already tight, and at this
     *  magnification a large travel would swing the ring off the top.
     *
     *  yaw / pitch / roll are the shot. yaw swings the camera round so the ring
     *  is read along its curve rather than as a circle; pitch lifts it enough
     *  to open the top face; roll is the Dutch angle, and it goes on the
     *  camera's up vector rather than on the model, so the floor and the
     *  reflection tilt with everything else.
     *
     *  The two entries are deliberately mirrored — opposite yaw, opposite roll,
     *  a flatter pitch on the story panel — because the same shot twice in one
     *  scroll reads as a mistake rather than as a motif.
     *
     *  finish is the configuration the panel shows. It overrides whatever is
     *  selected for the duration of the panel and is put back on the way out;
     *  see dock() for why that is safe against the visit's own selection.
     */
    function dockEntry(id, slot, o) {
        return {
            id: id, slot: slot, panel: null, node: null,
            frameH: o.frameH, aimY: o.aimY, rise: o.rise,
            yaw: o.yaw * Math.PI / 180,
            pitch: o.pitch * Math.PI / 180,
            roll: o.roll * Math.PI / 180,
            finish: o.finish || null,
            trio: !!o.trio,
            // Share of the frame's width the subject is allowed to cover. A
            // close-up wants nearly all of it; a lineup of three wants air, or
            // the outer rings sit on the window edge.
            fitW: o.fitW || 0.92
        };
    }

    /* -------------------------------------------------------------------------
     *  Three lamps at once
     *
     *  The closing panel shows three configurations side by side rather than
     *  one. Every material path in viewer.js reads the single global `config`
     *  and writes to shared material objects, so three different finishes
     *  cannot be live at the same time — not without rewriting updateMaterials
     *  to take a target and a finish, and everything it calls with it.
     *
     *  They do not have to be live. The finish is applied to the ONE model as
     *  usual, and the result is cloned: geometry is shared by reference, and
     *  the materials are cloned so each copy keeps the look it was built with.
     *  Three snapshots, taken once at load, and after them the visitor's own
     *  selection is put back on the original. Nothing about the single-model
     *  path changes.
     *
     *  Two things clone() does not bring:
     *
     *  - onBeforeCompile. Material.copy() does not copy it, so the logo emboss
     *    light — which is a patch on the material's shader, not a scene light —
     *    is re-attached per copy below.
     *  - membership of the reflection dimmer, which walks viewer.model. The
     *    group is registered as an extra root, or these three would reflect at
     *    full strength beside a dimmed hero.
     * ---------------------------------------------------------------------- */
    /*
     *  A triangle, not a line. Red stands forward on the axis and the other two
     *  sit back and out, so the group reads as an arrangement seen from above
     *  rather than as three products on a shelf. The camera is pitched well
     *  down to look into it, which is also why the two at the back are raised
     *  slightly: from up here, further away is further UP the frame, and level
     *  bases would put their rings behind red's.
     */
    const TRIO = [
        { base: 'Black', rim: 'Golden Ring', pattern: 'Data Rain', x: -0.205, z: -0.110 },
        { base: 'Red', rim: 'Golden Ring', pattern: 'Arabic', x: 0.000, z: 0.110 },
        { base: 'Gold', rim: 'Golden Ring', pattern: 'Ladder', x: 0.205, z: -0.110 }
    ];
    const TRIO_SPREAD = 0.41;    // outermost centres, apart
    let trioGroup = null;

    function buildTrio() {
        if (trioGroup || !viewer || !viewer.model || typeof config === 'undefined') return;
        if (typeof THREE === 'undefined') return;

        const keep = { base: config.base, rim: config.rim, pattern: config.pattern };
        const group = new THREE.Group();
        group.visible = false;

        TRIO.forEach(function (spec) {
            applyFinish(spec);
            const copy = viewer.model.clone(true);
            // A coded pattern's material is built by makeSiteMaterial, which
            // draws the motif from an onBeforeCompile patch. Material.copy()
            // does not carry that, so a cloned one compiles without the mask
            // and the sleeve comes out a blank white glow — which is exactly
            // what the first attempt looked like. They are already one material
            // per recipe and the three panels use three different recipes, so
            // these are shared rather than copied.
            const codedMats = new Set(Object.keys(viewer._codedMaterials || {})
                .map(function (k) { return viewer._codedMaterials[k]; }));

            copy.traverse(function (n) {
                if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
                if (!codedMats.has(n.material)) n.material = n.material.clone();
                if (n.name === 'Logo' && window.MajestyLogoLight) {
                    window.MajestyLogoLight.attach(THREE, n, window.MajestyLogoLight.current());
                }
            });
            copy.position.x += spec.x;
            copy.position.z += spec.z || 0;
            group.add(copy);
        });

        applyFinish(keep);
        viewer.scene.add(group);
        viewer.dimExtras = (viewer.dimExtras || []).concat([group]);
        trioGroup = group;
    }

    function showTrio(on) {
        if (!trioGroup) return;
        trioGroup.visible = on;
        // The centre of the three IS a copy, not the original, so the original
        // has to get out of the way or it stands inside its own clone.
        if (viewer && viewer.model) viewer.model.visible = !on;
    }

    const DOCKS = [
        dockEntry('story', 'storyDock', {
            frameH: 0.27, aimY: 0.100, rise: 0.07,
            yaw: -19, pitch: 3, roll: -4,
            finish: { base: 'Black', pattern: 'Data Rain' }
        }),
        dockEntry('precision', 'lampDock', {
            frameH: 0.25, aimY: 0.108, rise: 0.07,
            yaw: 15, pitch: 7, roll: 3.5,
            finish: { base: 'Gold', pattern: 'Ladder' }
        }),
        // The closing frame. Full bleed with the copy over it, so this one is
        // composed like the hero: squared up, the whole product, no Dutch
        // angle — a tilted horizon behind centred type reads as a mistake.
        // The drift is wider and slower to compensate for standing still.
        //
        // No finish: this is the only panel that shows what the VISITOR has
        // configured, which is the argument the button under it is making.
        dockEntry('contact', 'closeDock', {
            frameH: 0.435, aimY: 0.029, rise: 0.03,
            yaw: 0, pitch: 9, roll: 0, trio: true, fitW: 0.86
        })
    ];

    /* -------------------------------------------------------------------------
     *  Life
     *
     *  Two sine drifts and a pointer offset, all on the CAMERA. The periods are
     *  deliberately not multiples of each other, so yaw and pitch never come
     *  back into phase and the motion never visibly repeats — 27 and 35 seconds
     *  resync once every 945.
     *
     *  The amounts are small on purpose. This should read as a camera that is
     *  not quite locked off, not as a camera that is moving: 2.1 degrees over
     *  27 seconds is about a tenth of a degree a second. An earlier pass ran
     *  more than twice this and it looked like a slow turntable.
     *
     *  Roll is left out of it. A Dutch angle that wobbles is seasickness, not
     *  life; the tilt has to read as a decision the camera operator made.
     *
     *  The pointer is eased rather than followed, at a rate slow enough that a
     *  flick across the window takes about half a second to arrive. Direct
     *  tracking on a 10-degree lens is twitchy out of all proportion to the
     *  mouse movement.
     * ---------------------------------------------------------------------- */
    const DRIFT_YAW = 2.1 * Math.PI / 180;
    const DRIFT_YAW_MS = 27000;
    const DRIFT_PITCH = 0.7 * Math.PI / 180;
    const DRIFT_PITCH_MS = 35000;
    const POINTER_YAW = 2.4 * Math.PI / 180;
    const POINTER_PITCH = 1.4 * Math.PI / 180;
    const POINTER_EASE = 0.04;

    // The composer is three scene renders and two whole-scene traversals per
    // frame. A 14-second oscillation does not need 60 of those a second, and
    // the pointer is eased anyway, so the loop is capped. 40 is under the rate
    // at which the drift starts to look stepped and a third off the GPU.
    const DOCK_FPS = 40;

    let heroSlot = null;
    let dockMQ = null;
    let activeDock = null;
    let dockProgress = 0.5;
    let dockRAF = 0;
    let dockLastFrame = 0;
    let pointerX = 0, pointerY = 0;      // target, -1 to 1 across the window
    let pointerEX = 0, pointerEY = 0;    // eased, what the camera actually uses
    let savedFinish = null;

    function dockDistance(entry) {
        const c = viewer.camera;
        const t = Math.tan((c.fov * Math.PI) / 360);
        const forHeight = entry.frameH / (2 * t);
        // A close-up is allowed to run the lamp off the sides — that is what
        // makes it a close-up — but not to the point where the silhouette is
        // wider than the dock. Rolled, the width it has to fit is the rotated
        // bounding box, and 0.92 leaves a little air at the widest point.
        const roll = Math.abs(entry.roll);
        const wide = MODEL_W * Math.cos(roll) + MODEL_H * Math.sin(roll)
            + (entry.trio ? TRIO_SPREAD : 0);
        const forWidth = wide / (entry.fitW * 2 * t * c.aspect);
        return Math.max(forHeight, forWidth);
    }

    function applyDockCamera() {
        const entry = activeDock;
        if (!entry || !viewer || !viewer.camera) return;
        const c = viewer.camera;
        const d = dockDistance(entry);
        const halfHeight = d * Math.tan((c.fov * Math.PI) / 360);
        // dockProgress runs 0 (panel entering from below) to 1 (panel gone off
        // the top). The camera falls across that, which sends the lamp up.
        const aim = entry.aimY - (dockProgress - 0.5) * 2 * entry.rise * halfHeight;

        const t = (window.performance && performance.now ? performance.now() : 0);
        const yaw = entry.yaw
            + DRIFT_YAW * Math.sin((t / DRIFT_YAW_MS) * Math.PI * 2)
            + pointerEX * POINTER_YAW;
        const pitch = entry.pitch
            + DRIFT_PITCH * Math.sin((t / DRIFT_PITCH_MS) * Math.PI * 2)
            - pointerEY * POINTER_PITCH;

        // The aim is applied to the eye AND the target, so the whole rig slides
        // vertically and the shot itself never changes. Panning the target
        // instead would swing the lamp against the stage's halo, which is fixed
        // in world space.
        const horizontal = d * Math.cos(pitch);
        c.up.set(Math.sin(entry.roll), Math.cos(entry.roll), 0);
        c.position.set(
            horizontal * Math.sin(yaw),
            d * Math.sin(pitch) + aim,
            horizontal * Math.cos(yaw)
        );
        c.lookAt(0, aim, 0);
        viewer.requestRender();
    }

    function dockFrame() {
        dockRAF = requestAnimationFrame(dockFrame);
        if (!activeDock || document.hidden) return;

        const now = (window.performance && performance.now ? performance.now() : 0);
        if (now - dockLastFrame < 1000 / DOCK_FPS) return;
        dockLastFrame = now;

        pointerEX += (pointerX - pointerEX) * POINTER_EASE;
        pointerEY += (pointerY - pointerEY) * POINTER_EASE;
        applyDockCamera();
    }

    function startDockLoop() {
        if (!dockRAF) { dockLastFrame = 0; dockRAF = requestAnimationFrame(dockFrame); }
    }

    function stopDockLoop() {
        if (dockRAF) { cancelAnimationFrame(dockRAF); dockRAF = 0; }
    }

    function dock(entry) {
        if (activeDock === entry) return;
        const container = el('threeCanvasContainer');
        if (!container || !entry.node || !viewer) return;
        activeDock = entry;
        entry.node.appendChild(container);
        // The wordmark plane belongs to the hero's composition and would sit
        // across this panel's copy.
        if (wordPlane) wordPlane.visible = false;
        // The hero sits inside the stage. Here the lamp sits on the page: the
        // backdrop dome comes off so the canvas is transparent behind it and
        // the panel is the page's own background rather than a lit box.
        if (viewer.stage && viewer.stage.setBackdropVisible) viewer.stage.setBackdropVisible(false);
        showTrio(entry.trio);

        /*
         *  Each panel shows a specific configuration, and neither of them is
         *  necessarily the one the visitor has chosen. So the selection is put
         *  aside here and restored in undock(), which keeps the "one finish for
         *  the whole visit" rule intact: the configurator reopens on whatever
         *  was picked, not on the last panel scrolled past.
         *
         *  The swap is instant rather than tweened, and it can be, because dock
         *  fires the moment the panel's top edge crosses the bottom of the
         *  window — the canvas is on screen but the lamp, which sits in the
         *  middle of it, is still a screen-height below the fold.
         *
         *  The rim is deliberately not part of it. The two panels specify a
         *  body and a pattern; whatever ring is selected stays on.
         */
        if (entry.finish && typeof config !== 'undefined') {
            savedFinish = { base: config.base, rim: config.rim, pattern: config.pattern };
            applyFinish({
                base: entry.finish.base,
                rim: entry.finish.rim || savedFinish.rim,
                pattern: entry.finish.pattern
            });
        }

        viewer.onWindowResize();
        startDockLoop();
    }

    function undock() {
        if (!activeDock) return;
        activeDock = null;
        stopDockLoop();
        const container = el('threeCanvasContainer');
        // First child, not last: the veil and the hero foot are painted over
        // the canvas and DOM order is the tie-break between positioned
        // siblings at the same z-index.
        if (container && heroSlot) heroSlot.insertBefore(container, heroSlot.firstChild);
        if (wordPlane) wordPlane.visible = true;
        // Put the Dutch angle back. camera.up is global state: left tilted, the
        // hero, every configurator angle and the cart thumbnail all inherit it.
        if (viewer && viewer.camera) viewer.camera.up.set(0, 1, 0);
        if (viewer && viewer.stage && viewer.stage.setBackdropVisible) viewer.stage.setBackdropVisible(true);
        showTrio(false);
        if (savedFinish) { applyFinish(savedFinish); savedFinish = null; }
        if (viewer) viewer.onWindowResize();
        computeFraming();
        sizeWordmark();
        updateScrollProgress();
        if (!cfgOpen && !animating) applyHeroCamera();
    }

    /**
     * Decide which panel, if any, the canvas belongs to right now, and where
     * in that panel's pass the scroll is.
     *
     * Driven off the panels' own rects rather than an IntersectionObserver,
     * because the same answer is needed on scroll, on resize and when the
     * media query flips — and an observer that is already intersecting does
     * not re-fire when the viewport merely gets wider.
     */
    function syncDock() {
        if (!dockMQ || !viewer || !viewer.model) return;
        if (!dockMQ.matches || cfgOpen || animating || osOpen) { undock(); return; }

        const vh = window.innerHeight || 1;
        for (let i = 0; i < DOCKS.length; i++) {
            const entry = DOCKS[i];
            if (!entry.panel || !entry.node) continue;
            const r = entry.panel.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= vh) continue;

            if (activeDock !== entry) { undock(); dock(entry); }
            dockProgress = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
            applyDockCamera();
            return;
        }
        undock();
    }

    function initLampDock() {
        heroSlot = document.querySelector('.hero');
        if (!heroSlot) return;

        DOCKS.forEach(function (entry) {
            entry.panel = el(entry.id);
            entry.node = el(entry.slot);
        });
        if (!DOCKS.some(function (e) { return e.panel && e.node; })) return;

        dockMQ = window.matchMedia('(min-width: 900px)');

        let queued = false;
        const tick = function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () { queued = false; syncDock(); });
        };

        // One listener for both panels, on the window rather than on either
        // dock: the lamp should answer the pointer anywhere on the panel, not
        // only when it is over the canvas, and a pointer that leaves the canvas
        // mid-swing would otherwise freeze the camera where it left.
        window.addEventListener('pointermove', function (e) {
            if (!activeDock) return;
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            pointerX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1));
            pointerY = Math.max(-1, Math.min(1, (e.clientY / h) * 2 - 1));
        }, { passive: true });

        // Coming back to a page left on a panel, the eased pointer is wherever
        // it was and the real one is nowhere. Recentre instead of holding a
        // stale offset.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { pointerX = 0; pointerY = 0; }
        });

        window.addEventListener('scroll', tick, { passive: true });
        window.addEventListener('resize', tick);
        if (dockMQ.addEventListener) dockMQ.addEventListener('change', tick);
        else if (dockMQ.addListener) dockMQ.addListener(tick);
        tick();
    }

    /* ---------------------------------------------------------------------- */

    function mountViewer() {
        if (typeof ThreeViewer === 'undefined') {
            console.error('viewer.js did not load — the hero will stay empty.');
            dismissPreloader();
            return;
        }

        viewer = new ThreeViewer({
            // Cap the reported figure: the model is only part of the wait, and a
            // bar that sits at 100% while the stage still builds looks stuck.
            onProgress: function (pct) { setProgress(Math.min(pct * 0.94, 94)); },
            onLoad: function () {
                applyFinish(FINISH);
                // The lamp's mirror image in the floor reads a stop hot once the
                // camera pulls back far enough to show much floor. This dims only
                // that — the dome, the halo and every value in the stage preset
                // are untouched. See installReflectionDimmer in viewer.js.
                viewer.setReflectionDim(REFLECTION_DIM);

                computeFraming();
                buildWordmark();
                claimCamera();
                applyHeroCamera();
                buildTrio();
                dismissPreloader();
                // A reload part-way down the page lands on the precision panel
                // with the canvas still in the hero. Nothing has scrolled since
                // the model arrived, so nothing else would move it.
                syncDock();
            }
        });

        // No loadModel() call here: ThreeViewer's constructor runs init(), which
        // already kicks it off. Calling it again downloads the 6.7 MB GLB twice,
        // adds two copies of the lamp to the scene and builds the stage twice.

        // script.js looks for this instead of constructing its own viewer, so
        // the configurator drives the same lamp the hero is already showing.
        // It has to be set before script.js's DOMContentLoaded handler runs —
        // it does, because hero.js is loaded first and this runs synchronously
        // from its own DOMContentLoaded handler, registered earlier.
        window.MajestySharedViewer = viewer;
        window.__heroViewer = viewer;

        // Skip the render entirely while the hero is scrolled away. Two composer
        // passes and a whole-scene material swap per frame is not something to
        // keep paying for behind eight sections of copy.
        // Belt to requestRender's braces: even a requested frame is skipped if
        // the hero is scrolled away and the configurator is shut.
        const originalRender = viewer.renderFrame.bind(viewer);
        viewer.renderFrame = function () {
            if (heroVisible || cfgOpen || animating || activeDock || osOpen) originalRender();
        };

        // ThreeViewer's own resize handler updates camera.aspect; this must run
        // after it, so the framing is recomputed against the new aspect.
        window.addEventListener('resize', function () {
            computeFraming();
            sizeWordmark();
            if (cfgOpen) {
                applyConfiguratorAngles();
                if (!animating && viewer.setCameraAngle) {
                    const active = document.querySelector('.camera-btn.active');
                    viewer.setCameraAngle(active ? active.dataset.angle : 'front');
                }
            } else if (osOpen) {
                applyOsCamera();
            } else if (activeDock) {
                applyDockCamera();
            } else if (!animating) {
                applyHeroCamera();
            }
        });

        const hero = document.querySelector('.hero');
        if (hero && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                heroVisible = entries[0].isIntersecting;
                document.body.classList.toggle('hero-in-view', heroVisible);
            }, { threshold: 0 }).observe(hero);
        }
    }

    /* -------------------------------------------------------------------------
     *  Opening the configurator, in place
     *
     *  There is no second page and no navigation. index.html owns the only
     *  ThreeViewer; the configurator's chrome is a fixed layer over this
     *  document and script.js attaches to the same viewer. So "Customize" is a
     *  camera move and a couple of panels sliding in — the lamp on screen when
     *  you press it is the same lamp, the same frame, the same WebGL context.
     *
     *  Two things have to change hands:
     *
     *  1. The camera. The hero owns a still close-up; the configurator owns
     *     FRONT / LEFT / RIGHT through setCameraAngle. Rather than have both
     *     write to camera.position, the hero flies it to the configurator's
     *     opening pose and then simply stops touching it.
     *
     *  2. The centre of the frame. The sidebar covers the right-hand ~340px,
     *     so a centred lamp would sit behind it. The configurator's angles are
     *     shifted sideways by exactly half the sidebar in world units, which
     *     keeps the orbit intact and puts the lamp in the middle of what is
     *     actually visible.
     * ---------------------------------------------------------------------- */
    /*
     *  The configurator has no sidebar, so nothing pushes the lamp off centre
     *  and the viewer's own camera presets are used unchanged. That matters
     *  beyond tidiness: the previous version shifted the whole view sideways to
     *  clear a 340px panel, and because the stage's halo is fixed in world
     *  space, panning across it visibly slid the glow behind the lamp during
     *  the transition. A straight dolly in and out has nothing to slide.
     */
    /*
     *  How far back the configurator sits.
     *
     *  z = 3 is the number the standalone configurator has always used, and it
     *  is right for a landscape window. On a phone it is badly wrong: the frame
     *  is a fifth as wide in world units as it is on a laptop, so the binding
     *  constraint is the lamp's WIDTH, not its height, and at z = 3 the lamp is
     *  89% of the frame across and runs off both sides. Fitting both dimensions
     *  and taking whichever is further away covers every viewport.
     */
    const MODEL_H = 0.362;
    const MODEL_W = 0.216;

    function configuratorDistance() {
        const c = viewer.camera;
        const t = Math.tan((c.fov * Math.PI) / 360);
        const forHeight = MODEL_H / (0.68 * 2 * t);
        const forWidth = MODEL_W / (0.60 * 2 * t * c.aspect);
        return Math.max(forHeight, forWidth);
    }

    function applyConfiguratorAngles() {
        const d = configuratorDistance();
        // The stock LEFT/RIGHT poses are 3.53 units from the origin. Scaling
        // them to the new distance preserves the orbit angle and keeps the lamp
        // the same size from every button.
        const k = d / 3.53;
        viewer.cameraAngles = {
            front: { pos: { x: 0, y: 0, z: d }, lookAt: { x: 0, y: 0, z: 0 } },
            left: { pos: { x: -1.8 * k, y: 0.5 * k, z: 3 * k }, lookAt: { x: 0, y: 0, z: 0 } },
            right: { pos: { x: 1.8 * k, y: 0.5 * k, z: 3 * k }, lookAt: { x: 0, y: 0, z: 0 } }
        };
        return d;
    }

    /*
     *  ONE FINISH FOR THE WHOLE VISIT.
     *
     *  The hero used to be pinned to the brand shot: leaving the configurator
     *  crossfaded the lamp back to red, gold and Arabic, and reopening it
     *  restored what you had picked. Two views, two finishes, and pressing Back
     *  looked like it had thrown the configuration away.
     *
     *  Now there is one. Whatever is selected stays selected until the page is
     *  reloaded, at which point config in viewer.js starts it over at FINISH.
     */

    function applyFinish(f) {
        if (typeof config === 'undefined' || !viewer) return;
        config.base = f.base;
        config.rim = f.rim;
        config.pattern = f.pattern;
        viewer.updateMaterials();
        if (typeof updateConfigurationName === 'function') updateConfigurationName();
        syncControlButtons();
    }

    /**
     * Change finish over `duration` instead of instantly.
     *
     * Leaving the configurator used to snap the lamp from whatever was selected
     * straight back to red and gold on the first frame of the exit, which was
     * the biggest reason the way out felt worse than the way in — a hard colour
     * cut at the exact moment the camera starts moving.
     *
     * The materials are the same objects before and after, so the values can be
     * read on both sides of the change, put back, and tweened across. Only the
     * pattern sleeve is a mesh swap rather than a value change; it is left to
     * happen at the start, where the camera is accelerating and it reads far
     * less than the body colour did.
     */
    /** Move the sidebar's active states onto whatever config now holds. */
    function syncControlButtons() {
        [['base', config.base], ['rim', config.rim], ['pattern', config.pattern]]
            .forEach(function (pair) {
                document.querySelectorAll('.control-btn[data-type="' + pair[0] + '"]')
                    .forEach(function (btn) {
                        btn.classList.toggle('active', btn.dataset.value === pair[1]);
                    });
            });
    }

    function openConfigurator() {
        if (cfgOpen || animating || osOpen || !viewer || !viewer.model) return;
        cfgOpen = true;
        animating = true;

        // Synchronously, before the scroll: the configurator's chrome is a
        // fixed layer over the hero, so the canvas has to be back in the hero
        // by the time the camera starts moving. Waiting for the scroll handler
        // would open it into the precision panel's column.
        undock();

        // The canvas is pinned to the hero, so the hero has to be the viewport.
        window.scrollTo({ top: 0, behavior: 'instant' });
        const cfgZ = applyConfiguratorAngles();

        const reveal = function () {
            document.body.classList.add('cfg-open');
            const cfg = el('cfg');
            if (cfg) cfg.setAttribute('aria-hidden', 'false');
        };

        if (!window.gsap) {
            viewer.camera.position.set(0, 0, cfgZ);
            viewer.camera.lookAt(0, 0, 0);
            if (wordPlane) wordPlane.material.opacity = 0;
            reveal();
            animating = false;
            return;
        }

        claimCamera();
        const aimFrom = currentAim();
        const rig = {
            py: framing.aimY, pz: framing.dist,
            ax: aimFrom.x, ay: aimFrom.y, az: aimFrom.z
        };
        const tl = gsap.timeline({
            onComplete: function () { animating = false; }
        });

        // The wordmark is a scene object, so it fades with its material.
        if (wordPlane) {
            tl.to(wordPlane.material, {
                opacity: 0, duration: 0.6, ease: 'power2.inOut',
                onUpdate: function () { viewer.requestRender(); }
            }, 0);
        }

        // A straight dolly out from the close-up: x stays at 0 the whole way,
        // so nothing in the frame slides sideways.
        tl.to(rig, {
            py: 0, pz: cfgZ,
            ax: 0, ay: 0, az: 0,
            duration: 1.25,
            ease: 'power2.inOut',
            onUpdate: function () {
                viewer.camera.position.set(0, rig.py, rig.pz);
                viewer.camera.lookAt(rig.ax, rig.ay, rig.az);
                viewer.requestRender();
            }
        }, 0);

        // Chrome comes in over the tail of the move rather than after it, so
        // the two read as one gesture.
        tl.add(reveal, 0.45);
    }

    function closeConfigurator() {
        if (!cfgOpen || animating) return;
        animating = true;

        setOpenPart(null);

        document.body.classList.remove('cfg-open');
        const cfg = el('cfg');
        if (cfg) cfg.setAttribute('aria-hidden', 'true');

        const done = function () {
            cfgOpen = false;
            animating = false;
            applyHeroCamera();
        };

        if (!window.gsap) {
            if (wordPlane) { wordPlane.material.opacity = 0.95; wordPlane.visible = true; }
            done();
            return;
        }

        claimCamera();

        // The AIM has to travel too, not just the position.
        //
        // This is what made the exit feel abrupt while the entrance felt fine.
        // The old tween interpolated camera.position but called lookAt() on a
        // constant — the hero's aim — so on the very first frame the camera
        // snapped its tilt from the configurator's target (the middle of the
        // lamp) to the hero's (the top of it), and then slid smoothly for the
        // remaining second. All of the jerk was in frame one.
        const p = viewer.camera.position;
        const aimFrom = currentAim();
        const rig = {
            px: p.x, py: p.y, pz: p.z,
            ax: aimFrom.x, ay: aimFrom.y, az: aimFrom.z
        };

        const tl = gsap.timeline({ onComplete: done });

        tl.to(rig, {
            px: framing.panX, py: framing.aimY - parallaxDrop(), pz: framing.dist,
            ax: framing.panX, ay: framing.aimY - parallaxDrop(), az: 0,
            duration: 1.25,
            // Out-weighted rather than symmetric: leaving should ease off into
            // the hero pose rather than decelerate hard at the end.
            ease: 'power2.inOut',
            onUpdate: function () {
                viewer.camera.position.set(rig.px, rig.py, rig.pz);
                viewer.camera.lookAt(rig.ax, rig.ay, rig.az);
                viewer.requestRender();
            }
        }, 0);

        if (wordPlane) {
            tl.to(wordPlane.material, {
                opacity: 0.95, duration: 0.8, ease: 'power2.out',
                onUpdate: function () { viewer.requestRender(); }
            }, 0.35);
        }
    }

    /**
     * Where the camera is currently looking, as a world point on the z = 0 plane
     * through the model. Read off the camera's own orientation rather than the
     * last preset, so an exit part-way through a FRONT→LEFT move still starts
     * from where the camera actually is.
     */
    function currentAim() {
        const c = viewer.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
        // Distance along the view ray to the plane z = 0.
        const t = Math.abs(dir.z) > 1e-4 ? -c.position.z / dir.z : 0;
        return c.position.clone().add(dir.multiplyScalar(t));
    }

    /* -------------------------------------------------------------------------
     *  Hotspots
     *
     *  The configurator has no panel. Instead each configurable part of the lamp
     *  carries a marker: hover it (or the mesh itself) to see what it is, click
     *  to get that part's options in a popover beside it.
     *
     *  The options in those popovers are not copies. The sidebar's three control
     *  groups are MOVED into them at startup, element for element, so every
     *  listener script.js bound at init — including the twelve coded pattern
     *  buttons it injects — comes along and keeps working. Rebuilding them would
     *  mean reimplementing pattern baking, active states and cart wiring.
     *
     *  Anchors are placed on a cylinder around the model and swung round to face
     *  the camera, so a marker is never stranded on the back of the lamp when
     *  the view moves to LEFT or RIGHT.
     * ---------------------------------------------------------------------- */
    const HOTSPOTS = [
        { part: 'rim', y: 0.150, r: 0.085, meshes: ['Rim', 'Ring', 'BaseRim', 'BaseRim_1', 'Screen_Main_(Gold)'] },
        { part: 'pattern', y: 0.020, r: 0.090, meshes: PATTERN_MESH_NAMES },
        { part: 'base', y: -0.130, r: 0.080, meshes: ['Base', 'Logo'] }
    ];

    const meshToPart = {};
    HOTSPOTS.forEach(function (h) {
        h.meshes.forEach(function (m) { meshToPart[m] = h.part; });
    });

    let hsLayer = null;
    let openPart = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const anchor = new THREE.Vector3();

    /** Move the sidebar's control groups into the popovers, once. */
    function adoptControls() {
        const map = { base: 'Base Color', rim: 'Rim Finish', pattern: 'Pattern Design' };
        const sections = document.querySelectorAll('.sidebar .control-section');

        Object.keys(map).forEach(function (part) {
            const body = document.querySelector('.hs-pop[data-part="' + part + '"] .hs-pop-body');
            if (!body) return;
            for (let i = 0; i < sections.length; i++) {
                const title = sections[i].querySelector('.control-title');
                if (title && title.textContent.trim() === map[part]) {
                    body.appendChild(sections[i]);
                    break;
                }
            }
        });
    }

    function setOpenPart(part) {
        openPart = part;
        hsLayer.querySelectorAll('.hs').forEach(function (b) {
            b.classList.toggle('is-open', b.dataset.part === part);
        });
        hsLayer.querySelectorAll('.hs-pop').forEach(function (p) {
            p.classList.toggle('is-open', p.dataset.part === part);
        });
    }

    /**
     * Project each anchor to screen space, then place its card beside it.
     *
     * The card is positioned by MEASURING it and clamping the result into the
     * viewport, rather than by a CSS rule per breakpoint. One behaviour on every
     * screen: it prefers the side of the dot with more room, and if neither side
     * fits it goes under the dot instead, always inset from the edges.
     *
     * This replaced a phone-only bottom sheet. The sheet had to clear a bar whose
     * height changes with the length of the finish name, and it detached the
     * options from the part they belong to, which is the whole idea of hotspots.
     */
    const EDGE = 12;   // px kept clear of every viewport edge
    const GAP = 16;   // px between the dot and its card

    /**
     * The band the card is allowed to occupy.
     *
     * Clamping to the viewport alone is not enough: the camera buttons sit at the
     * top and the product bar at the bottom, and the bar's height changes with
     * the length of the finish name. Both are measured so the card is clamped to
     * the space actually free, not to the screen.
     */
    function safeBand(rect) {
        const cfg = el('cfg');
        let top = EDGE;
        let bottom = rect.height - EDGE;
        if (cfg) {
            const cam = cfg.querySelector('.camera-controls');
            const bar = cfg.querySelector('.bottom-bar');
            if (cam) {
                const b = cam.getBoundingClientRect();
                if (b.height) top = Math.max(top, b.bottom - rect.top + EDGE);
            }
            if (bar) {
                const b = bar.getBoundingClientRect();
                if (b.height) bottom = Math.min(bottom, b.top - rect.top - EDGE);
            }
        }
        return { top: top, bottom: Math.max(bottom, top + 40) };
    }

    function placePopover(pop, x, y, rect) {
        // Measured while open; a hidden card still reports its box because it is
        // visibility:hidden rather than display:none.
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;

        const roomRight = rect.width - x - GAP - EDGE;
        const roomLeft = x - GAP - EDGE;

        let left;
        if (w <= roomRight) {
            left = x + GAP;                       // preferred
        } else if (w <= roomLeft) {
            left = x - GAP - w;                   // flip
        } else {
            left = (rect.width - w) / 2;          // neither side fits: centre it
        }

        // Vertically centred on the dot, then clamped into the free band.
        const band = safeBand(rect);
        let top = y - h / 2;

        // If the card had to centre horizontally it is now over the dot, so move
        // it clear: below when the band allows, above when it does not.
        if (w > roomRight && w > roomLeft) {
            top = (y + GAP + h <= band.bottom) ? y + GAP : y - GAP - h;
        }

        top = Math.min(Math.max(top, band.top), Math.max(band.top, band.bottom - h));

        left = Math.min(Math.max(left, EDGE), Math.max(EDGE, rect.width - w - EDGE));

        pop.style.setProperty('--px', Math.round(left) + 'px');
        pop.style.setProperty('--py', Math.round(top) + 'px');
    }

    /** Project each anchor to screen space and write it onto the marker. */
    function positionHotspots() {
        if (!hsLayer || !viewer || !viewer.model || !cfgOpen) return;
        const c = viewer.camera;
        const rect = viewer.renderer.domElement.getBoundingClientRect();

        // Camera azimuth, so anchors sit on the side of the lamp we can see.
        const az = Math.atan2(c.position.x, c.position.z);

        HOTSPOTS.forEach(function (h) {
            anchor.set(Math.sin(az) * h.r, h.y, Math.cos(az) * h.r);
            anchor.project(c);
            const x = (anchor.x * 0.5 + 0.5) * rect.width;
            const y = (-anchor.y * 0.5 + 0.5) * rect.height;

            const dot = hsLayer.querySelector('.hs[data-part="' + h.part + '"]');
            if (dot) {
                dot.style.setProperty('--x', x.toFixed(1) + 'px');
                dot.style.setProperty('--y', y.toFixed(1) + 'px');
            }

            const pop = hsLayer.querySelector('.hs-pop[data-part="' + h.part + '"]');
            if (pop) placePopover(pop, x, y, rect);
        });
    }

    /** Which configurable part, if any, is under the pointer. */
    function pickPart(clientX, clientY) {
        if (!viewer || !viewer.model) return null;
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, viewer.camera);

        const hits = raycaster.intersectObject(viewer.model, true);
        for (let i = 0; i < hits.length; i++) {
            const part = meshToPart[hits[i].object.name];
            if (part) return part;
        }
        return null;
    }

    function initHotspots() {
        hsLayer = el('hsLayer');
        if (!hsLayer) return;
        adoptControls();

        hsLayer.querySelectorAll('.hs').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                setOpenPart(openPart === btn.dataset.part ? null : btn.dataset.part);
            });
        });

        // Clicking inside a popover must not count as clicking away from it.
        hsLayer.querySelectorAll('.hs-pop').forEach(function (p) {
            p.addEventListener('click', function (e) { e.stopPropagation(); });
        });

        const canvas = viewer.renderer.domElement;

        canvas.addEventListener('pointermove', function (e) {
            if (!cfgOpen || animating) return;
            const part = pickPart(e.clientX, e.clientY);
            canvas.style.cursor = part ? 'pointer' : '';
            hsLayer.querySelectorAll('.hs').forEach(function (b) {
                b.classList.toggle('is-near', b.dataset.part === part);
            });
        }, { passive: true });

        canvas.addEventListener('click', function (e) {
            if (!cfgOpen || animating) return;
            const part = pickPart(e.clientX, e.clientY);
            setOpenPart(part && part !== openPart ? part : null);
        });

        // Anywhere else on the overlay closes the popover.
        el('cfg').addEventListener('click', function () { setOpenPart(null); });

        // The markers have to keep up with the camera, and the camera is moved
        // by gsap tweens the render loop knows nothing about, so this rides the
        // same ticker rather than hooking renderFrame.
        if (window.gsap) gsap.ticker.add(positionHotspots);
    }

    /* -------------------------------------------------------------------------
     *  Cursor CTA
     *
     *  While the pointer is over the hero it becomes the Customize button and
     *  the whole hero is the hit area. The nav's copy hides for as long as the
     *  hero is on screen, so there is still only ever one of them.
     *
     *  Pointer-driven by definition, so it is skipped on touch — the nav button
     *  stays visible there instead (see the hover media queries in the CSS).
     * ---------------------------------------------------------------------- */
    /* -------------------------------------------------------------------------
     *  The screen on top of the lamp
     *
     *  The whole hero is the Customize button, and one disc of it is not: the
     *  glass runs MAJESTY OS. Three facts about the geometry drive everything
     *  here, and all three were measured off the model rather than guessed.
     *
     *  1. THE GLASS IS ONE FLAT PLANE. All 256 triangles of Screen_Main_(Gold)
     *     lie within 3 degrees of each other.
     *  2. IT IS TILTED 35.89 DEGREES toward the viewer. Its normal is
     *     (0, 0.8102, 0.5862) and its centre is (0, 0.105, 0.0007). A straight
     *     top down camera looks at this thing nearly edge on, which is why the
     *     first attempt was wrong.
     *  3. THE FACE IS 0.090 IN RADIUS, of which the dark glass inside the gold
     *     bezel is 0.0655. The disc is cut to the glass, not to the face, or
     *     the interface climbs onto the bezel.
     *
     *  So the interface is a disc mesh laid on that plane carrying a
     *  CanvasTexture, and the camera flies down the plane's own normal. Input
     *  is a raycast: hit the disc, take the UV, hand it to os.js, which knows
     *  which control is under that texel.
     * ---------------------------------------------------------------------- */
    const GLASS_N = [0, 0.8102, 0.5862];
    const GLASS_C = [0, 0.105, 0.0007];
    const GLASS_R = 0.0655;
    const OS_FILL = 0.74;        // share of the short viewport axis the disc fills
    const OS_LIFT = 0.0016;      // off the surface, so the two do not z-fight

    let osOpen = false;
    let osMesh = null;
    let osTexture = null;
    let glassMesh = null;
    let osRAF = 0;
    let osLast = 0;
    const osRay = new THREE.Raycaster();

    function glassNormal() { return new THREE.Vector3(GLASS_N[0], GLASS_N[1], GLASS_N[2]).normalize(); }
    function glassCentre() { return new THREE.Vector3(GLASS_C[0], GLASS_C[1], GLASS_C[2]); }

    /** The in-plane up direction, so the interface is not drawn on its side. */
    function glassUp() {
        return new THREE.Vector3().crossVectors(glassNormal(), new THREE.Vector3(1, 0, 0)).normalize();
    }

    /** The lamp's own screen mesh, looked up once. Needed for hit testing long
     *  before the interface is built, so it is separate from buildOsScreen. */
    function findGlass() {
        if (glassMesh || !viewer || !viewer.model) return glassMesh;
        viewer.model.traverse(function (n) {
            if (n.name === 'Screen_Main_(Gold)') glassMesh = n;
        });
        return glassMesh;
    }

    function buildOsScreen() {
        if (osMesh || !viewer || !viewer.model || !window.MajestyOS) return;
        findGlass();

        const tex = new THREE.CanvasTexture(window.MajestyOS.canvas());
        tex.anisotropy = viewer.renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
        osTexture = tex;

        // Basic, not standard: a screen emits its own picture. Lighting it
        // would tint the interface with whatever the room is doing, and the
        // stage's key is warm enough to turn white type gold.
        const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide
        });
        if ('toneMapped' in mat) mat.toneMapped = false;

        osMesh = new THREE.Mesh(new THREE.CircleGeometry(GLASS_R, 128), mat);
        osMesh.name = 'OS_Screen';
        osMesh.visible = false;
        osMesh.renderOrder = 8;
        osMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), glassNormal());
        osMesh.position.copy(glassCentre()).addScaledVector(glassNormal(), OS_LIFT);
        viewer.scene.add(osMesh);
    }

    /** Normalised device coordinates for a client point over the canvas. */
    function osNdc(x, y) {
        const container = el('threeCanvasContainer');
        if (!container) return null;
        const r = container.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
        return new THREE.Vector2(
            ((x - r.left) / r.width) * 2 - 1,
            -((y - r.top) / r.height) * 2 + 1
        );
    }

    /** UV under the pointer on the OS disc, or null. */
    function osUv(x, y) {
        if (!osMesh || !osMesh.visible) return null;
        const nd = osNdc(x, y);
        if (!nd) return null;
        osRay.setFromCamera(nd, viewer.camera);
        const hits = osRay.intersectObject(osMesh, false);
        return hits.length ? hits[0].uv : null;
    }

    /**
     * Is the pointer over the lamp's glass, with nothing in front of it?
     *
     * Raycast against the whole model rather than the screen alone: from a low
     * angle the base stands in front of the screen, and hit testing the screen
     * on its own would report a hit through the body of the product.
     */
    function overScreen(x, y) {
        if (cfgOpen || animating || activeDock || osOpen) return false;
        if (!viewer || !viewer.model || !findGlass()) return false;
        const nd = osNdc(x, y);
        if (!nd) return false;
        osRay.setFromCamera(nd, viewer.camera);
        const hits = osRay.intersectObject(viewer.model, true);
        if (!hits.length || hits[0].object !== glassMesh) return false;
        // Only the dark glass, not the gold bezel around it.
        const p = hits[0].point;
        return Math.hypot(p.x - GLASS_C[0], p.z - GLASS_C[2]) <= GLASS_R;
    }

    function osCameraDistance() {
        const c = viewer.camera;
        const t = Math.tan((c.fov * Math.PI) / 360);
        const need = (2 * GLASS_R) / OS_FILL;
        return Math.max(need / (2 * t), need / (2 * t * c.aspect));
    }

    function applyOsCamera() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        const n = glassNormal();
        const ctr = glassCentre();
        c.up.copy(glassUp());
        c.position.copy(ctr).addScaledVector(n, osCameraDistance());
        c.lookAt(ctr);
        viewer.requestRender();
    }

    /* ----- the frame loop while the interface is up ------------------------- */

    function osFrame(now) {
        osRAF = requestAnimationFrame(osFrame);
        if (!osOpen || !window.MajestyOS) return;
        const dt = osLast ? Math.min((now - osLast) / 1000, 0.05) : 0.016;
        osLast = now;
        if (window.MajestyOS.tick(dt)) {
            osTexture.needsUpdate = true;
            viewer.requestRender();
        }
    }

    function startOsLoop() {
        if (!osRAF) { osLast = 0; osRAF = requestAnimationFrame(osFrame); }
    }

    function stopOsLoop() {
        if (osRAF) { cancelAnimationFrame(osRAF); osRAF = 0; }
    }

    function osTouch(x, y, press) {
        if (!osOpen || !window.MajestyOS) return false;
        const uv = osUv(x, y);
        const changed = press
            ? (uv ? window.MajestyOS.press(uv.x, uv.y) : false)
            : window.MajestyOS.hover(uv ? uv.x : null, uv ? uv.y : null);
        if (changed) {
            window.MajestyOS.redraw();
            osTexture.needsUpdate = true;
            viewer.requestRender();
        }
        document.body.classList.toggle('os-pointing',
            !!uv && window.MajestyOS.hasPointer());
        return !!uv;
    }

    /* ----- opening and closing ---------------------------------------------- */

    function openOS() {
        if (osOpen || cfgOpen || animating || !viewer || !viewer.model) return;
        buildOsScreen();
        if (!osMesh) return;

        osOpen = true;
        animating = true;
        document.body.classList.remove('cursor-cta', 'over-screen');
        document.body.classList.add('os-open');
        window.MajestyOS.reset();
        osTexture.needsUpdate = true;
        osMesh.visible = true;
        startOsLoop();

        const done = function () {
            animating = false;
            applyOsCamera();
        };

        if (!window.gsap) {
            osMesh.material.opacity = 1;
            applyOsCamera();
            done();
            return;
        }

        claimCamera();
        const c = viewer.camera;
        const n = glassNormal(), ctr = glassCentre();
        const toPos = ctr.clone().addScaledVector(n, osCameraDistance());
        const toUp = glassUp();
        const fromPos = c.position.clone();
        const fromUp = c.up.clone();
        const fromAim = currentAim();
        const rig = { t: 0 };
        const pos = new THREE.Vector3(), up = new THREE.Vector3(), aim = new THREE.Vector3();

        gsap.to(rig, {
            t: 1, duration: 1.2, ease: 'power3.inOut',
            onUpdate: function () {
                pos.copy(fromPos).lerp(toPos, rig.t);
                up.copy(fromUp).lerp(toUp, rig.t).normalize();
                aim.set(fromAim.x, fromAim.y, fromAim.z).lerp(ctr, rig.t);
                c.up.copy(up);
                c.position.copy(pos);
                c.lookAt(aim);
                viewer.requestRender();
            },
            onComplete: done
        });

        // The interface fades up over the tail of the move, so the lamp is
        // already facing you by the time there is anything to read.
        gsap.to(osMesh.material, {
            opacity: 1, duration: 0.7, delay: 0.45, ease: 'power2.out',
            onUpdate: function () { viewer.requestRender(); }
        });

        if (wordPlane) {
            gsap.to(wordPlane.material, {
                opacity: 0, duration: 0.5, ease: 'power2.out',
                onUpdate: function () { viewer.requestRender(); }
            });
        }
    }

    function closeOS() {
        if (!osOpen || animating) return;
        animating = true;
        document.body.classList.remove('os-open', 'os-pointing');

        const done = function () {
            osOpen = false;
            animating = false;
            stopOsLoop();
            if (osMesh) { osMesh.visible = false; osMesh.material.opacity = 0; }
            viewer.camera.up.set(0, 1, 0);
            computeFraming();
            sizeWordmark();
            updateScrollProgress();
            applyHeroCamera();
            if (wordPlane) wordPlane.material.opacity = 1;
        };

        if (!window.gsap) { done(); return; }

        const c = viewer.camera;
        const fromPos = c.position.clone();
        const fromUp = c.up.clone();
        const fromAim = glassCentre();
        const heroY = framing.aimY - parallaxDrop();
        const toPos = new THREE.Vector3(framing.panX, heroY, framing.dist);
        const toAim = new THREE.Vector3(framing.panX, heroY, 0);
        const toUp = new THREE.Vector3(0, 1, 0);
        const rig = { t: 0 };
        const pos = new THREE.Vector3(), up = new THREE.Vector3(), aim = new THREE.Vector3();

        gsap.to(osMesh.material, {
            opacity: 0, duration: 0.4, ease: 'power2.in',
            onUpdate: function () { viewer.requestRender(); }
        });

        gsap.to(rig, {
            t: 1, duration: 1.05, delay: 0.15, ease: 'power3.inOut',
            onUpdate: function () {
                pos.copy(fromPos).lerp(toPos, rig.t);
                up.copy(fromUp).lerp(toUp, rig.t).normalize();
                aim.copy(fromAim).lerp(toAim, rig.t);
                c.up.copy(up);
                c.position.copy(pos);
                c.lookAt(aim);
                viewer.requestRender();
            },
            onComplete: done
        });

        if (wordPlane) {
            gsap.to(wordPlane.material, {
                opacity: 1, duration: 0.6, delay: 0.5, ease: 'power2.out',
                onUpdate: function () { viewer.requestRender(); }
            });
        }
    }

    function initOS() {
        if (!window.MajestyOS) return;

        // Ambience is not a mime. Picking a mood relights the real lamp the
        // screen is sitting in, through the path the configurator uses.
        window.MajestyOS.onMood = function (pattern) {
            if (typeof config === 'undefined' || !viewer) return;
            config.pattern = pattern;
            viewer.updateMaterials();
            if (typeof updateConfigurationName === 'function') updateConfigurationName();
            syncControlButtons();
            viewer.requestRender();
        };

        window.MajestyOS.onChange = function () {
            if (!osTexture) return;
            osTexture.needsUpdate = true;
            if (viewer) viewer.requestRender();
        };

        const exit = el('osExit');
        if (exit) exit.addEventListener('click', closeOS);

        window.addEventListener('pointermove', function (e) {
            if (!osOpen || animating) return;
            osTouch(e.clientX, e.clientY, false);
        }, { passive: true });

        window.addEventListener('click', function (e) {
            if (!osOpen || animating) return;
            if (exit && exit.contains(e.target)) return;
            // A tap on a control works it; a tap anywhere else is the way out.
            if (!osTouch(e.clientX, e.clientY, true)) closeOS();
        });

        window.addEventListener('resize', function () {
            if (osOpen && !animating) applyOsCamera();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && osOpen) closeOS();
        });

        // On a touch device initCursorCta bails out early — there is no cursor
        // to follow — and the hero's click handler lives inside it. The glass
        // still has to be tappable, so it gets its own listener here. On a
        // pointer device this does not run, or the click is handled twice.
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            const hero = document.querySelector('.hero');
            if (hero) {
                hero.addEventListener('click', function (e) {
                    if (cfgOpen || animating || osOpen) return;
                    if (!overScreen(e.clientX, e.clientY)) return;
                    e.stopPropagation();   // see the note in initCursorCta
                    openOS();
                });
            }
        }
    }


    function initCursorCta() {
        const node = el('cursorCta');
        const hero = document.querySelector('.hero');
        if (!node || !hero) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

        // quickTo keeps a single tween alive instead of allocating one per move,
        // which is what makes the trail smooth rather than steppy.
        // Half a second of easing reads as lag rather than as smoothing. Short
        // enough to feel attached, long enough not to be a hard cursor swap.
        const toX = window.gsap
            ? gsap.quickTo(node, 'x', { duration: 0.16, ease: 'power2.out' })
            : null;
        const toY = window.gsap
            ? gsap.quickTo(node, 'y', { duration: 0.16, ease: 'power2.out' })
            : null;

        let placed = false;

        window.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return;

            const overHero = !cfgOpen && !animating &&
                hero.contains(document.elementFromPoint(e.clientX, e.clientY) || document.body);

            if (toX) {
                // The first placement jumps rather than flying in from 0,0.
                if (!placed) { gsap.set(node, { x: e.clientX, y: e.clientY }); placed = true; }
                toX(e.clientX);
                toY(e.clientY);
            } else {
                node.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
            }

            document.body.classList.toggle('cursor-cta', overHero);
            document.body.classList.toggle('over-screen',
                overHero && overScreen(e.clientX, e.clientY));

            const pill = node.querySelector('.cta-pill');
            if (pill) {
                const os = document.body.classList.contains('over-screen');
                if (pill.dataset.mode !== (os ? 'os' : 'cfg')) {
                    pill.dataset.mode = os ? 'os' : 'cfg';
                    pill.innerHTML = os
                        ? 'Open MAJESTY OS <i>&rarr;</i>'
                        : 'Customize <i>&rarr;</i>';
                }
            }
        }, { passive: true });

        document.addEventListener('pointerleave', function () {
            document.body.classList.remove('cursor-cta', 'over-screen');
        });

        // The hero itself is the button. The nav sits outside it, so its own
        // links are unaffected.
        hero.addEventListener('click', function (e) {
            if (cfgOpen || animating || osOpen) return;
            document.body.classList.remove('cursor-cta', 'over-screen');
            // The glass is a button inside a button, and it wins.
            if (overScreen(e.clientX, e.clientY)) {
                // Stop here. initOS puts a click listener on the window that
                // treats a tap off the interface as the way out, and this very
                // event would otherwise bubble up to it and shut what it just
                // opened.
                e.stopPropagation();
                openOS();
            } else {
                openConfigurator();
            }
        });
    }

    function armConfigurator() {
        // Every "Customize" on the page opens the overlay rather than following
        // its href. The href is kept as a real link so the page still works
        // with scripting off and so middle-click opens the standalone page.
        document.querySelectorAll('a[href^="configurator.html"]').forEach(function (a) {
            a.addEventListener('click', function (e) {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                openConfigurator();
            });
        });

        const back = el('cfgBack');
        if (back) back.addEventListener('click', closeConfigurator);

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !cfgOpen) return;
            if (openPart) { setOpenPart(null); return; }
            closeConfigurator();
        });
    }

    function initNav() {
        const nav = el('nav');
        if (!nav) return;

        const onScroll = function () {
            nav.classList.toggle('stuck', window.scrollY > 40);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        const burger = nav.querySelector('.nav-burger');
        if (burger) {
            burger.addEventListener('click', function () {
                const open = nav.classList.toggle('open');
                burger.setAttribute('aria-expanded', String(open));
            });
        }
        nav.querySelectorAll('.nav-links a').forEach(function (a) {
            a.addEventListener('click', function () {
                nav.classList.remove('open');
                if (burger) burger.setAttribute('aria-expanded', 'false');
            });
        });
    }

    /* -------------------------------------------------------------------------
     *  Text reveals
     *
     *  Every word in a [data-split] heading is wrapped in its own mask so it can
     *  rise into place on a stagger. The splitter walks TEXT NODES rather than
     *  innerHTML, so the inline markup inside a heading — the italic clause, the
     *  gold span, a <br> — survives intact and the words inside it inherit it.
     * ---------------------------------------------------------------------- */
    const WORD_STAGGER = 34;   // ms between words

    function splitWords(root) {
        if (root.dataset.splitDone) return;
        root.dataset.splitDone = '1';

        const texts = [];
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        while (walk.nextNode()) texts.push(walk.currentNode);

        let index = 0;
        texts.forEach(function (node) {
            if (!node.nodeValue.trim()) return;
            const frag = document.createDocumentFragment();
            // Keep the whitespace: splitting on it and throwing it away collapses
            // "Intelligent Care" into "IntelligentCare".
            node.nodeValue.split(/(\s+)/).forEach(function (chunk) {
                if (!chunk) return;
                if (!chunk.trim()) { frag.appendChild(document.createTextNode(chunk)); return; }
                const mask = document.createElement('span');
                mask.className = 'w';
                const inner = document.createElement('i');
                inner.textContent = chunk;
                inner.style.setProperty('--wd', (index++ * WORD_STAGGER) + 'ms');
                mask.appendChild(inner);
                frag.appendChild(mask);
            });
            node.parentNode.replaceChild(frag, node);
        });
    }

    /**
     * Count a figure up to its final value as it arrives.
     *
     * The markup holds the real number so it is correct with scripting off; the
     * animation only replaces the text while it runs.
     */
    function countUp(node) {
        if (node.dataset.counted) return;
        node.dataset.counted = '1';
        const target = parseFloat(node.textContent.replace(/[^0-9.]/g, ''));
        if (!isFinite(target) || !window.gsap) return;

        const decimals = (node.textContent.split('.')[1] || '').replace(/\D/g, '').length;
        const proxy = { v: 0 };
        gsap.to(proxy, {
            v: target,
            duration: 1.6,
            ease: 'power2.out',
            onUpdate: function () { node.textContent = proxy.v.toFixed(decimals); },
            onComplete: function () { node.textContent = target.toFixed(decimals); }
        });
    }

    /* -------------------------------------------------------------------------
     *  Rotating clause
     *
     *  Cycles the phrases in a [data-rotate], one at a time. Pauses whenever
     *  its panel is off screen: a timer running against a heading nobody can
     *  see is work for nothing, and it would also mean returning to the panel
     *  mid-transition between two phrases.
     * ---------------------------------------------------------------------- */
    const ROTATE_HOLD = 3200;   // ms a phrase stays up

    function initRotators() {
        document.querySelectorAll('[data-rotate]').forEach(function (host) {
            const items = [].slice.call(host.children);
            if (items.length < 2) return;

            let i = 0;
            let timer = null;

            const step = function () {
                const out = items[i];
                i = (i + 1) % items.length;
                const next = items[i];

                out.classList.remove('is-on');
                out.classList.add('is-out');
                next.classList.remove('is-out');
                next.classList.add('is-on');

                // Clear the outgoing phrase's state once it has left, so it can
                // roll up from below again on its next turn rather than dropping
                // in from above.
                setTimeout(function () { out.classList.remove('is-out'); }, 900);
            };

            const start = function () {
                if (timer) return;
                timer = setInterval(step, ROTATE_HOLD);
            };
            const stop = function () {
                clearInterval(timer);
                timer = null;
            };

            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

            const panel = host.closest('.vp') || host;
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(function (entries) {
                    entries[0].isIntersecting ? start() : stop();
                }, { threshold: 0.25 }).observe(panel);
            } else {
                start();
            }

            document.addEventListener('visibilitychange', function () {
                document.hidden ? stop() : (isOnScreen(panel) && start());
            });
        });
    }

    function isOnScreen(node) {
        const b = node.getBoundingClientRect();
        return b.top < window.innerHeight && b.bottom > 0;
    }

    function initReveals() {
        // Split first, so the masks exist before anything can be observed.
        document.querySelectorAll('[data-split]').forEach(splitWords);

        const items = document.querySelectorAll('.reveal, [data-split], .chapter-head');

        if (!('IntersectionObserver' in window)) {
            items.forEach(function (n) { n.classList.add('in'); });
            document.querySelectorAll('[data-count]').forEach(function (n) {
                n.classList.add('in');
            });
            return;
        }

        const io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                const node = entry.target;
                node.classList.add('in');
                node.querySelectorAll('[data-count]').forEach(countUp);
                if (node.hasAttribute('data-count')) countUp(node);
                io.unobserve(node);
            });
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

        items.forEach(function (n) { io.observe(n); });

        // Figures that are not inside a revealed block still need watching.
        document.querySelectorAll('[data-count]').forEach(function (n) { io.observe(n); });

        // SAFETY NET
        //
        // IntersectionObserver does not fire while the document is hidden, and
        // everything here starts invisible. Load the page in a background tab
        // and come back and, without this, the first screenful stays blank
        // until you scroll. Sweep whatever is already on screen instead.
        const sweep = function () {
            items.forEach(function (n) {
                if (n.classList.contains('in')) return;
                const b = n.getBoundingClientRect();
                if (b.top < window.innerHeight && b.bottom > 0) {
                    n.classList.add('in');
                    n.querySelectorAll('[data-count]').forEach(countUp);
                    io.unobserve(n);
                }
            });
        };
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) sweep();
        });
        window.addEventListener('load', sweep);
        window.__revealSweep = sweep;
    }

    function initYear() {
        const y = el('year');
        if (y) y.textContent = String(new Date().getFullYear());
    }

    /* ---------------------------------------------------------------------- */

    function start() {
        document.documentElement.classList.add('js');
        initNav();
        initReveals();
        initRotators();
        initYear();
        initCursorCta();
        initOS();
        initScrollParallax();
        initSmoothScroll();
        initLampDock();
        armConfigurator();
        mountViewer();

        // script.js registers its DOMContentLoaded handler after this file's, so
        // its control buttons — including the twelve coded patterns it injects —
        // do not exist yet. A macrotask lands after every handler has run.
        setTimeout(initHotspots, 0);

        // A hard ceiling on the splash. If WebGL is unavailable or the model
        // request hangs, the page must still become usable.
        setTimeout(function () {
            const pre = el('preloader');
            if (pre && !pre.classList.contains('done')) {
                console.warn('Model did not finish in time — revealing the page anyway.');
                dismissPreloader();
            }
        }, 20000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
