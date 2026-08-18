/**
 * ==============================================================================
 * SCRIPT: build_produccion.js
 * DESCRIPCIÓN: Empaquetador y Ofuscador automatizado para el Dashboard.
 * Genera la versión protegida para producción en la carpeta /produccion.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const PROD_DIR = path.join(ROOT_DIR, 'produccion');

console.log('🚀 Iniciando compilación y ofuscación para producción...\n');

// 1. Crear directorios de producción
const dirs = [
    PROD_DIR,
    path.join(PROD_DIR, 'js'),
    path.join(PROD_DIR, 'css'),
    path.join(PROD_DIR, 'data')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 2. Copiar base de datos CSV
const csvSource = path.join(ROOT_DIR, 'data', 'accidentes_limpio_actualizado.csv');
const csvDest = path.join(PROD_DIR, 'data', 'accidentes_limpio_actualizado.csv');
if (fs.existsSync(csvSource)) {
    fs.copyFileSync(csvSource, csvDest);
    const sizeMb = (fs.statSync(csvDest).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Base de datos copiada: data/accidentes_limpio_actualizado.csv (${sizeMb} MB)`);
} else {
    console.warn(`⚠️ No se encontró: ${csvSource}`);
}

// 3. Minificar CSS
const cssSource = path.join(ROOT_DIR, 'css', 'style.css');
const cssDest = path.join(PROD_DIR, 'css', 'style.css');
if (fs.existsSync(cssSource)) {
    let cssContent = fs.readFileSync(cssSource, 'utf-8');
    // Minificación básica: eliminar comentarios y espacios redundantes
    cssContent = cssContent
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([\{\}\:\;\,])\s*/g, '$1')
        .replace(/;}/g, '}');
    fs.writeFileSync(cssDest, cssContent, 'utf-8');
    console.log('✅ Hoja de estilos minificada: css/style.css');
}

// 4. Ofuscar cada archivo JavaScript
const jsFiles = [
    'data.js',
    'map.js',
    'charts.js',
    'filters.js',
    'player.js',
    'reorder.js',
    'app.js'
];

jsFiles.forEach(file => {
    const inputPath = path.join(ROOT_DIR, 'js', file);
    const outputPath = path.join(PROD_DIR, 'js', file);

    if (!fs.existsSync(inputPath)) {
        console.warn(`⚠️ Archivo no encontrado: ${inputPath}`);
        return;
    }

    console.log(`🔒 Ofuscando módulo: js/${file}...`);
    const cmd = `npx.cmd javascript-obfuscator "${inputPath}" --output "${outputPath}" --compact true --control-flow-flattening true --control-flow-flattening-threshold 0.65 --string-array true --string-array-encoding base64 --string-array-threshold 0.75 --rename-globals false --target browser`;

    try {
        execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe' });
        console.log(`   └─ Listo: produccion/js/${file}`);
    } catch (err) {
        console.error(`❌ Error al ofuscar ${file}:`, err.message);
        // Fallback: copiar original si falla
        fs.copyFileSync(inputPath, outputPath);
    }
});

// 5. Copiar index.html
const htmlSource = path.join(ROOT_DIR, 'index.html');
const htmlDest = path.join(PROD_DIR, 'index.html');
if (fs.existsSync(htmlSource)) {
    fs.copyFileSync(htmlSource, htmlDest);
    console.log('✅ Estructura HTML copiada: produccion/index.html');
}

console.log('\n🎉 ¡Compilación terminada con éxito!');
console.log('📂 La versión de producción está lista en: /produccion');
