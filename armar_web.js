#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — armado de la versión web
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * armar_web.js — arma los archivos del sitio público (GitHub Pages) a partir del Tablero y de web/pierri_web.js.
 *
 * El sitio no lleva datos: los datos los guarda el propio sitio, cifrados, en la carpeta datos/ del repositorio público.
 * Lo que sí haría falta cuidar es el código: el Tablero trae adentro tres resoluciones reales como ejemplo para el
 * modelo (EJEMPLOS). Acá se sacan, y el armado se corta si queda en la salida algún nombre o número de ellas.
 *
 * Uso:
 *   node armar_web.js --salida ../relevamiento-pierri [--owner cornabalta3-web] [--repo relevamiento-pierri] [--rama main]
 * Escribe index.html, pierri_web.js, robots.txt y .nojekyll. No toca la carpeta datos/ de la salida.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function args() {
  const a = process.argv.slice(2), o = { salida: path.join(__dirname, 'sitio'), owner: 'cornabalta3-web', repo: 'relevamiento-pierri', rama: 'main' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    if (['salida', 'owner', 'repo', 'rama'].includes(k)) o[k] = a[++i];
  }
  return o;
}

/** Devuelve [inicio, fin) del arreglo literal que empieza en `desde` (el "["), saltando strings y comentarios. */
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

function sacarEjemplos(html) {
  const ancla = 'const EJEMPLOS = [';
  if (html.split(ancla).length !== 2) throw new Error('no encuentro EJEMPLOS en el Tablero (¿cambió?)');
  const ini = html.indexOf(ancla) + ancla.length - 1, fin = finDelArreglo(html, ini);
  const quitado = html.slice(ini, fin);
  // Lo que identifica a las personas de los ejemplos: nombres en mayúscula con coma y números de 7 u 8 cifras.
  const huellas = new Set([...(quitado.match(/\b\d{7,8}\b/g) || []), ...(quitado.match(/[A-ZÁÉÍÓÚÑ]{3,}, [A-ZÁÉÍÓÚÑ ]{3,}/g) || [])]);
  const limpio = html.slice(0, ini) + '[]; // la versión web no publica los ejemplos reales que usa el modelo' + html.slice(fin).replace(/^;/, '');
  for (const h of huellas) if (limpio.includes(h)) throw new Error('quedó un dato de los ejemplos en el Tablero: ' + h.replace(/\d(?=\d{2})/g, '•'));
  return { html: limpio, huellas: huellas.size };
}

function main() {
  const O = args();
  let html = fs.readFileSync(path.join(__dirname, 'tablero_pierri.html'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, 'web', 'pierri_web.js'), 'utf8');
  const s = sacarEjemplos(html);
  html = s.html;
  const anclaMain = "<script>\n(function(){\n'use strict';\nconst P = window.PierriCore;";
  if (html.split(anclaMain).length !== 2) throw new Error('no encuentro el script principal del Tablero (¿cambió?)');
  const repo = JSON.stringify({ owner: O.owner, repo: O.repo, rama: O.rama });
  html = html.replace(anclaMain, () => `<script>window.PIERRI_WEB_REPO = ${repo};</script>\n<script src="pierri_web.js"></script>\n` + anclaMain)
    .replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');
  fs.mkdirSync(O.salida, { recursive: true });
  fs.writeFileSync(path.join(O.salida, 'index.html'), html);
  fs.writeFileSync(path.join(O.salida, 'pierri_web.js'), web);
  fs.writeFileSync(path.join(O.salida, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync(path.join(O.salida, '.nojekyll'), '');
  console.log(`Listo en ${O.salida}: index.html, pierri_web.js, robots.txt, .nojekyll (${s.huellas} datos de ejemplo verificados afuera).`);
}

try { main(); } catch (e) { console.error('No se pudo armar la web: ' + e.message); process.exit(1); }
