/**
 * ==============================================================================
 * ARCHIVO: js/charts.js
 * DESCRIPCIÓN: Módulo de renderizado y actualización de gráficos con Chart.js.
 * Administra las 6 gráficas interactivas y la lista de colonias del tablero.
 * - La gráfica que corre la animación mantiene su eje Y FIJO para ver el cursor en contexto.
 * - Las demás gráficas adaptan su escala DINÁMICAMENTE para aprovechar toda el área visual.
 * ==============================================================================
 */

const ChartsModule = {
    // Instancias guardadas de cada gráfico para permitir actualización sin re-crear el canvas
    trendChartInst: null,
    sevChartInst: null,
    tiposChartInst: null,
    vehiculosChartInst: null,
    hoursChartInst: null,
    weekdaysChartInst: null,

    // Variables base globales para los ejes fijos
    baselinesReady: false,
    baseHourMax: 4500,
    baseWeekdayMax: 11000,
    baseTrendTotalMax: 1000,
    baseTrendFatalMax: 25,

    /**
     * Configuración global de fuentes y colores para Chart.js
     */
    init() {
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.font.family = "'Inter',sans-serif";
        Chart.defaults.font.size = 11;
        Chart.defaults.borderColor = '#2a374c';
    },

    /**
     * Precalcula los máximos globales del conjunto de datos completo
     * para fijar el eje de la gráfica que corre la animación.
     */
    initBaselines() {
        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        if (!dataMod || !dataMod.allData || dataMod.allData.length === 0) return;

        // Horas
        const hCounts = new Array(24).fill(0);
        dataMod.allData.forEach(d => {
            const h = Math.floor(Number(d.hora_redondeada));
            if (!isNaN(h) && h >= 0 && h < 24) hCounts[h]++;
        });
        this.baseHourMax = Math.ceil(Math.max(...hCounts) * 1.08);

        // Días
        const wCounts = new Array(7).fill(0);
        dataMod.allData.forEach(d => {
            if (d.wkIdx >= 0 && d.wkIdx < 7) wCounts[d.wkIdx]++;
        });
        this.baseWeekdayMax = Math.ceil(Math.max(...wCounts) * 1.08);

        // Tendencia
        const mTotals = new Map();
        const mFatals = new Map();
        dataMod.allData.forEach(d => {
            if (d.monthKey) {
                if (d.sevVal !== 2) mTotals.set(d.monthKey, (mTotals.get(d.monthKey) || 0) + 1);
                if (d.sevVal === 2) {
                    const fCount = (d.numero_personas_fallecidas && d.numero_personas_fallecidas > 0) ? d.numero_personas_fallecidas : 1;
                    mFatals.set(d.monthKey, (mFatals.get(d.monthKey) || 0) + fCount);
                }
            }
        });
        const maxTot = Math.max(1, ...Array.from(mTotals.values()));
        const maxFat = Math.max(1, ...Array.from(mFatals.values()));
        this.baseTrendTotalMax = Math.ceil(maxTot * 1.08);
        this.baseTrendFatalMax = Math.ceil(maxFat * 1.08);

        this.baselinesReady = true;
    },

    /**
     * Actualiza todas las gráficas en un solo ciclo
     */
    updateAll() {
        if (!this.baselinesReady) this.initBaselines();
        this.renderTrend();
        this.renderVehiculos();
        this.renderSeverity();
        this.renderTipos();
        this.renderTopColonias();
        this.renderHoursChart();
        this.renderWeekdaysChart();
        this.renderRiskMatrix();
    },

    /**
     * Gráfica de Barras Horizontales: Tipo de Vehículo con Escala Adaptable
     */
    renderVehiculos() {
        const el = document.getElementById('chart-vehiculos');
        if (!el) return;

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const vehiculos = dataMod.getTopVehiculos();
        const labels = vehiculos.map(v => v[0].length > 35 ? v[0].slice(0, 33) + '…' : v[0]);
        const data = vehiculos.map(v => v[1]);

        if (this.vehiculosChartInst) {
            this.vehiculosChartInst.data.labels = labels;
            this.vehiculosChartInst.data.datasets[0].data = data;
            this.vehiculosChartInst.update('none');
            return;
        }

        const ctx = el.getContext('2d');
        this.vehiculosChartInst = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: '#00e676',
                    borderRadius: 3
                }]
            },
            options: {
                animation: false,
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: '#1b2331' }, beginAtZero: true },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    },

    /**
     * Gráfica de Líneas: Tendencia Mensual (Accidentes Totales vs Defunciones)
     * Fija en animación de meses, adaptable en otras animaciones
     */
    renderTrend() {
        const tagEl = document.getElementById('trend-range-tag');
        const resetBox = document.getElementById('trend-reset-box');
        const yMin = FiltersModule.activeFilters ? FiltersModule.activeFilters.yearMin : 2016;
        const yMax = FiltersModule.activeFilters ? FiltersModule.activeFilters.yearMax : 2026;
        const isYearFiltered = (yMin > 2016 || yMax < 2026);

        if (tagEl) {
            tagEl.textContent = (yMin === yMax) ? `${yMin}` : `${yMin}–${yMax}`;
        }

        if (resetBox) {
            if (isYearFiltered) {
                const numYears = (yMax - yMin + 1);
                resetBox.innerHTML = ` <span style="color:var(--niebla-2);">(${numYears}/11 sel.)</span> <a href="#" id="reset-trend-btn" style="color:var(--cono-naranja);margin-left:4px;text-decoration:underline;">↺ Todos</a>`;
                const btn = document.getElementById('reset-trend-btn');
                if (btn) {
                    btn.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        const minEl = document.getElementById('year-min');
                        const maxEl = document.getElementById('year-max');
                        if (minEl && maxEl) {
                            minEl.value = 2016; maxEl.value = 2026;
                            minEl.dispatchEvent(new Event('input'));
                        }
                    });
                }
            } else {
                resetBox.innerHTML = '';
            }
        }

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const targetMonthKey = (FiltersModule.activeFilters ? FiltersModule.activeFilters.targetMonthKey : null);
        const isMonthAnimation = (window.PlayerModule && window.PlayerModule.isPlaying && window.PlayerModule.mode === 'month') || (targetMonthKey !== undefined && targetMonthKey !== null);

        let chartData;
        if (isMonthAnimation && dataMod.groupByMonthProgressive) {
            chartData = dataMod.groupByMonthProgressive(targetMonthKey);
        } else {
            chartData = dataMod.groupByMonthAndFatalities();
        }

        const validTotals = chartData.totals.filter(v => v !== null && v !== undefined);
        const maxTot = validTotals.length > 0 ? Math.max(1, ...validTotals) : 1;
        const contextTrendTotMax = Math.max(2, Math.ceil(maxTot * 1.15));

        const validFatals = chartData.fatals.filter(v => v !== null && v !== undefined);
        const maxFat = validFatals.length > 0 ? Math.max(1, ...validFatals) : 1;
        const contextTrendFatMax = Math.max(2, Math.ceil(maxFat * 1.15));

        const activeIdx = (chartData.activeIdx !== undefined ? chartData.activeIdx : -1);
        const pointRadiusTot = isMonthAnimation
            ? (ctx) => (ctx.dataIndex === activeIdx ? 6 : 0)
            : 0;
        const pointRadiusFat = isMonthAnimation
            ? (ctx) => (ctx.dataIndex === activeIdx ? 5 : 0)
            : 0;

        if (this.trendChartInst) {
            this.trendChartInst.data.labels = chartData.labels;
            this.trendChartInst.data.datasets[0].data = chartData.totals;
            this.trendChartInst.data.datasets[0].pointRadius = pointRadiusTot;
            this.trendChartInst.data.datasets[0].pointBackgroundColor = '#ffd600';
            this.trendChartInst.data.datasets[1].data = chartData.fatals;
            this.trendChartInst.data.datasets[1].pointRadius = pointRadiusFat;
            this.trendChartInst.data.datasets[1].pointBackgroundColor = '#ff1744';

            if (isMonthAnimation) {
                this.trendChartInst.options.scales.y.max = contextTrendTotMax;
                this.trendChartInst.options.scales.y2.max = contextTrendFatMax;
            } else {
                delete this.trendChartInst.options.scales.y.max;
                delete this.trendChartInst.options.scales.y2.max;
            }

            this.trendChartInst.update('none');
            return;
        }

        const ctx = document.getElementById('chart-trend').getContext('2d');
        this.trendChartInst = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        label: 'Accidentes Totales',
                        data: chartData.totals,
                        borderColor: '#ffd600',
                        backgroundColor: 'rgba(255,214,0,.14)',
                        fill: true,
                        tension: 0.25,
                        pointRadius: pointRadiusTot,
                        pointBackgroundColor: '#ffd600',
                        borderWidth: 2,
                        spanGaps: false
                    },
                    {
                        label: 'Defunciones',
                        data: chartData.fatals,
                        borderColor: '#ff1744',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.25,
                        pointRadius: pointRadiusFat,
                        pointBackgroundColor: '#ff1744',
                        borderWidth: 2,
                        yAxisID: 'y2',
                        spanGaps: false
                    }
                ]
            },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: true, labels: { boxWidth: 10, padding: 10 } } },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        max: isMonthAnimation ? contextTrendTotMax : undefined,
                        grid: { color: '#1b2331' },
                        title: { display: true, text: 'Accidentes Totales', color: '#ffd600', font: { size: 10, weight: '500' } },
                        ticks: { color: '#94a3b8' }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        max: isMonthAnimation ? contextTrendFatMax : undefined,
                        grid: { display: false },
                        title: { display: true, text: 'Defunciones', color: '#ff1744', font: { size: 10, weight: '500' } },
                        ticks: { color: '#ff1744' }
                    }
                }
            }
        });
    },

    /**
     * Gráfica de Dona: Severidad de Accidentes (Solo daños, Heridos, Fatal)
     */
    renderSeverity() {
        let soloDanos = 0, conLes = 0, fatal = 0;
        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const len = dataMod.filteredData.length;
        for (let i = 0; i < len; i++) {
            const s = dataMod.filteredData[i].sevVal;
            if (s === 2) fatal++;
            else if (s === 1) conLes++;
            else soloDanos++;
        }

        if (this.sevChartInst) {
            this.sevChartInst.data.datasets[0].data = [soloDanos, conLes, fatal];
            this.sevChartInst.update('none');
            return;
        }

        const ctx = document.getElementById('chart-severidad').getContext('2d');
        this.sevChartInst = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Solo daños', 'Con heridos', 'Fatal'],
                datasets: [{
                    data: [soloDanos, conLes, fatal],
                    backgroundColor: ['#00e676', '#ffd600', '#ff1744'],
                    borderColor: '#131923',
                    borderWidth: 2
                }]
            },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false, cutout: '62%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 10.5 } } } }
            }
        });
    },

    /**
     * Gráfica de Barras: Top Tipos de Incidente Vial con Escala Adaptable
     * Abreviación de "COLISIÓN" a "C." para optimizar espacio
     */
    renderTipos() {
        const el = document.getElementById('chart-tipos');
        if (!el) return;

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const tipos = dataMod.getTopTipos();
        const formatTipo = (str) => {
            let s = str.replace(/COLISI[OÓ]N/gi, 'C.').trim();
            return s.length > 30 ? s.slice(0, 28) + '…' : s;
        };
        const labels = tipos.map(t => formatTipo(t[0]));
        const data = tipos.map(t => t[1]);

        if (this.tiposChartInst) {
            this.tiposChartInst.data.labels = labels;
            this.tiposChartInst.data.datasets[0].data = data;
            this.tiposChartInst.update('none');
            return;
        }

        const ctx = document.getElementById('chart-tipos').getContext('2d');
        this.tiposChartInst = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: '#ff6a00',
                    borderRadius: 3
                }]
            },
            options: {
                animation: false,
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const idx = items[0].dataIndex;
                                return (tipos[idx] && tipos[idx][0]) ? tipos[idx][0] : items[0].label;
                            },
                            label: (item) => `Accidentes: ${item.raw.toLocaleString('es-MX')}`
                        }
                    }
                },
                scales: {
                    x: { grid: { color: '#1b2331' }, beginAtZero: true },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    },

    /**
     * Renderizado HTML de la lista desplazable Top Colonias
     */
    renderTopColonias() {
        const container = document.getElementById('top-colonias');
        if (!container) return;

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const top = dataMod.getTopColonias();

        if (top.length === 0) {
            container.innerHTML = '<p style="color:var(--niebla-2);font-size:11.5px;">Sin datos para esta selección.</p>';
            return;
        }

        const maxVal = top[0][1] || 1;
        let html = '';
        top.forEach(([name, count]) => {
            const pct = Math.round((count / maxVal) * 100);
            html += `
            <div class="top-row">
                <span class="name" title="${name}">${name}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
                <span class="val">${count.toLocaleString('es-MX')}</span>
            </div>`;
        });
        container.innerHTML = html;
    },

    /**
     * Gráfica de Barras: Accidentes por Hora (00 a 23 h)
     * - Si la animación por Horas está activa o el usuario filtró por horas:
     *   Mantiene su eje Y FIJO en el tope global y muestra las 24 barras con la activa resaltada.
     * - Si la animación por Días/Meses está activa:
     *   Adapta su eje Y DINÁMICAMENTE para mostrar la curva con toda su altura y detalle.
     */
    renderHoursChart() {
        const el = document.getElementById('chart-hours');
        if (!el) return;
        if (!this.baselinesReady) this.initBaselines();

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const hMin = FiltersModule.activeFilters.hourMin !== undefined ? FiltersModule.activeFilters.hourMin : 0;
        const hMax = FiltersModule.activeFilters.hourMax !== undefined ? FiltersModule.activeFilters.hourMax : 23;
        const isHourFiltered = (hMin > 0 || hMax < 23);
        const isHourMode = (window.PlayerModule && window.PlayerModule.isPlaying && window.PlayerModule.mode === 'hour') || isHourFiltered;

        // Si se anima o filtra por hora, obtener las 24 barras de contexto
        const clockData = isHourMode && dataMod.getClockDataExcludingHour
            ? dataMod.getClockDataExcludingHour()
            : dataMod.getClockData();

        const counts = clockData.counts;
        const maxC = Math.max(1, ...counts);
        const peakHour = counts.indexOf(maxC);
        const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
        const contextHourMax = Math.max(2, Math.ceil(maxC * 1.15));

        const bgColors = counts.map((c, i) => {
            if (isHourFiltered) {
                if (i >= hMin && i <= hMax) return '#ff1744';
                return 'rgba(148, 163, 184, 0.22)';
            }
            if (i === peakHour) return '#ff1744';
            if (c >= maxC * 0.75) return '#ffd600';
            return '#00b0ff';
        });

        if (this.hoursChartInst) {
            this.hoursChartInst.data.datasets[0].data = counts;
            this.hoursChartInst.data.datasets[0].backgroundColor = bgColors;

            // Fijar eje Y al volumen del contexto activo si está en modo Horas; adaptar dinámicamente en modo Días/Meses
            if (isHourMode) {
                this.hoursChartInst.options.scales.y.max = contextHourMax;
            } else {
                delete this.hoursChartInst.options.scales.y.max;
            }

            this.hoursChartInst.update('none');
        } else {
            const ctx = el.getContext('2d');
            this.hoursChartInst = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Accidentes',
                        data: counts,
                        backgroundColor: bgColors,
                        borderRadius: 2
                    }]
                },
                options: {
                    animation: false,
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => `Hora ${items[0].label}:00 h`,
                                label: (item) => `Accidentes: ${item.raw.toLocaleString('es-MX')}`
                            }
                        }
                    },
                    onClick: (e, activeElements) => {
                        if (activeElements.length > 0) {
                            const h = activeElements[0].index;
                            const minEl = document.getElementById('hour-min');
                            const maxEl = document.getElementById('hour-max');
                            const curMin = (FiltersModule.activeFilters && FiltersModule.activeFilters.hourMin !== undefined) ? FiltersModule.activeFilters.hourMin : 0;
                            const curMax = (FiltersModule.activeFilters && FiltersModule.activeFilters.hourMax !== undefined) ? FiltersModule.activeFilters.hourMax : 23;

                            if (curMin === h && curMax === h) {
                                if (minEl && maxEl) {
                                    minEl.value = 0; maxEl.value = 23;
                                    minEl.dispatchEvent(new Event('input'));
                                }
                            } else {
                                if (minEl && maxEl) {
                                    minEl.value = h; maxEl.value = h;
                                    minEl.dispatchEvent(new Event('input'));
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } },
                        y: {
                            grid: { color: '#1b2331' },
                            beginAtZero: true,
                            max: isHourMode ? contextHourMax : undefined,
                            ticks: { font: { size: 9.5 } }
                        }
                    }
                }
            });
        }

        const noteEl = document.getElementById('peak-hour-note');
        if (noteEl) {
            if (isHourFiltered) {
                const count = (hMax - hMin + 1);
                noteEl.innerHTML = `${count}/24 sel. <a href="#" id="reset-hour-btn" style="color:var(--cono-naranja);margin-left:4px;text-decoration:underline;">↺ Todos</a>`;
                const btn = document.getElementById('reset-hour-btn');
                if (btn) {
                    btn.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        const minEl = document.getElementById('hour-min');
                        const maxEl = document.getElementById('hour-max');
                        if (minEl && maxEl) {
                            minEl.value = 0; maxEl.value = 23;
                            minEl.dispatchEvent(new Event('input'));
                        }
                    });
                }
            } else {
                noteEl.innerHTML = `Pico: <b>${String(peakHour).padStart(2, '0')}:00 h</b> (${maxC.toLocaleString('es-MX')})`;
            }
        }
    },

    /**
     * Gráfica de Barras: Día de la Semana (Lunes a Domingo)
     * - Si la animación por Días está activa o el usuario filtró días:
     *   Mantiene su eje Y FIJO en el tope del municipio/filtro actual y muestra los 7 días con el activo resaltado.
     * - Si la animación por Horas/Meses está activa:
     *   Adapta su eje Y DINÁMICAMENTE para mostrar las barras con toda su altura y detalle.
     */
    renderWeekdaysChart() {
        const el = document.getElementById('chart-weekdays');
        if (!el) return;
        if (!this.baselinesReady) this.initBaselines();

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        const activeDays = FiltersModule.activeFilters.weekdays || new Set([0, 1, 2, 3, 4, 5, 6]);
        const isFiltered = activeDays.size < 7;
        const isWeekdayMode = (window.PlayerModule && window.PlayerModule.isPlaying && window.PlayerModule.mode === 'weekday') || isFiltered;

        // Si se anima o filtra por día de la semana, obtener los 7 días de contexto
        const counts = isWeekdayMode && dataMod.getWeekdayDataExcludingWeekday
            ? dataMod.getWeekdayDataExcludingWeekday()
            : dataMod.getWeekdayData();

        const wkLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const order = [1, 2, 3, 4, 5, 6, 0]; // Orden de despliegue: Lun a Dom
        const orderedLabels = order.map(i => wkLabels[i]);
        const orderedCounts = order.map(i => counts[i]);
        const maxWk = Math.max(1, ...orderedCounts);
        const contextWeekdayMax = Math.max(2, Math.ceil(maxWk * 1.15));

        const bgColors = order.map(wd => {
            if (isFiltered && !activeDays.has(wd)) return 'rgba(148, 163, 184, 0.22)';
            return '#ff6a00';
        });

        if (this.weekdaysChartInst) {
            this.weekdaysChartInst.data.datasets[0].data = orderedCounts;
            this.weekdaysChartInst.data.datasets[0].backgroundColor = bgColors;

            // Fijar eje Y al volumen del contexto activo si está en modo Días; adaptar dinámicamente en modo Horas/Meses
            if (isWeekdayMode) {
                this.weekdaysChartInst.options.scales.y.max = contextWeekdayMax;
            } else {
                delete this.weekdaysChartInst.options.scales.y.max;
            }

            this.weekdaysChartInst.update('none');
        } else {
            const ctx = el.getContext('2d');
            this.weekdaysChartInst = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: orderedLabels,
                    datasets: [{
                        label: 'Accidentes',
                        data: orderedCounts,
                        backgroundColor: bgColors,
                        borderRadius: 3
                    }]
                },
                options: {
                    animation: false,
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (item) => `Accidentes: ${item.raw.toLocaleString('es-MX')}`
                            }
                        }
                    },
                    onClick: (e, activeElements) => {
                        if (activeElements.length > 0) {
                            const idx = activeElements[0].index;
                            const wd = order[idx];
                            const wset = FiltersModule.activeFilters.weekdays;

                            if (wset.size === 7) {
                                wset.clear();
                                wset.add(wd);
                            } else if (wset.size === 1 && wset.has(wd)) {
                                for (let d = 0; d < 7; d++) wset.add(d);
                            } else {
                                if (wset.has(wd)) wset.delete(wd);
                                else wset.add(wd);
                            }
                            if (FiltersModule.updateWkPresetsUI) FiltersModule.updateWkPresetsUI();
                            window.App.scheduleUpdate();
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: {
                            grid: { color: '#1b2331' },
                            beginAtZero: true,
                            max: isWeekdayMode ? this.baseWeekdayMax : undefined,
                            ticks: { font: { size: 9.5 } }
                        }
                    }
                }
            });
        }

        const tagEl = document.getElementById('weekday-range-tag');
        if (tagEl) {
            if (activeDays.size === 7) tagEl.textContent = 'Lun – Dom';
            else if (activeDays.size === 5 && [1, 2, 3, 4, 5].every(d => activeDays.has(d))) tagEl.textContent = 'Lun – Vie';
            else if (activeDays.size === 2 && activeDays.has(6) && activeDays.has(0)) tagEl.textContent = 'Sáb – Dom';
            else tagEl.textContent = `${activeDays.size}/7 días`;
        }

        const wkFullNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const maxWkCount = Math.max(1, ...counts);
        const peakDayIdx = counts.indexOf(maxWkCount);
        const peakDayName = wkFullNames[peakDayIdx] || '';

        const noteEl = document.getElementById('weekday-note');
        if (noteEl) {
            if (isFiltered) {
                noteEl.innerHTML = `${activeDays.size}/7 sel. <a href="#" id="reset-wk-btn" style="color:var(--ambar);margin-left:4px;text-decoration:underline;">↺ Todos</a>`;
                const btn = document.getElementById('reset-wk-btn');
                if (btn) {
                    btn.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        for (let d = 0; d < 7; d++) activeDays.add(d);
                        if (FiltersModule.updateWkPresetsUI) FiltersModule.updateWkPresetsUI();
                        window.App.scheduleUpdate();
                    });
                }
            } else {
                noteEl.innerHTML = `Pico: <b>${peakDayName}</b> (${maxWkCount.toLocaleString('es-MX')})`;
            }
        }
    },

    /**
     * Matriz de Riesgo Temporal (7 Días de la semana × 24 Horas)
     */
    renderRiskMatrix() {
        const container = document.getElementById('risk-matrix-container');
        if (!container) return;

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : window.DataModule);
        if (!dataMod || !dataMod.getRiskMatrixData) return;

        const { matrix, maxCount, dayNames, peakDay, peakHour, peakCount, peakFatals } = dataMod.getRiskMatrixData();

        // Actualizar el texto del pico crítico en la cabecera
        const peakValEl = document.getElementById('matrix-peak-val');
        if (peakValEl) {
            if (peakCount > 0 && peakHour >= 0) {
                const hStr = `${String(peakHour).padStart(2, '0')}:00 h`;
                const fatStr = peakFatals > 0 ? ` (${peakFatals.toLocaleString('es-MX')} fatales)` : '';
                peakValEl.innerHTML = `${peakDay} ${hStr} &nbsp;<span style="color:var(--senial-amarillo);font-weight:600;">[${peakCount.toLocaleString('es-MX')} siniestros${fatStr}]</span>`;
            } else {
                peakValEl.textContent = 'Sin datos';
            }
        }

        // Generar encabezado de horas con todas las horas (00 a 23)
        let html = '<div class="matrix-grid-wrap">';
        html += '<div class="matrix-header-row"><div class="matrix-day-label-head"></div>';
        for (let h = 0; h < 24; h++) {
            const hText = String(h).padStart(2, '0');
            html += `<div class="matrix-hour-col-head" title="${hText}:00 h">${hText}</div>`;
        }
        html += '</div>';

        // Generar las 7 filas (Lunes a Domingo)
        const dayShort = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const dayIdxMap = [1, 2, 3, 4, 5, 6, 0]; // row 0=Lun(1), 1=Mar(2), ..., 6=Dom(0)

        for (let r = 0; r < 7; r++) {
            html += `<div class="matrix-row">`;
            html += `<div class="matrix-day-label">${dayShort[r]}</div>`;

            for (let c = 0; c < 24; c++) {
                const cell = matrix[r][c];
                const count = cell.count;
                const fatals = cell.fatals;
                const ratio = maxCount > 0 ? (count / maxCount) : 0;

                // Color según intensidad térmica
                let bg = 'rgba(255, 255, 255, 0.04)';
                let glow = '';
                if (count > 0) {
                    if (ratio < 0.20) {
                        bg = `rgba(0, 230, 118, ${0.30 + ratio * 1.5})`;
                    } else if (ratio < 0.45) {
                        bg = `rgba(255, 214, 0, ${0.45 + ratio * 0.8})`;
                    } else if (ratio < 0.75) {
                        bg = `rgba(255, 106, 0, ${0.65 + ratio * 0.4})`;
                    } else {
                        bg = `rgba(255, 23, 68, ${0.85 + ratio * 0.15})`;
                        glow = 'box-shadow: 0 0 6px rgba(255, 23, 68, 0.5);';
                    }
                }

                const tooltip = `${dayNames[r]} a las ${String(c).padStart(2, '0')}:00 h\n• Siniestros: ${count.toLocaleString('es-MX')}${fatals > 0 ? `\n• Fallecidos: ${fatals.toLocaleString('es-MX')}` : ''}`;

                html += `<div class="matrix-cell" style="background:${bg};${glow}" title="${tooltip}" data-day-idx="${dayIdxMap[r]}" data-hour="${c}"></div>`;
            }

            html += `</div>`;
        }

        html += '</div>';
        container.innerHTML = html;
    }
};

window.ChartsModule = ChartsModule;
