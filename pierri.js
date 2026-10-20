#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — la aplicación
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri.js — Relevamiento Ley Pierri, la aplicación.
 *
 * Un solo comando:   node pierri.js
 * Abre el Tablero en el navegador (http://localhost:3777). Desde ahí se cargan los PDF de las resoluciones, el Padrón
 * del Registro y se mira todo. Cada resolución queda guardada en pierri.db, una base SQLite que se puede abrir con
 * cualquier programa (DB Browser for SQLite, Excel vía ODBC, etc.) y copiar a otra computadora.
 *
 * Carpetas y archivos que crea al lado de este script:
 *   pierri.db          la base de datos (todo está acá)
 *   embudo/            copia de cada PDF cargado, por su huella (para reprocesar sin volver a pedirlos)
 *   config.json        clave de API, modelo y criterio de elegibilidad
 *
 * Reglas de acumulación:
 *   - un archivo se identifica por su contenido (hash): el mismo PDF cargado dos veces se ignora;
 *   - un expediente con más de una resolución conserva la de fecha más nueva como válida y marca las otras como repetidas;
 *   - el Padrón se reemplaza entero cada vez que se carga una versión nueva y se vuelve a cruzar;
 *   - el Inventario (CSV de expedientes digitalizados de la UEST) se reemplaza entero; sus cuentas se ubican en Catastro
 *     por lotes y quedan en la tabla parcelas, así el mapa del universo entero existe antes de leer las resoluciones.
 *
 * Opciones:
 *   --puerto 3777        puerto
 *   --sin-navegador      no abrir el navegador solo
 *   --compartir          escuchar en la red local: cualquiera en la misma red abre http://<ip-de-esta-pc>:3777
 *   --clave-acceso XXX   pedir usuario/contraseña para entrar (usuario: pierri). Obligatoria con --compartir.
 * Requiere Node 22.13 o superior (trae SQLite incorporado) y:  npm install pdfjs-dist@4.10.38 pdf-lib@1.17.1 xlsx@0.18.5
 */
'use strict';
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { execFile } = require('child_process');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) { console.error('Esta versión de Node no trae SQLite. Instalá Node 22.13 o superior (LTS) desde https://nodejs.org'); process.exit(1); }

const PierriCore = require('./pierri_core.js');
const PierriTexto = require('./pierri_texto.js');
const Lector = require('./pierri_lector.js');
const TABLA = require('./codigos_departamentos_pedanias_cordoba.json');
// Puntos de localidades de Catastro: ubicación aproximada para las resoluciones que no traen número de cuenta.
let LOCALIDADES = null;
try { LOCALIDADES = require('./localidades_cordoba.json').localidades; } catch (e) { /* sin la tabla, no se ubica por localidad */ }
const AQUI = __dirname;
const RUTA_DB = path.join(AQUI, 'pierri.db');
const RUTA_EMBUDO = path.join(AQUI, 'embudo');
const RUTA_CONFIG = path.join(AQUI, 'config.json');
const RUTA_TABLERO = path.join(AQUI, 'tablero_pierri.html');

const args = process.argv.slice(2);
const PUERTO = Number(args[args.indexOf('--puerto') + 1]) || 3777;
const SIN_NAVEGADOR = args.includes('--sin-navegador');
const COMPARTIR = args.includes('--compartir');
// --seguro: marca la cookie de sesión como Secure. Se usa cuando el sistema queda detrás de HTTPS (servidor institucional).
const SEGURO = args.includes('--seguro');
// --admin-clave <contraseña>: crea o reinicia el usuario "admin" al arrancar. Solo para la primera puesta en marcha.
const ADMIN_CLAVE = args.includes('--admin-clave') ? args[args.indexOf('--admin-clave') + 1] : (process.env.PIERRI_ADMIN_CLAVE || '');
const CLAVE_ACCESO = args.includes('--clave-acceso') ? args[args.indexOf('--clave-acceso') + 1] : (process.env.PIERRI_CLAVE || '');
if (COMPARTIR && !CLAVE_ACCESO) { console.error('Con --compartir hace falta --clave-acceso <contraseña>, así no entra cualquiera de la red.'); process.exit(1); }

// ───────────────────────────── Configuración ─────────────────────────────
function leerConfig() {
  const base = { key: '', modelo: 'claude-haiku-4-5-20251001', regla: 'CORTE_FIJO', fechaCorte: '2006-01-01', anosPlazoMovil: 10, margenBordeMeses: 12 };
  try { return Object.assign(base, JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8'))); } catch (e) { return base; }
}
function guardarConfig(c) { fs.writeFileSync(RUTA_CONFIG, JSON.stringify(c, null, 1)); }
let CONFIG = leerConfig();
const cfgElegibilidad = () => ({ regla: CONFIG.regla, fechaCorte: CONFIG.fechaCorte, anosPlazoMovil: CONFIG.anosPlazoMovil, margenBordeMeses: CONFIG.margenBordeMeses });

// ───────────────────────────── Base de datos ─────────────────────────────
fs.mkdirSync(RUTA_EMBUDO, { recursive: true });
const db = new DatabaseSync(RUTA_DB);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS archivos (
    hash TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, paginas INTEGER, unidades INTEGER, paginas_sueltas TEXT, cargado_en TEXT
  );
  CREATE TABLE IF NOT EXISTS resoluciones (
    id TEXT PRIMARY KEY, hash_archivo TEXT, archivo TEXT, expediente TEXT, tipo_documento TEXT, clasificacion TEXT,
    posee_desde TEXT, rogante TEXT, dni TEXT, departamento TEXT, pedania TEXT, localidad TEXT, manzana TEXT, cuenta TEXT,
    matriculas TEXT, lat REAL, lon REAL, fuente TEXT, revisar INTEGER, inscripcion TEXT, valida INTEGER DEFAULT 1,
    resolucion_fecha TEXT, tokens INTEGER DEFAULT 0, error TEXT, cargado_en TEXT, json TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_res_exp ON resoluciones(expediente);
  CREATE INDEX IF NOT EXISTS ix_res_loc ON resoluciones(localidad);
  CREATE TABLE IF NOT EXISTS padron (
    nro_unico TEXT PRIMARY KEY, diario TEXT, anio TEXT, estado TEXT, nombre TEXT, nombre_clave TEXT, tipo TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_padron_nombre ON padron(nombre_clave);
  CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE IF NOT EXISTS inventario (
    expediente TEXT PRIMARY KEY, departamento TEXT, hojas INTEGER, cuenta TEXT, cuenta_valida INTEGER, nro_resolucion TEXT,
    estado_digitalizacion TEXT, tiene_resolucion INTEGER, en_universo INTEGER, anio INTEGER,
    origen TEXT, iniciador TEXT, dni TEXT, fecha_ingreso TEXT, fecha_resolucion TEXT, estado_suac TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_inv_cuenta ON inventario(cuenta);
  CREATE TABLE IF NOT EXISTS parcelas (
    cuenta TEXT PRIMARY KEY, encontrada INTEGER, nomenclatura TEXT, departamento TEXT, pedania TEXT, localidad TEXT, tipo_parcela TEXT,
    estado TEXT, designacion TEXT, sup_tierra REAL, sup_mejoras REAL, valuacion REAL, lat REAL, lon REAL, consultada_en TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_parc_loc ON parcelas(localidad);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    usuario TEXT PRIMARY KEY, nombre TEXT, rol TEXT NOT NULL, hash TEXT, sal TEXT, algoritmo TEXT DEFAULT 'scrypt',
    activo INTEGER DEFAULT 1, debe_cambiar INTEGER DEFAULT 0, creado_en TEXT, actualizado_en TEXT,
    ultimo_acceso TEXT, intentos INTEGER DEFAULT 0, bloqueado_hasta TEXT);
  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY, usuario TEXT, creada_en TEXT, visto_en TEXT, vence_en TEXT, ip TEXT, agente TEXT);
  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, usuario TEXT, rol TEXT, accion TEXT, detalle TEXT, ip TEXT);
  CREATE INDEX IF NOT EXISTS ix_aud_fecha ON auditoria(fecha);
`);
for (const col of ['origen TEXT', 'iniciador TEXT', 'dni TEXT', 'fecha_ingreso TEXT', 'fecha_resolucion TEXT', 'estado_suac TEXT']) {
  try { db.exec(`ALTER TABLE inventario ADD COLUMN ${col}`); } catch (e) { /* ya existe */ }
}
// Revisión manual: quién controló cada resolución contra el PDF y qué corrigió a mano.
for (const col of ['revisado INTEGER DEFAULT 0', 'revisado_en TEXT', 'revisor TEXT', 'nota TEXT', 'correccion TEXT']) {
  try { db.exec(`ALTER TABLE resoluciones ADD COLUMN ${col}`); } catch (e) { /* ya existe */ }
}
const q = {
  archivo: db.prepare('SELECT * FROM archivos WHERE hash = ?'),
  insArchivo: db.prepare('INSERT OR REPLACE INTO archivos VALUES (?,?,?,?,?,?,?)'),
  insRes: db.prepare(`INSERT OR REPLACE INTO resoluciones (id, hash_archivo, archivo, expediente, tipo_documento, clasificacion, posee_desde, rogante, dni,
    departamento, pedania, localidad, manzana, cuenta, matriculas, lat, lon, fuente, revisar, inscripcion, valida, resolucion_fecha, tokens, error, cargado_en, json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  todas: db.prepare('SELECT json FROM resoluciones ORDER BY cargado_en'),
  porId: db.prepare('SELECT json FROM resoluciones WHERE id = ?'),
  setRevision: db.prepare('UPDATE resoluciones SET revisado = ?, revisado_en = ?, revisor = ?, nota = ?, correccion = ?, json = ? WHERE id = ?'),
  porExp: db.prepare('SELECT id, resolucion_fecha, cargado_en FROM resoluciones WHERE expediente = ? AND error IS NULL'),
  setValida: db.prepare('UPDATE resoluciones SET valida = ? WHERE id = ?'),
  actJson: db.prepare('UPDATE resoluciones SET json = ?, clasificacion = ?, revisar = ?, inscripcion = ?, lat = ?, lon = ?, localidad = ?, manzana = ? WHERE id = ?'),
  padronTodos: db.prepare('SELECT * FROM padron'),
  padronBorrar: db.prepare('DELETE FROM padron'),
  padronIns: db.prepare('INSERT OR REPLACE INTO padron VALUES (?,?,?,?,?,?,?)'),
  meta: db.prepare('SELECT valor FROM meta WHERE clave = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)'),
  contar: db.prepare('SELECT COUNT(*) n FROM resoluciones WHERE error IS NULL'),
  invBorrarOrigen: db.prepare('DELETE FROM inventario WHERE origen = ?'),
  invIns: db.prepare(`INSERT INTO inventario (expediente, departamento, hojas, cuenta, cuenta_valida, nro_resolucion, estado_digitalizacion, tiene_resolucion, en_universo, anio, origen, iniciador, dni, fecha_ingreso, fecha_resolucion, estado_suac)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(expediente) DO UPDATE SET
      departamento = COALESCE(excluded.departamento, departamento), hojas = COALESCE(NULLIF(excluded.hojas, 0), hojas),
      cuenta = COALESCE(excluded.cuenta, cuenta), cuenta_valida = MAX(cuenta_valida, excluded.cuenta_valida),
      nro_resolucion = COALESCE(excluded.nro_resolucion, nro_resolucion),
      estado_digitalizacion = CASE WHEN excluded.origen = 'digitalizados' THEN excluded.estado_digitalizacion ELSE estado_digitalizacion END,
      tiene_resolucion = MAX(tiene_resolucion, excluded.tiene_resolucion), en_universo = MAX(en_universo, excluded.en_universo),
      anio = COALESCE(excluded.anio, anio), origen = CASE WHEN origen IS NULL THEN excluded.origen WHEN instr(origen, excluded.origen) > 0 THEN origen ELSE origen || '+' || excluded.origen END,
      iniciador = COALESCE(excluded.iniciador, iniciador), dni = COALESCE(excluded.dni, dni), fecha_ingreso = COALESCE(excluded.fecha_ingreso, fecha_ingreso),
      fecha_resolucion = COALESCE(excluded.fecha_resolucion, fecha_resolucion), estado_suac = COALESCE(excluded.estado_suac, estado_suac)`),
  invPorExpNombre: db.prepare('SELECT iniciador, dni FROM inventario WHERE expediente = ?'),
  invPorExp: db.prepare('SELECT * FROM inventario WHERE expediente = ?'),
  invCuentasSinParcela: db.prepare('SELECT DISTINCT i.cuenta FROM inventario i LEFT JOIN parcelas p ON p.cuenta = i.cuenta WHERE i.cuenta_valida = 1 AND p.cuenta IS NULL LIMIT ?'),
  parcIns: db.prepare('INSERT OR REPLACE INTO parcelas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  invResumen: db.prepare(`SELECT COUNT(*) total, SUM(tiene_resolucion) con_resolucion, SUM(cuenta_valida) con_cuenta, SUM(en_universo) en_universo,
      SUM(CASE WHEN tiene_resolucion=1 AND cuenta_valida=1 THEN 1 ELSE 0 END) con_resolucion_y_cuenta,
      SUM(CASE WHEN estado_digitalizacion = 'No digitalizado' THEN 1 ELSE 0 END) sin_digitalizar,
      SUM(CASE WHEN dni IS NOT NULL THEN 1 ELSE 0 END) con_dni, SUM(CASE WHEN iniciador IS NOT NULL THEN 1 ELSE 0 END) con_iniciador FROM inventario`),
  invUbicadas: db.prepare('SELECT COUNT(DISTINCT i.expediente) n FROM inventario i JOIN parcelas p ON p.cuenta = i.cuenta AND p.encontrada = 1'),
  invPendientes: db.prepare('SELECT COUNT(DISTINCT i.cuenta) n FROM inventario i LEFT JOIN parcelas p ON p.cuenta = i.cuenta WHERE i.cuenta_valida = 1 AND p.cuenta IS NULL'),
  invPorLocalidad: db.prepare(`SELECT COALESCE(p.localidad, '(sin ubicar)') localidad, COALESCE(p.departamento, i.departamento, '(sin departamento)') departamento,
      COUNT(*) total, SUM(i.tiene_resolucion) con_resolucion, SUM(CASE WHEN p.estado LIKE 'BALDIO%' THEN 1 ELSE 0 END) baldias,
      AVG(p.lat) lat, AVG(p.lon) lon
      FROM inventario i LEFT JOIN parcelas p ON p.cuenta = i.cuenta AND p.encontrada = 1 GROUP BY 1, 2 ORDER BY (p.localidad IS NULL), con_resolucion DESC, total DESC`),
  invPorEstado: db.prepare('SELECT estado_digitalizacion estado, COUNT(*) n FROM inventario GROUP BY 1 ORDER BY n DESC'),
  invLeidos: db.prepare('SELECT COUNT(DISTINCT i.expediente) n FROM inventario i JOIN resoluciones r ON r.expediente = REPLACE(i.expediente, \'-\', \'/\') OR r.expediente = SUBSTR(i.expediente,1,11) || \'/\' || SUBSTR(i.expediente,13) WHERE r.valida = 1 AND r.error IS NULL'),
};
const expInventario = e => String(e || '').replace(/^(\d{4})-(\d{5,7})\/(\d{4})$/, '$1-$2-$3');
const ahora = () => new Date().toISOString();

function filaDesde(r) {
  const d = r.derivado || {}, g = d.geo || {}, c = g.catastro || {};
  return [r.hash, r.hash_archivo, r.archivo, d.expediente || null, d.tipo_documento || null, d.tipo_documento ? PierriCore.clasificar(d) : null,
    d.posee_desde || null, d.rogante_principal || null, d.dni_principal || null, g.dep_nombre || null, g.ped_nombre || null,
    g.localidad_catastro || g.localidad || null, c.manzana ? `${c.circunscripcion}-${c.seccion}-${c.manzana}` : (g.manzana || null),
    g.cuenta_normalizada || null, (d.matriculas || []).join('|') || null, g.lat ?? null, g.lon ?? null, r.fuente || null, d.revisar ? 1 : 0,
    r.inscripcion ? r.inscripcion.estado : null, r.repetido_de ? 0 : 1, d.resolucion_fecha || null, r.tokens || 0, r.error || null, r.cargado_en || ahora(), JSON.stringify(r)];
}
function guardarRegistro(r) { q.insRes.run(...filaDesde(r)); }
/**
 * Varias escrituras con una sola confirmación a disco: con miles de resoluciones, reescribir la base de a una por vez
 * hacía que cada PDF del Embudo tardara segundos. No se anida: si ya hay una abierta, solo corre fn.
 */
let EN_TRANSACCION = false;
function enTransaccion(fn) {
  if (EN_TRANSACCION) return fn();
  db.prepare('BEGIN').run(); EN_TRANSACCION = true;
  try { const r = fn(); db.prepare('COMMIT').run(); return r; }
  catch (e) { try { db.prepare('ROLLBACK').run(); } catch (x) { /* ya cerrada */ } throw e; }
  finally { EN_TRANSACCION = false; }
}
function actualizarRegistro(r) {
  const d = r.derivado || {}, g = d.geo || {}, c = g.catastro || {};
  q.actJson.run(JSON.stringify(r), d.tipo_documento ? PierriCore.clasificar(d) : null, d.revisar ? 1 : 0, r.inscripcion ? r.inscripcion.estado : null,
    g.lat ?? null, g.lon ?? null, g.localidad_catastro || g.localidad || null, c.manzana ? `${c.circunscripcion}-${c.seccion}-${c.manzana}` : (g.manzana || null), r.hash);
}
function todosLosRegistros() { return q.todas.all().map(f => JSON.parse(f.json)); }
/**
 * Aplica la corrección manual sobre el derivado: si alguien corrigió la fecha de posesión mirando el PDF,
 * esa fecha manda sobre la que leyó el sistema, y la elegibilidad se recalcula con ella.
 */
function aplicarRevision(r, cfg) {
  const rev = r.revision;
  if (!r.derivado) return;
  r.derivado.revision = rev || null;
  if (!rev) return;
  if (rev.tipo_documento) {
    r.derivado.tipo_documento = rev.tipo_documento;
    r.derivado.motivos_revision = (r.derivado.motivos_revision || []).filter(m => !m.startsWith('tipo_documento:'));
  }
  if (rev.posee_desde) {
    r.derivado.posee_desde = rev.posee_desde;
    r.derivado.posee_desde_precision = 'dia';
    r.derivado.posesion_criterio = 'CORREGIDA_A_MANO';
    r.derivado.elegibilidad = PierriCore.evaluarElegibilidad(PierriCore.parseFecha(rev.posee_desde), cfg);
  }
  if (rev.revisado) {
    r.derivado.revisar = false;
    r.derivado.motivos_revision = [];
  }
}

/** Un expediente con varias resoluciones: la de fecha más nueva es la válida; las otras quedan repetidas. */
function marcarRepetidos(registros) {
  const porExp = new Map();
  for (const r of registros) { if (!r.derivado || !r.derivado.expediente || r.error) continue; if (!porExp.has(r.derivado.expediente)) porExp.set(r.derivado.expediente, []); porExp.get(r.derivado.expediente).push(r); }
  let n = 0;
  for (const lista of porExp.values()) {
    lista.sort((a, b) => String(b.derivado.resolucion_fecha || '').localeCompare(String(a.derivado.resolucion_fecha || '')) || String(b.cargado_en || '').localeCompare(String(a.cargado_en || '')));
    lista.forEach((r, i) => { const antes = !!r.repetido_de; r.repetido_de = i === 0 ? null : lista[0].archivo; if (antes !== !!r.repetido_de) n++; q.setValida.run(i === 0 ? 1 : 0, r.hash); });
  }
  return n;
}

// ───────────────────────────── Padrón ─────────────────────────────
const claveNombre = s => PierriCore.normalizarTexto(s).split(' ').filter(Boolean).sort().join(' ');
const ESTADO_PADRON = { DEF: 'INSCRIPTA', PRV: 'PROVISORIA', OBS: 'OBSERVADA' };
function cargarPadron(buf, nombreArchivo) {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (e) { throw new Error('Falta la librería xlsx. Instalala con:  npm install xlsx@0.18.5'); }
  const wb = XLSX.read(buf, { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  if (!filas.length) throw new Error('la planilla está vacía');
  const col = n => Object.keys(filas[0]).find(k => k.trim().toUpperCase() === n);
  const cNro = col('NROUNICO'), cDia = col('DIARIO'), cEst = col('ESTADO_PROCESO'), cNom = col('NOMBREPERSONA'), cTipo = col('TIPO_PARTICIPACION');
  if (!cNro || !cEst) throw new Error('no tiene las columnas del Padrón (NROUNICO, DIARIO, ESTADO_PROCESO, NOMBREPERSONA)');
  q.padronBorrar.run();
  let n = 0;
  db.prepare('BEGIN').run();
  try {
    const vistos = new Set();
    for (const f of filas) {
      const nro = String(f[cNro] || '').trim(); if (!nro) continue;
      const anio = (String(f[cDia] || '').match(/\/\s*(\d{4})/) || [])[1] || null;
      // Varias personas por anotación: una fila por persona, con clave compuesta.
      // Si la planilla repite la misma combinación, se queda con la primera en vez de fallar.
      const id = f[cNom] ? `${nro}|${claveNombre(f[cNom])}` : nro;
      if (vistos.has(id)) continue;
      vistos.add(id);
      q.padronIns.run(id, String(f[cDia] || '').replace(/\s+/g, ' ').trim(), anio, String(f[cEst] || '').trim() || null,
        f[cNom] || null, f[cNom] ? claveNombre(f[cNom]) : null, f[cTipo] || null);
      n++;
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    try { db.prepare('ROLLBACK').run(); } catch (e) { /* ya cerrada */ }
    throw new Error('no se pudo leer la planilla del Padrón: ' + (err.message || err));
  }
  q.setMeta.run('padron_archivo', nombreArchivo); q.setMeta.run('padron_cargado_en', ahora()); q.setMeta.run('padron_filas', String(n));
  return n;
}
function plausible(anioDiario, anioReso) { const a = Number(anioDiario), r = Number(anioReso); if (!a || !r) return true; return a >= r && a <= r + 3; }
/** Deja el resultado del cruce tanto en el registro como en su derivado: el Tablero lo lee desde el derivado. */
function marcarInscripcion(r, insc) { r.inscripcion = insc; if (r.derivado) r.derivado.inscripcion = insc; }
function cruzarConPadron(registros) {
  const padron = q.padronTodos.all();
  if (!padron.length) return { cruzados: 0, ambiguos: 0, no_figuran: 0, sin_nombre: 0, sin_padron: true };
  const porNombre = new Map();
  for (const p of padron) { if (!p.nombre_clave) continue; if (!porNombre.has(p.nombre_clave)) porNombre.set(p.nombre_clave, []); porNombre.get(p.nombre_clave).push(p); }
  const porNombreRes = new Map();
  for (const r of registros) { if (!r.derivado || r.repetido_de || r.error) continue; const k = claveNombre(r.derivado.rogante_principal); if (!k) continue; if (!porNombreRes.has(k)) porNombreRes.set(k, []); porNombreRes.get(k).push(r); }
  const res = { cruzados: 0, ambiguos: 0, no_figuran: 0, sin_nombre: 0, por_estado: {} };
  for (const r of registros) {
    if (!r.derivado || r.repetido_de || r.error) continue;
    let nombre = r.derivado.rogante_principal, fuenteNombre = 'resolucion';
    if (!nombre && r.derivado.expediente) { const inv = q.invPorExpNombre.get(expInventario(r.derivado.expediente)); if (inv && inv.iniciador) { nombre = inv.iniciador; fuenteNombre = 'inventario'; } }
    const k = claveNombre(nombre);
    if (!k) { res.sin_nombre++; marcarInscripcion(r, { estado: 'SIN_NOMBRE_PARA_CRUZAR', origen: 'padron' }); continue; }
    void fuenteNombre;
    const enPadron = porNombre.get(k) || [], enRes = porNombreRes.get(k) || [];
    const anotaciones = Array.from(new Map(enPadron.map(p => [p.nro_unico.split('|')[0], p])).values());
    if (!anotaciones.length) { res.no_figuran++; marcarInscripcion(r, { estado: 'NO_FIGURA_EN_PADRON', origen: 'padron', confianza: 'nombre_no_encontrado' }); }
    else if (anotaciones.length === 1 && enRes.length === 1 && plausible(anotaciones[0].anio, r.derivado.resolucion_anio)) {
      const a = anotaciones[0]; res.cruzados++; const est = ESTADO_PADRON[a.estado] || a.estado; res.por_estado[est] = (res.por_estado[est] || 0) + 1;
      marcarInscripcion(r, { estado: est, estado_codigo: a.estado, diario: a.diario, anio_diario: a.anio, nro_unico: a.nro_unico.split('|')[0], participacion: a.tipo, origen: 'padron', confianza: 'nombre_unico' });
    } else {
      res.ambiguos++;
      marcarInscripcion(r, { estado: 'AMBIGUO', origen: 'padron', confianza: anotaciones.length === 1 && enRes.length === 1 ? 'anio_incompatible' : 'nombre_repetido',
        candidatas: anotaciones.map(a => ({ nro_unico: a.nro_unico.split('|')[0], diario: a.diario, anio: a.anio, estado: ESTADO_PADRON[a.estado] || a.estado })) });
    }
  }
  return res;
}

// ───────────────────────────── Inventario de expedientes digitalizados (CSV de la UEST) ─────────────────────────────
function parsearCSV(txt) {
  const lineas = txt.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) return [];
  const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = lineas[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
  return lineas.slice(1).map(l => { const c = l.split(sep).map(x => x.trim().replace(/^"|"$/g, '')); const o = {}; cab.forEach((h, i) => o[h] = c[i] == null ? '' : c[i]); return o; });
}
/** Normaliza números de expediente del SUAC ("++00000535-101806--2012", "0535-026939-2006") al formato 0535-nnnnnn-aaaa. */
function normalizarExpediente(s) {
  const t = String(s || '').replace(/[^\d-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const m = t.match(/^0*(\d{3,4})-0*(\d{5,7})-(\d{4})$/);
  if (!m) return null;
  return `${m[1].padStart(4, '0')}-${m[2].padStart(6, '0')}-${m[3]}`;
}
function fechaISO(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; }
/**
 * Carga un CSV del inventario. Reconoce dos formatos por sus columnas:
 *   - Ypsilon / Y-Neura (expedientes digitalizados): Expediente; Departamento; Hojas; Cuenta; Nº Resolución; Estado resol.; En universo
 *   - SUAC (faltantes por digitalizar o universo completo): Nº Exp. SUAC; Estado; Iniciador; Nº Doc; Cuenta; Departamento; Fecha ingreso; Fecha resol.
 * Las filas se fusionan por expediente: un CSV nuevo del mismo origen reemplaza al anterior; uno de otro origen completa columnas.
 */
function cargarInventario(buf, nombreArchivo) {
  const filas = parsearCSV(buf.toString('utf8'));
  if (!filas.length) throw new Error('el CSV está vacío');
  const col = (...ns) => { for (const n of ns) { const k = Object.keys(filas[0]).find(k => PierriCore.normalizarTexto(k) === PierriCore.normalizarTexto(n)); if (k) return k; } return null; };
  const cExp = col('Expediente'), cSuac = col('Nº Exp. SUAC', 'N Exp SUAC', 'Nro Exp SUAC', 'Expediente SUAC');
  const formato = cSuac ? 'suac' : cExp ? 'digitalizados' : null;
  if (!formato) throw new Error('no reconozco las columnas: se espera el CSV de expedientes digitalizados (Expediente; Estado resol.; …) o el del SUAC (Nº Exp. SUAC; Iniciador; Nº Doc; …)');
  const cDep = col('Departamento'), cCta = col('Cuenta'), cHoj = col('Hojas'), cRes = col('Nº Resolución', 'N Resolucion', 'Nro Resolucion'), cEst = col('Estado resol.', 'Estado resol'), cUni = col('En universo');
  const cEstS = col('Estado'), cIni = col('Iniciador'), cDoc = col('Nº Doc', 'N Doc', 'DNI', 'Documento'), cFI = col('Fecha ingreso'), cFR = col('Fecha resol.', 'Fecha resol', 'Fecha resolucion');
  const origen = formato === 'suac' ? (/falt/i.test(nombreArchivo) ? 'suac_faltantes' : 'suac') : 'digitalizados';
  q.invBorrarOrigen.run(origen);
  db.prepare('BEGIN').run();
  let n = 0, descartadas = 0;
  for (const f of filas) {
    const exp = formato === 'suac' ? normalizarExpediente(f[cSuac]) : (/^\d{4}-\d{5,7}-\d{4}$/.test(String(f[cExp] || '').trim()) ? String(f[cExp]).trim() : null);
    if (!exp) { descartadas++; continue; }
    const cta = String(f[cCta] || '').replace(/\D/g, '');
    const ctaValida = cta.length === 12 && Number(cta.slice(0, 2)) >= 11 && Number(cta.slice(0, 2)) <= 36 ? 1 : 0;
    const anio = Number(exp.slice(-4)) || null;
    if (formato === 'digitalizados') {
      const est = String(f[cEst] || '').trim();
      q.invIns.run(exp, String(f[cDep] || '').trim() || null, Number(f[cHoj]) || 0, ctaValida ? cta : null, ctaValida, String(f[cRes] || '').trim() || null, est || null, /resoluci/i.test(est) ? 1 : 0,
        /^s/i.test(String(f[cUni] || '')) ? 1 : 0, anio && anio > 1990 && anio < 2100 ? anio : null, origen, null, null, null, null, null);
    } else {
      const dni = String(f[cDoc] || '').replace(/\D/g, '').replace(/^0+/, '') || null;
      const ini = String(f[cIni] || '').replace(/\s+/g, ' ').replace(/\s*C\.?P\.?\s*\d{4}.*$/i, '').trim() || null;
      const fr = fechaISO(f[cFR]);
      q.invIns.run(exp, String(f[cDep] || '').trim() || null, 0, ctaValida ? cta : null, ctaValida, null, origen === 'suac_faltantes' ? 'No digitalizado' : null, fr ? 1 : 0,
        1, anio && anio > 1990 && anio < 2100 ? anio : null, origen, ini, dni && dni.length >= 6 ? dni : null, fechaISO(f[cFI]), fr, String(f[cEstS] || '').trim() || null);
    }
    n++;
  }
  db.prepare('COMMIT').run();
  const previo = (q.meta.get('inventario_archivo') || {}).valor || '';
  q.setMeta.run('inventario_archivo', previo && !previo.includes(nombreArchivo) ? previo + ' + ' + nombreArchivo : nombreArchivo);
  q.setMeta.run('inventario_cargado_en', ahora()); q.setMeta.run('inventario_filas', String(db.prepare('SELECT COUNT(*) n FROM inventario').get().n));
  return { filas: n, descartadas, formato, origen };
}
/** Ubica en Catastro un lote de cuentas del inventario que todavía no tienen parcela. Devuelve cuántas consultó y cuántas encontró. */
async function ubicarInventario(maximo) {
  const cuentas = q.invCuentasSinParcela.all(maximo || 500).map(f => f.cuenta);
  if (!cuentas.length) return { consultadas: 0, encontradas: 0, pendientes: 0 };
  const parcelas = await PierriCore.consultarCatastro(cuentas);
  const t = ahora();
  db.prepare('BEGIN').run();
  let enc = 0;
  for (const c of cuentas) {
    const p = parcelas[c];
    if (p) { enc++; q.parcIns.run(c, 1, p.nomenclatura, p.departamento, p.pedania, p.localidad, p.tipo_parcela, p.estado, p.designacion, p.sup_tierra, p.sup_mejoras, p.valuacion, p.lat, p.lon, t); }
    else q.parcIns.run(c, 0, null, null, null, null, null, null, null, null, null, null, null, null, t);
  }
  db.prepare('COMMIT').run();
  return { consultadas: cuentas.length, encontradas: enc, pendientes: q.invPendientes.get().n };
}
function resumenInventario() {
  const r = q.invResumen.get() || {};
  if (!r.total) return { cargado: false };
  return { cargado: true, archivo: (q.meta.get('inventario_archivo') || {}).valor || null, cargado_en: (q.meta.get('inventario_cargado_en') || {}).valor || null,
    total: r.total, con_resolucion: r.con_resolucion || 0, con_cuenta: r.con_cuenta || 0, con_resolucion_y_cuenta: r.con_resolucion_y_cuenta || 0, en_universo: r.en_universo || 0,
    sin_digitalizar: r.sin_digitalizar || 0, con_dni: r.con_dni || 0, con_iniciador: r.con_iniciador || 0,
    ubicadas: q.invUbicadas.get().n, pendientes_catastro: q.invPendientes.get().n, leidas: q.invLeidos.get().n, por_estado: q.invPorEstado.all() };
}

// ───────────────────────────── Procesar un PDF que llega ─────────────────────────────
let procesando = Promise.resolve();
/** Si la clave de API falló de forma grave (inválida, sin crédito), no se la vuelve a usar hasta que se guarde otra. */
let MODELO_BLOQUEADO = null;
async function recibirPDF(buf, nombre) {
  const h = Lector.hash(buf);
  const previo = q.archivo.get(h);
  let revisionesPrevias = new Map();
  if (previo) {
    const buenas = db.prepare('SELECT COUNT(*) n FROM resoluciones WHERE hash_archivo = ? AND error IS NULL').get(h).n;
    const fallidas = db.prepare('SELECT COUNT(*) n FROM resoluciones WHERE hash_archivo = ? AND error IS NOT NULL').get(h).n;
    if (buenas > 0 && fallidas === 0) return { estado: 'ya_cargado', hash: h, nombre_previo: previo.nombre, unidades: previo.unidades };
    // La vez anterior el archivo falló (entero o en parte): se borra lo fallido y se lee de nuevo.
    // Si tenía resoluciones buenas con revisión manual, la revisión se conserva al volver a guardarlas.
    db.prepare('DELETE FROM resoluciones WHERE hash_archivo = ? AND error IS NOT NULL').run(h);
    revisionesPrevias = new Map(db.prepare('SELECT id, json FROM resoluciones WHERE hash_archivo = ?').all(h)
      .map(f => [f.id, JSON.parse(f.json).revision || null]).filter(([, v]) => v));
    if (buenas === 0) db.prepare('DELETE FROM archivos WHERE hash = ?').run(h);
  }
  fs.writeFileSync(path.join(RUTA_EMBUDO, `${h}_${nombre.replace(/[^\w.\-]+/g, '_')}`), buf);
  const vistos = new Set();
  const opcionesLectura = { key: CONFIG.key, modelo: CONFIG.modelo, cfg: cfgElegibilidad(), tabla: TABLA, vistos, modeloBloqueado: MODELO_BLOQUEADO };
  const { registros, tipo, paginas, sueltas, paginasCuerpo, bloquesDescartados, resolucionesTramite } = await Lector.procesarArchivo(buf, nombre, opcionesLectura);
  if (opcionesLectura.modeloBloqueado) MODELO_BLOQUEADO = opcionesLectura.modeloBloqueado;
  try { await Lector.ubicarEnCatastro(registros.filter(r => r.derivado).map(r => r.derivado), TABLA); } catch (e) { /* se reintenta después */ }
  for (const r of registros) if (r.derivado) PierriCore.ubicarPorLocalidad(r.derivado, LOCALIDADES);
  const t = ahora();
  for (const r of registros) {
    r.cargado_en = t;
    const rv = revisionesPrevias.get(r.hash);
    if (rv) r.revision = rv;
    guardarRegistro(r);
    if (rv) q.setRevision.run(rv.revisado ? 1 : 0, rv.en, rv.revisor, rv.nota, JSON.stringify({ posee_desde: rv.posee_desde, tipo_documento: rv.tipo_documento }), JSON.stringify(r), r.hash);
  }
  q.insArchivo.run(h, nombre, tipo, paginas, registros.length, JSON.stringify(sueltas.map(p => p + 1)), t);
  // Repetidos y Padrón sobre todo lo que hay
  const todos = todosLosRegistros();
  enTransaccion(() => {
    marcarRepetidos(todos);
    cruzarConPadron(todos);
    PierriCore.detectarClusters(todos.filter(r => r.derivado && !r.repetido_de).map(r => r.derivado));
    for (const r of todos) actualizarRegistro(r);
  });
  return { estado: 'procesado', hash: h, tipo, paginas, unidades: registros.length, sueltas: sueltas.map(p => p + 1),
    paginas_cuerpo: paginasCuerpo || 0, bloques_descartados: bloquesDescartados || 0, resoluciones_tramite: resolucionesTramite || 0,
    por_texto: registros.filter(r => r.fuente === 'texto').length, por_modelo: registros.filter(r => r.fuente === 'modelo').length,
    incompletas: registros.filter(r => r.fuente === 'texto_incompleto').length, errores: registros.filter(r => r.error).length,
    errores_detalle: registros.filter(r => r.error).map(r => r.error).slice(0, 2),
    // solo si alguna resolución de ESTE archivo necesitaba el modelo y no lo pudo usar
    falla_modelo: (registros.find(r => r.falla_modelo) || {}).falla_modelo || null,
    tokens: registros.reduce((a, r) => a + (r.tokens || 0), 0),
    expedientes: registros.filter(r => r.derivado).map(r => ({ expediente: r.derivado.expediente, clasificacion: PierriCore.clasificar(r.derivado), rogante: r.derivado.rogante_principal })) };
}

/** Recalcula elegibilidad con la configuración actual (sin releer PDF) y vuelve a marcar repetidos y a cruzar. */
function recalcularTodo() {
  const todos = todosLosRegistros();
  const cfg = cfgElegibilidad();
  for (const r of todos) {
    if (!r.derivado) continue;
    const d = r.derivado, pd = d.posee_desde ? PierriCore.parseFecha(d.posee_desde) : null;
    d.elegibilidad = PierriCore.evaluarElegibilidad(pd, cfg);
    d.motivos_revision = (d.motivos_revision || []).filter(m => !m.startsWith('caso borde'));
    if (d.elegibilidad.borde) d.motivos_revision.push(`caso borde (posee desde ${d.posee_desde}, límite ${d.elegibilidad.fechaLimite})`);
    d.revisar = d.motivos_revision.length > 0;
    aplicarRevision(r, cfg);
    PierriCore.ubicarPorLocalidad(d, LOCALIDADES);
  }
  const cruce = enTransaccion(() => {
    marcarRepetidos(todos);
    const c = cruzarConPadron(todos);
    PierriCore.detectarClusters(todos.filter(r => r.derivado && !r.repetido_de).map(r => r.derivado));
    for (const r of todos) actualizarRegistro(r);
    return c;
  });
  return { total: todos.length, cruce };
}

/** Vuelve a leer con el modelo las incompletas (cuando se carga la clave después). */
async function completarConModelo(maximo) {
  if (!CONFIG.key) return { completadas: 0, pendientes: 0, motivo: 'sin clave' };
  const todos = todosLosRegistros();
  const todasPend = todos.filter(r => r.fuente === 'texto_incompleto' && !r.error);
  // De a pocas por llamada: así el Tablero puede mostrar el avance en vez de quedarse esperando.
  const pend = todasPend.slice(0, maximo || 5);
  let n = 0, tokens = 0; const fallas = [];
  for (const r of pend) {
    const ruta = fs.readdirSync(RUTA_EMBUDO).find(f => f.startsWith(r.hash_archivo + '_'));
    if (!ruta) continue;
    try {
      let buf = fs.readFileSync(path.join(RUTA_EMBUDO, ruta));
      if (r.tomo) buf = await Lector.recortarPaginas(buf, r.tomo.desde, r.tomo.hasta);
      const { extraido, tokens: tk } = await Lector.leerConModelo(buf, { key: CONFIG.key, modelo: CONFIG.modelo });
      const fusion = Lector.fusionar(r.extraido, extraido);
      const nombreControl = r.tomo ? (r.tomo.expedienteVisto ? `documento_${r.tomo.expedienteVisto.replace('/', '-')}_tomo.pdf` : r.archivo) : r.archivo;
      r.extraido = fusion; r.derivado = PierriCore.procesarRegistro(fusion, cfgElegibilidad(), TABLA, new Set(), { nombreArchivo: nombreControl });
      r.fuente = 'modelo'; r.tokens = tk; r.lectura = { fuente: 'modelo', completada_despues: true }; tokens += tk; n++;
      q.insRes.run(...filaDesde(r));
    } catch (err) { r.error_modelo = String(err.message || err); fallas.push(Lector.motivoModelo(err).texto); actualizarRegistro(r); }
  }
  if (n) { try { await Lector.ubicarEnCatastro(todosLosRegistros().filter(r => r.derivado).map(r => r.derivado), TABLA); } catch (e) {} recalcularTodo(); }
  const quedan = todosLosRegistros().filter(r => r.fuente === 'texto_incompleto' && !r.error).length;
  return { completadas: n, pendientes: quedan, tokens, fallas: fallas.slice(0, 3) };
}

// ───────────────────────────── Servidor ─────────────────────────────
function leerCuerpo(req) { return new Promise((res, rej) => { const partes = []; req.on('data', c => partes.push(c)); req.on('end', () => res(Buffer.concat(partes))); req.on('error', rej); }); }
function json(res, obj, code = 200) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function resumen() {
  const todos = todosLosRegistros();
  const validos = todos.filter(r => r.derivado && !r.repetido_de && !r.error);
  return {
    archivos: db.prepare('SELECT COUNT(*) n FROM archivos').get().n, resoluciones: validos.length, repetidas: todos.filter(r => r.repetido_de).length,
    errores: todos.filter(r => r.error).length, incompletas: validos.filter(r => r.fuente === 'texto_incompleto').length,
    padron: { archivo: (q.meta.get('padron_archivo') || {}).valor || null, cargado_en: (q.meta.get('padron_cargado_en') || {}).valor || null, filas: Number((q.meta.get('padron_filas') || {}).valor || 0) },
    tokens: todos.reduce((a, r) => a + (r.tokens || 0), 0),
    inventario: resumenInventario(),
  };
}
/** Cruza cada resolución leída con su fila del inventario (cuenta y número de resolución) y lo deja en r.inventario. */
function anexarInventario(registros) {
  for (const r of registros) {
    if (!r.derivado || !r.derivado.expediente) continue;
    const f = q.invPorExp.get(expInventario(r.derivado.expediente));
    if (!f) { r.inventario = null; continue; }
    const ctaLeida = (r.derivado.geo && r.derivado.geo.cuenta_normalizada || '').replace(/\D/g, '');
    r.inventario = { departamento: f.departamento, cuenta: f.cuenta, nro_resolucion: f.nro_resolucion, estado_digitalizacion: f.estado_digitalizacion, en_universo: !!f.en_universo,
      iniciador: f.iniciador || null, dni: f.dni || null, fecha_ingreso: f.fecha_ingreso || null,
      dni_coincide: f.dni && r.derivado.dni_principal ? String(f.dni).replace(/^0+/, '') === String(r.derivado.dni_principal).replace(/\D/g, '').replace(/^0+/, '') : null,
      cuenta_coincide: f.cuenta && ctaLeida ? f.cuenta === ctaLeida : null,
      resolucion_coincide: f.nro_resolucion && r.derivado.resolucion_numero ? String(f.nro_resolucion).replace(/^0+/, '') === String(r.derivado.resolucion_numero).replace(/^0+/, '') : null };
  }
}
/* ══════════════ Usuarios, sesiones y auditoría ══════════════
   Sigue el Estándar de Desarrollo Seguro del Gobierno de Córdoba (E SIG 004), nivel 2: contraseñas de 12 a 128
   caracteres sin truncar, guardadas con scrypt y sal; bloqueo por intentos fallidos; sesiones con token aleatorio,
   vencimiento por inactividad y cierre del lado del servidor; cookie HttpOnly/SameSite; y registro de auditoría. */
const ROLES = { admin: 'Administración', editor: 'Revisión', veedor: 'Consulta' };
const INACTIVIDAD_MIN = 30, SESION_MAX_H = 12, INTENTOS_MAX = 5, BLOQUEO_MIN = 15;

function derivar(clave, sal) { return crypto.scryptSync(String(clave), sal, 64, { N: 16384, r: 8, p: 1 }).toString('hex'); }
function claveValida(c) {
  if (typeof c !== 'string') return 'La contraseña es obligatoria.';
  if ([...c].length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if ([...c].length > 128) return 'La contraseña no puede superar los 128 caracteres.';
  return null;
}
function crearUsuario({ usuario, nombre, rol, clave, debeCambiar }) {
  const u = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Error('El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.');
  if (!ROLES[rol]) throw new Error('Perfil desconocido.');
  const mal = claveValida(clave); if (mal) throw new Error(mal);
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(u)) throw new Error('Ya existe un usuario con ese nombre.');
  const sal = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO usuarios (usuario, nombre, rol, hash, sal, algoritmo, activo, debe_cambiar, creado_en, actualizado_en)
              VALUES (?,?,?,?,?,'scrypt',1,?,?,?)`).run(u, String(nombre || u), rol, derivar(clave, sal), sal, debeCambiar ? 1 : 0, ahora(), ahora());
  return u;
}
function cambiarClave(usuario, nueva) {
  const mal = claveValida(nueva); if (mal) throw new Error(mal);
  const sal = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar = 0, actualizado_en = ?, intentos = 0, bloqueado_hasta = NULL WHERE usuario = ?')
    .run(derivar(nueva, sal), sal, ahora(), usuario);
}
function verificarClave(fila, clave) {
  if (!fila || !fila.hash || !fila.sal) return false;
  const a = Buffer.from(derivar(clave, fila.sal), 'hex'), b = Buffer.from(fila.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function ipDe(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }
function auditar(req, sesion, accion, detalle) {
  db.prepare('INSERT INTO auditoria (fecha, usuario, rol, accion, detalle, ip) VALUES (?,?,?,?,?,?)')
    .run(ahora(), (sesion && sesion.usuario) || '—', (sesion && sesion.rol) || '—', accion, detalle == null ? null : String(detalle).slice(0, 400), ipDe(req));
}
function cookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) { const i = par.indexOf('='); if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); }
  return out;
}
function sesionDe(req) {
  const t = cookies(req).pierri_sesion;
  if (!t) return null;
  const s = db.prepare('SELECT * FROM sesiones WHERE token = ?').get(t);
  if (!s) return null;
  const hoy = new Date();
  if (new Date(s.vence_en) < hoy || (hoy - new Date(s.visto_en)) > INACTIVIDAD_MIN * 60000) { db.prepare('DELETE FROM sesiones WHERE token = ?').run(t); return null; }
  const us = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(s.usuario);
  if (!us) { db.prepare('DELETE FROM sesiones WHERE token = ?').run(t); return null; }
  db.prepare('UPDATE sesiones SET visto_en = ? WHERE token = ?').run(ahora(), t);
  return { token: t, usuario: us.usuario, nombre: us.nombre, rol: us.rol, debe_cambiar: !!us.debe_cambiar };
}
function abrirSesion(req, res, usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario, creada_en, visto_en, vence_en, ip, agente) VALUES (?,?,?,?,?,?,?)')
    .run(token, usuario, ahora(), ahora(), new Date(Date.now() + SESION_MAX_H * 3600000).toISOString(), ipDe(req), String(req.headers['user-agent'] || '').slice(0, 200));
  const partes = [`pierri_sesion=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${SESION_MAX_H * 3600}`];
  if (SEGURO) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
  return token;
}
function cerrarSesion(token) { if (token) db.prepare('DELETE FROM sesiones WHERE token = ?').run(token); }
/** Qué puede hacer cada perfil. El control es del servidor; la pantalla solo acompaña. */
const PERMISOS = { ver: ['veedor', 'editor', 'admin'], revisar: ['editor', 'admin'], cargar: ['editor', 'admin'], administrar: ['admin'] };
function puede(sesion, que) { return !!sesion && PERMISOS[que].includes(sesion.rol); }
function hayUsuarios() { return db.prepare('SELECT COUNT(*) n FROM usuarios WHERE activo = 1').get().n > 0; }
function ipsLocales() {
  const out = [];
  for (const lista of Object.values(require('os').networkInterfaces())) for (const i of lista) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
const servidor = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const sesion = sesionDe(req);
  try {
    // ── Acceso ──
    if (req.method === 'POST' && u.pathname === '/api/login') {
      const { usuario, clave } = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
      const us = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario || '').trim().toLowerCase());
      if (us && us.bloqueado_hasta && new Date(us.bloqueado_hasta) > new Date()) {
        auditar(req, null, 'ingreso_bloqueado', usuario);
        return json(res, { error: `La cuenta está bloqueada por intentos fallidos. Probá de nuevo después de las ${new Date(us.bloqueado_hasta).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}.` }, 429);
      }
      if (!us || !us.activo || !verificarClave(us, clave)) {
        if (us) {
          const n = (us.intentos || 0) + 1;
          db.prepare('UPDATE usuarios SET intentos = ?, bloqueado_hasta = ? WHERE usuario = ?')
            .run(n, n >= INTENTOS_MAX ? new Date(Date.now() + BLOQUEO_MIN * 60000).toISOString() : null, us.usuario);
        }
        auditar(req, null, 'ingreso_fallido', usuario);
        return json(res, { error: 'Usuario o contraseña incorrectos.' }, 401);   // sin decir cuál de los dos
      }
      db.prepare('UPDATE usuarios SET intentos = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE usuario = ?').run(ahora(), us.usuario);
      abrirSesion(req, res, us.usuario);
      auditar(req, { usuario: us.usuario, rol: us.rol }, 'ingreso', null);
      return json(res, { ok: true, usuario: us.usuario, nombre: us.nombre, rol: us.rol, debe_cambiar: !!us.debe_cambiar });
    }
    if (req.method === 'POST' && u.pathname === '/api/logout') {
      if (sesion) { cerrarSesion(sesion.token); auditar(req, sesion, 'salida', null); }
      res.setHeader('Set-Cookie', 'pierri_sesion=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
      return json(res, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/api/yo') {
      if (!hayUsuarios()) return json(res, { sin_usuarios: true });
      if (!sesion) return json(res, { error: 'sin sesión' }, 401);
      return json(res, { usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol, rol_nombre: ROLES[sesion.rol], debe_cambiar: sesion.debe_cambiar, permisos: Object.fromEntries(Object.keys(PERMISOS).map(k => [k, puede(sesion, k)])) });
    }
    if (req.method === 'POST' && u.pathname === '/api/clave') {
      if (!sesion) return json(res, { error: 'sin sesión' }, 401);
      const { actual, nueva } = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
      const us = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(sesion.usuario);
      if (!verificarClave(us, actual)) { auditar(req, sesion, 'cambio_clave_fallido', null); return json(res, { error: 'La contraseña actual no es correcta.' }, 400); }
      try { cambiarClave(sesion.usuario, nueva); } catch (e) { return json(res, { error: e.message }, 400); }
      db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?').run(sesion.usuario, sesion.token);   // se cierran las demás sesiones
      auditar(req, sesion, 'cambio_clave', null);
      return json(res, { ok: true });
    }
    // ── Usuarios (solo administración) ──
    if (u.pathname === '/api/usuarios') {
      if (!puede(sesion, 'administrar')) return json(res, { error: 'No tenés permiso para administrar usuarios.' }, 403);
      if (req.method === 'GET') {
        return json(res, { roles: ROLES, usuarios: db.prepare('SELECT usuario, nombre, rol, activo, debe_cambiar, creado_en, ultimo_acceso, bloqueado_hasta FROM usuarios ORDER BY usuario').all() });
      }
      if (req.method === 'POST') {
        const c = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
        try {
          if (c.accion === 'crear') { crearUsuario({ usuario: c.usuario, nombre: c.nombre, rol: c.rol, clave: c.clave, debeCambiar: true }); auditar(req, sesion, 'usuario_alta', `${c.usuario} (${c.rol})`); }
          else if (c.accion === 'rol') { if (!ROLES[c.rol]) throw new Error('Perfil desconocido.'); db.prepare('UPDATE usuarios SET rol = ?, actualizado_en = ? WHERE usuario = ?').run(c.rol, ahora(), c.usuario); auditar(req, sesion, 'usuario_perfil', `${c.usuario} → ${c.rol}`); }
          else if (c.accion === 'activo') {
            if (c.usuario === sesion.usuario) throw new Error('No podés desactivar tu propia cuenta.');
            db.prepare('UPDATE usuarios SET activo = ?, actualizado_en = ? WHERE usuario = ?').run(c.activo ? 1 : 0, ahora(), c.usuario);
            if (!c.activo) db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(c.usuario);
            auditar(req, sesion, c.activo ? 'usuario_activado' : 'usuario_desactivado', c.usuario);
          }
          else if (c.accion === 'reiniciar_clave') { cambiarClave(c.usuario, c.clave); db.prepare('UPDATE usuarios SET debe_cambiar = 1 WHERE usuario = ?').run(c.usuario); db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(c.usuario); auditar(req, sesion, 'usuario_clave_reiniciada', c.usuario); }
          else throw new Error('Acción desconocida.');
        } catch (e) { return json(res, { error: e.message }, 400); }
        return json(res, { ok: true, usuarios: db.prepare('SELECT usuario, nombre, rol, activo, debe_cambiar, creado_en, ultimo_acceso, bloqueado_hasta FROM usuarios ORDER BY usuario').all() });
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/auditoria') {
      if (!puede(sesion, 'administrar')) return json(res, { error: 'No tenés permiso para ver la auditoría.' }, 403);
      const n = Math.min(Number(u.query.n) || 200, 2000);
      return json(res, { registros: db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').all(n) });
    }
    // ── De acá en adelante hace falta sesión ──
    if (!sesion && u.pathname.startsWith('/api/') && hayUsuarios()) return json(res, { error: 'sin sesión' }, 401);
    const necesita = { '/api/revision': 'revisar', '/api/pdf': 'cargar', '/api/padron': 'cargar', '/api/inventario': 'cargar',
      '/api/inventario/ubicar': 'cargar', '/api/catastro': 'cargar', '/api/completar': 'cargar', '/api/releer': 'cargar',
      '/api/config': 'administrar', '/api/vaciar': 'administrar' }[u.pathname];
    if (necesita && hayUsuarios() && !puede(sesion, necesita))
      return json(res, { error: `Tu perfil (${ROLES[sesion.rol]}) no puede hacer esta operación.` }, 403);

    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/tablero_pierri.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(RUTA_TABLERO));
    }
    if (req.method === 'GET' && u.pathname === '/api/datos') {
      const todos = todosLosRegistros();
      const cfgEl = cfgElegibilidad();
      for (const r of todos) { aplicarRevision(r, cfgEl); if (r.derivado) PierriCore.ubicarPorLocalidad(r.derivado, LOCALIDADES); }
      anexarInventario(todos);
      return json(res, { config: Object.assign({}, CONFIG, { key: CONFIG.key ? '••••' + CONFIG.key.slice(-4) : '' }), resumen: resumen(), registros: todos });
    }
    if (req.method === 'POST' && u.pathname === '/api/pdf') {
      const nombre = decodeURIComponent(u.query.nombre || 'archivo.pdf');
      const buf = await leerCuerpo(req);
      if (!buf.length) return json(res, { error: 'archivo vacío' }, 400);
      if (buf.length > 80 * 1024 * 1024) return json(res, { error: 'El archivo supera los 80 MB.' }, 413);
      if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return json(res, { error: 'El archivo no es un PDF.' }, 415);
      auditar(req, sesion, 'cargar_pdf', nombre);
      const r = await (procesando = procesando.then(() => recibirPDF(buf, nombre)).catch(e => ({ estado: 'error', error: String(e.message || e) })));
      return json(res, r);
    }
    if (req.method === 'POST' && u.pathname === '/api/padron') {
      const nombre = decodeURIComponent(u.query.nombre || 'padron.xls');
      const buf = await leerCuerpo(req);
      const filas = cargarPadron(buf, nombre);
      const r = recalcularTodo();
      return json(res, { filas, cruce: r.cruce });
    }
    if (req.method === 'POST' && u.pathname === '/api/inventario') {
      const nombre = decodeURIComponent(u.query.nombre || 'inventario.csv');
      const r = cargarInventario(await leerCuerpo(req), nombre);
      return json(res, Object.assign(r, { inventario: resumenInventario() }));
    }
    if (req.method === 'POST' && u.pathname === '/api/inventario/ubicar') {
      const r = await ubicarInventario(Number(u.query.maximo) || 500);
      return json(res, Object.assign(r, { inventario: resumenInventario() }));
    }
    if (req.method === 'GET' && u.pathname === '/api/inventario/localidades') {
      return json(res, { localidades: q.invPorLocalidad.all(), inventario: resumenInventario() });
    }
    if (req.method === 'POST' && u.pathname === '/api/vaciar') {
      auditar(req, sesion, 'borrar_todo', null);
      // Empezar de cero: borra resoluciones, archivos, padrón, inventario y parcelas, y vacía la carpeta embudo. No toca la configuración.
      db.exec('DELETE FROM resoluciones; DELETE FROM archivos; DELETE FROM padron; DELETE FROM inventario; DELETE FROM parcelas; DELETE FROM meta;');
      try { db.exec('VACUUM'); } catch (e) {}
      for (const f of fs.readdirSync(RUTA_EMBUDO)) { try { fs.unlinkSync(path.join(RUTA_EMBUDO, f)); } catch (e) {} }
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/config') {
      auditar(req, sesion, 'configurar', null);
      const c = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
      let verificacion = null;
      if (typeof c.key === 'string' && !c.key.startsWith('••••')) {
        CONFIG.key = c.key.trim(); MODELO_BLOQUEADO = null;
        if (CONFIG.key) {
          // Consulta gratuita (lista de modelos): confirma que la clave existe. No confirma que haya crédito.
          try {
            const rv = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': CONFIG.key, 'anthropic-version': '2023-06-01' } });
            verificacion = rv.ok ? { ok: true, texto: 'La clave es válida.' } : { ok: false, texto: Lector.motivoModelo(new Error('la API respondió ' + rv.status)).texto };
          } catch (e) { verificacion = { ok: false, texto: 'no se pudo verificar la clave: no hay conexión a internet' }; }
        }
      }
      for (const k of ['modelo', 'regla', 'fechaCorte']) if (c[k]) CONFIG[k] = c[k];
      for (const k of ['anosPlazoMovil', 'margenBordeMeses']) if (c[k] != null && c[k] !== '') CONFIG[k] = Number(c[k]);
      guardarConfig(CONFIG);
      return json(res, { ok: true, verificacion, recalculado: recalcularTodo() });
    }
    if (req.method === 'POST' && u.pathname === '/api/completar') {
      auditar(req, sesion, 'completar_con_modelo', null);
      const maximo = Number(u.query.maximo) || 5;
      const r = await (procesando = procesando.then(() => completarConModelo(maximo)).catch(e => ({ error: String(e.message || e) })));
      return json(res, r);
    }
    if (req.method === 'POST' && u.pathname === '/api/releer') {
      auditar(req, sesion, 'releer', null);
      // Vuelve a leer PDF ya cargados con el código actual del Lector. Sirve cada vez que se corrige
      // una regla de lectura: sin esto, lo cargado antes conserva la lectura vieja.
      // Respeta las revisiones manuales: lo corregido a mano se vuelve a aplicar encima.
      const soloId = String(u.query.id || '');
      const r0 = await (procesando = procesando.then(async () => {
        const todos = todosLosRegistros();
        const objetivo = soloId ? todos.filter(r => r.hash === soloId) : todos;   // incluye las que fallaron antes
        let releidas = 0; const fallas = [];
        for (const r of objetivo) {
          const archivo = fs.readdirSync(RUTA_EMBUDO).find(f => f.startsWith(r.hash_archivo + '_'));
          if (!archivo) { fallas.push(`${r.archivo}: ya no está el PDF`); continue; }
          try {
            let buf = fs.readFileSync(path.join(RUTA_EMBUDO, archivo));
            if (r.tomo) buf = await Lector.recortarPaginas(buf, r.tomo.desde, r.tomo.hasta);
            const pags = await Lector.textoPorPagina(buf);
            const nombreControl = r.tomo ? (r.tomo.expedienteVisto ? `documento_${r.tomo.expedienteVisto.replace('/', '-')}_tomo.pdf` : r.archivo) : r.archivo;
            const lect = PierriTexto.extraerDeTexto(pags.join(' '), nombreControl);
            r.extraido = lect.extraido;
            r.derivado = PierriCore.procesarRegistro(lect.extraido, cfgElegibilidad(), TABLA, new Set(), { nombreArchivo: nombreControl, textoCapaPDF: pags.join(' ') });
            r.fuente = lect.suficiente ? 'texto' : 'texto_incompleto';
            r.lectura = { fuente: r.fuente, cobertura: lect.cobertura, faltan: lect.faltan, releida_en: ahora() };
            if (!lect.suficiente) { r.derivado.revisar = true; r.derivado.motivos_revision = (r.derivado.motivos_revision || []).concat(['el texto del PDF no alcanzó: faltan ' + lect.faltan.join(', ')]); }
            delete r.error; delete r.falla_modelo;
            releidas++;
            q.insRes.run(...filaDesde(r));
            if (r.revision) q.setRevision.run(r.revision.revisado ? 1 : 0, r.revision.en, r.revision.revisor, r.revision.nota,
              JSON.stringify({ posee_desde: r.revision.posee_desde, tipo_documento: r.revision.tipo_documento }), JSON.stringify(r), r.hash);
          } catch (err) { fallas.push(`${r.archivo}: ${err.message || err}`); }
        }
        try { await Lector.ubicarEnCatastro(todosLosRegistros().filter(r => r.derivado).map(r => r.derivado), TABLA); } catch (e) {}
        recalcularTodo();
        return { releidas, total: objetivo.length, fallas: fallas.slice(0, 3) };
      }).catch(e => ({ error: String(e.message || e) })));
      return json(res, r0);
    }
    if (req.method === 'POST' && u.pathname === '/api/revision') {
      auditar(req, sesion, 'revisar', null);
      // Marca una resolución como revisada a mano, con nota y corrección opcional de la fecha de posesión.
      const c = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
      const fila = q.porId.get(String(c.id || ''));
      if (!fila) return json(res, { error: 'no encuentro esa resolución' }, 404);
      const r = JSON.parse(fila.json);
      const fecha = String(c.posee_desde || '').trim();
      if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, { error: 'la fecha corregida debe ser AAAA-MM-DD' }, 400);
      const TIPOS = ['RESOLUCION_INSCRIPCION', 'RESOLUCION_RECTIFICA', 'RESOLUCION_DESESTIMA', 'RESOLUCION_CANCELA', 'RESOLUCION_TRAMITE', 'CEDULA_NOTIFICACION'];
      const tipo = TIPOS.includes(String(c.tipo_documento)) ? String(c.tipo_documento) : null;
      r.revision = { revisado: !!c.revisado, revisor: String(c.revisor || '').slice(0, 80) || null,
        nota: String(c.nota || '').slice(0, 500) || null, posee_desde: fecha || null, tipo_documento: tipo, en: ahora() };
      aplicarRevision(r, cfgElegibilidad());
      q.setRevision.run(r.revision.revisado ? 1 : 0, r.revision.en, r.revision.revisor, r.revision.nota,
        JSON.stringify({ posee_desde: r.revision.posee_desde, tipo_documento: r.revision.tipo_documento }), JSON.stringify(r), r.hash);
      actualizarRegistro(r);
      return json(res, { ok: true, revision: r.revision, clasificacion: PierriCore.clasificar(r.derivado) });
    }
    if (req.method === 'POST' && u.pathname === '/api/catastro') {
      const todos = todosLosRegistros();
      const n = await Lector.ubicarEnCatastro(todos.filter(r => r.derivado).map(r => r.derivado), TABLA);
      enTransaccion(() => { for (const r of todos) actualizarRegistro(r); });
      return json(res, { ubicadas: n });
    }
    if (req.method === 'GET' && u.pathname === '/api/documento') {
      auditar(req, sesion, 'ver_documento', String(u.query.id || ''));
      // Devuelve el PDF original de una resolución, para poder controlar a mano lo que leyó el sistema.
      // Si vino dentro de un expediente o un tomo, se recortan solo sus páginas.
      const fila = q.porId.get(String(u.query.id || ''));
      if (!fila) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('No encuentro esa resolución.'); }
      const r = JSON.parse(fila.json);
      const archivo = fs.readdirSync(RUTA_EMBUDO).find(f => f.startsWith(r.hash_archivo + '_'));
      if (!archivo) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('El PDF original ya no está en la carpeta de archivos.'); }
      let pdf = fs.readFileSync(path.join(RUTA_EMBUDO, archivo));
      if (r.tomo) { try { pdf = await Lector.recortarPaginas(pdf, r.tomo.desde, r.tomo.hasta); } catch (e) { /* si falla, se manda entero */ } }
      const nombre = ((r.derivado && r.derivado.expediente) || 'resolucion').replace(/[^\w.\-]+/g, '_') + '.pdf';
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${nombre}"`, 'cache-control': 'no-store' });
      return res.end(pdf);
    }
    if (req.method === 'GET' && u.pathname === '/api/archivos') {
      // Qué pasó con cada archivo cargado: explica por qué N archivos no dan N expedientes.
      const porArchivo = new Map();
      for (const r of todosLosRegistros()) {
        const a = porArchivo.get(r.hash_archivo) || []; a.push(r); porArchivo.set(r.hash_archivo, a);
      }
      const filas = db.prepare('SELECT hash, nombre, tipo, paginas, unidades, cargado_en FROM archivos ORDER BY cargado_en, nombre').all().map(a => {
        const rs = porArchivo.get(a.hash) || [];
        const validas = rs.filter(r => r.derivado && !r.repetido_de && !r.error);
        const repetidas = rs.filter(r => r.derivado && r.repetido_de);
        return { nombre: a.nombre, paginas: a.paginas, resoluciones: rs.length,
          suma: validas.map(r => r.derivado.expediente || '?'),
          repetidas: repetidas.map(r => ({ expediente: r.derivado.expediente, queda: r.repetido_de })),
          errores: rs.filter(r => r.error).map(r => r.error),
          tipos: [...new Set(rs.map(r => r.derivado && r.derivado.tipo_documento).filter(Boolean))] };
      });
      return json(res, { archivos: filas });
    }
    if (req.method === 'GET' && u.pathname === '/api/planilla.csv') {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="planilla_ley_pierri.csv"' });
      return res.end('\ufeff' + PierriCore.aCSV(todosLosRegistros().filter(r => r.derivado && !r.repetido_de)));
    }
    res.writeHead(404); res.end('no encontrado');
  } catch (err) { json(res, { error: String(err.message || err) }, 500); }
});

/**
 * Importa a la base el resultado de una corrida de procesar_lote.js, con sus PDF.
 *   node pierri.js --importar ./salida --pdfs ./resoluciones
 * Deja todo como si se hubiera cargado desde el Tablero: se puede abrir el documento original, corregir a mano
 * y queda el historial. Si un archivo ya estaba cargado, se saltea (se puede cortar y volver a correr).
 */
function importarLote(dirSalida, dirPDFs) {
  const rutaJsonl = fs.existsSync(dirSalida) && fs.statSync(dirSalida).isDirectory() ? path.join(dirSalida, 'resultados.jsonl') : dirSalida;
  if (!fs.existsSync(rutaJsonl)) { console.error(`No encuentro ${rutaJsonl}`); process.exit(1); }

  // Índice de los PDF por nombre de archivo, para copiarlos al embudo
  const pdfs = new Map();
  if (dirPDFs) {
    const recorrer = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = path.join(d, e.name);
      if (e.isDirectory()) recorrer(r); else if (/\.pdf$/i.test(e.name) && !pdfs.has(e.name)) pdfs.set(e.name, r); } };
    if (fs.existsSync(dirPDFs)) recorrer(dirPDFs); else { console.error(`No encuentro la carpeta ${dirPDFs}`); process.exit(1); }
  }

  const lineas = fs.readFileSync(rutaJsonl, 'utf8').split('\n').filter(l => l.trim());
  console.log(`Importando ${lineas.length} resoluciones de ${rutaJsonl}`);
  const t = ahora();
  let nuevas = 0, yaEstaban = 0, sinPdf = 0, conPdf = 0, fallidas = 0;
  const porArchivo = new Map(), hashPorArchivo = new Map();
  const tx = db.prepare('BEGIN'); tx.run();
  try {
    for (const linea of lineas) {
      let r; try { r = JSON.parse(linea); } catch (e) { fallidas++; continue; }
      if (!r || !r.hash) { fallidas++; continue; }
      if (db.prepare('SELECT 1 FROM resoluciones WHERE id = ?').get(r.hash)) { yaEstaban++; continue; }
      // El lote no guarda el identificador del archivo: se calcula del PDF, igual que al cargarlo por pantalla.
      // Sin esto no se podría abrir el documento original desde la ficha.
      if (!r.hash_archivo) {
        // En los tomos, el nombre viene con el tramo de páginas ("tomo.pdf#p2-3"): el archivo es el mismo para todas.
        const nom = path.basename(String(r.archivo || r.ruta || '').split('#')[0]);
        if (!hashPorArchivo.has(nom)) {
          const origen = pdfs.get(nom) || (r.ruta && fs.existsSync(r.ruta) ? r.ruta : null);
          hashPorArchivo.set(nom, origen ? Lector.hash(fs.readFileSync(origen)) : Lector.hash(Buffer.from(nom)));
        }
        r.hash_archivo = hashPorArchivo.get(nom);
      }
      r.cargado_en = r.cargado_en || t;
      guardarRegistro(r);
      nuevas++;
      if (r.hash_archivo) {
        const a = porArchivo.get(r.hash_archivo) || { nombre: String(r.archivo || '').split('#')[0], paginas: r.paginas || 0, unidades: 0 };
        a.unidades++; porArchivo.set(r.hash_archivo, a);
      }
    }
    for (const [hash, a] of porArchivo) {
      if (!db.prepare('SELECT 1 FROM archivos WHERE hash = ?').get(hash))
        q.insArchivo.run(hash, a.nombre, a.unidades > 1 ? 'tomo' : 'suelta', a.paginas, a.unidades, '[]', t);
      // El PDF original, para poder abrirlo desde la ficha
      const ya = fs.readdirSync(RUTA_EMBUDO).some(f => f.startsWith(hash + '_'));
      const origen = a.nombre && pdfs.get(path.basename(a.nombre));
      if (ya) conPdf++;
      else if (origen) { fs.copyFileSync(origen, path.join(RUTA_EMBUDO, `${hash}_${a.nombre.replace(/[^\w.\-]+/g, '_')}`)); conPdf++; }
      else sinPdf++;
    }
    db.prepare('COMMIT').run();
  } catch (e) { db.prepare('ROLLBACK').run(); console.error('Falló la importación, no se guardó nada:', e.message); process.exit(1); }

  const todos = todosLosRegistros();
  enTransaccion(() => {
    marcarRepetidos(todos);
    cruzarConPadron(todos);
    for (const r of todos) if (r.derivado) { PierriCore.ubicarPorLocalidad(r.derivado, LOCALIDADES); q.insRes.run(...filaDesde(r)); }
  });
  recalcularTodo();
  const c = {};
  for (const f of db.prepare('SELECT clasificacion k, COUNT(*) n FROM resoluciones WHERE valida = 1 GROUP BY clasificacion').all()) c[f.k] = f.n;
  console.log(`\n  nuevas:        ${nuevas}`);
  console.log(`  ya estaban:    ${yaEstaban}`);
  if (fallidas) console.log(`  líneas rotas:  ${fallidas}`);
  console.log(`  archivos:      ${conPdf} con su PDF guardado${sinPdf ? `, ${sinPdf} sin PDF (no estaban en la carpeta indicada)` : ''}`);
  console.log(`\n  elegibles:     ${(c.ELEGIBLE || 0) + (c.ELEGIBLE_BORDE || 0)}`);
  console.log(`  no elegibles:  ${(c.NO_ELEGIBLE || 0) + (c.NO_ELEGIBLE_BORDE || 0)}`);
  console.log(`  a revisar:     ${(c.REVISAR || 0) + (c.SIN_DATO || 0)}`);
  console.log(`  no aplican:    ${c.NO_APLICA || 0}`);
  console.log(`\nListo. Abrí el Tablero con: node pierri.js`);
  if (sinPdf && !dirPDFs) console.log('Para poder abrir los documentos originales, volvé a correr agregando --pdfs <carpeta de los PDF>.');
}

const iImp = args.indexOf('--importar');
if (iImp >= 0) {
  const iPdf = args.indexOf('--pdfs');
  importarLote(args[iImp + 1], iPdf >= 0 ? args[iPdf + 1] : null);
  process.exit(0);
}

// Primera puesta en marcha: si no hay usuarios, se crea el administrador. La contraseña se muestra una sola vez.
let claveInicial = null;
if (!hayUsuarios()) {
  claveInicial = ADMIN_CLAVE || (crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '') + 'Aa1!');
  try { crearUsuario({ usuario: 'admin', nombre: 'Administración', rol: 'admin', clave: claveInicial, debeCambiar: !ADMIN_CLAVE }); }
  catch (e) { console.error('No se pudo crear el usuario inicial:', e.message); }
} else if (ADMIN_CLAVE) {
  try { cambiarClave('admin', ADMIN_CLAVE); console.log('  Contraseña de "admin" reiniciada.'); } catch (e) { console.error(e.message); }
}

servidor.listen(PUERTO, COMPARTIR ? '0.0.0.0' : '127.0.0.1', () => {
  const dir = `http://localhost:${PUERTO}`;
  console.log('Relevamiento Ley Pierri');
  console.log(`  Tablero:  ${dir}`);
  if (COMPARTIR) { for (const ip of ipsLocales()) console.log(`  En la red: http://${ip}:${PUERTO}   (usuario pierri, contraseña la de --clave-acceso)`); }
  console.log(`  Base:     ${RUTA_DB}  (${q.contar.get().n} resoluciones)`);
  console.log(`  Archivos: ${RUTA_EMBUDO}`);
  console.log(CONFIG.key ? `  Modelo:   ${CONFIG.modelo}` : '  Sin clave de API: se lee solo por texto; la clave se carga desde el Tablero.');
  console.log(`  Usuarios: ${db.prepare('SELECT COUNT(*) n FROM usuarios WHERE activo = 1').get().n} activos` + (SEGURO ? ' · cookie de sesión marcada como Secure (HTTPS)' : ''));
  if (claveInicial) {
    console.log('\n  ╭──────────────────────────────────────────────────────────────╮');
    console.log('  │  PRIMER ARRANQUE: se creó el usuario  admin                   │');
    console.log(`  │  Contraseña: ${claveInicial.padEnd(46)}│`);
    console.log('  │  Anotala y cambiala al entrar. No vuelve a mostrarse.         │');
    console.log('  ╰──────────────────────────────────────────────────────────────╯\n');
  }
  console.log('  Para cerrar: Ctrl+C');
  if (!SIN_NAVEGADOR) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
    execFile(cmd[0], cmd[1], () => {});
  }
});
