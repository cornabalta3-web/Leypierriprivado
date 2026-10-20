#!/usr/bin/env node
/**
 * evaluar_motor.js — mide cuánto lee bien el motor contra resoluciones verificadas a mano.
 *
 * La idea: un "conjunto de verdad" con resoluciones que alguien leyó a ojo y cargó en una planilla.
 * Se corre el motor sobre esas mismas resoluciones y se compara campo por campo. Cada vez que se toca
 * el extractor de texto o el prompt, se vuelve a correr y se ve si mejoró o empeoró. Sin esto, cualquier
 * cambio es a ciegas.
 *
 * Uso:
 *   node evaluar_motor.js --verdad ./verdad.csv --resultados ./salida/resultados.jsonl
 *
 * verdad.csv (separador ; o ,), una fila por resolución, con estas columnas (las que no tengas, vacías):
 *   expediente;posee_desde;criterio;cuenta;matricula;dni;rogante;tipo_documento;clasificacion
 *   0535-105743/2018;2000-07-18;DECLARADA_ROGANTE;14-030734504/4;1199926;20516358;CRAVERO, RAUL ESTEBAN;RESOLUCION_INSCRIPCION;ELEGIBLE
 *
 * Cómo se compara: posee_desde a nivel año-mes (la antigüedad viene redondeada), cuenta y matrícula por
 * dígitos, rogante sin importar el orden apellido/nombre ni acentos. Una columna vacía en la verdad no se compara.
 *
 * Salida: exactitud global y por campo, y la lista de discrepancias para mirar una por una.
 */
'use strict';
const fs = require('fs');
const PierriCore = require('./pierri_core.js');

function args() {
  const a = process.argv.slice(2), o = { resultados: './salida/resultados.jsonl' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--verdad') o.verdad = a[++i];
    else if (a[i] === '--resultados') o.resultados = a[++i];
    else if (a[i] === '--salida') o.salida = a[++i];
  }
  if (!o.verdad) { console.error('Falta --verdad <planilla.csv>'); process.exit(1); }
  return o;
}
const O = args();

function leerCSV(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim());
  const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = lineas[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ''));
  return lineas.slice(1).map(l => { const c = l.split(sep).map(x => x.trim().replace(/^"|"$/g, '')); const o = {}; cab.forEach((h, i) => o[h] = c[i] || ''); return o; });
}

/** Convierte una fila de la verdad al mismo formato que un derivado, para reusar compararLecturas. */
function derivadoDesdeVerdad(f) {
  const pos = f.posee_desde ? PierriCore.parseFecha(f.posee_desde) : null;
  const d = {
    // Sin tipo, "no aplica" se representa con un tipo que no se evalúa: un documento sin tipo ahora queda para revisar.
    tipo_documento: f.tipo_documento || (f.clasificacion === 'NO_APLICA' ? 'RESOLUCION_TRAMITE' : f.clasificacion ? 'RESOLUCION_INSCRIPCION' : ''),
    expediente: f.expediente || '', posee_desde: pos ? PierriCore.fmtFecha(pos) : '', posesion_criterio: f.criterio || '',
    geo: { cuenta_normalizada: f.cuenta || '' }, matriculas: f.matricula ? String(f.matricula).split(/[|,]/).map(x => x.trim()).filter(Boolean) : [],
    dni_principal: f.dni || '', rogante_principal: f.rogante || '', revisar: false,
    elegibilidad: { estado: 'SIN_DATO', borde: false },
  };
  if (f.clasificacion) {
    const c = f.clasificacion.toUpperCase();
    d.elegibilidad.estado = c.startsWith('ELEGIBLE') ? 'ELEGIBLE' : c.startsWith('NO_ELEGIBLE') ? 'NO_ELEGIBLE' : 'SIN_DATO';
    d.elegibilidad.borde = c.endsWith('_BORDE');
  }
  d._camposPresentes = Object.keys(PierriCore.CAMPOS_CONTROL).filter(k => {
    if (k === 'clasificacion') return !!f.clasificacion;
    if (k === 'tipo_documento') return !!f.tipo_documento;
    if (k === 'matricula') return !!f.matricula;
    if (k === 'criterio') return !!f.criterio;
    return !!f[k];
  });
  return d;
}

const verdad = leerCSV(O.verdad);
const resultados = fs.readFileSync(O.resultados, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const porExp = new Map(resultados.filter(r => r.derivado && r.derivado.expediente).map(r => [r.derivado.expediente, r]));
const porArchivo = new Map(resultados.map(r => [r.archivo, r]));

const comparaciones = [], faltantes = [];
for (const f of verdad) {
  const esperado = derivadoDesdeVerdad(f);
  const r = porExp.get(f.expediente) || (f.archivo && porArchivo.get(f.archivo));
  if (!r || !r.derivado) { faltantes.push(f.expediente || f.archivo); continue; }
  const c = PierriCore.compararLecturas(esperado, r.derivado, esperado._camposPresentes);
  comparaciones.push({ expediente: f.expediente, fuente: r.fuente, ...c });
}
const resumen = PierriCore.resumirComparaciones(comparaciones);

console.log(`Casos verificados: ${verdad.length} · encontrados en los resultados: ${comparaciones.length} · no encontrados: ${faltantes.length}`);
console.log(`Coinciden en todos los campos cargados: ${resumen.coinciden_del_todo}/${resumen.total} (${resumen.tasa_global}%)\n`);
console.log('Exactitud por campo:');
for (const [k, v] of Object.entries(resumen.por_campo)) {
  const n = comparaciones.filter(c => c.diferencias.some(d => d.campo === k)).length;
  const comparados = comparaciones.length;
  if (comparados) console.log(`  ${k.padEnd(16)} ${String(Math.round((1 - n / comparados) * 1000) / 10).padStart(5)}%   (${n} mal de ${comparados})`);
}
const porFuente = {};
for (const c of comparaciones) { porFuente[c.fuente] = porFuente[c.fuente] || { total: 0, ok: 0 }; porFuente[c.fuente].total++; if (c.coincide) porFuente[c.fuente].ok++; }
console.log('\nPor carril de lectura:');
for (const [k, v] of Object.entries(porFuente)) console.log(`  ${String(k).padEnd(18)} ${v.ok}/${v.total} bien`);

const malas = comparaciones.filter(c => !c.coincide);
if (malas.length) {
  console.log(`\nDiscrepancias (${malas.length}):`);
  for (const c of malas) {
    console.log(`  ${c.expediente} [${c.fuente}]`);
    for (const d of c.diferencias) console.log(`      ${d.campo.padEnd(14)} verificado: ${d.a || '—'}   motor: ${d.b || '—'}`);
  }
}
if (faltantes.length) console.log(`\nNo encontrados en los resultados: ${faltantes.join(', ')}`);
if (O.salida) { fs.writeFileSync(O.salida, JSON.stringify({ fecha: new Date().toISOString(), resumen, comparaciones, faltantes }, null, 1)); console.log(`\nDetalle guardado en ${O.salida}`); }
