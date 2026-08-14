/**
 * ==============================================================================
 * ARCHIVO: js/map.js
 * DESCRIPCIÓN: Módulo del Mapa Interactivo (Leaflet.js).
 * Administra el mapa, marcadores de accidentes, aglutinamiento (clusters),
 * mapa de calor (heatmap), popups con metadatos y herramientas de dibujo espacial.
 * ==============================================================================
 */

const MapModule = {
    map: null,
    clusterGroup: null,
    markers: [],

    heatLayer: null,
    baseMaps: {},
    currentBaseMap: null,
    lastColorMode: null,

    /**
     * Inicializa el mapa Leaflet en el contenedor HTML #map
     * @param {Array} data - Registros iniciales filtrados
     */
    init(data) {
        // Crear mapa centrado en el estado de Michoacán (Morelia)
        this.map = L.map('map', { zoomControl: true, minZoom: 6, maxZoom: 18 })
            .setView([19.706, -101.19], 12);

        // Función creadora de capas compatibles con MapLibreGL (estilos vectoriales 3D) y Raster
        const createBaseLayer = (styleUrl, fallbackUrl, attribution) => {
            if (typeof L !== 'undefined' && typeof L.maplibreGL === 'function' && styleUrl && styleUrl.endsWith('.json')) {
                try {
                    return L.maplibreGL({
                        style: styleUrl,
                        attribution: attribution || '&copy; ATDT · INEGI · OSM'
                    });
                } catch (err) {
                    console.warn("Fallo al inicializar MapLibreGL con " + styleUrl + ", usando capa de respaldo:", err);
                }
            }
            return L.tileLayer(fallbackUrl, {
                attribution: attribution || '&copy; OpenStreetMap',
                maxZoom: 19
            });
        };

        // Mapas base: Claro (ATDT style_3d.json), Blanco y Negro (ATDT style_white_3d_places.json), Oscuro (ATDT style_black_3d_places.json) y Satélite (Esri)
        this.baseMaps = {
            light: createBaseLayer(
                'https://www.mapabase.atdt.gob.mx/style_3d.json',
                'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                '&copy; ATDT · INEGI · OSM'
            ),
            bw: createBaseLayer(
                'https://www.mapabase.atdt.gob.mx/style_white_3d_places.json',
                'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
                '&copy; ATDT · INEGI · OSM'
            ),
            dark: createBaseLayer(
                'https://www.mapabase.atdt.gob.mx/style_black_3d_places.json',
                'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                '&copy; ATDT · INEGI · OSM'
            ),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri',
                maxZoom: 19
            })
        };
        const initialBasemap = (document.getElementById('basemap-mode') && document.getElementById('basemap-mode').value) || 'light';
        this.currentBaseMap = this.baseMaps[initialBasemap] || this.baseMaps.light;
        this.currentBaseMap.addTo(this.map);

        // Inicializar edificios 3D volumétricos con OSMBuildings
        if (typeof OSMBuildings !== 'undefined') {
            try {
                this.osmb = new OSMBuildings(this.map);
                this.osmb.load('https://{s}.data.osmbuildings.org/0.2/59f0f948/tile/{z}/{x}/{y}.json');
                this.osmb.style({
                    color: '#cbd5e1',
                    roofColor: '#94a3b8',
                    shadows: true
                });
            } catch (err) {
                console.warn("OSMBuildings no pudo inicializarse:", err);
            }
        }

        // Capa de mapa de calor con gradiente personalizado
        this.heatLayer = L.heatLayer([], {
            radius: 10,
            blur: 8,
            maxZoom: 16,
            max: 25.0,
            minOpacity: .5,
            gradient: {
                0.4: '#00BFFF',  // Azul eléctrico (baja densidad)
                0.6: '#00E676',  // Verde intenso
                0.8: '#FFEA00',  // Amarillo brillante
                0.9: '#FF7A00',  // Naranja intenso
                1.0: '#FF0033'   // Rojo intenso (alta densidad)
            }
        });

        // Grupo de aglutinamiento de puntos (MarkerCluster)
        this.clusterGroup = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 55,
            disableClusteringAtZoom: 16,
            spiderfyOnMaxZoom: true,
            iconCreateFunction: function (cluster) {
                const children = cluster.getAllChildMarkers();
                let fatal = 0, inj = 0;
                for (const m of children) {
                    const s = m.options.sevVal;
                    if (s === 2) fatal++; else if (s === 1) inj++;
                }
                const count = children.length;
                let sizeCls = 'cl-sm'; if (count >= 250) sizeCls = 'cl-lg'; else if (count >= 40) sizeCls = 'cl-md';
                let colorCls = 'c-green'; if (fatal > 0) colorCls = 'c-red'; else if (inj > 0) colorCls = 'c-amber';
                return L.divIcon({ html: '<div class="cluster-icon ' + sizeCls + ' ' + colorCls + '"><span>' + count + '</span></div>', className: '', iconSize: null });
            }
        });

        this.map.addLayer(this.clusterGroup);

        // Construir marcadores individuales y pintar la selección inicial
        this.buildMarkers(DataModule.allData);
        this.updateMap(data);
        this.renderLegend();

        // Conectar herramientas de selección geográfica (rectángulo, círculo, polígono)
        this.bindDrawTools();
    },

    /** Retorna color según severidad: Verde (Solo daños), Naranja (Heridos), Rojo (Fatal) */
    getSevColor(s) {
        return s === 2 ? '#e1483d' : (s === 1 ? '#f5a623' : '#4caf7d');
    },

    /** Retorna color según condición climática */
    getClimaColor(c) {
        const cmap = { 'Bueno': '#4caf7d', 'Nublado': '#8b94a3', 'Lluvioso': '#3fa0e0', 'Malo': '#e1483d' };
        return cmap[c] || '#5c6674';
    },

    /** Retorna color específico por tipo de vehículo */
    getVColor(v) {
        const vmap = {
            'AUTOMOVIL': '#3fa0e0',
            'CAMIONETA DE PASAJEROS': '#f5a623',
            'MOTOCICLETA': '#e1483d',
            'CAMIONETA DE CARGA': '#e67e22',
            'CAMIÓN DE CARGA': '#9b51e0',
            'CAMIÓN DE PASAJEROS': '#e84393',
            'BICICLETA': '#4caf7d',
            'TRACTOR': '#16a085',
            'PICK-UP': '#d35400',
            'SUV / VAGONETA': '#27ae60',
            'VEHÍCULO DE TRABAJO': '#8e44ad'
        };
        return vmap[v] || '#8b94a3';
    },

    /** Determina el color del vehículo activo en el registro */
    getVehiculoColor(item) {
        if (!item.vehiculos || item.vehiculos.length === 0) return '#5c6674';
        if (FiltersModule.activeFilters && FiltersModule.activeFilters.vehiculos && FiltersModule.fullSets.vehiculos) {
            if (FiltersModule.activeFilters.vehiculos.size > 0 && FiltersModule.activeFilters.vehiculos.size < FiltersModule.fullSets.vehiculos.size) {
                for (const v of item.vehiculos) {
                    if (FiltersModule.activeFilters.vehiculos.has(v)) return this.getVColor(v);
                }
            }
        }
        return this.getVColor(item.vehiculos[0]);
    },

    /** Retorna el color adecuado del marcador según el modo seleccionado en la barra superior */
    getMarkerColor(item) {
        if (window.App.colorMode === 'vehiculo') return this.getVehiculoColor(item);
        return window.App.colorMode === 'clima' ? this.getClimaColor(item.condiciones_climaticas) : this.getSevColor(item.sevVal);
    },

    /**
     * Crea los marcadores circulares de Leaflet para cada registro de accidente.
     */
    buildMarkers(allData) {
        this.markers = new Array(allData.length);
        allData.forEach((item) => {
            const m = L.circleMarker([item.lat, item.lon], {
                radius: 5, weight: 1, color: '#10141a', opacity: 0.55,
                fillColor: this.getMarkerColor(item), fillOpacity: 0.85
            });
            m.options.sevVal = item.sevVal;
            m.options.refItem = item;

            // Al hacer clic sobre un punto en el mapa se despliega la ventana flotante (popup)
            m.on('click', () => {
                const sevBg = this.getSevColor(item.sevVal);
                const sevLbl = item.sevVal === 2 ? 'Fatal' : (item.sevVal === 1 ? 'Con heridos' : 'Solo daños');
                const vehiStr = item.vehiculos ? item.vehiculos.join(', ') : 'Sin datos';
                const html = `
                    <div class="pp-title">${item.tipo_incidente_vial || ''}<span class="pp-sev" style="background:${sevBg};color:${item.sevVal === 0 ? '#0c1a12' : '#fff'}">${sevLbl}</span></div>
                    <div class="pp-row"><span>Fecha</span><span>${item.dia_incidente || ''} · ${String(item.hora_redondeada || '').padStart(2, '0')}:00</span></div>
                    <div class="pp-row"><span>Municipio</span><span>${item.municipio || ''}</span></div>
                    <div class="pp-row"><span>Colonia</span><span>${item.colonia || ''}</span></div>
                    <div class="pp-row"><span>Vehículos</span><span>${vehiStr} (${item.numero_vehiculos_involucrados || 0})</span></div>
                    <div class="pp-row"><span>Lesionados</span><span>${item.numero_personas_lesionadas || 0}</span></div>
                    <div class="pp-row"><span>Fallecidos</span><span>${item.numero_personas_fallecidas || 0}</span></div>
                    <div class="pp-row"><span>Clima</span><span>${item.condiciones_climaticas || ''}</span></div>
                    <div class="pp-row"><span>Vía</span><span>${item.condiciones_via || ''}</span></div>
                    <div class="pp-row"><span>Resp.</span><span>${item.sexo_presunto_responsable || ''} ${item.edad_presunto_responsable >= 0 ? '· ' + item.edad_presunto_responsable + ' años' : ''}</span></div>
                    <div class="pp-row"><span>Toxicología</span><span>${item.resultados_toxicologia || ''}</span></div>
                `;
                m.bindPopup(html).openPopup();
            });
            this.markers[item._id] = m;
        });
    },

    /**
     * Refresca las capas activas del mapa al aplicar cualquier filtro
     */
    updateMap(filteredData) {
        if (window.App.layerMode === 'heat') {
            // Cambiar a vista de Mapa de Calor
            if (this.map.hasLayer(this.clusterGroup)) this.map.removeLayer(this.clusterGroup);
            if (!this.map.hasLayer(this.heatLayer)) this.heatLayer.addTo(this.map);

            const len = filteredData.length;
            const heatData = new Array(len);
            for (let i = 0; i < len; i++) {
                const item = filteredData[i];
                heatData[i] = [item.lat, item.lon, item.sevVal === 2 ? 1.0 : (item.sevVal === 1 ? 0.4 : 0.15)];
            }
            this.heatLayer.setLatLngs(heatData);
        } else {
            // Cambiar a vista de Puntos con Aglutinamiento
            if (this.map.hasLayer(this.heatLayer)) this.map.removeLayer(this.heatLayer);
            if (!this.map.hasLayer(this.clusterGroup)) this.clusterGroup.addTo(this.map);

            this.clusterGroup.clearLayers();
            const len = filteredData.length;
            const activeLayers = new Array(len);
            const colorChanged = (this.lastColorMode !== window.App.colorMode);
            this.lastColorMode = window.App.colorMode;

            for (let k = 0; k < len; k++) {
                const item = filteredData[k];
                const m = this.markers[item._id];
                if (colorChanged) {
                    m.setStyle({ fillColor: this.getMarkerColor(item) });
                }
                activeLayers[k] = m;
            }
            this.clusterGroup.addLayers(activeLayers);
        }
    },

    /**
     * Dibuja la simbología informativa en la esquina inferior derecha del mapa
     */
    renderLegend() {
        const el = document.getElementById('map-legend');
        if (!el) return;
        if (window.App.colorMode === 'vehiculo') {
            const vOptions = [
                ['Automóvil', '#3fa0e0'],
                ['Motocicleta', '#e1483d'],
                ['Camioneta Pasajeros', '#f5a623'],
                ['Camioneta Carga', '#e67e22'],
                ['Camión Carga', '#9b51e0'],
                ['Bicicleta', '#4caf7d'],
                ['Otros', '#8b94a3']
            ];
            el.innerHTML = vOptions.map(([label, col]) => `<span><span class="legend-dot" style="background:${col}"></span>${label}</span>`).join('');
        } else if (window.App.colorMode === 'sev') {
            el.innerHTML = `
                <span><span class="legend-dot" style="background:#4caf7d"></span>Solo daños</span>
                <span><span class="legend-dot" style="background:#f5a623"></span>Con heridos</span>
                <span><span class="legend-dot" style="background:#e1483d"></span>Fatal</span>
            `;
        } else {
            el.innerHTML = `
                <span><span class="legend-dot" style="background:#4caf7d"></span>Bueno</span>
                <span><span class="legend-dot" style="background:#8b94a3"></span>Nublado</span>
                <span><span class="legend-dot" style="background:#3fa0e0"></span>Lluvioso</span>
                <span><span class="legend-dot" style="background:#e1483d"></span>Malo</span>
                <span><span class="legend-dot" style="background:#5c6674"></span>Sin dato</span>
            `;
        }
    },

    /**
     * Configura las herramientas interactivas de dibujo espacial (rectángulo, círculo y polígono)
     */
    bindDrawTools() {
        let drawMode = null;
        let rectLayer = null, rectStart = null;
        let circleLayer = null, circleCenterLatLng = null;
        let polyLayer = null, polyPoints = [];

        // Cancela cualquier modo de dibujo activo
        const exitDrawMode = () => {
            drawMode = null;
            this.map.dragging.enable();
            document.getElementById('map').style.cursor = '';
            document.getElementById('tool-rect').classList.remove('active');
            document.getElementById('tool-circle').classList.remove('active');
            document.getElementById('tool-poly').classList.remove('active');
        };

        // Eventos para botones de la barra del mapa
        document.getElementById('tool-rect').addEventListener('click', (e) => {
            if (drawMode === 'rect') { exitDrawMode(); return; }
            exitDrawMode();
            drawMode = 'rect';
            this.map.dragging.disable();
            document.getElementById('map').style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });
        document.getElementById('tool-circle').addEventListener('click', (e) => {
            if (drawMode === 'circle') { exitDrawMode(); return; }
            exitDrawMode();
            drawMode = 'circle';
            this.map.dragging.disable();
            document.getElementById('map').style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });
        document.getElementById('tool-poly').addEventListener('click', (e) => {
            if (drawMode === 'poly') { exitDrawMode(); return; }
            exitDrawMode();
            drawMode = 'poly';
            polyPoints = [];
            this.map.dragging.disable();
            document.getElementById('map').style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });

        // Movimiento del mouse durante el trazo de figuras
        const onRectMove = (e) => { if (rectLayer && rectStart) rectLayer.setBounds([rectStart, e.latlng]); };
        const onCircleMove = (e) => {
            if (circleLayer && circleCenterLatLng) {
                const haversineMeters = (lat1, lon1, lat2, lon2) => {
                    const R = 6371000, toRad = Math.PI / 180;
                    const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
                    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
                    return 2 * R * Math.asin(Math.sqrt(a));
                };
                circleLayer.setRadius(haversineMeters(circleCenterLatLng.lat, circleCenterLatLng.lng, e.latlng.lat, e.latlng.lng));
            }
        };

        // Inicio del trazo con el botón primario del ratón
        this.map.on('mousedown', (e) => {
            if (drawMode === 'rect') {
                rectStart = e.latlng;
                if (rectLayer) this.map.removeLayer(rectLayer);
                rectLayer = L.rectangle([rectStart, rectStart], { color: '#f5a623', weight: 2, fillOpacity: .08 });
                rectLayer.addTo(this.map);
                this.map.on('mousemove', onRectMove);
            } else if (drawMode === 'circle') {
                circleCenterLatLng = e.latlng;
                if (circleLayer) this.map.removeLayer(circleLayer);
                circleLayer = L.circle(circleCenterLatLng, { radius: 1, color: '#f5a623', weight: 2, fillOpacity: .08 });
                circleLayer.addTo(this.map);
                this.map.on('mousemove', onCircleMove);
            }
        });

        // Agregar vértices al polígono libre
        this.map.on('click', (e) => {
            if (drawMode === 'poly') {
                polyPoints.push(e.latlng);
                if (polyLayer) this.map.removeLayer(polyLayer);
                polyLayer = L.polygon(polyPoints, { color: '#f5a623', weight: 2, fillOpacity: .08 });
                polyLayer.addTo(this.map);
            }
        });

        // Clic derecho para cerrar y aplicar la selección del polígono
        this.map.on('contextmenu', (e) => {
            if (drawMode === 'poly' && polyPoints.length > 2) {
                window.App.selection = { type: 'poly', points: [...polyPoints] };
                polyPoints = [];
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            }
        });

        // Finalizar trazo al soltar el botón del ratón
        this.map.on('mouseup', (e) => {
            if (drawMode === 'rect' && rectStart) {
                this.map.off('mousemove', onRectMove);
                const b = rectLayer.getBounds();
                window.App.selection = { type: 'rect', s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() };
                rectStart = null;
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            } else if (drawMode === 'circle' && circleCenterLatLng) {
                this.map.off('mousemove', onCircleMove);
                window.App.selection = { type: 'circle', lat: circleCenterLatLng.lat, lng: circleCenterLatLng.lng, r: circleLayer.getRadius() };
                circleCenterLatLng = null;
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            }
        });

        // Limpiar cualquier selección del mapa
        const clearSelection = () => {
            window.App.selection = null;
            if (rectLayer) { this.map.removeLayer(rectLayer); rectLayer = null; }
            if (circleLayer) { this.map.removeLayer(circleLayer); circleLayer = null; }
            if (polyLayer) { this.map.removeLayer(polyLayer); polyLayer = null; }
            polyPoints = [];
            document.getElementById('selection-badge').classList.remove('show');
            window.App.scheduleUpdate();
        };
        document.getElementById('tool-clear').addEventListener('click', clearSelection);
        document.getElementById('selection-clear-x').addEventListener('click', clearSelection);

        // Cambios en selectores de la barra del mapa (Color, Mapa base, Vista)
        document.getElementById('color-mode').addEventListener('change', (e) => {
            window.App.colorMode = e.target.value;
            this.renderLegend();
            window.App.scheduleUpdate();
        });

        document.getElementById('basemap-mode').addEventListener('change', (e) => {
            this.map.removeLayer(this.currentBaseMap);
            this.currentBaseMap = this.baseMaps[e.target.value];
            this.currentBaseMap.addTo(this.map);
        });

        document.getElementById('layer-mode').addEventListener('change', (e) => {
            window.App.layerMode = e.target.value;
            window.App.scheduleUpdate();
        });

        // Botón único para alternar 3D
        const btn3D = document.getElementById('tool-3d');
        if (btn3D) {
            btn3D.addEventListener('click', () => {
                this.toggle3D();
            });
        }

        // Navegación 3D: Inclinación y rotación con Clic Derecho + Arrastre o Ctrl + Clic Izquierdo + Arrastre
        const mapContainer = document.getElementById('map');
        let isDragging3D = false;
        let startX = 0, startY = 0;
        let startPitch = 0, startBearing = 0;

        mapContainer.addEventListener('contextmenu', (e) => {
            if (isDragging3D) {
                e.preventDefault();
            }
        });

        mapContainer.addEventListener('mousedown', (e) => {
            // Clic derecho (button 2) o Ctrl + Clic izquierdo (button 0 + ctrlKey)
            if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
                isDragging3D = true;
                startX = e.clientX;
                startY = e.clientY;
                startPitch = this.pitch || 0;
                startBearing = this.bearing || 0;
                mapContainer.style.cursor = 'grab';
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging3D) return;
            const deltaX = e.clientX - startX;
            const deltaY = startY - e.clientY;

            const newPitch = Math.max(0, Math.min(75, startPitch + deltaY * 0.45));
            const newBearing = Math.max(-180, Math.min(180, startBearing + deltaX * 0.45));

            this.is3D = (newPitch > 10);
            const btn = document.getElementById('tool-3d');
            if (btn) {
                if (this.is3D) {
                    btn.classList.add('active');
                    btn.innerText = '🧊 3D';
                } else {
                    btn.classList.remove('active');
                    btn.innerText = '3D';
                }
            }
            this.setCamera3D(newPitch, newBearing, false);
        });

        window.addEventListener('mouseup', () => {
            if (isDragging3D) {
                isDragging3D = false;
                mapContainer.style.cursor = '';
            }
        });
    },

    /**
     * Alterna entre modo 2D y 3D con un solo clic
     */
    toggle3D(enable) {
        this.is3D = (enable !== undefined) ? enable : !this.is3D;
        const targetPitch = this.is3D ? 60 : 0;
        const targetBearing = this.is3D ? (this.bearing || 0) : 0;
        this.setCamera3D(targetPitch, targetBearing, true);

        const btn3D = document.getElementById('tool-3d');
        if (btn3D) {
            if (this.is3D) {
                btn3D.classList.add('active');
                btn3D.innerText = '🧊 3D';
            } else {
                btn3D.classList.remove('active');
                btn3D.innerText = '3D';
            }
        }
    },

    /**
     * Ajusta la inclinación (pitch) y orientación (bearing) de la cámara en WebGL y OSMBuildings
     */
    setCamera3D(pitch, bearing, animate = false) {
        this.pitch = pitch;
        this.bearing = bearing;

        // Control nativo de cámara MapLibre GL
        if (this.currentBaseMap && typeof this.currentBaseMap.getMaplibreMap === 'function') {
            try {
                const glMap = this.currentBaseMap.getMaplibreMap();
                if (glMap) {
                    if (animate) {
                        glMap.easeTo({ pitch: pitch, bearing: bearing, duration: 700 });
                    } else {
                        glMap.setPitch(pitch);
                        glMap.setBearing(bearing);
                    }
                }
            } catch (err) {
                console.warn("Error al ajustar cámara MapLibre:", err);
            }
        }

        // Control de cámara en OSMBuildings (edificios 3D volumétricos)
        if (this.osmb) {
            try {
                if (typeof this.osmb.setPitch === 'function') {
                    this.osmb.setPitch(pitch);
                }
                if (typeof this.osmb.setRotation === 'function') {
                    this.osmb.setRotation(bearing);
                }
            } catch (err) {
                console.warn("Error al ajustar cámara OSMBuildings:", err);
            }
        }
    }
};
