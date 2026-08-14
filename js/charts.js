/**
 * ==============================================================================
 * ARCHIVO: js/charts.js
 * DESCRIPCIÓN: Módulo de renderizado y actualización de gráficos con Chart.js.
 * Administra las 6 gráficas interactivos y la lista de colonias del tablero.
 * ==============================================================================
 */

const ChartsModule = {
    // Instancias guardadas de cada gráfico para permitir actualización sin re-crear el canvas (sin parpadeo ni lag)
    trendChartInst: null,
    sevChartInst: null,
    tiposChartInst: null,
    vehiculosChartInst: null,
    hoursChartInst: null,
    weekdaysChartInst: null,

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
     * Actualiza todas las gráficas en un solo ciclo
     */
    updateAll() {
        this.renderTrend();
        this.renderVehiculos();
        this.renderSeverity();
        this.renderTipos();
        this.renderTopColonias();
        this.renderHoursChart();
        this.renderWeekdaysChart();
    },

    /**
     * Gráfica de Barras Horizontales: Tipo de Vehículo
     */
    renderVehiculos() {
        const el = document.getElementById('chart-vehiculos');
        if (!el) return;
        const vehiculos = DataModule.getTopVehiculos();
        const labels = vehiculos.map(v => v[0].length > 35 ? v[0].slice(0, 33) + '…' : v[0]);
        const data = vehiculos.map(v => v[1]);

        // Si la gráfica ya existe, solo actualizamos los datos sin re-crearla
        if (this.vehiculosChartInst) {
            this.vehiculosChartInst.data.labels = labels;
            this.vehiculosChartInst.data.datasets[0].data = data;
            this.vehiculosChartInst.update('none'); // 'none' deshabilita animaciones pesadas en arrastre
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
     */
    renderTrend() {
        const tagEl = document.getElementById('trend-range-tag');
        const resetBox = document.getElementById('trend-reset-box');
        const yMin = FiltersModule.activeFilters ? FiltersModule.activeFilters.yearMin : 2016;
        const yMax = FiltersModule.activeFilters ? FiltersModule.activeFilters.yearMax : 2026;
        const isYearFiltered = (yMin > 2016 || yMax < 2026);

        // Actualizar etiqueta del título con el periodo activo (ej: 2018–2022)
        if (tagEl) {
            tagEl.textContent = (yMin === yMax) ? `${yMin}` : `${yMin}–${yMax}`;
        }

        // Mostrar botón de reinicio "↺ Todos" si el periodo está filtrado
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

        const chartData = DataModule.groupByMonthAndFatalities();

        // Actualización in-place si la gráfica ya existe
        if (this.trendChartInst) {
            this.trendChartInst.data.labels = chartData.labels;
            this.trendChartInst.data.datasets[0].data = chartData.totals;
            this.trendChartInst.data.datasets[1].data = chartData.fatals;
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
                        pointRadius: 0,
                        borderWidth: 2
                    },
                    {
                        label: 'Defunciones',
                        data: chartData.fatals,
                        borderColor: '#ff1744',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.25,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y2'
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
                        grid: { color: '#1b2331' },
                        title: { display: true, text: 'Accidentes Totales', color: '#ffd600', font: { size: 10, weight: '500' } },
                        ticks: { color: '#94a3b8' }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
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
        const len = DataModule.filteredData.length;
        for (let i = 0; i < len; i++) {
            const s = DataModule.filteredData[i].sevVal;
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
     * Gráfica de Barras: Top Tipos de Incidente Vial
     */
    renderTipos() {
        const tipos = DataModule.getTopTipos();
        const labels = tipos.map(t => t[0].length > 35 ? t[0].slice(0, 33) + '…' : t[0]);
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
                plugins: { legend: { display: false } },
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
        const top = DataModule.getTopColonias();

        if (top.length === 0) {
            container.innerHTML = '<p style="color:var(--niebla-2);font-size:11.5px;">Sin datos para esta selección.</p>';
            return;
        }

        const maxVal = top[0][1];
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
     * Gráfica de Barras: Accidentes por Hora (00 a 23 h) con indicador de pico y filtro por clic
     */
    renderHoursChart() {
        const el = document.getElementById('chart-hours');
        if (!el) return;
        const { counts } = DataModule.getClockData();
        const maxC = Math.max(1, ...counts);
        const peakHour = counts.indexOf(maxC);
        const hMin = FiltersModule.activeFilters.hourMin !== undefined ? FiltersModule.activeFilters.hourMin : 0;
        const hMax = FiltersModule.activeFilters.hourMax !== undefined ? FiltersModule.activeFilters.hourMax : 23;
        const isHourFiltered = (hMin > 0 || hMax < 23);

        const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

        // Resaltar barras según hora pico o rango seleccionado por el usuario
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
                    // Al hacer clic en una barra se selecciona esa hora en particular
                    onClick: (e, activeElements) => {
                        if (activeElements.length > 0) {
                            const h = activeElements[0].index;
                            const minEl = document.getElementById('hour-min');
                            const maxEl = document.getElementById('hour-max');

                            if (hMin === h && hMax === h) {
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
                        y: { grid: { color: '#1b2331' }, beginAtZero: true, ticks: { font: { size: 9.5 } } }
                    }
                }
            });
        }

        // Actualizar la nota de hora pico o contador con botón "↺ Todos"
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
     */
    renderWeekdaysChart() {
        const el = document.getElementById('chart-weekdays');
        if (!el) return;
        const counts = DataModule.getWeekdayData();
        const wkLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const order = [1, 2, 3, 4, 5, 6, 0]; // Orden de despliegue: Lun a Dom
        const orderedLabels = order.map(i => wkLabels[i]);
        const orderedCounts = order.map(i => counts[i]);
        const activeDays = FiltersModule.activeFilters.weekdays || new Set([0, 1, 2, 3, 4, 5, 6]);
        const isFiltered = activeDays.size < 7;

        const bgColors = order.map(wd => {
            if (isFiltered && !activeDays.has(wd)) return 'rgba(148, 163, 184, 0.22)';
            return '#ff6a00';
        });

        if (this.weekdaysChartInst) {
            this.weekdaysChartInst.data.datasets[0].data = orderedCounts;
            this.weekdaysChartInst.data.datasets[0].backgroundColor = bgColors;
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
                    // Al hacer clic en una barra se conmuta ese día de la semana
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
                        y: { grid: { color: '#1b2331' }, beginAtZero: true, ticks: { font: { size: 9.5 } } }
                    }
                }
            });
        }

        // Actualizar la etiqueta del periodo activo
        const tagEl = document.getElementById('weekday-range-tag');
        if (tagEl) {
            if (activeDays.size === 7) tagEl.textContent = 'Dom – Sáb';
            else if (activeDays.size === 5 && [1, 2, 3, 4, 5].every(d => activeDays.has(d))) tagEl.textContent = 'Lun – Vie';
            else if (activeDays.size === 2 && activeDays.has(6) && activeDays.has(0)) tagEl.textContent = 'Sáb – Dom';
            else tagEl.textContent = `${activeDays.size}/7 días`;
        }

        // Nombre del día con mayor concentración de accidentes
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
    }
};
