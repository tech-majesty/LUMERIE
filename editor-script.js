
// Editor Global State
let editor = null;
let selectedObject = null;
let transformControl = null;

class EditorViewer {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.loader = new THREE.GLTFLoader();

        // Imported Material Settings (Default State)
        this.materialSettings = {
            global: {
                exposure: 1,
                mainLightIntensity: 2.13,
                rimLightIntensity: 2.38,
                ambientIntensity: 0,
                bloomStrength: 0.48,
                bloomRadius: 1,
                bloomThreshold: 0.975,
                logoLightIntensity: 8.8,
                logoLightX: 0,
                logoLightY: 0.03,
                logoLightZ: 2,
                logoLightDistance: 3.73,
                logoLightDecay: 5,
                logoLightAngle: 0.03,
                logoLightPenumbra: 1,
                logoLightTargetX: 0,
                logoLightTargetY: -0.15,
                logoLightTargetZ: 0,
                debugHelpers: true
            },
        };

        this.init();
        this.setupEditorTools();
    }

    init() {
        // Renderer
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.container.appendChild(this.renderer.domElement);

        // Camera
        this.camera.position.set(0, 0, 4);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        // Lighting & Env
        this.setupEnvironment();
        this.setupLights();

        // Load Main Model
        this.loadModel();

        // Post Processing
        this.setupPostProcessing();

        // Render Loop
        this.animate();

        // Resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupPostProcessing() {
        this.renderScene = new THREE.RenderPass(this.scene, this.camera);

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

        this.finalComposer = new THREE.EffectComposer(this.renderer);
        this.finalComposer.addPass(this.renderScene);

        // Mix Pass (Simple additive for editor visualization)
        const mixPass = new THREE.ShaderPass(
            new THREE.ShaderMaterial({
                uniforms: {
                    baseTexture: { value: null },
                    bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                    }
                `,
                fragmentShader: `
                    uniform sampler2D baseTexture;
                    uniform sampler2D bloomTexture;
                    varying vec2 vUv;
                    void main() {
                        gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
                    }
                `,
                defines: {}
            }), "baseTexture"
        );
        mixPass.needsSwap = true;
        this.finalComposer.addPass(mixPass);

        // FXAA
        const pixelRatio = this.renderer.getPixelRatio();
        this.fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        this.fxaaPass.material.uniforms['resolution'].value.x = 1 / (this.container.clientWidth * pixelRatio);
        this.fxaaPass.material.uniforms['resolution'].value.y = 1 / (this.container.clientHeight * pixelRatio);
        this.finalComposer.addPass(this.fxaaPass);

        this.bloomComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);
        this.finalComposer.setSize(this.container.clientWidth * pixelRatio, this.container.clientHeight * pixelRatio);
    }

    setupEnvironment(url = 'env_texture/studio_small_08_1k.hdr') {
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        const isHDR = url.toLowerCase().endsWith('.hdr');
        const loader = isHDR ? new THREE.RGBELoader() : new THREE.TextureLoader();

        loader.load(url, (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            this.scene.environment = envMap;
            this.scene.background = envMap; // Set background visible in editor
            texture.dispose();
            pmremGenerator.dispose();
            console.log("Environment loaded:", url);
        });
    }

    setupLights() {
        const global = this.materialSettings.global;

        this.ambientLight = new THREE.AmbientLight(0xffffff, global.ambientIntensity);
        this.ambientLight.name = "Ambient Light";
        this.scene.add(this.ambientLight);

        this.mainLight = new THREE.DirectionalLight(0xffffff, global.mainLightIntensity);
        this.mainLight.name = "Main Directional";
        this.mainLight.position.set(5, 5, 5);
        this.scene.add(this.mainLight);

        this.rimLight = new THREE.PointLight(0xffffff, global.rimLightIntensity);
        this.rimLight.name = "Rim Light";
        this.rimLight.position.set(-5, 3, -5);
        this.scene.add(this.rimLight);

        // Logo Light
        this.logoLight = new THREE.SpotLight(0xffffff, global.logoLightIntensity);
        this.logoLight.name = "Logo SpotLight";
        this.logoLight.distance = global.logoLightDistance;
        this.logoLight.decay = global.logoLightDecay;
        this.logoLight.angle = global.logoLightAngle;
        this.logoLight.penumbra = global.logoLightPenumbra;
        this.logoLight.position.set(global.logoLightX, global.logoLightY, global.logoLightZ);
        this.logoLight.target.position.set(global.logoLightTargetX, global.logoLightTargetY, global.logoLightTargetZ);

        this.scene.add(this.logoLight);
        this.scene.add(this.logoLight.target); // Target is invisible object3d

        // Helpers
        this.logoLightHelper = new THREE.SpotLightHelper(this.logoLight);
        this.logoLightHelper.name = "Helper (Logo)";
        this.scene.add(this.logoLightHelper);

        this.axesHelper = new THREE.AxesHelper(2);
        this.axesHelper.name = "Axes Helper";
        this.scene.add(this.axesHelper);
    }

    loadModel() {
        this.loader.load('https://pub-0fa84320243249fca31ce0de4238c3e8.r2.dev/MajestyGLB.glb', (gltf) => {
            this.model = gltf.scene;
            this.model.name = "Majesty Lamp";
            this.scene.add(this.model);

            // Center model
            const box = new THREE.Box3().setFromObject(this.model);
            const center = box.getCenter(new THREE.Vector3());
            this.model.position.sub(center);

            this.populateHierarchy();
        });
    }

    setupEditorTools() {
        // Transform Controls
        transformControl = new THREE.TransformControls(this.camera, this.renderer.domElement);
        transformControl.addEventListener('dragging-changed', (event) => {
            this.controls.enabled = !event.value;
        });
        transformControl.addEventListener('change', () => {
            if (selectedObject) this.updateInspector(selectedObject);
            if (this.logoLightHelper && this.logoLightHelper.light === selectedObject) this.logoLightHelper.update();
        });
        this.scene.add(transformControl);

        // Raycaster for Picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.renderer.domElement.addEventListener('pointerdown', (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);

            for (let i = 0; i < intersects.length; i++) {
                if (intersects[i].object.type === 'TransformControlsPlane') continue;
                if (intersects[i].object.userData.isGizmo) continue;

                // Also filter out gizmo helpers by name
                const name = intersects[i].object.name;
                if (['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'XYZE'].includes(name)) continue;

                this.selectObject(intersects[i].object);
                break;
            }
        });
    }

    populateHierarchy() {
        const list = document.getElementById('hierarchy');
        list.innerHTML = '';

        const createItem = (obj, nameOverride, isRoot = false) => {
            const el = document.createElement('div');
            el.className = 'hierarchy-item';
            el.textContent = nameOverride || obj.name || obj.type;
            if (isRoot) el.style.fontWeight = 'bold';

            el.onclick = (e) => {
                e.stopPropagation();
                this.selectObject(obj, el);
            };
            return el;
        };

        // Root "Scene" item to access Global Settings
        const sceneItem = createItem({ name: "Scene Global", type: "Global" }, "Scene (Global Settings)", true);
        list.appendChild(sceneItem);

        const traverse = (obj, parentElem, depth = 0) => {
            // STRICT FILTERING
            if (!obj) return;

            // Gizmo parts often have these specific names or properties
            const ignoreNames = ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'XYZE', 'E', 'START', 'END', 'DELTA', 'AXIS', 'invisible'];
            if (ignoreNames.includes(obj.name)) return;

            // Filter by type
            if (obj.type === 'TransformControls' || obj.type === 'TransformControlsPlane' || obj.type === 'TransformControlsGizmo') return;
            // Also Line/LineSegments are usually helpers unless explicitly named nicely
            // But let's allow them if they are NOT children of the controls. 
            // Better: Just check parent.
            if (obj.parent && obj.parent.type === 'TransformControlsGizmo') return;

            const el = document.createElement('div');
            el.className = 'hierarchy-item';
            el.style.paddingLeft = (depth * 10 + 8) + 'px';
            el.textContent = obj.name || `Unnamed ${obj.type}`;

            el.onclick = (e) => {
                e.stopPropagation();
                this.selectObject(obj, el);
            };

            parentElem.appendChild(el);

            // Recursively traverse children
            if (obj.children) {
                // Determine if we should traverse children.
                // Don't traverse inside Helpers
                if (!obj.type.includes('Helper')) {
                    obj.children.forEach(child => traverse(child, parentElem, depth + 1));
                }
            }
        };

        // Traverse only direct scene children first
        this.scene.children.forEach(child => {
            // Explicitly skip the transform control itself and helpers logic
            if (child.type !== 'TransformControls' && !child.name.includes('Helper')) {
                traverse(child, list, 1);
            }
        });
    }

    deleteObject(obj) {
        if (!obj || obj.type === 'Global') return;

        if (obj.parent) {
            obj.parent.remove(obj);
        }

        if (selectedObject === obj) {
            transformControl.detach();
            selectedObject = null;
            document.getElementById('inspector-content').innerHTML = '<div style="color: #666; font-style: italic;">Select an object</div>';
        }

        this.populateHierarchy();
    }

    selectObject(obj, uiElem) {
        if (!obj) return;
        selectedObject = obj;

        // Update UI Highlight
        document.querySelectorAll('.hierarchy-item').forEach(e => e.classList.remove('active'));
        if (uiElem) {
            uiElem.classList.add('active');
        }

        if (obj.type === 'Global') {
            transformControl.detach();
            this.updateInspectorForGlobal();
            return;
        }

        // Attach Gizmo 
        if (obj.position && obj.type !== 'TransformControlsPlane') {
            transformControl.attach(obj);
        } else {
            transformControl.detach();
        }

        this.updateInspector(obj);
    }

    // ... updated updateInspector ...
    updateInspectorForGlobal() {
        const content = document.getElementById('inspector-content');
        content.innerHTML = '';
        const global = this.materialSettings.global;

        const createHeader = (text) => {
            const h = document.createElement('div');
            h.innerText = text;
            h.style.fontWeight = 'bold';
            h.style.marginTop = '10px';
            h.style.borderBottom = '1px solid #444';
            content.appendChild(h);
        }

        const createRow = (label, value, onChange, step = 0.1) => this.buildInspectorRow(content, label, value, onChange, step);

        createHeader("Global Settings");
        createRow("Exposure", global.exposure, (v) => { global.exposure = v; this.renderer.toneMappingExposure = v; });
        createRow("Ambient Int.", global.ambientIntensity, (v) => { global.ambientIntensity = v; this.ambientLight.intensity = v; });
        createRow("Main Light Int.", global.mainLightIntensity, (v) => { global.mainLightIntensity = v; this.mainLight.intensity = v; });
        createRow("Rim Light Int.", global.rimLightIntensity, (v) => { global.rimLightIntensity = v; this.rimLight.intensity = v; });

        createHeader("Bloom Settings");
        createRow("Strength", global.bloomStrength, (v) => { global.bloomStrength = v; this.bloomPass.strength = v; });
        createRow("Radius", global.bloomRadius, (v) => { global.bloomRadius = v; this.bloomPass.radius = v; });
        createRow("Threshold", global.bloomThreshold, (v) => { global.bloomThreshold = v; this.bloomPass.threshold = v; });
    }

    updateInspector(obj) {
        const content = document.getElementById('inspector-content');
        content.innerHTML = '';

        // Name & UUID
        const title = document.createElement('div');
        title.innerHTML = `<strong style="color:orange">${obj.name || obj.type}</strong><br><span style="font-size:10px;color:#666">${obj.uuid}</span>`;
        content.appendChild(title);

        // Delete Button
        const delBtn = document.createElement('button');
        delBtn.innerText = "DELETE OBJECT";
        delBtn.style.backgroundColor = "#d32f2f";
        delBtn.style.color = "white";
        delBtn.style.border = "none";
        delBtn.style.padding = "8px";
        delBtn.style.width = "100%";
        delBtn.style.marginTop = "10px";
        delBtn.style.cursor = "pointer";
        delBtn.style.fontWeight = "bold";
        delBtn.onclick = () => this.deleteObject(obj);
        content.appendChild(delBtn);

        const createHeader = (text) => {
            const h = document.createElement('div');
            h.innerText = text;
            h.style.fontWeight = 'bold';
            h.style.marginTop = '10px';
            h.style.borderBottom = '1px solid #444';
            content.appendChild(h);
        }

        // Transform
        if (obj.position) {
            createHeader('Transform');
            ['x', 'y', 'z'].forEach(axis => {
                this.buildInspectorRow(content, `Pos ${axis.toUpperCase()}`, obj.position[axis], (v) => obj.position[axis] = v);
            });
            ['x', 'y', 'z'].forEach(axis => {
                this.buildInspectorRow(content, `Rot ${axis.toUpperCase()}`, obj.rotation[axis], (v) => obj.rotation[axis] = v);
            });
            ['x', 'y', 'z'].forEach(axis => {
                this.buildInspectorRow(content, `Scale ${axis.toUpperCase()}`, obj.scale[axis], (v) => obj.scale[axis] = v);
            });
        }

        // Light Properties
        if (obj.isLight) {
            createHeader('Light Config');
            this.buildInspectorRow(content, 'Intensity', obj.intensity, (v) => obj.intensity = v);
            if (obj.distance !== undefined) this.buildInspectorRow(content, 'Distance', obj.distance, (v) => obj.distance = v);
            if (obj.decay !== undefined) this.buildInspectorRow(content, 'Decay', obj.decay, (v) => obj.decay = v);
            if (obj.angle !== undefined) this.buildInspectorRow(content, 'Angle', obj.angle, (v) => obj.angle = v);
            if (obj.penumbra !== undefined) this.buildInspectorRow(content, 'Penumbra', obj.penumbra, (v) => obj.penumbra = v);

            // Color
            const colorRow = document.createElement('div');
            colorRow.className = 'inspector-row';
            colorRow.innerHTML = '<label>Color</label>';
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = '#' + obj.color.getHexString();
            colorInput.onchange = (e) => obj.color.set(e.target.value);
            colorRow.appendChild(colorInput);
            content.appendChild(colorRow);
        }

        // Material Properties (StandardMaterial)
        if (obj.material) {
            createHeader('Material');
            const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;

            if (mat.metalness !== undefined) this.buildInspectorRow(content, 'Metalness', mat.metalness, (v) => mat.metalness = v);
            if (mat.roughness !== undefined) this.buildInspectorRow(content, 'Roughness', mat.roughness, (v) => mat.roughness = v);
            if (mat.envMapIntensity !== undefined) this.buildInspectorRow(content, 'EnvMap Int.', mat.envMapIntensity, (v) => mat.envMapIntensity = v);

            const colorRow = document.createElement('div');
            colorRow.className = 'inspector-row';
            colorRow.innerHTML = '<label>Color</label>';
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = '#' + mat.color.getHexString();
            colorInput.onchange = (e) => mat.color.set(e.target.value);
            colorRow.appendChild(colorInput);
            content.appendChild(colorRow);
        }
    }

    buildInspectorRow(container, label, value, onChange, step = 0.1) {
        const row = document.createElement('div');
        row.className = 'inspector-row';

        const lbl = document.createElement('label');
        lbl.textContent = label;

        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = step;
        inp.value = (typeof value === 'number' && value.toFixed) ? value.toFixed(3) : value;
        inp.onchange = (e) => onChange(parseFloat(e.target.value));

        row.appendChild(lbl);
        row.appendChild(inp);
        container.appendChild(row);
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.bloomComposer.render();
        this.finalComposer.render();
    }

    // API
    addLight(type = 'PointLight') {
        const light = new THREE.PointLight(0xffffff, 1);
        light.position.set(0, 2, 0);
        light.name = "New " + type;
        this.scene.add(light);
        this.populateHierarchy();
        this.selectObject(light);
    }

    addPrimitive(type) {
        let geometry;
        if (type === 'Box') geometry = new THREE.BoxGeometry(1, 1, 1);
        else if (type === 'Sphere') geometry = new THREE.SphereGeometry(0.5, 32, 32);
        else if (type === 'Plane') geometry = new THREE.PlaneGeometry(2, 2);

        const material = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0, roughness: 0.5 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "New " + type;
        mesh.position.set(0, 1, 0);
        if (type === 'Plane') mesh.rotation.x = -Math.PI / 2;

        this.scene.add(mesh);
        this.populateHierarchy();
        this.selectObject(mesh);
        document.getElementById('primitiveMenu').style.display = 'none';
    }

    importModel(file) {
        const url = URL.createObjectURL(file);
        const name = file.name;
        const extension = name.split('.').pop().toLowerCase();

        if (extension === 'glb' || extension === 'gltf') {
            this.loader.load(url, (gltf) => {
                const model = gltf.scene;
                model.name = name;
                this.scene.add(model);
                this.populateHierarchy();
                this.selectObject(model);
                URL.revokeObjectURL(url);
            }, undefined, (e) => console.error(e));
        } else {
            alert('Format not supported by basic loader: ' + extension);
        }
    }

    loadEnvironment(file) {
        const url = URL.createObjectURL(file);
        this.setupEnvironment(url);
    }

    toggleGizmoMode() {
        const modes = ['translate', 'rotate', 'scale'];
        const current = transformControl.getMode();
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        transformControl.setMode(next);
        document.getElementById('btnToggleGizmo').textContent = `Mode: ${next.charAt(0).toUpperCase() + next.slice(1)}`;
    }

    saveConfig() {
        const config = {
            global: this.materialSettings.global
        };
        console.log("--- EDITOR EXPORT ---");
        console.log(JSON.stringify(config, null, 2));
        alert("Global Config saved to Console!");
    }
}

// Init
editor = new EditorViewer();

// Wire up Buttons
document.getElementById('btnAddLight').addEventListener('click', () => editor.addLight());
document.getElementById('btnSave').addEventListener('click', () => editor.saveConfig());
document.getElementById('btnToggleGizmo').addEventListener('click', () => editor.toggleGizmoMode());

// Primitives Menu
document.getElementById('btnAddPrimitive').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('primitiveMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => {
    const menu = document.getElementById('primitiveMenu');
    if (menu) menu.style.display = 'none';
});

// File Inputs
const fileInputModel = document.getElementById('fileInputModel');
const fileInputEnv = document.getElementById('fileInputEnv');

document.getElementById('btnImportModel').addEventListener('click', () => fileInputModel.click());
fileInputModel.addEventListener('change', (e) => {
    if (e.target.files[0]) editor.importModel(e.target.files[0]);
});

document.getElementById('btnLoadEnv').addEventListener('click', () => fileInputEnv.click());
fileInputEnv.addEventListener('change', (e) => {
    if (e.target.files[0]) editor.loadEnvironment(e.target.files[0]);
});
