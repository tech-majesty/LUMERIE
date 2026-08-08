/* =============================================================================
 *  Majesty — configurator page logic
 *
 *  ThreeViewer and the catalogue constants live in viewer.js, which must load
 *  before this file. Only the configurator's own UI lives here.
 * ========================================================================== */

// Initialize the application
// Initialize the application
function init() {
    setupEventListeners();
    updateProduct();
    setupCartListeners();
    setupThemeListener();

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

    // EMBEDDED IN THE LANDING PAGE
    //
    // index.html mounts one ThreeViewer for its hero and then opens the
    // configurator over the top of it, so the same lamp is on screen the whole
    // time. When that is the case hero.js has already published its viewer and
    // this file must attach to it rather than build a second one — a second
    // viewer would mean a second WebGL context, a second 6.7 MB model download
    // and two canvases fighting over the same container.
    //
    // There is also nothing to load, so there is no splash to run.
    const shared = window.MajestySharedViewer || null;

    // Start the animation loop
    if (!shared) requestAnimationFrame(updateLoader);

    // The splash tracks the model, because the model IS the first view now — the
    // 2D still it used to track no longer exists. The bar shows real download
    // progress and the page is revealed with a finished scene rather than an
    // empty stage. Capped at 96% so the last few percent covers the work after
    // the bytes land (material binding, edge fit, reflector) and the reveal never
    // lands on a half-built frame.
    const modelReady = () => { targetProgress = 100; };
    // loadModel() reports 0-100. Math.max keeps the bar monotonic: if the repo
    // copy fails and the R2 fallback restarts the download, progress must not
    // visibly run backwards.
    const onModelProgress = (percent) => {
        if (!(percent > 0)) return;
        targetProgress = Math.max(targetProgress, Math.min(96, percent * 0.96));
    };
    // A stalled or uncached CDN must not trap the client behind the splash.
    setTimeout(modelReady, 20000);

    if (shared) {
        threeViewer = shared;
        viewerReady = true;
    } else {
        threeViewer = new ThreeViewer({
            onProgress: onModelProgress,
            onLoad: () => {
                viewerReady = true;
                modelReady();
            }
        });
    }

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
}



function setupCameraAngleListeners() {
    document.querySelectorAll('.camera-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const angle = btn.dataset.angle;
            if (threeViewer) threeViewer.setCameraAngle(angle);
        });
    });
}

/**
 * Add a picker button for every coded pattern that isn't already in the markup.
 * Clones the existing .control-item so the button is identical in style — the
 * point is that adding a pattern needs no HTML edit, only a recipe.
 * Runs before the click listeners are attached, so the new buttons get wired too.
 */
function injectCodedPatternButtons() {
    const MP = window.MajestyPatterns;
    if (!MP || !MP.RECIPES) return;

    const existing = document.querySelector('.control-btn[data-type="pattern"]');
    if (!existing) return;
    const container = existing.closest('.control-options');
    const template = existing.closest('.control-item');
    if (!container || !template) return;

    Object.keys(MP.RECIPES).forEach(name => {
        if (container.querySelector(`.control-btn[data-value="${name}"]`)) return;
        const item = template.cloneNode(true);
        const btn = item.querySelector('.control-btn');
        btn.classList.remove('active');
        btn.dataset.value = name;
        btn.title = name;
        btn.innerHTML = MP.iconFor(name);
        const label = item.querySelector('.mobile-label');
        if (label) label.textContent = name;
        container.appendChild(item);
    });
}

// Setup event listeners for all control buttons
function setupEventListeners() {
    // coded patterns first, so their buttons are included below
    injectCodedPatternButtons();

    // ... (existing code for control buttons) ...
    const controlButtons = document.querySelectorAll('.control-btn');

    controlButtons.forEach(button => {
        button.addEventListener('click', function () {
            const type = this.dataset.type;
            const value = this.dataset.value;

            // Update active state.
            // Each button sits in its own .control-item wrapper, so
            // this.parentElement only ever contained the button itself and the
            // previously selected option never lost its highlight — two buttons
            // could read as active at once. Scope to the whole option group.
            const group = this.closest('.control-options') || this.parentElement;
            group.querySelectorAll(`.control-btn[data-type="${type}"]`)
                .forEach(btn => btn.classList.remove('active'));
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
            base: displayName(config.base),
            rim: displayName(config.rim),
            pattern: displayName(config.pattern)
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
            ${item.image
            ? `<img src="${item.image}" alt="Lamp Config" class="cart-item-image">`
            : `<div class="cart-item-image"></div>`}
            <div class="cart-item-details">
                <div class="cart-item-title">MAJESTY AIoT Lamp - ${item.names.base}</div>
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

/**
 * Thumbnail for a cart line. Comes from the live viewer, so it shows the actual
 * configuration — including coded patterns, which never had a still.
 * Returns null before the model has landed; renderCart() handles that.
 */
function getCurrentImagePath() {
    return (threeViewer && viewerReady) ? threeViewer.captureThumbnail() : null;
}

function setupThemeListener() {
    const themeBtn = document.getElementById('themeToggleBtn');
    // The landing page embeds the configurator without the light-mode toggle —
    // it has one palette and switching half the chrome to a light theme mid-page
    // would look broken.
    if (!themeBtn) return;
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
    updateConfigurationName();

    // The viewer is the whole product display now — no still to swap.
    if (threeViewer) {
        threeViewer.updateMaterials();
    }
}

// Update the configuration name/title
function updateConfigurationName() {
    const engineSpec = document.getElementById('engineSpec');
    const baseColorName = displayName(config.base).toUpperCase();

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
        baseColorName: displayName(config.base),
        rimFinishName: displayName(config.rim),
        patternName: displayName(config.pattern)
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
