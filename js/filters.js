/**
 * ==============================================================================
 * ARCHIVO: js/filters.js
 * DESCRIPCIÓN: Módulo de Interfaz de Filtros.
 * Controla la interacción del usuario con las fichas (chips), casillas de verificación,
 * desglosadores deslizantes (sliders dobles) y botones de reinicio/captura de pantalla.
 * ==============================================================================
 */

// Función auxiliar para normalizar texto eliminando acentos y convirtiendo a minúsculas
const normEs = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const FiltersModule = {
    // Estado activo con los criterios de filtrado seleccionados por el usuario
    activeFilters: {
        yearMin: 2016, yearMax: 2026,
        hourMin: 0, hourMax: 23,
        weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
        severidad: 'todos',
        vehiculos: new Set(),
        municipios: new Set(),
        tipos: new Set(),
        climas: new Set(),
        vias: new Set(),
        superfs: new Set(),
        sexos: new Set()
    },

    // Referencias completas con todas las opciones disponibles en la base de datos
    fullSets: {},

    /**
     * Inicializa la interfaz gráfica de los filtros
     */
    init() {
        this.populateFilterUI();
        this.bindEvents();
    },

    /**
     * Construye dinámicamente las listas de opciones (chips y listas con casilla)
     */
    populateFilterUI() {
        const data = DataModule.allData;

        // Fichas de Severidad
        const sevOptions = [['todos', 'Todos'], ['danos', 'Solo daños'], ['heridos', 'Con heridos'], ['fatal', 'Fatal']];
        document.getElementById('severity-chips').innerHTML = sevOptions.map(o => `<span class="chip ${o[0] === 'todos' ? 'active' : ''}" data-v="${o[0]}">${o[1]}</span>`).join('');

        const makeSet = col => [...new Set(data.map(d => String(d[col])).filter(x => x && x !== 'null' && x !== 'undefined'))].sort();
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        // Lista de selección: Tipo de Vehículo
        const vehiculoCounts = {};
        data.forEach(d => {
            if (d.vehiculos) {
                d.vehiculos.forEach(v => {
                    vehiculoCounts[v] = (vehiculoCounts[v] || 0) + 1;
                });
            }
        });
        const vehiculosList = Object.keys(vehiculoCounts).sort((a, b) => vehiculoCounts[b] - vehiculoCounts[a]);
        this.fullSets.vehiculos = new Set(vehiculosList);
        this.activeFilters.vehiculos = new Set(vehiculosList);

        const vehiChecklistEl = document.getElementById('vehi-checklist');
        if (vehiChecklistEl) {
            vehiChecklistEl.innerHTML = vehiculosList.map(v => {
                const lbl = v.length > 28 ? v.slice(0, 26) + '…' : v;
                return `<label class="check-row" title="${esc(v)}"><input type="checkbox" checked data-v="${esc(v)}"><span>${esc(lbl)}</span><span class="cnt">${vehiculoCounts[v]}</span></label>`;
            }).join('');
        }

        // Fichas: Condición Climática
        const climas = makeSet('condiciones_climaticas');
        this.fullSets.climas = new Set(climas);
        this.activeFilters.climas = new Set(climas);
        this.renderMultiChips('clima-chips', climas, 'climas');

        // Fichas: Condición de la Vía
        const vias = makeSet('condiciones_via');
        this.fullSets.vias = new Set(vias);
        this.activeFilters.vias = new Set(vias);
        this.renderMultiChips('via-chips', vias, 'vias');

        // Fichas: Superficie de Ocurrencia
        const superfs = makeSet('superficie_ocurrencia');
        this.fullSets.superfs = new Set(superfs);
        this.activeFilters.superfs = new Set(superfs);
        this.renderMultiChips('superf-chips', superfs, 'superfs');

        // Fichas: Sexo del Presunto Responsable
        const sexos = makeSet('sexo_presunto_responsable');
        this.fullSets.sexos = new Set(sexos);
        this.activeFilters.sexos = new Set(sexos);
        this.renderMultiChips('sexo-chips', sexos, 'sexos');

        // Lista de selección: Municipios
        const muniCounts = {};
        data.forEach(d => {
            const m = String(d.municipio);
            muniCounts[m] = (muniCounts[m] || 0) + 1;
        });
        const munis = Object.keys(muniCounts).sort((a, b) => {
            if (a.toUpperCase() === 'MORELIA') return -1; if (b.toUpperCase() === 'MORELIA') return 1;
            return a.localeCompare(b, 'es');
        });
        this.fullSets.municipios = new Set(munis);
        this.activeFilters.municipios = new Set(munis);

        document.getElementById('muni-checklist').innerHTML = munis.map(m => {
            return `<div class="check-row" data-name="${esc(normEs(m))}"><label class="check-label"><input type="checkbox" checked data-v="${esc(m)}"><span>${esc(m)}</span></label><span class="cnt">${muniCounts[m]}</span><button type="button" class="btn-zoom-muni" data-muni="${esc(m)}" title="Centrar mapa en ${esc(m)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><circle cx="12" cy="12" r="7"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg></button></div>`;
        }).join('');

        // Lista de selección: Tipo de Incidente
        const tipoCounts = {};
        data.forEach(d => {
            const t = String(d.tipo_incidente_vial);
            tipoCounts[t] = (tipoCounts[t] || 0) + 1;
        });
        const tipos = Object.keys(tipoCounts).sort((a, b) => tipoCounts[b] - tipoCounts[a]);
        this.fullSets.tipos = new Set(tipos);
        this.activeFilters.tipos = new Set(tipos);

        document.getElementById('tipo-checklist').innerHTML = tipos.map(t => {
            const lbl = t.length > 30 ? t.slice(0, 28) + '…' : t;
            return `<label class="check-row" title="${esc(t)}"><input type="checkbox" checked data-v="${esc(t)}"><span>${esc(lbl)}</span><span class="cnt">${tipoCounts[t]}</span></label>`;
        }).join('');
    },

    /**
     * Dibuja los conjuntos de fichas multitono (chips)
     */
    renderMultiChips(containerId, items, stateKey) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = items.map(item => `<span class="chip small active" data-cat="${stateKey}" data-val="${item}">${item}</span>`).join('');
    },

    /**
     * Conecta todos los eventos de la interfaz (clicks, inputs y botones)
     */
    bindEvents() {
        // Evento: Selección de Severidad
        document.getElementById('severity-chips').addEventListener('click', (e) => {
            const c = e.target.closest('.chip'); if (!c) return;
            this.activeFilters.severidad = c.getAttribute('data-v');
            document.querySelectorAll('#severity-chips .chip').forEach(x => x.classList.toggle('active', x === c));
            window.App.scheduleUpdate();
        });

        // Evento: Conmutación de Fichas Multitono (Clima, Vía, Superficie, Sexo)
        document.querySelectorAll('#clima-chips, #via-chips, #superf-chips, #sexo-chips').forEach(container => {
            container.addEventListener('click', (e) => {
                const c = e.target.closest('.chip'); if (!c) return;
                const cat = c.getAttribute('data-cat');
                const val = c.getAttribute('data-val');
                const s = this.activeFilters[cat];
                if (s.has(val) && s.size > 1) s.delete(val); else s.add(val);
                c.classList.toggle('active', s.has(val));
                window.App.scheduleUpdate();
            });
        });

        // Eventos: Listas con casillas (Vehículos, Municipios, Tipos)
        const vehiChecklist = document.getElementById('vehi-checklist');
        if (vehiChecklist) {
            vehiChecklist.addEventListener('change', (e) => {
                const cb = e.target; if (cb.tagName !== 'INPUT') return;
                const v = cb.getAttribute('data-v');
                if (cb.checked) this.activeFilters.vehiculos.add(v); else this.activeFilters.vehiculos.delete(v);
                window.App.scheduleUpdate();
            });
        }

        const muniChecklist = document.getElementById('muni-checklist');
        if (muniChecklist) {
            muniChecklist.addEventListener('change', (e) => {
                const cb = e.target; if (cb.tagName !== 'INPUT') return;
                const v = cb.getAttribute('data-v');
                if (cb.checked) this.activeFilters.municipios.add(v); else this.activeFilters.municipios.delete(v);
                window.App.scheduleUpdate();
            });

            muniChecklist.addEventListener('click', (e) => {
                const zoomBtn = e.target.closest('.btn-zoom-muni');
                if (zoomBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const muni = zoomBtn.getAttribute('data-muni');
                    const row = zoomBtn.closest('.check-row');
                    if (row) {
                        const cb = row.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) {
                            cb.checked = true;
                            this.activeFilters.municipios.add(muni);
                            window.App.scheduleUpdate();
                        }
                    }
                    const mapMod = (typeof MapModule !== 'undefined' ? MapModule : window.MapModule);
                    if (mapMod && mapMod.flyToMunicipality) {
                        mapMod.flyToMunicipality(muni);
                    }
                }
            });
        }

        const tipoChecklist = document.getElementById('tipo-checklist');
        if (tipoChecklist) {
            tipoChecklist.addEventListener('change', (e) => {
                const cb = e.target; if (cb.tagName !== 'INPUT') return;
                const v = cb.getAttribute('data-v');
                if (cb.checked) this.activeFilters.tipos.add(v); else this.activeFilters.tipos.delete(v);
                window.App.scheduleUpdate();
            });
        }

        // Búsqueda en tiempo real dentro del filtro de Municipios
        const muniSearch = document.getElementById('muni-search');
        if (muniSearch) {
            muniSearch.addEventListener('input', function () {
                const q = normEs(this.value.trim());
                document.querySelectorAll('#muni-checklist .check-row').forEach(row => {
                    const name = row.getAttribute('data-name') || '';
                    row.classList.toggle('hidden', Boolean(q && name.indexOf(q) === -1));
                });
            });
        }

        // Botones "Todos" / "Ninguno" por sección
        const vehiAllBtn = document.getElementById('vehi-all');
        if (vehiAllBtn) {
            vehiAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.vehiculos = new Set(this.fullSets.vehiculos);
                document.querySelectorAll('#vehi-checklist input').forEach(cb => cb.checked = true);
                window.App.scheduleUpdate();
            });
        }

        const vehiNoneBtn = document.getElementById('vehi-none');
        if (vehiNoneBtn) {
            vehiNoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.vehiculos = new Set();
                document.querySelectorAll('#vehi-checklist input').forEach(cb => cb.checked = false);
                window.App.scheduleUpdate();
            });
        }

        const muniAllBtn = document.getElementById('muni-all');
        if (muniAllBtn) {
            muniAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.municipios = new Set(this.fullSets.municipios);
                document.querySelectorAll('#muni-checklist input').forEach(cb => cb.checked = true);
                window.App.scheduleUpdate();
            });
        }
        const muniNoneBtn = document.getElementById('muni-none');
        if (muniNoneBtn) {
            muniNoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.municipios = new Set();
                document.querySelectorAll('#muni-checklist input').forEach(cb => cb.checked = false);
                window.App.scheduleUpdate();
            });
        }
        const tipoAllBtn = document.getElementById('tipo-all');
        if (tipoAllBtn) {
            tipoAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.tipos = new Set(this.fullSets.tipos);
                document.querySelectorAll('#tipo-checklist input').forEach(cb => cb.checked = true);
                window.App.scheduleUpdate();
            });
        }
        const tipoNoneBtn = document.getElementById('tipo-none');
        if (tipoNoneBtn) {
            tipoNoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activeFilters.tipos = new Set();
                document.querySelectorAll('#tipo-checklist input').forEach(cb => cb.checked = false);
                window.App.scheduleUpdate();
            });
        }

        // Función reutilizable para configurar controles deslizantes dobles (range sliders)
        const setupDualSlider = (minEl, maxEl, fillEl, minBound, maxBound, onChange) => {
            const update = () => {
                let a = +minEl.value, b = +maxEl.value;
                if (a > b) [a, b] = [b, a];
                const pctA = (a - minBound) / (maxBound - minBound) * 100;
                const pctB = (b - minBound) / (maxBound - minBound) * 100;
                fillEl.style.left = pctA + '%';
                fillEl.style.width = (pctB - pctA) + '%';
                onChange(a, b);
            };
            minEl.addEventListener('input', () => { if (+minEl.value > +maxEl.value) minEl.value = maxEl.value; update(); window.App.scheduleUpdate(); });
            maxEl.addEventListener('input', () => { if (+maxEl.value < +minEl.value) maxEl.value = minEl.value; update(); window.App.scheduleUpdate(); });
            update();
        };

        // Slider Doble de Años (2016 a 2026)
        setupDualSlider(document.getElementById('year-min'), document.getElementById('year-max'), document.getElementById('year-fill'), 2016, 2026, (a, b) => {
            this.activeFilters.yearMin = a; this.activeFilters.yearMax = b;
            const lbl = document.getElementById('year-label');
            if (lbl) lbl.textContent = a + ' – ' + b;
        });

        // Slider Doble de Horas (0 a 23 h)
        const hourMinEl = document.getElementById('hour-min');
        const hourMaxEl = document.getElementById('hour-max');
        const hourFillEl = document.getElementById('hour-fill');
        if (hourMinEl && hourMaxEl && hourFillEl) {
            setupDualSlider(hourMinEl, hourMaxEl, hourFillEl, 0, 23, (a, b) => {
                this.activeFilters.hourMin = a;
                this.activeFilters.hourMax = b;
                const rangeTag = document.getElementById('hour-range-tag');
                if (rangeTag) {
                    rangeTag.textContent = (a === 0 && b === 23) ? '00 – 23 h' : `${String(a).padStart(2, '0')} – ${String(b).padStart(2, '0')} h`;
                }
            });
        }

        // Fichas de Días de la Semana debajo de la gráfica
        const wkBox = document.getElementById('weekday-buttons-box');

        this.updateWkPresetsUI = () => {
            const s = this.activeFilters.weekdays;
            if (!wkBox) return;
            wkBox.querySelectorAll('.chip').forEach(chip => {
                const val = chip.getAttribute('data-wd');
                if (val === 'all') {
                    chip.classList.toggle('active', s.size === 7);
                } else {
                    const wd = +val;
                    chip.classList.toggle('active', s.has(wd));
                }
            });
        };

        if (wkBox) {
            wkBox.addEventListener('click', (e) => {
                const chip = e.target.closest('.chip');
                if (!chip) return;
                const val = chip.getAttribute('data-wd');
                const s = this.activeFilters.weekdays;

                if (val === 'all') {
                    this.activeFilters.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
                } else {
                    const wd = +val;
                    if (s.size === 7) {
                        s.clear();
                        s.add(wd);
                    } else if (s.size === 1 && s.has(wd)) {
                        for (let d = 0; d < 7; d++) s.add(d);
                    } else {
                        if (s.has(wd)) s.delete(wd);
                        else s.add(wd);
                    }
                }
                this.updateWkPresetsUI();
                window.App.scheduleUpdate();
            });
        }

        // Botón general "Reiniciar filtros" en la cabecera
        document.getElementById('btn-reset').addEventListener('click', () => {
            this.activeFilters.yearMin = 2016; this.activeFilters.yearMax = 2026;
            this.activeFilters.hourMin = 0; this.activeFilters.hourMax = 23;
            this.activeFilters.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
            this.activeFilters.severidad = 'todos';
            this.activeFilters.vehiculos = new Set(this.fullSets.vehiculos);
            this.activeFilters.municipios = new Set(this.fullSets.municipios);
            this.activeFilters.tipos = new Set(this.fullSets.tipos);
            this.activeFilters.climas = new Set(this.fullSets.climas);
            this.activeFilters.vias = new Set(this.fullSets.vias);
            this.activeFilters.superfs = new Set(this.fullSets.superfs);
            this.activeFilters.sexos = new Set(this.fullSets.sexos);

            window.App.selection = null;

            document.getElementById('year-min').value = 2016; document.getElementById('year-max').value = 2026;
            document.getElementById('year-min').dispatchEvent(new Event('input'));

            if (hourMinEl && hourMaxEl) {
                hourMinEl.value = 0; hourMaxEl.value = 23;
                hourMinEl.dispatchEvent(new Event('input'));
            }

            this.updateWkPresetsUI();
            document.querySelectorAll('#severity-chips .chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-v') === 'todos'));
            document.querySelectorAll('.chip[data-cat]').forEach(c => c.classList.add('active'));
            document.querySelectorAll('#muni-checklist input, #tipo-checklist input, #vehi-checklist input').forEach(cb => cb.checked = true);

            document.getElementById('tool-clear').click();
            window.App.scheduleUpdate();
        });

        // Botón "Capturar imagen" para exportar el Dashboard como PNG
        const btnExportImg = document.getElementById('btn-export-img');
        if (btnExportImg) {
            btnExportImg.addEventListener('click', async () => {
                const origText = btnExportImg.innerText;
                btnExportImg.innerText = 'Generando...';
                btnExportImg.disabled = true;

                try {
                    const target = document.querySelector('.app') || document.body;
                    const canvas = await html2canvas(target, {
                        scale: 1.5,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#10141a',
                        logging: false
                    });
                    const link = document.createElement('a');
                    link.download = `dashboard_accidentes_${new Date().toISOString().slice(0, 10)}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                } catch (err) {
                    console.error("Error al capturar la imagen del tablero:", err);
                    alert("Ocurrió un error al generar la imagen del tablero.");
                } finally {
                    btnExportImg.innerText = origText;
                    btnExportImg.disabled = false;
                }
            });
        }
        // Mobile Toggle para vista responsive
        const btnToggleFilters = document.getElementById('btn-toggle-filters');
        if (btnToggleFilters) {
            btnToggleFilters.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.toggle('collapsed');
            });
        }
    }
};

window.FiltersModule = FiltersModule;
