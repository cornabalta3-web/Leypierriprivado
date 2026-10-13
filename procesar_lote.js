#!/usr/bin/env node
/*
 * Relevamiento Ley Pierri — línea de comandos
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * procesar_lote.js — motor del relevamiento Ley Pierri (EGG / UEST Córdoba)
 *
 * Procesa una carpeta con miles de PDF de resoluciones de la Unidad Ejecutora y deja un archivo de
 * resultados que abre el visor. Pensado para 10.000 expedientes: se puede cortar y retomar, y no
 * vuelve a gastar API en lo ya hecho.
 *
 * Qué acepta como entrada (se reconoce por la forma, no por el nombre):
 *   - un PDF por expediente (2 páginas, como exporta el sistema de la UEST);
 *   - tomos: un PDF con muchas resoluciones seguidas (por año o uno solo gigante). Se cortan solas: cada
 *     resolución empieza en la página que dice "VISTO: El expediente N° ..." y termina en la que dice
 *     "RESOLUCIÓN Nro.". Las páginas que no encajan (portadas, índices, oficios) quedan aparte en errores.log.
 *   - mezcla de ambos, con repetidos: se conserva una resolución por expediente (la más nueva).
 *
 * Cómo trabaja cada resolución:
 *   1. Carril texto (gratis): lee la capa de texto del PDF y extrae los campos con reglas.
 *      Si están los críticos (expediente, antigüedad, cuenta, tipo de documento), termina acá.
 *   2. Carril modelo (API): solo si el texto no alcanzó. Manda el PDF entero a Claude y toma el JSON.
 *   3. Se calcula la clasificación (elegible / no elegible / borde / revisar) con pierri_core.
 *   4. Al final, Catastro por número de cuenta: nomenclatura, localidad, manzana y coordenadas.
 *
 * Uso:
 *   node procesar_lote.js --dir ./resoluciones                     (solo texto, sin costo)
 *   node procesar_lote.js --dir ./resoluciones --key sk-ant-...    (texto + modelo donde haga falta)
 *   node procesar_lote.js --dir ./resoluciones --key ... --paralelo 5 --limite 200
 *   node procesar_lote.js --dir ./resoluciones --solo-catastro     (reintenta ubicaciones faltantes)
 *
 * Opciones:
 *   --dir <ruta>        carpeta con los PDF (busca también en subcarpetas)
 *   --salida <ruta>     carpeta de resultados (por defecto ./salida)
 *   --key <clave>       clave de API; si falta, se usa solo el carril texto
 *   --modelo <id>       modelo (por defecto claude-haiku-4-5-20251001)
 *   --paralelo <n>      resoluciones en paralelo contra la API (por defecto 4)
 *   --limite <n>        procesar como mucho n archivos nuevos (para probar)
 *   --corte <fecha>     fecha de corte de la posesión (por defecto 2006-01-01)
 *   --movil <años>      usar plazo móvil en vez de corte fijo
 *   --sin-catastro      no consultar Catastro
 *   --solo-catastro     no leer PDF; solo completar ubicaciones faltantes
 *   --rehacer           ignorar lo ya procesado y empezar de cero
 *   --doble-lectura <n> control de calidad: las primeras n resueltas por texto se leen TAMBIÉN con el modelo
 *                       y se comparan campo por campo (deja control_lectura.json). Requiere --key.
 *
 * Deja en la carpeta de salida:
 *   resultados.jsonl    una línea por resolución (es el archivo que se carga en el visor)
 *   planilla.csv        planilla para Excel
 *   resumen.json        totales por clasificación y por localidad
 *   errores.log         archivos que no se pudieron procesar
 *   control_lectura.json  (con --doble-lectura) exactitud del carril texto contra el modelo, campo por campo
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PierriCore = require('./pierri_core.js');
const PierriTexto = require('./pierri_texto.js');
const TABLA = require('./codigos_departamentos_pedanias_cordoba.json');

// ───────────────────────────── Argumentos ─────────────────────────────
function args() {
  const a = process.argv.slice(2), o = { paralelo: 4, modelo: 'claude-haiku-4-5-20251001', salida: './salida', corte: '2006-01-01' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--dir') o.dir = a[++i];
    else if (k === '--salida') o.salida = a[++i];
    else if (k === '--key') o.key = a[++i];
    else if (k === '--modelo') o.modelo = a[++i];
    else if (k === '--paralelo') o.paralelo = Number(a[++i]) || 4;
    else if (k === '--limite') o.limite = Number(a[++i]);
    else if (k === '--corte') o.corte = a[++i];
    else if (k === '--movil') o.movil = Number(a[++i]) || 10;
    else if (k === '--sin-catastro') o.sinCatastro = true;
    else if (k === '--solo-catastro') o.soloCatastro = true;
    else if (k === '--rehacer') o.rehacer = true;
    else if (k === '--doble-lectura') o.dobleLectura = Number(a[++i]) || 50;
    else if (k === '--ayuda' || k === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
  }
  if (!o.dir && !o.soloCatastro) { console.error('Falta --dir con la carpeta de los PDF. Ver --ayuda.'); process.exit(1); }
  o.key = o.key || process.env.ANTHROPIC_API_KEY;
  return o;
}
const O = args();
const CFG = O.movil ? { regla: 'PLAZO_MOVIL', anosPlazoMovil: O.movil } : { regla: 'CORTE_FIJO', fechaCorte: O.corte };

// ───────────────────────────── Archivos ─────────────────────────────
function listarPDF(dir) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (/\.pdf$/i.test(e.name)) out.push(p);
    }
  })(dir);
  return out.sort();
}

// ───────────────────────────── Lectura de PDF: todo viene del módulo compartido con la aplicación ─────────────────────────────
const { hash, textoPorPagina, esTomo, cortarTomo, recortarPaginas, fusionar } = require('./pierri_lector.js');
const Lector = require('./pierri_lector.js');
const leerConModelo = (buf) => Lector.leerConModelo(buf, { key: O.key, modelo: O.modelo });

// ───────────────────────────── Estado reanudable ─────────────────────────────
const salida = O.salida;
fs.mkdirSync(salida, { recursive: true });
const RUTA = {
  jsonl: path.join(salida, 'resultados.jsonl'),
  csv: path.join(salida, 'planilla.csv'),
  resumen: path.join(salida, 'resumen.json'),
  errores: path.join(salida, 'errores.log'),
  control: path.join(salida, 'control_lectura.json'),
};
function cargarPrevios() {
  if (O.rehacer || !fs.existsSync(RUTA.jsonl)) return [];
  const out = [];
  for (const linea of fs.readFileSync(RUTA.jsonl, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    try { out.push(JSON.parse(linea)); } catch (e) { /* línea cortada por un corte de luz: se descarta */ }
  }
  return out;
}

// ───────────────────────────── Salidas ─────────────────────────────
function guardarTodo(registros) {
  fs.writeFileSync(RUTA.jsonl, registros.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(RUTA.csv, '\ufeff' + PierriCore.aCSV(registros.filter(r => r.derivado)), 'utf8');
  const clasif = {};
  for (const r of registros) { const c = r.derivado ? PierriCore.clasificar(r.derivado) : 'ERROR'; clasif[c] = (clasif[c] || 0) + 1; }
  const fuentes = {};
  for (const r of registros) { const f = (r.extraido && r.extraido._fuente) || 'error'; fuentes[f] = (fuentes[f] || 0) + 1; }
  fs.writeFileSync(RUTA.resumen, JSON.stringify({
    fecha: new Date().toISOString(), total: registros.length, config: CFG, modelo: O.modelo,
    clasificacion: clasif, fuente_de_lectura: fuentes,
    por_localidad: PierriCore.resumenGeo(registros),
    por_manzana: PierriCore.resumenGeo(registros, 'manzana'),
  }, null, 1));
}

// ───────────────────────────── Principal ─────────────────────────────
(async () => {
  const t0 = Date.now();
  let registros = cargarPrevios();
  // Un tomo cuenta como hecho por su archivo base, no por cada unidad (#p2-3), para no volver a cortarlo.
  const hechos = new Set(registros.map(r => r.tomo ? r.tomo.archivo : (r.archivo || '').split('#')[0]));
  let tokens = registros.reduce((a, r) => a + (r.tokens || 0), 0);

  if (!O.soloCatastro) {
    const todos = listarPDF(O.dir);
    let pendientes = todos.filter(p => !hechos.has(path.basename(p)));
    if (O.limite) pendientes = pendientes.slice(0, O.limite);
    console.log(`Carpeta: ${O.dir}`);
    console.log(`PDF encontrados: ${todos.length} · ya procesados: ${hechos.size} · a procesar ahora: ${pendientes.length}`);
    console.log(`Criterio: ${CFG.regla === 'PLAZO_MOVIL' ? CFG.anosPlazoMovil + ' años móviles' : 'posesión anterior al ' + CFG.fechaCorte}`);
    console.log(O.key ? `Modelo de respaldo: ${O.modelo} (paralelo ${O.paralelo})` : 'Sin clave de API: solo carril texto (las que no se resuelvan quedan pendientes)');
    console.log('');

    const vistos = new Set(registros.map(r => r.derivado && r.derivado.expediente).filter(Boolean));
    const errores = [];
    let n = 0, porTexto = 0, porModelo = 0;

    // Paso 0: reconocer cada archivo. Un tomo se corta en unidades; un archivo suelto es una unidad.
    const unidades = [];
    let tomos = 0;
    for (const ruta of pendientes) {
      const nombre = path.basename(ruta);
      try {
        const buf = fs.readFileSync(ruta);
        const pags = await textoPorPagina(buf);
        if (esTomo(pags)) {
          tomos++;
          const { unidades: us, sueltas } = cortarTomo(pags);
          if (sueltas.length) errores.push(`${nombre}\tpáginas sin resolución (portada, índice, oficio u OCR ilegible): ${sueltas.map(p => p + 1).join(', ')}`);
          us.forEach(u => unidades.push({ ruta, buf, nombre: `${nombre}#p${u.desde + 1}-${u.hasta + 1}`, texto: pags.slice(u.desde, u.hasta + 1).join(' '),
            paginas: u.hasta - u.desde + 1, tomo: { archivo: nombre, desde: u.desde, hasta: u.hasta, expedienteVisto: u.expediente, dudosa: !!u.dudosa },
            nombreControl: u.expediente ? `documento_${u.expediente.replace('/', '-')}_tomo.pdf` : null }));
          console.log(`  tomo ${nombre}: ${pags.length} páginas → ${us.length} resoluciones · ${sueltas.length} páginas sueltas`);
        } else {
          unidades.push({ ruta, buf, nombre, texto: pags.join(' '), paginas: pags.length, tomo: null, nombreControl: nombre });
        }
      } catch (err) { errores.push(`${nombre}\t${err.message}`); registros.push({ archivo: nombre, ruta, error: String(err.message || err) }); }
    }
    if (tomos) console.log(`  ${tomos} tomo(s) reconocidos · ${unidades.length} resoluciones a procesar\n`);

    // Paso 1: carril texto, secuencial y rápido. Deja separadas las que necesitan modelo.
    const paraModelo = [];
    const idUnidad = u => hash(u.buf) + (u.tomo ? `#${u.tomo.desde}` : '');
    for (const u of unidades) {
      const { nombre, ruta, buf, texto, paginas } = u;
      try {
        const r = PierriTexto.extraerDeTexto(texto, u.nombreControl);
        if (r.suficiente) {
          const derivado = PierriCore.procesarRegistro(r.extraido, CFG, TABLA, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: texto });
          registros.push({ archivo: nombre, ruta, hash: idUnidad(u), paginas, extraido: r.extraido, derivado, tokens: 0, fuente: 'texto', tomo: u.tomo,
            lectura: { fuente: 'texto', cobertura: r.cobertura, faltan: r.faltan } });
          porTexto++;
        } else if (O.key) {
          paraModelo.push({ ruta, nombre, buf, texto, previo: r, tomo: u.tomo, nombreControl: u.nombreControl, id: idUnidad(u) });
        } else {
          const derivado = PierriCore.procesarRegistro(r.extraido, CFG, TABLA, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: texto });
          derivado.revisar = true;
          derivado.motivos_revision = (derivado.motivos_revision || []).concat(['el texto del PDF no alcanzó: faltan ' + r.faltan.join(', ') + ' (hace falta correr con --key)']);
          registros.push({ archivo: nombre, ruta, hash: idUnidad(u), paginas, extraido: r.extraido, derivado, tokens: 0, fuente: 'texto_incompleto', tomo: u.tomo,
            lectura: { fuente: 'texto_incompleto', cobertura: r.cobertura, faltan: r.faltan } });
        }
      } catch (err) {
        errores.push(`${nombre}\t${err.message}`);
        registros.push({ archivo: nombre, ruta, error: String(err.message || err) });
      }
      if (++n % 25 === 0 || n === unidades.length) {
        process.stdout.write(`\r  texto: ${n}/${unidades.length} · resueltas ${porTexto} · para el modelo ${paraModelo.length} · errores ${errores.length}   `);
      }
    }
    console.log('');

    // Paso 2: carril modelo, en paralelo, guardando cada tanto por si hay que cortar.
    if (paraModelo.length) {
      console.log(`  modelo: ${paraModelo.length} resoluciones que el texto no resolvió`);
      let i = 0, listas = 0;
      const trabajador = async () => {
        while (i < paraModelo.length) {
          const it = paraModelo[i++];
          try {
            const bufEnvio = it.tomo ? await recortarPaginas(it.buf, it.tomo.desde, it.tomo.hasta) : it.buf;
            const { extraido, tokens: tk } = await leerConModelo(bufEnvio);
            const fusion = fusionar(it.previo.extraido, extraido);
            const derivado = PierriCore.procesarRegistro(fusion, CFG, TABLA, vistos, { nombreArchivo: it.nombreControl, textoCapaPDF: it.texto });
            registros.push({ archivo: it.nombre, ruta: it.ruta, hash: it.id, extraido: fusion, derivado, tokens: tk, fuente: 'modelo', tomo: it.tomo,
              lectura: { fuente: 'modelo', cobertura_texto: it.previo.cobertura, faltaban_en_texto: it.previo.faltan } });
            tokens += tk; porModelo++;
          } catch (err) {
            errores.push(`${it.nombre}\t${err.message}`);
            registros.push({ archivo: it.nombre, ruta: it.ruta, error: String(err.message || err) });
          }
          listas++;
          if (listas % 10 === 0) guardarTodo(registros);
          process.stdout.write(`\r  modelo: ${listas}/${paraModelo.length} · tokens ${tokens.toLocaleString('es-AR')} · errores ${errores.length}   `);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, O.paralelo) }, trabajador));
      console.log('');
    }
    if (errores.length) fs.appendFileSync(RUTA.errores, errores.join('\n') + '\n');
    console.log(`\nLeídas: ${porTexto} por texto (sin costo) · ${porModelo} con el modelo`);

    // Paso 2b: doble lectura (control de calidad del carril texto)
    if (O.dobleLectura && O.key) {
      const muestra = registros.filter(r => r.fuente === 'texto' && !r.control).slice(0, O.dobleLectura);
      if (muestra.length) {
        console.log(`\n  control: leyendo con el modelo ${muestra.length} resoluciones ya resueltas por texto…`);
        const comparaciones = [];
        let i = 0, listas = 0;
        const trabajador = async () => {
          while (i < muestra.length) {
            const r = muestra[i++];
            try {
              const buf0 = fs.readFileSync(r.ruta);
              const buf = r.tomo ? await recortarPaginas(buf0, r.tomo.desde, r.tomo.hasta) : buf0;
              const { extraido, tokens: tk } = await leerConModelo(buf);
              const dModelo = PierriCore.procesarRegistro(extraido, CFG, TABLA, new Set(), { nombreArchivo: r.archivo });
              const c = PierriCore.compararLecturas(r.derivado, dModelo);
              r.control = { coincide: c.coincide, diferencias: c.diferencias, lectura_modelo: extraido };
              r.tokens = (r.tokens || 0) + tk; tokens += tk;
              comparaciones.push({ archivo: r.archivo, expediente: r.derivado.expediente, ...c });
              // Si difieren en algo que decide la clasificación, la resolución va a revisión con las dos lecturas guardadas.
              if (!c.coincide && c.diferencias.some(d => ['posee_desde', 'cuenta', 'expediente', 'clasificacion'].includes(d.campo))) {
                r.derivado.revisar = true;
                r.derivado.motivos_revision = (r.derivado.motivos_revision || []).concat(['texto y modelo no coinciden en ' + c.diferencias.map(d => d.campo).join(', ')]);
              }
            } catch (err) { comparaciones.push({ archivo: r.archivo, error: err.message }); }
            listas++;
            process.stdout.write(`\r  control: ${listas}/${muestra.length}   `);
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, O.paralelo) }, trabajador));
        const previo = fs.existsSync(RUTA.control) ? JSON.parse(fs.readFileSync(RUTA.control, 'utf8')) : { comparaciones: [] };
        const todas = previo.comparaciones.concat(comparaciones.filter(c => !c.error));
        const resumen = PierriCore.resumirComparaciones(todas);
        fs.writeFileSync(RUTA.control, JSON.stringify({ fecha: new Date().toISOString(), resumen, comparaciones: todas,
          errores: (previo.errores || []).concat(comparaciones.filter(c => c.error)) }, null, 1));
        console.log(`\n  control: ${resumen.coinciden_del_todo}/${resumen.total} coinciden en todo (${resumen.tasa_global}%)`);
        for (const [k, v] of Object.entries(resumen.por_campo)) if (v.distintos) console.log(`    ${k.padEnd(16)} ${v.exactitud}% (${v.distintos} distintos)`);
      }
    }
  }

  // Paso 3: repetidos, clusters y Catastro
  const porExp = new Map();
  for (const r of registros) {
    if (!r.derivado || !r.derivado.expediente) continue;
    if (!porExp.has(r.derivado.expediente)) porExp.set(r.derivado.expediente, []);
    porExp.get(r.derivado.expediente).push(r);
  }
  let repetidos = 0;
  for (const lista of porExp.values()) {
    if (lista.length < 2) continue;
    repetidos += lista.length - 1;
    lista.sort((a, b) => String(b.derivado.resolucion_fecha || '').localeCompare(String(a.derivado.resolucion_fecha || '')));
    lista.slice(1).forEach(r => { r.repetido_de = lista[0].archivo; });
  }
  if (repetidos) console.log(`Repetidos: ${repetidos} resolución(es) de expedientes ya vistos; se conservó la más nueva de cada uno`);
  const derivados = registros.filter(r => r.derivado && !r.repetido_de).map(r => r.derivado);
  PierriCore.detectarClusters(derivados);

  if (!O.sinCatastro) {
    const pend = derivados.filter(d => d.geo && d.geo.cuenta_normalizada && !(d.geo.catastro && d.geo.catastro.encontrada));
    if (pend.length) {
      process.stdout.write(`Catastro: consultando ${pend.length} cuentas… `);
      try {
        const parcelas = await PierriCore.consultarCatastro(pend.map(d => d.geo.cuenta_normalizada));
        let ok = 0;
        for (const d of pend) if (PierriCore.enriquecerConCatastro(d, parcelas[d.geo.cuenta_normalizada.replace(/\D/g, '')], TABLA)) ok++;
        console.log(`${ok} ubicadas, ${pend.length - ok} sin parcela`);
      } catch (err) { console.log('falló (' + err.message + '). Se puede reintentar con --solo-catastro'); }
    }
  }

  guardarTodo(registros);

  // Informe final
  const cuenta = c => derivados.filter(d => PierriCore.clasificar(d) === c).length;
  const min = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n─────────────────────────────────────────');
  console.log(`Total de resoluciones:      ${derivados.length}`);
  console.log(`  elegibles:                ${cuenta('ELEGIBLE') + cuenta('ELEGIBLE_BORDE')}  (borde: ${cuenta('ELEGIBLE_BORDE')})`);
  console.log(`  no elegibles:             ${cuenta('NO_ELEGIBLE') + cuenta('NO_ELEGIBLE_BORDE')}  (borde: ${cuenta('NO_ELEGIBLE_BORDE')})`);
  console.log(`  sin fecha de posesión:    ${cuenta('SIN_DATO') + cuenta('REVISAR')}`);
  console.log(`  a revisar a mano:         ${derivados.filter(d => d.revisar).length}`);
  console.log(`  no son resoluciones:      ${cuenta('NO_APLICA')}`);
  console.log(`  errores de lectura:       ${registros.filter(r => r.error).length}`);
  console.log(`Tokens usados:              ${tokens.toLocaleString('es-AR')}`);
  console.log(`Tiempo:                     ${min} min`);
  console.log('─────────────────────────────────────────');
  console.log(`\nResultados en ${path.resolve(salida)}:`);
  console.log(`  resultados.jsonl  → cargalo en el visor`);
  console.log(`  planilla.csv      → se abre en Excel`);
  console.log(`  resumen.json      → totales por clasificación y localidad`);
})().catch(err => { console.error('\nError general:', err); process.exit(1); });
