/*
 * Relevamiento Ley Pierri — la planilla de trámites de la UEST
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_sia.js — la planilla de trámites que exporta el sistema de la UEST (SIPO / SIA: una fila por expediente) como
 * fuente de una ESTIMACIÓN de la posesión cuando todavía no se leyó la resolución:
 *
 *     posee desde ≈ fecha de ingreso del trámite − antigüedad declarada al iniciarlo
 *
 * No reemplaza a la resolución. Cuando se lee la del expediente, manda la lectura, y la planilla queda para medir cuánto
 * acierta (compararConLeidas). Lo usa la versión web.
 *
 *   filasSIA(matriz)                                la hoja (filas de celdas) → filas compactas, una por expediente
 *   registroDePlanilla(fila, cfg, tabla, meta)      un registro con la forma de los leídos, con fuente 'planilla'
 *   compararConLeidas(registros, porExp, cfg, tabla) cuánto acierta la planilla contra las resoluciones leídas
 *   canonExpediente(e)                              "0535-12345-2008" o "0535-012345/2008" → "0535-012345/2008"
 *
 * De la planilla se guarda solo lo que sirve para estimar, ubicar y cruzar. No se leen los testigos, el domicilio del
 * iniciador, los comentarios ni la deuda.
 *
 * Sin DOM. Depende solo de pierri_core.js. Node (module.exports) y navegador (window.PierriSIA).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pierri_core.js'));
  else root.PierriSIA = factory(root.PierriCore);
})(typeof self !== 'undefined' ? self : this, function (PierriCore) {
  'use strict';
  const P = PierriCore;
  const TIPO = 'PLANILLA_UEST';

  /** Las columnas que se leen, por su título (sin tildes ni guiones bajos). Si hay varias, vale la primera con dato. */
  const CAMPOS = {
    expediente: ['NRO EXP SUAC', 'NRO EXPEDIENTE', 'EXPEDIENTE'],
    fecha_ingreso: ['FECHA INGRESO'],
    antiguedad: ['ANTIGUEDAD'],
    resolucion_fecha: ['FECHA RESOLUC', 'FECHA RESOLUCION'],
    resolucion_numero: ['NUMERO RESOLUCION', 'NRO RESOLUCION'],
    iniciador_resolucion: ['IINICIADOR EN RESOLUCION', 'INICIADOR EN RESOLUCION'],
    iniciador: ['INICIADOR'],
    dni: ['NRO DOC INICIADOR'],
    cuenta: ['CUENTA', 'NUMERO CUENTA'],
    localidad: ['LOCALIDAD PARCELA'],
    domicilio: ['DOMICILIO PARCELA'],
    pedania: ['PEDANIA'],
    tipo_lugar: ['TIPO LUGAR'],
    superficie: ['SUPERFICIE'],
    estado: ['ESTADO TRAMITE'],
    etapa: ['TRIBUNAL'],
  };
  const OBLIGATORIOS = ['expediente', 'fecha_ingreso', 'antiguedad'];

  /** "0535-12345-2008", "E 0535-012345/2008" → "0535-012345/2008". null si no tiene forma de expediente. */
  function canonExpediente(e) {
    const s = String(e == null ? '' : e);
    const m = s.match(/(\d{3,4})\s*-*\s*(\d{4,7})\s*[-/*]+\s*(\d{4})(?!\d)/);
    if (m) return `${m[1].padStart(4, '0')}-${m[2].padStart(6, '0')}/${m[3]}`;
    // Los expedientes digitales del SUAC ("UE01-123456789-123") van tal cual.
    const d = s.toUpperCase().match(/\b([A-Z]{2,5}\d{2}-\d{9}-\d{3})\b/);
    return d ? d[1] : null;
  }
  const SIN_DATO = /^(S\/?D|N\/?D|NO DECLARA|SIN DATOS?|-+|0)$/i;
  function texto(v, largo) {
    if (v == null) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return !s || SIN_DATO.test(s) ? null : s.slice(0, largo || 160);
  }
  /** Fecha de una celda: "15/3/2008" (con o sin punto final), "2008-03-15" o el número de serie de Excel. */
  function fechaCelda(v) {
    if (v == null || v === '') return null;
    let d = null;
    // Una fecha de Excel con hora trae decimales: la hora no cambia el día (redondear pasaría la tarde al día siguiente).
    if (typeof v === 'number') { if (v > 20000 && v < 80000) d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); }
    else d = P.parseFecha(String(v).trim().replace(/\s+\d{1,2}:\d{2}.*$/, '').replace(/\.+$/, ''));
    if (!d) return null;
    const a = d.getUTCFullYear();
    return a >= 1950 && a <= new Date().getUTCFullYear() + 1 ? P.fmtFecha(d) : null;
  }
  function numero(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  /** La cuenta de Rentas de 12 dígitos con departamento posible (11 a 36), como la valida el inventario. */
  function cuentaDe(v) {
    const c = String(v == null ? '' : v).replace(/\D/g, '');
    return c.length === 12 && Number(c.slice(0, 2)) >= 11 && Number(c.slice(0, 2)) <= 36 ? c : null;
  }
  function dniDe(v) {
    const m = String(v == null ? '' : v).replace(/\./g, '').match(/\d{6,9}/);
    return m ? m[0].replace(/^0+/, '') : null;
  }
  const LECTOR = { expediente: canonExpediente, fecha_ingreso: fechaCelda, resolucion_fecha: fechaCelda, antiguedad: numero, cuenta: cuentaDe, dni: dniDe,
    resolucion_numero: v => { const s = texto(v, 20); return s && /\d/.test(s) ? s.replace(/^0+(?=\d)/, '') : null; } };

  /**
   * Lee la hoja de la planilla de trámites, tal como la da XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true }).
   * Una fila por expediente: si la planilla lo repite, la fila de más abajo completa y corrige a la anterior.
   * @param {Array<Array>} matriz
   * @returns {{ filas: object[], descartadas: number, total: number }}
   */
  function filasSIA(matriz) {
    const filas = matriz || [];
    const norm = v => P.normalizarTexto(v == null ? '' : v);
    // La fila de títulos: la primera (de las veinte de arriba) que tenga las columnas obligatorias.
    let cab = -1;
    for (let i = 0; i < Math.min(filas.length, 20) && cab < 0; i++) {
      const t = (filas[i] || []).map(norm);
      if (OBLIGATORIOS.every(k => CAMPOS[k].some(n => t.includes(n)))) cab = i;
    }
    if (cab < 0) {
      const vistos = (filas[0] || []).filter(v => v != null && String(v).trim()).slice(0, 10).map(v => String(v).trim().slice(0, 30));
      throw new Error('no reconozco la planilla: se esperan las columnas de número de expediente (NRO_EXP_SUAC), fecha de ingreso (FECHA_INGRESO) y antigüedad (ANTIGUEDAD), como en la planilla de trámites del SIA de la UEST'
        + (vistos.length ? `. En la primera fila hay: ${vistos.join(' · ')}` : '. La primera fila está vacía'));
    }
    const titulos = filas[cab].map(norm);
    const cols = {};
    for (const [campo, nombres] of Object.entries(CAMPOS)) cols[campo] = nombres.flatMap(n => titulos.flatMap((t, j) => t === n ? [j] : []));
    const porExp = new Map();
    let descartadas = 0, total = 0;
    for (const f of filas.slice(cab + 1)) {
      if (!f || !f.some(v => v != null && String(v).trim() !== '')) continue;
      total++;
      const fila = {};
      for (const [campo, js] of Object.entries(cols)) {
        const leer = LECTOR[campo] || texto;
        let valor = null;
        for (const j of js) { valor = leer(f[j]); if (valor != null) break; }
        fila[campo] = valor;
      }
      if (!fila.expediente) { descartadas++; continue; }
      const previa = porExp.get(fila.expediente);
      if (previa) { for (const [k, v] of Object.entries(fila)) if (v != null) previa[k] = v; }
      else porExp.set(fila.expediente, fila);
    }
    return { filas: [...porExp.values()], descartadas, total };
  }

  /** La antigüedad que se puede usar: de 1 a 100 años, como la que se acepta al leer una resolución. */
  const antiguedadUsable = a => Number.isFinite(a) && a >= 1 && a <= 100;
  function estimacion(f, cfg) {
    const a = numero(f.antiguedad), usable = antiguedadUsable(a);
    const pos = usable && f.fecha_ingreso
      ? P.calcularPoseeDesde({ fecha_referencia: f.fecha_ingreso, antiguedad_anios: Math.floor(a), antiguedad_meses: Math.round((a % 1) * 12) })
      : { fecha: null, precision: null };
    const motivo = !f.fecha_ingreso ? 'la planilla no trae la fecha de ingreso del trámite'
      : !usable ? `la planilla no trae una antigüedad que se pueda usar (${a == null ? 'vacía' : a + ' años'})` : null;
    return { fecha: pos.fecha, precision: pos.precision, motivo, elegibilidad: P.evaluarElegibilidad(pos.fecha, cfg) };
  }
  const tipoInmueble = t => { const s = P.normalizarTexto(t); return /^RUR/.test(s) ? 'rural' : /^U/.test(s) ? 'urbano' : null; };

  /**
   * Un expediente de la planilla con la forma de un registro leído, para que el Tablero lo liste, lo ubique, lo cruce
   * con el Padrón y lo cuente igual que a los demás. Va con fuente 'planilla' y tipo PLANILLA_UEST: no es una lectura.
   * @param {object} f      fila de filasSIA
   * @param {object} cfg    el criterio de elegibilidad
   * @param {object} tabla  TABLA_CODIGOS (departamentos y pedanías)
   * @param {{archivo, cargado_en}} meta
   */
  function registroDePlanilla(f, cfg, tabla, meta) {
    const m = meta || {}, est = estimacion(f, cfg);
    const fRes = P.parseFecha(f.resolucion_fecha);
    const dec = P.decodificarCuenta(f.cuenta, tabla);
    const nombre = f.iniciador_resolucion || f.iniciador || null;
    const derivado = {
      expediente: f.expediente, tipo_documento: TIPO,
      resolucion_numero: f.resolucion_numero || null, resolucion_fecha: P.fmtFecha(fRes), resolucion_anio: fRes ? fRes.getUTCFullYear() : null,
      cantidad_rogantes: nombre ? 1 : 0, rogante_principal: nombre, rogantes_todos: nombre ? `${nombre} (DNI ${f.dni || '?'})` : null, dni_principal: f.dni || null,
      matriculas: [], titulares_registrales: null,
      posee_desde: P.fmtFecha(est.fecha), posee_desde_precision: est.precision, posee_desde_origen: 'planilla_uest', posesion_criterio: TIPO,
      elegibilidad: est.elegibilidad,
      geo: { cuenta_normalizada: dec.normalizada, dep_codigo: dec.dep_codigo, dep_nombre: dec.dep_nombre, ped_codigo: dec.ped_codigo,
        ped_nombre: dec.ped_nombre || (f.pedania ? String(f.pedania).toUpperCase() : null), origen_ubicacion: dec.valida ? 'cuenta' : f.localidad ? 'texto' : null,
        localidad: f.localidad || null, calle: f.domicilio || null, tipo_inmueble: tipoInmueble(f.tipo_lugar) },
      senales: [], validaciones: [], revisar: false, motivos_revision: [], sin_estimar: est.motivo,
    };
    return { hash: 'sia:' + f.expediente, archivo: m.archivo || null, cargado_en: m.cargado_en || null, fuente: 'planilla', extraido: null, derivado,
      planilla: { fecha_ingreso: f.fecha_ingreso, antiguedad: numero(f.antiguedad), estado: f.estado || null, etapa: f.etapa || null,
        superficie: f.superficie || null, tipo_lugar: f.tipo_lugar || null, con_resolucion: !!(fRes || f.resolucion_numero) } };
  }

  /**
   * Cuánto acierta la planilla: para cada resolución leída (válida, que se puede evaluar) cuyo expediente está en la
   * planilla, compara si entra o no según la lectura y según la estimación. Deja en el registro leído lo que estimaba
   * la planilla (r.planilla_estimaba) y devuelve el resumen.
   * @param {object[]} registros   los leídos, ya con su clasificación final (revisiones aplicadas)
   * @param {Map} porExp           expediente canónico → fila de la planilla
   */
  function compararConLeidas(registros, porExp, cfg, tabla) {
    const out = { comparadas: 0, coinciden: 0, sin_comparar: 0, diferencia_mediana_anios: null, hasta_un_anio: 0 };
    const difs = [];
    for (const r of registros || []) {
      if (!r.derivado || r.repetido_de || r.error || r.fuente === 'planilla' || !r.derivado.tipo_documento) continue;
      const c1 = P.clasificar(r.derivado); if (c1 === 'NO_APLICA') continue;
      const f = porExp.get(canonExpediente(r.derivado.expediente)); if (!f) continue;
      const e = registroDePlanilla(f, cfg, tabla).derivado, c2 = P.clasificar(e);
      const evaluables = !/^(SIN_DATO|REVISAR)$/.test(c1) && c2 !== 'SIN_DATO';
      const coincide = evaluables ? c1.startsWith('ELEGIBLE') === c2.startsWith('ELEGIBLE') : null;
      r.planilla_estimaba = { posee_desde: e.posee_desde, clasificacion: c2, coincide, fecha_ingreso: f.fecha_ingreso, antiguedad: numero(f.antiguedad) };
      if (!evaluables) { out.sin_comparar++; continue; }
      out.comparadas++; if (coincide) out.coinciden++;
      const d = Math.abs(Number(String(r.derivado.posee_desde).slice(0, 4)) - Number(String(e.posee_desde).slice(0, 4)));
      if (Number.isFinite(d)) { difs.push(d); if (d <= 1) out.hasta_un_anio++; }
    }
    if (difs.length) { difs.sort((a, b) => a - b); out.diferencia_mediana_anios = difs[Math.floor(difs.length / 2)]; }
    return out;
  }

  /**
   * Después de cruzar con el Padrón: en un trámite que la planilla no registra con resolución no hay año de resolución
   * para controlar el del diario. Una anotación anterior al año de ingreso del trámite no puede ser de ese trámite: queda
   * ambigua, para mirarla a mano.
   */
  function controlarCruce(registros) {
    for (const r of registros || []) {
      const d = r.derivado, i = d && d.inscripcion, ingreso = r.planilla && r.planilla.fecha_ingreso;
      if (!i || !i.anio_diario || !ingreso || d.resolucion_anio) continue;
      if (Number(i.anio_diario) >= Number(String(ingreso).slice(0, 4))) continue;
      const amb = { estado: 'AMBIGUO', origen: 'padron', confianza: 'anio_incompatible',
        candidatas: [{ nro_unico: i.nro_unico, diario: i.diario, anio: i.anio_diario, estado: i.estado }] };
      r.inscripcion = amb; d.inscripcion = amb;
    }
  }

  return { TIPO, canonExpediente, CAMPOS, filasSIA, registroDePlanilla, compararConLeidas, controlarCruce };
});
