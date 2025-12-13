const app = {
	// Config
	defaultPalette: {
		"gold": "#ad8957",
		"red": "#fa3a3d",
		"grey": "#dbdbdb",
		"dark": "#272320"
	},

	// State
	palette: {},
    files: {},
    activeVar: null,
    selectedFile: null,
    deleteMode: false,
    isSpaceDown: false,
    classPrefix: 'svg-colorize-',
	scale: 1, panX: 0, panY: 0,
	history: [],
    blinkInterval: null,
    isDragging: false,
    lastMouseX: 0, lastMouseY: 0,
    keyTimers: {},
    longPressActive: false,
    _ctx: null,
    hasUnsavedChanges: false,

    // Backend State
    hasBackend: false,
    pollingEnabled: false,

    updateGlobalStyle() {
        if (!this.els.globalStyle) {
            this.els.globalStyle = document.createElement('style');
            document.head.appendChild(this.els.globalStyle);
        }

        let css = "";
        for (const [name, hex] of Object.entries(this.palette)) {
            css += `.${this.classPrefix}${name} { fill: var(--${name}, ${hex}); }\n`;
        }
        this.els.globalStyle.textContent = css;
    },

    els: {
		viewport: document.getElementById('viewport'),
		world: document.getElementById('world'),
		palette: document.getElementById('palette'),
		status: document.getElementById('status-bar'),
		btnDelete: document.getElementById('btn-delete'),
		modalCss: document.getElementById('modal-css'),
		modalPalette: document.getElementById('modal-palette'),
		cssOutput: document.getElementById('css-output'),
		paletteInput: document.getElementById('palette-input'),
		arInput: document.getElementById('ar-input'),
		indicator: document.getElementById('backend-indicator'),
		pollCheck: document.getElementById('poll-check'),
		pollGroup: document.getElementById('polling-group'),
		showNamesCheck: document.getElementById('show-filenames-check')
	},

	async init() {
        this.loadPalette();
        this.updateGlobalStyle();

        		// Check Backend
        		try {
        			const check = await fetch('api.php?action=list');
                    if (check.ok) {
                        try {
                            const data = await check.json();
                            this.hasBackend = Array.isArray(data);
                        } catch (e) {
                            this.hasBackend = false;
                        }
                    } else {
                        this.hasBackend = false;
                    }
        		} catch (e) {
        			this.hasBackend = false;
        		}
		// Setup UI based on backend
		if (this.hasBackend) {
			this.els.indicator.textContent = "Backend: PHP (Disk)";
			this.els.pollGroup.style.display = 'flex'; // Show polling toggle
		} else {
			this.els.indicator.textContent = "Backend: Browser Storage";
		}

		// Restore View State
		const saved = localStorage.getItem('svg_canvas_state');
		if (saved) {
			try {
				const p = JSON.parse(saved);
				this.panX = p.panX || 0;
				this.panY = p.panY || 0;
				this.scale = p.scale || 1;
			} catch (e) { }
		}

		// Restore Aspect Ratio
		const savedAR = localStorage.getItem('target_ar');
		if (savedAR) this.els.arInput.value = savedAR;

		this.loadAllFiles();

		// Polling Interval
		setInterval(() => this.pollChanges(), 2000);

		this.bindEvents();
		this.updateTransform();
	},

	bindEvents() {
		window.addEventListener('beforeunload', (e) => {
			if (this.hasUnsavedChanges) {
				e.preventDefault();
				e.returnValue = ''; // For Chrome
				return ''; // For other browsers
			}
		});

		// Canvas
		this.els.viewport.addEventListener('wheel', e => this.handleWheel(e), { passive: false });
		this.els.viewport.addEventListener('mousedown', e => this.handleMouseDown(e));
		window.addEventListener('mousemove', e => this.handleMouseMove(e));
		window.addEventListener('mouseup', e => this.handleMouseUp(e));

		// Keys
		document.addEventListener('keydown', e => this.handleKeydown(e));
		document.addEventListener('keyup', e => this.handleKeyup(e));

		// Modals
		document.querySelectorAll('.modal-overlay').forEach(el => {
			el.addEventListener('click', (e) => { if (e.target === el) this.closeModals(); });
		});

		// Settings
		this.els.arInput.addEventListener('change', () => {
			localStorage.setItem('target_ar', this.els.arInput.value);
			this.loadAllFiles(); // Refresh indicators
		});

        this.els.pollCheck.addEventListener('change', (e) => {
            this.pollingEnabled = e.target.checked;
        });

        this.els.showNamesCheck.addEventListener('change', (e) => {
            document.body.classList.toggle('show-filenames', e.target.checked);
        });

        window.addEventListener('resize', () => this.layoutGrid());

        // Drag & Drop
        document.body.addEventListener('dragover', e => this.handleDragOver(e));
        document.body.addEventListener('drop', e => this.handleDrop(e));
    },

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    },

    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
                const text = await file.text();
                // If file already exists, we might want to rename or overwrite. 
                // For simplicity, let's overwrite or just add.
                // If we want to support adding new files in browser mode properly:
                
                if (!this.files[file.name]) {
                    this.files[file.name] = { mtime: Date.now(), dirty: true };
                }
                
                // If card exists, remove it to re-create (or update content)
                const existingCard = document.querySelector(`.svg-card[data-file="${file.name}"]`);
                if (existingCard) existingCard.remove();

                this.createSvgCard(file.name, text);
                this.updateCardDirtyState(file.name);
                this.hasUnsavedChanges = true;
                
                // If backend exists, we could auto-save, but let's keep it manual or let the user decide.
                // Requirement says "allow dropping svgs".
                this.els.status.textContent = `Imported ${file.name}`;
            }
        }
        this.layoutGrid();
    },

    // --- PALETTE MANAGEMENT ---

	loadPalette() {
		// 1. Try Local Storage
		const saved = localStorage.getItem('svg_palette');
		if (saved) {
			try {
				this.palette = JSON.parse(saved);
			} catch (e) { this.palette = this.defaultPalette; }
		} else {
			// 2. Use Default
			this.palette = this.defaultPalette;
		}

		// Validate activeVar
		if (!this.activeVar || !this.palette[this.activeVar]) {
			this.activeVar = Object.keys(this.palette)[0];
		}

        this.renderPalette();
        this.updateGlobalStyle();
    },

    editPalette() {
        this.els.paletteInput.value = JSON.stringify(this.palette, null, 4);
        this.renderPaletteEditor();
        this.els.modalPalette.classList.add('open');
    },

    renderPaletteEditor() {
        const list = document.getElementById('palette-list');
        if (!list) return;
        list.innerHTML = '';

        Object.entries(this.palette).forEach(([name, hex]) => {
            const row = document.createElement('div');
            row.className = 'palette-row';
            row.innerHTML = `
                <input type="color" class="color-preview-input" value="${hex}" title="Change Color">
                <span class="color-name">${name}</span>
                <span class="color-hex">${hex}</span>
                <button class="icon-btn delete-btn" title="Remove">×</button>
            `;
            
            const colorInput = row.querySelector('.color-preview-input');
            colorInput.addEventListener('input', (e) => {
                const newHex = e.target.value;
                this.palette[name] = newHex;
                row.querySelector('.color-hex').textContent = newHex;
                this.updatePaletteJson();
            });

            row.querySelector('.delete-btn').onclick = () => {
                delete this.palette[name];
                this.updatePaletteJson();
                this.renderPaletteEditor();
            };
            
            list.appendChild(row);
        });
    },

    addPaletteColor() {
        const nameInput = document.getElementById('new-color-name');
        const hexInput = document.getElementById('new-color-hex');
        const name = nameInput.value.trim();
        const hex = hexInput.value;

        if (!name) {
            alert("Please enter a color name");
            return;
        }

        if (this.palette[name]) {
            if (!confirm(`Overwrite color "${name}"?`)) return;
        }

        this.palette[name] = hex;
        nameInput.value = '';
        this.updatePaletteJson();
        this.renderPaletteEditor();
        this.hasUnsavedChanges = true;
    },

    updatePaletteJson() {
        this.els.paletteInput.value = JSON.stringify(this.palette, null, 4);
        this.hasUnsavedChanges = true;
    },

    savePaletteJson() {
        try {
            // Sync from JSON textarea in case user edited it manually
            const newPalette = JSON.parse(this.els.paletteInput.value);
            this.palette = newPalette;
            localStorage.setItem('svg_palette', JSON.stringify(this.palette));
            this.loadPalette(); // Re-render main palette
            this.closeModals();
            this.hasUnsavedChanges = false;
        } catch (e) {
            alert("Invalid JSON!");
        }
    },

	// --- DATA LAYER ---

	async loadAllFiles() {
		this.els.status.textContent = "Loading...";
		try {
			let data = [];

			if (this.hasBackend) {
				const res = await fetch('api.php?action=load_all');
				if (res.ok) data = await res.json();
			} else {
				// LocalStorage Mock
				const lsData = localStorage.getItem('svg_files');
				if (lsData) {
					data = JSON.parse(lsData);
				} else {
					// Seed demo if empty local storage
					data = [];
				}
			}

			this.els.world.innerHTML = '';

			if (!data || data.length === 0) {
				this.renderEmptyState();
				this.els.status.textContent = "No files found";
				return;
			}

			data.forEach(file => {
				this.createSvgCard(file.name, file.content);
				const isDirty = this.files[file.name] ? this.files[file.name].dirty : false;
				this.files[file.name] = { mtime: file.mtime, dirty: isDirty };
				if (isDirty) this.updateCardDirtyState(file.name);
			});
			this.els.status.textContent = `Loaded ${data.length} files`;
            this.layoutGrid();

		} catch (e) {
			console.error(e);
			this.els.status.textContent = "Error loading files";
			this.renderEmptyState("Error connecting to backend.");
		}
	},

    layoutGrid() {
        const cards = Array.from(this.els.world.querySelectorAll('.svg-card'));
        if (cards.length === 0) return;

        const gap = 20;
        const cardWidth = 200;
        const padding = 100; // Left + Right padding

        const winW = window.innerWidth;
        const winH = window.innerHeight;

        // Account for Palette Panel
        const palettePanel = document.getElementById('palette-panel');
        let paletteOffset = 0;
        if (palettePanel) {
            const rect = palettePanel.getBoundingClientRect();
            if (rect.width > 0) {
                paletteOffset = rect.right + 20; // 20px buffer
            }
        }

        const effectiveW = Math.max(100, winW - paletteOffset);
        const ratio = effectiveW / winH;

        // Calculate columns based on screen aspect ratio
        let cols = Math.round(Math.sqrt(cards.length * ratio));
        if (cols < 1) cols = 1;

        // Calculate required width
        // padding * 2 + cols * cardWidth + (cols - 1) * gap
        const requiredWidth = (padding * 2) + (cols * cardWidth) + (Math.max(0, cols - 1) * gap);
        this.els.world.style.width = `${requiredWidth}px`;

        // Calculate height for centering
        const rows = Math.ceil(cards.length / cols);
        const cardHeight = 200;
        const requiredHeight = (padding * 2) + (rows * cardHeight) + (Math.max(0, rows - 1) * gap);

        // Center view
        const centerX = paletteOffset + (effectiveW / 2);
        const centerY = winH / 2;
        const worldCenterX = requiredWidth / 2;
        const worldCenterY = requiredHeight / 2;

        this.panX = centerX - (worldCenterX * this.scale);
        this.panY = centerY - (worldCenterY * this.scale);
        this.updateTransform();
    },

	renderEmptyState(msg = null) {
		this.els.world.innerHTML = `
            <div style="color:var(--text); text-align:center; padding:40px; opacity:0.5; width:100%;">
                <h3>${msg || "No SVGs Found"}</h3>
                ${this.hasBackend
				? "<p>Add .svg files to the <code>/svgs</code> folder.</p>"
				: "<p>Drop files here.</p>"}
            </div>
        `;
	},

	async saveFile(filename = this.selectedFile) {
		if (!filename) return;

		const card = document.querySelector(`.svg-card[data-file="${filename}"]`);
		if (!card) return;
		const svgContent = card.querySelector('svg').outerHTML;

		this.els.status.textContent = `Saving ${filename}...`;

		if (this.hasBackend) {
			try {
				const res = await fetch('api.php?action=save', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ file: filename, content: svgContent })
				});
				const data = await res.json();
				if (data.success) {
					this.files[filename].mtime = data.mtime;
					this.files[filename].dirty = false;
					this.updateCardDirtyState(filename);
					this.els.status.textContent = "Saved!";
					this.updateStatus();
                    this.hasUnsavedChanges = false;
				}
			} catch (e) { this.els.status.textContent = "Save failed"; }
        } else {
            // Browser Mode: Download the file
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.files[filename].dirty = false;
            this.updateCardDirtyState(filename);
            this.els.status.textContent = "Downloaded " + filename;
            this.hasUnsavedChanges = false;
        }
    },

    async saveAllFiles() {
        const dirtyFiles = Object.keys(this.files).filter(f => this.files[f].dirty);
        if (dirtyFiles.length === 0) {
            this.els.status.textContent = "No changes to save.";
            return;
        }

        this.els.status.textContent = `Saving ${dirtyFiles.length} files...`;
        
        for (const filename of dirtyFiles) {
            await this.saveFile(filename);
        }
        
        this.els.status.textContent = "All files saved!";
        this.hasUnsavedChanges = false;
        setTimeout(() => this.updateStatus(), 2000);
    },

    async pollChanges() {
		// Only poll if backend exists AND toggle is enabled
		if (this.isDragging || !this.hasBackend || !this.pollingEnabled) return;

		try {
			const res = await fetch('api.php?action=poll_all');
			if (!res.ok) return;
			const serverFiles = await res.json();

			// Check for updates
			let needsReload = false;

			// Check existing files
			for (const [name, mtime] of Object.entries(serverFiles)) {
				if (!this.files[name]) {
					needsReload = true; // New file found
					break;
				}
				if (mtime > this.files[name].mtime) {
					if (this.files[name].dirty) {
						console.warn(`Conflict: ${name} changed on disk but has local edits.`);
					} else {
						needsReload = true;
						break;
					}
				}
			}

			// Reload if files changed on disk
			if (needsReload) {
				this.loadAllFiles();
			}
		} catch (e) { }
	},

	// --- SVG MANIPULATION ---

	fixAspectRatio(filename) {
		this.pushHistory(filename);
		const card = document.querySelector(`.svg-card[data-file="${filename}"]`);
		const svg = card.querySelector('svg');
		if (!svg) return;

		const targetRatio = parseFloat(this.els.arInput.value) || 1;

		let viewBox = svg.getAttribute('viewBox');
		let x = 0, y = 0, w = 0, h = 0;

		if (viewBox) {
			const parts = viewBox.split(/[\s,]+/).map(parseFloat);
			if (parts.length === 4) [x, y, w, h] = parts;
		} else {
			w = parseFloat(svg.getAttribute('width')) || 100;
			h = parseFloat(svg.getAttribute('height')) || 100;
		}

		if (w && h) {
			const currentRatio = w / h;

			let newW = w;
			let newH = h;
			let newX = x;
			let newY = y;

			if (currentRatio < targetRatio) {
				// Too tall, need more width
				const requiredWidth = h * targetRatio;
				const addedWidth = requiredWidth - w;
				newW = requiredWidth;
				newX = x - (addedWidth / 2);
			} else if (currentRatio > targetRatio) {
				// Too wide, need more height
				const requiredHeight = w / targetRatio;
				const addedHeight = requiredHeight - h;
				newH = requiredHeight;
				newY = y - (addedHeight / 2);
			} else {
				return;
			}

			svg.setAttribute('viewBox', `${newX} ${newY} ${newW} ${newH}`);
			svg.setAttribute('width', newW);
			svg.setAttribute('height', newH);

			this.files[filename].dirty = true;
			this.updateCardDirtyState(filename);
			this.selectFile(filename);
			this.saveFile(filename);
            this.hasUnsavedChanges = true;

			const fixBtn = card.querySelector('.fix-icon');
			if (fixBtn) fixBtn.remove();
		}
	},

	// --- UI CREATION ---

	createSvgCard(filename, content) {
		const card = document.createElement('div');
		card.className = 'svg-card';
		card.dataset.file = filename;

		card.innerHTML = `
            ${content}
            <div class="filename">${filename}</div>
            <div class="card-action save-icon" title="Save changes">💾</div>
        `;

		// Check Aspect Ratio
		const svg = card.querySelector('svg');
		if (svg) {
			let w = 0, h = 0;
			const viewBox = svg.getAttribute('viewBox');
			if (viewBox) {
				const parts = viewBox.split(/[\s,]+/).map(parseFloat);
				if (parts.length === 4) { w = parts[2]; h = parts[3]; }
			} else {
				w = parseFloat(svg.getAttribute('width'));
				h = parseFloat(svg.getAttribute('height'));
			}

			const targetRatio = parseFloat(this.els.arInput.value) || 1;
			const currentRatio = (w && h) ? w / h : 1;

            if (Math.abs(currentRatio - targetRatio) > 0.05) {
                const fixBtn = document.createElement('div');
                fixBtn.className = 'card-action fix-icon';
                fixBtn.title = `Fix Aspect Ratio to ${targetRatio}`;
                fixBtn.innerHTML = '⤢';
                fixBtn.onclick = (e) => { e.stopPropagation(); this.fixAspectRatio(filename); };
                card.appendChild(fixBtn);
            }
            // this.injectStyleTag(svg); // Removed in favor of global style
            svg.addEventListener('click', (e) => this.handleSvgClick(e, filename));
        }

		card.addEventListener('mousedown', (e) => {
			if (this.isSpaceDown) return;
			e.stopPropagation();
			this.selectFile(filename);
		});

		const saveIcon = card.querySelector('.save-icon');
		saveIcon.addEventListener('mousedown', (e) => {
			if (this.isSpaceDown) return;
			e.stopPropagation();
			this.selectFile(filename);
			this.saveFile(filename);
		});

		this.els.world.appendChild(card);
	},

    handleSvgClick(e, filename) {
        if (this.isSpaceDown) return;

        if (e.altKey || this.deleteMode) {
            e.preventDefault(); e.stopPropagation();
            if (e.target.tagName === 'svg') return;
            this.pushHistory(filename);
            e.target.remove();
            this.files[filename].dirty = true;
            this.updateCardDirtyState(filename);
            this.updateStatus();
            this.hasUnsavedChanges = true;
            return;
        }

        this.pushHistory(filename);
        this.selectFile(filename);

        const hex = this.palette[this.activeVar];
        let targetEl = e.target;

        if (e.target.tagName === 'svg') {
            const svg = e.target;
            let bgRect = svg.querySelector('.canvas-bg');

            if (!bgRect) {
                bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                bgRect.setAttribute('class', 'canvas-bg');
                const vb = svg.getAttribute('viewBox');
                if (vb) {
                    const parts = vb.split(/[\s,]+/).map(parseFloat);
                    bgRect.setAttribute('x', parts[0]); bgRect.setAttribute('y', parts[1]);
                    bgRect.setAttribute('width', parts[2]); bgRect.setAttribute('height', parts[3]);
                } else {
                    bgRect.setAttribute('width', '100%'); bgRect.setAttribute('height', '100%');
                }
                svg.prepend(bgRect);
            }
            targetEl = bgRect;
        }

        // Remove existing color classes
        Object.keys(this.palette).forEach(name => targetEl.classList.remove(this.classPrefix + name));
        
        // Add new color class
        targetEl.classList.add(this.classPrefix + this.activeVar);
        
        // Remove inline style fill
        targetEl.style.fill = ''; 
        
        // Set fill attribute for fallback
        targetEl.setAttribute('fill', hex);

        this.files[filename].dirty = true;
        this.updateCardDirtyState(filename);
        this.updateStatus();
        this.hasUnsavedChanges = true;
    },

	// --- CANVAS TRANSFORMS ---
	updateTransform() {
		this.els.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
		localStorage.setItem('svg_canvas_state', JSON.stringify({ panX: this.panX, panY: this.panY, scale: this.scale }));
	},
	handleWheel(e) {
		e.preventDefault();
		const factor = Math.exp(-Math.sign(e.deltaY) * 0.1);
		const rect = this.els.viewport.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		this.panX = mx - (mx - this.panX) * factor;
		this.panY = my - (my - this.panY) * factor;
		this.scale *= factor;
		this.updateTransform();
	},
	handleMouseDown(e) {
		if (this.isSpaceDown || e.target.id === 'viewport' || e.target.id === 'world') {
			this.isDragging = true;
			document.body.classList.add('panning');
			this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
		}
	},
	handleMouseMove(e) {
		if (!this.isDragging) return;
		this.panX += e.clientX - this.lastMouseX;
		this.panY += e.clientY - this.lastMouseY;
		this.lastMouseX = e.clientX; this.lastMouseY = e.clientY;
		this.updateTransform();
	},
	handleMouseUp() {
		this.isDragging = false;
		document.body.classList.remove('panning');
	},

	// --- KEYBOARD ---
	handleKeydown(e) {
		if (document.activeElement === this.els.arInput || document.activeElement === this.els.paletteInput) return;

        if (e.code === 'Space' && !this.isSpaceDown) {
            this.isSpaceDown = true;
            document.body.classList.add('mode-pan');
        }

        let key = parseInt(e.key);

        // Support physical keys (AZERTY, Numpad without NumLock)
        if (isNaN(key)) {
            if (e.code.startsWith('Digit')) key = parseInt(e.code.replace('Digit', ''));
            else if (e.code.startsWith('Numpad')) key = parseInt(e.code.replace('Numpad', ''));
        }

        if (!isNaN(key) && key >= 1 && key <= 9) {
            const name = Object.keys(this.palette)[key - 1];
            if (name && !this.keyTimers[key]) {
                this.keyTimers[key] = setTimeout(() => {
                    this.startBlinking(name, this.palette[name]);
                    this.longPressActive = true;
                }, 300);
            }
        }

        if (e.key.toLowerCase() === 'd') this.toggleDeleteMode();
		if (e.key.toLowerCase() === 'c') this.showCss();

		if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveFile(); }
		if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
		if (e.key === 'Escape') {
			if (this.deleteMode) this.toggleDeleteMode();
			this.closeModals();
		}
	},
    handleKeyup(e) {
        if (e.code === 'Space') {
            this.isSpaceDown = false;
            document.body.classList.remove('mode-pan');
        }

        let key = parseInt(e.key);
        if (isNaN(key)) {
            if (e.code.startsWith('Digit')) key = parseInt(e.code.replace('Digit', ''));
            else if (e.code.startsWith('Numpad')) key = parseInt(e.code.replace('Numpad', ''));
        }

        if (!isNaN(key) && key >= 1 && key <= 9) {
            const name = Object.keys(this.palette)[key - 1];
            
            if (this.keyTimers[key]) {
                clearTimeout(this.keyTimers[key]);
                delete this.keyTimers[key];
            }

            if (this.longPressActive) {
                this.stopBlinking(name);
                this.longPressActive = false;
            } else if (name) {
                this.selectColor(name);
            }
        }
    },

	// --- HELPERS ---
	renderPalette() {
		this.els.palette.innerHTML = '';
		let index = 1;
		Object.entries(this.palette).forEach(([name, hex]) => {
			const div = document.createElement('div');
			div.className = 'color-swatch';
			div.dataset.name = name;
			div.style.backgroundColor = `var(--${name})`;
			if (index <= 9) {
				const span = document.createElement('span');
				span.className = 'key-number';
				span.textContent = index;
				div.appendChild(span);
			}
			if (name === this.activeVar) div.classList.add('active');
			div.onclick = () => this.selectColor(name);
			div.onmouseenter = () => this.startBlinking(name, hex);
			div.onmouseleave = () => this.stopBlinking(name);
			this.els.palette.appendChild(div);
			index++;
		});

		// Update CSS Variables in Root
		const root = document.documentElement;
		for (const [name, hex] of Object.entries(this.palette)) {
			root.style.setProperty(`--${name}`, hex);
		}
	},
	selectColor(name) {
		if (this.deleteMode) this.toggleDeleteMode();
		this.activeVar = name;
		document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('active'));
		const activeEl = document.querySelector(`.color-swatch[data-name="${name}"]`);
		if (activeEl) activeEl.classList.add('active');
	},
    startBlinking(name, hex) {
        if (this.blinkInterval) clearInterval(this.blinkInterval);
        const blinkColor = `color-mix(in oklab, ${hex}, #ff00ff)`;
        let visible = true;
        this.els.world.style.setProperty(`--${name}`, blinkColor);
        this.blinkInterval = setInterval(() => {
            visible = !visible;
            if (visible) this.els.world.style.setProperty(`--${name}`, blinkColor);
            else this.els.world.style.removeProperty(`--${name}`);
        }, 150);
    },
	stopBlinking(name) {
		if (this.blinkInterval) clearInterval(this.blinkInterval);
		this.els.world.style.removeProperty(`--${name}`);
	},
	toggleDeleteMode() {
		this.deleteMode = !this.deleteMode;
		this.els.btnDelete.classList.toggle('active', this.deleteMode);
		document.body.classList.toggle('mode-delete', this.deleteMode);
	},
	pushHistory(filename) {
		const card = document.querySelector(`.svg-card[data-file="${filename}"]`);
		if (!card) return;
		const svg = card.querySelector('svg');
		this.history.push({ filename: filename, content: svg.outerHTML });
		if (this.history.length > 50) this.history.shift();
	},
	undo() {
		const last = this.history.pop();
		if (!last) return;
		const card = document.querySelector(`.svg-card[data-file="${last.filename}"]`);
		if (card) {
			const temp = document.createElement('div');
			temp.innerHTML = last.content;
			const newSvg = temp.firstElementChild;
			const oldSvg = card.querySelector('svg');
			if (oldSvg) {
				card.replaceChild(newSvg, oldSvg);
				newSvg.addEventListener('click', (e) => this.handleSvgClick(e, last.filename));
				this.files[last.filename].dirty = true;
				this.updateCardDirtyState(last.filename);
                this.hasUnsavedChanges = true;
			}
		}
	},
	selectFile(filename) {
		this.selectedFile = filename;
		document.querySelectorAll('.svg-card').forEach(el => el.classList.remove('selected'));
		const card = document.querySelector(`.svg-card[data-file="${filename}"]`);
		if (card) card.classList.add('selected');
		this.updateStatus();
	},
	updateCardDirtyState(filename) {
		const card = document.querySelector(`.svg-card[data-file="${filename}"]`);
		if (card) card.classList.toggle('dirty', this.files[filename].dirty);
	},
	updateStatus() {
		if (this.selectedFile) {
			const dirty = this.files[this.selectedFile]?.dirty;
			this.els.status.textContent = `${this.selectedFile} ${dirty ? '(Unsaved)' : ''}`;
			this.els.status.style.color = dirty ? '#fab387' : 'var(--text)';
		} else {
			this.els.status.textContent = "No selection";
		}
	},
    showCss() {
        let css = ":root {\n";
        for (const [name, hex] of Object.entries(this.palette)) {
            css += `    --${name}: ${hex};\n`;
        }
        css += "}\n\n";
        
        for (const [name, hex] of Object.entries(this.palette)) {
            css += `.${this.classPrefix}${name} { fill: var(--${name}); }\n`;
        }

        this.els.cssOutput.value = css;
        this.els.modalCss.classList.add('open');
    },
    closeModals() {
        this.els.modalCss.classList.remove('open');
        this.els.modalPalette.classList.remove('open');
    },

    assignColorVariables() {
        const svgs = this.els.world.querySelectorAll('svg');
        let count = 0;
        let filesChanged = new Set();

        svgs.forEach(svg => {
            const filename = svg.closest('.svg-card').dataset.file;
            const elements = svg.querySelectorAll('*');
            
            elements.forEach(el => {
                // Cleanup invalid classes
                const classesToRemove = [];
                el.classList.forEach(cls => {
                    if (cls.startsWith(this.classPrefix)) {
                        const name = cls.replace(this.classPrefix, '');
                        if (!this.palette[name]) classesToRemove.push(cls);
                    }
                });
                if (classesToRemove.length > 0) {
                    el.classList.remove(...classesToRemove);
                    if (filename) filesChanged.add(filename);
                }

                const styleFill = el.style.fill;
                const attrFill = el.getAttribute('fill');
                
                // 1. Handle existing variables (legacy check, though we prefer classes now)
                if (styleFill && styleFill.includes('var(--')) {
                    const match = styleFill.match(/var\(--([a-zA-Z0-9-_]+)/);
                    if (match && match[1]) {
                        const varName = match[1];
                        if (this.palette[varName]) {
                            const hex = this.palette[varName];
                            const className = this.classPrefix + varName;
                            
                            const hasClass = el.classList.contains(className);
                            const hasStyle = el.style.fill !== '';
                            
                            if (!hasClass || hasStyle) {
                                Object.keys(this.palette).forEach(name => el.classList.remove(this.classPrefix + name));
                                el.classList.add(className);
                                el.style.fill = '';
                                el.setAttribute('fill', hex);
                                count++;
                                if (filename) filesChanged.add(filename);
                            }
                        }
                    }
                    return; 
                }

                // 2. Handle static colors
                let colorToCheck = null;
                if (styleFill && styleFill !== 'none') {
                    colorToCheck = styleFill;
                } else if (!styleFill && attrFill && attrFill !== 'none') {
                    colorToCheck = attrFill;
                }

                if (colorToCheck) {
                    if (colorToCheck.startsWith('url(')) return;

                    const fillHex = this.toHex(colorToCheck);
                    if (fillHex) {
                        for (const [name, paletteColor] of Object.entries(this.palette)) {
                            const paletteHex = this.toHex(paletteColor);
                            if (fillHex === paletteHex) {
                                const className = this.classPrefix + name;
                                if (!el.classList.contains(className)) {
                                    Object.keys(this.palette).forEach(n => el.classList.remove(this.classPrefix + n));
                                    el.classList.add(className);
                                    el.style.fill = '';
                                    el.setAttribute('fill', paletteHex);
                                    count++;
                                    if (filename) filesChanged.add(filename);
                                }
                                break; 
                            }
                        }
                    }
                }
            });
        });

        filesChanged.forEach(filename => {
            this.files[filename].dirty = true;
            this.updateCardDirtyState(filename);
            this.hasUnsavedChanges = true;
        });

        this.els.status.textContent = `Assigned variables to ${count} elements`;
        setTimeout(() => this.updateStatus(), 2000);
    },

    toHex(color) {
        if (!color) return null;
        if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color.toLowerCase();
        
        if (!this._ctx) {
            this._ctx = document.createElement('canvas').getContext('2d');
        }
        this._ctx.fillStyle = color;
        // If the color is invalid, fillStyle won't change. 
        // But we can't easily detect that unless we set it to something known first.
        // However, for this use case, we assume valid colors.
        return this._ctx.fillStyle;
    }
};

// Start
app.init();
