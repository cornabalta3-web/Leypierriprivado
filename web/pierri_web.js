/*
 * Relevamiento Ley Pierri — versión web
 * Ley 24.374 / Ley 8932 · Escribanía General de Gobierno de Córdoba
 * Diseño y desarrollo: Baltasar Corna Fantin, 2026.
 */
/**
 * pierri_web.js — hace en el navegador lo que en el kit hace pierri.js, para que el Tablero ande desde un link
 * (GitHub Pages) sin programa instalado. El Tablero le pide todo con api(ruta) como si fuera el servidor.
 *
 * Los datos viven en el mismo repositorio público, cifrados (AES-256-GCM):
 *   datos/usuarios.json     una entrada por usuario activo: la llave de los datos, cifrada con una llave que sale de
 *                           su contraseña (PBKDF2-SHA256, 600.000 vueltas). La entrada se busca por un resumen del
 *                           nombre de usuario, así el archivo no muestra quiénes son.
 *   datos/relevamiento.enc  el relevamiento (lo que exporta "Guardar JSON" del kit), comprimido y cifrado con la
 *                           llave de los datos.
 *   datos/admin.enc         lo que solo abre el administrador: la llave de cada usuario, el permiso para escribir en
 *                           GitHub (token) y el registro de cambios. Cifrado con una llave que solo trae su entrada.
 *
 * Solo el administrador escribe: lo hace con su token por la API de GitHub, en un único commit por cambio. Desactivar a
 * alguien cambia la llave de los datos y vuelve a cifrar todo: su contraseña deja de abrir lo nuevo. Lo que ya estaba
 * publicado antes queda en el historial del repositorio (ver docs/LEEME_como_correrlo.md).
 *
 * La sesión dura lo que la pestaña: las llaves quedan en sessionStorage y se borran al cerrarla o con "Cerrar sesión".
 */
(function () {
  'use strict';
  const ITER = 600000;
  const PREFIJO_ID = 'relevamiento-pierri:';
  const CLAVE_MINIMA = 12;
  const ROLES = { admin: 'Administración', editor: 'Revisión', veedor: 'Consulta' };
  // En la web, por ahora, solo el administrador escribe (es el único con token). Los perfiles quedan guardados para después.
  const PERMISOS = { ver: ['veedor', 'editor', 'admin'], revisar: [], cargar: ['admin'], administrar: ['admin'] };
  const RUTAS = { usuarios: 'datos/usuarios.json', datos: 'datos/relevamiento.enc', admin: 'datos/admin.enc' };
  const CLAVE_SESION = 'pierri_web_sesion';
  const REPO = window.PIERRI_WEB_REPO || repoDesdeDireccion();

  function repoDesdeDireccion() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    return { owner: m ? m[1] : '', repo: location.pathname.split('/').filter(Boolean)[0] || '', rama: 'main' };
  }

  // ───────────── Cifrado ─────────────
  const te = new TextEncoder(), td = new TextDecoder();
  const azar = n => crypto.getRandomValues(new Uint8Array(n));
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function desb64(s) { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  async function derivar(clave, sal) {
    const base = await crypto.subtle.importKey('raw', te.encode(String(clave).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: ITER, hash: 'SHA-256' }, base, 256));
  }
  const llaveAES = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function cifrar(raw, bytes) {
    const iv = azar(12);
    return { iv: b64(iv), datos: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await llaveAES(raw), bytes))) };
  }
  async function descifrar(raw, sobre) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desb64(sobre.iv) }, await llaveAES(raw), desb64(sobre.datos)));
  }
  const flujo = (bytes, t) => new Response(new Blob([bytes]).stream().pipeThrough(t));
  const comprimir = async texto => new Uint8Array(await flujo(te.encode(texto), new CompressionStream('gzip')).arrayBuffer());
  const descomprimir = bytes => flujo(bytes, new DecompressionStream('gzip')).text();
  async function idUsuario(usuario) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(PREFIJO_ID + usuario)));
    return Array.from(h, x => x.toString(16).padStart(2, '0')).join('');
  }
  const normUsuario = u => String(u || '').trim().toLowerCase();
  function validarUsuario(u) { if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Error('El usuario va en minúsculas, sin espacios, de 3 a 40 caracteres (letras, números, punto, guion).'); }
  function validarClave(c) {
    const n = [...String(c || '')].length;
    if (n < CLAVE_MINIMA) throw new Error(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);
    if (n > 128) throw new Error('La contraseña no puede superar los 128 caracteres.');
  }

  // ───────────── Repositorio ─────────────
  /** Lee un archivo publicado. Con token va por la API (siempre lo último); sin token, por la página (puede tardar unos minutos en verse lo nuevo). */
  async function leer(ruta, token) {
    if (token) {
      const r = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${ruta}?ref=${encodeURIComponent(REPO.rama)}`,
        { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(errorGitHub(r.status));
      return r.text();
    }
    const r = await fetch(ruta + '?v=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('No se pudo leer ' + ruta + ' (respuesta ' + r.status + ').');
    return r.text();
  }
  function errorGitHub(status) {
    if (status === 401) return 'GitHub no acepta el token: está vencido o mal copiado.';
    if (status === 403) return 'El token no tiene permiso de escritura sobre este repositorio (Contents: Read and write).';
    if (status === 404) return 'GitHub no encuentra el repositorio con ese token: revisá que el token incluya este repositorio.';
    if (status === 409 || status === 422) return 'El repositorio cambió mientras se guardaba. Volvé a intentar.';
    return 'GitHub respondió ' + status + '.';
  }
  async function gh(token, metodo, ruta, cuerpo) {
    const r = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}${ruta}`, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(errorGitHub(r.status));
    return j;
  }
  /** Escribe varios archivos en un solo commit: o se guardan todos o ninguno. Nunca queda una llave nueva con datos viejos. */
  async function escribir(token, archivos, mensaje) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const ref = await gh(token, 'GET', `/git/ref/heads/${encodeURIComponent(REPO.rama)}`);
        const base = await gh(token, 'GET', `/git/commits/${ref.object.sha}`);
        const arbol = [];
        for (const [ruta, texto] of Object.entries(archivos)) {
          const blob = await gh(token, 'POST', '/git/blobs', { content: texto, encoding: 'utf-8' });
          arbol.push({ path: ruta, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const t = await gh(token, 'POST', '/git/trees', { base_tree: base.tree.sha, tree: arbol });
        const c = await gh(token, 'POST', '/git/commits', { message: mensaje, tree: t.sha, parents: [ref.object.sha] });
        await gh(token, 'PATCH', `/git/refs/heads/${encodeURIComponent(REPO.rama)}`, { sha: c.sha });
        return;
      } catch (e) {
        if (intento === 0 && /cambió mientras/.test(e.message)) continue;
        throw e;
      }
    }
  }

  // ───────────── Sesión ─────────────
  function sesion() { try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION) || 'null'); } catch (e) { return null; } }
  function guardarSesion(s) { try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s)); } catch (e) { /* sin almacenamiento: la sesión dura hasta recargar */ } MEMORIA = s; }
  let MEMORIA = null;
  const actual = () => sesion() || MEMORIA;
  const puede = (s, p) => !!s && (PERMISOS[p] || []).includes(s.rol);
  function exigir(p) {
    const s = actual();
    if (!s) throw new Error('Tenés que ingresar.');
    if (!puede(s, p)) throw new Error(`Tu perfil (${ROLES[s.rol] || s.rol}) no puede hacer esta operación en la versión web.`);
    return s;
  }

  // ───────────── Piezas guardadas ─────────────
  async function leerUsuarios(token) { const t = await leer(RUTAS.usuarios, token); return t ? JSON.parse(t) : null; }
  async function abrirBoveda(s) {
    const t = await leer(RUTAS.admin, s.token || null);
    if (!t) throw new Error('No encuentro la bóveda del administrador en el repositorio.');
    return JSON.parse(td.decode(await descifrar(desb64(s.ak), JSON.parse(t))));
  }
  async function sellarBoveda(s, boveda) { return JSON.stringify(Object.assign({ v: 1 }, await cifrar(desb64(s.ak), te.encode(JSON.stringify(boveda))))); }
  async function sellarDatos(dek, contenido) {
    return JSON.stringify(Object.assign({ v: 1 }, await cifrar(dek, await comprimir(JSON.stringify(contenido)))));
  }
  async function abrirDatos(dek, token) {
    const t = await leer(RUTAS.datos, token);
    if (!t) return { resultados: [], resumen: {}, config: {} };
    return JSON.parse(await descomprimir(await descifrar(dek, JSON.parse(t))));
  }
  /** La entrada de un usuario en usuarios.json: la llave de los datos (y la de la bóveda si es admin), cifrada con la suya. */
  async function entrada(u, info, kek, dek, ak) {
    const carga = { u, n: info.nombre, r: info.rol, k: b64(dek) };
    if (info.rol === 'admin' && ak) carga.a = b64(ak);
    return Object.assign({ sal: info.sal }, await cifrar(kek, te.encode(JSON.stringify(carga))));
  }
  async function armarUsuarios(boveda, dek, ak) {
    const usuarios = {};
    for (const [u, info] of Object.entries(boveda.usuarios)) {
      if (!info.activo) continue;
      usuarios[await idUsuario(u)] = await entrada(u, info, desb64(info.kek), dek, ak);
    }
    return JSON.stringify({ v: 1, iteraciones: ITER, usuarios }, null, 1);
  }
  function anotar(boveda, s, accion, detalle) {
    boveda.cambios = boveda.cambios || [];
    boveda.cambios.push({ fecha: new Date().toISOString(), usuario: s.usuario, accion, detalle: detalle || null });
    if (boveda.cambios.length > 2000) boveda.cambios = boveda.cambios.slice(-2000);
  }
  function listaUsuarios(boveda) {
    return Object.entries(boveda.usuarios).sort(([a], [b]) => a.localeCompare(b)).map(([u, i]) => ({
      usuario: u, nombre: i.nombre, rol: i.rol, activo: i.activo ? 1 : 0, debe_cambiar: 0, creado_en: i.creado || null, ultimo_acceso: null, bloqueado_hasta: null,
    }));
  }

  // ───────────── Operaciones ─────────────
  async function inicial(c) {
    if (await leerUsuarios(null)) throw new Error('El sistema ya tiene administrador. Ingresá con tu usuario.');
    const u = normUsuario(c.usuario); validarUsuario(u); validarClave(c.clave);
    const token = String(c.token || '').trim();
    if (!token) throw new Error('Falta el token de GitHub.');
    const repo = await gh(token, 'GET', '');
    if (!repo.permissions || !repo.permissions.push) throw new Error('El token no tiene permiso de escritura sobre este repositorio.');
    const dek = azar(32), ak = azar(32), sal = azar(16), kek = await derivar(c.clave, sal);
    const ahora = new Date().toISOString();
    const boveda = { v: 1, github: { token }, usuarios: { [u]: { nombre: String(c.nombre || u).trim(), rol: 'admin', sal: b64(sal), kek: b64(kek), activo: true, creado: ahora } }, cambios: [] };
    const s = { usuario: u, nombre: boveda.usuarios[u].nombre, rol: 'admin', dek: b64(dek), ak: b64(ak), token };
    anotar(boveda, s, 'inicio', 'se creó el administrador');
    await escribir(token, {
      [RUTAS.usuarios]: await armarUsuarios(boveda, dek, ak),
      [RUTAS.admin]: await sellarBoveda(s, boveda),
      [RUTAS.datos]: await sellarDatos(dek, { fecha: ahora, origen: null, resumen: {}, config: {}, resultados: [] }),
    }, 'Puesta en marcha');
    guardarSesion(s);
    return { ok: true };
  }

  async function login(c) {
    const lista = await leerUsuarios(null);
    if (!lista) throw new Error('El sistema todavía no tiene usuarios.');
    const u = normUsuario(c.usuario);
    const e = lista.usuarios[await idUsuario(u)];
    // Si el usuario no existe se hace la misma cuenta con otra entrada, para que no se note la diferencia por el tiempo.
    const prueba = e || Object.values(lista.usuarios)[0];
    if (!prueba) throw new Error('Usuario o contraseña incorrectos.');
    const kek = await derivar(c.clave || '', desb64(prueba.sal));
    let carga;
    try { carga = JSON.parse(td.decode(await descifrar(kek, prueba))); } catch (err) { carga = null; }
    if (!e || !carga || carga.u !== u) throw new Error('Usuario o contraseña incorrectos.');
    const s = { usuario: u, nombre: carga.n, rol: carga.r, dek: carga.k };
    if (carga.a) {
      s.ak = carga.a;
      const boveda = await abrirBoveda(s);
      s.token = boveda.github && boveda.github.token;
    }
    guardarSesion(s);
    return { ok: true };
  }

  async function cambiarClavePropia(c) {
    const s = exigir('ver');
    if (s.rol !== 'admin') throw new Error('En la versión web la contraseña la cambia el administrador.');
    validarClave(c.nueva);
    const boveda = await abrirBoveda(s), yo = boveda.usuarios[s.usuario];
    if (!yo) throw new Error('No encuentro tu usuario en la bóveda.');
    const kekActual = await derivar(c.actual || '', desb64(yo.sal));
    if (b64(kekActual) !== yo.kek) throw new Error('La contraseña actual no es correcta.');
    const sal = azar(16);
    yo.sal = b64(sal); yo.kek = b64(await derivar(c.nueva, sal)); yo.actualizado = new Date().toISOString();
    anotar(boveda, s, 'cambio_clave', s.usuario);
    await escribir(s.token, { [RUTAS.usuarios]: await armarUsuarios(boveda, desb64(s.dek), desb64(s.ak)), [RUTAS.admin]: await sellarBoveda(s, boveda) }, 'Actualización de usuarios');
    return { ok: true };
  }

  async function usuarios(metodo, c) {
    const s = exigir('administrar');
    const boveda = await abrirBoveda(s);
    if (metodo === 'GET') return { roles: ROLES, usuarios: listaUsuarios(boveda) };
    const u = normUsuario(c.usuario), ahora = new Date().toISOString();
    let dek = desb64(s.dek), rotar = false;
    if (c.accion === 'crear') {
      validarUsuario(u); validarClave(c.clave);
      if (boveda.usuarios[u]) throw new Error('Ese usuario ya existe.');
      if (!ROLES[c.rol]) throw new Error('Perfil desconocido.');
      const sal = azar(16);
      boveda.usuarios[u] = { nombre: String(c.nombre || u).trim(), rol: c.rol, sal: b64(sal), kek: b64(await derivar(c.clave, sal)), activo: true, creado: ahora };
      anotar(boveda, s, 'usuario_alta', `${u} (${c.rol})`);
    } else {
      const info = boveda.usuarios[u];
      if (!info) throw new Error('Ese usuario no existe.');
      if (c.accion === 'rol') {
        if (!ROLES[c.rol]) throw new Error('Perfil desconocido.');
        if (u === s.usuario && c.rol !== 'admin') throw new Error('No podés sacarte el perfil de administración a vos mismo.');
        info.rol = c.rol; info.actualizado = ahora;
        anotar(boveda, s, 'usuario_perfil', `${u} → ${c.rol}`);
      } else if (c.accion === 'activo') {
        if (u === s.usuario) throw new Error('No podés desactivar tu propia cuenta.');
        info.activo = !!c.activo; info.actualizado = ahora;
        if (!info.activo) rotar = true;     // su contraseña no tiene que abrir nada nuevo
        anotar(boveda, s, info.activo ? 'usuario_activado' : 'usuario_desactivado', u);
      } else if (c.accion === 'reiniciar_clave') {
        validarClave(c.clave);
        const sal = azar(16);
        info.sal = b64(sal); info.kek = b64(await derivar(c.clave, sal)); info.actualizado = ahora;
        if (u !== s.usuario) rotar = true;  // la contraseña vieja pudo filtrarse
        anotar(boveda, s, 'usuario_clave_reiniciada', u);
      } else throw new Error('Acción desconocida.');
    }
    const archivos = {};
    if (rotar) {
      const contenido = await abrirDatos(dek, s.token);
      dek = azar(32);
      archivos[RUTAS.datos] = await sellarDatos(dek, contenido);
    }
    archivos[RUTAS.usuarios] = await armarUsuarios(boveda, dek, desb64(s.ak));
    archivos[RUTAS.admin] = await sellarBoveda(s, boveda);
    await escribir(s.token, archivos, 'Actualización de usuarios');
    if (rotar) guardarSesion(Object.assign({}, s, { dek: b64(dek) }));
    return { ok: true, usuarios: listaUsuarios(boveda) };
  }

  async function importar(cuerpo, nombre) {
    const s = exigir('cargar');
    const texto = typeof cuerpo === 'string' ? cuerpo : await cuerpo.text();
    let d;
    try { d = JSON.parse(texto.replace(/^﻿/, '')); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
    if (!d || !Array.isArray(d.resultados)) throw new Error('Ese JSON no es el que baja "Guardar JSON" del kit: no tiene "resultados".');
    const contenido = { fecha: new Date().toISOString(), origen: nombre || 'relevamiento', fecha_kit: d.fecha || null, resumen: d.resumen || {}, config: d.config || {}, resultados: d.resultados };
    const sellado = await sellarDatos(desb64(s.dek), contenido);
    if (sellado.length > 95 * 1024 * 1024) throw new Error('El relevamiento cifrado supera lo que GitHub acepta por archivo (100 MB).');
    const boveda = await abrirBoveda(s);
    const validas = d.resultados.filter(r => r && r.derivado && !r.repetido_de).length;
    anotar(boveda, s, 'carga_relevamiento', `${nombre || 'JSON'}: ${validas} resoluciones`);
    await escribir(s.token, { [RUTAS.datos]: sellado, [RUTAS.admin]: await sellarBoveda(s, boveda) }, 'Actualización del relevamiento');
    CACHE = null;
    return { ok: true, resoluciones: validas };
  }

  let CACHE = null;   // el relevamiento descifrado de esta pestaña: no se vuelve a bajar en cada pantalla
  async function datos() {
    const s = exigir('ver');
    if (!CACHE || CACHE.dek !== s.dek) {
      let contenido;
      try { contenido = await abrirDatos(desb64(s.dek), s.token || null); }
      catch (e) {
        if (e.name !== 'OperationError') throw e;
        // El administrador cambió la llave de los datos (desactivó a alguien o reinició una contraseña): hay que volver a ingresar.
        try { sessionStorage.removeItem(CLAVE_SESION); } catch (err) { /* nada */ }
        MEMORIA = null;
        setTimeout(() => location.reload(), 2500);
        throw new Error('Los datos se volvieron a cifrar. Volvé a ingresar con tu usuario.');
      }
      CACHE = { dek: s.dek, contenido };
    }
    const c = CACHE.contenido;
    const cfg = Object.assign({ regla: 'CORTE_FIJO', fechaCorte: '2006-01-01', margenBordeMeses: 12 }, c.config || {}, s.config || {});
    const P = window.PierriCore;
    const registros = (c.resultados || []).filter(r => r && r.derivado);
    for (const r of registros) {   // mismo cálculo que el Tablero hace en modo archivo: el corte se puede cambiar en pantalla
      const d = r.derivado, pd = d.posee_desde ? P.parseFecha(d.posee_desde) : null;
      d.elegibilidad = P.evaluarElegibilidad(pd, cfg);
      d.motivos_revision = (d.motivos_revision || []).filter(m => !m.startsWith('caso borde'));
      if (d.elegibilidad.borde) d.motivos_revision.push(`caso borde (posee desde ${d.posee_desde}, límite ${d.elegibilidad.fechaLimite})`);
      d.revisar = d.motivos_revision.length > 0;
    }
    const resumen = Object.assign({}, c.resumen || {});
    resumen.resoluciones = registros.filter(r => !r.repetido_de && !r.error).length;
    resumen.cargado_web = c.fecha || null;
    return { config: Object.assign({ key: '', modelo: '' }, cfg), resumen, registros };
  }

  async function auditoria() {
    const s = exigir('administrar');
    const boveda = await abrirBoveda(s);
    return { registros: (boveda.cambios || []).slice().reverse().map((c, i) => ({ id: i, fecha: c.fecha, usuario: c.usuario, rol: 'admin', accion: c.accion, detalle: c.detalle, ip: 'web' })) };
  }

  // ───────────── Rutas que pide el Tablero ─────────────
  async function api(ruta, opciones) {
    const o = opciones || {}, metodo = (o.method || 'GET').toUpperCase();
    const url = new URL(ruta, location.href), p = url.pathname.replace(/^.*\/api\//, '/api/');
    const cuerpoJSON = () => { try { return JSON.parse(typeof o.body === 'string' ? o.body : '{}'); } catch (e) { return {}; } };
    switch (p) {
      case '/api/yo': {
        const s = actual();
        if (!s) {
          if (!(await leerUsuarios(null))) return { sin_usuarios: true };
          throw new Error('Tenés que ingresar.');
        }
        return { usuario: s.usuario, nombre: s.nombre, rol: s.rol, rol_nombre: ROLES[s.rol] || s.rol, debe_cambiar: false,
          permisos: Object.fromEntries(Object.keys(PERMISOS).map(k => [k, puede(s, k)])) };
      }
      case '/api/login': return login(cuerpoJSON());
      case '/api/logout': try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ } MEMORIA = null; CACHE = null; return { ok: true };
      case '/api/clave': return cambiarClavePropia(cuerpoJSON());
      case '/api/usuarios': return usuarios(metodo, cuerpoJSON());
      case '/api/datos': return datos();
      case '/api/config': {
        const s = exigir('ver'), c = cuerpoJSON();
        s.config = { regla: c.regla, fechaCorte: c.fechaCorte, margenBordeMeses: Number(c.margenBordeMeses) || 0 };
        guardarSesion(s);
        return { ok: true };
      }
      case '/api/auditoria': return auditoria();
      case '/api/inventario/localidades': { const d = await datos(); return { localidades: [], inventario: d.resumen.inventario || { cargado: false } }; }
      case '/api/web/inicial': return inicial(cuerpoJSON());
      case '/api/web/importar': return importar(o.body, url.searchParams.get('nombre'));
      default:
        throw new Error('Esto todavía se hace en el kit: cargalo ahí y subí el JSON con "Guardar JSON".');
    }
  }

  if (!window.crypto || !crypto.subtle || typeof CompressionStream === 'undefined') {
    window.PIERRI_WEB_ERROR = 'Este navegador no puede abrir el sistema. Usá Chrome, Edge o Firefox actualizados.';
  }
  window.PIERRI_WEB = { api, repo: REPO, version: 1 };
})();
