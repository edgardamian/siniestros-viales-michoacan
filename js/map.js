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
    isFullscreen: false,
    layerOpacity: 0.85,
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

        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.style.setProperty('--markers-opacity', this.layerOpacity);
        }

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
                        'heatmap-opacity': this.layerOpacity
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
     * Alterna la vista de pantalla completa para el mapa
     */
    toggleFullscreen(enable) {
        this.isFullscreen = (enable !== undefined) ? enable : !this.isFullscreen;
        const panel = document.querySelector('.map-panel');
        const expandIcon = document.getElementById('fs-icon-expand');
        const compressIcon = document.getElementById('fs-icon-compress');
        const btnFs = document.getElementById('tool-fullscreen');

        if (panel) {
            panel.classList.toggle('is-fullscreen', this.isFullscreen);
        }
        if (btnFs) {
            btnFs.classList.toggle('active', this.isFullscreen);
        }
        if (expandIcon && compressIcon) {
            expandIcon.style.display = this.isFullscreen ? 'none' : 'block';
            compressIcon.style.display = this.isFullscreen ? 'block' : 'none';
        }

        // Redimensionar el motor MapLibre GL
        setTimeout(() => {
            if (this.map) this.map.resize();
        }, 50);
        setTimeout(() => {
            if (this.map) this.map.resize();
        }, 300);
    },

    /**
     * Ajusta la opacidad / transparencia de la capa de calor y los puntos
     */
    setOpacity(val) {
        this.layerOpacity = Math.max(0.1, Math.min(1.0, val));
        if (this.map && this.map.getLayer('accidents-heat-layer')) {
            try {
                this.map.setPaintProperty('accidents-heat-layer', 'heatmap-opacity', this.layerOpacity);
            } catch (e) { }
        }
        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.style.setProperty('--markers-opacity', this.layerOpacity);
        }
        const txt = document.getElementById('opacity-val-text');
        if (txt) {
            txt.textContent = `${Math.round(this.layerOpacity * 100)}%`;
        }
    },

    /**
     * Centra y ajusta la cámara del mapa a la extensión geográfica de los accidentes de un municipio
     */
    flyToMunicipality(municipio) {
        if (!this.map || !municipio) return;
        const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const target = norm(municipio);

        const dataMod = (typeof DataModule !== 'undefined' ? DataModule : (window.DataModule || {}));

        // 1. Buscar en el diccionario precalculado de límites por municipio
        let b = (dataMod && dataMod.muniBounds) ? dataMod.muniBounds[target] : null;

        // 2. Si no se encontró en el precalculado, buscar en tiempo real en allData
        if (!b && dataMod && dataMod.allData) {
            let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity, count = 0;
            const data = dataMod.allData;
            for (let i = 0; i < data.length; i++) {
                const d = data[i];
                if (norm(d.municipio) === target) {
                    const lng = +d.lon;
                    const lat = +d.lat;
                    if (!isNaN(lng) && !isNaN(lat)) {
                        if (lng < minLng) minLng = lng;
                        if (lng > maxLng) maxLng = lng;
                        if (lat < minLat) minLat = lat;
                        if (lat > maxLat) maxLat = lat;
                        count++;
                    }
                }
            }
            if (count > 0) {
                b = { minLng, maxLng, minLat, maxLat, count };
            }
        }

        if (!b) {
            console.warn(`No se encontraron coordenadas para el municipio: ${municipio}`);
            return;
        }

        if (b.minLng === b.maxLng && b.minLat === b.maxLat) {
            this.map.flyTo({
                center: [b.minLng, b.minLat],
                zoom: 14,
                duration: 1000
            });
        } else {
            this.map.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], {
                padding: { top: 60, bottom: 60, left: 60, right: 60 },
                maxZoom: 15,
                duration: 1000
            });
        }
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

        // Botón Pantalla Completa
        const btnFs = document.getElementById('tool-fullscreen');
        if (btnFs) {
            btnFs.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isFullscreen) {
                this.toggleFullscreen(false);
            }
        });

        // Control y Popover de Opacidad
        const btnOp = document.getElementById('tool-opacity');
        const popoverOp = document.getElementById('opacity-popover');
        const sliderOp = document.getElementById('layer-opacity-slider');

        if (btnOp && popoverOp) {
            btnOp.addEventListener('click', (e) => {
                e.stopPropagation();
                popoverOp.classList.toggle('show');
                btnOp.classList.toggle('active', popoverOp.classList.contains('show'));
            });

            document.addEventListener('click', (e) => {
                if (!popoverOp.contains(e.target) && e.target !== btnOp) {
                    popoverOp.classList.remove('show');
                    btnOp.classList.remove('active');
                }
            });
        }

        if (sliderOp) {
            sliderOp.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value) / 100;
                this.setOpacity(v);
            });
        }

        // --- Herramientas de Dibujo Espacial (Rectángulo, Círculo, Polígono - Táctil y Mouse) ---
        const hintEl = document.getElementById('draw-hint');
        const hintTextEl = document.getElementById('draw-hint-text');
        const finishBtnEl = document.getElementById('draw-finish-btn');
        const cancelBtnEl = document.getElementById('draw-cancel-btn');

        const showHint = (text, showFinish = false) => {
            if (hintEl && hintTextEl) {
                hintTextEl.textContent = text;
                if (finishBtnEl) finishBtnEl.style.display = showFinish ? 'inline-block' : 'none';
                hintEl.classList.add('show');
            }
        };

        const hideHint = () => {
            if (hintEl) hintEl.classList.remove('show');
        };

        const exitDrawMode = () => {
            this.drawMode = null;
            this.drawPoints = [];
            this.drawStart = null;
            this.startScreenPos = null;
            this.isDraggingShape = false;

            if (this.map) {
                this.map.dragPan.enable();
                this.map.touchZoomRotate.enable();
                this.map.doubleClickZoom.enable();
                const canvas = this.map.getCanvas();
                if (canvas) {
                    canvas.style.cursor = '';
                    canvas.style.touchAction = '';
                }
            }

            hideHint();
            const btnR = document.getElementById('tool-rect');
            const btnC = document.getElementById('tool-circle');
            const btnP = document.getElementById('tool-poly');
            if (btnR) btnR.classList.remove('active');
            if (btnC) btnC.classList.remove('active');
            if (btnP) btnP.classList.remove('active');
        };

        const updateSelectionGeoJSON = (geojsonOrCoords) => {
            const src = this.map.getSource('selection-src');
            if (!src) return;
            if (!geojsonOrCoords) {
                src.setData({ type: 'FeatureCollection', features: [] });
                return;
            }

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

        const finishRect = (p1, p2) => {
            const [minLng, maxLng] = [Math.min(p1[0], p2[0]), Math.max(p1[0], p2[0])];
            const [minLat, maxLat] = [Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1])];
            window.App.selection = { type: 'rect', s: minLat, n: maxLat, w: minLng, e: maxLng };
            const ring = [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
            updateSelectionGeoJSON(ring);
            exitDrawMode();
            document.getElementById('selection-badge').classList.add('show');
            window.App.scheduleUpdate();
        };

        const haversineMeters = (lat1, lon1, lat2, lon2) => {
            const R = 6371000, toRad = Math.PI / 180;
            const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        };

        const finishCircle = (center, edge) => {
            const radiusMeters = haversineMeters(center[1], center[0], edge[1], edge[0]);
            window.App.selection = { type: 'circle', lat: center[1], lng: center[0], r: radiusMeters };
            const rDeg = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
            const ring = [];
            for (let i = 0; i <= 36; i++) {
                const a = (i / 36) * Math.PI * 2;
                ring.push([center[0] + Math.cos(a) * rDeg, center[1] + Math.sin(a) * rDeg]);
            }
            updateSelectionGeoJSON(ring);
            exitDrawMode();
            document.getElementById('selection-badge').classList.add('show');
            window.App.scheduleUpdate();
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
        const startDrawMode = (mode) => {
            if (this.drawMode === mode) { exitDrawMode(); return; }
            exitDrawMode();
            this.drawMode = mode;
            this.drawPoints = [];
            this.drawStart = null;
            this.map.dragPan.disable();
            this.map.touchZoomRotate.disable();
            this.map.doubleClickZoom.disable();

            const canvas = this.map.getCanvas();
            if (canvas) {
                canvas.style.cursor = 'crosshair';
                canvas.style.touchAction = 'none';
            }

            if (mode === 'rect') {
                document.getElementById('tool-rect').classList.add('active');
                showHint('Toca 2 puntos opuestos (o arrastra con el ratón)');
            } else if (mode === 'circle') {
                document.getElementById('tool-circle').classList.add('active');
                showHint('Toca el centro y luego la distancia (o arrastra con el ratón)');
            } else if (mode === 'poly') {
                document.getElementById('tool-poly').classList.add('active');
                showHint('Toca los vértices. Mínimo 3 puntos para cerrar.', false);
            }
        };

        document.getElementById('tool-rect').addEventListener('click', () => startDrawMode('rect'));
        document.getElementById('tool-circle').addEventListener('click', () => startDrawMode('circle'));
        document.getElementById('tool-poly').addEventListener('click', () => startDrawMode('poly'));

        if (finishBtnEl) {
            finishBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.drawMode === 'poly') finishPolygon();
            });
        }
        if (cancelBtnEl) {
            cancelBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                exitDrawMode();
                updateSelectionGeoJSON(null);
            });
        }

        // --- Eventos en el Mapa para Selección Espacial (Mouse y Touch) ---
        this.map.on('mousedown', (e) => {
            if (this.drawMode === 'rect' || this.drawMode === 'circle') {
                this.startScreenPos = { x: e.point.x, y: e.point.y };
                if (!this.drawStart) {
                    this.drawStart = [e.lngLat.lng, e.lngLat.lat];
                    this.isDraggingShape = true;
                }
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

        this.map.on('mouseup', (e) => {
            if ((this.drawMode === 'rect' || this.drawMode === 'circle') && this.drawStart && this.startScreenPos) {
                const screenDist = Math.hypot(e.point.x - this.startScreenPos.x, e.point.y - this.startScreenPos.y);
                if (screenDist > 18) {
                    // Arrastre confirmado (Drag)
                    if (this.drawMode === 'rect') finishRect(this.drawStart, [e.lngLat.lng, e.lngLat.lat]);
                    else finishCircle(this.drawStart, [e.lngLat.lng, e.lngLat.lat]);
                } else {
                    // Clic o toque discreto (Tap 1)
                    this.isDraggingShape = false;
                    if (this.drawMode === 'rect') {
                        showHint('Punto 1 fijado. Toca la esquina opuesta para completar el rectángulo.');
                    } else {
                        showHint('Centro fijado. Toca otro punto para definir el radio.');
                    }
                    // Dibujar punto inicial
                    updateSelectionGeoJSON({
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            properties: { isMask: false },
                            geometry: { type: 'Point', coordinates: this.drawStart }
                        }]
                    });
                }
            }
        });

        this.map.on('click', (e) => {
            if (this.drawMode === 'rect') {
                if (this.drawStart && !this.isDraggingShape) {
                    const degDist = Math.hypot(e.lngLat.lng - this.drawStart[0], e.lngLat.lat - this.drawStart[1]);
                    if (degDist > 0.0001) {
                        finishRect(this.drawStart, [e.lngLat.lng, e.lngLat.lat]);
                    }
                }
            } else if (this.drawMode === 'circle') {
                if (this.drawStart && !this.isDraggingShape) {
                    const degDist = Math.hypot(e.lngLat.lng - this.drawStart[0], e.lngLat.lat - this.drawStart[1]);
                    if (degDist > 0.0001) {
                        finishCircle(this.drawStart, [e.lngLat.lng, e.lngLat.lat]);
                    }
                }
            } else if (this.drawMode === 'poly') {
                if (this.drawPoints.length >= 3) {
                    const firstPt = this.drawPoints[0];
                    const p1 = this.map.project([firstPt[0], firstPt[1]]);
                    const p2 = this.map.project([e.lngLat.lng, e.lngLat.lat]);
                    if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 22) {
                        finishPolygon();
                        return;
                    }
                }
                this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
                renderPolygonDraft();
                showHint(`Polígono: ${this.drawPoints.length} puntos. ${this.drawPoints.length >= 3 ? 'Toca "✓ Terminar" o el primer punto.' : 'Toca más puntos.'}`, this.drawPoints.length >= 3);
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
                if (e.key === 'Escape') exitDrawMode();
            } else if (this.drawMode) {
                if (e.key === 'Escape') exitDrawMode();
            }
        });
    }
};

window.MapModule = MapModule;
