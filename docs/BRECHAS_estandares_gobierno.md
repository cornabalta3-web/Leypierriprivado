# Relevamiento Ley Pierri — brechas contra los estándares del Gobierno de Córdoba

**Estándares analizados:** E_SIG_004 (Desarrollo Seguro de Aplicaciones, Rev. 01) y E_SIG_002 (Bases de Datos, Rev. 02, vigencia 15/05/2026).
**Sistema:** Relevamiento Ley Pierri (Node.js + SQLite, interfaz web servida por el mismo proceso).
**Fecha:** septiembre de 2026 · Escribanía General de Gobierno de la Provincia de Córdoba.

---

## 1. Nivel de seguridad que corresponde

El estándar define tres niveles. Al sistema le corresponde el **nivel 2**: maneja información sensible (nombre, DNI, domicilio y situación posesoria de personas), aunque no ejecuta funciones críticas de infraestructura ni operaciones financieras, que es lo que define el nivel 3.

Eso implica cumplir, además del nivel 1, los controles de arquitectura de seguridad, revisiones y SAST que el estándar marca para nivel 2.

## 2. Resumen honesto

Al momento del diagnóstico no cumplía. La mayoría de las brechas eran de funcionalidad que nunca se había construido, no decisiones difíciles de revertir: el sistema nació como herramienta de escritorio para una sola persona y había que convertirlo en aplicación institucional.

**Al 23/09/2026 ya están resueltas las cuatro principales**: usuarios con cuenta propia, sesiones, perfiles y registro de auditoría. Queda alrededor de un día de trabajo propio (secretos y respaldos) y lo que depende de la infraestructura del Ministerio.

Hay **una sola brecha estructural**, y es la base de datos.

## 3. La brecha estructural: E_SIG_002 exige Oracle

El estándar de bases de datos establece:

- **Motor:** Oracle Database 19c Enterprise Edition, arquitectura RAC + Multitenant, sobre Oracle Linux.
- **Toda la lógica de acceso y procesamiento de datos** debe implementarse dentro de la base, mediante *stored procedures*, *packages* y *functions*; la capa de negocio solo los invoca.
- **No se admiten aplicaciones cliente-servidor** como mecanismo de acceso a la base corporativa.
- **Cuatro ambientes obligatorios:** desarrollo, testing, preproducción y producción.

El sistema usa SQLite en un archivo y toda la lógica en JavaScript. Hay tres caminos posibles:

| Camino | Qué implica | Opinión |
|---|---|---|
| **A · Excepción documentada** | El propio estándar (punto 3.3) admite excepciones con motivo, impacto y aprobación del área de BD. Se pediría para la base de trabajo del relevamiento, que no es información corporativa transaccional sino el resultado del análisis de documentos. | **Es el camino que recomiendo pedir primero.** Conserva el sistema tal como está y probado. |
| **B · Migración a Oracle con lógica en la base** | Reescribir el acceso a datos como *stored procedures* en PL/SQL. El esquema son seis tablas, así que la migración del modelo es viable; lo pesado es mover la lógica. | Semanas de trabajo y se pierde la simplicidad. Solo si rechazan la excepción. |
| **C · Híbrido** | Oracle guarda el resultado final (expediente, elegibilidad, ubicación, estado registral) como dato corporativo consultable; el procesamiento de los PDF sigue en la herramienta, que publica hacia Oracle. | Buen punto medio si la excepción sale parcial. |

**Lo que hay que preguntarle al área de BD:** si el relevamiento se considera "información corporativa" a los fines del punto 2 del estándar, o si admite una base propia de la aplicación bajo excepción documentada.

## 4. Brechas del estándar de desarrollo seguro

### 4.1 Lo que ya cumple

- **Inyección SQL:** todas las consultas usan sentencias preparadas con parámetros.
- **Dependencias:** tres librerías de uso común, sin servicios de terceros; el código propio no se descarga en tiempo de ejecución.
- **Errores:** el sistema informa lo que no pudo leer en lugar de completar datos, y no expone trazas al usuario.
- **Comunicaciones externas:** solo dos destinos, ambos por HTTPS (Catastro de Córdoba y la API del modelo).
- **Datos de prueba:** existe un generador de resoluciones ficticias, que es justo lo que el estándar pide para no usar datos productivos en desarrollo (D3).

### 4.2 Lo que falta, por orden de importancia

| # | Brecha | Qué pide el estándar | Trabajo |
|---|---|---|---|
| 1 | ~~No hay usuarios~~ **RESUELTO** | Cada persona entra con su cuenta. Contraseñas de 12 a 128 caracteres sin truncar, guardadas con scrypt y sal; cambio con la contraseña actual; bloqueo a los cinco intentos fallidos por 15 minutos. | Hecho |
| 2 | ~~No hay sesiones~~ **RESUELTO** | Token aleatorio de 32 bytes, cierre por inactividad a los 30 minutos y máximo de 12 horas, invalidación del lado del servidor, cookie HttpOnly y SameSite=Strict, con Secure al correr detrás de HTTPS. | Hecho |
| 3 | ~~No hay perfiles~~ **RESUELTO** | Tres perfiles: consulta, revisión y administración. El permiso lo verifica el servidor en cada operación; la interfaz solo acompaña ocultando lo que no corresponde. | Hecho |
| 4 | ~~No hay auditoría~~ **RESUELTO** | Se registran ingresos y fallidos, altas y bajas de usuarios, cargas, correcciones, apertura de documentos, cambios de configuración y borrados, con usuario, perfil, fecha y origen. Consultable desde el sistema. | Hecho |
| 5 | **La clave de API se guarda en un archivo de texto** (`config.json`). | Variables de entorno o bóveda de claves; nunca en texto plano ni en el código; claves distintas por ambiente. GC1, GC2, C68. | Medio día |
| 6 | **La subida de archivos** valida tipo y tamaño (máximo 80 MB, firma de PDF obligatoria) y los archivos se guardan fuera de la raíz web. **Falta el análisis con antivirus.** | Análisis antivirus de los archivos recibidos. Sección 4.A.2. | Depende de la herramienta del Ministerio |
| 7 | **No hay respaldos.** | Respaldo de los datos con frecuencia definida, del servidor y de la configuración. GD1 a GD3. | Medio día, más lo que defina Sistemas |
| 8 | **Un solo ambiente.** | Segregación entre desarrollo, pruebas y producción; sin datos productivos fuera de producción. D1 a D3. | Depende de Sistemas |
| 9 | **Sin cifrado en reposo.** | Proteger los datos personales almacenados según su criticidad. | Se resuelve con cifrado del volumen o del motor, del lado de Sistemas |
| 10 | **Sin pruebas automáticas de seguridad.** | Análisis estático (SAST) y revisión de pares para nivel 2. | Depende de las herramientas del Ministerio |

**Estado al 23/09/2026:** resueltos los puntos 1 a 4 y la mayor parte del 6. Queda de nuestro lado el 5 (secretos) y el 7 (respaldos), alrededor de un día de trabajo. Los puntos 8 a 10 dependen de la infraestructura y las herramientas del Ministerio.

## 5. Qué conviene hacer, en este orden

1. **Preguntar por la base de datos** (punto 3 de este informe). Es lo único que puede cambiar la arquitectura, así que conviene resolverlo antes que nada.
2. ~~Usuarios, perfiles, sesiones y auditoría~~ **hecho.**
3. **Secretos y respaldos** (puntos 5 y 7): un día de trabajo.
4. **Acordar con Sistemas** ambientes, cifrado, antivirus y pruebas (puntos 6 y 8 a 10).

## 5 bis. Requerimientos del servidor

| | |
|---|---|
| **Procesador** | 2 núcleos; 4 recomendados para las corridas masivas |
| **Memoria** | 4 GB mínimo, 8 GB recomendado |
| **Disco** | 50 GB. Los PDF de las 7.083 resoluciones ocupan alrededor de 1 GB; el resto es margen para respaldos y para los expedientes completos |
| **Sistema operativo** | Windows Server o Linux, indistinto. Se recomienda Linux, y Oracle Linux si ya es el estándar del Ministerio |
| **Software** | Node.js LTS 22.13 o superior. Nada más: sin motor de base de datos, sin servidor web, sin dependencias de sistema |
| **Red de salida** | HTTPS a `idecor-ws.mapascordoba.gob.ar` (Catastro), `wms.ign.gob.ar` (mapa base del IGN) y, si se usa la lectura con modelo, `api.anthropic.com` |
| **Red de entrada** | Solo el puerto de la aplicación detrás del proxy institucional, en HTTPS |
| **Ambientes** | Desarrollo y producción como mínimo; testing y preproducción según el procedimiento P SIG 001 |

## 5 ter. Por qué proponemos las opciones 1 y 3, y no Power Platform

**Opción 1 (circuito formal P SIG 001), para el sistema definitivo.** Es el único camino que deja los datos personales
dentro de la infraestructura provincial, que es una exigencia y no una preferencia: el sistema maneja nombre, DNI,
domicilio y situación posesoria de miles de personas. Además es el procedimiento que el área de Sistemas ya transita
con soltura, y el proyecto tiene aprobación del Ministerio. Como el desarrollo ya está hecho dentro del organismo, no
hace falta subasta ni contratación, que es lo que suele demorar meses.

**Opción 3 (repositorio privado), en paralelo y solo para trabajar.** Mientras el circuito avanza, el código vive en un
repositorio privado y el relevamiento se corre en una máquina del organismo. Permite seguir procesando resoluciones y
mostrar resultados sin esperar la aprobación. Los datos no salen de la Escribanía.

**Por qué no Power Platform.** El núcleo del sistema es leer el texto de miles de PDF escaneados, aplicar reglas
jurídicas sobre frases sueltas y consultar Catastro. Eso no se resuelve con esa herramienta, y lo más parecido cobra
por documento procesado y por usuario. Rehacerlo significaría descartar un sistema ya probado con resoluciones reales,
sin un error de clasificación, y empezar de cero con menos control y con licencias. Donde sí puede sumar es después:
Power BI leyendo los resultados para los tableros de autoridades.

## 6. Preguntas para el área de Sistemas

1. ¿El relevamiento se considera información corporativa a los fines del estándar de bases de datos, o se admite base propia de la aplicación con excepción documentada?
2. ¿Cuál de las tres opciones de alojamiento se va a usar, y qué implica cada una en cuanto a sistema operativo, contenedores y acceso?
3. ¿Hay un método de autenticación estándar de la Provincia al que convenga integrarse (Ciudadano Digital, directorio del Ministerio) en lugar de usuarios propios?
4. ¿Qué bóveda de claves usan para los secretos de aplicación?
5. ¿Qué herramienta de análisis estático (SAST) debe pasar el código, y quién hace la revisión de pares?
6. ¿Quién provee y opera los ambientes de desarrollo, testing y preproducción?

---

*Escribanía General de Gobierno de la Provincia de Córdoba · Desarrollo: Baltasar Corna Fantin · Septiembre de 2026*
