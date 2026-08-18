/**
 * ==============================================================================
 * ARCHIVO: js/app.js
 * DESCRIPCIÓN: Controlador principal de la aplicación.
 * Orchestación entre la carga de datos, mapa, gráficos y filtros.
 * ==============================================================================
 */

window.App = {
    // Control para evitar actualizaciones duplicadas en el mismo fotograma (optimización de velocidad)
    rafPending: false,

    // Filtro de selección espacial activo en el mapa (rectángulo, círculo o polígono)
    selection: null,

    // Modo de color del mapa: 'sev' (severidad), 'vehiculo' (tipo de vehículo), 'clima' (clima)
    colorMode: 'sev',

    // Modo de capa del mapa: 'heat' (mapa de calor por defecto) o 'cluster' (puntos aglutinados)
    layerMode: 'heat',

    /**
     * Inicializa la aplicación completa al cargar la página.
     */
    async init() {
        try {
            // 1. Cargar el archivo CSV y procesar los registros
            await DataModule.loadData();

            // 2. Ocultar la pantalla de carga (spinner)
            const loadingEl = document.getElementById('loading');
            if (loadingEl) loadingEl.style.display = 'none';

            // 3. Inicializar módulos de gráficos, filtros, reproductor temporal y reordenamiento
            ChartsModule.init();
            FiltersModule.init();
            if (typeof PlayerModule !== 'undefined') {
                PlayerModule.init();
            }
            if (typeof ReorderModule !== 'undefined') {
                ReorderModule.init();
            }

            // 4. Configurar botón de intercambio de paneles (Horas/Días vs Tendencia)
            const mapCol = document.querySelector('.map-col');
            const swapBtns = document.querySelectorAll('.btn-swap-panels');
            const isSwapped = localStorage.getItem('dash_panels_swapped') === 'true';

            if (isSwapped && mapCol) {
                mapCol.classList.add('swapped');
            }

            swapBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (!mapCol) return;
                    mapCol.classList.toggle('swapped');
                    const nowSwapped = mapCol.classList.contains('swapped');
                    localStorage.setItem('dash_panels_swapped', nowSwapped);
                });
            });

            // 5. Programar la primera actualización del tablero
            this.scheduleUpdate();

        } catch (error) {
            console.error("Error al inicializar el tablero:", error);
            const loadText = document.getElementById('loading-text');
            if (loadText) {
                loadText.innerText = "Error cargando la base de datos de accidentes.";
            }
        }
    },

    /**
     * Programa una actualización del tablero usando requestAnimationFrame.
     * Esto evita sobrecargar la pantalla si el usuario arrastra rápidamente un filtro.
     */
    scheduleUpdate() {
        if (this.rafPending) return;
        this.rafPending = true;

        requestAnimationFrame(() => {
            this.rafPending = false;
            this.updateDashboard();
        });
    },

    /**
     * Ejecuta el flujo principal de actualización cuando cambia cualquier filtro.
     */
    updateDashboard() {
        // 1. Filtrar los datos originales con los criterios activos
        const filtered = DataModule.filterData(FiltersModule.activeFilters, this.selection);

        // 2. Obtener y actualizar los indicadores clave (KPIs) en la cabecera
        const kpis = DataModule.getKPIs();
        const hdrCount = document.getElementById('hdr-count');
        if (hdrCount) hdrCount.innerText = DataModule.allData.length.toLocaleString('es-MX');
        const kpiTot = document.getElementById('kpi-total');
        if (kpiTot) kpiTot.innerText = kpis.total.toLocaleString('es-MX');
        const kpiFat = document.getElementById('kpi-fallecidos');
        if (kpiFat) kpiFat.innerText = kpis.fallecidos.toLocaleString('es-MX');
        const kpiLes = document.getElementById('kpi-lesionados');
        if (kpiLes) kpiLes.innerText = kpis.lesionados.toLocaleString('es-MX');

        // 3. Calcular el promedio mensual de accidentes según el rango de años seleccionado
        const totalMeses = Math.max(1, (FiltersModule.activeFilters.yearMax - FiltersModule.activeFilters.yearMin) * 12 + 12);
        const kpiProm = document.getElementById('kpi-promedio');
        if (kpiProm) kpiProm.textContent = Math.round(filtered.length / totalMeses).toLocaleString('es-MX');
        const kpiMun = document.getElementById('kpi-municipios');
        if (kpiMun) kpiMun.innerText = kpis.municipios.toLocaleString('es-MX');

        // 4. Actualizar los marcadores y capas del mapa Leaflet
        if (!MapModule.map) {
            MapModule.init(filtered);
        } else {
            MapModule.updateMap(filtered);
        }

        // 5. Actualizar todos los gráficos en pantalla
        ChartsModule.updateAll();

        // 6. Sincronizar badge del reproductor temporal
        if (typeof PlayerModule !== 'undefined' && PlayerModule.updateTimelineUI) {
            PlayerModule.updateTimelineUI();
        }
    }
};

// Arrancar la aplicación cuando el HTML esté listo
document.addEventListener("DOMContentLoaded", () => {
    window.App.init();
});
