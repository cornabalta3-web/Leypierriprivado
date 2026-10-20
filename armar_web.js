#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — armado de la versión web
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * armar_web.js — arma los archivos del sitio público (GitHub Pages) a partir del Tablero y de web/pierri_web.js.
 *
 * El sitio no lleva datos: los guarda el propio sitio, cifrados, en la carpeta datos/ del repositorio público.
 * Lo que hay que cuidar es el código, que queda a la vista:
 *   - el Tablero trae tres resoluciones reales como ejemplo para el modelo (EJEMPLOS) y las instrucciones del modelo
 *     (PROMPT_SISTEMA) citan frases de ellas. La web no usa el modelo: se sacan las dos cosas;
 *   - después se barre todo lo que se publica buscando cualquier cosa con forma de DNI, CUIL, expediente, cuenta o
 *     matrícula, y cualquier rastro de los ejemplos. Si aparece algo que no está en la lista de números inventados,
 *     el armado se corta;
 *   - Leaflet (el mapa), pdf.js (leer y mostrar los PDF) y SheetJS (leer el Padrón) se sirven desde el propio sitio,
 *     no desde un CDN, y la página declara con quién puede hablar (Content-Security-Policy): sí misma, GitHub (la API y
 *     los PDF cifrados) y Catastro.
 *   - Las reglas de lectura van tal cual las usa el kit (pierri_texto.js, pierri_tomos.js, pierri_base.js; el motor
 *     pierri_core.js ya viene adentro del Tablero): la web y el kit leen igual. pierri_sia.js (la planilla de trámites
 *     de la UEST) es solo de la web.
 *
 * Uso:
 *   node armar_web.js --salida ../relevamiento-pierri [--owner cornabalta3-web] [--repo relevamiento-pierri] [--rama main]
 * Escribe index.html, los .js, localidades_cordoba.json, vendor/, robots.txt y .nojekyll. No toca la carpeta datos/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

// Las reglas de lectura que la web usa tal cual las usa el kit. Se cargan antes de pierri_web.js.
const MODULOS = ['pierri_texto.js', 'pierri_tomos.js', 'pierri_base.js', 'pierri_sia.js'];
// Lo único que se publica de web/vendor. Cualquier otro archivo ahí (una planilla o un PDF de prueba olvidado) corta el armado.
const VENDOR = ['leaflet/leaflet.js', 'leaflet/leaflet.css', 'leaflet/LICENSE', 'leaflet/images/layers.png', 'leaflet/images/layers-2x.png',
  'leaflet/images/marker-icon.png', 'leaflet/images/marker-icon-2x.png', 'leaflet/images/marker-shadow.png',
  'pdfjs/pdf.min.js', 'pdfjs/pdf.worker.min.js', 'pdfjs/LICENSE', 'xlsx/xlsx.full.min.js', 'xlsx/LICENSE', 'pdflib/pdf-lib.min.js', 'pdflib/LICENSE.md'];

// Números de muestra que el código usa a propósito (formatos, ejemplos inventados). Nada más pasa el barrido.
const PERMITIDOS = new Set(['12.345.678', '12345678', '0535-123456/2020', '0535-123456-2020', '20251001', '86400000',
  // Palabras del propio código que tienen la forma "APELLIDO, NOMBRE" (constantes y comentarios, no personas).
  'IDECOR, WFS', 'CSV, COLUMNAS', 'PLANILLA, CATASTRO', 'VACIO, EJEMPLOS', 'SISTEMA, PROMPT', 'DEK, AES', 'TOKEN, JSON',
  // Las columnas del Padrón del Registro, en el mensaje que avisa si faltan.
  'NROUNICO, DIARIO', 'PROCESO, NOMBREPERSONA']);

function args() {
  const a = process.argv.slice(2), o = { salida: path.join(__dirname, 'sitio'), owner: 'cornabalta3-web', repo: 'relevamiento-pierri', rama: 'main' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    if (['salida', 'owner', 'repo', 'rama'].includes(k)) o[k] = a[++i];
  }
  return o;
}

/** Devuelve el fin del arreglo literal que empieza en `desde` (el "["), saltando strings y comentarios. */
function finDelArreglo(txt, desde) {
  let prof = 0;
  for (let i = desde; i < txt.length; i++) {
    const c = txt[i];
    if (c === '/' && txt[i + 1] === '/') { i = txt.indexOf('\n', i); continue; }
    if (c === '/' && txt[i + 1] === '*') { i = txt.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < txt.length && txt[i] !== c; i++) if (txt[i] === '\\') i++;
      continue;
    }
    if (c === '[') prof++;
    else if (c === ']' && --prof === 0) return i + 1;
  }
  throw new Error('no encuentro el final de EJEMPLOS');
}

const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Saca EJEMPLOS y PROMPT_SISTEMA. Devuelve el html y las huellas de los ejemplos (nombres y números) para el barrido. */
function sacarDatosDelModelo(html) {
  const ancla = 'const EJEMPLOS = [';
  if (html.split(ancla).length !== 2) throw new Error('no encuentro EJEMPLOS en el Tablero (¿cambió?)');
  const ini = html.indexOf(ancla) + ancla.length - 1, fin = finDelArreglo(html, ini);
  const quitado = html.slice(ini, fin);
  html = html.slice(0, ini) + '[]; // la versión web no publica los ejemplos reales que usa el modelo' + html.slice(fin).replace(/^;/, '');

  const p0 = html.indexOf('const PROMPT_SISTEMA = `'), p1 = html.indexOf('const PROMPT_USUARIO');
  if (p0 < 0 || p1 < p0 || p1 - p0 > 20000) throw new Error('no encuentro PROMPT_SISTEMA en el Tablero (¿cambió?)');
  html = html.slice(0, p0) + "const PROMPT_SISTEMA = ''; // la web no usa el modelo; las instrucciones citan resoluciones reales\n  " + html.slice(p1);

  // Huellas: cada valor de texto de los ejemplos con 5 dígitos o más (expedientes, cuentas, DNI, matrículas…) y esos
  // dígitos solos; cada nombre completo (con y sin coma) y cada apellido de 6 letras o más; las calles completas.
  const huellas = new Set();
  for (const m of quitado.matchAll(/'([^']*)'/g)) {
    const v = m[1], solo = v.replace(/\D/g, '');
    if (solo.length < 5) continue;
    huellas.add(v); huellas.add(solo);
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (iso) huellas.add(`${iso[3]}/${iso[2]}/${iso[1]}`);
    for (const f of v.match(/\d{2}\/\d{2}\/\d{4}/g) || []) huellas.add(f);
    for (const d of v.match(/\d{5,}/g) || []) huellas.add(d);
  }
  for (const m of quitado.matchAll(/(?:apellido_nombre|nombre|profesional|titular_registral|calle):\s*'([^']+)'/g)) {
    const n = normalizar(m[1]).replace(/\s*\(.*\)\s*/g, '').trim();
    if (n.length >= 8) { huellas.add('#' + n); huellas.add('#' + n.replace(/,/g, '')); }
    const apellido = n.split(',')[0].trim();
    if (n.includes(',') && /^[A-Z ]{6,}$/.test(apellido)) huellas.add(apellido);
  }
  return { html, huellas };
}

/** Corta si en lo publicado aparece algo con forma de dato personal o alguna huella de los ejemplos. */
function barrer(nombre, texto, huellas) {
  const problemas = [];
  const N = '(?<![\\d.])', F = '(?![\\d])';   // sin \\b: el guion bajo de "documento_0535…" es letra para \\b
  const patrones = [
    [new RegExp(N + '\\d{1,2}\\.\\d{3}\\.\\d{3}' + F, 'g'), 'DNI con puntos'],
    [new RegExp(N + '(?:20|23|24|27|30|33|34)-?\\d{8}-?\\d' + F, 'g'), 'CUIL/CUIT'],
    [new RegExp(N + '\\d{3,4}\\D?-[\\d.]{5,9}\\s*[/-]\\s*\\d{2,4}' + F, 'g'), 'expediente'],
    [new RegExp('(?<![\\d.\\-/])\\d{5,7}/(?:19|20)\\d{2}' + F, 'g'), 'expediente sin prefijo'],
    [new RegExp(N + '\\d{2}-\\d{2}-?\\d{3}-?\\d{4,5}/\\d' + F + '|' + N + '\\d{2}-\\d{9}' + F + '|' + N + '\\d{12}' + F, 'g'), 'cuenta'],
    [new RegExp(N + '\\d{2}(?:-\\d{2}){4}-\\d{3}-\\d{3}' + F, 'g'), 'nomenclatura'],
    [/(?:\bL\.?C\.?|\bL\.?E\.?|\bMFR|matr[ií]cula|\bDNI|\bCUIL|\bCUIT)\s*(?:N[°º]?\.?\s*)?\d[\d.]{4,}/gi, 'documento o matrícula'],
    [new RegExp(N + '\\d{7,8}' + F, 'g'), 'número de 7 u 8 cifras'],
    [/(?<![A-ZÁÉÍÓÚÑ])[A-ZÁÉÍÓÚÑ]{3,}, [A-ZÁÉÍÓÚÑ]{3,}(?: [A-ZÁÉÍÓÚÑ]{3,})*/g, 'nombre APELLIDO, NOMBRE'],
  ];
  for (const [re, que] of patrones) for (const m of texto.match(re) || []) if (!PERMITIDOS.has(m.trim())) problemas.push(`${que}: ${m.replace(/\d(?=\d{2})/g, '•')}`);
  const plano = normalizar(texto);
  for (const h of huellas) {
    if (/^\d+$/.test(h)) { if (new RegExp('(?<!\\d)' + h + '(?!\\d)').test(texto) && !PERMITIDOS.has(h)) problemas.push('número de los ejemplos: ' + h.replace(/\d(?=\d{2})/g, '•')); }
    else if (h.startsWith('#')) { if (plano.includes(h.slice(1))) problemas.push('nombre de los ejemplos'); }
    else if (/^[A-Z ]+$/.test(h)) { if (new RegExp('\\b' + h + '\\b').test(plano)) problemas.push('apellido de los ejemplos: ' + h); }
    else if (texto.includes(h)) problemas.push('valor de los ejemplos: ' + h.replace(/\d(?=\d{2})/g, '•'));
  }
  if (problemas.length) throw new Error(`en ${nombre} quedó algo con forma de dato personal:\n  - ` + [...new Set(problemas)].join('\n  - '));
}

/**
 * Los comentarios de las reglas de lectura citan casos reales (números de expediente, de cuenta, fechas, nombres) para
 * que quien mantiene el código sepa de dónde salió cada regla. La web no los necesita: se publican sin las líneas que
 * son enteras de comentario, y lo que queda se barre igual. Se comprueba que el código siga compilando.
 */
function sinComentarios(nombre, txt) {
  const fuera = l => { const t = l.trim(); return t.startsWith('//') || ((t.startsWith('/*') || t.startsWith('*')) && (!t.includes('*/') || t.endsWith('*/'))); };
  const salida = txt.split('\n').filter(l => !fuera(l)).join('\n');
  try { new vm.Script(salida, { filename: nombre }); } catch (e) { throw new Error(`${nombre} sin comentarios no compila (${e.message}): revisá un comentario de bloque raro`); }
  return salida;
}

/** Los archivos de una carpeta, con su ruta relativa (con /). */
function listar(dir, base) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + f.name : f.name;
    if (f.isDirectory()) out.push(...listar(path.join(dir, f.name), rel)); else out.push(rel);
  }
  return out;
}

/**
 * node armar_web.js --instrucciones <archivo>: escribe las instrucciones del modelo (citan resoluciones reales) para
 * cargarlas UNA vez en la web, que las guarda cifradas. Ese archivo no se publica ni se commitea: después se borra.
 */
function instrucciones(destino) {
  const P = require('./pierri_core.js');
  const res = path.resolve(destino);
  if (res.startsWith(path.resolve(__dirname) + path.sep)) throw new Error('las instrucciones no se escriben dentro del repositorio: elegí otra carpeta');
  fs.writeFileSync(res, JSON.stringify({ tipo: 'instrucciones_modelo', version: new Date().toISOString().slice(0, 10), prompt_sistema: P.PROMPT_SISTEMA, prompt_usuario: P.PROMPT_USUARIO }, null, 1));
  console.log(`Instrucciones del modelo en ${res}. Cargalas en la web (Configuración, Cargar instrucciones del modelo) y después borrá el archivo.`);
}

function main() {
  const iInst = process.argv.indexOf('--instrucciones');
  if (iInst > 0) return instrucciones(process.argv[iInst + 1] || 'instrucciones_modelo.json');
  const O = args();
  let html = fs.readFileSync(path.join(__dirname, 'tablero_pierri.html'), 'utf8');
  let web = fs.readFileSync(path.join(__dirname, 'web', 'pierri_web.js'), 'utf8');
  const s = sacarDatosDelModelo(html);
  html = s.html;

  const anclaMain = "<script>\n(function(){\n'use strict';\nconst P = window.PierriCore;";
  if (html.split(anclaMain).length !== 2) throw new Error('no encuentro el script principal del Tablero (¿cambió?)');
  const repo = JSON.stringify({ owner: O.owner, repo: O.repo, rama: O.rama });
  // Cada script lleva la huella de su contenido en la dirección: el navegador no puede mezclar una página nueva con un
  // script viejo guardado de antes (GitHub Pages deja guardar los archivos hasta 10 minutos).
  // (en letras: una tira de dígitos parecería un número de documento para el barrido)
  const huellaDe = txt => crypto.createHash('sha256').update(txt).digest('hex').slice(0, 12).replace(/\d/g, d => 'ghijklmnop'[d]);
  // El lector de planillas corre aparte (un worker) y no lo pide la página sino pierri_web.js: también lleva su huella.
  const planilla = fs.readFileSync(path.join(__dirname, 'web', 'leer_planilla.js'), 'utf8');
  if (web.split("const LECTOR_PLANILLAS = 'leer_planilla.js';").length !== 2) throw new Error('no encuentro dónde pierri_web.js nombra el lector de planillas');
  web = web.replace("const LECTOR_PLANILLAS = 'leer_planilla.js';", `const LECTOR_PLANILLAS = 'leer_planilla.js?v=${huellaDe(planilla)}';`);
  const scripts = MODULOS.map(f => `<script src="${f}?v=${huellaDe(fs.readFileSync(path.join(__dirname, f), 'utf8'))}"></script>`)
    .concat([`<script src="pierri_web.js?v=${huellaDe(web)}"></script>`]).join('\n');
  html = html.replace(anclaMain, () => `<script>window.PIERRI_WEB_REPO = ${repo};</script>\n${scripts}\n` + anclaMain);

  const cssCDN = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">';
  const jsCDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>';
  if (!html.includes(cssCDN) || !html.includes(jsCDN)) throw new Error('no encuentro Leaflet en el Tablero (¿cambió la versión?)');
  html = html.replace(cssCDN, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">').replace(jsCDN, '<script src="vendor/leaflet/leaflet.js"></script>');
  if (/<script[^>]+src="https?:/i.test(html)) throw new Error('quedó algún script cargado de afuera del sitio');

  // Content-Security-Policy: solo corren los scripts propios (los del sitio y los que van adentro de la página, por su huella),
  // las imágenes solo de los servidores de mapas que usa el Tablero, y la página solo habla con sí misma, con GitHub, con
  // Catastro (las parcelas por número de cuenta) y con Anthropic (solo cuando el administrador toca "Completar con el
  // modelo"). Las fuentes data: son las que pdf.js arma al dibujar un PDF.
  const huellasScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  const csp = `default-src 'self'; script-src 'self' ${huellasScripts.join(' ')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://wms.ign.gob.ar https://server.arcgisonline.com https://idecor-ws.mapascordoba.gob.ar; " +
    "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://idecor-ws.mapascordoba.gob.ar https://api.anthropic.com; worker-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
  html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<meta name="robots" content="noindex, nofollow">`);

  barrer('index.html', html, s.huellas);
  barrer('pierri_web.js', web, s.huellas);
  const modulos = MODULOS.map(f => [f, sinComentarios(f, fs.readFileSync(path.join(__dirname, f), 'utf8'))]);
  barrer('leer_planilla.js', planilla, s.huellas);
  const enVendor = listar(path.join(__dirname, 'web', 'vendor')).sort();
  const sobran = enVendor.filter(f => !VENDOR.includes(f)), faltan = VENDOR.filter(f => !enVendor.includes(f));
  if (sobran.length || faltan.length) throw new Error('web/vendor no tiene exactamente lo que se publica.' + (sobran.length ? ' Sobra: ' + sobran.join(', ') + '.' : '') + (faltan.length ? ' Falta: ' + faltan.join(', ') + '.' : ''));
  for (const [f, txt] of modulos) barrer(f, txt, s.huellas);

  fs.mkdirSync(O.salida, { recursive: true });
  fs.writeFileSync(path.join(O.salida, 'index.html'), html);
  fs.writeFileSync(path.join(O.salida, 'pierri_web.js'), web);
  for (const [f, txt] of modulos) fs.writeFileSync(path.join(O.salida, f), txt);
  fs.writeFileSync(path.join(O.salida, 'leer_planilla.js'), planilla);
  // Puntos de las localidades de Catastro (datos geográficos públicos): ubican por localidad lo que no trae cuenta.
  fs.copyFileSync(path.join(__dirname, 'localidades_cordoba.json'), path.join(O.salida, 'localidades_cordoba.json'));
  for (const f of VENDOR) { fs.mkdirSync(path.dirname(path.join(O.salida, 'vendor', f)), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'web', 'vendor', f), path.join(O.salida, 'vendor', f)); }
  fs.writeFileSync(path.join(O.salida, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(O.salida, '.nojekyll'), '');
  console.log(`Listo en ${O.salida}: index.html, pierri_web.js, ${MODULOS.join(', ')}, localidades_cordoba.json, vendor/, robots.txt, .nojekyll (barrido de datos personales sin hallazgos; ${s.huellas.size} huellas de los ejemplos verificadas afuera).`);
}

try { main(); } catch (e) { console.error('No se pudo armar la web: ' + e.message); process.exit(1); }
