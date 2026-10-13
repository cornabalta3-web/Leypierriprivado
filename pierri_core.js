/*
 * Relevamiento Ley Pierri — el motor de reglas
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_core.js — lógica compartida de la herramienta "Relevamiento Ley Pierri" (EGG / UEST Córdoba)
 * v3 (16/09/2026) — ajustado con tres resoluciones reales; agrega georreferenciación por Catastro (IDECOR), nomenclatura,
 *      extracción completa (testigos, juzgado, documental), estado de inscripción y planilla CSV.
 *
 * Sin DOM, sin dependencias. Funciona en el navegador (window.PierriCore) y en Node (module.exports).
 *
 * Contenido:
 *   CONFIG_DEFAULT                 parámetros de elegibilidad
 *   parseFecha / fmtFecha          fechas ISO, DD/MM/AAAA y sello "14 ABR 2026", siempre en UTC
 *   expedienteDesdeNombreArchivo   "documento_0535-105743-2018_018df2ff.pdf" → "0535-105743/2018"
 *   parsearAntiguedad              lee la frase de antigüedad (números en cifras o en palabras) — control cruzado
 *   calcularPoseeDesde             fecha de inicio de posesión a partir de lo declarado (precisión fecha/mes/año)
 *   evaluarElegibilidad            CORTE_FIJO (Ley 24.374 vigente) o PLAZO_MOVIL (proyecto PE-13/26)
 *   decodificarCuenta              DD-PP-NNNNNNN/V → departamento y pedanía (tabla oficial Catastro/IDECOR)
 *   decodificarNomenclatura        nomenclatura catastral → dpto, pedanía, pueblo, circ., sección, manzana, parcela
 *   consultarCatastro              cuentas → parcelas de Catastro (IDECOR WFS): nomenclatura, localidad, estado, lat/lon
 *   enriquecerConCatastro          agrega a un derivado lo que devolvió Catastro
 *   importarEstadosInscripcion     cruza con una planilla del Registro/UEST para saber si está inscripto
 *   aFilaPlanilla / aCSV           planilla plana para Excel
 *   validarCUIL / validarExpediente / validarDNI / normalizarTexto / mismoNombre
 *   senalVivienda                  domicilio del rogante vs inmueble (marca, no filtro)
 *   procesarRegistro               JSON del modelo → derivado + validaciones + señales + revisar
 *   detectarClusters               agrupa registros por domicilio compartido y por matrícula madre
 *   resumenGeo                     conteos por departamento / pedanía / localidad
 *   PROMPT_SISTEMA / PROMPT_USUARIO / ESQUEMA_VACIO / EJEMPLOS / parsearJSON
 *
 * Ver SPEC_relevamiento_pierri.md para el contexto completo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PierriCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────── Configuración ─────────────────────────────
  const CONFIG_DEFAULT = {
    regla: 'CORTE_FIJO',        // 'CORTE_FIJO' | 'PLAZO_MOVIL'
    fechaCorte: '2006-01-01',   // CORTE_FIJO: posesión iniciada ANTES de esta fecha (3 años antes del 1/1/2009)
    anosPlazoMovil: 10,         // PLAZO_MOVIL: años de posesión anteriores a la presentación
    fechaPresentacion: null,    // PLAZO_MOVIL: null = hoy
    margenBordeMeses: 12,       // ±meses alrededor de la fecha límite → borde = true
    anioMinimoReferencia: 2003, // fecha_referencia anterior a esto se considera error de lectura
    aniosCesionReciente: 10,    // posesión por cesión iniciada hace menos de N años → señal para revisión jurídica
  };

  // ───────────────────────────── Fechas (UTC) ─────────────────────────────
  const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12,
                  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9,
                  OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
  function parseFecha(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (v == null) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return mkUTC(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return mkUTC(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{1,2})\s*(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?\s*(?:de\s+)?(\d{4})$/); // "14 ABR 2026", "14 de abril de 2026"
    if (m) { const mo = MESES[normalizarTexto(m[2])]; if (mo) return mkUTC(+m[3], mo, +m[1]); }
    m = s.match(/^(\d{4})$/);
    if (m) return mkUTC(+m[1], 1, 1);
    return null;
  }
  function mkUTC(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) ? dt : null;
  }
  function fmtFecha(dt) { return dt ? dt.toISOString().slice(0, 10) : null; }
  function restarAnios(dt, n) { const r = new Date(dt.getTime()); r.setUTCFullYear(r.getUTCFullYear() - n); return r; }
  function sumarMeses(dt, n) { const r = new Date(dt.getTime()); r.setUTCMonth(r.getUTCMonth() + n); return r; }
  function hoyUTC() { const n = new Date(); return mkUTC(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()); }

  // ───────────────────────────── Texto ─────────────────────────────
  function normalizarTexto(s) {
    if (s == null) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Compara nombres de departamento/localidad tolerando abreviaturas. */
  function mismoNombre(a, b) {
    const f = s => normalizarTexto(s).replace(/\bGRAL\b/g, 'GENERAL').replace(/\bPTE\b/g, 'PRESIDENTE')
      .replace(/\b(DPTO|DEPARTAMENTO|MUNICIPALIDAD|LOCALIDAD|COMUNA|VILLA NUEVA DE)\b/g, '').replace(/\s+/g, ' ').trim();
    const x = f(a), y = f(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  }
  const UNIDADES = { CERO: 0, UN: 1, UNO: 1, UNA: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10,
    ONCE: 11, DOCE: 12, TRECE: 13, CATORCE: 14, QUINCE: 15, DIECISEIS: 16, DIECISIETE: 17, DIECIOCHO: 18, DIECINUEVE: 19, VEINTE: 20,
    VEINTIUNO: 21, VEINTIUN: 21, VEINTIDOS: 22, VEINTITRES: 23, VEINTICUATRO: 24, VEINTICINCO: 25, VEINTISEIS: 26, VEINTISIETE: 27,
    VEINTIOCHO: 28, VEINTINUEVE: 29, TREINTA: 30, CUARENTA: 40, CINCUENTA: 50, SESENTA: 60, SETENTA: 70, OCHENTA: 80, NOVENTA: 90, CIEN: 100 };
  /** "sesenta y tres" → 63; "25" → 25; devuelve null si no entiende. */
  function palabrasANumero(s) {
    if (s == null) return null;
    const t = normalizarTexto(s);
    if (/^\d+$/.test(t)) return Number(t);
    const partes = t.split(' ').filter(p => p && p !== 'Y');
    let total = 0;
    for (const p of partes) { if (!(p in UNIDADES)) return null; total += UNIDADES[p]; }
    return partes.length ? total : null;
  }
  const NUM_RE = '(\\d{1,3}|[A-Za-zÁÉÍÓÚáéíóú]+(?:\\s+y\\s+[A-Za-zÁÉÍÓÚáéíóú]+)?)';
  const FECHA_RE = '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4})';
  /**
   * Control cruzado independiente del modelo: lee la frase de antigüedad en texto plano (capa de texto del PDF o texto_original).
   * Variantes vistas en resoluciones reales:
   *   "es de 25 años al 18/07/2025"
   *   "es sesenta años al 06/04/2018" / "es de sesenta años y tres meses al 06/04/2018"
   *   "data del 06/09/2018 (fs. 7)"
   *   "desde el año 1998" / "desde el 15/03/2001"
   * @returns {{ antiguedad_anios, antiguedad_meses, fecha_referencia, fecha_inicio_declarada, criterio, frase }|null}
   */
  function parsearAntiguedad(texto) {
    if (!texto) return null;
    const t = String(texto).replace(/\s+/g, ' ');
    const criterio = /surge de la documental/i.test(t) ? 'SURGE_DOCUMENTAL'
      : /surge del expediente/i.test(t) ? 'SURGE_EXPEDIENTE'
      : /declarad[ao] por (el|la) rogante/i.test(t) ? 'DECLARADA_ROGANTE' : null;
    let m = t.match(new RegExp('es (?:de )?' + NUM_RE + '\\s*a[ñn]os?(?:\\s*y\\s*' + NUM_RE + '\\s*mes(?:es)?)?\\s*al\\s*' + FECHA_RE, 'i'));
    if (m) {
      const a = palabrasANumero(m[1]), me = m[2] ? palabrasANumero(m[2]) : 0;
      if (a != null) return { antiguedad_anios: a, antiguedad_meses: me || 0, fecha_referencia: fmtFecha(parseFecha(m[3])),
                              fecha_inicio_declarada: null, criterio, frase: m[0] };
    }
    m = t.match(new RegExp('data del\\s*' + FECHA_RE, 'i'));
    if (m) return { antiguedad_anios: null, antiguedad_meses: null, fecha_referencia: null, fecha_inicio_declarada: fmtFecha(parseFecha(m[1])),
                    criterio: criterio || 'SURGE_EXPEDIENTE', frase: m[0] };
    m = t.match(new RegExp('desde el\\s*' + FECHA_RE, 'i'));
    if (m) return { antiguedad_anios: null, antiguedad_meses: null, fecha_referencia: null, fecha_inicio_declarada: fmtFecha(parseFecha(m[1])), criterio, frase: m[0] };
    m = t.match(/desde el a[ñn]o\s*(\d{4})/i);
    if (m) return { antiguedad_anios: null, antiguedad_meses: null, fecha_referencia: null, fecha_inicio_declarada: `${m[1]}-01-01`, criterio, frase: m[0] };
    return null;
  }
  function expedienteDesdeNombreArchivo(nombre) {
    const m = String(nombre || '').match(/(\d{4})[-_](\d{5,7})[-_\/](\d{4})/);
    return m ? `${m[1]}-${m[2]}/${m[3]}` : null;
  }

  // ───────────────────────────── Posesión ─────────────────────────────
  /** @returns {{ fecha: Date|null, precision: 'fecha'|'mes'|'anio'|null, origen: string }} */
  function calcularPoseeDesde(posesion) {
    if (!posesion) return { fecha: null, precision: null, origen: 'sin_dato' };
    const inicio = parseFecha(posesion.fecha_inicio_declarada);
    if (inicio) {
      const s = String(posesion.fecha_inicio_declarada).trim();
      const soloAnio = /^\d{4}$/.test(s) || /^\d{4}-01-01$/.test(s);
      return { fecha: inicio, precision: soloAnio ? 'anio' : 'fecha', origen: 'fecha_inicio_declarada' };
    }
    const ref = parseFecha(posesion.fecha_referencia);
    const anios = Number(posesion.antiguedad_anios);
    const meses = Number(posesion.antiguedad_meses) || 0;
    if (ref && Number.isFinite(anios) && anios > 0) {
      let f = restarAnios(ref, anios);
      if (meses > 0) f = sumarMeses(f, -meses);
      return { fecha: f, precision: meses > 0 ? 'mes' : 'anio', origen: 'antiguedad_y_referencia' };
    }
    return { fecha: null, precision: null, origen: 'sin_dato' };
  }

  function evaluarElegibilidad(poseeDesde, config) {
    const cfg = Object.assign({}, CONFIG_DEFAULT, config || {});
    let limite, detalle;
    if (cfg.regla === 'PLAZO_MOVIL') {
      const pres = parseFecha(cfg.fechaPresentacion) || hoyUTC();
      limite = restarAnios(pres, cfg.anosPlazoMovil);
      detalle = `Plazo móvil: ${cfg.anosPlazoMovil} años anteriores al ${fmtFecha(pres)} → posesión iniciada hasta el ${fmtFecha(limite)}`;
    } else {
      limite = parseFecha(cfg.fechaCorte);
      detalle = `Corte fijo: posesión iniciada antes del ${fmtFecha(limite)} (3 años antes del 1/1/2009, Ley 24.374 art. 1)`;
    }
    if (!poseeDesde) return { estado: 'SIN_DATO', borde: false, regla: cfg.regla, fechaLimite: fmtFecha(limite), detalle };
    const elegible = cfg.regla === 'PLAZO_MOVIL' ? poseeDesde <= limite : poseeDesde < limite;
    const borde = poseeDesde >= sumarMeses(limite, -cfg.margenBordeMeses) && poseeDesde <= sumarMeses(limite, cfg.margenBordeMeses);
    return { estado: elegible ? 'ELEGIBLE' : 'NO_ELEGIBLE', borde, regla: cfg.regla, fechaLimite: fmtFecha(limite), detalle };
  }

  // ───────────────────────────── Geografía: número de cuenta ─────────────────────────────
  /** Cuenta de Rentas Córdoba: DD PP NNNNNNN V (12 dígitos). DD = departamento catastral (11–36), PP = pedanía. */
  function decodificarCuenta(cuenta, tabla) {
    const out = { entrada: cuenta, digitos: null, normalizada: null, dep_codigo: null, ped_codigo: null,
                  dep_nombre: null, ped_nombre: null, valida: false, motivo: null };
    if (!cuenta) { out.motivo = 'vacía'; return out; }
    const d = String(cuenta).replace(/\D/g, '');
    out.digitos = d;
    if (d.length !== 12) { out.motivo = `se esperaban 12 dígitos, hay ${d.length}`; return out; }
    out.dep_codigo = d.slice(0, 2); out.ped_codigo = d.slice(0, 4);
    out.normalizada = `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 11)}/${d.slice(11)}`;
    out.dep_nombre = ((tabla && tabla.departamentos) || {})[out.dep_codigo] || null;
    out.ped_nombre = ((tabla && tabla.pedanias) || {})[out.ped_codigo] || null;
    if (!out.dep_nombre) { out.motivo = `departamento ${out.dep_codigo} inexistente`; return out; }
    if (!out.ped_nombre) { out.motivo = `pedanía ${out.ped_codigo} inexistente en ${out.dep_nombre}`; return out; }
    out.valida = true;
    return out;
  }

  // ───────────────────────────── Validaciones ─────────────────────────────
  function validarCUIL(cuil) {
    const d = String(cuil || '').replace(/\D/g, '');
    if (d.length !== 11) return { ok: false, digitos: d || null, dni: null, detalle: 'no tiene 11 dígitos' };
    const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) suma += Number(d[i]) * mult[i];
    let dv = 11 - (suma % 11);
    if (dv === 11) dv = 0;
    if (dv === 10) return { ok: null, digitos: d, dni: d.slice(2, 10), detalle: 'dígito verificador no determinable (prefijo especial)' };
    const ok = dv === Number(d[10]);
    return { ok, digitos: d, dni: d.slice(2, 10), detalle: ok ? 'ok' : `dígito verificador esperado ${dv}, leído ${d[10]}` };
  }
  function validarExpediente(exp) { return /^\d{4}-\d{5,7}\/\d{4}$/.test(String(exp || '').trim()); }
  function validarDNI(dni) { const d = String(dni || '').replace(/\D/g, ''); return d.length === 7 || d.length === 8; }

  // ───────────────────────────── Señal de vivienda (marca, no filtro) ─────────────────────────────
  function senalVivienda(rogante, inmueble) {
    const dom = rogante && rogante.domicilio;
    if (!dom || !inmueble) return 'SIN_DATO';
    const locR = normalizarTexto(dom.localidad), locI = normalizarTexto(inmueble.localidad);
    const calR = normalizarTexto(dom.calle), calI = normalizarTexto(inmueble.calle);
    if (!locR || !locI) return 'SIN_DATO';
    if (!mismoNombre(locR, locI)) return 'OTRA_LOCALIDAD';
    if (calR && calI && (calR === calI || calR.includes(calI) || calI.includes(calR))) return 'MISMA_CALLE';
    return 'MISMA_LOCALIDAD';
  }
  function claveDomicilio(rogante) {
    const d = rogante && rogante.domicilio;
    if (!d || !d.calle) return null;
    return [normalizarTexto(d.calle), normalizarTexto(d.numero), normalizarTexto(d.localidad)].join('|');
  }

  // ───────────────────────────── Procesamiento de un registro ─────────────────────────────
  /**
   * @param {object} extraido          JSON devuelto por el modelo (esquema 6.1 de la spec, v2)
   * @param {object} config            ver CONFIG_DEFAULT
   * @param {object} tabla             codigos_departamentos_pedanias_cordoba.json
   * @param {Set<string>} [expedientesVistos]
   * @param {object} [ctx]             { nombreArchivo, textoCapaPDF }  — para controles cruzados
   */
  function procesarRegistro(extraido, config, tabla, expedientesVistos, ctx) {
    const cfg = Object.assign({}, CONFIG_DEFAULT, config || {});
    const e = extraido || {};
    ctx = ctx || {};
    const val = [], senales = [];
    const add = (campo, ok, detalle, critica) => val.push({ campo, ok: !!ok, detalle, critica: !!critica });

    const esInscripcion = e.tipo_documento === 'RESOLUCION_INSCRIPCION';
    add('tipo_documento', esInscripcion, e.tipo_documento || 'sin tipo', true);
    if (e.tipo_documento === 'NO_ES_RESOLUCION') {
      return { expediente: expedienteDesdeNombreArchivo(ctx.nombreArchivo), tipo_documento: e.tipo_documento, cantidad_rogantes: 0,
        rogante_principal: null, rogantes_todos: null, posee_desde: null, posee_desde_precision: null, posee_desde_origen: 'sin_dato',
        elegibilidad: evaluarElegibilidad(null, cfg), geo: {}, senal_vivienda: 'SIN_DATO', senales: [], validaciones: val,
        revisar: true, motivos_revision: ['no es una resolución (confirmar y descartar)'] };
    }

    // Expediente: leído vs nombre de archivo
    const expArchivo = expedienteDesdeNombreArchivo(ctx.nombreArchivo);
    let expediente = e.expediente || null;
    add('expediente', validarExpediente(expediente), expediente || 'vacío', !expArchivo);
    if (expArchivo) {
      if (!expediente) { expediente = expArchivo; add('expediente_desde_archivo', true, expArchivo, false); }
      else add('expediente_vs_archivo', expediente === expArchivo, `leído ${expediente} / archivo ${expArchivo}`, true);
    }
    if (expedientesVistos && expediente) {
      if (expedientesVistos.has(expediente)) add('duplicado', false, `expediente ${expediente} ya procesado`, true);
      else expedientesVistos.add(expediente);
    }

    // Resolución
    const res = e.resolucion || {};
    const fRes = parseFecha(res.fecha);
    add('resolucion_fecha', !!fRes, res.fecha || 'vacía', false);
    add('resolucion_numero', !!(res.numero && String(res.numero).trim()), res.numero || 'vacío', false);

    // Rogantes
    const rogantes = Array.isArray(e.rogantes) ? e.rogantes : [];
    add('rogantes', rogantes.length > 0, `${rogantes.length} rogante(s)`, true);
    rogantes.forEach((r, i) => {
      const p = rogantes.length > 1 ? `rogante[${i}].` : '';
      add(p + 'apellido_nombre', !!(r.apellido_nombre && r.apellido_nombre.trim()), r.apellido_nombre || 'vacío', e._fuente !== 'texto');
      add(p + 'dni', validarDNI(r.dni), r.dni || 'vacío', true);
      if (r.cuil) {
        const c = validarCUIL(r.cuil);
        add(p + 'cuil', c.ok !== false, c.detalle, false);
        const dniR = String(r.dni || '').replace(/\D/g, '').replace(/^0+/, '');
        if (c.dni && dniR && c.dni.replace(/^0+/, '') !== dniR) add(p + 'cuil_vs_dni', false, `CUIL contiene ${c.dni}, DNI leído ${r.dni}`, false);
      } else add(p + 'cuil', false, 'vacío', false);
    });

    // Dominio: lista de matrículas afectadas (compatible con esquema v1: dominio.matricula / dominio.cuenta)
    const dom = e.dominio || {};
    let afectados = Array.isArray(dom.afectados) ? dom.afectados.filter(a => a && (a.matricula || a.cuenta)) : [];
    if (!afectados.length && (dom.matricula || dom.cuenta))
      afectados = [{ matricula: dom.matricula || null, cuenta: dom.cuenta || null, titular_registral: dom.titular_registral || null, afectacion: dom.afectacion || null }];
    add('matriculas_afectadas', afectados.length > 0, afectados.length ? afectados.map(a => a.matricula || '?').join(', ') : 'ninguna', true);
    if (afectados.length > 1) senales.push('MULTIPLES_MATRICULAS');
    const principal = afectados[0] || {};
    add('matricula', !!(principal.matricula && String(principal.matricula).trim()), principal.matricula || 'vacía', true);
    const cuentaDec = decodificarCuenta(principal.cuenta, tabla);
    add('cuenta', cuentaDec.valida, cuentaDec.valida ? cuentaDec.normalizada : (cuentaDec.motivo || 'inválida'), true);
    afectados.slice(1).forEach((a, i) => { const dc = decodificarCuenta(a.cuenta, tabla); add(`cuenta[${i + 1}]`, dc.valida, dc.valida ? dc.normalizada : (dc.motivo || 'inválida'), false); });
    add('afectacion', principal.afectacion === 'parcial' || principal.afectacion === 'total', principal.afectacion || 'sin dato', false);

    // Inmueble y geo
    const inm = e.inmueble || {};
    const geoCoherente = cuentaDec.valida ? mismoNombre(cuentaDec.dep_nombre, inm.departamento) : null;
    if (cuentaDec.valida) add('geo_coherente', geoCoherente, `cuenta → ${cuentaDec.dep_nombre}; texto → ${inm.departamento || 'vacío'}`, false);
    add('localidad', !!(inm.localidad && inm.localidad.trim()), inm.localidad || 'vacía', false);
    const sup = Number(inm.superficie_m2);
    add('superficie', Number.isFinite(sup) && sup > 0, inm.superficie_m2 == null ? 'vacía' : String(inm.superficie_m2), false);
    if (inm.tipo === 'rural') senales.push('RURAL');

    // Posesión (+ control cruzado con la capa de texto del PDF si se pasa)
    const pos = e.posesion || {};
    const ref = parseFecha(pos.fecha_referencia);
    const hoy = hoyUTC();
    const inicioDecl = parseFecha(pos.fecha_inicio_declarada);
    const anios = Number(pos.antiguedad_anios);
    if (inicioDecl) add('fecha_inicio_declarada', inicioDecl <= hoy, pos.fecha_inicio_declarada, true);
    else {
      add('fecha_referencia', !!ref && ref.getUTCFullYear() >= cfg.anioMinimoReferencia && ref <= hoy, pos.fecha_referencia || 'vacía', true);
      add('antiguedad_anios', Number.isFinite(anios) && anios >= 1 && anios <= 100, pos.antiguedad_anios == null ? 'vacía' : String(pos.antiguedad_anios), true);
    }
    const poseeDesde = calcularPoseeDesde(pos);
    // Control cruzado solo cuando la lectura vino del modelo (si vino del texto, sería compararla consigo misma).
    const cruce = e._fuente === 'texto' ? null : (parsearAntiguedad(ctx.textoCapaPDF) || parsearAntiguedad(pos.texto_original));
    if (cruce) {
      const pd2 = calcularPoseeDesde(cruce);
      // Tolerancia de 4 meses: "sesenta años" y "sesenta años y tres meses" son la misma lectura.
      const coincide = !!(pd2.fecha && poseeDesde.fecha) && Math.abs(pd2.fecha - poseeDesde.fecha) <= 120 * 86400000;
      add('posesion_cruce_texto', coincide, `modelo ${fmtFecha(poseeDesde.fecha)} / texto ${fmtFecha(pd2.fecha)} ("${cruce.frase}")`, true);
    }
    if (poseeDesde.fecha && fRes && poseeDesde.fecha > fRes) add('posesion_vs_resolucion', false, `posee desde ${fmtFecha(poseeDesde.fecha)} pero la resolución es del ${fmtFecha(fRes)}`, true);
    if (poseeDesde.fecha && ref && poseeDesde.fecha > ref) add('posesion_vs_referencia', false, 'la fecha de inicio es posterior a la de referencia', true);
    if (expediente && fRes) { const anioExp = Number(expediente.slice(-4)); if (anioExp > fRes.getUTCFullYear()) add('expediente_vs_resolucion', false, `expediente de ${anioExp} con resolución de ${fRes.getUTCFullYear()}`, true); }
    const eleg = evaluarElegibilidad(poseeDesde.fecha, cfg);
    if (pos.origen_mencionado === 'CESION' && poseeDesde.fecha && poseeDesde.fecha > restarAnios(hoy, cfg.aniosCesionReciente))
      senales.push('CESION_RECIENTE');
    if (pos.criterio && pos.criterio !== 'DECLARADA_ROGANTE') senales.push('ANTIGUEDAD_' + pos.criterio);
    // Persona jurídica como rogante (municipio, comuna, sociedad, asociación…): la Ley 24.374 es para personas humanas
    // que ocupan el inmueble como vivienda. No se descarta sola: se marca para que lo decida una persona.
    const r0n = String((rogantes[0] || {}).apellido_nombre || '') + ' ' + String(ctx.textoCapaPDF || '').slice(0, 900);
    const esJuridica = /\b(MUNICIPALIDAD|COMUNA\s+DE|MUNICIPIO\s+DE|S\.?\s?A\.?\b|S\.?\s?R\.?\s?L\.?|SOCIEDAD|ASOCIACI[OÓ]N|FUNDACI[OÓ]N|COOPERATIVA|CLUB|OBISPADO|ARZOBISPADO|IGLESIA)\b[^.]{0,80}?C\.?\s?U\.?\s?I\.?\s?T/i.test(r0n)
      || /C\.?\s?U\.?\s?I\.?\s?T\.?\s*N?[°º]?\s*:?\s*3[034]-/i.test(String(ctx.textoCapaPDF || '').slice(0, 900));
    if (esJuridica) senales.push('ROGANTE_PERSONA_JURIDICA');
    if (e._fuente === 'texto' && rogantes.length && rogantes[0].apellido_nombre) senales.push('NOMBRE_SEGUN_OCR');

    // Calidad declarada por el modelo
    const cal = e.calidad || {};
    const legible = cal.legibilidad === 'buena';
    const dudosos = Array.isArray(cal.campos_dudosos) ? cal.campos_dudosos.filter(Boolean) : [];
    add('legibilidad', legible, cal.legibilidad || 'sin dato', false);
    add('campos_dudosos', dudosos.length === 0, dudosos.length ? dudosos.join(', ') : 'ninguno', false);

    const r0 = rogantes[0] || {};
    const sv = senalVivienda(r0, inm);
    if (sv === 'OTRA_LOCALIDAD') senales.push('OTRA_LOCALIDAD');

    const motivos = [];
    val.filter(v => !v.ok && v.critica).forEach(v => motivos.push(`${v.campo}: ${v.detalle}`));
    if (senales.includes('ROGANTE_PERSONA_JURIDICA'))
      motivos.unshift('el rogante es una persona jurídica (municipio, sociedad, asociación): la Ley Pierri alcanza a personas humanas que ocupan el inmueble como vivienda');
    // Explicaciones en lenguaje llano para los dos casos que más confunden
    if (expArchivo && expediente && expediente !== expArchivo)
      motivos.unshift(`el documento es del expediente ${expediente}, pero el archivo se llama como el ${expArchivo}: puede estar mal archivado en el sistema de la Unidad`);
    if (e.tipo_documento === 'RESOLUCION_TRAMITE')
      motivos.unshift('es una resolución de trámite (aprueba la presentación, emplaza a presentar el plano o suspende el trámite): todavía no ordena la inscripción');
    if (e.tipo_documento === 'CEDULA_NOTIFICACION')
      motivos.unshift('es una cédula de notificación, no la resolución que ordena la inscripción; la ubicación que figura es el domicilio de la persona notificada');
    if (!legible) motivos.push(`legibilidad ${cal.legibilidad || 'sin dato'}`);
    if (dudosos.length) motivos.push(`campos dudosos: ${dudosos.join(', ')}`);
    if (eleg.borde) motivos.push(`caso borde (posee desde ${fmtFecha(poseeDesde.fecha)}, límite ${eleg.fechaLimite})`);

    return {
      expediente, tipo_documento: e.tipo_documento || null,
      resolucion_numero: res.numero || null, resolucion_fecha: fmtFecha(fRes), resolucion_anio: fRes ? fRes.getUTCFullYear() : null,
      cantidad_rogantes: rogantes.length, rogante_principal: r0.apellido_nombre || null,
      rogantes_todos: rogantes.map(r => `${r.apellido_nombre || '?'} (DNI ${r.dni || '?'})`).join(' | ') || null,
      dni_principal: r0.dni || null, clave_domicilio: claveDomicilio(r0),
      matriculas: afectados.map(a => a.matricula).filter(Boolean),
      titulares_registrales: afectados.map(a => a.titular_registral).filter(Boolean).join(' | ') || null,
      posee_desde: fmtFecha(poseeDesde.fecha), posee_desde_precision: poseeDesde.precision, posee_desde_origen: poseeDesde.origen,
      posesion_criterio: pos.criterio || null,
      elegibilidad: eleg,
      geo: { cuenta_normalizada: cuentaDec.normalizada, dep_codigo: cuentaDec.dep_codigo,
             dep_nombre: cuentaDec.dep_nombre || depDesdeTexto(inm.departamento, tabla),
             ped_codigo: cuentaDec.ped_codigo, ped_nombre: cuentaDec.ped_nombre || (inm.pedania ? String(inm.pedania).toUpperCase().trim() : null),
             origen_ubicacion: cuentaDec.valida ? 'cuenta' : (inm.departamento || inm.localidad || inm.pedania ? 'texto' : null),
             coherente: geoCoherente,
             localidad: inm.localidad || null, barrio: inm.barrio || null, calle: inm.calle || null, numero: inm.numero || null,
             manzana: inm.manzana || null, lote: inm.lote || null, tipo_inmueble: inm.tipo || null },
      senal_vivienda: sv, senales, validaciones: val, revisar: motivos.length > 0, motivos_revision: motivos,
    };
  }


  // ───────────────────────────── Nomenclatura catastral ─────────────────────────────
  /**
   * Córdoba, urbana: DD PP LL CC SS MMM PPP (16 dígitos; +3 si es PH) → departamento, pedanía, pueblo/localidad,
   * circunscripción, sección, manzana, parcela. Rural: DD PP HHHHH PPPPP (14 dígitos) → hoja, parcela.
   */
  function decodificarNomenclatura(nom, tabla) {
    const d = String(nom || '').replace(/\D/g, '');
    if (!d) return null;
    const out = { digitos: d, dep_codigo: d.slice(0, 2), ped_codigo: d.slice(0, 4), tipo: null };
    out.dep_nombre = ((tabla && tabla.departamentos) || {})[out.dep_codigo] || null;
    out.ped_nombre = ((tabla && tabla.pedanias) || {})[out.ped_codigo] || null;
    if (d.length === 16 || d.length === 19) {
      Object.assign(out, { tipo: 'urbana', pueblo: d.slice(4, 6), circunscripcion: d.slice(6, 8), seccion: d.slice(8, 10),
        manzana: d.slice(10, 13), parcela: d.slice(13, 16), ph: d.length === 19 ? d.slice(16, 19) : null,
        clave_localidad: d.slice(0, 6), clave_manzana: d.slice(0, 13),
        legible: `${d.slice(0,2)}-${d.slice(2,4)}-${d.slice(4,6)}-${d.slice(6,8)}-${d.slice(8,10)}-${d.slice(10,13)}-${d.slice(13,16)}` + (d.length === 19 ? `-${d.slice(16)}` : '') });
    } else if (d.length === 14) {
      Object.assign(out, { tipo: 'rural', hoja: d.slice(4, 9), parcela: d.slice(9, 14), clave_localidad: d.slice(0, 4), clave_manzana: null,
        legible: `${d.slice(0,2)}-${d.slice(2,4)}-${d.slice(4,9)}-${d.slice(9,14)}` });
    } else { out.tipo = 'desconocida'; out.legible = d; }
    return out;
  }

  // ───────────────────────────── Catastro (IDECOR, WFS público) ─────────────────────────────
  const CATASTRO_WFS = 'https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs';
  const CATASTRO_CAMPOS = 'Nro_Cuenta,Nomenclatura,departamento,pedania,localidad,Tipo_Parcela,Estado,desig_oficial,Superficie_Tierra_Urbana,Superficie_Tierra_Rural,Superficie_Mejoras,Valuacion,Cantidad_Cuentas,geom';
  /**
   * Busca parcelas por número de cuenta en la capa idecor:parcelas (CORS abierto, sin clave).
   * @param {string[]} cuentas   en cualquier formato; se normalizan a 12 dígitos
   * @param {function} [fetchFn] fetch a usar (por defecto el global)
   * @returns {Promise<Object<string, object>>}  mapa cuenta12 → parcela {nomenclatura, localidad, estado, ..., lat, lon}
   */
  async function consultarCatastro(cuentas, fetchFn) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw new Error('fetch no disponible');
    const ids = Array.from(new Set(cuentas.map(c => String(c || '').replace(/\D/g, '')).filter(c => c.length === 12)));
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const lote = ids.slice(i, i + 50);
      const q = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: 'idecor:parcelas',
        outputFormat: 'application/json', srsName: 'EPSG:4326', propertyName: CATASTRO_CAMPOS,
        CQL_FILTER: `Nro_Cuenta IN (${lote.join(',')})` });
      const resp = await f(`${CATASTRO_WFS}?${q}`);
      if (!resp.ok) throw new Error(`Catastro respondió ${resp.status}`);
      const data = await resp.json();
      for (const ft of (data.features || [])) {
        const p = ft.properties || {};
        const c = String(p.Nro_Cuenta || '').replace(/\D/g, '');
        if (!c) continue;
        const pts = [];
        (function junta(x) { if (Array.isArray(x) && typeof x[0] === 'number') pts.push(x); else if (Array.isArray(x)) x.forEach(junta); })(ft.geometry && ft.geometry.coordinates);
        const lon = pts.length ? pts.reduce((a, q) => a + q[0], 0) / pts.length : null;
        const lat = pts.length ? pts.reduce((a, q) => a + q[1], 0) / pts.length : null;
        out[c] = { cuenta: c, nomenclatura: p.Nomenclatura || null, departamento: p.departamento || null, pedania: p.pedania || null,
          localidad: p.localidad || null, tipo_parcela: p.Tipo_Parcela || null, estado: p.Estado || null, designacion: p.desig_oficial || null,
          sup_tierra: p.Superficie_Tierra_Urbana || p.Superficie_Tierra_Rural || null, sup_mejoras: p.Superficie_Mejoras || null,
          valuacion: p.Valuacion || null, cantidad_cuentas: p.Cantidad_Cuentas || null, lat, lon };
      }
    }
    return out;
  }
  /** Agrega a un derivado (mutándolo) los datos de la parcela de Catastro. Devuelve true si se enriqueció. */
  function enriquecerConCatastro(derivado, parcela, tabla) {
    if (!derivado || !derivado.geo) return false;
    const g = derivado.geo;
    if (!parcela) { g.catastro = { encontrada: false }; if (!derivado.senales.includes('SIN_PARCELA_CATASTRO')) derivado.senales.push('SIN_PARCELA_CATASTRO'); return false; }
    const nom = decodificarNomenclatura(parcela.nomenclatura, tabla);
    g.catastro = { encontrada: true, nomenclatura: parcela.nomenclatura, nomenclatura_legible: nom ? nom.legible : null,
      localidad: parcela.localidad, estado: parcela.estado, tipo_parcela: parcela.tipo_parcela, designacion: parcela.designacion,
      sup_tierra: parcela.sup_tierra, sup_mejoras: parcela.sup_mejoras, valuacion: parcela.valuacion, lat: parcela.lat, lon: parcela.lon,
      pueblo: nom && nom.pueblo || null, circunscripcion: nom && nom.circunscripcion || null, seccion: nom && nom.seccion || null,
      manzana: nom && nom.manzana || null, parcela: nom && nom.parcela || null,
      clave_localidad: nom && nom.clave_localidad || null, clave_manzana: nom && nom.clave_manzana || null };
    g.localidad_catastro = parcela.localidad || null;
    g.lat = parcela.lat; g.lon = parcela.lon;
    const est = normalizarTexto(parcela.estado);
    if (est.includes('BALDIO') && !derivado.senales.includes('PARCELA_BALDIA')) derivado.senales.push('PARCELA_BALDIA');
    if (parcela.tipo_parcela && normalizarTexto(parcela.tipo_parcela).includes('RURAL') && !derivado.senales.includes('RURAL')) derivado.senales.push('RURAL');
    return true;
  }

  // ───────────────────────────── Estado de inscripción ─────────────────────────────
  /**
   * La resolución solo prueba que la inscripción fue ORDENADA. Si está efectivamente inscripta en el Registro Personal de
   * Poseedores lo tiene que decir el Registro o el sistema de la UEST. Esta función cruza una planilla (filas con
   * expediente y/o cuenta y una columna de estado) y marca INSCRIPTA / PENDIENTE / RECHAZADA; lo no cruzado queda ORDENADA.
   * @param {object[]} derivados
   * @param {object[]} filas   [{expediente?, cuenta?, estado, fecha?}]
   */
  function importarEstadosInscripcion(derivados, filas) {
    const porExp = new Map(), porCta = new Map();
    for (const f of (filas || [])) {
      const est = normalizarTexto(f.estado);
      const val = { estado: est.includes('INSCRIP') ? 'INSCRIPTA' : est.includes('RECHAZ') ? 'RECHAZADA' : est.includes('PEND') ? 'PENDIENTE' : (est || 'DESCONOCIDO'), fecha: f.fecha || null, origen: f.origen || 'planilla' };
      if (f.expediente) porExp.set(String(f.expediente).trim(), val);
      if (f.cuenta) porCta.set(String(f.cuenta).replace(/\D/g, ''), val);
    }
    let n = 0;
    for (const d of derivados) {
      const hit = (d.expediente && porExp.get(d.expediente)) || (d.geo && d.geo.cuenta_normalizada && porCta.get(d.geo.cuenta_normalizada.replace(/\D/g, '')));
      d.inscripcion = hit || { estado: 'ORDENADA', fecha: null, origen: 'resolución' };
      if (hit) n++;
    }
    return n;
  }

  // ───────────────────────────── Clasificación y planilla ─────────────────────────────
  /**
   * Lo que define la elegibilidad es desde cuándo posee, no el rótulo de la resolución.
   * Una ampliatoria o rectificatoria que declara la antigüedad sirve igual que una de inscripción:
   * el expediente tiene una posesión reconocida con una fecha. Solo quedan fuera las que rechazan
   * o cancelan el trámite, donde no hay posesión que inscribir.
   */
  const TIPOS_NO_EVALUABLES = ['RESOLUCION_DESESTIMA', 'RESOLUCION_CANCELA', 'CEDULA_NOTIFICACION', 'RESOLUCION_TRAMITE'];
  /** Nombre oficial del departamento a partir de lo escrito en la resolución ("Capital", "DPTO. CAPITAL", "Gral. San Martín"). */
  function depDesdeTexto(txt, tabla) {
    if (!txt) return null;
    const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\./g, '')
      .replace(/^GRAL /, 'GENERAL ').replace(/^PTE /, 'PRESIDENTE ').replace(/\s+/g, ' ').trim();
    const buscado = norm(txt);
    const nombres = Object.values((tabla && tabla.departamentos) || {});
    return nombres.find(n => norm(n) === buscado) || nombres.find(n => buscado.startsWith(norm(n)) || norm(n).startsWith(buscado)) || null;
  }
  /**
   * Ubicación APROXIMADA cuando la resolución no trae número de cuenta: el centro de la localidad del inmueble,
   * tomado de los puntos de localidades de Catastro. Queda marcada (geo.ubicacion_aproximada) para que el mapa
   * la muestre distinta y nadie la confunda con la parcela. Nombres repetidos se desempatan por departamento.
   */
  function normLocalidad(x) {
    return String(x || '').replace(/\(.*?\)/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      .replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  }
  function ubicarPorLocalidad(d, tablaLoc) {
    if (!d || !d.geo || d.geo.lat != null || !tablaLoc) return false;
    const dep = normLocalidad(d.geo.dep_nombre);
    let cands = tablaLoc[normLocalidad(d.geo.localidad)];
    if ((!cands || !cands.length) && dep) {
      // tolerancia a errores de escaneo: hasta 2 letras distintas, solo dentro del mismo departamento
      const buscado = normLocalidad(d.geo.localidad);
      const dist = (a, b) => { const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
        return prev[n]; };
      if (buscado.length >= 6) {
        let mejor = null, md = 3;
        for (const [nombre, lista] of Object.entries(tablaLoc)) {
          const delDep = lista.filter(x => normLocalidad(x[2]) === dep); if (!delDep.length) continue;
          const dd = dist(buscado, nombre); if (dd < md) { md = dd; mejor = delDep; }
        }
        // "Vertientes de la Granja" no figura en la tabla, pero "La Granja" sí, en el mismo departamento:
        // se toma la localidad contenida más larga. Es una ubicación aproximada y queda marcada como tal.
        if (!mejor) {
          let largo = 0;
          for (const [nombre, lista] of Object.entries(tablaLoc)) {
            if (nombre.length < 5 || nombre.length >= buscado.length) continue;
            if (!new RegExp('(^|\\s)' + nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(buscado)) continue;
            const delDep = lista.filter(x => normLocalidad(x[2]) === dep);
            if (delDep.length && nombre.length > largo) { largo = nombre.length; mejor = delDep; }
          }
        }
        cands = mejor;
      }
    }
    if (!cands || !cands.length) return false;
    const c = (dep && cands.find(x => normLocalidad(x[2]) === dep)) || (cands.length === 1 ? cands[0] : null);
    if (!c) return false;
    d.geo.lat = c[0]; d.geo.lon = c[1]; d.geo.ubicacion_aproximada = 'localidad';
    if (!d.geo.dep_nombre) d.geo.dep_nombre = c[2];
    return true;
  }
  function clasificar(d) {
    if (!d || !d.tipo_documento) return 'NO_APLICA';
    if (TIPOS_NO_EVALUABLES.includes(d.tipo_documento)) return 'NO_APLICA';
    if (d.revisar && d.elegibilidad.estado === 'SIN_DATO') return 'REVISAR';
    if (d.elegibilidad.estado === 'ELEGIBLE') return d.elegibilidad.borde ? 'ELEGIBLE_BORDE' : 'ELEGIBLE';
    if (d.elegibilidad.estado === 'NO_ELEGIBLE') return d.elegibilidad.borde ? 'NO_ELEGIBLE_BORDE' : 'NO_ELEGIBLE';
    return 'SIN_DATO';
  }
  const COLUMNAS_PLANILLA = ['expediente', 'clasificacion', 'posee_desde', 'precision', 'criterio_antiguedad', 'rogante', 'dni', 'cuil', 'cantidad_rogantes',
    'departamento', 'pedania', 'localidad_catastro', 'localidad_resolucion', 'nomenclatura', 'manzana_catastro', 'parcela_catastro', 'manzana_resolucion', 'lat', 'lon',
    'cuenta', 'matriculas', 'titulares_registrales', 'superficie_poseida_m2', 'estado_parcela', 'sup_mejoras_parcela', 'valuacion_parcela',
    'inscripcion', 'resolucion', 'fecha_resolucion', 'senales', 'revisar', 'motivos_revision', 'cluster_domicilio', 'cluster_matricula', 'archivo'];
  function aFilaPlanilla(r) {
    const d = r.derivado || r, e = r.extraido || {}, g = d.geo || {}, c = g.catastro || {};
    const r0 = (e.rogantes || [])[0] || {};
    return { expediente: d.expediente, clasificacion: clasificar(d), posee_desde: d.posee_desde, precision: d.posee_desde_precision, criterio_antiguedad: d.posesion_criterio,
      rogante: d.rogante_principal, dni: d.dni_principal, cuil: r0.cuil || null, cantidad_rogantes: d.cantidad_rogantes,
      departamento: g.dep_nombre, pedania: g.ped_nombre, localidad_catastro: g.localidad_catastro || null, localidad_resolucion: g.localidad,
      nomenclatura: c.nomenclatura_legible || null, manzana_catastro: c.manzana || null, parcela_catastro: c.parcela || null, manzana_resolucion: g.manzana, lat: g.lat || null, lon: g.lon || null,
      cuenta: g.cuenta_normalizada, matriculas: (d.matriculas || []).join(' | '), titulares_registrales: d.titulares_registrales,
      superficie_poseida_m2: e.inmueble && e.inmueble.superficie_m2 || null, estado_parcela: c.estado || null, sup_mejoras_parcela: c.sup_mejoras || null, valuacion_parcela: c.valuacion || null,
      inscripcion: d.inscripcion ? d.inscripcion.estado : 'ORDENADA', resolucion: d.resolucion_numero ? `${d.resolucion_numero}/${d.resolucion_anio || ''}` : null, fecha_resolucion: d.resolucion_fecha,
      senales: (d.senales || []).join(' | '), revisar: d.revisar ? 'sí' : 'no', motivos_revision: (d.motivos_revision || []).join(' | '),
      cluster_domicilio: d.cluster_domicilio ? d.cluster_domicilio.id : null, cluster_matricula: d.cluster_matricula ? d.cluster_matricula.id : null, archivo: r.archivo || null };
  }
  function aCSV(registros) {
    const esc = v => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const filas = registros.filter(r => (r.derivado || r)).map(aFilaPlanilla);
    return [COLUMNAS_PLANILLA.join(';')].concat(filas.map(f => COLUMNAS_PLANILLA.map(k => esc(f[k])).join(';'))).join('\n');
  }


  // ───────────────────────────── Control de lectura ─────────────────────────────
  /** Campos que deciden la clasificación y la ubicación; sobre estos se mide la calidad de lectura. */
  const CAMPOS_CONTROL = {
    expediente: d => d.expediente || '',
    posee_desde: d => (d.posee_desde || '').slice(0, 7),           // año-mes: la antigüedad viene redondeada
    criterio: d => d.posesion_criterio || '',
    cuenta: d => (d.geo && d.geo.cuenta_normalizada || '').replace(/\D/g, ''),
    matricula: d => (d.matriculas || []).map(m => String(m).replace(/\D/g, '')).sort().join(','),
    dni: d => String(d.dni_principal || '').replace(/\D/g, '').replace(/^0+/, ''),
    rogante: d => normalizarTexto(d.rogante_principal).split(' ').filter(Boolean).sort().join(' '),  // orden apellido/nombre indistinto
    tipo_documento: d => d.tipo_documento || '',
    clasificacion: d => clasificar(d).replace('_BORDE', ''),   // borde es una marca, no otra clase
  };
  /**
   * Compara dos derivados de la misma resolución campo por campo.
   * @returns {{ coincide: boolean, diferencias: [{campo, a, b}], campos: number }}
   */
  function compararLecturas(a, b, campos) {
    const lista = campos || Object.keys(CAMPOS_CONTROL);
    const diferencias = [];
    for (const k of lista) {
      const f = CAMPOS_CONTROL[k]; if (!f) continue;
      const va = f(a), vb = f(b);
      if (!va && !vb) continue;              // los dos vacíos: no cuenta
      if (va !== vb) diferencias.push({ campo: k, a: va, b: vb });
    }
    return { coincide: diferencias.length === 0, diferencias, campos: lista.length };
  }
  /** Acumula comparaciones y devuelve exactitud por campo. */
  function resumirComparaciones(comparaciones) {
    const porCampo = {};
    for (const k of Object.keys(CAMPOS_CONTROL)) porCampo[k] = { comparados: 0, distintos: 0 };
    let iguales = 0;
    for (const c of comparaciones) {
      if (c.coincide) iguales++;
      for (const k of Object.keys(CAMPOS_CONTROL)) porCampo[k].comparados++;
      for (const d of c.diferencias) porCampo[d.campo].distintos++;
    }
    const n = comparaciones.length;
    return { total: n, coinciden_del_todo: iguales, tasa_global: n ? Math.round(iguales / n * 1000) / 10 : null,
      por_campo: Object.fromEntries(Object.entries(porCampo).map(([k, v]) => [k, { ...v, exactitud: v.comparados ? Math.round((1 - v.distintos / v.comparados) * 1000) / 10 : null }])) };
  }

  // ───────────────────────────── Clusters (para organizar visitas) ─────────────────────────────
  /**
   * Agrupa derivados por domicilio del rogante y por matrícula afectada. Muta cada derivado agregando
   * cluster_domicilio / cluster_matricula (id y tamaño) y la señal DOMICILIO_COMPARTIDO o MATRICULA_COMPARTIDA.
   * Ejemplo real: tres rogantes con domicilio Tristán de Tejeda 560 (Villa de Soto) poseen tres fracciones de la MFR 1199926.
   */
  function detectarClusters(derivados) {
    const porDom = new Map(), porMat = new Map();
    for (const d of derivados) {
      if (!d || d.tipo_documento !== 'RESOLUCION_INSCRIPCION') continue;
      if (d.clave_domicilio) { if (!porDom.has(d.clave_domicilio)) porDom.set(d.clave_domicilio, []); porDom.get(d.clave_domicilio).push(d); }
      for (const m of (d.matriculas || [])) { const k = String(m).replace(/\D/g, ''); if (!k) continue; if (!porMat.has(k)) porMat.set(k, []); porMat.get(k).push(d); }
    }
    let n = 0;
    for (const [k, arr] of porDom) { if (arr.length < 2) continue; n++; for (const d of arr) { d.cluster_domicilio = { id: `D${n}`, clave: k, tam: arr.length }; if (!d.senales.includes('DOMICILIO_COMPARTIDO')) d.senales.push('DOMICILIO_COMPARTIDO'); } }
    let m2 = 0;
    for (const [k, arr] of porMat) { const u = Array.from(new Set(arr)); if (u.length < 2) continue; m2++; for (const d of u) { d.cluster_matricula = { id: `M${m2}`, matricula: k, tam: u.length }; if (!d.senales.includes('MATRICULA_COMPARTIDA')) d.senales.push('MATRICULA_COMPARTIDA'); } }
    return { clusters_domicilio: n, clusters_matricula: m2 };
  }

  // ───────────────────────────── Resumen geográfico ─────────────────────────────
  function resumenGeo(registros, nivel) {
    const mapa = new Map();
    for (const it of registros) {
      const d = it.derivado || it;
      if (!d || d.tipo_documento !== 'RESOLUCION_INSCRIPCION') continue;
      const loc = normalizarTexto(d.geo.localidad_catastro || d.geo.localidad) || '(SIN LOCALIDAD)';
      const c = d.geo.catastro || {};
      const mz = (nivel === 'manzana') ? (c.clave_manzana || normalizarTexto(d.geo.manzana) || '(sin manzana)') : '';
      const k = [d.geo.dep_nombre || '(sin dep)', d.geo.ped_nombre || '(sin ped)', loc, mz].join('|');
      if (!mapa.has(k)) mapa.set(k, { departamento: d.geo.dep_nombre || '(sin dep)', pedania: d.geo.ped_nombre || '(sin ped)', localidad: loc,
        manzana: nivel === 'manzana' ? (c.manzana ? `${c.circunscripcion}-${c.seccion}-${c.manzana}` : (d.geo.manzana || '(sin manzana)')) : undefined,
        total: 0, elegibles: 0, borde: 0, no_elegibles: 0, sin_dato: 0, revisar: 0 });
      const f = mapa.get(k);
      f.total++;
      if (d.elegibilidad.estado === 'ELEGIBLE') f.elegibles++; else if (d.elegibilidad.estado === 'NO_ELEGIBLE') f.no_elegibles++; else f.sin_dato++;
      if (d.elegibilidad.borde) f.borde++;
      if (d.revisar) f.revisar++;
    }
    return Array.from(mapa.values()).sort((a, b) => a.departamento.localeCompare(b.departamento) || a.pedania.localeCompare(b.pedania) || a.localidad.localeCompare(b.localidad));
  }

  // ───────────────────────────── Prompt de extracción (v2: dos páginas) ─────────────────────────────
  const ESQUEMA_VACIO = {
    tipo_documento: 'RESOLUCION_INSCRIPCION | RESOLUCION_DESESTIMA | RESOLUCION_RECTIFICA | RESOLUCION_CANCELA | OTRO | NO_ES_RESOLUCION',
    resolucion: { numero: null, fecha: null },
    expediente: null,
    rogantes: [{ apellido_nombre: null, dni: null, cuil: null, estado_civil: null,
                 domicilio: { calle: null, numero: null, barrio: null, cp: null, localidad: null, departamento: null } }],
    inmueble: { departamento: null, pedania: null, localidad: null, calle: null, numero: null, manzana: null, lote: null, barrio: null,
                superficie_m2: null, superficie_texto: null, tipo: 'urbano | rural | indeterminado' },
    plano: { existe: null, profesional: null, matricula_profesional: null, fecha_visado: null },
    dominio: { afectados: [{ matricula: null, cuenta: null, titular_registral: null, afectacion: 'parcial | total | null' }], nomenclatura: null },
    declaracion_jurada: { fecha: null, folio_unico: null, juzgado_paz: null, testigos: [{ nombre: null, dni: null }] },
    documental: [],
    posesion: { antiguedad_anios: null, antiguedad_meses: null, fecha_referencia: null, fecha_inicio_declarada: null,
                criterio: 'DECLARADA_ROGANTE | SURGE_DOCUMENTAL | SURGE_EXPEDIENTE | OTRO', origen_mencionado: 'CESION | HERENCIA | COMPRA | OTRO | null',
                folio: null, texto_original: null },
    calidad: { legibilidad: 'buena | regular | mala', campos_dudosos: [], observaciones: null },
  };

  const EJEMPLOS = [
    { // Expte. 0535-105743/2018 — variante "declarada por el rogante ... es de N años al fecha"
      tipo_documento: 'RESOLUCION_INSCRIPCION', resolucion: { numero: '203', fecha: '2026-04-14' }, expediente: '0535-105743/2018',
      rogantes: [{ apellido_nombre: 'CRAVERO, RAUL ESTEBAN', dni: '20516358', cuil: '20-20516358-2', estado_civil: 'soltero',
                   domicilio: { calle: 'Tristán de Tejeda', numero: '560', barrio: null, cp: '5284', localidad: 'Villa de Soto', departamento: 'Cruz del Eje' } }],
      inmueble: { departamento: 'Cruz del Eje', pedania: 'Higueras', localidad: 'Villa de Soto', calle: 'Tristán de Tejeda', numero: 'S/N', manzana: '75',
                  lote: null, barrio: null, superficie_m2: 200.58, superficie_texto: '200,58 m2', tipo: 'urbano' },
      plano: { existe: true, profesional: 'Martoglio Jorge Ricardo', matricula_profesional: '1601', fecha_visado: null },
      dominio: { afectados: [{ matricula: '1199926', cuenta: '14-030734504/4', titular_registral: 'NUÑEZ, ESTEBAN (100%)', afectacion: 'parcial' }], nomenclatura: null },
      declaracion_jurada: { fecha: null, folio_unico: '26', juzgado_paz: 'Juzgado de Paz de Villa de Soto',
        testigos: [{ nombre: 'Oliva, Susana del Valle', dni: '17845295' }, { nombre: 'López, Aida Arsenia', dni: '21753685' }, { nombre: 'Nieto, Alicia del Carmen', dni: '14336883' }] },
      documental: ['copia DNI con domicilio en el inmueble (emisión 14/12/2014)', 'certificado Cooperativa de Luz y Fuerza de Soto: titular desde abril de 2000', 'tasa municipal Villa de Soto', 'impuesto inmobiliario provincial', 'fotografías certificadas', 'cesión de derechos posesorios 06/09/2018'],
      posesion: { antiguedad_anios: 25, antiguedad_meses: 0, fecha_referencia: '2025-07-18', fecha_inicio_declarada: null, criterio: 'DECLARADA_ROGANTE',
                  origen_mencionado: 'CESION', folio: 'f.u. 26, fs. 1',
                  texto_original: 'La antigüedad en la posesión declarada por el rogante a f.u. 26, fs. 1, es de 25 años al 18/07/2025.' },
      calidad: { legibilidad: 'buena', campos_dudosos: [], observaciones: 'En considerandos: cesión de derechos posesorios del 06/09/2018; titular del servicio eléctrico desde abril de 2000.' } },
    { // Expte. 0535-105040/2018 — variante "surge de la documental ... es de sesenta años y tres meses al fecha", dos matrículas
      tipo_documento: 'RESOLUCION_INSCRIPCION', resolucion: { numero: '554', fecha: '2024-12-20' }, expediente: '0535-105040/2018',
      rogantes: [{ apellido_nombre: 'FARIAS, PURA SILVERIA', dni: '2492082', cuil: '27-02492082-3', estado_civil: 'viuda',
                   domicilio: { calle: 'Tristán de Tejeda', numero: '560', barrio: 'Alberdi', cp: null, localidad: 'Villa de Soto', departamento: null } }],
      inmueble: { departamento: 'Cruz del Eje', pedania: 'Higueras', localidad: 'Villa de Soto', calle: null, numero: null, manzana: '75', lote: '100',
                  barrio: null, superficie_m2: 669.18, superficie_texto: '669,18 m2', tipo: 'urbano' },
      plano: { existe: true, profesional: 'Jorge Ricardo Martoglio', matricula_profesional: null, fecha_visado: '2018-11-01' },
      dominio: { afectados: [{ matricula: '1199926', cuenta: '14-030734504/4', titular_registral: 'Esteban Nuñez', afectacion: 'parcial' },
                             { matricula: '954870', cuenta: '14-030734857/4', titular_registral: 'Claro Nicanor Farias', afectacion: 'parcial' }], nomenclatura: null },
      declaracion_jurada: { fecha: null, folio_unico: '14', juzgado_paz: 'Jueza de Paz de Villa de Soto, Norma Beatriz González',
        testigos: [{ nombre: 'Roberto Américo Fernández', dni: '13535852' }, { nombre: 'Juan Carlos Villagra', dni: '6692885' }] },
      documental: ['copia DNI con domicilio en el inmueble', 'certificado Cooperativa de Luz y Fuerza de Soto: titular del servicio', 'constancias de pago de impuestos y servicios (fs. 19/21)'],
      posesion: { antiguedad_anios: 60, antiguedad_meses: 3, fecha_referencia: '2018-04-06', fecha_inicio_declarada: null, criterio: 'SURGE_DOCUMENTAL',
                  origen_mencionado: null, folio: null,
                  texto_original: 'La antigüedad en la posesión que surge de la documental acompañada es de sesenta años y tres meses al 06/04/2018.' },
      calidad: { legibilidad: 'buena', campos_dudosos: [], observaciones: 'Página 1 dice "sesenta años al 06/04/2018"; página 2 dice "sesenta años y tres meses". Se tomó la parte resolutiva.' } },
    { // Expte. 0535-105742/2018 — variante "surge del expediente data del fecha"
      tipo_documento: 'RESOLUCION_INSCRIPCION', resolucion: { numero: '021', fecha: '2025-03-10' }, expediente: '0535-105742/2018',
      rogantes: [{ apellido_nombre: 'CRAVERO, MIRIAM DOMINGA', dni: '17928786', cuil: '27-17928786-8', estado_civil: 'soltera',
                   domicilio: { calle: 'Tristán de Tejeda', numero: '560', barrio: null, cp: null, localidad: 'Villa de Soto', departamento: 'Cruz del Eje' } }],
      inmueble: { departamento: 'Cruz del Eje', pedania: 'Higueras', localidad: 'Villa de Soto', calle: 'M. Belgrano esq. Tristán de Tejeda', numero: null,
                  manzana: '75', lote: null, barrio: null, superficie_m2: 260.65, superficie_texto: '260,65 m2', tipo: 'urbano' },
      plano: { existe: true, profesional: 'Martoglio Jorge Ricardo', matricula_profesional: '1601', fecha_visado: null },
      dominio: { afectados: [{ matricula: '1199926', cuenta: '14-03-0734504/4', titular_registral: 'NUÑEZ ESTEBAN (Prop. 100%)', afectacion: 'parcial' }], nomenclatura: null },
      declaracion_jurada: { fecha: null, folio_unico: null, juzgado_paz: 'Juez de Paz de Serrezuela, Stella Maris Sargiotto',
        testigos: [{ nombre: 'Oliva, Susana del Valle', dni: '17845295' }, { nombre: 'López, Aida Arsenia', dni: '21753685' }] },
      documental: ['copia DNI con domicilio en la posesión (fs. 4)', 'cesión de derechos a favor de la rogante (fs. 7)', 'tasa municipal Villa de Soto (fs. 11)', 'impuesto inmobiliario (fs. 12)', 'fotografía del inmueble (fs. 13)'],
      posesion: { antiguedad_anios: null, antiguedad_meses: null, fecha_referencia: null, fecha_inicio_declarada: '2018-09-06', criterio: 'SURGE_EXPEDIENTE',
                  origen_mencionado: 'CESION', folio: 'fs. 7',
                  texto_original: 'La antigüedad de la posesión que surge del expediente data del 06/09/2018 (fs. 7).' },
      calidad: { legibilidad: 'buena', campos_dudosos: [], observaciones: null } },
  ];

  const PROMPT_SISTEMA = `Sos un asistente de la Escribanía General de Gobierno de Córdoba. Tu única tarea es leer las imágenes escaneadas de UNA resolución de la Unidad Ejecutora para el Saneamiento de Títulos (Ley 9150, Provincia de Córdoba) y devolver sus datos en JSON.

CÓMO SON ESTOS DOCUMENTOS
Cada resolución tiene normalmente dos páginas, que se te pasan juntas:
- Página 1 ("VISTO" y "CONSIDERANDO"): arriba a la derecha lleva un sello con la fecha de la resolución, del tipo "CORDOBA, 14 ABR 2026" (a veces solo se lee el año o parte del sello). El VISTO trae el número de expediente, el rogante con DNI y CUIL, y la ubicación y superficie del inmueble. Los considerandos enumeran la documental (declaración jurada, testigos, cesiones de derechos posesorios, servicios, plano) y contienen la frase de antigüedad de la posesión.
- Página 2 ("RESUELVE"): art. 1° ordena la inscripción y describe al rogante, su domicilio, el inmueble, medidas y linderos, la o las matrículas afectadas con titular registral, y repite la frase de antigüedad. Art. 2° remite el expediente al Registro General (número de expediente). Abajo, el número de resolución sellado y la firma de la Presidenta.
La firma manuscrita cruza las últimas líneas de la página 2 (frase de antigüedad y número de expediente). Cuando algo esté tapado en la página 2, usalo de la página 1, donde el mismo dato aparece sin firma encima. Si las dos páginas difieren en un dato, usá la parte resolutiva (página 2) y anotá la diferencia en calidad.observaciones.
Si te pasan una sola página, extraé lo que haya y poné null en lo que falte.

REGLAS
1. Respondé ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código.
2. Usá exactamente este esquema (mismas claves, mismo anidamiento). Cuando un dato no aparece, poné null. Nunca inventes ni completes con datos plausibles.
${JSON.stringify(ESQUEMA_VACIO, null, 2)}
3. Formatos: fechas en ISO YYYY-MM-DD ("18/07/2025" → "2025-07-18"; sello "20 DIC 2024" → "2024-12-20"); DNI solo dígitos, sin puntos (2.492.082 → "2492082"); CUIL con guiones; decimales con punto (669,18 → 669.18); número de cuenta y expediente tal como aparecen; apellido_nombre en mayúsculas con formato "APELLIDO, NOMBRES" aunque el documento lo escriba en otro orden o en minúsculas.
4. tipo_documento según el verbo del art. 1°: "ORDENAR la inscripción" → RESOLUCION_INSCRIPCION; DESESTIMAR/ARCHIVAR/RECHAZAR → RESOLUCION_DESESTIMA; RECTIFICAR/AMPLIAR → RESOLUCION_RECTIFICA; CANCELAR/DEJAR SIN EFECTO → RESOLUCION_CANCELA; otra → OTRO. Si las imágenes no son una resolución (portada, hoja en blanco, oficio, plano, nota) → NO_ES_RESOLUCION y el resto null.
5. rogantes: lista, una entrada por persona a cuyo favor se ordena la inscripción, en el orden en que aparecen. domicilio: el del rogante en el art. 1° (calle, número, barrio si lo dice, C.P., localidad, departamento).
6. inmueble: ubicación según el plano (Departamento, Pedanía, Localidad o Municipalidad —ambas van en localidad—, calle, número, manzana, lote, barrio). tipo: "urbano" si hay manzana/calle/barrio y la superficie está en m2; "rural" si habla de hectáreas, campo, fracción rural o no hay manzana; "indeterminado" si no se puede saber.
7. dominio.afectados: una entrada por cada inmueble inscripto que la posesión afecta ("afecta en forma parcial/total el inmueble inscripto en MATRICULA/MFR ..."). Puede haber más de uno. Para cada uno: matricula (el número que sigue a MATRICULA o MFR), titular_registral, afectacion (parcial/total). La cuenta del inmueble afectado casi nunca se dice directamente: sale de la descripción de linderos, donde el "Resto de parcela" del mismo titular figura con "MFR <matrícula>, cta <cuenta>". Asigná a cada matrícula afectada la cuenta que acompaña a esa misma MFR en los linderos. No asignes cuentas de linderos con otra matrícula.
8. posesion: transcribí LITERALMENTE en texto_original la frase de antigüedad de la parte resolutiva (la que empieza "La antigüedad ..."). Variantes conocidas y cómo estructurarlas:
   - "declarada por el rogante ... es de 25 años al 18/07/2025" → antiguedad_anios 25, antiguedad_meses 0, fecha_referencia 2025-07-18, criterio DECLARADA_ROGANTE.
   - "que surge de la documental acompañada es de sesenta años y tres meses al 06/04/2018" → los números pueden venir en palabras: antiguedad_anios 60, antiguedad_meses 3, fecha_referencia 2018-04-06, criterio SURGE_DOCUMENTAL.
   - "que surge del expediente data del 06/09/2018 (fs. 7)" → fecha_inicio_declarada 2018-09-06, antiguedad_anios null, criterio SURGE_EXPEDIENTE.
   - "desde el año 1998" → fecha_inicio_declarada 1998-01-01.
   origen_mencionado: CESION si los considerandos mencionan cesión de derechos posesorios a favor del rogante; HERENCIA si mencionan sucesión o herencia; COMPRA si boleto o compraventa; OTRO; null si no dice nada.
9. MUY IMPORTANTE con los dígitos: el expediente tiene formato NNNN-NNNNNN/AAAA y aparece en el VISTO (página 1) y en el art. 2° (página 2, a veces bajo la firma). Los años tienen 4 cifras. Si un dígito no se puede determinar con seguridad en ninguna de las dos páginas, poné null en ese campo y agregá su nombre a calidad.campos_dudosos.
10. declaracion_jurada: fecha de la declaración jurada si consta, folio único ("f.u. 26" → "26"), juzgado de paz que certificó las firmas (con el nombre del juez si figura) y la lista de testigos con nombre y DNI (solo dígitos). documental: lista corta, un ítem por documento mencionado en los considerandos, en pocas palabras y conservando fechas y frases útiles ("titular del servicio desde abril de 2000"). plano.fecha_visado si consta.
11. calidad.legibilidad: "buena" si leíste todo sin duda; "regular" si hubo campos con duda; "mala" si la imagen está borrosa, cortada o muy oscura. observaciones: diferencias entre páginas, datos raros, documental relevante para la posesión (cesiones, servicios "titular desde ..."), sellos encima de datos.

EJEMPLOS DE SALIDA CORRECTA (tres resoluciones reales, con las tres variantes de antigüedad):
${JSON.stringify(EJEMPLOS[0], null, 1)}
${JSON.stringify(EJEMPLOS[1], null, 1)}
${JSON.stringify(EJEMPLOS[2], null, 1)}`;

  const PROMPT_USUARIO = 'Extraé los datos de esta resolución (páginas en orden) según el esquema. Respondé solo con el JSON.';

  function parsearJSON(texto) {
    if (!texto) return null;
    let s = String(texto).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j < 0) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
  }

  return {
    CONFIG_DEFAULT, parseFecha, fmtFecha, restarAnios, sumarMeses, hoyUTC,
    expedienteDesdeNombreArchivo, palabrasANumero, parsearAntiguedad,
    calcularPoseeDesde, evaluarElegibilidad, decodificarCuenta,
    normalizarTexto, mismoNombre, validarCUIL, validarExpediente, validarDNI,
    senalVivienda, claveDomicilio, procesarRegistro, detectarClusters, resumenGeo,
    decodificarNomenclatura, consultarCatastro, enriquecerConCatastro, importarEstadosInscripcion, ubicarPorLocalidad, normLocalidad, clasificar, aFilaPlanilla, aCSV, COLUMNAS_PLANILLA, CATASTRO_WFS,
    CAMPOS_CONTROL, compararLecturas, resumirComparaciones,
    ESQUEMA_VACIO, EJEMPLOS, EJEMPLO_SALIDA: EJEMPLOS[0], PROMPT_SISTEMA, PROMPT_USUARIO, parsearJSON,
  };
});
