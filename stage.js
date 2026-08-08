/* =============================================================================
 *  Majesty — studio stage (backdrop dome + glossy floor)
 *
 *  Loaded by BOTH the storefront and the pattern studio, for the same reason
 *  pattern-engine.js is: the studio exists to tune this, and if the tuning lived
 *  in one file and the shipping code in another they would drift. Paste a stage
 *  JSON from the studio into STAGE_PRESET below and both pages change together.
 *
 *  SCHEMA is the single source of truth. It defines the defaults, the slider
 *  ranges AND the panel layout, so the studio's Stage tab builds itself and
 *  adding a parameter later is one entry here rather than a control to hand-wire.
 * ========================================================================== */
(function (global) {
    'use strict';

    // -------------------------------------------------------------------------
    //  Schema — groups of fields. `type` defaults to 'number'.
    // -------------------------------------------------------------------------
    const SCHEMA = [
        {
            group: 'Backdrop',
            hint: 'A dome, not a flat plate. A plate shows its own edges as slanted ' +
                'lines once the camera yaws; a back-facing sphere has no silhouette ' +
                'to expose. The gradient is driven by world direction, so the halo ' +
                'stays anchored behind the lamp instead of sliding with the camera.',
            fields: [
                { key: 'backdropColor', label: 'Base colour', type: 'color', val: 0x080605 },
                { key: 'glowColor', label: 'Halo colour', type: 'color', val: 0xffb463 },
                { key: 'glowGain', label: 'Halo brightness', min: 0, max: 4, step: 0.01, val: 1.30, dp: 2 },
                {
                    key: 'glowSpread', label: 'Halo size', min: 0.02, max: 1.6, step: 0.01, val: 0.32, dp: 2,
                    unit: ' rad',
                    hint: 'Camera fov is only 10 degrees, so the visible patch of dome ' +
                        'spans about that much angle. Values much above ~0.5 are ' +
                        'effectively constant across the frame and read as flat brown.'
                },
                {
                    key: 'glowSoftness', label: 'Falloff', min: 0.5, max: 12, step: 0.1, val: 5.0, dp: 1,
                    hint: 'Higher = tighter core and darker corners.'
                },
                {
                    key: 'glowElevation', label: 'Halo height', min: -1, max: 1, step: 0.01, val: 0.12, dp: 2,
                    hint: 'Halo direction above the horizon. Exactly 0 makes the dome ' +
                        'symmetric about the floor, which is the one setting where the ' +
                        'floor reflection matches the dome perfectly and the horizon ' +
                        'join becomes invisible.'
                },
                { key: 'domeScale', label: 'Dome size', min: 1.2, max: 12, step: 0.1, val: 3.0, dp: 1 },
                { key: 'backdropDistance', label: 'Dome distance', min: 1, max: 20, step: 0.5, val: 6.0, dp: 1 },
                {
                    key: 'domeOffsetX', label: 'Offset X', min: -20, max: 20, step: 0.01, val: 0, dp: 2,
                    hint: 'Set by the move gizmo when the backdrop is selected, so a ' +
                        'drag in the viewport survives into the JSON instead of being lost.'
                },
                { key: 'domeOffsetY', label: 'Offset Y', min: -20, max: 20, step: 0.01, val: 0, dp: 2 },
                { key: 'domeOffsetZ', label: 'Offset Z', min: -20, max: 20, step: 0.01, val: 0, dp: 2 }
            ]
        },
        {
            group: 'Floor',
            hint: 'Sized to MEET the dome, at the circle where the dome crosses the ' +
                'floor height. Anything smaller leaves a rim in open space, and fading ' +
                'that rim out is what used to draw a dark band along the horizon.',
            fields: [
                {
                    key: 'floorMode', label: 'Reflection type', type: 'select', val: 'planar',
                    options: [
                        { value: 'planar', label: 'Polished (reflective)' },
                        { value: 'none', label: 'Matte (no reflection)' }
                    ],
                    rebuild: true,
                    hint: 'SSR was removed rather than left in the menu broken: r128\'s ' +
                        'SSRPass hides its groundReflector before the normal pass, so ' +
                        'it EXCLUDES the ground from screen-space reflection by design. ' +
                        'Planar reflection with a roughness blur is what actually works ' +
                        'here, and is what product configurators use.'
                },
                { key: 'floorColor', label: 'Floor colour', type: 'color', val: 0x090808 },
                { key: 'reflectStrength', label: 'Reflection', min: 0, max: 1.5, step: 0.01, val: 0.50, dp: 2 },
                {
                    key: 'reflectFade', label: 'Reflection falloff', min: 0, max: 14, step: 0.1, val: 3.2, dp: 1,
                    hint: 'How fast the lamp\'s own mirror image dies off with distance.'
                },
                {
                    key: 'reflectBlurRadius', label: 'Roughness (blur)', min: 0, max: 8, step: 0.05, val: 2.2, dp: 2,
                    hint: 'Gaussian step in blur-buffer texels. This is the "slightly ' +
                        'rough, not a mirror" control.'
                },
                {
                    key: 'reflectBlurRamp', label: 'Blur ramp', min: 0, max: 6, step: 0.05, val: 1.6, dp: 2,
                    hint: 'How quickly it reaches full blur going outward. 0 = uniformly sharp.'
                },
                {
                    key: 'fresnelGain', label: 'Grazing boost', min: 0, max: 1, step: 0.01, val: 0.90, dp: 2,
                    hint: 'A glossy floor is nearly a full mirror at a grazing angle. ' +
                        'Lowering this brings back a visible step at the horizon.'
                },
                { key: 'poolRadius', label: 'Light pool size', min: 0.01, max: 1.5, step: 0.01, val: 0.20, dp: 2 },
                { key: 'poolGain', label: 'Light pool strength', min: 0, max: 2, step: 0.01, val: 0.30, dp: 2 },
                {
                    key: 'horizonGain', label: 'Backdrop bounce', min: 0, max: 1, step: 0.01, val: 0.0, dp: 2,
                    hint: 'Warmth added to the far floor. Measured as a 16 -> 39 luma ' +
                        'step across the horizon join at 0.14, which is why it is off.'
                },
                { key: 'horizonRange', label: 'Bounce reach', min: 0.05, max: 2, step: 0.01, val: 0.55, dp: 2 },
                {
                    key: 'horizonStart', label: 'Mirror band start', min: 0, max: 3, step: 0.01, val: 1.00, dp: 2,
                    hint: 'Where the floor starts becoming a pure mirror so the join to ' +
                        'the dome is seamless.'
                },
                { key: 'horizonEnd', label: 'Mirror band end', min: 0, max: 4, step: 0.01, val: 1.80, dp: 2 },
                { key: 'floorRadius', label: 'Falloff reference', min: 2, max: 40, step: 0.5, val: 14.0, dp: 1 },
                {
                    key: 'floorOffsetY', label: 'Floor height', min: -5, max: 5, step: 0.005, val: 0, dp: 3,
                    hint: 'Relative to the base of the model. The gizmo writes this.'
                },
                {
                    key: 'floorRoughness', label: 'Floor roughness', min: 0, max: 1, step: 0.01, val: 0.25, dp: 2,
                    hint: 'Used by SSR and matte modes. This is a real material ' +
                        'roughness, not a screen-space blur.'
                },
                {
                    key: 'floorMetalness', label: 'Floor metalness', min: 0, max: 1, step: 0.01, val: 0.6, dp: 2
                },
                {
                    key: 'reflectionResolution', label: 'Reflection buffer', type: 'select', val: 512,
                    options: [256, 512, 1024, 2048],
                    rebuild: true,
                    hint: 'Small is fine because the result is blurred. Changing this ' +
                        'rebuilds the stage.'
                }
            ]
        }
    ];

    /** Flat {key: value} of every schema default. */
    function defaults() {
        const out = {};
        SCHEMA.forEach(g => g.fields.forEach(f => { out[f.key] = f.val; }));
        return out;
    }

    /** Field lookup by key, for validation and for the UI. */
    const FIELD = {};
    SCHEMA.forEach(g => g.fields.forEach(f => { FIELD[f.key] = f; }));

    /**
     * Merge a partial settings object (e.g. pasted JSON) over the defaults,
     * accepting '#rrggbb' strings for colours and ignoring unknown keys so an
     * older or newer preset cannot break the page.
     */
    function normalise(input) {
        const out = defaults();
        if (!input) return out;
        for (const [k, v] of Object.entries(input)) {
            const f = FIELD[k];
            if (!f) continue;
            if (f.type === 'color') {
                out[k] = (typeof v === 'string') ? parseInt(v.replace('#', ''), 16) : v;
            } else if (f.type === 'select' && typeof f.val === 'string') {
                // enum: only accept a value the schema actually offers
                const allowed = (f.options || []).map(o => (o && o.value !== undefined) ? o.value : o);
                if (allowed.indexOf(v) !== -1) out[k] = v;
            } else if (typeof v === 'number' && isFinite(v)) {
                out[k] = v;
            }
        }
        return out;
    }

    /** Settings as pasteable JSON, colours as hex strings so they are readable. */
    function toJSON(settings) {
        const out = { majestyStage: 1 };
        SCHEMA.forEach(g => g.fields.forEach(f => {
            const v = settings[f.key];
            out[f.key] = (f.type === 'color' && typeof v === 'number')
                ? '#' + ('000000' + (v >>> 0).toString(16)).slice(-6)
                : v;
        }));
        return JSON.stringify(out, null, 2);
    }

    // -------------------------------------------------------------------------
    //  Shaders
    // -------------------------------------------------------------------------
    const DOME_VERT = `
        varying vec3 vDir;
        uniform vec3 center;
        void main() {
            vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - center);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`;

    // Writes gl_FragColor directly and so sits OUTSIDE tonemapping, deliberately:
    // this is a designed gradient, not a lit surface, and ACES would only crush
    // the falloff we are matching.
    const DOME_FRAG = `
        uniform vec3  glowColor;
        uniform vec3  baseColor;
        uniform vec3  glowDir;
        uniform float glowSpread;
        uniform float glowSoft;
        uniform float glowGain;
        varying vec3  vDir;
        void main() {
            vec3 d = normalize(vDir);
            // Angular distance from the halo's centre direction, so the halo is
            // anchored in WORLD space rather than sliding with the camera.
            float ang = acos(clamp(dot(d, normalize(glowDir)), -1.0, 1.0));
            float t = 1.0 - clamp(ang / max(glowSpread, 1e-3), 0.0, 1.0);
            // pow() falloff: bright core, long tail — how light on a wall falls off.
            float halo = pow(t, glowSoft) * glowGain;
            gl_FragColor = vec4(baseColor + glowColor * halo, 1.0);
        }`;

    const FLOOR_VERT = `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec2 vLocal;
        varying vec3 vWorld;
        void main() {
            vUv    = textureMatrix * vec4(position, 1.0);
            vLocal = position.xy;                 // the circle lies in local XY
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`;

    const FLOOR_FRAG = `
        uniform vec3      color;
        uniform sampler2D tDiffuse;   // sharp reflection
        uniform sampler2D tBlur;      // gaussian-blurred copy
        uniform vec3      glowColor;
        uniform float     reflectStrength;
        uniform float     blurRamp;
        uniform float     reflectFade;
        uniform float     poolRadius;
        uniform float     poolGain;
        uniform float     floorRadius;
        uniform float     fresnelGain;
        uniform float     horizonGain;
        uniform float     horizonRange;
        uniform float     horizonStart;
        uniform float     horizonEnd;
        varying vec4      vUv;
        varying vec2      vLocal;
        varying vec3      vWorld;

        void main() {
            float r = length(vLocal) / max(floorRadius, 1e-3);

            // ROUGH REFLECTION: a sharp sample mixed toward a properly blurred
            // copy. Taking a ring of taps here instead made the samples overlap
            // and read as ghosting; a separable gaussian in its own buffer is
            // both smoother and cheaper than enough taps to hide that.
            vec3 sharp = texture2DProj(tDiffuse, vUv).rgb;
            vec3 soft  = texture2DProj(tBlur,    vUv).rgb;
            float rough = clamp(r * blurRamp, 0.0, 1.0);
            vec3 refl = mix(sharp, soft, rough);

            // FRESNEL: nearly a full mirror at a grazing angle, which is what lets
            // the floor BECOME the dome at the horizon with no step in brightness.
            vec3 vd = normalize(vWorld - cameraPosition);
            float grazing = pow(1.0 - abs(vd.y), 5.0);

            float near = exp(-r * reflectFade);

            // GUARDED: with horizonStart == horizonEnd this was smoothstep(0,0,r),
            // a divide by zero that returns 1 everywhere — which pinned the whole
            // floor at full mirror and made reflectStrength a no-op.
            float far = (horizonEnd > horizonStart)
                ? smoothstep(horizonStart, horizonEnd, r)
                : 0.0;

            // reflectStrength is a MASTER gain on the lamp's reflection, so 0
            // really means none. Fresnel alone cannot reach the horizon (the view
            // ray is only exactly horizontal infinitely far away, so grazing peaks
            // near 0.92 at the rim), which is why the horizon blend is a separate
            // term rather than something reflectStrength scales — otherwise turning
            // the reflection down would bring the dark seam back with it.
            float lampK = reflectStrength * mix(near, 1.0, clamp(grazing * fresnelGain, 0.0, 1.0));
            float k = clamp(max(lampK, far), 0.0, 1.0);

            float pool = pow(max(0.0, 1.0 - r / max(poolRadius, 1e-3)), 2.2) * poolGain;

            // local +Y is world -Z once the disc is laid flat, i.e. toward the dome.
            float horizon = smoothstep(0.0, floorRadius * horizonRange, vLocal.y) * horizonGain;

            // color fades out as k rises, so at the horizon the floor is pure
            // reflection and nothing darkens the join.
            vec3 c = color * (1.0 - k) + refl * k + glowColor * (pool + horizon);
            gl_FragColor = vec4(c, 1.0);
        }`;

    const BLUR_FRAG = `
        uniform sampler2D tSrc;
        uniform vec2  direction;
        uniform vec2  texel;
        uniform float radius;
        varying vec2  vUvQ;
        void main() {
            // 9-tap gaussian, weights from Pascal's row 8 normalised.
            float w[5];
            w[0] = 0.2270270270; w[1] = 0.1945945946; w[2] = 0.1216216216;
            w[3] = 0.0540540541; w[4] = 0.0162162162;
            vec2 stp = direction * texel * radius;
            vec3 sum = texture2D(tSrc, vUvQ).rgb * w[0];
            for (int i = 1; i < 5; i++) {
                vec2 o = stp * float(i);
                sum += texture2D(tSrc, vUvQ + o).rgb * w[i];
                sum += texture2D(tSrc, vUvQ - o).rgb * w[i];
            }
            gl_FragColor = vec4(sum, 1.0);
        }`;

    // -------------------------------------------------------------------------
    //  Build
    // -------------------------------------------------------------------------
    /**
     * Create the stage and add it to the scene.
     *
     * opts: { THREE, scene, renderer, camera, box, camDist, settings }
     *   box     — Box3 of the model, in world space. Every length derives from
     *             this and from the camera, so nothing is a magic world unit.
     *   camDist — furthest the camera will sit from the model. The dome must
     *             enclose it. Defaults to the camera's current distance.
     */
    function create(opts) {
        const THREE = opts.THREE;
        const scene = opts.scene;
        const renderer = opts.renderer;
        const camera = opts.camera;
        const box = opts.box;
        const S = normalise(opts.settings);

        const size = box.getSize(new THREE.Vector3());
        const span = Math.max(size.x, size.y, size.z);
        const floorY = box.min.y;
        const centreY = box.min.y + size.y * 0.5;
        const camDist = opts.camDist || Math.max(camera.position.length(), span * 2);

        // --- dome ---
        const domeR = Math.max(camDist, span * S.backdropDistance) * S.domeScale;
        const dome = new THREE.Mesh(
            new THREE.SphereGeometry(domeR, 48, 32),
            new THREE.ShaderMaterial({
                side: THREE.BackSide,
                // Depth WRITE is on. Nothing is ever behind the dome, so this costs
                // nothing visually, but AO reads the depth buffer — with the dome
                // writing nothing, AO had no far surface to occlude against and
                // produced garbage. It also correctly stops the far half of the
                // floor painting over the backdrop.
                depthWrite: true,
                uniforms: {
                    glowColor: { value: new THREE.Color(S.glowColor) },
                    baseColor: { value: new THREE.Color(S.backdropColor) },
                    glowDir: { value: new THREE.Vector3(0, S.glowElevation, -1).normalize() },
                    glowSpread: { value: S.glowSpread },
                    glowSoft: { value: S.glowSoftness },
                    glowGain: { value: S.glowGain },
                    center: { value: new THREE.Vector3(0, centreY, 0) }
                },
                vertexShader: DOME_VERT,
                fragmentShader: DOME_FRAG
            })
        );
        dome.position.set(S.domeOffsetX, centreY + S.domeOffsetY, S.domeOffsetZ);
        dome.renderOrder = -10;
        dome.frustumCulled = false;
        scene.add(dome);

        // --- floor ---
        // Radius chosen so the disc meets the dome exactly at the floor height.
        const dy = floorY - centreY;
        const radius = Math.sqrt(Math.max(domeR * domeR - dy * dy, 0));
        // Falloffs stay normalised by this reference length rather than by the
        // disc radius, so growing the disc to meet the dome does not silently
        // rescale the pool, the blur ramp and the reflection fade with it.
        const refLen = span * S.floorRadius;
        const res = S.reflectionResolution;

        const floorGeo = new THREE.CircleGeometry(radius, 128);
        let floor, groundReflector = null, ssrTargets = null;

        if (S.floorMode === 'none') {
            // Matte floor: a real PBR surface with no reflection pass at all. This
            // is what "reflection off" should have looked like.
            floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
                color: new THREE.Color(S.floorColor),
                roughness: S.floorRoughness,
                metalness: S.floorMetalness
            }));

        } else {
            // assign, do not re-declare: `const floor` here would shadow the outer
            // `let floor` and leave it undefined outside this block
            floor = new THREE.Reflector(floorGeo, {
                clipBias: 0.003,
                textureWidth: res,
                textureHeight: res,
                color: new THREE.Color(S.floorColor),
                recursion: 0,
                shader: {
                    uniforms: {
                        color: { value: null },
                        tDiffuse: { value: null },
                        textureMatrix: { value: null },
                        tBlur: { value: null },
                        glowColor: { value: new THREE.Color(S.glowColor) },
                        reflectStrength: { value: S.reflectStrength },
                        blurRamp: { value: S.reflectBlurRamp },
                        reflectFade: { value: S.reflectFade },
                        poolRadius: { value: S.poolRadius },
                        poolGain: { value: S.poolGain },
                        floorRadius: { value: refLen },
                        fresnelGain: { value: S.fresnelGain },
                        horizonGain: { value: S.horizonGain },
                        horizonRange: { value: S.horizonRange },
                        horizonStart: { value: S.horizonStart },
                        horizonEnd: { value: S.horizonEnd }
                    },
                    vertexShader: FLOOR_VERT,
                    fragmentShader: FLOOR_FRAG
                }
            });
        }

        floor.rotateX(-Math.PI / 2);
        floor.position.y = floorY + S.floorOffsetY;
        floor.renderOrder = -5;
        scene.add(floor);

        // --- blur buffers ---
        // Half resolution on purpose: the output is blurred, so the detail thrown
        // away is detail the blur would have destroyed anyway, and each pass costs
        // a quarter as much. Two 1D passes beat an NxN kernel for the same radius.
        const half = Math.max(64, Math.floor(res / 2));
        const rtOpts = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false
        };
        const blurRT = [
            new THREE.WebGLRenderTarget(half, half, rtOpts),
            new THREE.WebGLRenderTarget(half, half, rtOpts)
        ];
        // The reflection is already tonemapped and encoded by the pass that made
        // it, so the blur must not re-encode: keep both buffers in the same space.
        blurRT.forEach(rt => { rt.texture.encoding = THREE.LinearEncoding; });

        const blurMat = new THREE.ShaderMaterial({
            uniforms: {
                tSrc: { value: null },
                direction: { value: new THREE.Vector2(1, 0) },
                texel: { value: new THREE.Vector2(1 / half, 1 / half) },
                radius: { value: S.reflectBlurRadius }
            },
            vertexShader: `
                varying vec2 vUvQ;
                void main() { vUvQ = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: BLUR_FRAG
        });
        const blurScene = new THREE.Scene();
        blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat));
        const blurCam = new THREE.Camera();

        const api = {
            dome: dome,
            floor: floor,
            groundReflector: groundReflector,
            ssrTargets: ssrTargets,
            mode: S.floorMode,
            settings: S,
            radius: radius,
            domeRadius: domeR,
            resolution: res,

            /** Push settings into the live uniforms. Returns true if a rebuild is needed. */
            update: function (next) {
                const n = normalise(next);
                // Every "did this change?" test has to happen BEFORE the assign
                // below. S and api.settings are the same object, so assigning
                // first overwrites the old values and the comparisons all come out
                // false — which is why switching floor mode silently did nothing.
                const needsRebuild =
                    n.reflectionResolution !== S.reflectionResolution ||
                    n.floorMode !== S.floorMode ||
                    n.domeScale !== S.domeScale ||
                    n.backdropDistance !== S.backdropDistance;
                Object.assign(api.settings, n);

                const d = dome.material.uniforms;
                d.glowColor.value.set(n.glowColor);
                d.baseColor.value.set(n.backdropColor);
                d.glowDir.value.set(0, n.glowElevation, -1).normalize();
                d.glowSpread.value = n.glowSpread;
                d.glowSoft.value = n.glowSoftness;
                d.glowGain.value = n.glowGain;

                // A mode change is structural: bail out and let the caller rebuild
                // rather than writing uniforms into a material of the wrong kind.
                if (needsRebuild) return true;

                if (api.mode === 'none') {
                    floor.material.color.set(n.floorColor);
                    floor.material.roughness = n.floorRoughness;
                    floor.material.metalness = n.floorMetalness;
                    return needsRebuild;
                }

                const f = floor.material.uniforms;
                f.color.value.set(n.floorColor);
                f.glowColor.value.set(n.glowColor);
                f.reflectStrength.value = n.reflectStrength;
                f.blurRamp.value = n.reflectBlurRamp;
                f.reflectFade.value = n.reflectFade;
                f.poolRadius.value = n.poolRadius;
                f.poolGain.value = n.poolGain;
                f.floorRadius.value = span * n.floorRadius;
                f.fresnelGain.value = n.fresnelGain;
                f.horizonGain.value = n.horizonGain;
                f.horizonRange.value = n.horizonRange;
                f.horizonStart.value = n.horizonStart;
                f.horizonEnd.value = n.horizonEnd;

                blurMat.uniforms.radius.value = n.reflectBlurRadius;

                dome.position.set(n.domeOffsetX, centreY + n.domeOffsetY, n.domeOffsetZ);
                floor.position.y = floorY + n.floorOffsetY;

                return needsRebuild;
            },

            /**
             * Blur the reflector's target and point the floor at the result.
             *
             * Reads the target the reflector filled on the PREVIOUS frame, because
             * the reflector only renders when the floor is drawn, which happens
             * after this. One frame of latency on a reflection is imperceptible,
             * and buying it avoids a second full reflection render per frame.
             */
            blur: function () {
                // Planar only. SSR does its own, physically-correct blur inside
                // SSRPass, and the matte floor has nothing to blur.
                if (api.mode !== 'planar') return;
                const src = floor.getRenderTarget && floor.getRenderTarget();
                if (!src) return;
                // A host's selective-bloom pass swaps meshes to a flat dark
                // material; if that is in place there are no uniforms to write to,
                // and blurring now would target a material nobody displays.
                const mat = floor.material;
                if (!mat || !mat.uniforms || !mat.uniforms.tBlur) return;
                const prev = renderer.getRenderTarget();
                const u = blurMat.uniforms;

                u.tSrc.value = src.texture;
                u.direction.value.set(1, 0);
                renderer.setRenderTarget(blurRT[0]);
                renderer.render(blurScene, blurCam);

                u.tSrc.value = blurRT[0].texture;
                u.direction.value.set(0, 1);
                renderer.setRenderTarget(blurRT[1]);
                renderer.render(blurScene, blurCam);

                renderer.setRenderTarget(prev);
                mat.uniforms.tBlur.value = blurRT[1].texture;
            },

            /**
             * Read the live transforms back into settings, so a gizmo drag becomes
             * a value that Copy stage JSON will actually capture.
             */
            syncFromTransforms: function () {
                api.settings.domeOffsetX = +dome.position.x.toFixed(4);
                api.settings.domeOffsetY = +(dome.position.y - centreY).toFixed(4);
                api.settings.domeOffsetZ = +dome.position.z.toFixed(4);
                api.settings.floorOffsetY = +(floor.position.y - floorY).toFixed(4);
                return api.settings;
            },

            setVisible: function (on) {
                dome.visible = on;
                floor.visible = on;
            },

            dispose: function () {
                scene.remove(dome);
                scene.remove(floor);
                dome.geometry.dispose();
                dome.material.dispose();
                floor.geometry.dispose();
                floor.material.dispose();
                if (floor.dispose) floor.dispose();
                blurRT.forEach(rt => rt.dispose());
                blurMat.dispose();
            }
        };
        return api;
    }

    // -------------------------------------------------------------------------
    //  Live preset — paste the studio's "Copy stage JSON" output here and BOTH
    //  the storefront and the studio pick it up. Null means use the defaults.
    // -------------------------------------------------------------------------
    // Pasted from the studio. NOTE: reflectStrength is 0 here, which was set
    // while the override bug made it a no-op — now that it is a real master gain,
    // 0 genuinely means the floor has no lamp reflection at all. Raise it (or
    // switch floorMode) when you want the reflection back.
    const STAGE_PRESET = {
        "majestyStage": 1,
        "backdropColor": "#080605",
        "glowColor": "#ffb463",
        "glowGain": 1.3,
        "glowSpread": 0.32,
        "glowSoftness": 5,
        "glowElevation": 0.12,
        "domeScale": 3,
        "backdropDistance": 6,
        "domeOffsetX": 0,
        "domeOffsetY": 0,
        "domeOffsetZ": 0,
        "floorColor": "#090808",
        "reflectStrength": 0,
        "reflectFade": 0,
        "reflectBlurRadius": 0,
        "reflectBlurRamp": 6,
        "fresnelGain": 1,
        "poolRadius": 0.23,
        "poolGain": 0.28,
        "horizonGain": 0,
        "horizonRange": 0.55,
        "horizonStart": 0,
        "horizonEnd": 0,
        "floorRadius": 40,
        "floorOffsetY": 0,
        "reflectionResolution": 1024
    };

    global.MajestyStage = {
        version: 1,
        SCHEMA: SCHEMA,
        FIELD: FIELD,
        defaults: defaults,
        normalise: normalise,
        toJSON: toJSON,
        create: create,
        PRESET: STAGE_PRESET,
        /** Defaults with the live preset applied, which is what pages should use. */
        current: function () { return normalise(STAGE_PRESET); }
    };
})(window);
