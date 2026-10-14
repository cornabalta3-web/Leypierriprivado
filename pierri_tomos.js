/*
 * Relevamiento Ley Pierri — tomos y carril de texto
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_tomos.js — la parte del Lector que no necesita Node: reconocer un tomo, cortarlo en resoluciones
 * y armar el registro con lo que leyó la capa de texto. Recibe el texto de cada página ya extraído; leer
 * el PDF, calcular el hash y consultar al modelo quedan afuera, en quien lo use.
 *
 * Lo usan el Lector del kit (pierri_lector.js) y la versión web, que lee los PDF en el navegador. Una sola
 * implementación: una resolución se corta y se clasifica igual en los dos lados.
 *
 *   esTomo(pags) / cortarTomo(pags, expArchivo)          reconocer y cortar tomos en resoluciones
 *   expedienteDelNombre(nombre)                          expediente que trae el nombre del archivo de la UEST
 *   unidadesDe(pags, nombre, h)                          las resoluciones a leer de un archivo (suelto o tomo)
 *   leerTexto(u)                                         carril texto sobre una unidad (PierriTexto.extraerDeTexto)
 *   registroBase(u, h)                                   lo común a todo registro de una unidad
 *   registroPorTexto(base, u, lect, cfg, tabla, vistos)  registro cuando el texto alcanzó
 *   registroIncompleto(base, u, lect, cfg, tabla, vistos, porque, fallaModelo)
 *                                                        registro cuando el texto no alcanzó y no se usó el modelo
 *
 * Sin DOM y sin require propios: recibe PierriCore y PierriTexto. Node (module.exports) y navegador
 * (window.PierriTomos, cargado después de pierri_core.js y pierri_texto.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pierri_core.js'), require('./pierri_texto.js'));
  else root.PierriTomos = factory(root.PierriCore, root.PierriTexto);
})(typeof self !== 'undefined' ? self : this, function (PierriCore, PierriTexto) {
  'use strict';

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
  /** El texto de una página a partir de lo que da pdf.js (getTextContent().items): el mismo en el kit y en la web. */
  function textoDeItems(items) { return items.map(t => t.str).join(' ').replace(/\s+/g, ' ').trim(); }
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

  // ───────────────────────────── Un archivo → unidades ─────────────────────────────
  /**
   * Las resoluciones que hay que leer en un archivo. Un PDF suelto es una sola unidad; un tomo (o un
   * expediente completo) se corta y de cada expediente queda la resolución que ordena la inscripción.
   * @param {string[]} pags    texto de cada página, en orden
   * @param {string} nombre    nombre del archivo
   * @param {string} h         hash del archivo completo (lo calcula quien llama)
   * @returns {{ unidades: object[], tipo: 'suelta'|'tomo', sueltas: number[], paginasCuerpo: number,
   *   bloquesDescartados: number, resolucionesTramite: number }}
   *   Cada unidad: { nombre, texto, paginas, tomo, nombreControl, id }
   */
  function unidadesDe(pags, nombre, h) {
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
    return { unidades, tipo, sueltas, paginasCuerpo, bloquesDescartados, resolucionesTramite };
  }

  // ───────────────────────────── Una unidad → registro ─────────────────────────────
  /** Lectura de la capa de texto de una unidad. El nombre de control permite detectar un expediente distinto al del archivo. */
  function leerTexto(u) { return PierriTexto.extraerDeTexto(u.texto, u.nombreControl); }
  /** Lo que todo registro de una unidad trae, se haya leído por texto, con el modelo o con error. */
  function registroBase(u, h) {
    return { archivo: u.nombre, hash: u.id, hash_archivo: h, paginas: u.paginas, tomo: u.tomo, tokens: 0 };
  }
  /**
   * El texto alcanzó: el registro sale entero de la capa de texto, sin costo.
   * @param {object} base   registroBase(u, h); se completa y se devuelve el mismo objeto
   * @param {object} u      la unidad (de unidadesDe)
   * @param {object} lect   leerTexto(u), con lect.suficiente
   */
  function registroPorTexto(base, u, lect, cfg, tabla, vistos) {
    const derivado = PierriCore.procesarRegistro(lect.extraido, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
    return Object.assign(base, { extraido: lect.extraido, derivado, fuente: 'texto', lectura: { fuente: 'texto', cobertura: lect.cobertura, faltan: lect.faltan } });
  }
  /**
   * El texto no alcanzó y no se consultó al modelo (no hay clave, o el modelo quedó bloqueado). Se guarda
   * lo que leyó el texto, marcado para revisar, para completarlo después con el modelo.
   * @param {string} porque          aclaración que sigue a la lista de faltantes, p. ej. ' (se completa con clave de API)'
   * @param {string} [fallaModelo]   por qué no se usó el modelo, si estaba bloqueado
   */
  function registroIncompleto(base, u, lect, cfg, tabla, vistos, porque, fallaModelo) {
    const derivado = PierriCore.procesarRegistro(lect.extraido, cfg, tabla, vistos, { nombreArchivo: u.nombreControl, textoCapaPDF: u.texto });
    derivado.revisar = true;
    derivado.motivos_revision = (derivado.motivos_revision || []).concat(['el texto del PDF no alcanzó: faltan ' + lect.faltan.join(', ') + (porque || '')]);
    return Object.assign(base, { extraido: lect.extraido, derivado, fuente: 'texto_incompleto', falla_modelo: fallaModelo || null,
      lectura: { fuente: 'texto_incompleto', cobertura: lect.cobertura, faltan: lect.faltan } });
  }

  return { textoDeItems,
    RE_INICIO, RE_EXP, RE_EXP_TEMPRANO, RE_FIN, RE_FIN_FUERTE, RE_RESOLUTIVA, RE_ORDEN_INSCRIPCION, RE_ORDENAR,
    puntajeResolucion, esTomo, expedienteDelNombre, cortarTomo, mejorDe, unaPorExpediente,
    unidadesDe, leerTexto, registroBase, registroPorTexto, registroIncompleto,
  };
});
