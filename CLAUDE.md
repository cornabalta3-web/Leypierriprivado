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

La versión web hace todo lo del kit salvo "Volver a leer todo" y "Vaciar la base". El carril modelo en la web se usa **solo con el botón** "Completar incompletas con el modelo" (nunca al cargar): la clave de API queda solo en la computadora del administrador, cifrada como el token, y las instrucciones del modelo (citan resoluciones reales) se cargan una vez y van cifradas en `datos/modelo.enc`, nunca en el código publicado. Lo completado va en `datos/completadas.enc`. El pedido a la API (`cuerpoModelo`, `respuestaModelo`, `fusionar`) es el mismo en el kit y en la web: vive en `pierri_tomos.js`. La lógica de Padrón e inventario está dos veces: en SQL en `pierri.js` y en memoria en `pierri_base.js`; un cambio en una va en las dos.

En diseño, sin implementar: el lector de expedientes completos (cuerpos), para buscar en boletas, facturas, boletos y cesiones indicios de posesión, y el motivo de las bajas de la UEST. Está en `docs/DISENO_lector_expedientes.md`. Sus citas legales están marcadas [T]/[P]/[NV] y hay que cotejarlas con el texto oficial antes de usarlas.
