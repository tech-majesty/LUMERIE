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
    }

    function initScrollParallax() {
        let queued = false;
        const onScroll = function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                if (cfgOpen || animating) return;
                const h = window.innerHeight || 1;
                const next = Math.min(1, Math.max(0, window.scrollY / h));
                if (Math.abs(next - scrollProgress) < 0.0005) return;
                scrollProgress = next;
                applyHeroCamera();
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
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
                // The lamp's mirror image in the floor reads a stop hot once the
                // camera pulls back far enough to show much floor. This dims only
                // that — the dome, the halo and every value in the stage preset
                // are untouched. See installReflectionDimmer in viewer.js.
                viewer.setReflectionDim(REFLECTION_DIM);

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
                if (!animating && viewer.setCameraAngle) {
                    const active = document.querySelector('.camera-btn.active');
                    viewer.setCameraAngle(active ? active.dataset.angle : 'front');
                }
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
    // Live crossfade tweens. They write material colours every frame, so
    // anything that changes a material has to stop them first — otherwise a
    // swatch clicked while a fade is still running is immediately painted over
    // by the fade's next onUpdate, and the lamp ignores the click.
    let finishTweens = [];

    function killFinishTweens() {
        finishTweens.forEach(function (t) { t.kill(); });
        finishTweens = [];
    }

    function crossfadeFinish(next, duration) {
        killFinishTweens();
        if (!window.gsap || !viewer || !viewer.model) { applyFinish(next); return; }

        const read = function () {
            const out = new Map();
            viewer.model.traverse(function (n) {
                if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
                const m = n.material;
                out.set(m, {
                    color: m.color ? m.color.clone() : null,
                    metalness: m.metalness,
                    roughness: m.roughness,
                    envMapIntensity: m.envMapIntensity
                });
            });
            return out;
        };

        const before = read();
        applyFinish(next);
        const after = read();

        after.forEach(function (to, m) {
            const from = before.get(m);
            if (!from) return;                       // new material, nothing to fade from

            const proxy = { t: 0 };
            if (from.color && to.color) m.color.copy(from.color);
            if (from.metalness !== undefined) m.metalness = from.metalness;
            if (from.roughness !== undefined) m.roughness = from.roughness;
            if (from.envMapIntensity !== undefined) m.envMapIntensity = from.envMapIntensity;

            finishTweens.push(gsap.to(proxy, {
                t: 1,
                duration: duration,
                ease: 'power2.inOut',
                overwrite: true,
                onUpdate: function () {
                    const t = proxy.t;
                    if (from.color && to.color) m.color.copy(from.color).lerp(to.color, t);
                    if (to.metalness !== undefined) m.metalness = from.metalness + (to.metalness - from.metalness) * t;
                    if (to.roughness !== undefined) m.roughness = from.roughness + (to.roughness - from.roughness) * t;
                    if (to.envMapIntensity !== undefined) {
                        m.envMapIntensity = from.envMapIntensity + (to.envMapIntensity - from.envMapIntensity) * t;
                    }
                },
                // Land on the exact target rather than the last interpolated
                // step, or repeated open/close cycles drift a unit at a time.
                onComplete: function () {
                    if (to.color) m.color.copy(to.color);
                    if (to.metalness !== undefined) m.metalness = to.metalness;
                    if (to.roughness !== undefined) m.roughness = to.roughness;
                    if (to.envMapIntensity !== undefined) m.envMapIntensity = to.envMapIntensity;
                }
            }));
        });
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

        if (savedFinish) crossfadeFinish(savedFinish, 0.9);

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
            tl.to(wordPlane.material, { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, 0);
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

        if (typeof config !== 'undefined') {
            savedFinish = { base: config.base, rim: config.rim, pattern: config.pattern };
        }
        crossfadeFinish(FINISH, 0.9);

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
            }
        }, 0);

        if (wordPlane) {
            tl.to(wordPlane.material, { opacity: 0.95, duration: 0.8, ease: 'power2.out' }, 0.35);
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

            hsLayer.querySelectorAll('[data-part="' + h.part + '"]').forEach(function (n) {
                n.style.setProperty('--x', x.toFixed(1) + 'px');
                n.style.setProperty('--y', y.toFixed(1) + 'px');
                if (n.classList.contains('hs-pop')) {
                    // Flip to the other side of the dot rather than overflow.
                    n.classList.toggle('to-left', x + 20 * 16 > rect.width);
                }
            });
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

        // Clicking inside a popover must not count as clicking away from it —
        // and it must cancel any finish crossfade still in flight, or the fade
        // paints over the choice on its very next frame.
        hsLayer.querySelectorAll('.hs-pop').forEach(function (p) {
            p.addEventListener('click', function (e) { e.stopPropagation(); });
            p.addEventListener('pointerdown', killFinishTweens, true);
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
        }, { passive: true });

        document.addEventListener('pointerleave', function () {
            document.body.classList.remove('cursor-cta');
        });

        // The hero itself is the button. The nav sits outside it, so its own
        // links are unaffected.
        hero.addEventListener('click', function () {
            if (cfgOpen || animating) return;
            document.body.classList.remove('cursor-cta');
            openConfigurator();
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
        initYear();
        initCursorCta();
        initScrollParallax();
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
