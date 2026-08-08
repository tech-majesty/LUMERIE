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
                { key: 'backdropColor', section: 'Colour', label: 'Base colour', type: 'color', val: 0x080605 },
                { key: 'glowColor', section: 'Colour', label: 'Halo colour', type: 'color', val: 0xffb463 },
                { key: 'glowGain', section: 'Halo', label: 'Halo brightness', min: 0, max: 4, step: 0.01, val: 1.30, dp: 2 },
                {
                    key: 'glowSpread', section: 'Halo', label: 'Halo size', min: 0.02, max: 1.6, step: 0.01, val: 0.32, dp: 2,
                    unit: ' rad',
                    hint: 'Camera fov is only 10 degrees, so the visible patch of dome ' +
                        'spans about that much angle. Values much above ~0.5 are ' +
                        'effectively constant across the frame and read as flat brown.'
                },
                {
                    key: 'glowSoftness', section: 'Halo', label: 'Falloff', min: 0.5, max: 12, step: 0.1, val: 5.0, dp: 1,
                    hint: 'Higher = tighter core and darker corners.'
                },
                {
                    key: 'glowElevation', section: 'Halo', label: 'Halo height', min: -1, max: 1, step: 0.01, val: 0.12, dp: 2,
                    hint: 'Halo direction above the horizon. Exactly 0 makes the dome ' +
                        'symmetric about the floor, which is the one setting where the ' +
                        'floor reflection matches the dome perfectly and the horizon ' +
                        'join becomes invisible.'
                },
                { key: 'domeScale', section: 'Geometry', label: 'Dome size', min: 1.2, max: 12, step: 0.1, val: 3.0, dp: 1 },
                { key: 'backdropDistance', section: 'Geometry', label: 'Dome distance', min: 1, max: 20, step: 0.5, val: 6.0, dp: 1 },
                {
                    key: 'domeOffsetX', section: 'Position', label: 'Offset X', min: -20, max: 20, step: 0.01, val: 0, dp: 2,
                    hint: 'Set by the move gizmo when the backdrop is selected, so a ' +
                        'drag in the viewport survives into the JSON instead of being lost.'
                },
                { key: 'domeOffsetY', section: 'Position', label: 'Offset Y', min: -20, max: 20, step: 0.01, val: 0, dp: 2 },
                { key: 'domeOffsetZ', section: 'Position', label: 'Offset Z', min: -20, max: 20, step: 0.01, val: 0, dp: 2 }
            ]
        },
        {
            group: 'Floor',
            hint: 'Sized to MEET the dome, at the circle where the dome crosses the ' +
                'floor height. Anything smaller leaves a rim in open space, and fading ' +
                'that rim out is what used to draw a dark band along the horizon.',
            fields: [
                {
                    key: 'floorMode', section: 'Type', label: 'Reflection type', type: 'select', val: 'planar',
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
                { key: 'floorColor', section: 'Type', label: 'Floor colour', type: 'color', val: 0x090808 },
                { key: 'reflectStrength', section: 'Reflection', label: 'Reflection', min: 0, max: 1.5, step: 0.01, val: 0.50, dp: 2 },
                {
                    key: 'reflectFade', section: 'Reflection', label: 'Reflection falloff', min: 0, max: 14, step: 0.1, val: 3.2, dp: 1,
                    hint: 'How fast the lamp\'s own mirror image dies off with distance.'
                },
                {
                    key: 'reflectRoughness', section: 'Reflection', label: 'Roughness', min: 0, max: 1, step: 0.01, val: 0.35, dp: 2,
                    hint: 'Drives which MIP LEVEL of the reflection is sampled — the same ' +
                        'approach three.js\'s WebGPU roughness-reflection example uses. ' +
                        'A trilinear mip pyramid is smooth by construction, where a ' +
                        'fixed-tap blur bands and shimmers. 0 = mirror.'
                },
                {
                    key: 'reflectBlurRamp', section: 'Reflection', label: 'Roughness with distance', min: 0, max: 1, step: 0.01, val: 0.45, dp: 2,
                    hint: 'Extra roughness added as the reflection recedes, so it ' +
                        'dissolves the way a real rough surface scatters over distance.'
                },
                {
                    key: 'floorF0', section: 'Reflection', label: 'Base reflectance', min: 0, max: 1, step: 0.005, val: 0.05, dp: 3,
                    hint: 'How much the floor reflects looking STRAIGHT DOWN. Real ' +
                        'polished stone is about 0.05 — reflecting everything at every ' +
                        'angle is what makes a reflection look washed out. It rises ' +
                        'toward 1 at grazing angles on its own (Schlick).'
                },
                {
                    key: 'fresnelGain', section: 'Reflection', label: 'Grazing boost', min: 0, max: 1, step: 0.01, val: 0.90, dp: 2,
                    hint: '0 = flat reflectance at every angle (looks fake and washed), ' +
                        '1 = full Fresnel curve up to a mirror at the horizon.'
                },
                { key: 'poolRadius', section: 'Light pool', label: 'Light pool size', min: 0.01, max: 1.5, step: 0.01, val: 0.20, dp: 2 },
                { key: 'poolGain', section: 'Light pool', label: 'Light pool strength', min: 0, max: 2, step: 0.01, val: 0.30, dp: 2 },
                {
                    key: 'horizonGain', section: 'Horizon blend', label: 'Backdrop bounce', min: 0, max: 1, step: 0.01, val: 0.0, dp: 2,
                    hint: 'Warmth added to the far floor. Measured as a 16 -> 39 luma ' +
                        'step across the horizon join at 0.14, which is why it is off.'
                },
                { key: 'horizonRange', section: 'Horizon blend', label: 'Bounce reach', min: 0.05, max: 2, step: 0.01, val: 0.55, dp: 2 },
                {
                    key: 'horizonStart', section: 'Horizon blend', label: 'Mirror band start', min: 0, max: 3, step: 0.01, val: 1.00, dp: 2,
                    hint: 'Where the floor starts becoming a pure mirror so the join to ' +
                        'the dome is seamless.'
                },
                { key: 'horizonEnd', section: 'Horizon blend', label: 'Mirror band end', min: 0, max: 4, step: 0.01, val: 1.80, dp: 2 },
                { key: 'floorRadius', section: 'Geometry', label: 'Falloff reference', min: 2, max: 40, step: 0.5, val: 14.0, dp: 1 },
                {
                    key: 'floorOffsetY', section: 'Geometry', label: 'Floor height', min: -5, max: 5, step: 0.005, val: 0, dp: 3,
                    hint: 'Relative to the base of the model. The gizmo writes this.'
                },
                {
                    key: 'floorRoughness', section: 'Material', label: 'Floor roughness', min: 0, max: 1, step: 0.01, val: 0.25, dp: 2,
                    hint: 'Used by SSR and matte modes. This is a real material ' +
                        'roughness, not a screen-space blur.'
                },
                {
                    key: 'floorMetalness', section: 'Material', label: 'Floor metalness', min: 0, max: 1, step: 0.01, val: 0.6, dp: 2
                },
                {
                    key: 'reflectionResolution', section: 'Quality', label: 'Reflection buffer', type: 'select', val: 512,
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
                // Clamp to the schema's range. reflectBlurRamp used to run 0..6 and
                // now means 0..1, so an older preset would otherwise drive the
                // roughness ramp six times past full and pin the floor to its
                // blurriest mip.
                out[k] = (f.min !== undefined && f.max !== undefined)
                    ? Math.min(f.max, Math.max(f.min, v))
                    : v;
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
        uniform sampler2D tDiffuse;   // reflection, with a full mip chain
        uniform vec3      glowColor;
        uniform float     reflectStrength;
        uniform float     roughness;
        uniform float     roughGrow;
        uniform float     maxLod;
        uniform float     reflectFade;
        uniform float     poolRadius;
        uniform float     poolGain;
        uniform float     floorRadius;
        uniform float     fresnelGain;
        uniform float     floorF0;
        uniform float     horizonGain;
        uniform float     horizonRange;
        uniform float     horizonStart;
        uniform float     horizonEnd;
        varying vec4      vUv;
        varying vec2      vLocal;
        varying vec3      vWorld;

        /**
         * Reflector sets its render target's encoding to renderer.outputEncoding
         * on EVERY frame, so the reflection texture holds sRGB-encoded values.
         * The composer's intermediate buffers are linear and only the final pass
         * encodes to screen, so sampling the reflection raw and writing it here
         * means it gets encoded a SECOND time — which brightens midtones and, since
         * the curve is non-linear per channel, shifts hue as well. Measured against
         * the real lamp it came out r x1.51, g x1.09, b x2.00: not an exposure
         * boost, a colour-space mismatch.
         */
        vec3 srgbToLinear(vec3 c) {
            return mix(pow((c + 0.055) / 1.055, vec3(2.4)),
                       c / 12.92,
                       step(c, vec3(0.04045)));
        }

        void main() {
            float r = length(vLocal) / max(floorRadius, 1e-3);

            // ROUGH REFLECTION via MIP LEVEL, the same idea as three.js's WebGPU
            // roughness-reflection example. Roughness picks a level of the
            // reflection's mip pyramid, and trilinear filtering between levels is
            // smooth by construction — no tap count to alias against, which is
            // what made the previous separable-gaussian version noisy.
            float rough = clamp(roughness + r * roughGrow, 0.0, 1.0);
            // Perceptual: roughness^2 tracks how blurred a surface actually looks,
            // so the low end stays controllable instead of jumping straight to soft.
            float lod = clamp(rough * rough * maxLod, 0.0, maxLod);
            #ifdef REFL_LOD
                vec3 reflRaw = texture2DProjLodEXT(tDiffuse, vUv, lod).rgb;
            #else
                vec3 reflRaw = texture2DProj(tDiffuse, vUv).rgb;
            #endif
            // Back to linear, so the reflection sits in the same space as
            // everything else in the buffer and is encoded exactly once.
            vec3 refl = srgbToLinear(reflRaw);

            // FRESNEL: nearly a full mirror at a grazing angle, which is what lets
            // the floor BECOME the dome at the horizon with no step in brightness.
            vec3 vd = normalize(vWorld - cameraPosition);
            float grazing = pow(1.0 - abs(vd.y), 5.0);

            // SCHLICK FRESNEL. The previous formulation was
            //     mix(near, 1.0, grazing * fresnelGain)
            // which collapses to 1 whenever reflectFade is 0 (near becomes 1), so
            // the floor became a flat 100% mirror at every angle regardless of the
            // other controls — a reflection as bright as the object itself, which
            // is what reads as washed out.
            //
            // A real floor reflects only floorF0 looking straight down and climbs
            // toward a mirror at grazing. That gradient is the whole look: subtle
            // under the object, strong toward the horizon.
            float cosTheta = abs(vd.y);                       // floor normal is +Y
            float schlick  = pow(1.0 - cosTheta, 5.0);
            float fres     = floorF0 + (1.0 - floorF0) * schlick * fresnelGain;

            // Distance attenuation on top, so the mirror image concentrates near
            // its source rather than staying equally strong to the rim.
            float atten = exp(-r * reflectFade);

            // GUARDED: with horizonStart == horizonEnd this was smoothstep(0,0,r),
            // a divide by zero returning 1 everywhere.
            float far = (horizonEnd > horizonStart)
                ? smoothstep(horizonStart, horizonEnd, r)
                : 0.0;

            // The horizon band stays a separate max(), not something reflectStrength
            // scales — otherwise turning the reflection down brings back the dark
            // seam where the floor meets the dome.
            float lampK = clamp(reflectStrength * fres * atten, 0.0, 1.0);
            float k = clamp(max(lampK, far), 0.0, 1.0);

            float pool = pow(max(0.0, 1.0 - r / max(poolRadius, 1e-3)), 2.2) * poolGain;

            // local +Y is world -Z once the disc is laid flat, i.e. toward the dome.
            float horizon = smoothstep(0.0, floorRadius * horizonRange, vLocal.y) * horizonGain;

            // color fades out as k rises, so at the horizon the floor is pure
            // reflection and nothing darkens the join.
            vec3 c = color * (1.0 - k) + refl * k + glowColor * (pool + horizon);
            gl_FragColor = vec4(c, 1.0);
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

        // Explicit-LOD sampling is native on WebGL2; on WebGL1 it needs an
        // extension, and without it the shader falls back to the sharp mirror
        // rather than failing to compile.
        const gl = renderer.getContext();
        const lodSupported = renderer.capabilities.isWebGL2 ||
            !!renderer.extensions.get('EXT_shader_texture_lod');

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
                        glowColor: { value: new THREE.Color(S.glowColor) },
                        reflectStrength: { value: S.reflectStrength },
                        roughness: { value: S.reflectRoughness },
                        roughGrow: { value: S.reflectBlurRamp },
                        maxLod: { value: Math.log2(res) },
                        reflectFade: { value: S.reflectFade },
                        poolRadius: { value: S.poolRadius },
                        poolGain: { value: S.poolGain },
                        floorRadius: { value: refLen },
                        fresnelGain: { value: S.fresnelGain },
                        floorF0: { value: S.floorF0 },
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

        // MIPMAPS on the reflection target are what make the roughness blur smooth.
        // Reflector hardcodes LinearFilter and only disables mipmaps for non-power-
        // of-two sizes, so with a POT buffer it is enough to switch the min filter
        // and ask for mips — the renderer then regenerates them each time it
        // renders into the target.
        if (S.floorMode === 'planar') {
            // Reflector builds its ShaderMaterial from only {uniforms, vertexShader,
            // fragmentShader} — a `defines` entry in the shader object is dropped,
            // which silently left REFL_LOD undefined and the mip sampling switched
            // off. Set it on the material instead.
            if (lodSupported) {
                floor.material.defines = Object.assign({}, floor.material.defines, { REFL_LOD: '' });
                floor.material.needsUpdate = true;
            }
            const rt = floor.getRenderTarget();
            rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
            rt.texture.generateMipmaps = true;
            rt.texture.needsUpdate = true;
        }

        floor.rotateX(-Math.PI / 2);
        floor.position.y = floorY + S.floorOffsetY;
        floor.renderOrder = -5;
        scene.add(floor);


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
                f.roughness.value = n.reflectRoughness;
                f.roughGrow.value = n.reflectBlurRamp;
                f.reflectFade.value = n.reflectFade;
                f.poolRadius.value = n.poolRadius;
                f.poolGain.value = n.poolGain;
                f.floorRadius.value = span * n.floorRadius;
                f.fresnelGain.value = n.fresnelGain;
                f.floorF0.value = n.floorF0;
                f.horizonGain.value = n.horizonGain;
                f.horizonRange.value = n.horizonRange;
                f.horizonStart.value = n.horizonStart;
                f.horizonEnd.value = n.horizonEnd;

                dome.position.set(n.domeOffsetX, centreY + n.domeOffsetY, n.domeOffsetZ);
                floor.position.y = floorY + n.floorOffsetY;

                return needsRebuild;
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

            /**
             * Kept as a no-op. The roughness blur is now mip sampling inside the
             * floor shader, so there is no separate blur pass to drive — and no
             * one-frame latency either, which the old pre-pass had.
             */
            blur: function () { },

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
            }
        };
        return api;
    }

    // -------------------------------------------------------------------------
    //  Live preset — paste the studio's "Copy stage JSON" output here and BOTH
    //  the storefront and the studio pick it up. Null means use the defaults.
    // -------------------------------------------------------------------------
    // Pasted from the studio.
    //
    // Worth knowing what this particular set asks for, since several values sit at
    // the end of their range on purpose:
    //   reflectRoughness 0 + reflectBlurRamp 0 -> a SHARP mirror, no mip blur
    //   reflectStrength 1.5                    -> the reflection is pushed past 1:1
    //   glowElevation 0                        -> halo centred on the horizon, the
    //                                             one value where the floor's
    //                                             reflection matches the dome and
    //                                             the join disappears entirely
    //   domeScale 1.2 + backdropDistance 20    -> a tight dome; the camera far
    //                                             plane is derived from it, so this
    //                                             is safe
    //   reflectionResolution 2048              -> 4x the pixels of 1024. Sharp
    //                                             reflection has no blur to hide
    //                                             behind, so it needs them.
    const STAGE_PRESET = {
        "majestyStage": 1,
        "backdropColor": "#080605",
        "glowColor": "#ffb463",
        "glowGain": 1.3,
        "glowSpread": 0.2,
        "glowSoftness": 4,
        "glowElevation": 0,
        "domeScale": 1.2,
        "backdropDistance": 20,
        "domeOffsetX": 0,
        "domeOffsetY": 0,
        "domeOffsetZ": 0,
        "floorMode": "planar",
        "floorColor": "#090808",
        "reflectStrength": 1.5,
        "reflectFade": 0,
        "reflectRoughness": 0,
        "reflectBlurRamp": 0,
        "floorF0": 0.05,
        "fresnelGain": 1,
        "poolRadius": 0.23,
        "poolGain": 0.28,
        "horizonGain": 0,
        "horizonRange": 0.55,
        "horizonStart": 0,
        "horizonEnd": 0,
        "floorRadius": 40,
        "floorOffsetY": 0,
        "floorRoughness": 0,
        "floorMetalness": 1,
        "reflectionResolution": 2048
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
