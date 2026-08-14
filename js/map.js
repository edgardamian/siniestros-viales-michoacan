/**
 * ==============================================================================
 * ARCHIVO: js/map.js
 * DESCRIPCIÓN: Módulo del Mapa Interactivo 3D (MapLibre GL WebGL + Supercluster).
 * Administra la cartografía base de la ATDT, edificios 3D, mapa de calor suave,
 * clusters de accidentes, popups detallados y herramientas espaciales.
 * ==============================================================================
 */

const MapModule = {
    map: null,
    is3D: false,
    showBuildings: false,
    pitch: 0,
    bearing: 0,
    currentPopup: null,
    lastFilteredData: null,
    supercluster: null,
    activeMarkers: {},
    drawMode: null,
    drawPoints: [],
    drawStart: null,

    // Estilos de mapas base: ATDT 3D Vector Tiles y Satélite
    baseStyles: {
        dark: 'https://www.mapabase.atdt.gob.mx/style_black_3d_places.json',
        light: 'https://www.mapabase.atdt.gob.mx/style_3d.json',
        bw: 'https://www.mapabase.atdt.gob.mx/style_white_3d_places.json',
        satellite: {
            version: 8,
            sources: {
                'esri-sat': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
                }
            },
            layers: [{ id: 'esri-sat-layer', type: 'raster', source: 'esri-sat' }]
        }
    },

    /**
     * Inicializa el mapa MapLibre GL en el contenedor HTML #map
     * @param {Array} data - Registros iniciales filtrados
     */
    init(data) {
        this.lastFilteredData = data;
        const initialBasemap = (document.getElementById('basemap-mode') && document.getElementById('basemap-mode').value) || 'dark';
        const styleUrl = this.baseStyles[initialBasemap] || this.baseStyles.dark;

        // Crear mapa WebGL centrado en Morelia, Michoacán
        this.map = new maplibregl.Map({
            container: 'map',
            style: styleUrl,
            center: [-101.19, 19.706],
            zoom: 12,
            minZoom: 6,
            maxZoom: 18,
            pitch: 0,
            bearing: 0,
            maxPitch: 75,
            dragRotate: true,
            pitchWithRotate: true
        });

        // Controles de navegación nativos (Zoom y brújula)
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

        // Evento de inicialización de fuentes y capas una vez cargado el estilo inicial
        const syncMapLayersAndData = () => {
            this.setupLayers();
            this.applyBuildingsVisibility();
            const currentData = this.lastFilteredData || (window.DataModule && window.DataModule.filteredData) || (window.DataModule && window.DataModule.allData) || [];
            if (currentData.length > 0) {
                this.updateMap(currentData);
            }
        };

        this.map.on('load', () => {
            syncMapLayersAndData();
            this.renderLegend();
        });

        // Al cambiar de mapa base (setStyle), restaurar capas WebGL y fuentes de datos automáticamente
        this.map.on('style.load', () => {
            syncMapLayersAndData();
        });

        this.map.on('styledata', () => {
            if (!this.map.getSource('accidents-heat-src') || !this.map.getLayer('accidents-heat-layer')) {
                syncMapLayersAndData();
            }
        });

        // Actualizar clusters al mover o cambiar zoom/inclinación
        this.map.on('move', () => {
            this.renderMarkers();
        });

        // Detectar cambios en pitch para sincronizar el botón 3D
        this.map.on('pitch', () => {
            const p = this.map.getPitch();
            this.is3D = (p > 15);
            const btn = document.getElementById('tool-3d');
            if (btn) {
                btn.classList.toggle('active', this.is3D);
                btn.innerText = '3D';
            }
        });

        // Conectar herramientas de selección geográfica y eventos
        this.bindEvents();
    },

    /** Retorna color según severidad: Verde Autopista (Solo daños), Amarillo Señal (Heridos), Rojo Alto (Fatal) */
    getSevColor(s) {
        return s === 2 ? '#ff1744' : (s === 1 ? '#ffd600' : '#00e676');
    },

    /** Retorna color según condición climática */
    getClimaColor(c) {
        if (!c) return '#64748b';
        const u = c.toUpperCase();
        if (u.includes('BUEN') || u.includes('DESPEJ')) return '#00e676';
        if (u.includes('LLUV') || u.includes('NUBL')) return '#00b0ff';
        if (u.includes('NIEBL')) return '#f8fafc';
        if (u.includes('MAL')) return '#ff1744';
        return '#ffd600';
    },

    /** Retorna color según tipo de vehículo */
    getVehiculoColor(item) {
        const v = item.tipo_vehiculo || (item.vehiculos && item.vehiculos[0]) || '';
        const u = v.toUpperCase();
        if (u.includes('MOTO')) return '#ff1744';
        if (u.includes('AUTO') || u.includes('SEDAN') || u.includes('COMPACTO')) return '#00b0ff';
        if (u.includes('CAMIONETA') || u.includes('PICKUP') || u.includes('VANG')) return '#ff6a00';
        if (u.includes('BICICLETA') || u.includes('CICLO')) return '#00e676';
        if (u.includes('PESADO') || u.includes('TRACTO') || u.includes('CAMION') || u.includes('AUTOBUS')) return '#ffd600';
        if (u.includes('PEATON')) return '#ff4081';
        return '#94a3b8';
    },

    /** Retorna color para marcadores individuales según la variable activa */
    getMarkerColor(item) {
        if (window.App.colorMode === 'vehiculo') return this.getVehiculoColor(item);
        return window.App.colorMode === 'clima' ? this.getClimaColor(item.condiciones_climaticas) : this.getSevColor(item.sevVal);
    },

    /**
     * Configura fuentes y capas WebGL nativas dentro de MapLibre GL
     */
    setupLayers() {
        if (!this.map) return;

        try {
            // 1. Fuente no-agrupada para el Mapa de Calor WebGL
            if (!this.map.getSource('accidents-heat-src')) {
                this.map.addSource('accidents-heat-src', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
            }

            // 2. Capa de Mapa de Calor WebGL
            if (!this.map.getLayer('accidents-heat-layer')) {
                const heatLayerDef = {
                    id: 'accidents-heat-layer',
                    type: 'heatmap',
                    source: 'accidents-heat-src',
                    layout: {
                        'visibility': (!window.App || window.App.layerMode === 'heat' || (document.getElementById('layer-mode') && document.getElementById('layer-mode').value === 'heat') ? 'visible' : 'none')
                    },
                    paint: {
                        'heatmap-weight': [
                            'interpolate',
                            ['linear'],
                            ['get', 'weight'],
                            0.1, 0.1,
                            0.3, 0.3,
                            0.6, 0.6
                        ],
                        'heatmap-intensity': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            6, 0.18,
                            10, 0.35,
                            12, 0.52,
                            14, 0.70,
                            17, 0.90
                        ],
                        'heatmap-color': [
                            'interpolate',
                            ['linear'],
                            ['heatmap-density'],
                            0.0, 'rgba(0, 0, 0, 0)',
                            0.04, 'rgba(0, 176, 255, 0.55)', // Borde exterior suave azul vial
                            0.12, '#00B0FF',                  // 🔵 Azul señal informativa
                            0.26, '#00E676',                  // 🟢 Verde autopista
                            0.48, '#FFD600',                  // 🟡 Amarillo señal de tránsito
                            0.72, '#FF6A00',                  // 🟠 Naranja fluorescente cono
                            0.92, '#FF1744'                   // 🔴 Rojo señal de alto
                        ],
                        'heatmap-radius': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            6, 4,
                            8, 8,
                            10, 14,
                            12, 20,                           // Radio más amplio y suave
                            14, 28,
                            16, 38,
                            18, 50
                        ],
                        'heatmap-opacity': 0.85
                    }
                };

                this.map.addLayer(heatLayerDef);
            }

            // 3. Fuente para dibujo de selección espacial (rectángulo, círculo, polígono)
            if (!this.map.getSource('selection-src')) {
                this.map.addSource('selection-src', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
            }

            // Capa de máscara exterior oscura (resalta el área seleccionada y oculta/atenúa el exterior)
            if (!this.map.getLayer('selection-mask')) {
                this.map.addLayer({
                    id: 'selection-mask',
                    type: 'fill',
                    source: 'selection-src',
                    filter: ['==', ['get', 'isMask'], true],
                    paint: {
                        'fill-color': '#05070a',
                        'fill-opacity': 0.75
                    }
                });
            }

            // Capa de selección espacial interior (polígono y contorno)
            if (!this.map.getLayer('selection-fill')) {
                this.map.addLayer({
                    id: 'selection-fill',
                    type: 'fill',
                    source: 'selection-src',
                    filter: ['!=', ['get', 'isMask'], true],
                    paint: {
                        'fill-color': '#ff6a00',
                        'fill-opacity': 0.10
                    }
                });
            }
            if (!this.map.getLayer('selection-line')) {
                this.map.addLayer({
                    id: 'selection-line',
                    type: 'line',
                    source: 'selection-src',
                    filter: ['!=', ['get', 'isMask'], true],
                    paint: {
                        'line-color': '#ff6a00',
                        'line-width': 2.5,
                        'line-dasharray': [3, 2]
                    }
                });
            }

        } catch (err) {
            console.warn("setupLayers error:", err);
        }
    },

    /**
     * Limpia los marcadores DOM de la vista
     */
    clearMarkers() {
        for (const id in this.activeMarkers) {
            this.activeMarkers[id].remove();
        }
        this.activeMarkers = {};
    },

    /**
     * Renderiza marcadores DOM individuales y clusters
     */
    renderMarkers() {
        if (!this.supercluster || !this.map) return;

        // Si la capa activa es el mapa de calor, ocultar todos los puntos y clusters
        if (window.App && window.App.layerMode === 'heat') {
            this.clearMarkers();
            return;
        }

        const bounds = this.map.getBounds();
        const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        const zoom = Math.floor(this.map.getZoom());

        const clusters = this.supercluster.getClusters(bbox, zoom);
        const newMarkers = {};

        clusters.forEach((f) => {
            const [lng, lat] = f.geometry.coordinates;
            const isCluster = f.properties.cluster;
            const id = isCluster ? `c_${f.properties.cluster_id}` : `p_${f.properties.id}`;

            if (this.activeMarkers[id]) {
                newMarkers[id] = this.activeMarkers[id];
                delete this.activeMarkers[id];
                return;
            }

            const el = document.createElement('div');

            if (isCluster) {
                const count = f.properties.point_count;
                const fatal = f.properties.fatal || 0;
                const inj = f.properties.inj || 0;

                const cClass = fatal > 0 ? 'c-red' : (inj > 0 ? 'c-amber' : 'c-green');
                const sClass = count < 20 ? 'cl-sm' : (count < 100 ? 'cl-md' : 'cl-lg');
                el.className = `cluster-icon ${sClass} ${cClass}`;
                el.innerText = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count;
                el.style.cursor = 'pointer';

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const expansionZoom = this.supercluster.getClusterExpansionZoom(f.properties.cluster_id);
                    if (expansionZoom > 17) {
                        const leaves = this.supercluster.getLeaves(f.properties.cluster_id, 10, 0);
                        this.showClusterSummaryPopup(f.properties, leaves, [lng, lat]);
                        return;
                    }
                    this.map.easeTo({
                        center: [lng, lat],
                        zoom: Math.min(18, expansionZoom),
                        duration: 350
                    });
                });
            } else {
                const item = DataModule.allData[f.properties.id];
                if (!item) return;

                const color = this.getMarkerColor(item);
                el.className = 'point-marker-wrap';
                el.style.width = '24px';
                el.style.height = '24px';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.cursor = 'pointer';

                const dot = document.createElement('div');
                dot.className = 'point-marker-dot';
                dot.style.width = '10px';
                dot.style.height = '10px';
                dot.style.borderRadius = '50%';
                dot.style.backgroundColor = color;
                dot.style.border = '1.5px solid #10141a';
                dot.style.boxShadow = '0 2px 6px rgba(0,0,0,0.6)';
                dot.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
                el.appendChild(dot);

                el.addEventListener('mouseenter', () => {
                    dot.style.transform = 'scale(1.5)';
                    dot.style.boxShadow = '0 0 8px ' + color;
                });
                el.addEventListener('mouseleave', () => {
                    dot.style.transform = 'scale(1)';
                    dot.style.boxShadow = '0 2px 6px rgba(0,0,0,0.6)';
                });

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showPopup(item, [lng, lat]);
                });
            }

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(this.map);

            newMarkers[id] = marker;
        });

        // Remover marcadores que salieron del encuadre
        for (const id in this.activeMarkers) {
            this.activeMarkers[id].remove();
        }
        this.activeMarkers = newMarkers;
    },

    /**
     * Despliega la ventana emergente con lista resumida para clusters superpuestos
     */
    showClusterSummaryPopup(props, leaves, coords) {
        const count = props.point_count;
        let itemsHtml = '';
        leaves.slice(0, 5).forEach((leaf) => {
            const item = DataModule.allData[leaf.properties.id];
            if (!item) return;
            const sevBg = this.getSevColor(item.sevVal);
            const sevLbl = item.sevVal === 2 ? 'Fatal' : (item.sevVal === 1 ? 'Con heridos' : 'Solo daños');
            itemsHtml += `
                <div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed var(--linea); font-size: 11px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b style="color:var(--ambar-2);">${item.tipo_incidente_vial || 'Accidente'}</b>
                        <span class="pp-sev" style="background:${sevBg};color:#fff;font-size:9.5px;padding:1px 5px;">${sevLbl}</span>
                    </div>
                    <div style="color:var(--niebla);">${item.dia_incidente || ''} · ${String(item.hora_redondeada || '').padStart(2, '0')}:00</div>
                </div>
            `;
        });

        const html = `
            <div class="pp-title">Grupo de ${count} Accidentes</div>
            <div class="pp-row"><span>Fallecidos</span><span>${props.fatal || 0}</span></div>
            <div class="pp-row"><span>Lesionados</span><span>${props.inj || 0}</span></div>
            ${itemsHtml}
            ${count > 5 ? `<div style="text-align:center; color:var(--niebla); font-size:10.5px; margin-top:5px;">+ ${count - 5} accidentes más en este punto</div>` : ''}
        `;

        if (this.currentPopup) this.currentPopup.remove();
        this.currentPopup = new maplibregl.Popup({ offset: 12, closeOnClick: false, closeButton: true, maxWidth: '320px' })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(this.map);
    },

    /**
     * Despliega la ventana emergente con metadatos del accidente
     */
    showPopup(item, coords) {
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

        if (this.currentPopup) this.currentPopup.remove();
        this.currentPopup = new maplibregl.Popup({ offset: 12, closeOnClick: false, closeButton: true, maxWidth: '320px' })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(this.map);
    },

    /**
     * Refresca las capas activas del mapa al aplicar cualquier filtro
     */
    updateMap(filteredData) {
        this.lastFilteredData = filteredData;
        if (!this.map) return;

        // Limpiar marcadores antiguos para evitar reutilizar IDs desactualizados de Supercluster
        this.clearMarkers();
        this.setupLayers();

        const dataToRender = filteredData || this.lastFilteredData || (window.DataModule && window.DataModule.filteredData) || (window.DataModule && window.DataModule.allData) || [];
        const len = dataToRender.length;
        const features = new Array(len);
        for (let i = 0; i < len; i++) {
            const item = dataToRender[i];
            features[i] = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
                properties: {
                    id: item._id,
                    sevVal: item.sevVal,
                    weight: (item.sevVal === 2 ? 0.6 : (item.sevVal === 1 ? 0.3 : 0.1)),
                    color: this.getMarkerColor(item)
                }
            };
        }

        const geojson = { type: 'FeatureCollection', features };

        // Actualizar datos del mapa de calor WebGL
        const heatSrc = this.map.getSource('accidents-heat-src');
        if (heatSrc) heatSrc.setData(geojson);

        // Inicializar motor Supercluster
        if (typeof Supercluster !== 'undefined') {
            this.supercluster = new Supercluster({
                radius: 38,   // Radio de agrupación compacto
                maxZoom: 16,  // Agrupamiento hasta zoom 16
                map: (props) => ({
                    fatal: props.sevVal === 2 ? 1 : 0,
                    inj: props.sevVal === 1 ? 1 : 0
                }),
                reduce: (accumulated, props) => {
                    accumulated.fatal += props.fatal;
                    accumulated.inj += props.inj;
                }
            });
            this.supercluster.load(features);
        }

        // Conmutar visibilidad entre Calor y Puntos/Clusters
        const isHeat = (!window.App || window.App.layerMode === 'heat' || (document.getElementById('layer-mode') && document.getElementById('layer-mode').value === 'heat'));
        if (this.map.getLayer('accidents-heat-layer')) {
            this.map.setLayoutProperty('accidents-heat-layer', 'visibility', isHeat ? 'visible' : 'none');
        }

        // Renderizar marcadores y clusters DOM sincronizados en 3D
        this.renderMarkers();
    },

    /**
     * Dibuja la simbología informativa en la esquina inferior derecha del mapa
     */
    renderLegend() {
        const el = document.getElementById('map-legend');
        if (!el) return;
        if (window.App.colorMode === 'vehiculo') {
            const vOptions = [
                ['Automóvil', '#00b0ff'],
                ['Motocicleta', '#ff1744'],
                ['Camioneta', '#ff6a00'],
                ['Carga / Pesado', '#ffd600'],
                ['Bicicleta', '#00e676'],
                ['Peatón', '#ff4081'],
                ['Otros', '#94a3b8']
            ];
            el.innerHTML = vOptions.map(([label, col]) => `<span><span class="legend-dot" style="background:${col}"></span>${label}</span>`).join('');
        } else if (window.App.colorMode === 'sev') {
            el.innerHTML = `
                <span><span class="legend-dot" style="background:#00e676"></span>Solo daños</span>
                <span><span class="legend-dot" style="background:#ffd600"></span>Con heridos</span>
                <span><span class="legend-dot" style="background:#ff1744"></span>Fatal</span>
            `;
        } else {
            el.innerHTML = `
                <span><span class="legend-dot" style="background:#00e676"></span>Bueno / Despejado</span>
                <span><span class="legend-dot" style="background:#00b0ff"></span>Lluvia / Nublado</span>
                <span><span class="legend-dot" style="background:#f8fafc"></span>Niebla</span>
                <span><span class="legend-dot" style="background:#ff1744"></span>Malo</span>
                <span><span class="legend-dot" style="background:#64748b"></span>Sin dato</span>
            `;
        }
    },

    /**
     * Alterna la perspectiva 3D (0° vs 60° pitch)
     */
    toggle3D(enable) {
        this.is3D = (enable !== undefined) ? enable : !this.is3D;
        const targetPitch = this.is3D ? 60 : 0;
        this.map.easeTo({ pitch: targetPitch, duration: 800 });

        const btn3D = document.getElementById('tool-3d');
        if (btn3D) {
            btn3D.classList.toggle('active', this.is3D);
            btn3D.innerText = '3D';
        }
    },

    /**
     * Alterna la visibilidad de los edificios 3D
     */
    toggleBuildings(enable) {
        this.showBuildings = (enable !== undefined) ? enable : !this.showBuildings;
        const btn = document.getElementById('tool-buildings');
        if (btn) {
            btn.classList.toggle('active', this.showBuildings);
        }
        this.applyBuildingsVisibility();
    },

    /**
     * Aplica la visibilidad a todas las capas de edificios en el estilo activo
     */
    applyBuildingsVisibility() {
        if (!this.map) return;
        const style = this.map.getStyle();
        if (!style || !style.layers) return;
        const vis = this.showBuildings ? 'visible' : 'none';
        style.layers.forEach(l => {
            if (l.type === 'fill-extrusion' || (l.id && (l.id.includes('building') || l.id.includes('edificio') || l.id.includes('lote') || l.id.includes('manzana')) && l.type !== 'symbol')) {
                try {
                    this.map.setLayoutProperty(l.id, 'visibility', vis);
                } catch (e) { }
            }
        });
    },

    /**
     * Cambia el mapa base activo de forma segura
     */
    setBasemap(key) {
        const style = this.baseStyles[key] || this.baseStyles.dark;
        this.map.setStyle(style);

        const onDone = () => {
            this.setupLayers();
            this.applyBuildingsVisibility();
            const currentData = this.lastFilteredData || (window.DataModule && window.DataModule.filteredData) || (window.DataModule && window.DataModule.allData) || [];
            if (currentData.length > 0) {
                this.updateMap(currentData);
            }
        };

        this.map.once('style.load', onDone);
        this.map.once('idle', onDone);
    },

    /**
     * Conecta todos los eventos de interfaz del mapa (selectores, herramientas de dibujo, botones)
     */
    bindEvents() {
        // Selector de estilo de mapa base
        document.getElementById('basemap-mode').addEventListener('change', (e) => {
            this.setBasemap(e.target.value);
        });

        // Selector de vista (Calor / Puntos)
        document.getElementById('layer-mode').addEventListener('change', (e) => {
            window.App.layerMode = e.target.value;
            window.App.scheduleUpdate();
        });

        // Selector de color
        document.getElementById('color-mode').addEventListener('change', (e) => {
            window.App.colorMode = e.target.value;
            this.renderLegend();
            window.App.scheduleUpdate();
        });

        // Botón 3D
        const btn3D = document.getElementById('tool-3d');
        if (btn3D) {
            btn3D.addEventListener('click', () => {
                this.toggle3D();
            });
        }

        // Botón Edificios 3D
        const btnBld = document.getElementById('tool-buildings');
        if (btnBld) {
            btnBld.addEventListener('click', () => {
                this.toggleBuildings();
            });
        }

        // --- Herramientas de Dibujo Espacial (Rectángulo, Círculo, Polígono) ---
        const exitDrawMode = () => {
            this.drawMode = null;
            this.drawPoints = [];
            this.drawStart = null;
            this.map.dragPan.enable();
            this.map.doubleClickZoom.enable();
            this.map.getCanvas().style.cursor = '';
            document.getElementById('tool-rect').classList.remove('active');
            document.getElementById('tool-circle').classList.remove('active');
            document.getElementById('tool-poly').classList.remove('active');
        };

        const updateSelectionGeoJSON = (geojsonOrCoords) => {
            const src = this.map.getSource('selection-src');
            if (!src) return;
            if (!geojsonOrCoords) {
                src.setData({ type: 'FeatureCollection', features: [] });
                return;
            }

            // Si se pasa un arreglo de coordenadas del anillo cerrado
            if (Array.isArray(geojsonOrCoords)) {
                const ring = geojsonOrCoords;
                const worldBox = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
                const features = [
                    {
                        type: 'Feature',
                        properties: { isMask: true },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [worldBox, ring]
                        }
                    },
                    {
                        type: 'Feature',
                        properties: { isMask: false },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [ring]
                        }
                    }
                ];
                src.setData({ type: 'FeatureCollection', features });
            } else if (geojsonOrCoords.type === 'FeatureCollection') {
                src.setData(geojsonOrCoords);
            } else {
                src.setData({ type: 'FeatureCollection', features: [geojsonOrCoords] });
            }
        };

        const renderPolygonDraft = (currentCursor) => {
            const pts = [...this.drawPoints];
            if (currentCursor) pts.push(currentCursor);
            if (pts.length === 0) {
                updateSelectionGeoJSON(null);
                return;
            }

            const features = [];
            pts.forEach(p => {
                features.push({
                    type: 'Feature',
                    properties: { isMask: false },
                    geometry: { type: 'Point', coordinates: p }
                });
            });

            if (pts.length >= 2) {
                features.push({
                    type: 'Feature',
                    properties: { isMask: false },
                    geometry: { type: 'LineString', coordinates: pts }
                });
            }

            if (pts.length >= 3) {
                const closed = [...pts, pts[0]];
                features.push({
                    type: 'Feature',
                    properties: { isMask: false },
                    geometry: { type: 'Polygon', coordinates: [closed] }
                });
            }

            updateSelectionGeoJSON({ type: 'FeatureCollection', features });
        };

        const finishPolygon = () => {
            if (this.drawPoints.length >= 3) {
                const pts = this.drawPoints.map(p => ({ lat: p[1], lng: p[0] }));
                window.App.selection = { type: 'poly', points: pts };
                const closed = [...this.drawPoints, this.drawPoints[0]];
                updateSelectionGeoJSON(closed);
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            } else {
                exitDrawMode();
                updateSelectionGeoJSON(null);
            }
        };

        // Activadores de herramientas en la barra superior
        document.getElementById('tool-rect').addEventListener('click', (e) => {
            if (this.drawMode === 'rect') { exitDrawMode(); return; }
            exitDrawMode();
            this.drawMode = 'rect';
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });

        document.getElementById('tool-circle').addEventListener('click', (e) => {
            if (this.drawMode === 'circle') { exitDrawMode(); return; }
            exitDrawMode();
            this.drawMode = 'circle';
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });

        document.getElementById('tool-poly').addEventListener('click', (e) => {
            if (this.drawMode === 'poly') { exitDrawMode(); return; }
            exitDrawMode();
            this.drawMode = 'poly';
            this.drawPoints = [];
            this.map.doubleClickZoom.disable();
            this.map.getCanvas().style.cursor = 'crosshair';
            e.currentTarget.classList.add('active');
        });

        // Eventos de Mouse en el Mapa para Selección Espacial
        this.map.on('mousedown', (e) => {
            if (this.drawMode === 'rect' || this.drawMode === 'circle') {
                this.drawStart = [e.lngLat.lng, e.lngLat.lat];
            }
        });

        this.map.on('mousemove', (e) => {
            if (this.drawMode === 'rect' && this.drawStart) {
                const [minLng, maxLng] = [Math.min(this.drawStart[0], e.lngLat.lng), Math.max(this.drawStart[0], e.lngLat.lng)];
                const [minLat, maxLat] = [Math.min(this.drawStart[1], e.lngLat.lat), Math.max(this.drawStart[1], e.lngLat.lat)];
                const ring = [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
                updateSelectionGeoJSON({
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        properties: { isMask: false },
                        geometry: { type: 'Polygon', coordinates: [ring] }
                    }]
                });
            } else if (this.drawMode === 'circle' && this.drawStart) {
                const rDeg = Math.hypot(e.lngLat.lng - this.drawStart[0], e.lngLat.lat - this.drawStart[1]);
                const ring = [];
                for (let i = 0; i <= 36; i++) {
                    const a = (i / 36) * Math.PI * 2;
                    ring.push([this.drawStart[0] + Math.cos(a) * rDeg, this.drawStart[1] + Math.sin(a) * rDeg]);
                }
                updateSelectionGeoJSON({
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        properties: { isMask: false },
                        geometry: { type: 'Polygon', coordinates: [ring] }
                    }]
                });
            } else if (this.drawMode === 'poly' && this.drawPoints.length > 0) {
                renderPolygonDraft([e.lngLat.lng, e.lngLat.lat]);
            }
        });

        this.map.on('click', (e) => {
            if (this.drawMode === 'poly') {
                if (this.drawPoints.length >= 3) {
                    const firstPt = this.drawPoints[0];
                    const p1 = this.map.project([firstPt[0], firstPt[1]]);
                    const p2 = this.map.project([e.lngLat.lng, e.lngLat.lat]);
                    if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 18) {
                        finishPolygon();
                        return;
                    }
                }
                this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
                renderPolygonDraft();
            }
        });

        this.map.on('dblclick', (e) => {
            if (this.drawMode === 'poly') {
                e.preventDefault();
                finishPolygon();
            }
        });

        this.map.on('contextmenu', (e) => {
            if (this.drawMode === 'poly') {
                e.preventDefault();
                finishPolygon();
            }
        });

        this.map.on('mouseup', (e) => {
            if (this.drawMode === 'rect' && this.drawStart) {
                const [minLng, maxLng] = [Math.min(this.drawStart[0], e.lngLat.lng), Math.max(this.drawStart[0], e.lngLat.lng)];
                const [minLat, maxLat] = [Math.min(this.drawStart[1], e.lngLat.lat), Math.max(this.drawStart[1], e.lngLat.lat)];
                window.App.selection = { type: 'rect', s: minLat, n: maxLat, w: minLng, e: maxLng };
                const ring = [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
                updateSelectionGeoJSON(ring);
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            } else if (this.drawMode === 'circle' && this.drawStart) {
                const haversineMeters = (lat1, lon1, lat2, lon2) => {
                    const R = 6371000, toRad = Math.PI / 180;
                    const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
                    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
                    return 2 * R * Math.asin(Math.sqrt(a));
                };
                const radiusMeters = haversineMeters(this.drawStart[1], this.drawStart[0], e.lngLat.lat, e.lngLat.lng);
                window.App.selection = { type: 'circle', lat: this.drawStart[1], lng: this.drawStart[0], r: radiusMeters };
                const rDeg = Math.hypot(e.lngLat.lng - this.drawStart[0], e.lngLat.lat - this.drawStart[1]);
                const ring = [];
                for (let i = 0; i <= 36; i++) {
                    const a = (i / 36) * Math.PI * 2;
                    ring.push([this.drawStart[0] + Math.cos(a) * rDeg, this.drawStart[1] + Math.sin(a) * rDeg]);
                }
                updateSelectionGeoJSON(ring);
                exitDrawMode();
                document.getElementById('selection-badge').classList.add('show');
                window.App.scheduleUpdate();
            }
        });

        // Limpiar selección espacial
        const clearSelection = () => {
            window.App.selection = null;
            updateSelectionGeoJSON(null);
            exitDrawMode();
            document.getElementById('selection-badge').classList.remove('show');
            window.App.scheduleUpdate();
        };

        document.getElementById('tool-clear').addEventListener('click', clearSelection);
        document.getElementById('selection-clear-x').addEventListener('click', clearSelection);

        window.addEventListener('keydown', (e) => {
            if (this.drawMode === 'poly') {
                if (e.key === 'Enter') finishPolygon();
                if (e.key === 'Escape') clearSelection();
            }
        });
    }
};
