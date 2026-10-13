# Relevamiento Ley Pierri — cómo se usa

Una aplicación, una pantalla, una base de datos que acumula.

- **pierri.js**: la aplicación. Se abre con un comando y aparece el Tablero en el navegador.
- **El Embudo**: la zona del Tablero donde tirás los PDF, como vengan. Cada archivo cargado queda copiado en la carpeta `embudo`.
- **pierri.db**: la base de datos. Todo lo procesado queda ahí. Se abre con DB Browser for SQLite (gratis) y se copia a otra computadora junto con la carpeta `embudo`.
- **El Padrón**: la planilla del Registro General (`POS_al_….xls`). Se carga desde el Tablero y se cruza sola.

## La forma corta (Windows, doble clic)

1. Instalá Node.js LTS desde https://nodejs.org (siguiente, siguiente, listo).
2. Descomprimí el kit en una carpeta, por ejemplo `C:\pierri`.
3. Doble clic en **1_instalar.bat** (una sola vez). Instala las tres librerías.
4. Doble clic en **2_abrir.bat**. Se abre el navegador con la aplicación. La ventana negra queda abierta mientras la usás.
5. Para que la usen otros desde la red de la oficina: **3_abrir_compartida.bat** en vez del 2, te pide una contraseña y muestra la dirección.

## Instalar a mano (si preferís la terminal)

1. Instalá Node.js versión LTS (22.13 o más nueva) desde https://nodejs.org. Siguiente, siguiente, listo.
2. Creá una carpeta, por ejemplo `C:\pierri`, y descomprimí ahí todo el kit.
3. Abrí una terminal en esa carpeta (clic derecho → "Abrir en Terminal", o escribí `cmd` en la barra de dirección del Explorador) y ejecutá:

```
npm init -y
npm install pdfjs-dist@4.10.38 pdf-lib@1.17.1 xlsx@0.18.5
```

## Usar

```
node pierri.js
```

Se abre el navegador en http://localhost:3777 con el Tablero. Desde ahí:

1. **Tirá los PDF al Embudo.** Uno, tres, o mil; sueltos o tomos. Cada uno se lee y aparece en la lista con su expediente y su clasificación. Un archivo cargado dos veces se ignora; un expediente con dos resoluciones se queda con la más nueva y marca la otra como repetida.
2. **Cargá el Inventario de la UEST** en la pantalla Inventario: el CSV de expedientes digitalizados (de Y-Neura) y, si lo tenés, el del SUAC con iniciador y DNI. Se fusionan solos por número de expediente. Con eso sabés cuántos expedientes hay, cuáles tienen la resolución escaneada y, apretando "Ubicar cuentas en Catastro", dónde está cada lote, antes de leer un solo PDF. Tarda unos minutos la primera vez; si se corta, volvés a apretar y sigue.
3. **Cargá el Padrón** con el botón. Cruza por nombre (solo cuando el nombre es único de los dos lados) y cada resolución queda como inscripta, provisoria, observada, ambigua o "no figura".
4. **Poné la clave de API** en Configuración si querés que las que el texto no pudo leer (escaneos ilegibles, dos rogantes) las lea el modelo. Sin clave, todo lo que el texto resuelve se resuelve igual y gratis; lo demás queda marcado como incompleto. Con "Completar incompletas con el modelo" se leen después.
5. **Mirá y exportá.** Filtros, búsqueda, fecha de corte (recalcula al instante), ranking de localidades, mapa, planilla para Excel, KML para Google Maps.

Para cerrar la aplicación: Ctrl+C en la terminal. La próxima vez, `node pierri.js` de nuevo y está todo como lo dejaste.

## Probar hoy, sin esperar a la UEST

El kit trae `embudo_prueba.zip`: 60 resoluciones inventadas con la plantilla real y cuentas reales de Catastro (sueltas, escaneadas, un tomo, repetidas, desestimatorias, dos rogantes, familias). Descomprimilo y tirá los PDF al Embudo. También podés tirar los tres PDF reales que ya tenés y el Padrón.

## Para lotes enormes desde la línea de comandos (opcional)

Si algún día llegan 10.000 archivos juntos, se pueden procesar sin el navegador con `node procesar_lote.js --dir .\embudo --salida .\salida --key sk-ant-... --doble-lectura 100` (usa el mismo Lector). `--ayuda` muestra las opciones. El resultado (`resultados.jsonl`) se puede abrir en el Tablero en modo archivo (doble clic en `tablero_pierri.html`).

## Si nunca mandan las resoluciones

- Bajarlas del sistema de la UEST aunque sea de a lotes; el Embudo las recibe como vengan.
- Ir por el Padrón y Catastro si el Registro amplía la consulta con DNI o matrícula.
- Un piloto de 100 resoluciones de una sola localidad para probar el circuito completo, incluido el relevamiento presencial, y con eso pedir el resto.

## Archivos

| Archivo | Qué es |
|---|---|
| `pierri.js` | La aplicación (servidor local + base de datos). |
| `tablero_pierri.html` | El Tablero (lo sirve pierri.js; también se abre solo, con un JSONL). |
| `pierri_lector.js` | El Lector: reconoce tomos, lee por texto, manda al modelo lo que falta. |
| `pierri_texto.js` | Carril de texto: reglas sobre la capa de texto del PDF. |
| `pierri_core.js` | Reglas compartidas: elegibilidad, validaciones, Catastro, clasificación, planilla, prompt. |
| `codigos_departamentos_pedanias_cordoba.json` | Códigos oficiales de Catastro. |
| `procesar_lote.js` | Línea de comandos para lotes enormes (opcional). |
| `evaluar_motor.js`, `banco_pruebas_texto.js` | Control de calidad del Lector. |
| `generar_lote_prueba.py`, `parcelas_reales.json` | Generador de lotes de prueba (necesita Python). |
| `embudo_prueba.zip` | 60 resoluciones de prueba con su `verdad.csv`. |
| `SPEC_relevamiento_pierri.md` | Especificación completa, para Claude Code. |

## Compartirla en la oficina

En la computadora donde corre la aplicación:

```
node pierri.js --compartir --clave-acceso UnaContraseña
```

La terminal muestra una dirección tipo `http://192.168.1.25:3777`. Cualquiera en la misma red (wifi de la Escribanía) la abre desde su navegador o celular, entra con usuario `pierri` y esa contraseña, y ve el mismo Tablero, con la misma base. Todo queda dentro del edificio; no pasa por ninguna nube. La computadora tiene que quedar prendida mientras se usa.

## Subirlo a GitHub

Sirve para guardar versiones y trabajarlo con Claude Code, no para que la gente entre. El kit trae un `.gitignore` para que la base, los PDF y la clave no salgan del edificio: `pierri.db`, `embudo/`, `config.json`, `node_modules/`.

## Publicar una copia con clave (GitHub Pages)

Sirve para que la Escribana u otra persona autorizada vea el relevamiento desde cualquier navegador, con un link y una clave. Es una copia de solo lectura: muestra lo que había cuando se armó, no se actualiza sola y no lee PDF.

**Una sola vez:** en el repositorio público `relevamiento-pierri`, entrá a **Settings** y después a **Pages**. En *Branch* elegí `main` y `/ (root)`, y apretá **Save**. El link queda `https://cornabalta3-web.github.io/relevamiento-pierri/`.

**Cada vez que quieras actualizar la copia**
1. Abrí la aplicación (2_abrir.bat). En **Expedientes**, tocá **Guardar JSON**. Se baja `relevamiento_ley_pierri.json` a Descargas.
2. En la consola, dentro de la carpeta del sistema:
   ```
   node publicar.js --json "%USERPROFILE%\Downloads\relevamiento_ley_pierri.json"
   ```
   Te pide la clave dos veces. Tiene que tener 12 caracteres o más; mejor cuatro o cinco palabras sueltas que nadie adivine. Deja `index.html` y `robots.txt` en la carpeta `publicacion`.
3. En el repositorio público: **Add file**, **Upload files**, arrastrás los dos archivos de `publicacion` y apretás **Commit changes**. En un par de minutos el link muestra la versión nueva.
4. Borrá el JSON de Descargas: ese sí está sin cifrar.

**Lo que hay que saber**
- Sin la clave, lo publicado no se puede leer: ni los datos ni el Tablero. El descifrado lo hace el navegador de quien entra, y la clave no viaja a ningún lado.
- La clave se manda por otro medio (en persona, por teléfono), nunca en el mismo mensaje que el link.
- Quien tenga la clave puede guardarse una copia. Cambiar la clave es volver a publicar con otra, pero la versión vieja queda en el historial del repositorio: para cortar el acceso de verdad hay que borrar el repositorio y crear otro.
- Si `index.html` pesa más de 25 MB, la página de GitHub no deja subirlo arrastrando: hay que usar git o GitHub Desktop.

## Cargar miles de resoluciones de una vez

Cuando llega el archivo completo (carpeta con miles de PDF), no se cargan de a una por pantalla. Son dos pasos:

```
node procesar_lote.js --dir C:\resoluciones --salida C:\salida          (solo texto, sin costo)
node procesar_lote.js --dir C:\resoluciones --salida C:\salida --key sk-ant-...   (con el servicio pago)

node pierri.js --importar C:\salida --pdfs C:\resoluciones
```

El primero lee todo (se puede cortar con Ctrl+C y retomar: no repite ni vuelve a gastar). El segundo mete el
resultado en la base **con los PDF**, así se puede abrir cada documento original, corregir a mano y queda el
historial. Después se abre el Tablero con `node pierri.js` como siempre.

Medido en un ensayo con 1.824 resoluciones: 22 segundos el procesamiento y 5 segundos la importación.

## Usuarios y perfiles

La primera vez que arranca, el programa crea el usuario **admin** y muestra su contraseña **una sola vez** en la
ventana negra. Anotala: al entrar te va a pedir cambiarla.

Perfiles:

| Perfil | Qué puede hacer |
|---|---|
| **Consulta** | Ver el relevamiento, el mapa, abrir documentos y exportar. No modifica nada. |
| **Revisión** | Todo lo anterior, más cargar resoluciones y corregir a mano. |
| **Administración** | Todo, más configuración, usuarios y borrar. |

Los usuarios se crean desde **Configuración → Usuarios y perfiles**. Cada uno cambia su contraseña la primera vez
que entra. Ahí mismo está la **auditoría**: quién entró, qué cargó, qué corrigió y qué documentos abrió.

Contraseñas de 12 a 128 caracteres; a los cinco intentos fallidos la cuenta se bloquea 15 minutos. La sesión se
cierra sola a los 30 minutos sin uso.

```
node pierri.js --admin-clave <contraseña>     reinicia la contraseña de admin (primera puesta en marcha)
node pierri.js --compartir --seguro           en red y detrás de HTTPS (servidor institucional)
```
