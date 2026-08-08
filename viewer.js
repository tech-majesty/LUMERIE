/* =============================================================================
 *  Majesty — shared 3D viewer
 *
 *  Split out of script.js so the landing page can mount the same lamp rig in its
 *  hero without also pulling in the configurator's UI, cart and pattern editor.
 *  Both pages load this file first; ThreeViewer and the catalogue constants below
 *  land in the shared global lexical scope, so script.js sees them unchanged.
 *
 *  Nothing in here was rewritten during the split — only moved.
 * ========================================================================== */

// Configuration state
const config = {
    base: 'Red',
    rim: 'Golden Ring',
    pattern: 'Triangle'
};

// Configuration names mapping
const configNames = {
    'Red': 'Red',
    'Red Metallic': 'Red Metallic',
    'Black': 'Black',
    'White': 'White',
    'Gold': 'Gold',
    'Silver': 'Silver',
    'Copper': 'Copper',
    'Golden Ring': 'Golden Ring',
    'Silver Ring': 'Silver Ring',
    'Copper Ring': 'Copper Ring',
    'Triangle': 'Triangle',
    'Star': 'Star',
    'Arabic': 'Arabic'
};

/**
 * Display label for a config value.
 *
 * configNames only lists the three baked patterns, so a coded pattern used to
 * come out as "undefined" in the cart and the summary. The map is an identity
 * map anyway, so falling back to the value itself is both the fix and future
 * proof: a new recipe needs no entry here.
 */
function displayName(value) {
    return configNames[value] || value;
}

// Configuration options for preloading
const bases = ['Red', 'Red Metallic', 'Black', 'White', 'Gold', 'Silver', 'Copper'];
const rims = ['Golden Ring', 'Silver Ring', 'Copper Ring'];
const patterns = ['Triangle', 'Star', 'Arabic'];

// Hoisted out of the render loop, which re-allocated it every frame.
const PATTERN_MESH_NAMES = ['Triangle_Pattern', 'Star_Pattern', 'Arabic_Pattern'];

// ---------------------------------------------------------------------------
//  Coded (procedural) patterns.
//
//  A pattern added to pattern-engine.js is computed in a shader on the existing
//  sleeve mesh. That means a new pattern is a recipe object and nothing else:
//  no texture bake, no GLB re-export, no upload. The *_Pattern meshes in the GLB
//  are all the same geometry, so one of them carries whichever coded pattern is
//  selected.
// ---------------------------------------------------------------------------
const CODED_CARRIER_MESH = 'Triangle_Pattern';

function getCodedRecipe(name) {
    const MP = window.MajestyPatterns;
    if (!MP || !MP.RECIPES) return null;
    // A name shipped as a baked texture in the GLB keeps using that texture;
    // only names that are NOT baked fall through to the shader.
    if (['Triangle', 'Star', 'Arabic'].indexOf(name) !== -1) return null;
    return MP.RECIPES[name] || null;
}

/** Pattern names available in the UI: the baked ones plus every coded recipe. */
function allPatternNames() {
    const MP = window.MajestyPatterns;
    const coded = MP && MP.RECIPES ? Object.keys(MP.RECIPES) : [];
    return patterns.concat(coded.filter(n => patterns.indexOf(n) === -1));
}

// The viewer is the only view now, so nothing has to cope with a 2D/3D swap —
// this just records when the model has landed, for the cart thumbnail.
let viewerReady = false;

// Cart state
let cart = [];

// Three.js Viewer State
let threeViewer = null;

// Three.js Viewer Class
class ThreeViewer {
    constructor(options = {}) {
        this.options = options; // Store options (callbacks)
        this.container = document.getElementById('threeCanvasContainer');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(10, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.model = null;
        this.loader = new THREE.GLTFLoader();
        this.materialSettings = {
            global: {
                exposure: 1,
                mainLightIntensity: 0.1,
                rimLightIntensity: 2,
                ambientIntensity: 0,
                bloomStrength: 0.5,
                bloomRadius: 1,
                bloomStrength: 0.5,
                bloomRadius: 1,
                bloomThreshold: 0.5,
                logoLightIntensity: 5,
                logoLightX: 0,
                logoLightY: 1.6, // Approximate height of the top logo
                logoLightZ: 0.7, // Close to the front
                logoLightDistance: 2,
                logoLightDecay: 1,
                logoLightAngle: 0.6,
                logoLightPenumbra: 0.5,
                logoLightTargetX: 0,
                logoLightTargetY: 0,
                logoLightTargetZ: 0,
            },
            bases: {
                "Red": { "metalness": 0, "roughness": 0.1, "envMapIntensity": 0.5, "color": 5114121 },
                "Red Metallic": { "metalness": 1, "roughness": 0.3, "envMapIntensity": 1, "color": 5114121 },
                "Black": { "metalness": 0, "roughness": 0.1, "envMapIntensity": 0.2, "color": 0 },
                "White": { "metalness": 0, "roughness": 0.1, "envMapIntensity": 1, "color": 11250603 },
                "Gold": { "metalness": 1, "roughness": 0.3, "envMapIntensity": 0.5, "color": 16757575 },
                "Silver": { "metalness": 1, "roughness": 0.2, "envMapIntensity": 0.8, "color": 16777215 },
                "Copper": { "metalness": 1, "roughness": 0.25, "envMapIntensity": 0.8, "color": 16759700 }
            },
            rings: {
                "Golden Ring": { "metalness": 1, "roughness": 0.25, "envMapIntensity": 0.8, "color": 16757575 },
                "Silver Ring": { "metalness": 1, "roughness": 0.2, "envMapIntensity": 0.8, "color": 16777215 },
                "Copper Ring": { "metalness": 1, "roughness": 0.2, "envMapIntensity": 1, "color": 16759700 }
            },
            patterns: {
                "Triangle": { "emissive": 16753920, "emissiveIntensity": 10 },
                "Star": { "emissive": 16753920, "emissiveIntensity": 10 },
                "Arabic": { "emissive": 16753920, "emissiveIntensity": 10 }
            },
            floor: {
                color: 0x1a1a1a,
                metalness: 0.6,
                roughness: 0.2,
                envMapIntensity: 0.8,
                positionY: -0.4, // Initial guess, will be updated by alignment
                scale: 1.5
            },
            // The stage's own settings live in stage.js, which the pattern
            // studio also loads, so there is one place to tune them.
        };

        this.cameraAngles = {
            front: { pos: { x: 0, y: 0, z: 3 }, lookAt: { x: 0, y: 0, z: 0 } },
            left: { pos: { x: -1.8, y: 0.5, z: 3 }, lookAt: { x: 0, y: 0, z: 0 } },
            right: { pos: { x: 1.8, y: 0.5, z: 3 }, lookAt: { x: 0, y: 0, z: 0 } }
        };

        this.init();
    }

    init() {
        // Renderer setup
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // Camera position
        this.camera.position.set(0, 0, 2.5);

        // Environment Map (HDRI)
        this.setupEnvironment();

        // Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, this.materialSettings.global.ambientIntensity);
        this.scene.add(this.ambientLight);

        this.mainLight = new THREE.DirectionalLight(0xffffff, this.materialSettings.global.mainLightIntensity);
        this.mainLight.position.set(5, 5, 5);
        this.scene.add(this.mainLight);

        this.rimLight = new THREE.PointLight(0xffffff, this.materialSettings.global.rimLightIntensity);
        this.rimLight.position.set(-5, 3, -5);
        this.rimLight.position.set(-5, 3, -5);
        this.scene.add(this.rimLight);

        // Targeted Logo Light (SpotLight)
        // Layer 1 is reserved for Logo isolation
        this.camera.layers.enable(1); // Camera sees both Layer 0 (default) and Layer 1

        this.logoLight = new THREE.SpotLight(0xffffff, this.materialSettings.global.logoLightIntensity);
        this.logoLight.distance = this.materialSettings.global.logoLightDistance;
        this.logoLight.decay = this.materialSettings.global.logoLightDecay;
        this.logoLight.angle = this.materialSettings.global.logoLightAngle;
        this.logoLight.penumbra = this.materialSettings.global.logoLightPenumbra;

        this.logoLight.position.set(
            this.materialSettings.global.logoLightX,
            this.materialSettings.global.logoLightY,
            this.materialSettings.global.logoLightZ
        );

        // Setup Target
        this.logoLight.target.position.set(
            this.materialSettings.global.logoLightTargetX,
            this.materialSettings.global.logoLightTargetY,
            this.materialSettings.global.logoLightTargetZ
        );

        this.logoLight.layers.set(1); // Only affect objects on Layer 1
        this.logoLight.target.layers.set(1); // Target also on Layer 1 (though not strictly rendered)

        this.scene.add(this.logoLight);
        this.scene.add(this.logoLight.target);

        // Post-Processing (Selective Bloom)
        this.renderScene = new THREE.RenderPass(this.scene, this.camera);

        // 1. Bloom Composer
        this.bloomComposer = new THREE.EffectComposer(this.renderer);
        this.bloomComposer.renderToScreen = false;
        this.bloomComposer.addPass(this.renderScene);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
            this.materialSettings.global.bloomStrength,
            this.materialSettings.global.bloomRadius,
            this.materialSettings.global.bloomThreshold
        );
        this.bloomComposer.addPass(this.bloomPass);

        // 2. Final Composer
        this.finalComposer = new THREE.EffectComposer(this.renderer);
        this.finalComposer.addPass(this.renderScene);

        // Mix Pass (Base + Bloom)
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `;
        const fragmentShader = `
            uniform sampler2D baseTexture;
            uniform sampler2D bloomTexture;
            varying vec2 vUv;
            void main() {
                gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
            }
        `;

        this.mixPass = new THREE.ShaderPass(
            new THREE.ShaderMaterial({
                uniforms: {
                    baseTexture: { value: null },
                    bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                defines: {}
            }), "baseTexture"
        );
        this.mixPass.needsSwap = true;
        this.finalComposer.addPass(this.mixPass);

        // Anti-Aliasing (FXAA) on the final result
        const pixelRatio = this.renderer.getPixelRatio();
        this.fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        this.fxaaPass.material.uniforms['resolution'].value.x = 1 / (this.container.clientWidth * pixelRatio);
        this.fxaaPass.material.uniforms['resolution'].value.y = 1 / (this.container.clientHeight * pixelRatio);
        this.finalComposer.addPass(this.fxaaPass);

        // Handle High DPI
        this.bloomComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);
        this.finalComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);

        // Materials for selective bloom
        this.darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
        this.materials = {};

        // Load Model
        this.loadModel();

        // Handle Resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Animation Loop
        this.animate();

        // Setup Debug GUI
        // this.setupDebugGUI();
    }

    setupEnvironment() {
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        // Using the user's local high-fidelity HDR environment map
        new THREE.RGBELoader().load('env_texture/studio_small_08_1k.hdr', (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            this.scene.environment = envMap;
            // this.scene.background = envMap; // Uncomment if background needed

            texture.dispose();
            pmremGenerator.dispose();

            if (this.model) this.updateMaterials();
            console.log('Environment Map (HDR) loaded successfully');
        }, undefined, (error) => {
            console.error('Error loading HDR environment map:', error);
            // Fallback to simple studio JPG if HDR fails
            new THREE.TextureLoader().load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/22_3_13_4_50_48_680_1656.jpg', (texture) => {
                const envMap = pmremGenerator.fromEquirectangular(texture).texture;
                this.scene.environment = envMap;
                if (this.model) this.updateMaterials();
            });
        });

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.materialSettings.global.exposure;
    }



    setCameraAngle(angleName) {
        const angle = this.cameraAngles[angleName];
        if (!angle) return;

        gsap.to(this.camera.position, {
            x: angle.pos.x,
            y: angle.pos.y,
            z: angle.pos.z,
            duration: 1.5,
            ease: "power2.inOut",
            onUpdate: () => {
                this.camera.lookAt(angle.lookAt.x, angle.lookAt.y, angle.lookAt.z);
            }
        });

        // Update UI
        document.querySelectorAll('.camera-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.angle === angleName);
        });
    }

    loadModel() {
        const onProgress = (xhr) => {
            if (xhr.lengthComputable) {
                const percentComplete = (xhr.loaded / xhr.total) * 100;
                if (this.options.onProgress) this.options.onProgress(percentComplete);
            }
        };

        // The model is committed to the repo, so it is served same-origin from the
        // same CDN as the rest of the site — no dependency on the R2 bucket staying
        // public, and it is cached alongside everything else. R2 stays as a fallback.
        const MODEL_REPO = '3D Model/MajestyGLB.glb';
        const MODEL_R2 = 'https://pub-0fa84320243249fca31ce0de4238c3e8.r2.dev/MajestyGLB.glb';
        this._modelTriedFallback = false;

        const onModelLoaded = (gltf) => {
            this.model = gltf.scene;
            this.scene.add(this.model);

            // Collect all materials from the model for easy access
            this.allMaterials = {};
            this.collectMaterials(gltf.scene);

            // Try to get all materials from the parser
            if (gltf.parser && gltf.parser.getDependencies) {
                gltf.parser.getDependencies('material').then(materials => {
                    materials.forEach(m => {
                        this.allMaterials[m.name] = m;
                    });
                    this.updateMaterials();
                });
            }

            // Center and scale model if needed
            const box = new THREE.Box3().setFromObject(this.model);
            const center = box.getCenter(new THREE.Vector3());

            this.model.position.x += (this.model.position.x - center.x);
            this.model.position.y += (this.model.position.y - center.y);
            this.model.position.z += (this.model.position.z - center.z);

            this.updateMaterials();
            this.setCameraAngle('front');
            console.log('Main Lamp loaded successfully');

            // Dynamic Floor Alignment
            const finalBox = new THREE.Box3().setFromObject(this.model);
            const floorY = finalBox.min.y;
            this.materialSettings.floor.positionY = floorY;

            this.buildStage(finalBox);
            if (this.options.onLoad) this.options.onLoad();

        };

        const onModelError = (error) => {
            // Fall back to R2 once if the repo copy is unavailable.
            if (!this._modelTriedFallback) {
                this._modelTriedFallback = true;
                console.warn('Repo model unavailable, falling back to R2:', error);
                this.loader.load(MODEL_R2, onModelLoaded, onProgress, (e2) => {
                    console.error('Error loading 3D model:', e2);
                    if (this.options.onLoad) this.options.onLoad();
                });
                return;
            }
            console.error('Error loading 3D model:', error);
            if (this.options.onLoad) this.options.onLoad();
        };

        this.loader.load(MODEL_REPO, onModelLoaded, onProgress, onModelError);
    }

    collectMaterials(object) {
        object.traverse((node) => {
            if (node.isMesh && node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => this.allMaterials[m.name] = m);
                } else {
                    this.allMaterials[node.material.name] = node.material;
                }
            }
        });
    }

    updateMaterials() {
        if (!this.model) return;

        // Material Name Mapping based on GLB file
        const rimMaterialMap = {
            'Golden Ring': 'Gold Cap',
            'Silver Ring': 'Silver Cap',
            'Copper Ring': 'Cooper Cap' // Spelling from GLB
        };

        const screenMaterialMap = {
            'Golden Ring': 'Screen Gold',
            'Silver Ring': 'Screen Silver',
            'Copper Ring': 'Screen Copper'
        };

        const patternMeshMap = {
            'Triangle': 'Triangle_Pattern',
            'Star': 'Star_Pattern',
            'Arabic': 'Arabic_Pattern'
        };
        const patternMeshNames = ['Triangle_Pattern', 'Star_Pattern', 'Arabic_Pattern'];

        // Screen helper meshes to always hide
        const screenHelperMeshes = ['Screen_Copper', 'Screen_Silver'];

        this.model.traverse((node) => {
            if (node.isMesh) {
                // Hide screen helper meshes
                if (screenHelperMeshes.includes(node.name)) {
                    node.visible = false;
                    return;
                }

                // Pattern meshes - show only the selected one and apply emissive
                if (patternMeshNames.includes(node.name)) {
                    // CODED PATTERNS: a pattern defined in pattern-engine.js is
                    // drawn by a shader on the sleeve, so it needs no baked
                    // texture and no mesh of its own. All the *_Pattern meshes
                    // are the same sleeve geometry, so any of them can carry it —
                    // we use the first one and hide the rest.
                    const coded = getCodedRecipe(config.pattern);
                    if (coded) {
                        const isCarrier = node.name === CODED_CARRIER_MESH;
                        node.visible = isCarrier;
                        if (isCarrier) this.applyCodedPattern(node, coded);
                        return;
                    }

                    // A coded pattern borrows the carrier mesh and swaps its
                    // material. Put the mesh's own baked material back before
                    // showing a shipped pattern, or Triangle would render with
                    // the last coded pattern's mask instead of its texture.
                    this.restorePatternMaterial(node);

                    const selectedPatternMesh = patternMeshMap[config.pattern];
                    node.visible = (node.name === selectedPatternMesh);

                    if (node.visible) {
                        const settings = this.materialSettings.patterns[config.pattern];
                        // Ensure material is Standard to support emissive if not already
                        if (!(node.material instanceof THREE.MeshStandardMaterial)) {
                            node.material = new THREE.MeshStandardMaterial({
                                map: node.material.map,
                                transparent: true,
                                opacity: 1
                            });
                        }
                        node.material.emissive.setHex(settings.emissive);
                        node.material.emissiveIntensity = settings.emissiveIntensity;
                        node.material.color.setHex(0xffffff); // Ensure base color doesn't interfere too much
                    }
                    return;
                }

                // Hide main Patterns mesh (using individual pattern meshes instead)
                if (node.name === 'Patterns') {
                    node.visible = false;
                    return;
                }

                // 1. Base Mesh
                if (node.name === 'Base') {
                    this.applyMaterialByName(node, config.base, 'base');
                }

                // 2. Rim/Ring Finishes
                if (['Rim', 'Ring', 'BaseRim', 'BaseRim_1', 'Logo'].includes(node.name)) {
                    // Decide which ring finish to use
                    this.applyMaterialByName(node, config.rim, 'rim');
                }

                // 3. Screen (main screen mesh)
                if (node.name === 'Screen_Main_(Gold)') {
                    // Use rim finish logic for screen metal parts usually, or specific screen settings if we had them.
                    // For now, let's map it to the Rim material settings as per previous logic
                    // But wait, the previous logic used specific screen materials.
                    // Let's stick to the mapped material name but apply the Ring settings to it?
                    // Or just use the Ring settings directly since it matches the finish.
                    this.applyMaterialByName(node, config.rim, 'rim');
                }
            }
        });
    }

    /**
     * Put a coded pattern on the sleeve. The shader is built once per pattern and
     * cached; switching patterns afterwards is just a material swap, and tweaking
     * a recipe only writes uniforms.
     */
    /** Restore a pattern mesh's own baked material, if a coded pattern borrowed it. */
    restorePatternMaterial(mesh) {
        const saved = this._bakedPatternMats && this._bakedPatternMats[mesh.name];
        if (saved && mesh.material !== saved) mesh.material = saved;
    }

    applyCodedPattern(mesh, recipe) {
        const MP = window.MajestyPatterns;
        if (!MP) return;

        // Remember the mesh's shipped material the first time we borrow it, so
        // selecting a baked pattern later can put it back untouched.
        this._bakedPatternMats = this._bakedPatternMats || {};
        const isOurs = this._codedMaterials &&
            Object.keys(this._codedMaterials).some(k => this._codedMaterials[k] === mesh.material);
        if (!this._bakedPatternMats[mesh.name] && !isOurs) {
            this._bakedPatternMats[mesh.name] = mesh.material;
        }

        // The tilt-aware height needs the sleeve's measured top/bottom edges.
        // Measured once per geometry, then reused.
        if (!this._edgeProfile) {
            try {
                this._edgeProfile = MP.computeEdgeProfile(mesh.geometry);
            } catch (e) {
                console.warn('Edge profile failed, patterns will use flat bands:', e);
                this._edgeProfile = null;
            }
        }
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;

        // Glow must be IDENTICAL to the shipped patterns, so the emissive colour
        // and intensity come from this viewer's own materialSettings.patterns —
        // the exact table Triangle / Star / Arabic read — not from the recipe.
        // The recipe's own emission block is only used for the studio preview.
        const glow = this.materialSettings.patterns[config.pattern]
            || this.materialSettings.patterns['Triangle']
            || { emissive: 16753920, emissiveIntensity: 10 };

        this._codedMaterials = this._codedMaterials || {};
        const key = recipe.name + '|' + recipe.generator;
        if (!this._codedMaterials[key]) {
            this._codedMaterials[key] = MP.makeSiteMaterial(THREE, recipe, this._edgeProfile, {
                yMin: bb.min.y, yMax: bb.max.y,
                emissive: glow.emissive,
                emissiveIntensity: glow.emissiveIntensity,
                roughness: 0.5,
                metalness: 0
            });
        }
        const mat = this._codedMaterials[key];
        // keep it in step if the settings are tweaked at runtime (debug GUI)
        mat.emissive.setHex(glow.emissive);
        mat.emissiveIntensity = glow.emissiveIntensity;
        mesh.material = mat;
    }

    applyMaterialByName(mesh, configValue, type) {
        let settings;
        if (type === 'base') {
            settings = this.materialSettings.bases[configValue];
        } else if (type === 'rim') {
            settings = this.materialSettings.rings[configValue];
        }

        if (!settings) return;

        // Apply to existing material if possible, or create new if needed fallback
        if (!mesh.material) {
            mesh.material = new THREE.MeshStandardMaterial();
        }

        mesh.material.metalness = settings.metalness;
        mesh.material.roughness = settings.roughness;
        mesh.material.envMapIntensity = settings.envMapIntensity;
        mesh.material.color.setHex(settings.color);

        // LIGHT LINKING for the logo emboss.
        //
        // The layer assignment below is NOT what isolates the light — three's
        // renderer only ever tests layers against the CAMERA
        // (object.layers.test(camera.layers)), never light against object, so a
        // layer-restricted THREE.SpotLight lights the whole scene. Measured: the
        // logo gained 69 and the body beside it gained 93.
        //
        // The isolation comes from logo-light.js, which computes the spot inside
        // this material. Layers are still set because the camera enables layer 1
        // and other code assumes the convention.
        if (mesh.name === 'Logo') {
            mesh.layers.enable(1);

            // Attach once. applyPBR runs on every material update, and
            // reassigning onBeforeCompile each time would force a shader
            // recompile on every colour change.
            if (window.MajestyLogoLight && this._logoLightMaterial !== mesh.material) {
                this._logoLight = window.MajestyLogoLight.attach(
                    THREE, mesh, window.MajestyLogoLight.current());
                this._logoLightMaterial = mesh.material;
            }
        } else {
            mesh.layers.disable(1);
        }

        mesh.material.needsUpdate = true;
    }

    applyMetalMaterialFallback(mesh) {
        // Deprecated by granular system
    }

    applyBaseColorFallback(mesh) {
        const colorMap = {
            'Red': 0xdc2626,
            'Red Metallic': 0x991b1b,
            'Black': 0x1a1a1a,
            'White': 0xffffff,
            'Gold': 0xd4a574,
            'Silver': 0xcccccc,
            'Copper': 0xb87333
        };
        const color = colorMap[config.base] || 0xffffff;

        if (mesh.material) {
            mesh.material.color.setHex(color);
            mesh.material.metalness = (config.base.includes('Metallic') || config.base === 'Gold' || config.base === 'Silver' || config.base === 'Copper') ? this.debugSettings.baseMetalness : 0.1;
            mesh.material.roughness = (config.base.includes('Metallic') || config.base === 'Gold' || config.base === 'Silver' || config.base === 'Copper') ? this.debugSettings.baseRoughness : 0.8;
            mesh.material.envMapIntensity = 1.0;
        }
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        if (this.bloomComposer) {
            const pixelRatio = this.renderer.getPixelRatio();
            this.bloomComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);
            this.finalComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);

            if (this.fxaaPass) {
                this.fxaaPass.material.uniforms['resolution'].value.x = 1 / (this.container.clientWidth * pixelRatio);
                this.fxaaPass.material.uniforms['resolution'].value.y = 1 / (this.container.clientHeight * pixelRatio);
            }
        }
    }

    darkenNonBloomed(obj) {
        if (obj.isMesh && this.bloomLayer.test(obj.layers) === false) {
            this.materials[obj.uuid] = obj.material;
            obj.material = this.darkMaterial;
        }
    }

    restoreMaterial(obj) {
        if (this.materials[obj.uuid]) {
            obj.material = this.materials[obj.uuid];
            delete this.materials[obj.uuid];
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // PERF: this loop is expensive — two full composer passes plus a
        // whole-scene material swap, every frame. The viewer is always on screen
        // now, so the only thing worth skipping is a backgrounded tab.
        if (document.hidden) return;

        this.renderFrame();
    }

    /**
     * One frame of the selective-bloom pipeline. Split out of animate() so the
     * cart thumbnail can force a fresh frame and grab it synchronously — the
     * renderer has no preserveDrawingBuffer, so toDataURL() only returns pixels
     * if it runs in the same task as the render that produced them.
     */
    renderFrame() {
        if (this.bloomComposer && this.finalComposer) {
            // Keep the stage out of the bloom pass entirely. Darkening its
            // material would be enough to stop it blooming, but hiding it also
            // skips the Reflector's render-target pass, which would otherwise run
            // twice per frame for a reflection the bloom pass never uses.
            if (this.stage) this.stage.setVisible(false);
            // 1. Darken non-bloomed objects
            // We need to identify bloomed objects.
            // Since we haven't strictly used layers yet (simpler to just check names/properties),
            // let's use the visible pattern check here.

            const patternMeshNames = PATTERN_MESH_NAMES;

            this.scene.traverse((obj) => {
                if (obj.isMesh) {
                    // If it's a visible pattern, it should bloom.
                    // Everything else should be dark.
                    const isPattern = patternMeshNames.includes(obj.name);
                    // Note: We only bloom the visible pattern.
                    // The currently visible pattern is already determined in updateMaterials logic.
                    // But we should check obj.visible && isPattern

                    if (isPattern && obj.visible) {
                        // Do nothing, let it bloom
                    } else {
                        this.materials[obj.uuid] = obj.material;
                        obj.material = this.darkMaterial;
                    }
                }
            });

            // 2. Render bloom
            this.bloomComposer.render();

            // 3. Restore materials
            this.scene.traverse((obj) => {
                if (this.materials[obj.uuid]) {
                    obj.material = this.materials[obj.uuid];
                    delete this.materials[obj.uuid];
                }
            });

            // 4. Render final scene, with the stage back in
            if (this.stage) { this.stage.setVisible(true); this.stage.blur(); }
            this.finalComposer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * A thumbnail of exactly what is on screen, for the cart.
     *
     * This replaces the pre-rendered still that used to be used: a still only
     * existed for the 3 baked patterns, so any of the 9 coded ones produced a
     * broken image. Capturing the canvas covers every combination, and it is the
     * real configuration rather than an approximation of it.
     *
     * Downscaled to THUMB_W so a cart of several items does not hold several
     * multi-megabyte data URLs in memory.
     */
    captureThumbnail(width) {
        const THUMB_W = width || 320;
        const src = this.renderer && this.renderer.domElement;
        if (!src || !src.width || !src.height) return null;

        // Force a frame so the drawing buffer holds current pixels, then read it
        // before the browser can clear it.
        this.renderFrame();

        const out = document.createElement('canvas');
        out.width = THUMB_W;
        out.height = Math.max(1, Math.round(THUMB_W * src.height / src.width));
        const ctx = out.getContext('2d');
        ctx.drawImage(src, 0, 0, out.width, out.height);
        try {
            return out.toDataURL('image/webp', 0.85);
        } catch (e) {
            return out.toDataURL('image/png');
        }
    }

    /**
     * The studio stage: a lit backdrop and a glossy floor, matching the Blender
     * reference — warm halo behind the lamp falling off to near black, and a
     * reflection on the floor that is soft rather than mirror-sharp.
     *
     * Both are sized from the model's own bounding box and the camera frustum,
     * so nothing here is a magic number tied to this particular lamp.
     *
     * Colour space note: like three's own Reflector shader, both materials write
     * gl_FragColor directly and so sit OUTSIDE tonemapping. That is deliberate —
     * the reflection texture is already tonemapped and sRGB-encoded by the pass
     * that produced it, and the backdrop is a designed gradient rather than a lit
     * surface, so ACES would only crush the falloff we are trying to match.
     */
    /**
     * The studio stage — backdrop dome and glossy floor.
     *
     * Lives in stage.js because the pattern studio tunes it: one implementation
     * for both pages, so a preset pasted into stage.js changes them together
     * rather than needing the same edit applied twice.
     */
    buildStage(box) {
        if (!window.MajestyStage) {
            console.warn('stage.js not loaded — no backdrop or floor');
            return;
        }
        // The camera only ever sits at one of the presets, so the dome has to
        // enclose the furthest of them.
        const camDist = Math.max(...Object.values(this.cameraAngles).map(a =>
            Math.hypot(a.pos.x, a.pos.y, a.pos.z)));

        this.stage = window.MajestyStage.create({
            THREE: THREE,
            scene: this.scene,
            renderer: this.renderer,
            camera: this.camera,
            box: box,
            camDist: camDist,
            settings: window.MajestyStage.current()
        });

        // Kept as aliases: the bloom pass and the floor helpers refer to these.
        this.backdrop = this.stage.dome;
        this.floor = this.stage.floor;

        this.installReflectionDimmer();

        console.log(`Stage built — floor y=${box.min.y.toFixed(4)} r=${this.stage.radius.toFixed(2)}, ` +
            `dome r=${this.stage.domeRadius.toFixed(2)}, reflection ${this.stage.resolution}px`);
    }

    /**
     * Dim the LAMP's reflection in the floor without touching anything else.
     *
     * WHY THIS AND NOT A FLOOR SETTING
     *
     * The floor's reflection texture holds the dome, the halo and the lamp in
     * one image, so every control in stage.js — reflectStrength, floorColor,
     * fresnelGain — moves all three together. Turning the reflection down to
     * calm the lamp also flattens the halo and brings back the dark seam where
     * the floor meets the dome, which is exactly what the tuned preset exists
     * to avoid.
     *
     * So the dimming happens a level earlier. The Reflector re-renders the
     * scene from the mirrored camera inside its own onBeforeRender; wrapping
     * that lets the model be darkened for the duration of that pass and put
     * back immediately after. The dome and the halo are rendered at full
     * strength in the same pass, the floor shader is untouched, and no value
     * in the stage preset changes.
     *
     * Factor of 1 is a no-op, so the pattern studio is unaffected.
     */
    installReflectionDimmer() {
        const reflector = this.stage && this.stage.floor;
        if (!reflector || typeof reflector.onBeforeRender !== 'function') return;
        if (reflector.__majestyDimmed) return;
        reflector.__majestyDimmed = true;

        this.reflectionDim = 1;
        const viewer = this;
        const original = reflector.onBeforeRender;
        const saved = [];

        reflector.onBeforeRender = function (renderer, scene, camera) {
            const f = viewer.reflectionDim;
            const dim = viewer.model && f < 0.999;

            if (dim) {
                saved.length = 0;
                viewer.model.traverse(function (n) {
                    if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
                    const m = n.material;
                    saved.push([m, m.color && m.color.clone(), m.emissiveIntensity]);
                    if (m.color) m.color.multiplyScalar(f);
                    if (m.emissiveIntensity !== undefined) m.emissiveIntensity *= f;
                });
            }

            original.call(this, renderer, scene, camera);

            for (let i = 0; i < saved.length; i++) {
                const m = saved[i][0];
                if (saved[i][1]) m.color.copy(saved[i][1]);
                m.emissiveIntensity = saved[i][2];
            }
            saved.length = 0;
        };
    }

    /** 1 leaves the reflection alone; lower values darken the lamp's mirror image. */
    setReflectionDim(factor) {
        this.reflectionDim = Math.max(0, Math.min(1, factor));
    }

    updateFloorMaterial() {
        if (this.stage) this.stage.update(this.stage.settings);
    }


    setupDebugGUI() {
        if (!window.lil) return;
        const gui = new lil.GUI();
        const floorFolder = gui.addFolder('Floor Config');
        const settings = this.materialSettings.floor;

        floorFolder.add(settings, 'positionY', -2, 2, 0.001).name('Position Y').onChange(() => this.updateFloorMaterial());
        floorFolder.add(settings, 'scale', 0.1, 10, 0.01).name('Scale').onChange(() => this.updateFloorMaterial());
        floorFolder.addColor(settings, 'color').name('Reflection Color').onChange(() => this.updateFloorMaterial());

        // These properties are stored for logging even if Reflector doesn't use them directly
        floorFolder.add(settings, 'metalness', 0, 1, 0.01).name('Metalness');
        floorFolder.add(settings, 'roughness', 0, 1, 0.01).name('Roughness');

        floorFolder.open();

        // Add Global folder for general tweaks
        const globalFolder = gui.addFolder('Global Lights');
        const global = this.materialSettings.global;
        globalFolder.add(global, 'ambientIntensity', 0, 5, 0.01).name('Ambient').onChange(() => {
            this.ambientLight.intensity = global.ambientIntensity;
        });
        globalFolder.add(global, 'mainLightIntensity', 0, 5, 0.01).name('Main Light').onChange(() => {
            this.mainLight.intensity = global.mainLightIntensity;
        });
        globalFolder.add(global, 'rimLightIntensity', 0, 10, 0.01).name('Rim Light').onChange(() => {
            this.rimLight.intensity = global.rimLightIntensity;
        });
        globalFolder.add(global, 'exposure', 0, 3, 0.01).name('Exposure').onChange(() => {
            this.renderer.toneMappingExposure = global.exposure;
        });

        const bloomFolder = gui.addFolder('Bloom');
        bloomFolder.add(this.bloomPass, 'strength', 0, 5, 0.01);
        bloomFolder.add(this.bloomPass, 'radius', 0, 3, 0.01);
        bloomFolder.add(this.bloomPass, 'threshold', 0, 1, 0.01);

        // Logging Utility
        gui.add({
            logSettings: () => {
                const exportData = {
                    materialSettings: this.materialSettings,
                    bloom: {
                        strength: this.bloomPass.strength,
                        radius: this.bloomPass.radius,
                        threshold: this.bloomPass.threshold
                    },
                    camera: {
                        position: this.camera.position,
                        rotation: this.camera.rotation
                    }
                };
                console.log("--- 3D VIEWER SETTINGS ---");
                console.log(JSON.stringify(exportData, null, 2));
                alert("Settings logged to console! (F12 to view)");
            }
        }, 'logSettings').name('LOG SETTINGS TO CONSOLE');

        gui.close();
    }
}
