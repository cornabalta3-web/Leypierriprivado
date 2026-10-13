#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — cruce con el Padrón
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * cruzar_padron.js — cruza el resultado del Lector con el Padrón del Registro General (anotaciones POS).
 *
 * El Padrón (POS_al_<fecha>.xls) trae, por anotación: número único, diario, estado (DEF definitiva, PRV provisoria,
 * OBS observada) y nombre del poseedor (desde 2008). No trae DNI, cuenta ni expediente, así que el único puente con
 * las resoluciones es el nombre. Para no inventar cruces, la regla es estricta:
 *   - se comparan nombres normalizados (sin acentos, mayúsculas, palabras ordenadas: "CRAVERO, RAUL ESTEBAN" = "CRAVERO RAUL ESTEBAN");
 *   - se acepta el cruce solo si el nombre aparece UNA sola vez en el Padrón y UNA sola vez en las resoluciones;
 *   - si aparece varias veces de un lado o del otro, queda "ambiguo" y se lista para mirar a mano;
 *   - si no aparece, queda "no figura en el Padrón": resolución dictada pero sin inscripción registrada.
 *
 * Uso:
 *   node cruzar_padron.js --padron ./POS_al_16-09-2026.xls --resultados ./salida/resultados.jsonl
 * Escribe en cada registro `inscripcion` {estado, diario, nro_unico, origen, confianza} y deja cruce_padron.json con el detalle.
 * Requiere: npm install xlsx@0.18.5
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PierriCore = require('./pierri_core.js');

function args() {
  const a = process.argv.slice(2), o = { resultados: './salida/resultados.jsonl' };
  for (let i = 0; i < a.length; i++) { if (a[i] === '--padron') o.padron = a[++i]; else if (a[i] === '--resultados') o.resultados = a[++i]; }
  if (!o.padron) { console.error('Falta --padron <archivo.xls del Registro>'); process.exit(1); }
  return o;
}
const O = args();
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { console.error('Falta la librería xlsx. Instalala con:  npm install xlsx@0.18.5'); process.exit(1); }

const clave = s => PierriCore.normalizarTexto(s).split(' ').filter(Boolean).sort().join(' ');
const ESTADO = { DEF: 'INSCRIPTA', PRV: 'PROVISORIA', OBS: 'OBSERVADA' };

// Padrón
const wb = XLSX.readFile(O.padron);
const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const col = n => Object.keys(filas[0] || {}).find(k => k.trim().toUpperCase() === n);
const cNro = col('NROUNICO'), cDia = col('DIARIO'), cEst = col('ESTADO_PROCESO'), cNom = col('NOMBREPERSONA'), cTipo = col('TIPO_PARTICIPACION');
if (!cNro || !cEst) { console.error('El Padrón no tiene las columnas esperadas (NROUNICO, DIARIO, ESTADO_PROCESO, NOMBREPERSONA).'); process.exit(1); }
const porNombre = new Map();
const anotaciones = new Map();
for (const f of filas) {
  const nro = String(f[cNro] || '').trim(); if (!nro) continue;
  const anio = (String(f[cDia] || '').match(/\/\s*(\d{4})/) || [])[1] || null;
  anotaciones.set(nro, { nro_unico: nro, diario: String(f[cDia] || '').replace(/\s+/g, ' ').trim(), anio, estado: f[cEst], estado_legible: ESTADO[f[cEst]] || f[cEst] });
  const k = clave(f[cNom]); if (!k) continue;
  if (!porNombre.has(k)) porNombre.set(k, []);
  porNombre.get(k).push({ nro, tipo: f[cTipo] || null });
}
console.log(`Padrón: ${filas.length} filas · ${anotaciones.size} anotaciones · ${porNombre.size} nombres distintos`);

// Resultados
const registros = fs.readFileSync(O.resultados, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const porNombreRes = new Map();
for (const r of registros) {
  if (!r.derivado || r.repetido_de) continue;
  for (const rog of ((r.extraido && r.extraido.rogantes) || [])) { const k = clave(rog.apellido_nombre); if (!k) continue; if (!porNombreRes.has(k)) porNombreRes.set(k, []); porNombreRes.get(k).push(r); }
}

/** La inscripción es posterior a la resolución: el año del diario tiene que ser igual o hasta 3 años mayor que el de la resolución.
 *  Si no se conoce alguno de los dos años, no se descarta. Evita cruzar homónimos (un GOMEZ JUAN CARLOS de 2010 con una resolución de 2025). */
function plausible(a, d) {
  const ad = Number(a && a.anio), ar = Number(d && d.resolucion_anio);
  if (!ad || !ar) return true;
  return ad >= ar && ad <= ar + 3;
}
const detalle = [];
let cruzados = 0, ambiguos = 0, noFiguran = 0, sinNombre = 0;
for (const r of registros) {
  if (!r.derivado || r.repetido_de) continue;
  const rogantes = ((r.extraido && r.extraido.rogantes) || []).map(x => x.apellido_nombre).filter(Boolean);
  if (!rogantes.length) { sinNombre++; r.inscripcion = { estado: 'SIN_NOMBRE_PARA_CRUZAR', origen: 'padron', confianza: null }; continue; }
  const k = clave(rogantes[0]);
  const enPadron = porNombre.get(k) || [];
  const enRes = porNombreRes.get(k) || [];
  if (!enPadron.length) {
    noFiguran++;
    r.inscripcion = { estado: 'NO_FIGURA_EN_PADRON', origen: 'padron', confianza: 'nombre_no_encontrado' };
    detalle.push({ expediente: r.derivado.expediente, rogante: rogantes[0], resultado: 'no figura' });
  } else if (enPadron.length === 1 && enRes.length === 1 && plausible(anotaciones.get(enPadron[0].nro), r.derivado)) {
    const a = anotaciones.get(enPadron[0].nro);
    cruzados++;
    r.inscripcion = { estado: a.estado_legible, estado_codigo: a.estado, diario: a.diario, anio_diario: a.anio, nro_unico: a.nro_unico, participacion: enPadron[0].tipo, origen: 'padron', confianza: 'nombre_unico' };
    detalle.push({ expediente: r.derivado.expediente, rogante: rogantes[0], resultado: 'cruzado', anotacion: a });
  } else {
    ambiguos++;
    const candidatas = Array.from(new Set(enPadron.map(x => x.nro))).map(n => anotaciones.get(n));
    const motivo = (enPadron.length === 1 && enRes.length === 1) ? 'anio_incompatible' : 'nombre_repetido';
    r.inscripcion = { estado: 'AMBIGUO', origen: 'padron', confianza: motivo, candidatas };
    detalle.push({ expediente: r.derivado.expediente, rogante: rogantes[0], resultado: 'ambiguo', motivo, en_padron: enPadron.length, en_resoluciones: enRes.length, candidatas });
  }
}
fs.writeFileSync(O.resultados, registros.map(r => JSON.stringify(r)).join('\n') + '\n');
const salida = path.join(path.dirname(O.resultados), 'cruce_padron.json');
const resumen = { fecha: new Date().toISOString(), padron: path.basename(O.padron), cruzados, ambiguos, no_figuran: noFiguran, sin_nombre: sinNombre,
  por_estado: detalle.filter(d => d.resultado === 'cruzado').reduce((m, d) => { m[d.anotacion.estado_legible] = (m[d.anotacion.estado_legible] || 0) + 1; return m; }, {}) };
fs.writeFileSync(salida, JSON.stringify({ resumen, detalle }, null, 1));
console.log(`Cruzados por nombre único: ${cruzados} ${JSON.stringify(resumen.por_estado)}`);
console.log(`Ambiguos (nombre repetido): ${ambiguos} · No figuran en el Padrón: ${noFiguran} · Sin nombre legible: ${sinNombre}`);
console.log(`Detalle en ${salida}. resultados.jsonl actualizado con el campo inscripcion.`);
