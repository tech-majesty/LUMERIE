/* =============================================================================
 *  Majesty — logo light (true light linking)
 *
 *  WHY THIS EXISTS RATHER THAN A THREE.SpotLight
 *
 *  three.js layers do NOT do light linking. The only layer tests in
 *  WebGLRenderer are `object.layers.test( camera.layers )` — three of them, all
 *  against the CAMERA. There is no light-vs-object test anywhere, so a light on
 *  layer 1 is merely included in the frame when the camera can see layer 1, and
 *  once included it lights the whole scene. Measured on this model with a
 *  layer-restricted spotlight aimed at the emboss: the logo brightened by 69 and
 *  the body beside it by 93. No linking at all.
 *
 *  So the light is computed INSIDE the logo's own material instead. It is a real
 *  punctual spot — position, cone, penumbra, distance falloff, Lambert diffuse
 *  and GGX specular, using the same BRDF functions the standard material uses —
 *  but because it lives in one material it cannot reach anything else. That is
 *  light linking by construction rather than by configuration.
 *
 *  Shared by the storefront and the studio so tuning in one changes both, the
 *  same arrangement as stage.js and pattern-engine.js.
 * ========================================================================== */
(function (global) {
    'use strict';

    const SCHEMA = [
        {
            group: 'Logo light',
            hint: 'Affects the Logo mesh and nothing else — it is computed inside ' +
                'that material rather than added to the scene, so there is no spill ' +
                'to suppress. Positions are world units; the whole lamp is only ' +
                '0.36 tall, so values here are small.',
            fields: [
                { key: 'enabled', section: 'Light', label: 'Enable', type: 'bool', val: true },
                { key: 'color', section: 'Light', label: 'Colour', type: 'color', val: 0xfff0d8 },
                {
                    key: 'intensity', section: 'Light', label: 'Intensity', min: 0, max: 40, step: 0.1, val: 8, dp: 1,
                    hint: 'Higher than a scene light would need: this one is not ' +
                        'competing with the rig, it only adds to the emboss.'
                },
                { key: 'posX', section: 'Position', label: 'Position X', min: -1, max: 1, step: 0.005, val: 0, dp: 3 },
                { key: 'posY', section: 'Position', label: 'Position Y', min: -1, max: 1, step: 0.005, val: -0.05, dp: 3 },
                {
                    key: 'posZ', section: 'Position', label: 'Position Z', min: -1, max: 1, step: 0.005, val: 0.24, dp: 3,
                    hint: 'The emboss faces +Z, so the light belongs in front of it.'
                },
                { key: 'targetX', section: 'Aim', label: 'Target X', min: -1, max: 1, step: 0.005, val: -0.002, dp: 3 },
                { key: 'targetY', section: 'Aim', label: 'Target Y', min: -1, max: 1, step: 0.005, val: -0.146, dp: 3 },
                { key: 'targetZ', section: 'Aim', label: 'Target Z', min: -1, max: 1, step: 0.005, val: 0.068, dp: 3 },
                {
                    key: 'angle', section: 'Cone', label: 'Cone angle', min: 0.02, max: 1.5, step: 0.01, val: 0.5, dp: 2,
                    unit: ' rad'
                },
                {
                    key: 'penumbra', section: 'Cone', label: 'Penumbra', min: 0, max: 1, step: 0.01, val: 0.8, dp: 2,
                    hint: '0 is a hard-edged cone, 1 fades the whole way in from the rim.'
                },
                {
                    key: 'distance', section: 'Falloff', label: 'Range', min: 0.05, max: 3, step: 0.01, val: 0.55, dp: 2,
                    hint: 'Distance at which the light reaches zero.'
                },
                { key: 'decay', section: 'Falloff', label: 'Decay', min: 0, max: 3, step: 0.05, val: 1, dp: 2 }
            ]
        }
    ];

    const FIELD = {};
    SCHEMA.forEach(g => g.fields.forEach(f => { FIELD[f.key] = f; }));

    function defaults() {
        const out = {};
        SCHEMA.forEach(g => g.fields.forEach(f => { out[f.key] = f.val; }));
        return out;
    }

    /** Merge a partial object over the defaults, clamping and ignoring junk. */
    function normalise(input) {
        const out = defaults();
        if (!input) return out;
        for (const [k, v] of Object.entries(input)) {
            const f = FIELD[k];
            if (!f) continue;
            if (f.type === 'color') {
                out[k] = (typeof v === 'string') ? parseInt(v.replace('#', ''), 16) : v;
            } else if (f.type === 'bool') {
                out[k] = !!v;
            } else if (typeof v === 'number' && isFinite(v)) {
                out[k] = (f.min !== undefined && f.max !== undefined)
                    ? Math.min(f.max, Math.max(f.min, v))
                    : v;
            }
        }
        return out;
    }

    function toJSON(s) {
        const out = { majestyLogoLight: 1 };
        SCHEMA.forEach(g => g.fields.forEach(f => {
            const v = s[f.key];
            out[f.key] = (f.type === 'color' && typeof v === 'number')
                ? '#' + ('000000' + (v >>> 0).toString(16)).slice(-6)
                : v;
        }));
        return JSON.stringify(out, null, 2);
    }

    // -------------------------------------------------------------------------
    //  Shader
    //
    //  Spliced in at <lights_fragment_end>, which is after the scene's own lights
    //  have accumulated into reflectedLight and while `geometry` and `material`
    //  are still in scope. Everything is view space at that point, so the light's
    //  world position is converted with viewMatrix rather than being pushed in
    //  pre-transformed from JS every frame.
    //
    //  r128 names, verified against the installed copy rather than assumed:
    //  BRDF_Diffuse_Lambert / BRDF_Specular_GGX, and PhysicalMaterial carries
    //  specularRoughness (not `roughness`).
    // -------------------------------------------------------------------------
    const DECLS = `
uniform vec3  uLogoLightPos;
uniform vec3  uLogoLightTarget;
uniform vec3  uLogoLightColor;
uniform float uLogoLightIntensity;
uniform float uLogoLightCosOuter;
uniform float uLogoLightCosInner;
uniform float uLogoLightDistance;
uniform float uLogoLightDecay;
`;

    const BODY = `
{
    vec3  lightPosView = ( viewMatrix * vec4( uLogoLightPos, 1.0 ) ).xyz;
    vec3  toLight      = lightPosView - geometry.position;
    float lightDist    = length( toLight );

    if ( lightDist > 0.0001 && uLogoLightIntensity > 0.0 ) {
        vec3 L = toLight / lightDist;

        // Cone. Compare the direction light->fragment against the spot axis.
        vec3  targetView = ( viewMatrix * vec4( uLogoLightTarget, 1.0 ) ).xyz;
        vec3  spotAxis   = normalize( targetView - lightPosView );
        float cosAngle   = dot( -L, spotAxis );
        float spotAtt    = smoothstep( uLogoLightCosOuter, uLogoLightCosInner, cosAngle );

        // Distance falloff, matching three's punctual light behaviour.
        float distAtt = 1.0;
        if ( uLogoLightDistance > 0.0 ) {
            distAtt = pow( saturate( 1.0 - lightDist / uLogoLightDistance ), uLogoLightDecay );
        }

        float NdotL = saturate( dot( geometry.normal, L ) );
        vec3 irradiance = uLogoLightColor * uLogoLightIntensity * spotAtt * distAtt * NdotL;

        if ( spotAtt > 0.0 && NdotL > 0.0 ) {
            IncidentLight logoLight;
            logoLight.color     = irradiance;
            logoLight.direction = L;
            logoLight.visible   = true;

            reflectedLight.directDiffuse  += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
            reflectedLight.directSpecular += BRDF_Specular_GGX(
                logoLight, geometry.viewDir, geometry.normal,
                material.specularColor, material.specularRoughness );
        }
    }
}
`;

    /**
     * Attach the light to a mesh's material.
     *
     * Returns a handle with update(settings). Safe to call on a mesh whose
     * material is later swapped — call attach() again on the new material.
     */
    function attach(THREE, mesh, settings) {
        if (!mesh || !mesh.material) return null;
        const S = normalise(settings);
        const mat = mesh.material;

        const uniforms = {
            uLogoLightPos: { value: new THREE.Vector3(S.posX, S.posY, S.posZ) },
            uLogoLightTarget: { value: new THREE.Vector3(S.targetX, S.targetY, S.targetZ) },
            uLogoLightColor: { value: new THREE.Color(S.color) },
            uLogoLightIntensity: { value: S.enabled ? S.intensity : 0 },
            uLogoLightCosOuter: { value: Math.cos(S.angle) },
            uLogoLightCosInner: { value: Math.cos(S.angle * (1.0 - S.penumbra)) },
            uLogoLightDistance: { value: S.distance },
            uLogoLightDecay: { value: S.decay }
        };

        mat.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.fragmentShader = shader.fragmentShader
                .replace('void main() {', DECLS + '\nvoid main() {')
                .replace('#include <lights_fragment_end>',
                    '#include <lights_fragment_end>\n' + BODY);
        };
        // Distinct key, or this material shares a compiled program with every
        // other MeshStandardMaterial and the injection is silently skipped.
        mat.customProgramCacheKey = () => 'majesty-logo-light';
        mat.needsUpdate = true;

        return {
            uniforms: uniforms,
            settings: S,
            update: function (next) {
                const n = normalise(next);
                Object.assign(this.settings, n);
                uniforms.uLogoLightPos.value.set(n.posX, n.posY, n.posZ);
                uniforms.uLogoLightTarget.value.set(n.targetX, n.targetY, n.targetZ);
                uniforms.uLogoLightColor.value.set(n.color);
                uniforms.uLogoLightIntensity.value = n.enabled ? n.intensity : 0;
                uniforms.uLogoLightCosOuter.value = Math.cos(n.angle);
                uniforms.uLogoLightCosInner.value = Math.cos(n.angle * (1.0 - n.penumbra));
                uniforms.uLogoLightDistance.value = n.distance;
                uniforms.uLogoLightDecay.value = n.decay;
            }
        };
    }

    // Paste the studio's "Copy logo light JSON" output here; null uses defaults.
    const PRESET = null;

    global.MajestyLogoLight = {
        version: 1,
        SCHEMA: SCHEMA,
        FIELD: FIELD,
        MESH_NAME: 'Logo',
        defaults: defaults,
        normalise: normalise,
        toJSON: toJSON,
        attach: attach,
        PRESET: PRESET,
        current: function () { return normalise(PRESET); }
    };
})(window);
