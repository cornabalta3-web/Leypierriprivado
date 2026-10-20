/*
 * Relevamiento Ley Pierri — el Lector
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_lector.js — el Lector como módulo: todo lo que hace falta para convertir un PDF (suelto o tomo)
 * en registros clasificados. Lo usan la aplicación (pierri.js) y la línea de comandos (procesar_lote.js).
 *
 *   textoPorPagina(buf)                        capa de texto de cada página (pdfjs-dist)
 *   esTomo(pags) / cortarTomo(pags)            reconocer y cortar tomos en resoluciones (de pierri_tomos.js)
 *   recortarPaginas(buf, desde, hasta)         sub-PDF con las páginas de una resolución (pdf-lib)
 *   leerConModelo(buf, opciones)               carril modelo (API Anthropic, PDF directo)
 *   fusionar(deTexto, delModelo)               completar con el modelo solo lo que el texto no resolvió
 *   procesarArchivo(buf, nombre, opciones)     TODO junto: reconoce, corta, lee por texto, manda al modelo lo necesario
 *   ubicarEnCatastro(derivados, tabla)         completa nomenclatura, localidad y coordenadas
 *
 * Lo que no depende de Node (cortar tomos, armar el registro por texto) está en pierri_tomos.js, que
 * también usa la versión web. Acá queda lo que sí depende: leer el PDF, el hash, recortar y el modelo.
 */
'use strict';
const crypto = require('crypto');
const PierriCore = require('./pierri_core.js');
const PierriTomos = require('./pierri_tomos.js');

const hash = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ───────────────────────────── PDF → texto ─────────────────────────────
let pdfjs;
async function cargarPdfjs() {
  if (!pdfjs) {
    try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
    catch (e) { throw new Error('Falta pdfjs-dist. Instalalo con:  npm install pdfjs-dist@4.10.38'); }
  }
  return pdfjs;
}
async function textoPorPagina(buf) {
  const lib = await cargarPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    paginas.push(PierriTomos.textoDeItems(tc.items));
  }
  await doc.destroy();
  return paginas;
}

// ───────────────────────────── Tomos ─────────────────────────────
// Reconocer y cortar tomos vive en pierri_tomos.js, compartido con la versión web. Se reexporta igual
// que antes para pierri.js y procesar_lote.js.
const { esTomo, cortarTomo, expedienteDelNombre } = PierriTomos;
let pdfLib;
async function recortarPaginas(buf, desde, hasta) {
  if (!pdfLib) {
    try { pdfLib = require('pdf-lib'); }
    catch (e) { throw new Error('Para cortar tomos hace falta pdf-lib. Instalalo con:  npm install pdf-lib@1.17.1'); }
  }
  const src = await pdfLib.PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await pdfLib.PDFDocument.create();
  const idx = []; for (let p = desde; p <= hasta; p++) idx.push(p);
  (await out.copyPages(src, idx)).forEach(pg => out.addPage(pg));
  return Buffer.from(await out.save());
}

// ───────────────────────────── Carril modelo ─────────────────────────────
async function leerConModelo(buf, opciones) {
  const { key, modelo = PierriTomos.MODELO_POR_DEFECTO } = opciones || {};
  if (!key) throw new Error('sin clave de API');
  const cuerpo = PierriTomos.cuerpoModelo(buf.toString('base64'), modelo, PierriCore.PROMPT_SISTEMA, PierriCore.PROMPT_USUARIO);
  let ultimo = 'sin respuesta', sinDatos = 0, cobrados = 0;
  for (let intento = 0; intento < 5; intento++) {
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(cuerpo) });
    } catch (err) { ultimo = 'error de red: ' + err.message; await dormir(1500 * 2 ** intento); continue; }
    if (resp.status === 429 || resp.status >= 500) { ultimo = 'la API respondió ' + resp.status; await dormir(1500 * 2 ** intento); continue; }
    if (!resp.ok) throw new Error('la API respondió ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
    const data = await resp.json(), leido = PierriTomos.respuestaModelo(data);
    // Contestó pero sin los datos: se reintenta una sola vez (cada respuesta se cobra, y se suma).
    if (!leido) { cobrados += PierriTomos.tokensDe(data); ultimo = 'el modelo no devolvió JSON válido'; if (++sinDatos >= 2) break; continue; }
    leido.tokens += cobrados;
    return leido;
  }
  throw new Error(ultimo);
}
const { motivoModelo, fusionar } = PierriTomos;

// ───────────────────────────── Un archivo → registros ─────────────────────────────
/**
 * @param {Buffer} buf
 * @param {string} nombre
 * @param {object} opciones  { key, modelo, cfg, tabla, vistos:Set, onProgreso(fn) }
 * @returns {Promise<{ registros: object[], tipo: 'suelta'|'tomo', paginas: number, sueltas: number[] }>}
 *   Cada registro: { archivo, hash, paginas, extraido, derivado, tokens, fuente, tomo, lectura, error? }
 */
async function procesarArchivo(buf, nombre, opciones) {
  const { key, modelo, cfg = {}, tabla, vistos = new Set(), onProgreso } = opciones || {};
  const pags = await textoPorPagina(buf);
  const h = hash(buf);
  const { unidades, tipo, sueltas, paginasCuerpo, bloquesDescartados, resolucionesTramite } = PierriTomos.unidadesDe(pags, nombre, h);
  const registros = [];
  let i = 0;
  for (const u of unidades) {
    const base = PierriTomos.registroBase(u, h);
    try {
      const r = PierriTomos.leerTexto(u);
      if (r.suficiente) {
        registros.push(PierriTomos.registroPorTexto(base, u, r, cfg, tabla, vistos));
      } else if (key && !(opciones && opciones.modeloBloqueado)) {
        let lecturaModelo = null, falla = null;
        try {
          const bufEnvio = u.tomo ? await recortarPaginas(buf, u.tomo.desde, u.tomo.hasta) : buf;
          lecturaModelo = await leerConModelo(bufEnvio, { key, modelo });
        } catch (errModelo) { falla = motivoModelo(errModelo); }
        if (lecturaModelo) {
          const fusion = fusionar(r.extraido, lecturaModelo.extraido);
          const derivado = PierriCore.procesarRegistro(fusion, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
          registros.push(Object.assign(base, { extraido: fusion, derivado, tokens: lecturaModelo.tokens, fuente: 'modelo', lectura: { fuente: 'modelo', cobertura_texto: r.cobertura, faltaban_en_texto: r.faltan } }));
        } else {
          // El modelo falló: NO se pierde la resolución. Se guarda lo que leyó el texto y queda marcada para
          // completarla después con "Completar incompletas con el modelo", cuando la clave funcione.
          const derivado = PierriCore.procesarRegistro(r.extraido, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
          derivado.revisar = true;
          derivado.motivos_revision = (derivado.motivos_revision || []).concat(['el texto del PDF no alcanzó y ' + falla.texto]);
          registros.push(Object.assign(base, { extraido: r.extraido, derivado, fuente: 'texto_incompleto', falla_modelo: falla.texto,
            lectura: { fuente: 'texto_incompleto', cobertura: r.cobertura, faltan: r.faltan, falla_modelo: falla.texto } }));
          if (falla.grave && opciones) opciones.modeloBloqueado = falla.texto;   // no insistir con cada archivo
        }
      } else {
        const porque = opciones && opciones.modeloBloqueado ? ' (no se usó la IA: ' + opciones.modeloBloqueado + ')' : ' (se completa con clave de API)';
        registros.push(PierriTomos.registroIncompleto(base, u, r, cfg, tabla, vistos, porque, opciones && opciones.modeloBloqueado));
      }
    } catch (err) {
      registros.push(Object.assign(base, { error: String(err.message || err) }));
    }
    if (onProgreso) onProgreso(++i, unidades.length);
  }
  return { registros, tipo, paginas: pags.length, sueltas, paginasCuerpo, bloquesDescartados, resolucionesTramite };
}

/** Completa con Catastro los derivados que tengan cuenta y no estén ubicados. Devuelve cuántos se ubicaron. */
async function ubicarEnCatastro(derivados, tabla) {
  const pend = derivados.filter(d => d && d.geo && d.geo.cuenta_normalizada && !(d.geo.catastro && d.geo.catastro.encontrada));
  if (!pend.length) return 0;
  const parcelas = await PierriCore.consultarCatastro(pend.map(d => d.geo.cuenta_normalizada));
  let ok = 0;
  for (const d of pend) if (PierriCore.enriquecerConCatastro(d, parcelas[d.geo.cuenta_normalizada.replace(/\D/g, '')], tabla)) ok++;
  return ok;
}

module.exports = { hash, textoPorPagina, esTomo, cortarTomo, expedienteDelNombre, motivoModelo, recortarPaginas, leerConModelo, fusionar, procesarArchivo, ubicarEnCatastro };
