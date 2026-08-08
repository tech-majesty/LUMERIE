/* =============================================================================
 *  MAJESTY — landing page behaviour
 *
 *  Four jobs:
 *
 *  1. The hero's cinematic sequence. It reuses ThreeViewer from viewer.js
 *     unchanged — same rig, same stage, same logo light as the configurator —
 *     and only takes over the camera and the backdrop.
 *
 *  2. Making the canvas transparent above the horizon, so the lamp renders in
 *     FRONT of the LUMERIE wordmark instead of on top of an opaque dome. That
 *     layering is the whole hero, so it is not a detail.
 *
 *  3. The handoff into the configurator: rather than a page jump, the camera
 *     flies to the configurator's own opening pose, the page furniture clears,
 *     and only then does the navigation happen — so the lamp appears to stay
 *     put across two documents.
 *
 *  4. Page chrome: preloader, sticky nav, mobile menu, scroll reveals, and not
 *     burning a GPU on an off-screen canvas.
 * ========================================================================== */
(function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* -------------------------------------------------------------------------
     *  Cinematic sequence
     *
     *  Deliberately slow: three legs of roughly twenty-five seconds each, eased
     *  at both ends, so at any given moment the movement is barely perceptible
     *  and the lamp reads as a still that happens to breathe. A faster orbit
     *  makes a product look like a turntable render.
     *
     *  Offsets are MULTIPLES of the framing distance, which is derived at
     *  runtime from the viewport (see computeFraming) — fixed world coordinates
     *  frame correctly at one aspect ratio and crop the lamp at every other.
     *
     *  The finish never changes. Red body, golden ring, throughout.
     * ---------------------------------------------------------------------- */
    const SHOTS = [
        {
            // Opening: a shade off head-on, easing in.
            from: { x: 0.10, y: 0.075, z: 1.10, ty: 0.006 },
            to: { x: -0.06, y: 0.020, z: 1.00, ty: 0.000 },
            dur: 26
        },
        {
            // Long drift left and slightly down; the floor reflection leads.
            to: { x: -0.30, y: -0.035, z: 1.05, ty: 0.004 },
            dur: 25
        },
        {
            // Rise back across to the right and return to the opening pose so
            // the loop closes without a cut.
            to: { x: 0.10, y: 0.075, z: 1.10, ty: 0.006 },
            dur: 29
        }
    ];

    const FINISH = { base: 'Red', rim: 'Golden Ring', pattern: 'Triangle' };

    const cam = Object.assign({}, SHOTS[0].from);

    // Pointer parallax, applied on top of the timeline rather than baked into
    // it so the two never fight over camera.position. Small — this is a long
    // lens, and a little translation goes a long way.
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    const PARALLAX = 0.03;

    /* -------------------------------------------------------------------------
     *  Framing
     *
     *  The lamp is 0.362 world units tall on a 10° lens, so the distance that
     *  fills a given share of the frame is trigonometry, not a magic number:
     *
     *      visibleHeight = 2 · d · tan(fov / 2)
     *
     *  The lamp stays horizontally centred on every viewport, because it has to
     *  sit across the middle of the wordmark behind it. On a phone the copy
     *  needs the upper half, so the view pans up, which puts the lamp low in
     *  the frame.
     * ---------------------------------------------------------------------- */
    const MODEL_HEIGHT = 0.362;
    const CONFIGURATOR_Z = 3;     // ThreeViewer.cameraAngles.front.pos.z
    const framing = { dist: 3.4, panX: 0, panY: 0, driftX: 1 };

    function computeFraming() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        const halfFov = (c.fov * Math.PI) / 360;
        const wide = window.innerWidth >= 900;

        const fill = wide ? 0.58 : 0.34;
        framing.dist = MODEL_HEIGHT / (fill * 2 * Math.tan(halfFov));

        const halfHeight = framing.dist * Math.tan(halfFov);
        framing.panX = 0;
        // Panning the view UP puts the subject LOWER in the frame.
        framing.panY = wide ? 0 : halfHeight * 0.18;

        // The shots' sideways drift is a fraction of the framing DISTANCE, which
        // is the right unit on a landscape frame and far too much on a portrait
        // one — a phone's frame is about a fifth as wide in world units, so the
        // same drift swings the lamp clean off the side. Scale it by how wide
        // the frame actually is.
        framing.driftX = wide ? 1 : Math.max(0.18, c.aspect / 1.6);
    }

    let viewer = null;
    let heroVisible = true;
    let timeline = null;
    let handingOff = false;

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

    function applyCamera() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        const d = framing.dist;
        c.position.set(
            framing.panX + (cam.x + parallax.x) * d * framing.driftX,
            framing.panY + (cam.y + parallax.y) * d,
            cam.z * d
        );
        c.lookAt(
            framing.panX + parallax.tx * d * framing.driftX,
            framing.panY + cam.ty + parallax.ty * d,
            0
        );
    }

    function buildTimeline() {
        // The viewer tweens the camera to 'front' the moment the model lands.
        // Kill it, or the two run simultaneously for 1.5s and the shot judders.
        if (window.gsap) gsap.killTweensOf(viewer.camera.position);

        if (reduceMotion) {
            Object.assign(cam, SHOTS[0].to);
            applyCamera();
            return;
        }

        timeline = gsap.timeline({ repeat: -1 });
        SHOTS.forEach(function (shot) {
            timeline.to(cam, {
                x: shot.to.x, y: shot.to.y, z: shot.to.z, ty: shot.to.ty,
                duration: shot.dur,
                ease: 'sine.inOut'
            });
        });
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

        // 0 is the top of the frame, 1 the bottom.
        const frac = wide ? 0.42 : 0.25;
        wordPlane.position.y = framing.panY + (0.5 - frac) * 2 * halfHeight;
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
                if (typeof config !== 'undefined') {
                    config.base = FINISH.base;
                    config.rim = FINISH.rim;
                    config.pattern = FINISH.pattern;
                    viewer.updateMaterials();
                }
                computeFraming();
                buildWordmark();
                buildTimeline();
                applyCamera();
                dismissPreloader();
            }
        });

        // No loadModel() call here: ThreeViewer's constructor runs init(), which
        // already kicks it off. Calling it again downloads the 6.7 MB GLB twice,
        // adds two copies of the lamp to the scene and builds the stage twice.

        // Exposed for tuning the shot list from the console — the numbers above
        // are only meaningful against the actual model bounds.
        window.__heroViewer = viewer;

        // Drive the camera from gsap's ticker rather than three's loop, so the
        // write always lands after the timeline has advanced for that frame.
        if (window.gsap) gsap.ticker.add(applyCamera);

        // Skip the render entirely while the hero is scrolled away. Two composer
        // passes and a whole-scene material swap per frame is not something to
        // keep paying for behind eight sections of copy.
        const originalRender = viewer.renderFrame.bind(viewer);
        viewer.renderFrame = function () {
            if (heroVisible || handingOff) originalRender();
        };

        // ThreeViewer's own resize handler updates camera.aspect; this must run
        // after it, so the framing is recomputed against the new aspect.
        window.addEventListener('resize', function () {
            computeFraming();
            sizeWordmark();
            applyCamera();
        });

        const hero = document.querySelector('.hero');
        if (hero && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                heroVisible = entries[0].isIntersecting;
                if (timeline && !handingOff) {
                    heroVisible ? timeline.resume() : timeline.pause();
                }
            }, { threshold: 0 }).observe(hero);
        }
    }

    /* -------------------------------------------------------------------------
     *  Hero → configurator handoff
     *
     *  The configurator is a separate document with its own ThreeViewer, so this
     *  cannot be a single continuous scene. What it can be is continuous to
     *  look at: the camera flies to exactly the pose the configurator opens on,
     *  the backdrop dome comes back so the frame already matches, the page
     *  furniture clears, and the navigation only happens once a curtain in the
     *  shared background colour is fully up. The configurator is then told to
     *  skip its own splash and fade up from that same colour.
     *
     *  The model is in the HTTP cache by this point, so the second page has it
     *  immediately.
     * ---------------------------------------------------------------------- */
    function handoff(href) {
        if (handingOff) return;
        handingOff = true;

        const go = function () {
            const url = new URL(href, location.href);
            url.searchParams.set('from', 'hero');
            location.href = url.toString();
        };

        if (!window.gsap || !viewer || !viewer.model) { go(); return; }

        if (timeline) timeline.kill();
        gsap.killTweensOf(parallax);

        const curtain = el('curtain');
        if (curtain) curtain.style.visibility = 'visible';

        const tl = gsap.timeline({ onComplete: go });

        // Page furniture out first, so the lamp is alone before it moves.
        tl.to(['.hero-foot', '.hero-veil', '.nav'], {
            opacity: 0, duration: 0.55, ease: 'power2.inOut'
        }, 0);

        // The wordmark is a scene object, so it fades with its material rather
        // than with CSS. It has to be gone before the camera arrives, or the
        // configurator would open on a frame that still has a word in it.
        if (wordPlane) {
            tl.to(wordPlane.material, { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, 0);
        }

        tl.to(parallax, { x: 0, y: 0, tx: 0, ty: 0, duration: 0.7, ease: 'power2.out' }, 0);

        // Fly to the configurator's opening pose. cam.z is a multiple of the
        // framing distance, so the target is the configurator's world z divided
        // by it — that lands the camera on exactly (0, 0, 3).
        tl.to(cam, {
            x: 0, y: 0, ty: 0,
            z: CONFIGURATOR_Z / framing.dist,
            duration: 1.5,
            ease: 'power2.inOut'
        }, 0.15);

        if (curtain) {
            tl.to(curtain, { opacity: 1, duration: 0.5, ease: 'power2.in' }, 1.3);
        }
    }

    function armHandoff() {
        document.querySelectorAll('a[href^="configurator.html"]').forEach(function (a) {
            a.addEventListener('click', function (e) {
                // Let modified clicks (new tab, download) behave normally.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                handoff(a.getAttribute('href'));
            });
        });
    }

    /* ---------------------------------------------------------------------- */

    function initPointerParallax() {
        if (reduceMotion) return;
        window.addEventListener('pointermove', function (e) {
            if (!heroVisible || handingOff || e.pointerType === 'touch') return;
            if (!window.gsap) return;
            const nx = (e.clientX / window.innerWidth) * 2 - 1;
            const ny = (e.clientY / window.innerHeight) * 2 - 1;
            gsap.to(parallax, {
                x: nx * PARALLAX,
                y: -ny * PARALLAX * 0.5,
                tx: nx * PARALLAX * 0.25,
                ty: -ny * PARALLAX * 0.12,
                duration: 1.8,
                ease: 'power2.out',
                overwrite: true
            });
        }, { passive: true });
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

    function initReveals() {
        const items = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            items.forEach(function (n) { n.classList.add('in'); });
            return;
        }
        const io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('in');
                io.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });

        items.forEach(function (n) { io.observe(n); });
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
        initYear();
        initPointerParallax();
        armHandoff();
        mountViewer();

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
