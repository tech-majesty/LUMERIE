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

// Configuration options for preloading
const bases = ['Red', 'Red Metallic', 'Black', 'White', 'Gold', 'Silver', 'Copper'];
const rims = ['Golden Ring', 'Silver Ring', 'Copper Ring'];
const patterns = ['Triangle', 'Star', 'Arabic'];

// Cart state
let cart = [];

// Three.js Viewer State
let threeViewer = null;
let is3DMode = false;

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
            }
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

        this.loader.load('https://pub-0fa84320243249fca31ce0de4238c3e8.r2.dev/MajestyGLB.glb', (gltf) => {
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

            // Use a Circle Reflector for the floor to enable real-time reflections
            const floorSettings = this.materialSettings.floor;
            const reflectorGeometry = new THREE.CircleGeometry(5, 64);

            this.floor = new THREE.Reflector(reflectorGeometry, {
                clipBias: 0.003,
                textureWidth: window.innerWidth * window.devicePixelRatio,
                textureHeight: window.innerHeight * window.devicePixelRatio,
                color: floorSettings.color,
                recursion: 1
            });

            this.floor.rotateX(-Math.PI / 2);
            this.floor.position.y = floorSettings.positionY;
            this.scene.add(this.floor);

            console.log('Real-time Reflector Floor added at:', floorY);
            if (this.options.onLoad) this.options.onLoad();

        }, onProgress, (error) => {
            console.error('Error loading 3D model:', error);
            // Even on error, we should probably hide loader to allow site usage
            if (this.options.onLoad) this.options.onLoad();
        });
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

        // Special Handling for Logo: Enable Layer 1 so it receives the Targeted Logo Light
        if (mesh.name === 'Logo') {
            mesh.layers.enable(1); // It is now on Layer 0 AND Layer 1
        } else {
            // Ensure other meshes are NOT on Layer 1 (just in case they were reused)
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

        if (this.bloomComposer && this.finalComposer) {
            // 1. Darken non-bloomed objects
            // We need to identify bloomed objects. 
            // Since we haven't strictly used layers yet (simpler to just check names/properties),
            // let's use the visible pattern check here.

            const patternMeshNames = ['Triangle_Pattern', 'Star_Pattern', 'Arabic_Pattern'];

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

            // 4. Render final scene
            this.finalComposer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateFloorMaterial() {
        if (!this.floor) return;
        const settings = this.materialSettings.floor;
        this.floor.position.y = settings.positionY;
        this.floor.scale.set(settings.scale, settings.scale, settings.scale);

        // For Reflector, we update the color property
        if (this.floor.getRenderTarget) { // Check if it's a Reflector
            this.floor.getMaterial().color.setHex(settings.color);
        }
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

// Initialize the application
// Initialize the application
function init() {
    setupEventListeners();
    updateProduct();
    setupCartListeners();
    setupThemeListener();
    setup3DViewToggle();

    // Preloader & 3D Viewer Initialization
    const loaderBar = document.getElementById('loaderProgressBar');
    const loaderText = document.getElementById('loaderProgressText');
    const preloader = document.getElementById('preloader');

    // Smooth Loading Logic
    let targetProgress = 0;
    let currentProgress = 0;
    const loadSpeed = 0.8; // Percentage increment per frame (approx 2s for 0-100%)

    const updateLoader = () => {
        if (currentProgress < targetProgress) {
            currentProgress += loadSpeed;
            if (currentProgress > targetProgress) currentProgress = targetProgress;
        }

        // Update UI
        if (loaderBar) loaderBar.style.width = currentProgress + '%';
        if (loaderText) loaderText.textContent = Math.floor(currentProgress) + '%';

        if (currentProgress >= 100) {
            // Finished
            setTimeout(() => {
                if (preloader) preloader.classList.add('fade-out');
            }, 500);
        } else {
            requestAnimationFrame(updateLoader);
        }
    };

    // Start the animation loop
    requestAnimationFrame(updateLoader);

    // Initialize 3D Viewer immediately with callbacks
    threeViewer = new ThreeViewer({
        onProgress: (percent) => {
            // Update the target, but clamp to 99 until finish allows 100
            // (Actually GLTF loader tracking is good, we can trust it)
            targetProgress = Math.max(0, Math.min(100, percent));
        },
        onLoad: () => {
            // Ensure we reach 100% eventually
            targetProgress = 100;
        }
    });

    // Setup camera listeners now that viewer is created
    setupCameraAngleListeners();

    // Mouse Tooltip Logic
    const tooltip = document.getElementById('cursor-tooltip');
    let mouseX = 0, mouseY = 0, lastX = 0, lastY = 0, rotation = 0;

    document.addEventListener('mousemove', (e) => {
        if (!tooltip) return;

        mouseX = e.clientX;
        mouseY = e.clientY;

        // Calculate velocity (delta)
        const dx = mouseX - lastX;
        const dy = mouseY - lastY;

        // Target rotation based on horizontal speed
        const targetRotation = Math.max(-15, Math.min(15, dx * 0.5));
        rotation += (targetRotation - rotation) * 0.15;

        // --- Boundary Check ---
        const padding = 20;
        let left = mouseX + padding;
        let top = mouseY + padding;

        const tooltipWidth = tooltip.offsetWidth || 150;
        const tooltipHeight = tooltip.offsetHeight || 40;

        // Flip to left if hitting right edge
        if (left + tooltipWidth > window.innerWidth) {
            left = mouseX - tooltipWidth - padding;
        }
        // Flip to top if hitting bottom edge
        if (top + tooltipHeight > window.innerHeight) {
            top = mouseY - tooltipHeight - padding;
        }

        tooltip.style.transform = `translate(${left}px, ${top}px) rotate(${rotation}deg) scale(${tooltip.classList.contains('visible') ? 1 : 0.95})`;

        lastX = mouseX;
        lastY = mouseY;
    });

    const setupTooltipTriggers = () => {
        const interactiveElements = document.querySelectorAll('[title], [data-tooltip], .control-btn, .btn-primary, .btn-secondary, .theme-toggle-btn, .mobile-3d-btn');

        interactiveElements.forEach(el => {
            let content = el.getAttribute('title') || el.getAttribute('data-tooltip');

            // If it's a control button without a direct title, look at the mobile-label
            if (!content && el.classList.contains('control-btn')) {
                const label = el.parentElement.querySelector('.mobile-label');
                if (label) content = label.textContent;
            }

            if (!content) return;

            // Remove native title to prevent double tooltip
            if (el.hasAttribute('title')) {
                el.setAttribute('data-tooltip', content);
                el.removeAttribute('title');
            }

            el.addEventListener('mouseenter', () => {
                tooltip.textContent = content;
                tooltip.classList.add('visible');
            });

            el.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
        });
    };

    setupTooltipTriggers();

    // Start preloading images after a short delay
    setTimeout(preloadImages, 1000);
}



function setup3DViewToggle() {
    const toggleBtnDesktop = document.getElementById('view3DToggleDesktop');
    const toggleBtnMobile = document.getElementById('view3DToggleMobile');
    const image = document.getElementById('productImage');
    const container = document.getElementById('threeCanvasContainer');
    const cameraControls = document.getElementById('cameraControls');

    const toggle3D = () => {
        is3DMode = !is3DMode;

        // Toggle Buttons State
        [toggleBtnDesktop, toggleBtnMobile].forEach(btn => {
            if (btn) {
                if (is3DMode) {
                    btn.classList.add('active');
                    if (btn.querySelector('span')) btn.querySelector('span').textContent = '2D VIEW';
                } else {
                    btn.classList.remove('active');
                    if (btn.querySelector('span')) btn.querySelector('span').textContent = '3D VIEW';
                }
            }
        });


        if (is3DMode) {
            image.classList.add('hidden');
            container.classList.add('active');
            cameraControls.classList.add('active');
            // threeViewer is already initialized in init()
        } else {
            image.classList.remove('hidden');
            container.classList.remove('active');
            cameraControls.classList.remove('active');
        }
    };

    if (toggleBtnDesktop) toggleBtnDesktop.addEventListener('click', toggle3D);
    if (toggleBtnMobile) toggleBtnMobile.addEventListener('click', toggle3D);
}

function setupCameraAngleListeners() {
    document.querySelectorAll('.camera-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const angle = btn.dataset.angle;
            if (threeViewer) threeViewer.setCameraAngle(angle);
        });
    });
}

// Preload all possible image combinations
function preloadImages() {
    console.log('Starting image preload...');
    let loadedCount = 0;
    const totalImages = bases.length * rims.length * patterns.length;

    rims.forEach(rim => {
        bases.forEach(base => {
            patterns.forEach(pattern => {
                let imagePath;
                if (rim === 'Golden Ring') {
                    if (base === 'Copper') return; // Copper only for Copper Ring
                    imagePath = `renders/Golden Ring/${base} - Golden Ring/${pattern} - ${base}.webp`;
                } else if (rim === 'Silver Ring') {
                    if (base === 'Copper') return; // Copper only for Copper Ring
                    imagePath = `renders/Silver Ring/${base} - Silver Ring/Silver Ring - ${pattern} - ${base}.webp`;
                } else if (rim === 'Copper Ring') {
                    imagePath = `renders/Copper Ring/${base} - Copper Ring/Copper Ring - ${pattern} - ${base}.webp`;
                }

                const img = new Image();
                img.onload = () => {
                    loadedCount++;
                    if (loadedCount === totalImages) {
                        console.log('All images preloaded successfully');
                    }
                };
                img.src = imagePath;
            });
        });
    });
}

// Setup event listeners for all control buttons
function setupEventListeners() {
    // ... (existing code for control buttons) ...
    const controlButtons = document.querySelectorAll('.control-btn');

    controlButtons.forEach(button => {
        button.addEventListener('click', function () {
            const type = this.dataset.type;
            const value = this.dataset.value;

            // Update active state
            const siblings = this.parentElement.querySelectorAll('.control-btn');
            siblings.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            // Add click animation
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);

            // Update configuration
            config[type] = value;

            // Handle Copper Base Conditional Visibility
            if (type === 'rim') {
                const copperBaseBtn = document.getElementById('copper-base-btn');
                if (value === 'Copper Ring') {
                    copperBaseBtn.style.display = 'flex';
                } else {
                    copperBaseBtn.style.display = 'none';
                    if (config.base === 'Copper') {
                        config.base = 'Red';
                        // Update UI Active State for Base
                        const baseButtons = document.querySelectorAll('[data-type="base"]');
                        baseButtons.forEach(btn => btn.classList.remove('active'));
                        document.querySelector('[data-type="base"][data-value="Red"]').classList.add('active');
                    }
                }
            }

            updateProduct();
        });
    });
}

// Cart & Theme Logic

function setupCartListeners() {
    const addToCartBtn = document.getElementById('addToCartBtn');
    const summaryBtn = document.getElementById('summaryBtn');
    const closeCartBtn = document.getElementById('closeCartBtn');
    const cartModal = document.getElementById('cartModal');
    const checkoutBtn = document.getElementById('checkoutBtn');



    // New Summary Elements
    const summaryModal = document.getElementById('summaryModal');
    const closeSummaryBtn = document.getElementById('closeSummaryBtn');

    addToCartBtn.addEventListener('click', () => {
        addToCart();
        openCart();
    });

    summaryBtn.addEventListener('click', () => {
        // Changed: Opens Summary Modal instead of Cart
        openSummary();
    });

    closeCartBtn.addEventListener('click', () => {
        closeCart();
    });

    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) {
            closeCart();
        }
    });

    // Summary Modal Event Listeners
    closeSummaryBtn.addEventListener('click', () => {
        closeSummary();
    });

    summaryModal.addEventListener('click', (e) => {
        if (e.target === summaryModal) {
            closeSummary();
        }
    });

    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) return;

        // Trigger Confetti
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#fbbf24', '#d4a574', '#ffffff'] // Gold theme colors
        });

        // Show Success Modal
        openSuccess();

        // Clear Cart
        cart = [];
        renderCart();
    });

    // Success Modal Close
    document.getElementById('closeSuccessBtn').addEventListener('click', () => {
        closeSuccess();
    });
}

function openSuccess() {
    document.getElementById('checkoutSuccessModal').classList.add('open');
}

function closeSuccess() {
    document.getElementById('checkoutSuccessModal').classList.remove('open');
}


function addToCart() {
    const item = {
        id: Date.now(),
        config: { ...config },
        names: {
            base: configNames[config.base],
            rim: configNames[config.rim],
            pattern: configNames[config.pattern]
        },
        image: getCurrentImagePath()
    };

    cart.push(item);
    renderCart();
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cartItemsContainer');

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-cart-message">Your cart is empty</div>';
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="cart-item">
            <img src="${item.image}" alt="Lamp Config" class="cart-item-image">
            <div class="cart-item-details">
                <div class="cart-item-title">Majesty Lamp - ${item.names.base}</div>
                <div class="cart-item-specs">${item.names.rim} • ${item.names.pattern}</div>
            </div>
            <button class="remove-item-btn" onclick="removeFromCart(${item.id})">
                Remove
            </button>
        </div>
    `).join('');

    // Re-attach event listeners for remove buttons (since inline onclick is not ideal but easiest here)
    // Actually, let's delegate or leave as is if global scope issues arise. 
    // To be safe in module/strict contexts, we should delegate or attach via JS.
    // For simplicity here, I'll attach via JS after render.
    const removeButtons = container.querySelectorAll('.remove-item-btn');
    removeButtons.forEach((btn, index) => {
        btn.onclick = () => removeFromCart(cart[index].id);
    });
}

function openSummary() {
    document.getElementById('summaryModal').classList.add('open');
}

function closeSummary() {
    document.getElementById('summaryModal').classList.remove('open');
}

function openCart() {
    document.getElementById('cartModal').classList.add('open');
}

function closeCart() {
    document.getElementById('cartModal').classList.remove('open');
}

function getCurrentImagePath() {
    if (config.rim === 'Golden Ring') {
        return `renders/Golden Ring/${config.base} - Golden Ring/${config.pattern} - ${config.base}.webp`;
    } else if (config.rim === 'Silver Ring') {
        return `renders/Silver Ring/${config.base} - Silver Ring/Silver Ring - ${config.pattern} - ${config.base}.webp`;
    } else if (config.rim === 'Copper Ring') {
        return `renders/Copper Ring/${config.base} - Copper Ring/Copper Ring - ${config.pattern} - ${config.base}.webp`;
    }
}

function setupThemeListener() {
    const themeBtn = document.getElementById('themeToggleBtn');
    const sunIcon = themeBtn.querySelector('.sun-icon');
    const moonIcon = themeBtn.querySelector('.moon-icon');

    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');

        if (isLight) {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        }
    });
}

// ... (Rest of existing functions) ...

// Update product display based on current configuration
function updateProduct() {
    updateProductImage();
    updateConfigurationName();

    // Update 3D model if it exists
    if (threeViewer) {
        threeViewer.updateMaterials();
    }
}

// Update the product image based on current configuration
function updateProductImage() {
    const productImage = document.getElementById('productImage');

    // Build the path based on your folder structure:
    // renders/[Rim Finish]/[Base Color] - [Rim Finish]/[Pattern] - [Base Color].png
    // OR for Silver Ring: renders/Silver Ring/[Base Color] - Silver Ring/Silver Ring - [Pattern] - [Base Color].png

    let imagePath;

    if (config.rim === 'Golden Ring') {
        // Golden Ring path: renders/Golden Ring/[Base] - Golden Ring/[Pattern] - [Base].webp
        imagePath = `renders/Golden Ring/${config.base} - Golden Ring/${config.pattern} - ${config.base}.webp`;
    } else if (config.rim === 'Silver Ring') {
        // Silver Ring path: renders/Silver Ring/[Base] - Silver Ring/Silver Ring - [Pattern] - [Base].webp
        imagePath = `renders/Silver Ring/${config.base} - Silver Ring/Silver Ring - ${config.pattern} - ${config.base}.webp`;
    } else if (config.rim === 'Copper Ring') {
        // Copper Ring path: renders/Copper Ring/[Base] - Copper Ring/Copper Ring - [Pattern] - [Base].webp
        imagePath = `renders/Copper Ring/${config.base} - Copper Ring/Copper Ring - ${config.pattern} - ${config.base}.webp`;
    }

    console.log('Loading image:', imagePath);

    // Instant change - no transitions
    productImage.src = imagePath;

    // Handle image load error - fallback to placeholder
    productImage.onerror = function () {
        console.error(`Image not found: ${imagePath}`);
        // Try to show a helpful error message
        this.alt = `Image not found: ${config.pattern} - ${config.base} with ${config.rim}`;
    };
}

// Update the configuration name/title
function updateConfigurationName() {
    const engineSpec = document.getElementById('engineSpec');
    const baseColorName = configNames[config.base].toUpperCase();

    // Instant update
    if (engineSpec) {
        engineSpec.textContent = baseColorName;
    }
}

// Add smooth scroll behavior
document.addEventListener('DOMContentLoaded', function () {
    // Add smooth transitions to all elements
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease';
        document.body.style.opacity = '1';
    }, 100);

    // Initialize the app
    init();
});

// Export configuration for potential future use (e.g., saving, sharing)
function getCurrentConfiguration() {
    return {
        base: config.base,
        rim: config.rim,
        pattern: config.pattern,
        baseColorName: configNames[config.base],
        rimFinishName: configNames[config.rim],
        patternName: configNames[config.pattern]
    };
}

// Optional: Add keyboard navigation
document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const activeSection = document.querySelector('.control-section:hover');
        if (activeSection) {
            const buttons = activeSection.querySelectorAll('.control-btn');
            const activeButton = activeSection.querySelector('.control-btn.active');
            const currentIndex = Array.from(buttons).indexOf(activeButton);

            let newIndex;
            if (e.key === 'ArrowRight') {
                newIndex = (currentIndex + 1) % buttons.length;
            } else {
                newIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            }

            buttons[newIndex].click();
        }
    }
});
