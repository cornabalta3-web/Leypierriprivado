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
- Cargar en la web la planilla de trámites de la UEST (SIA): estima la posesión de cada expediente sin los PDF y arma la lista de cuáles bajar primero.
- Ir por el Padrón y Catastro si el Registro amplía la consulta con DNI o matrícula.
- Un piloto de 100 resoluciones de una sola localidad para probar el circuito completo, incluido el relevamiento presencial, y con eso pedir el resto.

## Archivos

| Archivo | Qué es |
|---|---|
| `pierri.js` | La aplicación (servidor local + base de datos). |
| `tablero_pierri.html` | El Tablero (lo sirve pierri.js; también se abre solo, con un JSONL). |
| `pierri_lector.js` | El Lector: lee el PDF y manda al modelo lo que el texto no resolvió. |
| `pierri_tomos.js` | Reconoce tomos y expedientes y lee por texto. El Lector lo necesita: si se actualiza el kit copiando archivos, va junto con `pierri_lector.js`. |
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

## La versión web: el sistema desde un link

El sistema también anda desde **https://cornabalta3-web.github.io/relevamiento-pierri/**, sin instalar nada. Cada persona entra con su usuario y su contraseña. Los datos se guardan cifrados en el repositorio público `relevamiento-pierri`: sin una contraseña válida no se pueden leer.

En la web se hace todo lo del kit salvo "Volver a leer todo" y "Vaciar la base". Se leen los PDF, se guardan cifrados junto con el original, se ven, se corrigen, se cargan el Padrón, el inventario y Catastro, y lo que el texto no alcanza a leer se completa con el modelo, solo cuando se toca el botón.

**Puesta en marcha (una sola vez)**
1. En GitHub: botón **+**, **New repository**, nombre `relevamiento-pierri`, **Public**, **Create repository**.
2. Subir los archivos del sitio: `index.html`, los `.js`, `localidades_cordoba.json`, la carpeta `vendor/` (el mapa, el lector de PDF y el de planillas), `robots.txt` y `.nojekyll`. Los arma `node armar_web.js --salida <carpeta>`; normalmente los sube Claude.
3. En el repositorio: **Settings**, **Pages**, *Branch* `main` y `/ (root)`, **Save**.
4. Crear el permiso para escribir (token): en GitHub, tu foto, **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
   - Nombre: `relevamiento-pierri`. Vencimiento: un año.
   - *Repository access*: **Only select repositories**, `relevamiento-pierri`.
   - *Permissions*, *Repository permissions*, **Contents: Read and write**.
   - **Generate token** y copiarlo (empieza con `github_pat_`).
5. Abrir el link. Como está vacío, pide crear el administrador: usuario, nombre, contraseña y el token. El token queda guardado en esa computadora.

**Usuarios** (solo el administrador; hay uno solo): **Configuración**, **Usuarios y perfiles**.
- *Crear usuario*: usuario, nombre, perfil (Consulta o Revisión) y contraseña. La contraseña la definís vos y se la pasás a la persona por un medio seguro.
- *nueva contraseña*: se la cambia. En tu propia fila, te cambia la tuya.
- *desactivar*: su contraseña deja de servir. Los datos se vuelven a cifrar con una llave nueva y, si la persona tenía la sesión abierta, queda afuera.
- *activar*: pide una contraseña nueva; la vieja no vuelve a servir.
- Después de cada cambio, GitHub tarda unos minutos en publicarlo: recién ahí vale para la persona. Hacé los cambios de a varios juntos si podés, porque GitHub limita las publicaciones a unas diez por hora.

**El permiso de GitHub (token)** queda guardado solo en tu computadora, cifrado con tu contraseña, nunca en el repositorio: adivinar tu contraseña permitiría leer, pero no escribir. Para usar otra computadora, o cuando el token vence: **Configuración**, **Permiso de GitHub**, pegarlo y **Guardar en esta computadora**. En una computadora prestada, al terminar: **Olvidar** y **Cerrar sesión**.

**Cargar resoluciones desde la web** (solo el administrador)
1. **Cargar** (el Embudo): arrastrar los PDF, tocar para elegirlos o, si son muchos, **Elegí la carpeta entera**.
2. Cada PDF se lee en tu computadora, igual que en el kit sin clave de API: tomos, expedientes completos y sueltas. Se guarda en GitHub cifrado, el PDF original incluido, cada 250 archivos (o 60 MB) y al terminar. Lo que ya estaba se saltea: si se corta, se vuelve a elegir la misma carpeta y sigue.
3. Con miles de PDF tarda (más o menos un segundo por archivo, según la conexión): la pestaña tiene que quedar abierta, pero la sesión no se cierra mientras trabaja. Si GitHub pide una pausa por la cantidad de pedidos, espera solo y sigue.
4. Las escaneadas sin capa de texto quedan como "no se pudieron leer del todo". Cargar nunca usa el modelo: se completan después, con el botón (ver abajo).

**Ver y corregir**
- En **Expedientes**, al abrir una resolución: **Ver la resolución original** la muestra al costado, solo sus páginas. La ven todos los usuarios.
- La caja **Revisada** (solo el administrador): tilde, fecha de posesión corregida, tipo, quién y observación. Se guarda al instante y queda en la auditoría.

**Lectura con el modelo** (solo el administrador, en **Configuración**, recuadro **Lectura con el modelo**)
1. Una sola vez: **Cargar instrucciones del modelo** con el archivo `instrucciones_modelo.json` (lo arma `node armar_web.js --instrucciones <archivo>` en el kit; normalmente te lo pasa Claude). Las instrucciones citan resoluciones reales: se guardan cifradas, y después hay que borrar el archivo.
2. Pegar la clave de API de Anthropic y **Guardar**. Queda solo en esta computadora, cifrada con tu contraseña; no va al repositorio. Para dejar de usarla: borrar el campo y **Guardar**.
3. **Completar incompletas con el modelo**: antes de empezar dice cuántas va a leer y pide confirmación, porque gasta tokens. Lee solo las que el texto no resolvió y tienen su PDF guardado. Nada más usa el modelo: ni cargar PDF ni mirar.

**Padrón, inventario y Catastro**: los mismos botones que en el kit (**Padrón**, **Inventario**, **Reintentar Catastro** en el Mapa). Se guardan cifrados y el cruce se calcula al mirar, así que una carga nueva de resoluciones ya sale cruzada.

**La planilla de trámites de la UEST, sin los PDF** (solo en la web; la carga solo el administrador)
1. **Inventario**, recuadro **Planilla de trámites de la UEST (SIA)**, **Cargar planilla de trámites (.xlsx)**. Una planilla de 50.000 expedientes tarda alrededor de un minuto. Se guarda cifrada y solo con lo que sirve: no se guardan los testigos, el domicilio del iniciador ni los comentarios. Cargar una nueva reemplaza a la anterior.
2. Cada expediente aparece en **Expedientes**, el **Mapa** y el **Resumen** con la posesión **estimada**: fecha de ingreso del trámite menos la antigüedad declarada al iniciarlo. Es lo que se declaró al empezar, no lo que fijó la resolución: puede no coincidir. Se distinguen con el filtro **Estimadas con la planilla**; las leídas, con **Leídas del PDF**.
3. **Ubicar las parcelas en Catastro**: consulta las cuentas de a 2.000 y guarda cada tanda. Con toda la planilla son unas 34.000 cuentas y tarda varios minutos; si se corta, se vuelve a tocar y sigue donde quedó. Las que no tienen cuenta se ubican aproximadamente por la localidad.
4. El Padrón cruza también estos expedientes, por el nombre del iniciador.
5. **Bajar la lista para pedir los PDF**: un CSV, sin nombres ni DNI, con los anteriores al corte según la planilla; primero los que quedan en el borde, que es donde la resolución puede cambiar el resultado. Sirve para elegir qué bajar cada día cuando hay límite de descargas.
6. Cuando se lee la resolución de un expediente de la planilla, manda la lectura y la estimación deja de aparecer como expediente aparte. La tarjeta **¿Cuánto acierta?** compara, en los expedientes que tienen las dos cosas, si la planilla y la resolución coinciden en si entra o no. Antes de usar la estimación para decidir, conviene que esa comparación tenga un número razonable de casos.

**Si algo ya está en el kit**
- **Subir el relevamiento del kit**: en el kit, **Expedientes**, **Guardar JSON**; en la web, **Cargar**, arrastrar ese JSON solo. Después borrar el JSON de Descargas: está sin cifrar.
- Subir el JSON del kit reemplaza lo que vino del kit, pero no toca lo leído en la web ni las correcciones hechas en la web: se aplican encima (si una misma resolución se corrigió en los dos lados, manda la corrección más nueva).
- Para ver en la web los PDF de lo que leyó el kit, subí esos PDF en **Cargar**: se reconocen, no se vuelven a leer y se guardan para verlos.

**Lo que hay que saber**
- La contraseña de cada uno es la única protección de la lectura: 12 caracteres o más, mejor una frase larga. No hay bloqueo por intentos fallidos, porque cualquiera puede bajarse los archivos cifrados y probar contraseñas en su propia computadora.
- Desactivar a alguien, cambiarle la contraseña o cambiar la tuya le corta el acceso a todo lo que se guarde desde ese momento. Las versiones anteriores siguen en el historial del repositorio, cifradas con la llave vieja: con la contraseña vieja se podrían abrir. Para borrar el historial hay que borrar el repositorio, crearlo de nuevo y repetir la puesta en marcha.
- En el repositorio público no aparece ningún nombre de usuario: la lista de usuarios está cifrada y solo la abre el administrador.
- La sesión vive solo en la página abierta: al recargar o cerrar la pestaña hay que volver a ingresar. No queda nada guardado en el navegador salvo el token, cifrado.
- La sesión se cierra sola después de 30 minutos sin uso.
- El botón **Modo oscuro** (abajo en el menú) cambia los colores; sin tocarlo, sigue la configuración de la computadora. Vale igual en el kit.
- Todos los sitios de GitHub Pages de la cuenta `cornabalta3-web` comparten la dirección `cornabalta3-web.github.io`, y con ella el almacenamiento del navegador. Por eso el token va cifrado. Aun así, conviene no publicar en esa cuenta páginas con código de terceros.
- Los PDF van en una rama aparte del repositorio (`pdf`), que no se publica en la página: cada uno cifrado con su propia llave, y esas llaves viajan dentro de las lecturas cifradas. Al desactivar a alguien no se vuelven a cifrar los PDF (pesan gigas); sí todo lo demás, con las llaves adentro. Lo que esa persona ya pudo ver, lo pudo ver.
- GitHub recomienda repositorios de menos de 1 GB y pide con fuerza no pasar de 5 GB. Unos 7.500 PDF de 300 KB cada uno son unos 2,3 GB: entra, pero no sobra. Si algún día GitHub pide achicarlo, los PDF se pueden mover a otro repositorio sin tocar el resto.
- Cada carga y cada cambio de llave agregan al historial una copia del relevamiento cifrado. Con unos pocos MB por carga alcanza para años; si algún día el repositorio pesa demasiado, se recrea. La planilla de trámites cifrada pesa unos 3 MB, y ubicarla entera en Catastro suma unos 40 MB al historial (cada tanda guarda las parcelas de nuevo).

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
