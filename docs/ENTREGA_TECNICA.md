# Sistema Ley Pierri — entrega técnica

**Para:** área de Sistemas del Ministerio de Justicia
**De:** Escribanía General de Gobierno de la Provincia de Córdoba
**Fecha:** septiembre de 2026
**Desarrollo:** Baltasar Corna Fantin

Este documento acompaña al código fuente (`kit_ley_pierri.zip`). Describe qué hace el sistema, cómo está hecho, qué datos maneja, qué le falta para funcionar como aplicación institucional y qué decisiones quedan del lado de Sistemas.

---

## 1. Qué hace

Lee las resoluciones de la Unidad Ejecutora para el Saneamiento de Títulos (Ley 9150) en PDF, extrae del texto la fecha desde la que posee cada persona, y clasifica el expediente como **elegible o no elegible** para la Ley Pierri (Ley 24.374 / Ley provincial 8932) según el requisito de antigüedad de la posesión. Además:

- georreferencia cada expediente consultando Catastro de Córdoba (IDECOR) por número de cuenta, o ubica la localidad cuando la resolución no trae cuenta;
- cruza con el padrón de anotaciones del Registro General para detectar resoluciones dictadas que nunca llegaron a inscribirse;
- conserva de cada dato la frase textual del documento de la que salió, y permite abrir el PDF original y corregir a mano, registrando quién revisó.

Estado: probado con 70 resoluciones reales. El relevamiento completo (7.083 resoluciones digitalizadas de un universo de 49.668 expedientes) está pendiente de recibir los archivos.

## 2. Cómo está hecho

| | |
|---|---|
| Lenguaje | JavaScript sobre **Node.js LTS 22.13 o superior** (probado en v24.21) |
| Servidor | Módulo `http` nativo. Sin framework, sin build, sin transpilación |
| Base de datos | **SQLite**, con el módulo `node:sqlite` incluido en Node. Un solo archivo: `pierri.db` |
| Interfaz | Un único archivo `tablero_pierri.html`, sin framework ni empaquetador. Se sirve desde el mismo proceso |
| Dependencias npm | `pdfjs-dist@4.10.38` (leer PDF), `pdf-lib@1.17.1` (recortar páginas), `xlsx@0.18.5` (leer inventario y padrón en Excel) |
| Puesta en marcha | `npm install` y `node pierri.js`. Escucha en `127.0.0.1:3777`; con `--compartir` escucha en `0.0.0.0`; con `--seguro` marca la cookie de sesión como Secure |
| Tamaño | Código: unas 8.000 líneas propias. Kit comprimido: 7 MB |

**Sobre las dependencias.** Son tres, todas de uso común y sin servicios de terceros. Dos observaciones honestas: `node:sqlite` figura como módulo experimental en Node 22 y 23 (en 24 funciona sin flags), y si su política de seguridad objeta `xlsx@0.18.5`, se puede reemplazar por lectura de CSV sin tocar el resto del sistema, porque solo se usa para importar dos planillas.

### Archivos principales

```
pierri.js          servidor HTTP, base de datos y endpoints
pierri_lector.js   lectura de PDF, carril modelo, consulta a Catastro
pierri_tomos.js    corte de tomos y expedientes y carril texto (lo usan el kit y la web; el kit no arranca sin él)
pierri_texto.js    reglas sobre el texto de la resolución (fechas, cuentas, tipos de documento)
pierri_core.js     elegibilidad, clasificación, decodificación de cuentas, planilla de salida
tablero_pierri.html  interfaz completa
banco_pruebas_texto.js  23 casos de prueba sobre las reglas de lectura (correr tras cada cambio)
codigos_departamentos_pedanias_cordoba.json, localidades_cordoba.json  tablas oficiales
```

### Endpoints

```
GET  /api/datos                 todo el relevamiento (registros, resumen, inventario, padrón)
POST /api/pdf                   cargar una resolución, expediente o tomo
POST /api/padron                importar el padrón del Registro General (Excel)
POST /api/inventario            importar el inventario de la Unidad (CSV)
POST /api/inventario/ubicar     ubicar expedientes del inventario en Catastro
POST /api/catastro              completar ubicaciones pendientes
POST /api/completar             completar con el modelo las que el texto no resolvió
POST /api/releer                releer todo lo guardado con las reglas actuales
POST /api/revision              revisión manual: corrección, revisor y observación
POST /api/config                clave de API, modelo y criterio de elegibilidad
POST /api/vaciar                borrar todo
GET  /api/documento?id=         abre el PDF original de una resolución
GET  /api/archivos              qué aportó cada archivo cargado
GET  /api/planilla.csv          exportación
```

### Tablas

`resoluciones` (una por resolución, con el JSON completo del análisis), `archivos` (PDF cargados, por hash), `inventario` (expedientes de la Unidad), `padron` (anotaciones del Registro), `parcelas` (respuestas de Catastro, en caché), `meta`.

## 3. Datos que maneja

**Son datos personales.** De cada poseedor: nombre, DNI o CUIL, domicilio, ubicación del inmueble y la situación de su posesión. Del inventario de la Unidad: expediente, iniciador, DNI y fechas.

- Los PDF cargados se copian a la carpeta `embudo/`. Para las 7.083 resoluciones se estima alrededor de **1 GB**.
- La base `pierri.db` es un archivo único, respaldable con una copia.
- El sistema **no envía datos a ningún servicio externo** salvo los dos del punto siguiente.

## 4. Salidas a internet

| Destino | Para qué | Obligatorio |
|---|---|---|
| `idecor-ws.mapascordoba.gob.ar` (HTTPS) | Catastro de Córdoba: parcela, coordenadas y capa de parcelas | No, pero sin esto no hay mapa |
| `wms.ign.gob.ar` (HTTPS) | Mapa base del Instituto Geográfico Nacional | No, pero sin esto el mapa queda sin fondo |
| `api.anthropic.com` (HTTPS) | Modelo de IA que lee los escaneos que el texto no resuelve | No: sin clave, el sistema lee solo por texto |

La clave de API se guarda hoy en `config.json` junto al programa. **En el servidor debería ir en variable de entorno**, con límite de gasto configurado en la cuenta.

## 5. Qué le falta para ser una aplicación institucional

Esto es lo que hoy no tiene, en orden de importancia:

1. ~~Usuarios y perfiles~~ **HECHO (09/2026).** Cada persona entra con su cuenta; tres perfiles: consulta, revisión y administración. Contraseñas de 12 a 128 caracteres guardadas con scrypt y sal, bloqueo a los cinco intentos fallidos, sesiones con token aleatorio, vencimiento por inactividad a los 30 minutos, cierre del lado del servidor y cookie HttpOnly/SameSite. El control de permisos es del servidor.
2. ~~Registro de auditoría~~ **HECHO (09/2026).** Tabla `auditoria`: ingresos y fallidos, altas y bajas de usuarios, cargas, correcciones, apertura de documentos, cambios de configuración y borrados, con usuario, fecha y origen. Se consulta desde Configuración.
3. **Respaldo automático** de `pierri.db` y de `embudo/`, y restauración probada.
4. **HTTPS**, detrás del proxy o balanceador que usen.
5. **Procesamiento por lotes** para las 7.083 resoluciones: hoy el completado con el modelo va de a cinco, pensado para una PC.
6. **Límites de carga** (tamaño de archivo y concurrencia) y control de errores en la subida.

## 6. Decisiones que quedan de su lado

Necesito que Sistemas defina estos puntos para adaptar el sistema; ninguno implica rehacerlo:

1. **Autenticación.** ¿Ciudadano Digital, el directorio del Ministerio, o usuarios propios del sistema? Si existe un método estándar provincial, me adapto a ese.
2. **Servidor.** Windows o Linux, y si puede instalarse Node.js LTS. El sistema corre igual en los dos.
3. **Base de datos.** SQLite alcanza para este volumen (decenas de miles de filas y pocos usuarios simultáneos). Si la política exige un motor institucional (PostgreSQL o SQL Server), la migración es posible: el esquema son seis tablas y el acceso está concentrado en un solo archivo.
4. **Dónde se guardan los PDF.** Disco del servidor o unidad de red. Alrededor de 1 GB.
5. **Respaldos.** Frecuencia y responsable.
6. **Clave de API.** En variable de entorno del servidor, con límite de gasto mensual.
7. **Publicación.** Si va a estar dentro de la red del Ministerio o publicada con acceso externo, porque eso define los requisitos de seguridad.

## 7. Qué necesito de Sistemas para avanzar

1. **Los archivos digitalizados**: las 7.083 resoluciones y los expedientes, hoy en poder de la empresa que digitalizó. Es lo único que impide hacer el relevamiento completo.
2. **El servidor**, con Node.js instalado y respaldo configurado.
3. **El export del SUAC con DNI** de los expedientes digitalizados, para cruzar con el padrón del Registro sin ambigüedad de nombres.
4. **La clave de API** cargada en el servidor.

## 7 bis. Carga masiva

Para el archivo completo hay dos comandos: `procesar_lote.js` lee una carpeta con miles de PDF (reanudable, en
paralelo, con o sin el servicio pago) y `pierri.js --importar <salida> --pdfs <carpeta>` mete el resultado en la base
junto con los documentos. Ensayo con 1.824 resoluciones: 22 s de procesamiento, 5 s de importación, y el Tablero
abre 7.100 expedientes en menos de un segundo, con el mapa de 6.400 puntos en 0,3 s y 48 MB de memoria.

## 8. Cómo probarlo en diez minutos

```
npm install pdfjs-dist@4.10.38 pdf-lib@1.17.1 xlsx@0.18.5
node pierri.js
```

Abre `http://localhost:3777`. En "Filtro Ley Pierri" se arrastran PDF de resoluciones; el kit incluye `embudo_prueba.zip` con casos de ejemplo. `node banco_pruebas_texto.js` corre las 23 pruebas de las reglas de lectura.

---

*Escribanía General de Gobierno de la Provincia de Córdoba · Desarrollo: Baltasar Corna Fantin · Septiembre de 2026*
