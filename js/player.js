/**
 * ==============================================================================
 * ARCHIVO: js/player.js
 * DESCRIPCIÓN: Reproductor Temporal / Animación Time-Lapse.
 * Permite reproducir en secuencia los accidentes por Hora, Día de la Semana o Mes/Año.
 * ==============================================================================
 */

const PlayerModule = {
    isPlaying: false,
    mode: 'hour', // 'hour' | 'weekday' | 'month'
    speed: 1, // 0.5 | 1 | 2
    currentIndex: 0,
    timer: null,
    monthList: [],

    init() {
        this.buildMonthList();
        this.bindEvents();
        this.updateUI();
    },

    buildMonthList() {
        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        if (!dataMod || !dataMod.allData) return;
        const monthNames = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const keysSet = new Set();
        dataMod.allData.forEach(d => {
            if (d.monthKey && d.monthKey > 200000) {
                keysSet.add(d.monthKey);
            }
        });
        const sorted = Array.from(keysSet).sort((a, b) => a - b);
        this.monthList = sorted.map(k => {
            const yr = Math.floor(k / 100);
            const mo = k % 100;
            return {
                key: k,
                year: yr,
                month: mo,
                label: `${monthNames[mo] || mo} ${yr}`
            };
        });
    },

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.updatePlayBtnUI();
        this.runStep();
        const interval = Math.round(800 / this.speed);
        this.timer = setInterval(() => {
            this.next();
        }, interval);
    },

    pause() {
        this.isPlaying = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.updatePlayBtnUI();
    },

    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.play();
    },

    setMode(newMode) {
        const wasPlaying = this.isPlaying;
        this.pause();
        this.mode = newMode;
        this.currentIndex = 0;
        this.resetFiltersForMode();
        this.updateUI();
        if (wasPlaying) this.play();
    },

    setSpeed(newSpeed) {
        this.speed = newSpeed;
        if (this.isPlaying) {
            this.pause();
            this.play();
        }
    },

    next() {
        const max = this.getMaxSteps();
        this.currentIndex = (this.currentIndex + 1) % max;
        this.runStep();
    },

    prev() {
        const max = this.getMaxSteps();
        this.currentIndex = (this.currentIndex - 1 + max) % max;
        this.runStep();
    },

    goTo(index) {
        const max = this.getMaxSteps();
        this.currentIndex = Math.max(0, Math.min(max - 1, index));
        this.runStep();
    },

    getMaxSteps() {
        if (this.mode === 'hour') return 24;
        if (this.mode === 'weekday') return 7;
        if (this.mode === 'month') return this.monthList.length || 1;
        return 24;
    },

    runStep() {
        const idx = this.currentIndex;
        const filtersMod = (typeof FiltersModule !== 'undefined' ? FiltersModule : window.FiltersModule);
        if (!filtersMod || !filtersMod.activeFilters) return;

        if (this.mode === 'hour') {
            const h = idx;
            filtersMod.activeFilters.hourMin = h;
            filtersMod.activeFilters.hourMax = h;
            const minEl = document.getElementById('hour-min');
            const maxEl = document.getElementById('hour-max');
            if (minEl && maxEl) {
                minEl.value = h;
                maxEl.value = h;
            }
            const tagEl = document.getElementById('hour-range-tag');
            if (tagEl) tagEl.textContent = `${String(h).padStart(2, '0')}:00 h`;
        } else if (this.mode === 'weekday') {
            const wkFullNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            filtersMod.activeFilters.weekdays = new Set([idx]);
            const tagEl = document.getElementById('weekday-range-tag');
            if (tagEl) tagEl.textContent = wkFullNames[idx] || '';
            if (filtersMod.updateWkPresetsUI) filtersMod.updateWkPresetsUI();
        } else if (this.mode === 'month') {
            if (this.monthList[idx]) {
                const item = this.monthList[idx];
                filtersMod.activeFilters.targetMonthKey = item.key;
            }
        }

        this.updateTimelineUI();
        if (window.App && window.App.scheduleUpdate) {
            window.App.scheduleUpdate();
        }
    },

    resetFiltersForMode() {
        const filtersMod = (typeof FiltersModule !== 'undefined' ? FiltersModule : window.FiltersModule);
        if (!filtersMod || !filtersMod.activeFilters) return;

        if (this.mode === 'hour') {
            filtersMod.activeFilters.hourMin = 0;
            filtersMod.activeFilters.hourMax = 23;
            const minEl = document.getElementById('hour-min');
            const maxEl = document.getElementById('hour-max');
            if (minEl && maxEl) { minEl.value = 0; maxEl.value = 23; }
            const tagEl = document.getElementById('hour-range-tag');
            if (tagEl) tagEl.textContent = '00 – 23 h';
        } else if (this.mode === 'weekday') {
            filtersMod.activeFilters.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
            const tagEl = document.getElementById('weekday-range-tag');
            if (tagEl) tagEl.textContent = 'Dom – Sáb';
            if (filtersMod.updateWkPresetsUI) filtersMod.updateWkPresetsUI();
        } else if (this.mode === 'month') {
            delete filtersMod.activeFilters.targetMonthKey;
        }
        if (window.App && window.App.scheduleUpdate) {
            window.App.scheduleUpdate();
        }
    },

    resetAll() {
        this.pause();
        this.currentIndex = 0;
        const filtersMod = (typeof FiltersModule !== 'undefined' ? FiltersModule : window.FiltersModule);
        if (filtersMod && filtersMod.activeFilters) {
            filtersMod.activeFilters.hourMin = 0;
            filtersMod.activeFilters.hourMax = 23;
            filtersMod.activeFilters.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
            delete filtersMod.activeFilters.targetMonthKey;

            const minEl = document.getElementById('hour-min');
            const maxEl = document.getElementById('hour-max');
            if (minEl && maxEl) { minEl.value = 0; maxEl.value = 23; }
            const hTag = document.getElementById('hour-range-tag');
            if (hTag) hTag.textContent = '00 – 23 h';
            const wTag = document.getElementById('weekday-range-tag');
            if (wTag) wTag.textContent = 'Dom – Sáb';
            if (filtersMod.updateWkPresetsUI) filtersMod.updateWkPresetsUI();
        }

        this.updateUI();
        if (window.App && window.App.scheduleUpdate) {
            window.App.scheduleUpdate();
        }
    },

    updatePlayBtnUI() {
        const btn = document.getElementById('tp-play-btn');
        if (!btn) return;
        if (this.isPlaying) {
            btn.classList.add('playing');
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pausar</span>`;
        } else {
            btn.classList.remove('playing');
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Reproducir</span>`;
        }
    },

    updateTimelineUI() {
        const slider = document.getElementById('tp-scrubber');
        const label = document.getElementById('tp-current-label');
        const badge = document.getElementById('tp-count-badge');
        const max = this.getMaxSteps();

        if (slider) {
            slider.max = max - 1;
            slider.value = this.currentIndex;
        }

        let text = '';
        if (this.mode === 'hour') {
            text = `⏰ ${String(this.currentIndex).padStart(2, '0')}:00 h`;
        } else if (this.mode === 'weekday') {
            const wkFullNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            text = `📅 ${wkFullNames[this.currentIndex] || ''}`;
        } else if (this.mode === 'month') {
            text = this.monthList[this.currentIndex] ? `📈 ${this.monthList[this.currentIndex].label}` : '';
        }

        if (label) label.textContent = text;
        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        if (badge && dataMod && dataMod.filteredData) {
            badge.textContent = `${dataMod.filteredData.length.toLocaleString('es-MX')} acc.`;
        }
    },

    updateUI() {
        this.updatePlayBtnUI();
        this.updateTimelineUI();
        document.querySelectorAll('.tp-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === this.mode);
        });
    },

    bindEvents() {
        const playBtn = document.getElementById('tp-play-btn');
        if (playBtn) playBtn.addEventListener('click', () => this.togglePlay());

        const prevBtn = document.getElementById('tp-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.prev());

        const nextBtn = document.getElementById('tp-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', () => this.next());

        const resetBtn = document.getElementById('tp-reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetAll());

        const scrubber = document.getElementById('tp-scrubber');
        if (scrubber) {
            scrubber.addEventListener('input', (e) => {
                this.goTo(parseInt(e.target.value, 10));
            });
        }

        document.querySelectorAll('.tp-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.getAttribute('data-mode'));
            });
        });

        const speedSelect = document.getElementById('tp-speed-select');
        if (speedSelect) {
            speedSelect.addEventListener('change', (e) => {
                this.setSpeed(parseFloat(e.target.value));
            });
        }
    }
};

window.PlayerModule = PlayerModule;
