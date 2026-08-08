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

    const FINISH = { base: 'Red', rim: 'Golden Ring', pattern: 'Triangle' };

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

    /** Park the camera on the hero pose. Straight on, no roll, no offset. */
    function applyHeroCamera() {
        if (!viewer || !viewer.camera) return;
        const c = viewer.camera;
        c.position.set(framing.panX, framing.aimY, framing.dist);
        c.lookAt(framing.panX, framing.aimY, 0);
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

        // 0 is the top of the frame, 1 the bottom. The camera aims at the top
        // of the lamp, so the frame centre is already high on the product and
        // the word wants to sit a little above it.
        const frac = wide ? 0.30 : 0.22;
        wordPlane.position.y = framing.aimY + (0.5 - frac) * 2 * halfHeight;
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
                claimCamera();
                applyHeroCamera();
                dismissPreloader();
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
        const originalRender = viewer.renderFrame.bind(viewer);
        viewer.renderFrame = function () {
            if (heroVisible || cfgOpen || animating) originalRender();
        };

        // ThreeViewer's own resize handler updates camera.aspect; this must run
        // after it, so the framing is recomputed against the new aspect.
        window.addEventListener('resize', function () {
            computeFraming();
            sizeWordmark();
            if (cfgOpen) {
                applyConfiguratorAngles();
            } else if (!animating) {
                applyHeroCamera();
            }
        });

        const hero = document.querySelector('.hero');
        if (hero && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                heroVisible = entries[0].isIntersecting;
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
    const SIDEBAR_PX = 340;

    /** Half the sidebar's width, in world units at the model's distance. */
    function sidebarShift() {
        const c = viewer.camera;
        const halfFov = (c.fov * Math.PI) / 360;
        const halfWidth = CONFIGURATOR_Z * Math.tan(halfFov) * c.aspect;
        const sidebar = Math.min(SIDEBAR_PX, window.innerWidth * 0.84);
        if (window.innerWidth < 900) return 0;   // sidebar is a bottom sheet
        return halfWidth * (sidebar / window.innerWidth);
    }

    /**
     * Re-point the viewer's own camera presets so the lamp centres in the space
     * left of the sidebar. Both the position and the look-at move together, so
     * the LEFT/RIGHT orbit is unchanged — it is a lens shift, not a skew.
     */
    function applyConfiguratorAngles() {
        const s = sidebarShift();
        viewer.cameraAngles = {
            front: { pos: { x: s, y: 0, z: CONFIGURATOR_Z }, lookAt: { x: s, y: 0, z: 0 } },
            left: { pos: { x: s - 1.8, y: 0.5, z: CONFIGURATOR_Z }, lookAt: { x: s, y: 0, z: 0 } },
            right: { pos: { x: s + 1.8, y: 0.5, z: CONFIGURATOR_Z }, lookAt: { x: s, y: 0, z: 0 } }
        };
    }

    /*
     *  The hero is a fixed brand shot — red body, golden ring — but a visitor
     *  who has been configuring should not lose their work by pressing Back.
     *  So the two views keep separate finishes: closing stores whatever was
     *  selected and puts the hero's back on, opening restores the stored one.
     */
    let savedFinish = null;

    function applyFinish(f) {
        if (typeof config === 'undefined' || !viewer) return;
        config.base = f.base;
        config.rim = f.rim;
        config.pattern = f.pattern;
        viewer.updateMaterials();
        if (typeof updateConfigurationName === 'function') updateConfigurationName();
        syncControlButtons();
    }

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
        if (cfgOpen || animating || !viewer || !viewer.model) return;
        cfgOpen = true;
        animating = true;

        if (savedFinish) applyFinish(savedFinish);

        // The canvas is pinned to the hero, so the hero has to be the viewport.
        window.scrollTo({ top: 0, behavior: 'instant' });
        applyConfiguratorAngles();

        const s = sidebarShift();
        const target = { x: framing.panX, y: framing.aimY, z: framing.dist };

        const done = function () {
            animating = false;
            document.body.classList.add('cfg-open');
            const cfg = el('cfg');
            if (cfg) cfg.setAttribute('aria-hidden', 'false');
            // From here the configurator's own buttons own the camera.
        };

        if (!window.gsap) {
            viewer.camera.position.set(s, 0, CONFIGURATOR_Z);
            viewer.camera.lookAt(s, 0, 0);
            if (wordPlane) wordPlane.visible = false;
            done();
            return;
        }

        claimCamera();
        const tl = gsap.timeline({ onComplete: done });

        // The wordmark is a scene object, so it fades with its material.
        if (wordPlane) {
            tl.to(wordPlane.material, { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, 0);
        }

        // Pull back from the close-up to the configurator's full-product pose.
        tl.to(target, {
            x: s, y: 0, z: CONFIGURATOR_Z,
            duration: 1.1,
            ease: 'power2.inOut',
            onUpdate: function () {
                viewer.camera.position.set(target.x, target.y, target.z);
                viewer.camera.lookAt(s * (1 - this.progress()) + s * this.progress(), 0, 0);
            }
        }, 0);

        // Chrome slides in over the tail of the move rather than after it, so
        // the two read as one gesture.
        tl.add(function () {
            document.body.classList.add('cfg-open');
            const cfg = el('cfg');
            if (cfg) cfg.setAttribute('aria-hidden', 'false');
        }, 0.45);
    }

    function closeConfigurator() {
        if (!cfgOpen || animating) return;
        animating = true;

        if (typeof config !== 'undefined') {
            savedFinish = { base: config.base, rim: config.rim, pattern: config.pattern };
        }
        applyFinish(FINISH);

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
        const from = viewer.camera.position;
        const target = { x: from.x, y: from.y, z: from.z };
        const tl = gsap.timeline({ onComplete: done });

        tl.to(target, {
            x: framing.panX, y: framing.aimY, z: framing.dist,
            duration: 1.0,
            ease: 'power2.inOut',
            onUpdate: function () {
                viewer.camera.position.set(target.x, target.y, target.z);
                viewer.camera.lookAt(framing.panX, framing.aimY, 0);
            }
        }, 0);

        if (wordPlane) {
            tl.to(wordPlane.material, { opacity: 0.95, duration: 0.7, ease: 'power2.out' }, 0.3);
        }
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
            if (e.key === 'Escape' && cfgOpen) closeConfigurator();
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
        armConfigurator();
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
