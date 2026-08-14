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

            // 3. Inicializar módulos de gráficos y filtros
            ChartsModule.init();
            FiltersModule.init();

            // 4. Programar la primera actualización del tablero
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
        document.getElementById('hdr-count').innerText = DataModule.allData.length.toLocaleString('es-MX');
        document.getElementById('kpi-total').innerText = kpis.total.toLocaleString('es-MX');
        document.getElementById('kpi-fallecidos').innerText = kpis.fallecidos.toLocaleString('es-MX');
        document.getElementById('kpi-lesionados').innerText = kpis.lesionados.toLocaleString('es-MX');

        // 3. Calcular el promedio mensual de accidentes según el rango de años seleccionado
        const totalMeses = Math.max(1, (FiltersModule.activeFilters.yearMax - FiltersModule.activeFilters.yearMin) * 12 + 12);
        document.getElementById('kpi-promedio').textContent = Math.round(filtered.length / totalMeses).toLocaleString('es-MX');
        document.getElementById('kpi-municipios').innerText = kpis.municipios.toLocaleString('es-MX');

        // 4. Actualizar los marcadores y capas del mapa Leaflet
        if (!MapModule.map) {
            MapModule.init(filtered);
        } else {
            MapModule.updateMap(filtered);
        }

        // 5. Actualizar todos los gráficos en pantalla
        ChartsModule.updateAll();
    }
};

// Arrancar la aplicación cuando el HTML esté listo
document.addEventListener("DOMContentLoaded", () => {
    window.App.init();
});
