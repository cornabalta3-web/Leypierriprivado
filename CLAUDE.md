# Contexto para Claude

## Qué es esto

Sistema de relevamiento para la **Escribanía General de Gobierno de la Provincia de Córdoba**. Lee resoluciones en PDF de la Unidad Ejecutora para el Saneamiento de Títulos (Ley 9150) y determina qué expedientes son elegibles para la Ley Pierri (Ley nacional 24.374 / Ley provincial 8932), según la antigüedad de la posesión declarada.

El usuario es Balta, abogado de la Escribanía. No es programador de oficio: las explicaciones van en castellano llano, y los comandos completos, listos para copiar y pegar en una consola de Windows.

## Reglas que no se negocian

- **Datos personales.** El sistema trata nombre, DNI, domicilio y situación posesoria de miles de ciudadanos. Nunca se commitea la base `pierri.db`, los PDF, la carpeta `embudo/`, el padrón, `config.json`, ni el banco de pruebas. El `.gitignore` los excluye; revisarlo antes de cada commit.
- **Versión web.** Con autorización del ministro, el sistema anda desde un link de GitHub Pages (repositorio público aparte, `relevamiento-pierri`), y es el sistema principal: ahí se leen los PDF, se corrigen y se cruzan. Ahí solo va el código que arma `armar_web.js`, sin los ejemplos reales (los comentarios de las reglas salen con los dígitos tapados), y los datos que el propio sitio guarda cifrados: `datos/` en la rama publicada y los PDF originales, cifrados uno por uno, en la rama `pdf`, que no se publica. Nunca se sube nada sin cifrar, y este repositorio sigue sin datos.
- **Claves.** La clave de API va en una variable de entorno, nunca en un archivo del repositorio ni en `config.json` versionado.
- **Nada de normativa inventada.** Si una afirmación jurídica no está respaldada por el texto de la ley, no se escribe. Ante la duda, preguntar.
- **La reglamentación de la Ley 8932 no está dictada.** No afirmar que algo del circuito puede hacerse sin ella.
- **Sin dependencias nuevas** salvo necesidad real. El sistema corre con Node y tres librerías. Sin framework, sin compilación, sin servidor de base de datos.

## Cómo está armado

Node 22.13 o superior, sin framework. Base SQLite en un único archivo, usando el módulo `node:sqlite` incorporado. Servidor HTTP del módulo `http`. El tablero es un solo archivo HTML sin build.

| Archivo | Responsabilidad |
|---|---|
| `pierri.js` | servidor, base de datos, usuarios y sesiones, auditoría, endpoints, importación de lotes |
| `pierri_core.js` | criterio de elegibilidad, departamentos y pedanías, localidades, comparación de lecturas |
| `pierri_texto.js` | reglas de extracción sobre la capa de texto (expedientes, fechas, cuentas, matrículas, tipos) |
| `pierri_lector.js` | lectura de un PDF en Node: capa de texto (pdfjs-dist), carril modelo y Catastro |
| `pierri_tomos.js` | reconocer y cortar tomos, y armar el registro por el carril texto; lo usan el kit y la web |
| `pierri_base.js` | Padrón, inventario, repetidos y correcciones en memoria, con las mismas reglas que las consultas de `pierri.js`; lo usa la web |
| `pierri_sia.js` | la planilla de trámites de la UEST (SIA): lee las columnas que sirven y estima la posesión (ingreso − antigüedad declarada); solo la web |
| `procesar_lote.js` | motor de línea de comandos para carpetas de miles de PDF, reanudable |
| `cruzar_padron.js` | cruce con el padrón del Registro General |
| `web/pierri_web.js` | versión web: hace en el navegador lo que pierri.js (usuarios, cifrado AES-256-GCM, leer PDF, guardar en GitHub) |
| `armar_web.js` | arma el sitio público con el Tablero y `web/pierri_web.js`; saca los ejemplos reales y corta si queda alguno |
| `evaluar_motor.js` | mide exactitud contra resoluciones verificadas a mano |
| `tablero_pierri.html` | el tablero completo: listado, filtros, mapa, expediente, usuarios, auditoría |

Dos carriles de lectura: primero la capa de texto del PDF, que no cuesta nada; solo si no alcanza, se consulta el modelo. Cualquier cambio que empuje más resoluciones al carril modelo tiene costo real por expediente, así que se justifica.

## Cómo se prueba

El cambio en las reglas de extracción se verifica contra el banco de pruebas y contra resoluciones leídas a mano, que viven **fuera del repositorio** porque tienen datos reales:

```bash
node banco_pruebas_texto.js
node evaluar_motor.js --verdad ./verdad.csv --resultados ./salida/resultados.jsonl
```

Un cambio que mejore un caso y rompa otro no es una mejora. La medición a ciegas —resoluciones que el motor no vio antes— es el criterio que vale.

## Estado

En producción incipiente, instalado en un equipo del Gobierno de la Provincia. Pendiente con la Dirección de Sistemas: ambientes, cifrado en reposo, antivirus sobre las cargas, y la excepción documentada al estándar de bases de datos E_SIG_002. Está detallado en `docs/BRECHAS_estandares_gobierno.md`.

La versión web hace todo lo del kit salvo "Volver a leer todo" y "Vaciar la base". El carril modelo en la web se usa **solo con el botón** "Leer con IA las que quedaron sin leer" (nunca al cargar): la clave de API queda solo en la computadora del administrador, cifrada como el token, y las instrucciones del modelo (citan resoluciones reales) se cargan una vez y van cifradas en `datos/modelo.enc`, nunca en el código publicado. Lo completado va en `datos/completadas.enc`. "Controlar con IA" (también solo con el botón, en la lista de Controlar y en Configuración) vuelve a leer con la IA las leídas por texto y compara las dos lecturas con `compararLecturas`, como la doble lectura de `procesar_lote.js`: lo que coincide en posee_desde, cuenta, expediente y resultado queda controlado con IA; lo que no, queda con dudas hasta que alguien elija en la ficha cuál vale (se guarda como revisión, con `vale`). Va en `datos/controles.enc`, con el mismo cuidado que lo completado: lo pagado no se pierde si GitHub no lo guarda y no se paga dos veces. El pedido a la API (`cuerpoModelo`, `respuestaModelo`, `fusionar`) es el mismo en el kit y en la web: vive en `pierri_tomos.js`. La lógica de Padrón e inventario está dos veces: en SQL en `pierri.js` y en memoria en `pierri_base.js`; un cambio en una va en las dos.

El Tablero tiene un menú de cinco entradas: Resumen · Expedientes · Planilla de trámites · Cargar y cruzar · Configuración. Consulta ve las tres primeras, sin botones de acción. Expedientes es una sola pantalla con el interruptor "Lista | Mapa" y una sola barra de filtros; "Cargar y cruzar" reúne las tres cargas (resoluciones en PDF, Padrón del Registro e inventario de digitalizados). Dos funciones del Tablero mandan sobre todo lo que se muestra y no se repiten en otro lado: `certeza(r)` ('estimado' con la planilla, 'leido', o 'controlado' a mano o con IA; es la misma marca en la lista, la ficha, el mapa, el Excel y el KML: punteado, lleno, con tilde) y `proximoPaso(r)` (Conseguir el PDF, Leer, Controlar, Confirmar en el Padrón o Sin pendientes: un solo paso por expediente, y los pasos suman el total). El resultado se dice **Elegible / No elegible**, siempre con la aclaración de que es solo el requisito de antigüedad de la posesión según el criterio configurado; los demás requisitos de la ley se verifican en el trámite. En la web, el criterio (regla, corte y margen del borde) lo fija el administrador para todos y va cifrado en `datos/criterio.enc`; en el kit está en `config.json`.

La planilla de trámites (SIA, `datos/sia.enc`) existe solo en la web. En pantalla se la nombra "planilla de trámites (SIA)", sin afirmar de dónde vino. Cada expediente sin resolución leída aparece con `fuente: 'planilla'` y tipo `PLANILLA_UEST`, con la posesión **estimada** como fecha de ingreso menos la antigüedad declarada al iniciar el trámite. Es una estimación, no lo que fijó la resolución: no presentarla como resultado firme. Cuando se lee la resolución, manda la lectura; `compararConLeidas` mide cuánto acierta la planilla, en dos números que van siempre juntos: en la muestra al azar fija (`enMuestra`: 1 de cada 200 por el número de expediente, sin guardar nada), que es la que vale, y en todo lo leído, que no es al azar. La lista para pedir los PDF (`paraPedir` en el Tablero) va en orden fijo: del borde con la resolución escaneada según el inventario, el resto del borde y la muestra al azar, con la columna "Para qué". No se guardan los testigos, el domicilio del iniciador ni los comentarios.

En diseño, sin implementar: el lector de expedientes completos (cuerpos), para buscar en boletas, facturas, boletos y cesiones indicios de posesión, y el motivo de las bajas de la UEST. Está en `docs/DISENO_lector_expedientes.md`. Sus citas legales están marcadas [T]/[P]/[NV] y hay que cotejarlas con el texto oficial antes de usarlas.
