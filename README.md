# Majesty - Luxury AI Lamp Configurator

A premium, interactive product configurator website for the Majesty luxury AI lamp. Features a stunning dark theme with glassmorphism effects, smooth animations, and a high-fidelity 3D customization interface.

## Features

- **Interactive Product Configurator**: Real-time preview of different color and pattern combinations.
- **Real-Time 3D Viewer**: High-fidelity 3D model viewer powered by **Three.js** with:
  - Realistic Physically Based Rendering (PBR) materials.
  - Dynamic material switching for Bass, Rims, Screens, and Patterns.
  - High-dynamic-range (HDR) environment lighting.
  - Smooth camera controls and transitions.
- **Premium Dark Design**: Sophisticated dark theme (`#010101`) with glassmorphism overlays and gold accents.
- **Smart Preloading**: Instant configuration switching with background image preloading.
- **Optimized Assets**: High-quality WebP images for fast loading.
- **Responsive Layout**: Seamless mobile adaptation with bottom-sheet controls and optimized image placement.

## Customization Options

### Base Colors (7 options)
- Red
- Red Metallic
- Black
- White
- Gold
- Silver
- Copper

### Rim Colors (3 options)
- Golden Ring
- Silver Ring
- Copper Ring

### Patterns (3 options)
- Triangle
- Star
- Arabic

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **3D Graphics**: Three.js
- **Animations**: GSAP (GreenSock Animation Platform)
- **Effects**: Canvas Confetti
- **Assets**: GLTF/GLB 3D Models, EXR Environment Maps, WebP Renders

## File Structure

```
majesty-lamp/
├── index.html          # Main HTML structure
├── styles.css          # Styling, dark theme, and responsiveness
├── script.js           # Logic, Three.js 3D viewer, and state management
├── README.md           # Documentation
├── 3D Model/           # Folder for local 3D assets (large files ignored by git)
├── env_texture/        # Environment maps for 3D lighting (EXR)
└── renders/            # 2D Product render images (WebP format)
    ├── Golden Ring/    
    ├── Silver Ring/
    └── Copper Ring/
```

## Setup & Running

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Mustafakamran/Majesty-AI-Lamp-Configurator.git
    cd majesty-lamp
    ```

    > **Note on Large Files**: The high-quality 3D model (`MajestyGLB.glb`) is hosted externally on Cloudflare R2 to avoid GitHub repository size limits. The application is configured to load it remotely.

2.  **Run a local server**:
    Because the site uses dynamic imports, EXR loaders, and image preloading, it requires a local server.

    **Using Python**:
    ```bash
    python -m http.server 3000
    ```

    **Using Node.js**:
    ```bash
    npx http-server . -p 3000
    ```

    **Using VS Code Live Server**:
    Simply click "Go Live" in the bottom right corner if you have the Live Server extension installed.

3.  **Open in Browser**:
    Navigate to `http://localhost:3000`.

## Asset Management

- **2D Images**: All product images are in **WebP** format. Naming convention: `[Base] - [Rim]/[Pattern] - [Base].webp`.
- **3D Model**: The GLB file is loaded dynamically. Material changes are handled programmatically in `script.js` by targeting specific mesh names in the model.

## License

© 2026 Majesty. All rights reserved.
