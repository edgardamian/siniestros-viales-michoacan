# 📘 BITÁCORA DE DESARROLLO Y ARQUITECTURA TÉCNICA
## Tablero Interactivo de Siniestros Viales · Michoacán (2016–2026)

**Elaborado por:** Edgar Mora (`edgar.mora.d@gmail.com` · `@edgar_rllr`)  
**Organizaciones:** COEPRA Michoacán · Seguridad Vial Michoacán · IMPLAN Morelia  
**Volumen de datos:** 55,052 siniestros viales georreferenciados.

---

## 🏛️ 1. Ecosistema de Repositorios y Despliegue

| Repositorio / Enlace | Tipo | Descripción |
| :--- | :---: | :--- |
| **[siniestros-viales-michoacan](https://github.com/edgardamian/siniestros-viales-michoacan)** | 🔒 **Privado** | **Código fuente original completo**, arquitectura modular (`js/`, `css/`, `index.html`), comentarios, historial de desarrollo y scripts de compilación. |
| **[siniestros-viales-michoacan-publico](https://github.com/edgardamian/siniestros-viales-michoacan-publico)** | 🌍 **Público** | **Versión de producción protegida y ofuscada** para consulta de usuarios y tomadores de decisiones. |
| **[Sitio en Vivo (GitHub Pages)](https://edgardamian.github.io/siniestros-viales-michoacan-publico/)** | 🌐 **Web** | Despliegue en vivo accesible desde cualquier navegador, tableta o smartphone. |

---

## 📂 2. Estructura del Proyecto

```text
3T_DASH_ACCIDENTES/
├── index.html                   # Maquetación principal en 3 columnas y estructura semántica
├── BITACORA_DESARROLLO.md       # Esta bitácora técnica de respaldo
├── build_produccion.js          # Script automatizado de compilación y ofuscación
│
├── css/
│   └── style.css                # Sistema de diseño (Dark theme, glassmorphism, responsive)
│
├── js/
│   ├── data.js                  # Motor de datos en memoria y cálculo analítico
│   ├── map.js                   # Motor geoespacial (MapLibre GL 3D, edificios, calor, clusters)
│   ├── charts.js                # Motor de gráficas (Chart.js + Heatmap 7x24)
│   ├── filters.js               # Control de filtros, chips, range sliders y exportación
│   ├── player.js                # Reproductor temporal (Modos Horas, Días, Meses)
│   ├── reorder.js               # Sistema Drag & Drop con persistencia en LocalStorage
│   └── app.js                   # Coordinador central de la aplicación
│
├── data/
│   ├── accidentes_limpio_actualizado.csv  # Base de datos principal de siniestros
│   ├── vehiculos.csv                      # Catálogo relacional de vehículos involucrados
│   └── muni_bounds.json                   # Polígonos de límites municipales
│
└── produccion/                  # 🔒 Versión compilada y ofuscada para despliegue
    ├── index.html
    ├── css/style.css
    ├── js/ (data.js, map.js, charts.js, filters.js, player.js, reorder.js, app.js ofuscados)
    └── data/
```

---

## ⚙️ 3. Módulos y Arquitectura del Sistema

### 1. Motor de Datos (`js/data.js`)
* Carga simultánea y asíncrona con `PapaParse` de `accidentes_limpio_actualizado.csv`, `vehiculos.csv` y `muni_bounds.json`.
* Cruza por `id_accidente` los tipos de vehículos involucrados.
* Pre-calcula campos numéricos (`wkIdx`, `sevVal`, `monthKey`, `hora_redondeada`) para permitir filtrados instantáneos de 55,000+ filas en < 15 milisegundos.
* Métodos analíticos: `getKPIs()`, `getTrendData()`, `getTopVehiculos()`, `getTopTipos()`, `getTopColonias()`, `getClockData()`, `getRiskMatrixData()`.

### 2. Motor Geoespacial (`js/map.js`)
* Construido con **MapLibre GL JS** en proyección 3D con inclinación (*pitch: 45°*).
* Edificios 3D extruidos en tiempo real usando datos de MapTiler/OSM.
* Capas intercambiables: **Puntos individuales coloreados por severidad**, **Mapa de Calor (Heatmap)** y **Agrupaciones (Clusters)**.
* Soporte de estilos de mapa base: Carto Dark Matter, Positron, OSM Raster y Satelital.
* Control de opacidad interactivo con deslizador.

### 3. Motor de Gráficas (`js/charts.js`)
* **Gráfica de Horas (00 a 23 h)**: Clasificación de colores según volumen respecto al pico (<75% Azul, ≥75% Amarillo, 100% Rojo Pico).
* **Días de la Semana (Lun a Dom)**: Barras interactivas con cálculo del día más crítico y botones de preselección rápida (*Todos, Lun-Vie, Sáb-Dom*).
* **Tendencia Mensual (2016–2026)**: Doble línea (Siniestros Totales en Amarillo y Víctimas Fatales en Rojo) sincronizada con slider doble de años.
* **Matriz de Riesgo Temporal (7 Días × 24 Horas)**: 168 celdas con gradiente térmico de 4 niveles (*Verde, Amarillo, Naranja, Rojo Crítico*).
* **Gráficas de Barra Horizontal**: Tipos de vehículo y Tipos de incidente con escalado proporcional.
* **Gráfica de Dona**: Proporción de severidad (*Solo daños, Con heridos, Fatal*).
* **Lista Scrollable**: Top 50 colonias con mayor siniestralidad.

### 4. Motor de Reordenamiento Drag & Drop (`js/reorder.js`)
* Permite arrastrar y reordenar cualquier tarjeta en las 3 columnas.
* **Activación estricta solo en agarraderas (`⋮⋮`)** para evitar interferencias al mover sliders o interactuar con gráficas.
* Guarda y restaura el orden del usuario automáticamente en `localStorage` (`dash_sidebar_order`, `dash_right_order`, `dash_center_order`).

### 5. Reproductor Temporal (`js/player.js`)
* Animación interactiva paso a paso con scrubber manual, control de velocidad (1x, 2x, 4x) y botones *Anterior / Play / Siguiente*.
* 3 Modos de reproducción: **Horas (00 a 23 h)**, **Días de la semana (Lun a Dom)** y **Meses (Ene 2016 a Dic 2026)**.

---

## 🎨 4. Reglas de Color y Algoritmos Analíticos

### A. Algoritmo de la Gráfica de Horas:
$$\text{Ratio} = \frac{\text{Conteo de la Hora } h}{\text{Máximo Conteo Horario}}$$
* **🔴 Rojo (`#ff1744`)**: Hora pico máxima absoluta ($h = \text{PeakHour}$).
* **🟡 Amarillo (`#ffd600`)**: Horas con volumen $\ge 75\%$ del máximo.
* **🔵 Azul (`#00b0ff`)**: Horas con volumen regular $< 75\%$.

### B. Algoritmo de la Matriz Térmica (7 Días × 24 Horas):
$$\text{Ratio}(d, h) = \frac{\text{Siniestros}(d, h)}{\text{Pico Máximo Global}}$$
* 🟢 **0% a 20%**: Verde esmeralda (`rgba(0, 230, 118, 0.35)`) ➔ *Riesgo Bajo*.
* 🟡 **20% a 45%**: Amarillo señal (`rgba(255, 214, 0, 0.65)`) ➔ *Riesgo Moderado*.
* 🟠 **45% a 75%**: Naranja cono (`rgba(255, 106, 0, 0.85)`) ➔ *Riesgo Alto*.
* 🔴 **75% a 100%**: Rojo señal con resplandor (`rgba(255, 23, 68, 0.95)`) ➔ *Pico Crítico*.

---

## 🔄 5. Guía de Comandos para Mantenimiento y Despliegue

### Actualización completa en 1 solo comando (PowerShell):
```powershell
node build_produccion.js; git add -A; git commit -m "Actualizar cambios"; git push privado maplibre-3d:main; git branch -D prod-deploy; git subtree split --prefix produccion -b prod-deploy; git push publico prod-deploy:main --force; git push publico prod-deploy:gh-pages --force
```

### O paso a paso:
1. **Recompilar producción**: `node build_produccion.js`
2. **Commit en Git local**: `git add -A; git commit -m "Mensaje de cambios"`
3. **Subir al repositorio privado**: `git push privado maplibre-3d:main`
4. **Desplegar al repositorio público**:
   ```bash
   git branch -D prod-deploy
   git subtree split --prefix produccion -b prod-deploy
   git push publico prod-deploy:main --force
   git push publico prod-deploy:gh-pages --force
   ```

---

## 🎓 6. Plan Temático del Curso Paso a Paso (Futuro)

* **Módulo 1: Carga y Procesamiento de Datos** (PapaParse, estructuras en memoria, normalización de campos).
* **Módulo 2: Visualización Geoespacial** (MapLibre GL, capas de calor, clusters, polígonos GeoJSON y edificios 3D).
* **Módulo 3: Creación de Gráficas Analíticas** (Chart.js, matrices de calor custom, donas, barras reactivas).
* **Módulo 4: Sistema de Filtros Cruzados** (Lógica relacional rápida, búsqueda en tiempo real, sliders de rango doble).
* **Módulo 5: Reproductor Temporal y Animaciones** (Líneas de tiempo, scrubber interactivo, renderizado dinámico).
* **Módulo 6: UX/UI Avanzada y Drag & Drop** (Reordenamiento de interfaz, persistencia en LocalStorage y empaquetado para producción).
