# Relevamiento Ley Pierri

Sistema que lee las resoluciones de la **Unidad Ejecutora para el Saneamiento de Títulos** (Ley provincial 9150) y determina qué expedientes son elegibles para la **Ley Pierri** (Ley nacional 24.374 / Ley provincial 8932), según la antigüedad de la posesión declarada.

Escribanía General de Gobierno de la Provincia de Córdoba.

---

## Qué hace

1. **Lee** cada resolución en PDF y extrae los datos: número de expediente, rogante, DNI, fecha desde la que se declara la posesión, número de cuenta, matrícula, tipo de documento.
2. **Clasifica** cada expediente como elegible, no elegible, de borde o a revisar, aplicando el criterio de antigüedad de la ley.
3. **Ubica** el inmueble en el mapa, por número de cuenta contra el servicio de Catastro de Córdoba, y por localidad cuando no hay cuenta.
4. **Cruza** con el padrón del Registro General para saber cuáles ya están inscriptas.
5. **Muestra** todo en un tablero local: listado filtrable, mapa, y el expediente abierto al lado de su PDF para corregir a mano lo que haga falta.

Lee primero la capa de texto del PDF, que no tiene costo. Solo cuando el texto no alcanza —resoluciones escaneadas sin capa de texto— consulta un modelo de lenguaje. En las pruebas, la mayoría se resuelve sin costo.

## Requisitos

- **Node.js 22.13 o superior** (usa el módulo SQLite que Node trae incorporado). La versión LTS actual sirve.
- Tres librerías: `pdfjs-dist`, `pdf-lib`, `xlsx`.

No usa framework, ni compilación, ni servidor de base de datos. La base es un único archivo `pierri.db` que se copia como cualquier archivo.

## Puesta en marcha

```bash
git clone <este repositorio>
cd relevamiento-ley-pierri
npm install
node pierri.js --admin-clave "una contraseña larga"
```

Abre el tablero en `http://localhost:3777`. Usuario `admin` con esa contraseña. A partir de la segunda vez alcanza con `node pierri.js`.

En Windows, `1_instalar.bat` y `2_abrir.bat` hacen lo mismo con doble clic.

## Carga masiva

Para miles de resoluciones no conviene el botón de carga del navegador:

```bash
node procesar_lote.js --dir ./resoluciones --salida ./salida
node pierri.js --importar ./salida --pdfs ./resoluciones
```

El primer comando procesa toda la carpeta usando solo la capa de texto. Se puede cortar y retomar: no vuelve a procesar lo ya hecho. El segundo incorpora los resultados a la base junto con los PDF originales, para poder abrir y corregir cada expediente.

Para usar también el modelo donde el texto no alcanza, agregar `--key` al primer comando. La clave va en una variable de entorno, nunca en un archivo del repositorio.

## Opciones

| | |
|---|---|
| `--puerto 3777` | puerto del tablero |
| `--sin-navegador` | no abrir el navegador solo |
| `--compartir` | escuchar en la red local |
| `--seguro` | cookie de sesión marcada como Secure (detrás de HTTPS) |
| `--admin-clave X` | crear o reiniciar el usuario `admin` |
| `--importar` / `--pdfs` | incorporar un lote ya procesado |

## Usuarios y auditoría

Tres perfiles: **administrador** (todo, incluido crear usuarios), **editor** (carga y revisa), **veedor** (solo mira). Contraseñas con scrypt y sal, sesiones con vencimiento por inactividad, bloqueo por intentos fallidos, y registro de auditoría de cada acción.

## Datos personales

El sistema trata datos personales de miles de ciudadanos: nombre, DNI, domicilio y situación posesoria.

**En este repositorio hay solo código.** Nunca se sube la base de datos, los PDF, el padrón, la configuración con claves, ni el banco de pruebas, porque contienen datos reales. El `.gitignore` los excluye; conviene revisarlo antes de cada commit.

## Archivos

| Archivo | Qué es |
|---|---|
| `pierri.js` | la aplicación: servidor, base de datos, usuarios, endpoints |
| `pierri_core.js` | el criterio de elegibilidad, departamentos y localidades, comparación de lecturas |
| `pierri_texto.js` | reglas de extracción sobre la capa de texto del PDF |
| `pierri_lector.js` | lectura de un PDF: carril texto y carril modelo |
| `procesar_lote.js` | el motor de línea de comandos para carpetas grandes |
| `cruzar_padron.js` | cruce con el padrón del Registro General |
| `web/pierri_web.js` | la versión web: el sistema desde un link, con usuarios y datos cifrados en GitHub |
| `armar_web.js` | arma los archivos del sitio público |
| `evaluar_motor.js` | mide la exactitud del motor contra resoluciones verificadas a mano |
| `tablero_pierri.html` | el tablero completo, en un solo archivo |
| `docs/` | entrega técnica, análisis de brechas contra los estándares de gobierno, especificación |

## Estado

En producción incipiente. Probado con 1.824 resoluciones en una prueba de carga (22 segundos, sin errores de lectura) y verificado a ciegas contra resoluciones leídas a mano, sin clasificaciones erróneas.

Pendiente de resolver con la Dirección de Sistemas: ambientes, cifrado en reposo, antivirus sobre las cargas, y la excepción documentada al estándar de bases de datos. Está detallado en `docs/BRECHAS_estandares_gobierno.md`.
