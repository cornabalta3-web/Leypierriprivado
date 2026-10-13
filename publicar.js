#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — publicación con clave
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * publicar.js — arma una página para publicar (por ejemplo en GitHub Pages) con el relevamiento adentro, cerrada con clave.
 *
 * Toma el JSON que exporta el Tablero ("Guardar JSON", en Expedientes) y el propio tablero_pierri.html, mete los datos
 * en el Tablero (modo publicado, sin servidor), comprime la página entera y la cifra con AES-256-GCM. La clave se deriva
 * con PBKDF2-SHA256 (600.000 iteraciones). El index.html que sale solo pide la clave: sin ella no se leen ni los datos
 * ni el Tablero. El descifrado lo hace el navegador de quien entra (WebCrypto); la clave no viaja a ningún lado.
 *
 * Uso:
 *   node publicar.js --json .\relevamiento_ley_pierri.json --salida .\publicacion
 * La clave se pide en la consola, dos veces. También se puede pasar con la variable PIERRI_PUBLICAR_CLAVE.
 * También acepta el resultados.jsonl de procesar_lote.js en lugar del JSON del Tablero.
 *
 * Límites: quien tenga la clave puede guardarse una copia. Cambiar la clave es volver a correr esto y subir el
 * index.html nuevo, pero la versión vieja sigue en el historial del repositorio: para cortar el acceso de verdad
 * hay que borrar el repositorio y crear otro.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');

const ITERACIONES = 600000;
const CLAVE_MINIMA = 12;     // mismo mínimo que las contraseñas de usuario (pierri.js, E SIG 004 nivel 2)

function args() {
  const a = process.argv.slice(2), o = { tablero: path.join(__dirname, 'tablero_pierri.html'), salida: path.join(process.cwd(), 'publicacion') };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--json') o.json = a[++i];
    else if (a[i] === '--salida') o.salida = a[++i];
    else if (a[i] === '--tablero') o.tablero = a[++i];
    else if (a[i] === '--ayuda' || a[i] === '-h') o.ayuda = true;
  }
  return o;
}

/** Lee el JSON del Tablero ({resultados, resumen, config, fecha}) o un resultados.jsonl, y devuelve lo mismo normalizado. */
function leerDatos(archivo) {
  const txt = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').trim();
  if (txt.startsWith('{') && !txt.includes('\n{')) {
    const d = JSON.parse(txt);
    if (!d.resultados && d.derivado) return { resultados: [d], resumen: null, fecha: null };   // un .jsonl de una sola línea
    if (!Array.isArray(d.resultados)) throw new Error('el JSON no tiene "resultados": tiene que ser el que baja el botón "Guardar JSON" del Tablero');
    return { resultados: d.resultados, resumen: d.resumen || null, fecha: d.fecha || null };
  }
  const lista = txt.startsWith('[') ? JSON.parse(txt) : txt.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  return { resultados: lista, resumen: null, fecha: null };
}

/** JSON seguro para ir dentro de un <script>: ningún "</script>" ni separadores de línea sueltos. */
const jsonEnScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function armarTablero(tableroHtml, datos) {
  const fecha = new Date(datos.fecha || Date.now());
  const fechaTxt = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
  const info = {
    origen: 'publicado',
    etiqueta: 'copia del ' + fechaTxt,
    titulo: 'Relevamiento publicado',
    sub: `Copia de solo lectura, generada el ${fechaTxt}. Para cargar PDF o corregir hace falta la aplicación.`,
    resumen: datos.resumen || {},
  };
  const inyeccion = `<script>window.DEMO_DATOS = ${jsonEnScript(datos.resultados)};\nwindow.DEMO_INFO = ${jsonEnScript(info)};</script>\n`;
  const ancla = '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/';
  if (tableroHtml.split(ancla).length !== 2) throw new Error('no encuentro en tablero_pierri.html dónde meter los datos (cambió el Tablero?)');
  if (!tableroHtml.includes('window.DEMO_INFO')) throw new Error('este tablero_pierri.html es de una versión vieja: bajá la última del repositorio');
  // Reemplazo con función: los datos pueden traer "$&" o "$'" y con un texto de reemplazo se interpretarían.
  return tableroHtml.replace(ancla, () => inyeccion + ancla)
    .replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');
}

function cifrar(texto, clave) {
  const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const llave = crypto.pbkdf2Sync(Buffer.from(clave.normalize('NFC'), 'utf8'), sal, ITERACIONES, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
  const comprimido = zlib.gzipSync(Buffer.from(texto, 'utf8'), { level: 9 });
  const datos = Buffer.concat([c.update(comprimido), c.final(), c.getAuthTag()]);   // WebCrypto espera la etiqueta al final
  return { v: 1, kdf: 'PBKDF2-SHA256', iteraciones: ITERACIONES, sal: sal.toString('base64'), iv: iv.toString('base64'), datos: datos.toString('base64') };
}

/** La página que se publica: pide la clave, descifra en el navegador y reemplaza el documento por el Tablero. */
function paginaConClave(sobre) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Relevamiento Ley Pierri · acceso con clave</title>
<style>
:root{--marca:#16436e;--fondo:#eef0f3;--texto:#1c2430;--texto2:#5b6675;--linea:#c9d0d9;--rojo:#a8321f}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--fondo);color:var(--texto);font:15px/1.5 "Public Sans",system-ui,sans-serif;padding:16px}
form{background:#fff;border:1px solid #dfe4ea;border-radius:12px;padding:28px;width:100%;max-width:380px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:20px;color:var(--marca)}
p{margin:0;color:var(--texto2);font-size:13.5px}
label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:13.5px}
input{font:inherit;padding:11px 12px;border:1px solid var(--linea);border-radius:6px}
input:focus,button:focus-visible{outline:2px solid var(--marca);outline-offset:1px}
button{font-family:inherit;font-weight:600;font-size:14px;padding:12px;border-radius:6px;border:1px solid var(--marca);background:var(--marca);color:#fff;cursor:pointer;min-height:44px}
button:disabled{opacity:.6;cursor:wait}
#estado{min-height:20px;font-size:13.5px}
#estado.err{color:var(--rojo);font-weight:600}
</style>
</head>
<body>
<form id="f" autocomplete="off">
  <h1>Relevamiento Ley Pierri</h1>
  <p>Escribanía General de Gobierno de Córdoba. Acceso restringido.</p>
  <label>Clave<input id="clave" type="password" required autofocus></label>
  <button id="entrar" type="submit">Entrar</button>
  <div id="estado" role="status" aria-live="polite"></div>
</form>
<script>
var SOBRE = ${JSON.stringify(sobre)};
(function(){
  var f = document.getElementById('f'), est = document.getElementById('estado'), btn = document.getElementById('entrar');
  function bytes(b64){ var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function aviso(t, err){ est.textContent = t; est.className = err ? 'err' : ''; }
  if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') {
    aviso('Este navegador no puede abrir la página. Usá Chrome, Edge o Firefox actualizados.', true); btn.disabled = true; return;
  }
  f.addEventListener('submit', async function(e){
    e.preventDefault();
    var clave = document.getElementById('clave').value;
    btn.disabled = true; aviso('Abriendo…');
    try {
      var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
      var llave = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(SOBRE.sal), iterations: SOBRE.iteraciones, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      var plano;
      try { plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(SOBRE.iv) }, llave, bytes(SOBRE.datos)); }
      catch (err) { aviso('Clave incorrecta.', true); btn.disabled = false; document.getElementById('clave').select(); return; }
      var html = await new Response(new Blob([plano]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      document.open(); document.write(html); document.close();
    } catch (err) { aviso('No se pudo abrir: ' + err.message, true); btn.disabled = false; }
  });
})();
</script>
</body>
</html>
`;
}

function preguntarOculto(texto) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let mudo = false;
    rl._writeToOutput = s => { if (!mudo) process.stdout.write(s); else if (s !== '\r\n' && s !== '\n') process.stdout.write('*'); };
    rl.question(texto, r => { rl.close(); process.stdout.write('\n'); resolve(r); });
    mudo = true;
  });
}

async function main() {
  const O = args();
  if (O.ayuda || !O.json) {
    console.log('Uso: node publicar.js --json <relevamiento_ley_pierri.json> [--salida <carpeta>]\n' +
      'El JSON sale del botón "Guardar JSON" del Tablero. La clave se pide en la consola (o PIERRI_PUBLICAR_CLAVE).');
    process.exit(O.ayuda ? 0 : 1);
  }
  const datos = leerDatos(O.json);
  const visibles = datos.resultados.filter(r => r && r.derivado && !r.repetido_de).length;
  if (!visibles) throw new Error('el archivo no tiene resoluciones para mostrar');

  let clave = process.env.PIERRI_PUBLICAR_CLAVE || '';
  if (!clave) {
    console.log(`Clave para abrir la página: ${CLAVE_MINIMA} caracteres o más. Mejor cuatro o cinco palabras sueltas que nadie adivine.`);
    clave = await preguntarOculto('Clave: ');
    const otra = await preguntarOculto('Repetila: ');
    if (clave !== otra) throw new Error('las dos claves no coinciden');
  }
  if ([...clave].length < CLAVE_MINIMA) throw new Error(`la clave tiene que tener al menos ${CLAVE_MINIMA} caracteres`);

  const pagina = paginaConClave(cifrar(armarTablero(fs.readFileSync(O.tablero, 'utf8'), datos), clave));
  fs.mkdirSync(O.salida, { recursive: true });
  fs.writeFileSync(path.join(O.salida, 'index.html'), pagina);
  fs.writeFileSync(path.join(O.salida, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  const mb = Buffer.byteLength(pagina) / 1048576;
  console.log(`Listo: ${path.join(O.salida, 'index.html')} (${mb.toFixed(1)} MB, ${visibles} resoluciones adentro, cifradas).`);
  if (mb > 25) console.log('Pesa más de 25 MB: la página de GitHub no deja subirlo arrastrando. Hay que subirlo con git o GitHub Desktop.');
  console.log('Subí index.html y robots.txt al repositorio público. La clave mandala por otro medio, nunca junto con el link.');
}

main().catch(e => { console.error('No se pudo publicar: ' + e.message); process.exit(1); });
