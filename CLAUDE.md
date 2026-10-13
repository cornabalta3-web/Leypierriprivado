# Contexto para Claude

## Qué es esto

Sistema de relevamiento para la **Escribanía General de Gobierno de la Provincia de Córdoba**. Lee resoluciones en PDF de la Unidad Ejecutora para el Saneamiento de Títulos (Ley 9150) y determina qué expedientes son elegibles para la Ley Pierri (Ley nacional 24.374 / Ley provincial 8932), según la antigüedad de la posesión declarada.

El usuario es Balta, abogado de la Escribanía. No es programador de oficio: las explicaciones van en castellano llano, y los comandos completos, listos para copiar y pegar en una consola de Windows.

## Reglas que no se negocian

- **Datos personales.** El sistema trata nombre, DNI, domicilio y situación posesoria de miles de ciudadanos. Nunca se commitea la base `pierri.db`, los PDF, la carpeta `embudo/`, el padrón, `config.json`, ni el banco de pruebas. El `.gitignore` los excluye; revisarlo antes de cada commit.
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
| `pierri_lector.js` | lectura de un PDF: carril texto (pdfjs-dist) y carril modelo |
| `procesar_lote.js` | motor de línea de comandos para carpetas de miles de PDF, reanudable |
| `cruzar_padron.js` | cruce con el padrón del Registro General |
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
