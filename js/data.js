/**
 * ==============================================================================
 * ARCHIVO: js/data.js
 * DESCRIPCIÓN: Módulo de procesamiento y filtrado de datos.
 * Carga los archivos CSV, precalcula campos para velocidad ultra rápida
 * y realiza los filtros espacial y por atributos.
 * ==============================================================================
 */

/**
 * Normaliza y estandariza los nombres de tipos de vehículo provenientes del CSV.
 * @param {string} v - Nombre crudo del vehículo
 * @returns {string} Nombre limpio y legible
 */
const normVehicle = (v) => {
    if (!v) return 'SIN DATOS';
    let s = String(v).trim().toUpperCase().replace(/_/g, ' ');
    if (s === 'CAMIONETA CARGA') s = 'CAMIONETA DE CARGA';
    if (s === 'CAMIONETA PASAJEROS') s = 'CAMIONETA DE PASAJEROS';
    if (s === 'CAMION CARGA') s = 'CAMIÓN DE CARGA';
    if (s === 'CAMION PASAJEROS') s = 'CAMIÓN DE PASAJEROS';
    if (s === 'VEHICULO TRABAJO') s = 'VEHÍCULO DE TRABAJO';
    if (s === 'SUV VAGONETA') s = 'SUV / VAGONETA';
    if (s === 'PICK UP') s = 'PICK-UP';
    return s;
};

const DataModule = {
    // Registros totales cargados desde el CSV con coordenadas válidas
    allData: [],

    // Registros que cumplen con todos los filtros activos actualmente
    filteredData: [],

    /**
     * Carga y cruza los archivos CSV (accidentes_limpio.csv y vehiculos.csv).
     * Precalcula propiedades para acelerar el filtrado en tiempo real.
     */
    async loadData() {
        return new Promise((resolve, reject) => {
            let accidentesData = null;
            let vehiculosMap = new Map();
            let vehiculosLoaded = false;

            // Intenta finalizar la carga una vez que ambos CSV han sido procesados
            const tryFinish = () => {
                if (accidentesData && vehiculosLoaded) {
                    // Filtrar únicamente accidentes con latitud y longitud válidas
                    this.allData = accidentesData.filter(d => d && d.lat && d.lon);

                    // Mapeos para días de la semana y orden numérico de meses
                    const wkMap = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6 };
                    const mOrder = { 'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12 };

                    // Precalculo de propiedades en cada registro para evitar procesamiento repetido
                    this.allData.forEach((d, index) => {
                        d._id = index;

                        // Severidad: 2 = Fatal, 1 = Con heridos, 0 = Solo daños
                        d.sevVal = (d.numero_personas_fallecidas > 0) ? 2 : ((d.numero_personas_lesionadas > 0) ? 1 : 0);

                        // Índice de día de la semana (0 = Dom, 1 = Lun, ..., 6 = Sáb)
                        let ds = d.dia_semana ? String(d.dia_semana).toLowerCase().trim() : '';
                        d.wkIdx = wkMap[ds] !== undefined ? wkMap[ds] : -1;

                        // Valores en texto limpio pre-procesados
                        d.sexoStr = (!d.sexo_presunto_responsable || String(d.sexo_presunto_responsable).trim() === '' || String(d.sexo_presunto_responsable) === 'null') ? 'SIN DATOS' : String(d.sexo_presunto_responsable).trim();
                        d.sexo_presunto_responsable = d.sexoStr;

                        d.climaStr = (!d.condiciones_climaticas || String(d.condiciones_climaticas).trim() === '' || String(d.condiciones_climaticas) === 'null') ? 'SIN DATOS' : String(d.condiciones_climaticas).trim();
                        d.condiciones_climaticas = d.climaStr;

                        d.viaStr = (!d.condiciones_via || String(d.condiciones_via).trim() === '' || String(d.condiciones_via) === 'null') ? 'SIN DATOS' : String(d.condiciones_via).trim();
                        d.condiciones_via = d.viaStr;

                        d.superfStr = (!d.superficie_ocurrencia || String(d.superficie_ocurrencia).trim() === '' || String(d.superficie_ocurrencia) === 'null') ? 'SIN DATOS' : String(d.superficie_ocurrencia).trim();
                        d.superficie_ocurrencia = d.superfStr;

                        d.muniStr = String(d.municipio !== undefined && d.municipio !== null ? d.municipio : '');
                        d.tipoStr = String(d.tipo_incidente_vial !== undefined && d.tipo_incidente_vial !== null ? d.tipo_incidente_vial : '');

                        // Cruzar con la lista de vehículos involucrados por id_accidente
                        const idStr = String(d.id_accidente);
                        const vSet = vehiculosMap.get(idStr);
                        d.vehiculos = vSet && vSet.size > 0 ? Array.from(vSet) : ['SIN DATOS'];

                        // Clave numérica AAAAMM para la tendencia mensual (ejemplo: 202305 para Mayo 2023)
                        if (d.anio_origen && d.mes) {
                            const mesStr = String(d.mes).toLowerCase().trim();
                            const mNum = mOrder[mesStr] || 0;
                            d.monthKey = d.anio_origen * 100 + mNum;
                        } else {
                            d.monthKey = 0;
                        }

                        // Colonia limpia descartando "SIN DATO" o valores nulos
                        const colRaw = String(d.colonia || '').trim();
                        const colUpper = colRaw.toUpperCase();
                        if (colRaw && colUpper !== 'SIN DATO' && colUpper !== 'SIN DATOS' && colUpper !== 'NULL') {
                            d.coloniaClean = colRaw;
                        } else {
                            d.coloniaClean = null;
                        }
                    });

                    this.filteredData = [...this.allData];
                    console.log(`Base cargada correctamente: ${this.allData.length} accidentes georreferenciados.`);
                    resolve(this.allData);
                }
            };

            // 0. Cargar límites y centroides de municipios precalculados (0 ms de overhead)
            fetch('data/muni_bounds.json')
                .then(r => r.json())
                .then(b => {
                    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                    const cleanBounds = {};
                    Object.keys(b).forEach(k => {
                        cleanBounds[norm(k)] = b[k];
                    });
                    this.muniBounds = cleanBounds;
                })
                .catch(err => console.warn("Aviso: No se pudo cargar muni_bounds.json:", err));

            // 1. Cargar archivo vehiculos.csv
            Papa.parse("data/vehiculos.csv", {
                download: true,
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    results.data.forEach(r => {
                        if (r.id_accidente && r.tipo_vehiculo_limpio) {
                            const idStr = String(r.id_accidente);
                            const vType = normVehicle(r.tipo_vehiculo_limpio);
                            if (!vehiculosMap.has(idStr)) vehiculosMap.set(idStr, new Set());
                            vehiculosMap.get(idStr).add(vType);
                        }
                    });
                    vehiculosLoaded = true;
                    tryFinish();
                },
                error: (err) => {
                    console.warn("No se pudo cargar vehiculos.csv:", err);
                    vehiculosLoaded = true;
                    tryFinish();
                }
            });

            // 2. Cargar archivo accidentes_limpio.csv
            Papa.parse("data/accidentes_limpio.csv", {
                download: true,
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => {
                    accidentesData = results.data;
                    tryFinish();
                },
                error: (err) => {
                    console.error("Error al cargar accidentes_limpio.csv:", err);
                    reject(err);
                }
            });
        });
    },

    /**
     * Aplica los filtros activos sobre la base de datos completa.
     * Utiliza comprobaciones rápidas ("fast-paths") para descartar filtros inactivos.
     */
    filterData(activeFilters, selection) {
        const sel = selection || (window.App && window.App.selection);

        // Verificar cuáles filtros están realmente activos (modificados por el usuario)
        const filterYear = activeFilters.yearMin !== undefined && activeFilters.yearMax !== undefined && (activeFilters.yearMin > 2016 || activeFilters.yearMax < 2026);
        const filterHour = activeFilters.hourMin !== undefined && activeFilters.hourMax !== undefined && (activeFilters.hourMin > 0 || activeFilters.hourMax < 23);
        const filterWk = activeFilters.weekdays && activeFilters.weekdays.size < 7;
        const filterSev = activeFilters.severidad && activeFilters.severidad !== 'todos';
        const filterVehi = activeFilters.vehiculos && FiltersModule.fullSets && FiltersModule.fullSets.vehiculos && activeFilters.vehiculos.size < FiltersModule.fullSets.vehiculos.size;
        const filterMuni = activeFilters.municipios && FiltersModule.fullSets && FiltersModule.fullSets.municipios && activeFilters.municipios.size < FiltersModule.fullSets.municipios.size;
        const filterTipo = activeFilters.tipos && FiltersModule.fullSets && FiltersModule.fullSets.tipos && activeFilters.tipos.size < FiltersModule.fullSets.tipos.size;
        const filterClima = activeFilters.climas && FiltersModule.fullSets && FiltersModule.fullSets.climas && activeFilters.climas.size < FiltersModule.fullSets.climas.size;
        const filterVia = activeFilters.vias && FiltersModule.fullSets && FiltersModule.fullSets.vias && activeFilters.vias.size < FiltersModule.fullSets.vias.size;
        const filterSuperf = activeFilters.superfs && FiltersModule.fullSets && FiltersModule.fullSets.superfs && activeFilters.superfs.size < FiltersModule.fullSets.superfs.size;
        const filterSexo = activeFilters.sexos && FiltersModule.fullSets && FiltersModule.fullSets.sexos && activeFilters.sexos.size < FiltersModule.fullSets.sexos.size;
        const filterMonthKey = activeFilters.targetMonthKey !== undefined && activeFilters.targetMonthKey !== null;
        const filterSel = Boolean(sel && sel.type);

        // Si no hay ningún filtro activo, retornar la base de datos completa inmediatamente
        if (!filterYear && !filterHour && !filterWk && !filterSev && !filterVehi && !filterMuni && !filterTipo && !filterClima && !filterVia && !filterSuperf && !filterSexo && !filterSel && !filterMonthKey) {
            this.filteredData = this.allData;
            return this.filteredData;
        }

        const { yearMin, yearMax, hourMin, hourMax, weekdays, severidad, vehiculos, municipios, tipos, climas, vias, superfs, sexos, targetMonthKey } = activeFilters;

        // Iteración de filtrado registro por registro
        this.filteredData = this.allData.filter(item => {
            if (filterMonthKey && item.monthKey !== targetMonthKey) return false;
            if (filterYear && (item.anio_origen < yearMin || item.anio_origen > yearMax)) return false;
            if (filterHour && (item.hora_redondeada < hourMin || item.hora_redondeada > hourMax)) return false;
            if (filterWk && !weekdays.has(item.wkIdx)) return false;

            if (filterSev) {
                if (severidad === 'danos' && item.sevVal !== 0) return false;
                if (severidad === 'heridos' && item.sevVal !== 1) return false;
                if (severidad === 'fatal' && item.sevVal !== 2) return false;
            }

            if (filterVehi) {
                let hasV = false;
                if (item.vehiculos) {
                    for (let i = 0; i < item.vehiculos.length; i++) {
                        if (vehiculos.has(item.vehiculos[i])) { hasV = true; break; }
                    }
                }
                if (!hasV) return false;
            }

            if (filterMuni && !municipios.has(item.muniStr)) return false;
            if (filterTipo && !tipos.has(item.tipoStr)) return false;
            if (filterClima && !climas.has(item.climaStr)) return false;
            if (filterVia && !vias.has(item.viaStr)) return false;
            if (filterSuperf && !superfs.has(item.superfStr)) return false;
            if (filterSexo && !sexos.has(item.sexoStr)) return false;

            // Filtro espacial dibujado en el mapa (rectángulo, círculo o polígono)
            if (filterSel) {
                if (sel.type === 'rect') {
                    if (item.lat < sel.s || item.lat > sel.n || item.lon < sel.w || item.lon > sel.e) return false;
                } else if (sel.type === 'circle') {
                    // Cálculo de distancia de Haversine en metros
                    const R = 6371000, toRad = Math.PI / 180;
                    const dLat = (sel.lat - item.lat) * toRad, dLon = (sel.lng - item.lon) * toRad;
                    const a = Math.sin(dLat / 2) ** 2 + Math.cos(item.lat * toRad) * Math.cos(sel.lat * toRad) * Math.sin(dLon / 2) ** 2;
                    if (2 * R * Math.asin(Math.sqrt(a)) > sel.r) return false;
                } else if (sel.type === 'poly') {
                    // Algoritmo Ray-Casting para verificar si el punto está dentro del polígono
                    let inside = false;
                    const x = item.lon, y = item.lat;
                    const poly = sel.points;
                    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                        const xi = poly[i].lng, yi = poly[i].lat;
                        const xj = poly[j].lng, yj = poly[j].lat;
                        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                        if (intersect) inside = !inside;
                    }
                    if (!inside) return false;
                }
            }

            return true;
        });

        return this.filteredData;
    },

    /**
     * Calcula las cifras principales de la cabecera (KPIs).
     */
    getKPIs() {
        let total = this.filteredData.length;
        let fallecidos = 0;
        let lesionados = 0;
        let vehiculos = 0;
        let municipios = new Set();

        for (let i = 0; i < total; i++) {
            const d = this.filteredData[i];
            fallecidos += (d.numero_personas_fallecidas || 0);
            lesionados += (d.numero_personas_lesionadas || 0);
            vehiculos += (d.numero_vehiculos_involucrados || 0);
            if (d.municipio) municipios.add(d.municipio);
        }

        return { total, fallecidos, lesionados, vehiculos, municipios: municipios.size };
    },

    /**
     * Agrupa los datos filtrados por mes y año para la gráfica de tendencia.
     */
    groupByMonthAndFatalities() {
        const byMonth = new Map();
        const fatalByMonth = new Map();
        const allMonths = new Set();
        const len = this.filteredData.length;

        for (let i = 0; i < len; i++) {
            const d = this.filteredData[i];
            if (!d.monthKey) continue;
            const key = d.monthKey;
            allMonths.add(key);

            // Accidentes no fatales (Solo daños y Con heridos)
            if (d.sevVal !== 2) {
                byMonth.set(key, (byMonth.get(key) || 0) + 1);
            }
            // Defunciones / Accidentes con víctimas mortales
            if (d.sevVal === 2) {
                const fCount = (d.numero_personas_fallecidas && d.numero_personas_fallecidas > 0) ? d.numero_personas_fallecidas : 1;
                fatalByMonth.set(key, (fatalByMonth.get(key) || 0) + fCount);
            }
        }

        const keys = Array.from(allMonths).sort((a, b) => a - b);
        const labels = keys.map(k => {
            const y = Math.floor(k / 100);
            const m = k % 100;
            return String(m).padStart(2, '0') + '/' + String(y).slice(2);
        });

        return {
            labels: labels,
            totals: keys.map(k => byMonth.get(k) || 0),
            fatals: keys.map(k => fatalByMonth.get(k) || 0)
        };
    },

    /**
     * Obtiene el conteo de tipos de vehículo para la gráfica de barras.
     */
    getTopVehiculos() {
        const counts = {};
        const activeV = FiltersModule.activeFilters ? FiltersModule.activeFilters.vehiculos : null;
        const isFiltered = activeV && FiltersModule.fullSets && FiltersModule.fullSets.vehiculos && activeV.size < FiltersModule.fullSets.vehiculos.size;
        const len = this.filteredData.length;

        for (let i = 0; i < len; i++) {
            const d = this.filteredData[i];
            if (d.vehiculos) {
                for (let j = 0; j < d.vehiculos.length; j++) {
                    const v = d.vehiculos[j];
                    if (!isFiltered || activeV.has(v)) {
                        counts[v] = (counts[v] || 0) + 1;
                    }
                }
            }
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    },

    /**
     * Obtiene el ranking de principales tipos de incidentes viales.
     */
    getTopTipos() {
        const counts = {};
        const len = this.filteredData.length;
        for (let i = 0; i < len; i++) {
            const t = this.filteredData[i].tipo_incidente_vial || 'Sin dato';
            counts[t] = (counts[t] || 0) + 1;
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    },

    /**
     * Obtiene las colonias con mayor número de accidentes.
     */
    getTopColonias() {
        const counts = {};
        const len = this.filteredData.length;
        for (let i = 0; i < len; i++) {
            const col = this.filteredData[i].coloniaClean;
            if (col) {
                counts[col] = (counts[col] || 0) + 1;
            }
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50);
    },

    /**
     * Obtiene la distribución de accidentes por hora (0 a 23 h).
     */
    getClockData() {
        const counts = new Array(24).fill(0);
        const fatals = new Array(24).fill(0);
        const len = this.filteredData.length;
        for (let i = 0; i < len; i++) {
            const d = this.filteredData[i];
            let h = Math.floor(Number(d.hora_redondeada));
            if (!isNaN(h) && h >= 0 && h < 24) {
                counts[h]++;
                if (d.sevVal === 2) fatals[h]++;
            }
        }
        return { counts, fatals };
    },

    /**
     * Obtiene la distribución por día de la semana.
     */
    getWeekdayData() {
        const counts = new Array(7).fill(0);
        const len = this.filteredData.length;
        for (let i = 0; i < len; i++) {
            const wkIdx = this.filteredData[i].wkIdx;
            if (wkIdx >= 0 && wkIdx < 7) {
                counts[wkIdx]++;
            }
        }
        return counts;
    }
};

window.DataModule = DataModule;
