/*
 * Relevamiento Ley Pierri — padrón, inventario, repetidos y revisiones, sin base de datos
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_base.js — las reglas que en pierri.js viven en la base SQLite, escritas sobre arreglos en memoria, para que la
 * versión web (web/pierri_web.js) dé exactamente los mismos resultados que el kit sin tener una base de datos.
 *
 * Cada función replica una parte de pierri.js:
 *   filasPadron             cargarPadron: las filas de la tabla padron a partir de la planilla del Registro
 *   cruzarConPadron         cruzarConPadron: estado de inscripción de cada resolución, por el nombre del rogante
 *   filasInventario         cargarInventario: las filas de la tabla inventario a partir del CSV de la UEST (dos formatos)
 *   fusionarInventario      invBorrarOrigen + INSERT … ON CONFLICT: un CSV del mismo origen reemplaza al anterior
 *   indicePorExpediente     el índice expediente → fila que en el kit da la clave primaria de la tabla
 *   anexarInventario        anexarInventario: la fila del inventario de cada resolución, con sus coincidencias
 *   cuentasSinParcela       invCuentasSinParcela: qué cuentas del inventario falta ubicar en Catastro
 *   parcelaDesdeCatastro    ubicarInventario: la fila de la tabla parcelas a partir de lo que devuelve Catastro
 *   resumenInventario       resumenInventario: invResumen, invUbicadas, invPendientes, invLeidos e invPorEstado
 *   inventarioPorLocalidad  invPorLocalidad: el inventario agrupado por localidad, para el mapa
 *   marcarRepetidos         marcarRepetidos: la resolución más nueva de cada expediente es la válida
 *   aplicarRevision         aplicarRevision: la corrección manual manda sobre lo leído
 *   archivosDesde           GET /api/archivos: qué pasó con cada archivo cargado
 *   parsearCSV / normalizarExpediente / fechaISO / expInventario / claveNombre / plausible / ESTADO_PADRON
 *
 * Los datos van con la forma de las tablas del kit:
 *   padron      arreglo de filas { nro_unico, diario, anio, estado, nombre, nombre_clave, tipo }, en el orden de carga
 *   inventario  arreglo de filas con COLUMNAS_INVENTARIO, en el orden de inserción (el que da fusionarInventario)
 *   parcelas    objeto cuenta de 12 dígitos → fila de parcelaDesdeCatastro, o null si se consultó y Catastro no la tiene
 *   registros   los de la base, en el orden de todosLosRegistros() (por cargado_en y, a igual fecha, por orden de carga)
 *
 * De SQLite se replica a propósito lo que cambia el resultado: el orden en que devuelve las filas (el de inserción; en un
 * ORDER BY los empates quedan como llegan, y un GROUP BY con tantos términos como el ORDER BY agrupa en su dirección),
 * COALESCE / NULLIF / MAX con NULL, instr, LIKE sin distinguir mayúsculas ASCII, el orden binario de los textos, AVG con
 * suma compensada (Kahan-Babuska-Neumaier, SQLite 3.43 en adelante) y cómo guarda un número en una columna de texto
 * (123 → "123.0"). Comprobado contra el SQLite que trae Node 22 (3.50).
 *
 * Sin DOM. Depende solo de pierri_core.js. Node (module.exports) y navegador (window.PierriBase).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pierri_core.js'));
  else root.PierriBase = factory(root.PierriCore);
})(typeof self !== 'undefined' ? self : this, function (PierriCore) {
  'use strict';

  // ───────────────────────────── Cómo compara, suma y guarda SQLite ─────────────────────────────
  const esNulo = v => v === null || v === undefined;
  const coalesce = (...vs) => { for (const v of vs) if (!esNulo(v)) return v; return null; };
  /** Orden BINARY de SQLite: bytes UTF-8, que es el orden por punto de código (el < de JS compara unidades UTF-16). */
  function compararBinario(a, b) {
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a.codePointAt(i), y = b.codePointAt(i);
      if (x !== y) return x < y ? -1 : 1;
      if (x > 0xffff) i++;
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  }
  /** Orden de SQLite entre valores: NULL primero, después los números, después los textos. */
  function compararSQL(a, b) {
    const ta = esNulo(a) ? 0 : typeof a === 'number' ? 1 : 2, tb = esNulo(b) ? 0 : typeof b === 'number' ? 1 : 2;
    if (ta !== tb) return ta - tb;
    if (ta === 0) return 0;
    if (ta === 1) return a < b ? -1 : a > b ? 1 : 0;
    return compararBinario(String(a), String(b));
  }
  /** MAX(a, b) de SQLite con dos argumentos: NULL si alguno es NULL. */
  const maxSQL = (a, b) => esNulo(a) || esNulo(b) ? null : (compararSQL(a, b) >= 0 ? a : b);
  /** SUM de SQLite sobre las columnas enteras 0/1 del inventario: NULL si ninguna fila tiene valor. */
  function sumaSQL(filas, valor) {
    let s = null;
    for (const f of filas) { const v = valor(f); if (!esNulo(v)) s = (s || 0) + Number(v); }
    return s;
  }
  /**
   * AVG de SQLite sobre una columna REAL. Desde la versión 3.43 SQLite suma con la compensación de
   * Kahan-Babuska-Neumaier; sumar a mano daría otro último decimal. NULL si no hay ningún valor.
   */
  function promedioSQL(valores) {
    let suma = 0, error = 0, n = 0;
    for (const v of valores) {
      if (esNulo(v)) continue;
      const r = Number(v), t = suma + r;
      if (Math.abs(suma) > Math.abs(r)) error += (suma - t) + r; else error += (r - t) + suma;
      suma = t; n++;
    }
    if (!n) return null;
    return (Number.isFinite(error) ? suma + error : suma) / n;
  }
  /** LIKE 'BALDIO%' de SQLite: solo las letras ASCII se comparan sin distinguir mayúsculas ("Baldío" no entra). */
  const empiezaConBaldio = s => typeof s === 'string' && s.slice(0, 6).replace(/[a-z]/g, c => c.toUpperCase()) === 'BALDIO';
  /**
   * Lo que queda guardado cuando el kit manda un valor a una columna TEXT: un número pasa a texto con el formato
   * "%!.15g" de SQLite (123 → "123.0", 1e20 → "1.0e+20"); NaN queda NULL. Un valor que SQLite no acepta (verdadero/falso,
   * objetos) hace fallar al kit con este mismo mensaje; n es la posición del parámetro en la sentencia del kit.
   */
  function comoTexto(v, n) {
    if (esNulo(v)) return null;
    if (typeof v === 'string') return v;
    if (typeof v !== 'number') throw new Error(`Provided value cannot be bound to SQLite parameter ${n}.`);
    if (Number.isNaN(v)) return null;
    if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
    if (v === 0) return '0.0';
    const { dig, exp } = cifrasSQLite(Math.abs(v)), signo = v < 0 ? '-' : '';
    if (exp < -4 || exp > 14) return `${signo}${dig[0]}.${dig.slice(1) || '0'}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    if (exp < 0) return `${signo}0.${'0'.repeat(-exp - 1)}${dig}`;
    return `${signo}${dig.slice(0, exp + 1).padEnd(exp + 1, '0')}.${dig.slice(exp + 1) || '0'}`;
  }
  /**
   * Las 15 cifras significativas de un número positivo como las calcula SQLite (sqlite3FpDecode, 3.43 en adelante): lleva
   * el número a 19 cifras con aritmética doble-doble de Dekker y redondea mirando solo la cifra 16. No siempre coincide con
   * toPrecision(15) de JS, que redondea sobre el valor exacto. Devuelve las cifras sin ceros finales y el exponente decimal.
   */
  function cifrasSQLite(r) {
    const f = new Float64Array(1), bits = new BigUint64Array(f.buffer);
    const alto = x => { f[0] = x; bits[0] &= 0xfffffffffc000000n; return f[0]; };
    const mult = (rr, y, yy) => {   // dekkerMul2
      const hx = alto(rr[0]), tx = rr[0] - hx, hy = alto(y), ty = y - hy;
      const p = hx * hy, q = hx * ty + tx * hy, c = p + q;
      const cc = rr[0] * yy + rr[1] * y + (p - c + q + tx * ty);
      rr[0] = c + cc; rr[1] = c - rr[0]; rr[1] += cc;
    };
    const rr = [r, 0];
    let e = 0;
    if (rr[0] > 9.223372036854774784e+18) {
      while (rr[0] > 9.223372036854774784e+118) { e += 100; mult(rr, 1.0e-100, -1.99918998026028836196e-117); }
      while (rr[0] > 9.223372036854774784e+28) { e += 10; mult(rr, 1.0e-10, -3.6432197315497741579e-27); }
      while (rr[0] > 9.223372036854774784e+18) { e += 1; mult(rr, 1.0e-01, -5.5511151231257827021e-18); }
    } else {
      while (rr[0] < 9.223372036854774784e-83) { e -= 100; mult(rr, 1.0e+100, -1.5902891109759918046e+83); }
      while (rr[0] < 9.223372036854774784e+07) { e -= 10; mult(rr, 1.0e+10, 0.0); }
      while (rr[0] < 9.22337203685477478e+17) { e -= 1; mult(rr, 1.0e+01, 0.0); }
    }
    const entero = x => BigInt(Math.trunc(x));
    const z = String(rr[1] < 0 ? entero(rr[0]) - entero(-rr[1]) : entero(rr[0]) + entero(rr[1])).split('').map(Number);
    let iDP = z.length + e;
    if (z.length > 15) {
      const sube = z[15] >= 5;
      z.length = 15;
      for (let j = 14; sube; j--) {
        if (++z[j] <= 9) break;
        z[j] = 0;
        if (j === 0) { z.unshift(1); iDP++; break; }
      }
    }
    return { dig: z.join('').replace(/0+$/, ''), exp: iDP - 1 };
  }
  /** Lo que queda guardado en una columna REAL: un texto con forma de número pasa a número; NaN queda NULL. */
  function comoReal(v, n) {
    if (esNulo(v)) return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    if (typeof v !== 'string') throw new Error(`Provided value cannot be bound to SQLite parameter ${n}.`);
    const m = v.match(/^[ \t\n\f\r\v]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[ \t\n\f\r\v]*$/);
    return m ? Number(m[1]) : v;
  }
  const propia = (o, k) => !!o && !esNulo(k) && Object.prototype.hasOwnProperty.call(o, k);
  /** La parcela de una cuenta solo si Catastro la encontró (p.encontrada = 1 en el kit). */
  const parcelaEncontrada = (parcelas, cuenta) => {
    const p = propia(parcelas, cuenta) ? parcelas[cuenta] : null;
    return p && Number(p.encontrada) === 1 ? p : null;
  };

  // ───────────────────────────── Repetidos y revisión manual ─────────────────────────────
  /**
   * Aplica la corrección manual sobre el derivado: si alguien corrigió la fecha de posesión mirando el PDF,
   * esa fecha manda sobre la que leyó el sistema, y la elegibilidad se recalcula con ella. Igual que el kit.
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
  /**
   * Un expediente con varias resoluciones: la de fecha más nueva es la válida; las otras quedan repetidas, con
   * repetido_de = archivo de la que queda. A igual fecha y carga, manda el orden de registros. Devuelve cuántas cambiaron.
   */
  function marcarRepetidos(registros) {
    const porExp = new Map();
    for (const r of registros) { if (!r.derivado || !r.derivado.expediente || r.error) continue; if (!porExp.has(r.derivado.expediente)) porExp.set(r.derivado.expediente, []); porExp.get(r.derivado.expediente).push(r); }
    let n = 0;
    for (const lista of porExp.values()) {
      lista.sort((a, b) => String(b.derivado.resolucion_fecha || '').localeCompare(String(a.derivado.resolucion_fecha || '')) || String(b.cargado_en || '').localeCompare(String(a.cargado_en || '')));
      lista.forEach((r, i) => { const antes = !!r.repetido_de; r.repetido_de = i === 0 ? null : lista[0].archivo; if (antes !== !!r.repetido_de) n++; });
    }
    return n;
  }

  // ───────────────────────────── Padrón del Registro ─────────────────────────────
  const claveNombre = s => PierriCore.normalizarTexto(s).split(' ').filter(Boolean).sort().join(' ');
  const ESTADO_PADRON = { DEF: 'INSCRIPTA', PRV: 'PROVISORIA', OBS: 'OBSERVADA' };
  function plausible(anioDiario, anioReso) { const a = Number(anioDiario), r = Number(anioReso); if (!a || !r) return true; return a >= r && a <= r + 3; }
  /**
   * Las filas de la tabla padron a partir de la primera hoja de la planilla, tal como la da
   * XLSX.utils.sheet_to_json(hoja, { defval: null }). Una fila por persona y anotación (clave "nro|nombre"); si la
   * planilla repite la combinación queda la primera; las filas sin NROUNICO no entran. La cantidad de filas es lo que el
   * kit guarda como padron_filas.
   * Si falla al recorrer las filas (error.vaciado = true), el kit ya había borrado el padrón anterior y lo deja vacío.
   */
  function filasPadron(filasHoja) {
    const filas = filasHoja || [];
    if (!filas.length) throw new Error('la planilla está vacía');
    const col = n => Object.keys(filas[0]).find(k => k.trim().toUpperCase() === n);
    const cNro = col('NROUNICO'), cDia = col('DIARIO'), cEst = col('ESTADO_PROCESO'), cNom = col('NOMBREPERSONA'), cTipo = col('TIPO_PARTICIPACION');
    if (!cNro || !cEst) throw new Error('no tiene las columnas del Padrón (NROUNICO, DIARIO, ESTADO_PROCESO, NOMBREPERSONA)');
    const salida = [], vistos = new Set();
    try {
      for (const f of filas) {
        const nro = String(f[cNro] || '').trim(); if (!nro) continue;
        const anio = (String(f[cDia] || '').match(/\/\s*(\d{4})/) || [])[1] || null;
        const id = f[cNom] ? `${nro}|${claveNombre(f[cNom])}` : nro;
        if (vistos.has(id)) continue;
        vistos.add(id);
        // nombre y tipo van crudos a columnas de texto: comoTexto deja lo mismo que guarda SQLite (parámetros 5 y 7)
        salida.push({ nro_unico: id, diario: String(f[cDia] || '').replace(/\s+/g, ' ').trim(), anio, estado: String(f[cEst] || '').trim() || null,
          nombre: comoTexto(f[cNom] || null, 5), nombre_clave: f[cNom] ? claveNombre(f[cNom]) : null, tipo: comoTexto(f[cTipo] || null, 7) });
      }
    } catch (err) {
      const e = new Error('no se pudo leer la planilla del Padrón: ' + (err.message || err));
      e.vaciado = true;
      throw e;
    }
    return salida;
  }
  /** Deja el resultado del cruce tanto en el registro como en su derivado: el Tablero lo lee desde el derivado. */
  function marcarInscripcion(r, insc) { r.inscripcion = insc; if (r.derivado) r.derivado.inscripcion = insc; }
  /**
   * Cruza las resoluciones válidas con el Padrón por nombre del rogante (o, si la resolución no lo trae, por el iniciador
   * del inventario). Deja r.inscripcion y r.derivado.inscripcion. Sin padrón no toca nada y devuelve sin_padron: true.
   * @param {object[]} registros
   * @param {object[]} padron            filas de filasPadron, en su orden
   * @param {Map} [inventarioPorExp]     expediente del inventario → fila (indicePorExpediente)
   */
  function cruzarConPadron(registros, padron, inventarioPorExp) {
    if (!padron || !padron.length) return { cruzados: 0, ambiguos: 0, no_figuran: 0, sin_nombre: 0, sin_padron: true };
    const porNombre = new Map();
    for (const p of padron) { if (!p.nombre_clave) continue; if (!porNombre.has(p.nombre_clave)) porNombre.set(p.nombre_clave, []); porNombre.get(p.nombre_clave).push(p); }
    const porNombreRes = new Map();
    for (const r of registros) { if (!r.derivado || r.repetido_de || r.error) continue; const k = claveNombre(r.derivado.rogante_principal); if (!k) continue; if (!porNombreRes.has(k)) porNombreRes.set(k, []); porNombreRes.get(k).push(r); }
    const res = { cruzados: 0, ambiguos: 0, no_figuran: 0, sin_nombre: 0, por_estado: {} };
    for (const r of registros) {
      if (!r.derivado || r.repetido_de || r.error) continue;
      let nombre = r.derivado.rogante_principal;
      if (!nombre && r.derivado.expediente && inventarioPorExp) { const inv = inventarioPorExp.get(expInventario(r.derivado.expediente)); if (inv && inv.iniciador) nombre = inv.iniciador; }
      const k = claveNombre(nombre);
      if (!k) { res.sin_nombre++; marcarInscripcion(r, { estado: 'SIN_NOMBRE_PARA_CRUZAR', origen: 'padron' }); continue; }
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

  // ───────────────────────────── Inventario de expedientes (CSV de la UEST) ─────────────────────────────
  const COLUMNAS_INVENTARIO = ['expediente', 'departamento', 'hojas', 'cuenta', 'cuenta_valida', 'nro_resolucion', 'estado_digitalizacion',
    'tiene_resolucion', 'en_universo', 'anio', 'origen', 'iniciador', 'dni', 'fecha_ingreso', 'fecha_resolucion', 'estado_suac'];
  /** "0535-123456/2020" (como lo lee el sistema) → "0535-123456-2020" (como figura en el inventario). */
  const expInventario = e => String(e || '').replace(/^(\d{4})-(\d{5,7})\/(\d{4})$/, '$1-$2-$3');
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
  const filaInventario = valores => { const o = {}; COLUMNAS_INVENTARIO.forEach((c, i) => { o[c] = valores[i]; }); return o; };
  /**
   * Lee un CSV del inventario. Reconoce dos formatos por sus columnas:
   *   - Ypsilon / Y-Neura (expedientes digitalizados): Expediente; Departamento; Hojas; Cuenta; Nº Resolución; Estado resol.; En universo
   *   - SUAC (faltantes por digitalizar o universo completo): Nº Exp. SUAC; Estado; Iniciador; Nº Doc; Cuenta; Departamento; Fecha ingreso; Fecha resol.
   * Devuelve { formato, origen, filas, descartadas }: filas son las que el kit inserta, en orden, con COLUMNAS_INVENTARIO
   * (un expediente repetido en el CSV va dos veces: fusionarInventario lo junta como el ON CONFLICT del kit).
   * @param {string} texto           el CSV como texto (el kit lo lee como UTF-8)
   * @param {string} nombreArchivo   decide el origen de un CSV del SUAC: con "falt" en el nombre, suac_faltantes
   */
  function filasInventario(texto, nombreArchivo) {
    const filas = parsearCSV(String(texto || ''));
    if (!filas.length) throw new Error('el CSV está vacío');
    const col = (...ns) => { for (const n of ns) { const k = Object.keys(filas[0]).find(k => PierriCore.normalizarTexto(k) === PierriCore.normalizarTexto(n)); if (k) return k; } return null; };
    const cExp = col('Expediente'), cSuac = col('Nº Exp. SUAC', 'N Exp SUAC', 'Nro Exp SUAC', 'Expediente SUAC');
    const formato = cSuac ? 'suac' : cExp ? 'digitalizados' : null;
    if (!formato) throw new Error('no reconozco las columnas: se espera el CSV de expedientes digitalizados (Expediente; Estado resol.; …) o el del SUAC (Nº Exp. SUAC; Iniciador; Nº Doc; …)');
    const cDep = col('Departamento'), cCta = col('Cuenta'), cHoj = col('Hojas'), cRes = col('Nº Resolución', 'N Resolucion', 'Nro Resolucion'), cEst = col('Estado resol.', 'Estado resol'), cUni = col('En universo');
    const cEstS = col('Estado'), cIni = col('Iniciador'), cDoc = col('Nº Doc', 'N Doc', 'DNI', 'Documento'), cFI = col('Fecha ingreso'), cFR = col('Fecha resol.', 'Fecha resol', 'Fecha resolucion');
    const origen = formato === 'suac' ? (/falt/i.test(nombreArchivo) ? 'suac_faltantes' : 'suac') : 'digitalizados';
    const salida = [];
    let descartadas = 0;
    for (const f of filas) {
      const exp = formato === 'suac' ? normalizarExpediente(f[cSuac]) : (/^\d{4}-\d{5,7}-\d{4}$/.test(String(f[cExp] || '').trim()) ? String(f[cExp]).trim() : null);
      if (!exp) { descartadas++; continue; }
      const cta = String(f[cCta] || '').replace(/\D/g, '');
      const ctaValida = cta.length === 12 && Number(cta.slice(0, 2)) >= 11 && Number(cta.slice(0, 2)) <= 36 ? 1 : 0;
      const anio = Number(exp.slice(-4)) || null;
      if (formato === 'digitalizados') {
        const est = String(f[cEst] || '').trim();
        salida.push(filaInventario([exp, String(f[cDep] || '').trim() || null, Number(f[cHoj]) || 0, ctaValida ? cta : null, ctaValida, String(f[cRes] || '').trim() || null, est || null, /resoluci/i.test(est) ? 1 : 0,
          /^s/i.test(String(f[cUni] || '')) ? 1 : 0, anio && anio > 1990 && anio < 2100 ? anio : null, origen, null, null, null, null, null]));
      } else {
        const dni = String(f[cDoc] || '').replace(/\D/g, '').replace(/^0+/, '') || null;
        const ini = String(f[cIni] || '').replace(/\s+/g, ' ').replace(/\s*C\.?P\.?\s*\d{4}.*$/i, '').trim() || null;
        const fr = fechaISO(f[cFR]);
        salida.push(filaInventario([exp, String(f[cDep] || '').trim() || null, 0, ctaValida ? cta : null, ctaValida, null, origen === 'suac_faltantes' ? 'No digitalizado' : null, fr ? 1 : 0,
          1, anio && anio > 1990 && anio < 2100 ? anio : null, origen, ini, dni && dni.length >= 6 ? dni : null, fechaISO(f[cFI]), fr, String(f[cEstS] || '').trim() || null]));
      }
    }
    return { formato, origen, filas: salida, descartadas };
  }
  /**
   * Suma un CSV leído con filasInventario al inventario que ya hay, como el kit: primero borra las filas cuyo origen es
   * exactamente el del CSV nuevo (una fila "digitalizados+suac" no se borra) y después inserta fila por fila; si el
   * expediente ya está, lo completa con las reglas del ON CONFLICT. Devuelve un arreglo nuevo, en el orden de la tabla
   * (las filas nuevas van al final); no modifica el que recibe.
   * @param {object[]} actual   filas del inventario (o [])
   * @param {{origen: string, filas: object[]}} nuevo   lo que devuelve filasInventario
   */
  function fusionarInventario(actual, nuevo) {
    const filas = (actual || []).filter(f => f.origen !== nuevo.origen).map(f => filaInventario(COLUMNAS_INVENTARIO.map(c => f[c] === undefined ? null : f[c])));
    const posicion = new Map(filas.map((f, i) => [f.expediente, i]));
    for (const x of nuevo.filas) {
      const i = posicion.get(x.expediente);
      if (i === undefined) { posicion.set(x.expediente, filas.length); filas.push(filaInventario(COLUMNAS_INVENTARIO.map(c => x[c]))); continue; }
      const v = filas[i];   // en el SET del kit, las columnas sin "excluded." son las de la fila que ya estaba
      filas[i] = {
        expediente: v.expediente,
        departamento: coalesce(x.departamento, v.departamento),
        hojas: coalesce(x.hojas === 0 ? null : x.hojas, v.hojas),   // COALESCE(NULLIF(excluded.hojas, 0), hojas)
        cuenta: coalesce(x.cuenta, v.cuenta),
        cuenta_valida: maxSQL(v.cuenta_valida, x.cuenta_valida),
        nro_resolucion: coalesce(x.nro_resolucion, v.nro_resolucion),
        estado_digitalizacion: x.origen === 'digitalizados' ? x.estado_digitalizacion : v.estado_digitalizacion,
        tiene_resolucion: maxSQL(v.tiene_resolucion, x.tiene_resolucion),
        en_universo: maxSQL(v.en_universo, x.en_universo),
        anio: coalesce(x.anio, v.anio),
        // instr(origen, excluded.origen) > 0: "suac_faltantes" ya contiene "suac"
        origen: esNulo(v.origen) ? x.origen : String(v.origen).includes(x.origen) ? v.origen : v.origen + '+' + x.origen,
        iniciador: coalesce(x.iniciador, v.iniciador),
        dni: coalesce(x.dni, v.dni),
        fecha_ingreso: coalesce(x.fecha_ingreso, v.fecha_ingreso),
        fecha_resolucion: coalesce(x.fecha_resolucion, v.fecha_resolucion),
        estado_suac: coalesce(x.estado_suac, v.estado_suac),
      };
    }
    return filas;
  }
  /** expediente del inventario → fila (en el kit, la clave primaria de la tabla). */
  function indicePorExpediente(filas) { return new Map((filas || []).map(f => [f.expediente, f])); }
  /** Cruza cada resolución leída con su fila del inventario (cuenta y número de resolución) y lo deja en r.inventario. */
  function anexarInventario(registros, inventarioPorExp) {
    for (const r of registros) {
      if (!r.derivado || !r.derivado.expediente) continue;
      const f = inventarioPorExp ? inventarioPorExp.get(expInventario(r.derivado.expediente)) : undefined;
      if (!f) { r.inventario = null; continue; }
      const ctaLeida = (r.derivado.geo && r.derivado.geo.cuenta_normalizada || '').replace(/\D/g, '');
      r.inventario = { departamento: f.departamento, cuenta: f.cuenta, nro_resolucion: f.nro_resolucion, estado_digitalizacion: f.estado_digitalizacion, en_universo: !!f.en_universo,
        iniciador: f.iniciador || null, dni: f.dni || null, fecha_ingreso: f.fecha_ingreso || null,
        dni_coincide: f.dni && r.derivado.dni_principal ? String(f.dni).replace(/^0+/, '') === String(r.derivado.dni_principal).replace(/\D/g, '').replace(/^0+/, '') : null,
        cuenta_coincide: f.cuenta && ctaLeida ? f.cuenta === ctaLeida : null,
        resolucion_coincide: f.nro_resolucion && r.derivado.resolucion_numero ? String(f.nro_resolucion).replace(/^0+/, '') === String(r.derivado.resolucion_numero).replace(/^0+/, '') : null };
    }
  }

  // ───────────────────────────── Parcelas de Catastro ─────────────────────────────
  /**
   * Las cuentas válidas del inventario que todavía no se consultaron en Catastro, sin repetir, hasta `maximo`.
   * En el orden del kit: la consulta recorre el índice de la cuenta, así que salen ordenadas.
   */
  function cuentasSinParcela(inventario, parcelas, maximo) {
    const cuentas = new Set();
    for (const f of inventario || []) if (f.cuenta_valida === 1 && !esNulo(f.cuenta) && !propia(parcelas, f.cuenta)) cuentas.add(f.cuenta);
    const lista = [...cuentas].sort(compararSQL), n = Number(maximo) || 500;
    return n < 0 ? lista : lista.slice(0, n);   // LIMIT negativo: sin límite
  }
  /**
   * La fila de la tabla parcelas a partir de lo que devuelve PierriCore.consultarCatastro para una cuenta, como la guarda
   * ubicarInventario (con los tipos de cada columna). null si Catastro no la encontró.
   * @param {object|null} p
   * @param {string} ahora   fecha ISO de la consulta
   */
  function parcelaDesdeCatastro(p, ahora) {
    if (!p) return null;
    return { encontrada: 1, nomenclatura: comoTexto(p.nomenclatura, 3), departamento: comoTexto(p.departamento, 4), pedania: comoTexto(p.pedania, 5),
      localidad: comoTexto(p.localidad, 6), tipo_parcela: comoTexto(p.tipo_parcela, 7), estado: comoTexto(p.estado, 8), designacion: comoTexto(p.designacion, 9),
      sup_tierra: comoReal(p.sup_tierra, 10), sup_mejoras: comoReal(p.sup_mejoras, 11), valuacion: comoReal(p.valuacion, 12),
      lat: comoReal(p.lat, 13), lon: comoReal(p.lon, 14), consultada_en: comoTexto(ahora, 15) };
  }

  // ───────────────────────────── Resúmenes del inventario ─────────────────────────────
  /**
   * GROUP BY de SQLite: los grupos salen ordenados por su clave y, dentro de cada uno, las filas en el orden de la tabla.
   * Cuando el ORDER BY tiene tantos términos como el GROUP BY, SQLite agrupa con las direcciones del ORDER BY
   * (descendente, en invPorEstado): eso decide el orden de los empates. `desc` dice qué términos van al revés.
   */
  function agrupar(filas, claves, desc = []) {
    const grupos = new Map();
    for (const f of filas) {
      const k = claves(f), id = JSON.stringify(k);
      if (!grupos.has(id)) grupos.set(id, { clave: k, filas: [] });
      grupos.get(id).filas.push(f);
    }
    return [...grupos.values()].sort((a, b) => {
      for (let i = 0; i < a.clave.length; i++) { const c = compararSQL(a.clave[i], b.clave[i]); if (c) return desc[i] ? -c : c; }
      return 0;
    });
  }
  /** Una resolución leída cuenta para el inventario si es válida, sin error, y su expediente es el de la fila (invLeidos). */
  function expedientesLeidos(registros) {
    const s = new Set();
    for (const r of registros || []) if (r.derivado && r.derivado.expediente && !r.repetido_de && !r.error) s.add(r.derivado.expediente);
    return s;
  }
  /**
   * El resumen del inventario que muestra el Tablero (resumen().inventario en el kit).
   * @param {object[]} inventario
   * @param {object} parcelas
   * @param {object[]} registros   para "leidas": las del inventario que ya tienen su resolución leída
   * @param {{archivo, cargado_en}} meta
   */
  function resumenInventario(inventario, parcelas, registros, meta) {
    const inv = inventario || [];
    if (!inv.length) return { cargado: false };
    const leidos = expedientesLeidos(registros);
    // r.expediente = REPLACE(i.expediente, '-', '/') OR r.expediente = SUBSTR(i.expediente, 1, 11) || '/' || SUBSTR(i.expediente, 13)
    const leida = e => leidos.has(e.split('-').join('/')) || leidos.has(e.slice(0, 11) + '/' + e.slice(12));
    const pendientes = new Set();
    for (const f of inv) if (f.cuenta_valida === 1 && !esNulo(f.cuenta) && !propia(parcelas, f.cuenta)) pendientes.add(f.cuenta);
    // GROUP BY 1 ORDER BY n DESC: un término en cada uno, así que SQLite agrupa en orden descendente (los NULL al final)
    // y, a igual cantidad, quedan en ese orden
    const porEstado = agrupar(inv, f => [coalesce(f.estado_digitalizacion)], [true]).map(g => ({ estado: g.clave[0], n: g.filas.length }));
    porEstado.sort((a, b) => b.n - a.n);
    return { cargado: true, archivo: (meta && meta.archivo) || null, cargado_en: (meta && meta.cargado_en) || null,
      total: inv.length, con_resolucion: sumaSQL(inv, f => f.tiene_resolucion) || 0, con_cuenta: sumaSQL(inv, f => f.cuenta_valida) || 0,
      con_resolucion_y_cuenta: inv.filter(f => f.tiene_resolucion === 1 && f.cuenta_valida === 1).length || 0, en_universo: sumaSQL(inv, f => f.en_universo) || 0,
      sin_digitalizar: inv.filter(f => f.estado_digitalizacion === 'No digitalizado').length || 0, con_dni: inv.filter(f => !esNulo(f.dni)).length || 0,
      con_iniciador: inv.filter(f => !esNulo(f.iniciador)).length || 0,
      ubicadas: inv.filter(f => parcelaEncontrada(parcelas, f.cuenta)).length, pendientes_catastro: pendientes.size,
      leidas: inv.filter(f => leida(String(f.expediente))).length, por_estado: porEstado };
  }
  /**
   * El inventario agrupado por localidad de la parcela (o "(sin ubicar)") y departamento, con cuántos expedientes, cuántos
   * con resolución, cuántas parcelas baldías y el centro de las ubicadas. Primero las ubicadas, después por cantidad con
   * resolución y por total.
   */
  function inventarioPorLocalidad(inventario, parcelas) {
    const unidas = (inventario || []).map(i => ({ i, p: parcelaEncontrada(parcelas, i.cuenta) }));   // LEFT JOIN parcelas p ON … AND p.encontrada = 1
    const grupos = agrupar(unidas, ({ i, p }) => [coalesce(p && p.localidad, '(sin ubicar)'), coalesce(p && p.departamento, i.departamento, '(sin departamento)')]);
    const salida = grupos.map(g => {
      const fs = g.filas, ultima = fs[fs.length - 1];
      return { fila: { localidad: g.clave[0], departamento: g.clave[1], total: fs.length, con_resolucion: sumaSQL(fs, x => x.i.tiene_resolucion),
        baldias: fs.filter(x => x.p && empiezaConBaldio(x.p.estado)).length, lat: promedioSQL(fs.map(x => x.p && x.p.lat)), lon: promedioSQL(fs.map(x => x.p && x.p.lon)) },
        // ORDER BY (p.localidad IS NULL): una columna suelta en un GROUP BY vale lo de la última fila del grupo
        sinUbicar: !ultima.p || esNulo(ultima.p.localidad) ? 1 : 0 };
    });
    salida.sort((a, b) => a.sinUbicar - b.sinUbicar || compararSQL(b.fila.con_resolucion, a.fila.con_resolucion) || compararSQL(b.fila.total, a.fila.total));
    return salida.map(x => x.fila);
  }

  // ───────────────────────────── Archivos cargados ─────────────────────────────
  /**
   * Qué pasó con cada archivo cargado: explica por qué N archivos no dan N expedientes. Es la lista `archivos` que
   * devuelve GET /api/archivos.
   * @param {object[]} registros   en el orden de todosLosRegistros()
   * @param {object[]} archivos    filas de la tabla archivos { hash, nombre, tipo, paginas, unidades, cargado_en }, en el
   *                               orden de carga: a igual cargado_en y nombre, decide ese orden
   */
  function archivosDesde(registros, archivos) {
    const porArchivo = new Map();
    for (const r of registros || []) {
      const a = porArchivo.get(r.hash_archivo) || []; a.push(r); porArchivo.set(r.hash_archivo, a);
    }
    const orden = (archivos || []).slice().sort((a, b) => compararSQL(coalesce(a.cargado_en), coalesce(b.cargado_en)) || compararSQL(coalesce(a.nombre), coalesce(b.nombre)));
    return orden.map(a => {
      const rs = porArchivo.get(a.hash) || [];
      const validas = rs.filter(r => r.derivado && !r.repetido_de && !r.error);
      const repetidas = rs.filter(r => r.derivado && r.repetido_de);
      return { nombre: a.nombre, paginas: a.paginas, resoluciones: rs.length,
        suma: validas.map(r => r.derivado.expediente || '?'),
        repetidas: repetidas.map(r => ({ expediente: r.derivado.expediente, queda: r.repetido_de })),
        errores: rs.filter(r => r.error).map(r => r.error),
        tipos: [...new Set(rs.map(r => r.derivado && r.derivado.tipo_documento).filter(Boolean))] };
    });
  }

  return {
    expInventario, claveNombre, ESTADO_PADRON, plausible, COLUMNAS_INVENTARIO,
    filasPadron, cruzarConPadron, parsearCSV, normalizarExpediente, fechaISO,
    filasInventario, fusionarInventario, indicePorExpediente, anexarInventario,
    cuentasSinParcela, parcelaDesdeCatastro, resumenInventario, inventarioPorLocalidad,
    marcarRepetidos, aplicarRevision, archivosDesde,
  };
});
