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
 *   esTomo(pags) / cortarTomo(pags)            reconocer y cortar tomos en resoluciones
 *   recortarPaginas(buf, desde, hasta)         sub-PDF con las páginas de una resolución (pdf-lib)
 *   leerConModelo(buf, opciones)               carril modelo (API Anthropic, PDF directo)
 *   fusionar(deTexto, delModelo)               completar con el modelo solo lo que el texto no resolvió
 *   procesarArchivo(buf, nombre, opciones)     TODO junto: reconoce, corta, lee por texto, manda al modelo lo necesario
 *   ubicarEnCatastro(derivados, tabla)         completa nomenclatura, localidad y coordenadas
 */
'use strict';
const crypto = require('crypto');
const PierriCore = require('./pierri_core.js');
const PierriTexto = require('./pierri_texto.js');

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
    paginas.push(tc.items.map(t => t.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  await doc.destroy();
  return paginas;
}

// ───────────────────────────── Tomos ─────────────────────────────
const RE_INICIO = /VISTO\s*:?\s*El\s+expediente/i;
const RE_EXP = /expediente\s*N?\s*[°ºo*“"']*\s*(\d{4})\s*-?\s*(\d{5,7})\s*\/\s*(\d{4})/i;
const RE_EXP_TEMPRANO = /^[\s\S]{0,400}?(\d{4})\s*-?\s*(\d{5,7})\s*\/\s*(\d{4})/;
const RE_FIN = /PROTOCOL[IÍ]CESE|PROTOCOLICESE|RESUELVE\s*:|\bORDENAR\b|\bDESESTIMAR\b/i;
const RE_FIN_FUERTE = /PROTOCOL[IÍ]CESE|PROTOCOLICESE/i;
/**
 * Marca de que un bloque es realmente una resolución y no una foja cualquiera del cuerpo del expediente.
 * En un expediente completo (20 fojas o más) casi todas las fojas mencionan el número de expediente
 * —oficios, cédulas, informes, la declaración jurada— pero solo la resolución tiene parte dispositiva.
 */
const RE_RESOLUTIVA = /RESUELVE\s*:|PROTOCOL[IÍ]CESE|PROTOCOLICESE|\bORDENAR\b|\bDESESTIMAR\b|\bART[IÍ]CULO\s+1/i;
/**
 * La resolución que interesa: la que ordena la inscripción en el Registro Personal de Poseedores.
 * Un expediente suele traer además resoluciones de trámite (ordenan una constatación, rectifican un
 * dato, desestiman una oposición). Todas tienen parte dispositiva, pero solo una cierra el trámite.
 */
const RE_ORDEN_INSCRIPCION = /ORDENAR[\s\S]{0,1200}?(Registro\s+Personal\s+de\s+Poseedores|inscripci[oó]n[\s\S]{0,200}?Registro)/i;
const RE_ORDENAR = /\bORDENAR\b/i;
/** Puntaje para elegir, dentro de un mismo expediente, cuál de sus resoluciones es la definitiva. */
function puntajeResolucion(texto) {
  if (RE_ORDEN_INSCRIPCION.test(texto)) return 3;      // ordena la inscripción: es la que buscamos
  if (RE_ORDENAR.test(texto)) return 2;                 // ordena algo, pero no la inscripción
  return 1;                                             // rectifica, desestima, archiva
}
function esTomo(pags) { return pags.length > 6 || pags.filter(t => RE_INICIO.test(t)).length > 1; }
/** El nombre del archivo del sistema de la UEST ya trae el expediente: documento_0535-004490-2004_<hash>.pdf */
function expedienteDelNombre(nombre) {
  const m = String(nombre || '').match(/(\d{4})-(\d{5,7})-(\d{4})/);
  return m ? `${m[1]}-${m[2]}/${m[3]}` : null;
}
function cortarTomo(pags, expArchivo) {
  const unidades = [], sueltas = [];
  let abierta = null;
  const cerrar = () => { if (abierta) { unidades.push(abierta); abierta = null; } };
  for (let p = 0; p < pags.length; p++) {
    const t = pags[p] || '';
    const esInicio = RE_INICIO.test(t) || (RE_EXP_TEMPRANO.test(t) && !RE_FIN.test(t));
    const esFin = RE_FIN.test(t);
    if (esInicio) {
      cerrar();
      const m = t.match(RE_EXP);
      abierta = { desde: p, hasta: p, expediente: m ? `${m[1]}-${m[2]}/${m[3]}` : null };
      if (esFin && RE_FIN_FUERTE.test(t)) cerrar();
      continue;
    }
    if (abierta) {
      abierta.hasta = p;
      if (!abierta.expediente) { const m = t.match(RE_EXP); if (m) abierta.expediente = `${m[1]}-${m[2]}/${m[3]}`; }
      if (esFin || abierta.hasta - abierta.desde >= 3) cerrar();
      continue;
    }
    if (esFin && sueltas.length && sueltas[sueltas.length - 1] === p - 1) {
      const desde = sueltas.pop();
      const m = t.match(RE_EXP) || (pags[desde] || '').match(RE_EXP);
      unidades.push({ desde, hasta: p, expediente: m ? `${m[1]}-${m[2]}/${m[3]}` : null, dudosa: true });
      continue;
    }
    sueltas.push(p);
  }
  cerrar();
  // Quedarse solo con los bloques que tienen parte dispositiva: el resto es cuerpo del expediente.
  const texto = u => pags.slice(u.desde, u.hasta + 1).join(' ');
  const conParteResolutiva = unidades.filter(u => RE_RESOLUTIVA.test(texto(u)));
  const cuerpo = unidades.filter(u => !RE_RESOLUTIVA.test(texto(u)));
  if (conParteResolutiva.length) {
    const paginasCuerpo = cuerpo.reduce((a, u) => a + (u.hasta - u.desde + 1), 0);
    const elegidas = unaPorExpediente(conParteResolutiva, texto, expArchivo);
    return { unidades: elegidas, sueltas, paginasCuerpo, bloquesDescartados: cuerpo.length,
      resolucionesTramite: conParteResolutiva.length - elegidas.length };
  }
  // Ningún bloque tiene parte dispositiva: puede ser un expediente sin resolución, o un OCR muy sucio.
  return { unidades, sueltas, paginasCuerpo: 0, bloquesDescartados: 0 };
}
/**
 * De cada expediente se conserva una sola resolución: la que ordena la inscripción. Si hay varias
 * con el mismo puntaje se toma la última del documento, que es la que cierra el trámite.
 * Las unidades sin número de expediente legible se conservan todas (van a revisión manual).
 */
function mejorDe(lista, texto) {
  let mejor = lista[0], mejorPuntaje = puntajeResolucion(texto(lista[0]));
  for (const u of lista.slice(1)) {
    const p = puntajeResolucion(texto(u));
    if (p > mejorPuntaje || (p === mejorPuntaje && u.desde > mejor.desde)) { mejor = u; mejorPuntaje = p; }
  }
  mejor.descartadasDelExpediente = lista.length - 1;
  return mejor;
}
function unaPorExpediente(unidades, texto, expArchivo) {
  // Caso expediente individual: el nombre del archivo dice de qué expediente se trata, así que todo lo
  // que hay adentro le pertenece —aunque el OCR no haya podido leer el número en algunos bloques— y
  // sale una sola resolución. También cubre el número del plano de Catastro (0033-…) que aparece en el
  // medio del texto y que si no se tomaría como un expediente aparte.
  if (expArchivo) {
    const elegida = mejorDe(unidades, texto);
    if (!elegida.expediente) elegida.expediente = expArchivo;
    return [elegida];
  }
  // Sin pista en el nombre: agrupar por el expediente que aparece en cada bloque.
  const porExp = new Map(), sinExp = [];
  for (const u of unidades) {
    if (!u.expediente) { sinExp.push(u); continue; }
    if (!porExp.has(u.expediente)) porExp.set(u.expediente, []);
    porExp.get(u.expediente).push(u);
  }
  // Un solo expediente en todo el archivo: los bloques sin número también son de él.
  if (porExp.size === 1) {
    const [exp, lista] = [...porExp][0];
    const elegida = mejorDe(lista.concat(sinExp), texto);
    if (!elegida.expediente) elegida.expediente = exp;
    return [elegida];
  }
  const elegidas = [];
  for (const [, lista] of porExp) elegidas.push(lista.length === 1 ? lista[0] : mejorDe(lista, texto));
  return elegidas.concat(sinExp).sort((a, b) => a.desde - b.desde);
}
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
  const { key, modelo = 'claude-haiku-4-5-20251001' } = opciones || {};
  if (!key) throw new Error('sin clave de API');
  const cuerpo = {
    model: modelo, max_tokens: 3000, temperature: 0,
    system: [{ type: 'text', text: PierriCore.PROMPT_SISTEMA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      { type: 'text', text: PierriCore.PROMPT_USUARIO },
    ] }],
  };
  let ultimo = 'sin respuesta';
  for (let intento = 0; intento < 5; intento++) {
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(cuerpo) });
    } catch (err) { ultimo = 'error de red: ' + err.message; await dormir(1500 * 2 ** intento); continue; }
    if (resp.status === 429 || resp.status >= 500) { ultimo = 'la API respondió ' + resp.status; await dormir(1500 * 2 ** intento); continue; }
    if (!resp.ok) throw new Error('la API respondió ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
    const data = await resp.json();
    const texto = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const extraido = PierriCore.parsearJSON(texto);
    if (!extraido) { ultimo = 'el modelo no devolvió JSON válido'; continue; }
    const u = data.usage || {};
    extraido._fuente = 'modelo';
    return { extraido, tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) };
  }
  throw new Error(ultimo);
}
/** Convierte un error de la API en una frase que entienda cualquiera. `grave` = no tiene sentido seguir intentando. */
function motivoModelo(err) {
  const m = String((err && err.message) || err || '');
  if (/401|authentication|invalid x-api-key|API key is invalid/i.test(m)) return { texto: 'la clave de API no es válida', grave: true };
  if (/credit balance|billing|402|insufficient/i.test(m)) return { texto: 'la cuenta de Anthropic no tiene crédito', grave: true };
  if (/403|permission/i.test(m)) return { texto: 'la clave no tiene permiso para usar el modelo', grave: true };
  if (/429|rate/i.test(m)) return { texto: 'demasiados pedidos seguidos; reintentar en unos minutos', grave: false };
  if (/red|fetch failed|ENOTFOUND|ECONN|network/i.test(m)) return { texto: 'no hay conexión a internet', grave: false };
  return { texto: 'el modelo no respondió (' + m.slice(0, 120) + ')', grave: false };
}
function fusionar(deTexto, delModelo) {
  const e = JSON.parse(JSON.stringify(delModelo));
  e._fuente = 'mixto';
  if (!e.expediente && deTexto.expediente) e.expediente = deTexto.expediente;
  if (deTexto.dominio.afectados.length) {
    for (const a of e.dominio.afectados || []) {
      if (a.cuenta) continue;
      const t = deTexto.dominio.afectados.find(x => x.matricula === a.matricula && x.cuenta);
      if (t) a.cuenta = t.cuenta;
    }
    if (!(e.dominio.afectados || []).length) e.dominio.afectados = deTexto.dominio.afectados;
  }
  if (!e.posesion.antiguedad_anios && !e.posesion.fecha_inicio_declarada && (deTexto.posesion.antiguedad_anios || deTexto.posesion.fecha_inicio_declarada))
    Object.assign(e.posesion, deTexto.posesion);
  return e;
}

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
  const unidades = [];
  let sueltas = [];
  const tipo = esTomo(pags) ? 'tomo' : 'suelta';
  let paginasCuerpo = 0, bloquesDescartados = 0, resolucionesTramite = 0;
  if (tipo === 'tomo') {
    const r = cortarTomo(pags, expedienteDelNombre(nombre));
    sueltas = r.sueltas; paginasCuerpo = r.paginasCuerpo || 0; bloquesDescartados = r.bloquesDescartados || 0;
    resolucionesTramite = r.resolucionesTramite || 0;
    r.unidades.forEach(u => unidades.push({ nombre: `${nombre}#p${u.desde + 1}-${u.hasta + 1}`, texto: pags.slice(u.desde, u.hasta + 1).join(' '), paginas: u.hasta - u.desde + 1,
      tomo: { archivo: nombre, desde: u.desde, hasta: u.hasta, expedienteVisto: u.expediente, dudosa: !!u.dudosa },
      nombreControl: u.expediente ? `documento_${u.expediente.replace('/', '-')}_tomo.pdf` : null, id: `${h}#${u.desde}` }));
  } else {
    unidades.push({ nombre, texto: pags.join(' '), paginas: pags.length, tomo: null, nombreControl: nombre, id: h });
  }
  const registros = [];
  let i = 0;
  for (const u of unidades) {
    const base = { archivo: u.nombre, hash: u.id, hash_archivo: h, paginas: u.paginas, tomo: u.tomo, tokens: 0 };
    try {
      const r = PierriTexto.extraerDeTexto(u.texto, u.nombreControl);
      if (r.suficiente) {
        const derivado = PierriCore.procesarRegistro(r.extraido, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
        registros.push(Object.assign(base, { extraido: r.extraido, derivado, fuente: 'texto', lectura: { fuente: 'texto', cobertura: r.cobertura, faltan: r.faltan } }));
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
        const derivado = PierriCore.procesarRegistro(r.extraido, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
        derivado.revisar = true;
        const porque = opciones && opciones.modeloBloqueado ? ' (no se usó el modelo: ' + opciones.modeloBloqueado + ')' : ' (se completa con clave de API)';
        derivado.motivos_revision = (derivado.motivos_revision || []).concat(['el texto del PDF no alcanzó: faltan ' + r.faltan.join(', ') + porque]);
        registros.push(Object.assign(base, { extraido: r.extraido, derivado, fuente: 'texto_incompleto', falla_modelo: opciones && opciones.modeloBloqueado || null,
          lectura: { fuente: 'texto_incompleto', cobertura: r.cobertura, faltan: r.faltan } }));
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
