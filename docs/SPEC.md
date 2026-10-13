# Relevamiento Ley Pierri — especificación

> **Para retomar en un chat nuevo:** leer primero la sección 0. Resume el estado al 20/09/2026, qué está hecho,
> qué está verificado con documentos reales y qué falta. El resto del documento es el detalle histórico de cada
> decisión. Autor del sistema: Baltasar Corna Fantin, Escribanía General de Gobierno de Córdoba.

## 0. Estado al 20/09/2026

**Qué es.** Una aplicación local (Node ≥ 22.13, sin frameworks) que lee resoluciones de la Unidad Ejecutora para
el Saneamiento de Títulos (Ley 9150), extrae la antigüedad de la posesión, y clasifica cada expediente como
elegible o no para la Ley Pierri (24.374 / 8932). Se abre con `node pierri.js` → http://localhost:3777.
Base SQLite `pierri.db`; copia de cada PDF en `embudo/`; configuración en `config.json`.

**Archivos.** `pierri.js` (servidor + base), `pierri_lector.js` (lectura de PDF, cortador de tomos y expedientes),
`pierri_texto.js` (reglas sobre el texto), `pierri_core.js` (elegibilidad, Catastro, clasificación, planilla),
`tablero_pierri.html` (la interfaz; se ensambla embebiendo `pierri_core.js`, la tabla de códigos y el GeoJSON de
departamentos). `banco_pruebas_texto.js`: **14/14 casos pasan** — correrlo después de tocar cualquier regla.

**Pantallas.** Filtro Ley Pierri (carga) · Inventario UEST · Resumen · Expedientes · Localidades y mapa ·
Padrón del Registro · Configuración.

### Criterios vigentes (decisiones de Balta, no cambiar sin consultarlo)
- **Corte:** posesión iniciada antes del 1/1/2006 (Ley 24.374 actualizada). Alternativa conmutable: plazo móvil de
  10 años (proyecto PE-13/26 con media sanción). Margen de "borde": 12 meses, marcado pero no decidido solo.
- **Qué se evalúa:** lo que define la elegibilidad es la fecha de posesión, NO el rótulo de la resolución. Se
  evalúan las de inscripción, **rectificatorias y ampliatorias**. Solo **desestimatorias y cancelaciones** son
  NO_APLICA (el trámite no prosperó). Decisión del 20/09 a partir del caso real 0535-004538/2004.
- **Tipo de documento:** si el texto contiene "ORDENAR … Registro Personal de Poseedores", es de inscripción aunque
  otro artículo diga AMPLIAR o RECTIFICAR primero.
- **Un expediente, una resolución:** un expediente individual trae varias resoluciones (de trámite, rectificatorias,
  desestimatorias de oposiciones). Se conserva UNA: la que ordena la inscripción; empate → la última del documento.
  El expediente se toma del nombre del archivo del sistema (`documento_0535-004490-2004_<hash>.pdf`); así los
  bloques sin número legible y el número del plano de Catastro (0033-…, 0587-…) no se toman como otros expedientes.
- **Un bloque es resolución** solo si tiene parte dispositiva (RESUELVE, PROTOCOLÍCESE, ORDENAR, DESESTIMAR,
  ARTÍCULO 1). El resto son fojas de cuerpo y se descartan.
- **No inventa:** si no puede leer un dato, lo marca y lo deja pendiente. Nunca completa por inferencia.

### Funciones agregadas del 18 al 20/09 (todas verificadas)
- **Ver la resolución original** (`GET /api/documento?id=`): abre el PDF; si vino dentro de un expediente o tomo,
  recorta solo sus páginas.
- **Revisión manual** (`POST /api/revision`): tilde "revisada", corrección de la fecha de posesión, corrección del
  tipo de documento, quién revisó y observación. Columnas propias en `resoluciones` (revisado, revisado_en, revisor,
  nota, correccion). Lo corregido a mano manda sobre lo leído y sobrevive a la relectura.
- **Volver a leer todo** (`POST /api/releer`): relee los PDF guardados con el código actual. Hay que REINICIAR el
  programa antes, porque Node conserva en memoria la versión vieja de los módulos.
- **Completar con el modelo por lotes** (`POST /api/completar?maximo=5`): de a cinco, con avance visible. Antes
  procesaba todo de un saque y parecía colgado.
- **Mapas:** base Esri (CARTO empezó a exigir clave y estampaba "API KEY REQUIRED"). Departamentos oficiales de
  IDECOR (`idecor:departamentos`, 26, simplificados a 51 KB) sombreados en los dos mapas: en Inventario por
  expedientes con resolución, en Localidades por elegibles. Emparejamiento de nombres: `Gral.`→`General`,
  `Pte.`→`Presidente` (los 26 coinciden).
- **Resumen rediseñado:** una cifra protagonista (elegibles de N) con barra y escenario de la reforma; a la derecha
  cuatro tareas pendientes clicables (sin revisar, no se pudieron leer, no figuran en el Registro, sin ubicar).
  Los números de cada tarjeta cuentan exactamente lo mismo que la lista a la que llevan.
- **Filtros agrupados** en tres bloques: Elegibilidad, Lectura (por texto / con el modelo / no se pudieron leer),
  Control manual. Paginación con números.
- **Padrón:** la inscripción se guarda también en el derivado (antes el Tablero la buscaba en otro lugar y mostraba
  todo en cero). La planilla trae filas repetidas: 8.021 filas, 7.946 únicas; se deduplica. Carga en transacción
  con rollback.
- **Autoría:** "Desarrollado por Baltasar Corna Fantin" en el pie del Tablero, metadatos del HTML, encabezado de
  cada módulo, JSON y KML exportados. Hacerlo en todo entregable nuevo, de forma discreta.
- **Logo** de la Escribanía General de Gobierno en la barra lateral. Falta el de Fiscalía de Estado (pedido a Balta).

### Casos reales que rompieron reglas (y quedaron en el banco de pruebas)
- **0535-004538/2004** (Martínez María Rosa, Valle Hermoso, Punilla): art. 1 AMPLIAR la Res. 214/2017, art. 2
  ORDENAR la inscripción. Frase "es 10 años, al 03/06/2004" (sin "de", con coma). Se clasificaba como rectificatoria
  y no leía la fecha. Corregido: elegible desde 1994-06-03. El DNI difiere entre páginas (12.406.369 y 5.215.599):
  error del documento original.
- **0535-004490/2004**: expediente completo de 22 páginas con varias resoluciones; tomaba 3. Corregido: toma 1.

- **0535-102520/2013** (Piedrabuena, Córdoba Capital): la ubicación viene como "Localidad: Córdoba, Departamento:
  Capital" (con dos puntos) y las reglas solo aceptaban "Localidad Villa de Soto". Toda esa familia de documentos quedaba
  "sin localidad". Corregido: se aceptan las dos formas, "DPTO. X" y "Barrio: Y". Además, sin número de cuenta el
  departamento y la pedanía se toman del texto (geo.origen_ubicacion = 'texto'). El BARRIO se toma solo de la
  descripción del inmueble ("ubicado en…"), nunca del domicilio del rogante (en Farias el primer barrio era el domicilio).
- **0535-002891/2004**: el archivo contiene una CÉDULA DE NOTIFICACIÓN de otro expediente (0535-007083/2004, Bustos
  Gerónima Ignacia), de una resolución de trámite (aprueba la presentación y emplaza a presentar plano). Tipo nuevo
  CEDULA_NOTIFICACION → NO_APLICA y no va al modelo. El número venía con un dígito ilegible ("053^-007083"): se lee con una
  regla tolerante y se avisa que el documento es de otro expediente (posible error de archivo en Y-Neura).

- **0535-077105/2006** (Fernández López, Salsipuedes, Colón): la localidad viene como "Pueblo Salsipuedes" / "Lugar Villa
  La Selva" y la antigüedad AL REVÉS ("al 23/10/2006 es de 5 años"). Además, el arreglo del caso anterior (reglas sin
  distinguir mayúsculas) hizo leer "Municipalidad o Comuna que corresponda" (art. 3°) como localidad: REGRESIÓN corregida.
  Ahora la localidad se busca en la descripción del inmueble ("ubicado en…") con sinónimos (Localidad, Pueblo, Ciudad de,
  Lugar, Paraje); fuera de esa zona solo "Localidad" con mayúscula. Nueva regla RE_ANIOS_INV.
- **Interfaz (20/09):** "No figura" pasó a decir **"No inscripta"** en toda la pantalla (el código interno sigue siendo
  NO_FIGURA_EN_PADRON). Los filtros ahora se **combinan**: uno por grupo (Elegibilidad, Lectura, Control manual) y se
  suman; tocar de nuevo uno activo lo apaga (estado `F = {elig, lect, ctrl}`). Cada tanda de carga muestra un **balance**
  (archivos leídos, ya cargados, sin resolución, con error; resoluciones nuevas; cuántas eran de un expediente ya cargado),
  que explica por qué N archivos no dan N expedientes.

- **Mapa sin puntos (20/09):** las coordenadas salen de Catastro por número de cuenta, y muchas resoluciones solo traen
  matrícula. Catastro NO permite buscar por matrícula (la capa idecor:parcelas no tiene ese campo). Solución: ubicación
  APROXIMADA con los puntos de localidades de Catastro (idecor:localidad_punto, 551 → `localidades_cordoba.json`, 31 KB,
  nombres sin paréntesis y desempate por departamento). Queda en `geo.ubicacion_aproximada = 'localidad'` y el mapa la
  dibuja como anillo punteado, con el aviso en el cartel. Se aplica al cargar, al recalcular y al mostrar (/api/datos).
- **"Cargué 59 y veo 19":** nuevo informe `GET /api/archivos` y panel "Qué aportó cada archivo" en Filtro Ley Pierri:
  por archivo, qué expediente suma, cuál era del mismo expediente que otro (y cuál se conserva), cuáles no traen ninguna
  resolución (solo cuerpo) y cuáles fallaron. Los archivos idénticos no se guardan dos veces (balance de la tanda).

- **Lote real de 12 resoluciones (21/09), 2004–2025.** Antes de corregir: 9/12 bien clasificadas, 0 mal clasificadas
  (3 quedaban sin fecha). Errores encontrados y corregidos: frases "es de MÁS DE 20 años al…", "DATA DEL AÑO 1.993"
  (año con punto) y "data del año 1997, es decir 26 años al 07/2023"; cuentas con formatos 35-04-1652997-4,
  11-01-18456-335, 230321507200 y 2101-0.443.364/7; y un error grave: en dos casos tomaba la CUENTA DE UN VECINO
  ("linda con Parcela 025 … cuenta N°"). Regla: la cuenta pegada a la matrícula afectada se respeta siempre; "Resto de
  Parcela X … cta" es la parcela afectada (vale); "linda con Parcela X … cuenta" es un vecino (no vale).
  Nuevo: ROGANTE_PERSONA_JURIDICA (Municipalidad de Laboulaye, CUIT 30-…): la ley es para personas humanas. Localidad con
  una o dos letras mal escaneadas ("General Levaile") se encuentra dentro del mismo departamento.
  OJO: después de corregir sobre estos mismos documentos, 12/12 NO es una medición: el acierto real se mide con documentos
  que el sistema no haya visto. El banco de pruebas ahora verifica también la fecha de posesión (antes solo el tipo).

- **PRIMERA MEDICIÓN A CIEGAS (21/09), 12 documentos que el sistema no había visto, sin tocar el código antes:**
  de 8 que ordenan inscripción con antigüedad declarada, 6 bien clasificadas, 2 sin fecha, 0 equivocadas; de 4 que no
  ordenan inscripción (aprueban y emplazan, suspenden, cédulas), 4 bien. Total 10/12 correctas, 2 a revisar, 0 errores.
  Las 2 fallas: fechas en palabras ("al mes de febrero de 2010", "al 11 de junio del año 2008"). Corregido después con
  `fechasEnPalabras` (también "al 07/2023"). Nuevo tipo RESOLUCION_TRAMITE (APROBAR formalmente / EMPLÁCESE / SUSPÉNDASE):
  NO_APLICA y no va al modelo. PENDIENTE DE CRITERIO: algunas de trámite declaran antigüedad vieja (0535-003059/2004,
  "55 años en la posesión invocada"); son expedientes 9150 detenidos cuyos poseedores podrían ser candidatos a Pierri.
  En pantalla, "Con el modelo" pasó a "Revisadas por el modelo". Banco: 23/23.

### Números del inventario (verificados contra el CSV, no estimados)
Universo 49.668 (Y-Neura) · digitalizados 35.096 · con resolución escaneada 7.082 (6.891 solo resolución + 191
resolución y cuerpo) · con cuenta válida 28.312 · **sin cuenta válida pero con resolución: 3.077** (el Lector
recupera la cuenta del texto de la resolución; NO 3.688, que son casi todos sin resolución). Regla de separación:
"solo resolución" tiene 0 hojas en 6.889 de 6.891; "solo cuerpo" tiene 6 o más en los 27.441.
**Cuidado con cómo se presenta la distribución por departamento:** en PORCENTAJE el noroeste tiene más expedientes con
resolución escaneada (Tulumba 61 %, Minas 59 %, Ischilín 53 %, Cruz del Eje 42 %; Capital 14 %), pero en CANTIDAD la que
más tiene es Capital (≈1.100, contra 756 de Cruz del Eje). NO decir que "lo digitalizado se concentra en el noroeste":
es falso en cantidad, y Balta lo marcó como invención el 20/09. Además es metadato de la planilla de Y-Neura, no de los
documentos: los archivos todavía no los tenemos. El pedido es acceso a los archivos, resoluciones Y expedientes.

### Fase 2 — Sistema Ley Pierri (SLP), presentación al ministro del 22/09/2026
Archivo: `Sistema_Ley_Pierri_presentacion.html` (generador `armar_slp.py`), autónomo, recorrido guiado de 9 pasos, mismo
diseño que el Tablero. Abre el relevamiento (`Ley_Pierri_demostracion.html`, misma carpeta) desde un botón.
Guía: `Guia_presentacion_Sistema_Ley_Pierri.pdf`. TODO lo del SLP es PROPUESTA con rótulo visible; solo el relevamiento existe.
Decisiones de Balta (21/09): cuatro etapas sobre la "etapa cero" (el relevamiento). 1) Solicitud: dos puertas —los que ya tienen
expediente 9150 NO inician nada, el Estado los busca y ven su situación en CiDi; los que no, piden adhesión por CiDi (si no
cumplen Pierri, siguen por 9150); municipios como cara presencial (ventanilla, documentación, relevamiento con universidades,
acto de firma). 2) Unidad Ejecutora verifica requisitos (antigüedad, causa lícita, vivienda única, no otro inmueble,
identificación/plano); relevamiento social por convenio con universidades. 3) Escribanía, dentro de SIIGENO (módulo, pero
sistema aparte): antecedentes Registro+Catastro interconectados, citación al titular + edictos 30 días (art. 6 Ley 24.374),
escritura de regularización, inscripción; el Registro informa de vuelta. Convenio con el Colegio de Escribanos si no da
abasto. 4) Consolidación automática a los 10 años (art. 8). Sin definir: planos (quién paga), oposición del titular,
capacidad de escrituras/mes (él estima 50+), presupuesto, autoridad de aplicación de la 8932. Dueño del sistema: la
Escribanía, compartido con la Unidad. IMPORTANTE (Balta, 21/09): la Unidad Ejecutora es mucho más grande y compleja de lo que
parece y él la conoce poco; la etapa 2 se presenta como "la define la Unidad con la reglamentación", con requisitos
ilustrativos; la parte de la Escribanía es la escritura. No presentar nunca a la Escribanía diseñando el trabajo de la Unidad.
CORRECCIÓN (Balta, 21/09): SIN REGLAMENTACIÓN NO SE PUEDE HACER NADA. No decir nunca "esto se puede hacer sin reglamentación".
El pedido 3 pasó a ser: que la EGG y la Unidad participen en el diseño de la reglamentación.
PROTOTIPO FUNCIONAL (vista "prototipo" del SLP, `prototipo.py` + `casos_prototipo.json`): 4 expedientes reales del
relevamiento (Villarreal 111653/2022, Frasno 108540/2019, Piedrabuena 102520/2013, Sánchez 108460/2019) atraviesan el
circuito con botones: incorporar → notificar por CiDi → Unidad (relevamiento social, consulta al Registro) → Escribanía
(citación + edictos con plazo de 30 días, borrador de la ESCRITURA DE REGULARIZACIÓN generado con los datos del expediente,
con corchetes para lo que define la reglamentación) → inscripción → consolidación a 10 años. Es "el avance del sistema". Pedido al ministro: (1) que la EGG tenga a cargo el SLP vinculado a la Unidad, (2) que
la reglamentación contemple el circuito, (3) autorizar lo que se puede sin reglamentación (archivos, servidor, interconexiones).

### Correcciones de Balta para las demos del ministro (21/09/2026, noche)
- SIN AUTORÍA en las demos, guías y carilla (se conserva solo en el programa instalado).
- El relevamiento NO está hecho: "la herramienta está desarrollada y probada con resoluciones reales; el relevamiento
  completo está pendiente; una vez cumplimentado será el paso cero". Rótulo verde: "Herramienta desarrollada ·
  relevamiento pendiente". Nunca "existe", "funcionando" ni "está hecha".
- La reglamentación se nombra SIEMPRE "propuesta de reglamentación" (no "borrador"). Aplicado del texto en estudio
  (resumen de artículos del chat del 30/06): UEST autoridad de aplicación; validez de actuaciones de la 9150; tope de
  valuación fiscal; verificación parcelaria o mensura de posesión; emplazamiento por todos los medios incluido domicilio
  electoral; cautelares suspenden, deudas tributarias no; conformidad del titular → escritura directa; tramitación
  electrónica con excepción para vulnerables; contribución 1% del valor fiscal, cuotas; ESCRITURA DE CONSOLIDACIÓN a los
  10 años y emplazamiento de oficio por la Unidad (la etapa 4 ya no es "automática"); convenios; implementación gradual.
  Pendiente: tener el .docx original para verificar texto exacto.
- "Por primera vez en el mapa" → "Georreferenciación de los expedientes de la UEST".
- DATOS DE LA DEMO: antes eran 415 resoluciones de las que solo 4 eran reales. Ahora SOLO REALES: 30 (17 elegibles,
  7 no elegibles, 5 no aplican, 1 a revisar), generadas con `armar_datos_reales.js` → `demo_reales.json`. El paso 4 del
  recorrido toma las cifras de los datos. Balta cree que en su programa instalado hay unas 60 leídas y 27 elegibles
  (no verificado por mí).
- Recorridos: "Salir" deja un botón "Continuar el recorrido · paso N" y "Desde el principio".
- Diapositivas (artifact C1GJj2EboaH9MnU1FrjYAF) y brief: NO actualizados con estas correcciones (Balta no las usa).

### Ajuste contra el texto de la ley (21/09/2026, Balta pegó art. 6 Ley 24.374 y arts. 10–11 Ley 8932)
- CONSOLIDACIÓN (art. 10, Ley 8932): el beneficiario la SOLICITA; la Unidad verifica plazo y que no haya litis anotada y,
  por RESOLUCIÓN FUNDADA, ordena al REGISTRO GENERAL la consolidación definitiva. NO hay escritura de consolidación y la
  Escribanía NO interviene. (La "escritura de consolidación" venía del documento conceptual de junio: era un error.)
- SOLICITUD (art. 6 inc. a): aun con expediente 9150, la persona firma su solicitud de acogimiento y su DDJJ.
  Fórmula: "no empieza de cero: encuentra su solicitud armada y solo la confirma y firma". El formulario pide medidas,
  linderos, superficie y datos catastrales.
- OPOSICIÓN: incs. f (interrumpe), g (saldo de precio o impugnaciones: NO interrumpe) y h (consentimiento del titular →
  escrituración por derecho común, el caso sale del circuito Pierri).
- PLANOS (inc. c): en la etapa de la Escribanía, solo si faltan antecedentes dominiales y catastrales.
- DESESTIMACIÓN (inc. b): la Unidad puede desestimar; falseamiento → rechazo sin más trámite. Está en el prototipo.
- FIRMA (inc. e): el interesado y la autoridad de aplicación; en el acto de firma hay alguien de la Unidad. La escritura
  hace constar que corresponde a la Ley 24.374.
- Art. 11, Ley 8932: reglamentación en 30 días (sigue pendiente) y posibilidad de autorizar a otras reparticiones a
  emitir instrucciones → usado en los pedidos 1 y 2.

### Segunda medición a ciegas (22/09): lote de 7 resoluciones, sin tocar el código antes
0535-004138/2004, 111676/2022, 089076/2008, 089143/2008, 079843/2007, 083208/2007, 082298/2007.
**7 de 7 bien clasificadas, 0 errores, 0 sin leer.** Acumulado de mediciones a ciegas: 19 de 19 documentos sin ningún
error de clasificación (12 + 7), con 2 que en su momento quedaron sin fecha y se corrigieron después.
Seis de las siete no traen número de cuenta (solo matrícula o folio): no es una falla del lector.
ÚNICO ARREGLO: localidad compuesta que no figura en la tabla ("Vertientes de la Granja"); ahora se busca la localidad
contenida más larga dentro del mismo departamento ("La Granja", Colón) y queda marcada como ubicación aproximada.
Con la consulta a Catastro, la única que trae cuenta (111676/2022, Meló) cae en su parcela exacta.

### Ensayo de carga masiva e IMPORTADOR (22/09/2026)
Ensayo con 1.408 PDF (1.824 resoluciones, 2 tomos, repetidas, un PDF ajeno): procesamiento en 22 s, 0 errores,
1.652/1.653 cuentas ubicadas en Catastro; corte y reanudación sin duplicar ("ya procesados: 1408, a procesar: 0" en 1 s).
Tablero con 7.100 expedientes simulados: carga 0,6 s, mapa de 6.400 puntos 0,3 s, filtros/búsqueda 0,3 s, 48 MB.
HUECO DETECTADO Y RESUELTO: el resultado del lote no entraba a la base. Nuevo comando:
`node pierri.js --importar <carpeta de salida> --pdfs <carpeta de los PDF>` — inserta los registros, copia los PDF al
embudo (calcula hash_archivo del propio PDF, quitando el sufijo "#pX-Y" de los tomos), rehace repetidos, padrón,
localidades y recálculo, y es reanudable (saltea lo ya importado). Medido: 1.829 registros y 1.404 PDF en 5 s.
Verificado: abrir el documento original de un elegible funciona, y en los tomos recorta solo sus páginas.
También se corrigió generar_lote_prueba.py, que fallaba en equipos sin el idioma español de tesseract.

### Usuarios, perfiles y auditoría + mapa oficial (23/09/2026)
- MAPA: se reemplazó el fondo de Esri por capas del **IGN Argentina** (`wms.ign.gob.ar`, TMS, `capabaseargenmap` y
  `mapabase_gris`, sin clave ni costo); las parcelas siguen viniendo de IDECOR. Solo queda Esri como capa satelital
  opcional. Leaflet no cobra por cantidad de puntos (probado con 6.400).
- USUARIOS (E SIG 004 nivel 2): tablas `usuarios`, `sesiones`, `auditoria`. Contraseñas 12–128 con scrypt+sal,
  bloqueo a los 5 intentos por 15 min, sesión con token de 32 bytes, inactividad 30 min, máximo 12 h, cookie
  HttpOnly/SameSite=Strict (+Secure con `--seguro`). Tres perfiles: veedor (ver/exportar), editor (+cargar/revisar),
  admin (+config/usuarios/vaciar). Permisos verificados en el SERVIDOR (mapa `PERMISOS`), la pantalla solo acompaña.
  Primer arranque: crea `admin` y muestra la contraseña una sola vez; `--admin-clave` la reinicia.
  Endpoints nuevos: /api/login, /api/logout, /api/yo, /api/clave, /api/usuarios (GET/POST), /api/auditoria.
  Validación de subida: máximo 80 MB y firma %PDF- obligatoria.
  En el Tablero: pantalla de ingreso, cambio de clave obligatorio la primera vez, pie con usuario y perfil,
  panel "Usuarios y perfiles" y "Auditoría" en Configuración, y botones ocultos según permisos.
- PENDIENTE de este bloque: secretos fuera de config.json (variable de entorno), respaldo automático, cifrado en
  reposo, ambientes y SAST (dependen de Sistemas).

### Pendiente
- **Los 7.082 PDF.** Los tiene Ypsilon; Irene los lleva en un disco a Facundo Álvarez (director de sistemas del
  Ministerio). Es el único bloqueo de fondo.
- **Piloto de 100** resoluciones repartidas por año (25 de 2004–2010, 25 de 2011–2016, 25 de 2017–2021, 25 de 2022+)
  y 20 expedientes individuales. Revisar con "Ver la resolución original" y medir el acierto real. Hasta entonces
  no prometer porcentajes.
- **Export del SUAC de los digitalizados** (iniciador y DNI de los 35.096): convierte el cruce con el Padrón de
  "por nombre" a exacto.
- **Servidor institucional** para que la Unidad acceda en línea. No usar nubes privadas: son datos personales.
- **Criterios a definir con Irene/Amelia:** casos borde y cesionarios.
- **Mejoras de interfaz pendientes:** borrar una carga puntual (hoy solo "Empezar de cero"); aviso de que el modo
  compartido va por HTTP sin cifrar.
- **Documentos de presentación** ya entregados: `Relevamiento_Ley_Pierri_resumen.pdf` (carilla para dejar) y
  `Guion_presentacion_Ley_Pierri.pdf` (guion de 10 minutos para Amelia).

---


**Proyecto:** Escribanía General de Gobierno de Córdoba (EGG) + Unidad Ejecutora para el Saneamiento de Títulos (UEST)
**Autor:** Baltasar Corna Fantin
**Estado:** especificación v4 (16/09/2026). v4 reorganiza el sistema en motor de lote + visor, agrega el carril de texto y el control de calidad medible. Prioridad declarada por Balta: primero que el motor lea bien; después georreferencia y plataforma de análisis. Pendiente de confirmar con la UEST los puntos marcados como ABIERTO.
**Para Claude Code:** este archivo es el brief completo. Leerlo entero antes de tocar código. Los archivos que lo acompañan son `pierri_core.js` (lógica compartida ya probada) y `codigos_departamentos_pedanias_cordoba.json` (tabla oficial de Catastro).

---

## 1. Qué hay que resolver

La UEST tiene ~10.000 expedientes de la Ley 9150 (anotación de posesión en el Registro Personal de Poseedores). Cada expediente termina en una resolución de la Presidenta de la UEST que ordena la inscripción y describe al poseedor, el inmueble, la matrícula afectada, la cuenta de Rentas y la antigüedad de posesión declarada.

Córdoba va a reglamentar la Ley 8932 (adhesión a la Ley 24.374, "Ley Pierri"). Hace falta saber **cuáles de esos ~10.000 poseedores son candidatos a Pierri** y **dónde están**, para organizar el relevamiento presencial en los barrios (que es donde se verifican los requisitos de vivienda única y de no tener otro inmueble).

La herramienta es un **clasificador**: lee las resoluciones escaneadas, extrae todos los datos, calcula el filtro temporal de posesión (elegible / no elegible / sin dato / revisar), ubica cada expediente con los datos de Catastro y produce planilla por localidad y mapa para agendar visitas. Lo que la resolución no puede decir (si está efectivamente inscripto, vivienda única, otro inmueble) queda como campo a completar desde otra fuente o en el barrio.

**Alcance fase 1 (esto):** extracción + filtro temporal + geo + exportación. No incluye el sistema de adhesión vía CiDi ni la interconexión SIIGENO/UEST (eso es fase 2).

---

## 2. Decisiones ya tomadas (y por qué)

| Decisión | Motivo |
|---|---|
| **Se extraen TODAS las resoluciones, no solo las elegibles.** La elegibilidad es una columna calculada con la fecha de corte como parámetro editable. | (a) El proyecto de Ley de Inviolabilidad de la Propiedad Privada (PE-13/26), con media sanción del Senado en agosto 2026, reemplaza el corte fijo por un plazo móvil de 10 años anteriores a la presentación; si sale, el universo cambia de "posee desde antes de 2006" a "desde antes de ~2016". (b) Los no elegibles siguen siendo la base de la 9150 y del futuro sistema doble. (c) Los casos borde requieren revisión humana. |
| **Extracción con modelo de visión (Claude Haiku), no OCR + regex.** | Probado con Tesseract sobre la muestra: lee bien el 80% pero la firma de la Presidenta cruza exactamente las líneas de antigüedad de posesión y de número de expediente, y ahí falla. Como firma siempre en el mismo lugar, el daño es sistemático. Claude leyó la misma imagen sin errores. OCR queda solo como control cruzado opcional. |
| **Solo filtro temporal de posesión + geo.** Vivienda única, otro inmueble, causa lícita: no se evalúan acá. | Se verifican en el relevamiento presencial. La herramienta sí guarda señales que ayudan a priorizar (domicilio del rogante vs inmueble, urbano/rural), pero como marca, nunca como filtro. |
| **Un solo archivo HTML, sin backend, IndexedDB.** | Misma arquitectura que el resto de las herramientas EGG (SIGEC). IndexedDB en vez de localStorage porque 10.000 filas + miniaturas para revisión superan los 5 MB. |
| **Procesamiento por lotes reanudable.** | 10.000 llamadas a la API no se hacen en una sesión. Cada resolución procesada se persiste al instante; cerrar el navegador y volver retoma donde quedó. |
| **Cola de revisión manual para todo lo que no valida.** | Con 10.000 documentos, 2% de error son 200 casos. Mejor que la herramienta los marque a descubrirlos en el barrio. |

---

## 3. Fuente de datos

### 3.1 Qué se recibe (confirmado con tres PDFs reales)

- **Un PDF por expediente, de dos páginas**, exportado del sistema de la UEST (generador PDFsharp). Nombre de archivo `documento_<expediente>_<hash>.pdf`, ej. `documento_0535-105743-2018_018df2ff.pdf` → Expte. 0535-105743/2018. **El expediente sale del nombre del archivo** y se usa para validar lo que lee el modelo.
- **Página 1 — VISTO y CONSIDERANDO.** Sello con la fecha de la resolución arriba a la derecha (`CORDOBA, 14 ABR 2026`). El VISTO trae expediente, rogante (DNI, CUIL) y ubicación/superficie según plano. Los considerandos enumeran la documental (DDJJ, testigos, cesiones de derechos posesorios, servicios, plano) y contienen la frase de antigüedad **sin firma encima**.
- **Página 2 — RESUELVE.** Art. 1° con rogante, domicilio, inmueble, medidas y linderos, matrícula(s) afectada(s) con titular registral, y la frase de antigüedad repetida. Art. 2° con el expediente. Número de resolución sellado y firma de la Presidenta cruzando las últimas líneas.
- **Capa de texto:** los PDF traen OCR embebido de calidad variable (dos de tres muestras legibles, una inservible). Se usa solo como control cruzado cuando está bien (`PierriCore.parsearAntiguedad`), nunca como fuente principal.
- **Numeración:** el número de resolución se reinicia cada año (203/2026, 021/2025, 554/2024). Identificador = número + año del sello.

### 3.2 Variantes ya observadas (tres resoluciones, mismo lote de Villa de Soto)

| Expte. | Frase de antigüedad | Estructura |
|---|---|---|
| 0535-105743/2018 | "declarada por el rogante a f.u. 26, fs. 1, es de **25 años al 18/07/2025**" | antigüedad + fecha de referencia, criterio DECLARADA_ROGANTE |
| 0535-105040/2018 | "que surge de la documental acompañada es de **sesenta años y tres meses al 06/04/2018**" (página 1 dice solo "sesenta años") | números **en palabras**, años + meses, criterio SURGE_DOCUMENTAL; afecta **dos matrículas** (1199926 y 954870) |
| 0535-105742/2018 | "que surge del expediente **data del 06/09/2018** (fs. 7)" | fecha de inicio directa, criterio SURGE_EXPEDIENTE; posesión por **cesión de derechos posesorios** de 2018 |

Otras diferencias vistas: "Municipalidad Villa de Soto" en vez de "Localidad"; "Barrio Alberdi" en el domicilio; "Lote 100 de la Manzana 75" sin calle; la cuenta del inmueble afectado no se dice directamente sino que se infiere de los linderos ("Resto de parcela 03, Núñez Esteban, MFR 1199926, cta 14-030734504/4"); nombre del rogante en minúsculas y en orden nombre-apellido ("Pura Silveria Farias"); DNI de 7 cifras con CUIL con cero adelante (27-02492082-3).

**Hallazgo importante:** los tres rogantes declaran el **mismo domicilio** (Tristán de Tejeda 560) y poseen fracciones de la **misma matrícula madre** (1199926). Es un patrón esperable (lote familiar subdividido). La herramienta lo detecta (`detectarClusters`) para que una sola visita cubra el grupo.

**Otro hallazgo:** el criterio de antigüedad **no es homogéneo** entre resoluciones. En 105743 la UEST tomó los 25 años declarados aunque en los considerandos consta una cesión de 2018; en 105742 tomó la fecha de la cesión. Por eso la fecha de posesión que sale de la resolución es un **proxy** para el primer filtro, y los casos con `criterio ≠ DECLARADA_ROGANTE` o con `origen_mencionado = CESION` reciente llevan señal para revisión jurídica (unión de posesiones, art. 1901 CCyC; continuadores art. 2 Ley 24.374).

**ABIERTO:** si las resoluciones anteriores a 2019 (sin Resolución 1/2019 UEST) tienen el mismo formato; cómo se exportan en masa desde el sistema (si el sistema genera estos PDF por expediente, debería poder generarlos todos).

## 4. Arquitectura (v4: motor + visor)

Decisión (16/09): procesar 10.000 resoluciones no es trabajo de navegador. El sistema se divide en dos piezas.

**Motor de lote — `procesar_lote.js` (Node, corre en la computadora).** Lee una carpeta entera, es reanudable (cada resultado se guarda apenas existe; volver a correr no reprocesa), paralelo contra la API, y deja `resultados.jsonl`, `planilla.csv`, `resumen.json`, `errores.log`. Dos carriles por resolución:
1. **Carril texto (gratis, instantáneo) — `pierri_texto.js`.** Los PDF de la UEST traen OCR embebido. Reglas deterministas extraen expediente, CUIL/DNI, nombre, matrículas y cuentas (emparejadas por cercanía "MFR … cta …"), la frase de antigüedad en sus variantes (números en cifras o palabras, años y meses, "data del", "desde el año"; manda la última aparición, que es la de la parte resolutiva), tipo de documento, departamento/pedanía/localidad/manzana y superficie. Si están los críticos (expediente, antigüedad, cuenta, tipo de documento), termina acá. Medido en las muestras: 2 de 3 resueltas por texto.
2. **Carril modelo (API) — solo si el texto no alcanzó.** Manda el PDF entero como documento (sin renderizar imágenes: no hace falta instalar nada raro) con `PROMPT_SISTEMA` y fusiona con lo que el texto sí leyó.
Después: clusters, Catastro por lote de cuentas, y escritura de salidas.

**Control de calidad del motor (lo que define si "lee bien").**
- `--doble-lectura N`: las primeras N resueltas por texto se leen también con el modelo y se comparan campo por campo (`compararLecturas`, campos de control: expediente, posee_desde a nivel año-mes, criterio, cuenta, matrícula, DNI, rogante, tipo, clasificación). Deja `control_lectura.json` con la exactitud por campo. Si difieren en algo que decide la clasificación, la resolución va a revisión con las dos lecturas guardadas.
- `evaluar_motor.js --verdad verdad.csv`: compara los resultados contra un conjunto de resoluciones leídas a mano. Es la herramienta para saber si un cambio al extractor o al prompt mejoró o empeoró. Con las tres muestras ya detectó y se corrigieron dos errores del carril texto (antigüedad tomada de la página 1 en vez de la resolutiva; segunda matrícula afectada omitida).
- Plausibilidad en el motor: la posesión no puede empezar después de la resolución ni de la fecha de referencia; el año del expediente no puede ser posterior a la resolución; expediente leído vs nombre de archivo; CUIL con dígito verificador y coherente con el DNI; cuenta coherente con el departamento.
- Límite conocido del carril texto: el nombre del rogante sale del OCR y puede traer letras cambiadas ("PARIAS" por "FARIAS"); queda con señal `NOMBRE_SEGUN_OCR`. El DNI/CUIL, que es lo que identifica, sale bien. Si la doble lectura muestra que los nombres fallan seguido, la decisión es leer todo con el modelo (el costo es moderado) o corregir nombres solo en los elegibles.

**Visor — HTML en el navegador (mockup aprobado 16/09; pendiente de construir).** Carga `resultados.jsonl` y no depende de la API. Métricas arriba (elegibles, borde, no elegibles, a revisar, ubicadas), fecha de corte como control vivo con simulación del plazo móvil, filtros (clasificación, sin ubicar, revisar) y buscador (expediente, DNI, matrícula, localidad), tabla con detalle por fila, localidades ordenadas por cantidad de elegibles ("dónde conviene empezar"), resumen por manzana catastral, mapa con los mismos filtros, exportación de planilla y de recorridos (KML para Google Maps en el celular). Es la "plataforma de información" para extraer datos y estadísticas.

**Prototipos anteriores:** `relevamiento_pierri_E2.html` (lectura en el navegador + clasificación + Catastro + mapa) queda como prueba de concepto y para leer pocas resoluciones sueltas; no se usa para el lote.

**Módulos compartidos:** `pierri_core.js` (reglas, elegibilidad, validaciones, Catastro, planilla, comparación de lecturas), `pierri_texto.js` (carril texto), `codigos_departamentos_pedanias_cordoba.json`.

## 5. Flujo de uso (4 pasos, 4 pestañas)

**1. Cargar.** Arrastrar uno o varios PDF o imágenes. Se calcula hash por archivo (para reanudar y evitar duplicados), se cuentan páginas y se muestra la lista de lotes. Parámetros visibles: API key, regla de elegibilidad (corte fijo 1/1/2006 o plazo móvil 10 años), fecha de corte, margen de borde, concurrencia (default 3).

**2. Procesar.** Botón Iniciar/Pausar. Por cada PDF: extraer el expediente del nombre de archivo, renderizar sus páginas a JPEG (lado mayor 1600 px, calidad 0.85; escala de grises para reducir tokens), extraer la capa de texto con pdf.js (`getTextContent`), enviar las páginas juntas a la API con el prompt, parsear JSON, correr `PierriCore.procesarRegistro(extraido, config, tabla, vistos, {nombreArchivo, textoCapaPDF})`, guardar en IndexedDB. Al terminar el lote, correr `detectarClusters` sobre todo lo procesado. Barra de progreso con procesadas / en revisión / errores / costo estimado. Reintento con backoff exponencial ante 429/5xx (máx. 5). Al reabrir el archivo se saltan las páginas ya procesadas.

**3. Revisar.** Cola de registros con `revisar = true`. Pantalla dividida: miniatura de la página (zoom) a la izquierda, formulario editable con los campos extraídos a la derecha, con los motivos de revisión arriba. Botones: Confirmar, Marcar como no-resolución (portada, hoja en blanco, oficio), Descartar. Al confirmar se recalculan los derivados.

**4. Exportar.** XLSX con hojas: `Maestro` (todo), `Elegibles`, `Borde`, `Revisar`, `Resumen` (conteo por departamento → pedanía → localidad, cruzado con estado de elegibilidad). Además JSON completo (backup y reimportación). Opcional: CSV por localidad para repartir a los equipos territoriales.

---

## 6. Esquema de datos

### 6.1 Extraído (lo que devuelve el modelo, JSON estricto — esquema v2)

El esquema vacío y **tres ejemplos completos reales** están en `pierri_core.js` (`ESQUEMA_VACIO`, `EJEMPLOS`). Estructura:

```
tipo_documento            RESOLUCION_INSCRIPCION | RESOLUCION_DESESTIMA | RESOLUCION_RECTIFICA | RESOLUCION_CANCELA | OTRO | NO_ES_RESOLUCION
resolucion                { numero, fecha (del sello de página 1, ISO) }
expediente                "0535-105743/2018"
rogantes[]                { apellido_nombre ("APELLIDO, NOMBRES"), dni, cuil, estado_civil,
                            domicilio { calle, numero, barrio, cp, localidad, departamento } }
inmueble                  { departamento, pedania, localidad, calle, numero, manzana, lote, barrio,
                            superficie_m2, superficie_texto, tipo (urbano|rural|indeterminado) }
plano                     { existe, profesional, matricula_profesional }
dominio.afectados[]       { matricula, cuenta (inferida de los linderos con la misma MFR), titular_registral, afectacion (parcial|total) }
dominio.nomenclatura
posesion                  { antiguedad_anios, antiguedad_meses, fecha_referencia, fecha_inicio_declarada,
                            criterio (DECLARADA_ROGANTE|SURGE_DOCUMENTAL|SURGE_EXPEDIENTE|OTRO),
                            origen_mencionado (CESION|HERENCIA|COMPRA|OTRO|null), folio, texto_original (literal) }
calidad                   { legibilidad (buena|regular|mala), campos_dudosos[], observaciones }
```

- `rogantes` es lista (cónyuges, condóminos). `dominio.afectados` es lista (una posesión puede afectar varias matrículas).
- v3 agrega `declaracion_jurada` (fecha, folio único, juzgado de paz, testigos con DNI), `documental[]` (un ítem corto por documento de los considerandos, conservando fechas y frases como "titular del servicio desde abril de 2000") y `plano.fecha_visado`. Se extrae todo: el costo está en las imágenes de entrada, no en los campos de salida.
- Compatibilidad: `procesarRegistro` acepta también el esquema v1 con `dominio.matricula/cuenta` planos.

### 6.2 Derivado (lo calcula `pierri_core.js`, nunca el modelo)

| Campo | Cálculo |
|---|---|
| `posee_desde` | `fecha_referencia − antiguedad_anios − antiguedad_meses` (precisión: año o mes) o `fecha_inicio_declarada` (precisión: fecha) |
| `elegibilidad.estado` | `ELEGIBLE` / `NO_ELEGIBLE` / `SIN_DATO` según regla y parámetros |
| `elegibilidad.borde` | `true` si `posee_desde` cae a ± `margenBordeMeses` de la fecha límite |
| `geo.dep_codigo`, `geo.ped_codigo`, `geo.dep_nombre`, `geo.ped_nombre` | decodificados del número de cuenta con la tabla oficial |
| `geo.coherente` | `true` si el departamento decodificado coincide con el texto extraído |
| `senal_vivienda` | `MISMA_CALLE` / `MISMA_LOCALIDAD` / `OTRA_LOCALIDAD` / `SIN_DATO`, comparando domicilio del rogante con el inmueble |
| `senales[]` | marcas no bloqueantes para priorizar visitas: `MULTIPLES_MATRICULAS`, `RURAL`, `CESION_RECIENTE`, `ANTIGUEDAD_SURGE_DOCUMENTAL/EXPEDIENTE`, `OTRA_LOCALIDAD`, `DOMICILIO_COMPARTIDO`, `MATRICULA_COMPARTIDA` |
| `cluster_domicilio`, `cluster_matricula` | asignados por `detectarClusters` sobre el lote completo (id, tamaño) |
| `validaciones[]` | lista de `{campo, ok, detalle, critica}` |
| `revisar`, `motivos_revision[]` | `true` si alguna validación crítica falla, `legibilidad != buena`, `campos_dudosos` no vacío, o `tipo_documento` no es inscripción |

---

## 7. Reglas de elegibilidad (parámetros, no código)

**Regla vigente — `CORTE_FIJO`.** Ley 24.374 art. 1 (texto según Ley 26.493 y 27.118): posesión pública, pacífica y continua durante tres años con anterioridad al 1/1/2009 → la posesión debe haber comenzado **antes del 1/1/2006**. Parámetro `fechaCorte = "2006-01-01"`; elegible si `posee_desde < fechaCorte`.

**Regla alternativa — `PLAZO_MOVIL`.** Proyecto PE-13/26 (media sanción Senado, en Diputados): diez años de posesión anteriores a la presentación. Parámetros `anosPlazoMovil = 10`, `fechaPresentacion` (default: hoy); elegible si `posee_desde ≤ fechaPresentacion − 10 años`. Se deja implementada y desactivada.

**Borde.** Como la antigüedad viene redondeada en años y declarada por el rogante, todo lo que cae a ±12 meses de la fecha límite se marca `borde = true` y se lista aparte. **ABIERTO:** si la UEST quiere criterio estricto o con margen.

**Continuadores (art. 2 inc. c Ley 24.374).** Convivientes no sucesores necesitan 2 años de convivencia anteriores a la fecha del art. 1. No se evalúa en fase 1; se anota que los rogantes que en la 9150 figuran como cesionarios o continuadores requieren análisis aparte. **ABIERTO:** cómo identifica la UEST esos casos.

---

## 8. Validaciones y cola de revisión

| Campo | Regla | Crítica |
|---|---|---|
| `expediente` | `^\d{4}-\d{5,7}/\d{4}$` (ej. 0535-105743/2018) | sí |
| `expediente_vs_archivo` | el expediente leído coincide con el del nombre del archivo | sí |
| `posesion_cruce_texto` | `parsearAntiguedad(capa de texto del PDF)` da la misma fecha de inicio (±40 días) que lo que devolvió el modelo — solo cuando la capa de texto es legible | sí |
| `resolucion_fecha` | fecha del sello parseable | no |
| `dni` | 7 u 8 dígitos | sí |
| `cuil` | 11 dígitos, dígito verificador correcto, y los 8 centrales = DNI | no (marca dudoso) |
| `cuenta` | 12 dígitos DDPPNNNNNNNV; DD ∈ 11–36; PP existe en la tabla de pedanías del departamento | sí |
| `matricula` | dígitos (5–7) o texto de folio para dominios viejos | sí |
| `superficie_m2` | número > 0 | no |
| `fecha_referencia` | fecha válida entre 2003 y hoy | sí |
| `antiguedad_anios` / `fecha_inicio_declarada` | al menos uno presente; 1–100 años | sí |
| `geo.coherente` | departamento del cuenta = departamento del texto | no (marca) |
| duplicado | mismo `expediente` ya procesado | sí |

Motivos de revisión = validaciones críticas fallidas + `legibilidad` regular/mala + `campos_dudosos` no vacío + `tipo_documento` distinto de inscripción + JSON inválido tras reintentos.

---

## 9. Geografía: Catastro como fuente, no el texto de la resolución

Decisión (16/09): la ubicación se toma de **Catastro por número de cuenta**, no del "barrio" que diga la resolución. Verificado en vivo:

- **Servicio:** capa `idecor:parcelas` del WFS público de IDECOR (`https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs`), sin clave, con CORS abierto (se consulta desde el navegador). Filtro `CQL_FILTER=Nro_Cuenta IN (…)` con la cuenta a 12 dígitos; hasta 50 cuentas por consulta.
- **Devuelve por parcela:** nomenclatura catastral completa, departamento, pedanía, localidad oficial, tipo (urbano/rural), estado (edificado / baldío / PH), designación oficial, superficie de tierra y de mejoras, valuación fiscal y el polígono (se usa el centroide en lat/lon).
- **Nomenclatura urbana** (16 dígitos): departamento (2) · pedanía (2) · pueblo/localidad (2) · circunscripción (2) · sección (2) · manzana (3) · parcela (3), +3 si es PH. Rural (14): departamento · pedanía · hoja (5) · parcela (5). `decodificarNomenclatura` la descompone; `clave_localidad` (6 dígitos) y `clave_manzana` (13) sirven para agrupar.
- **Lo que aporta además del "dónde":** `Estado` dice si la parcela está edificada (Pierri exige inmueble edificado) y `Valuacion` es la base del 1% de la Ley 8932 art. 6. Ambos son de la parcela madre, no de la fracción poseída; son señales, no filtros.
- **Límite:** la cuenta de la resolución es la del titular registral (parcela madre). El punto en el mapa es esa parcela, no el lote del poseedor. Alcanza para localidad, manzana y para agrupar visitas. Si Catastro no encuentra la cuenta (parcelas dadas de baja, cuentas viejas), queda la señal `SIN_PARCELA_CATASTRO` y se usa la localidad del texto.
- **Niveles de agrupación:** localidad (lo que pidió la UEST) y manzana catastral; ambos en la tabla resumen. Clusters por domicilio y matrícula madre para organizar visitas (`detectarClusters`).
- Tabla de códigos de departamentos y pedanías: `codigos_departamentos_pedanias_cordoba.json` (misma fuente).

## 10. Salidas (implementadas en E2)

- **Tabla clasificada** con filtros: todos / elegibles / borde / no elegibles / a revisar. Cada fila abre el JSON completo.
- **Resumen por localidad o por manzana catastral**: total, elegibles, borde, no elegibles, sin dato, a revisar.
- **Mapa** (Leaflet + OpenStreetMap) con un punto por parcela madre, color por clasificación, popup con los expedientes de ese punto.
- **Planilla CSV** (`aCSV`, 35 columnas, separador `;`, se abre directo en Excel): expediente, clasificación, posee desde, criterio, rogante, DNI, CUIL, departamento, pedanía, localidad Catastro y de la resolución, nomenclatura, manzana y parcela catastral, lat/lon, cuenta, matrículas, titulares, superficie poseída, estado y valuación de la parcela, inscripción, resolución y fecha, señales, revisar, clusters, archivo.
- **JSON completo** exportable e importable (para seguir en otra sesión o computadora).
- **Estado de inscripción:** la resolución solo prueba que fue ORDENADA. Se puede cargar un CSV del Registro o de la UEST (columnas `expediente` o `cuenta` + `estado`) y `importarEstadosInscripcion` marca INSCRIPTA / PENDIENTE / RECHAZADA. **ABIERTO:** de dónde sale esa planilla.
- XLSX con varias hojas: pendiente para la versión de lote (E3); por ahora el CSV cubre la planilla.

## 11. Prompt de extracción (v2)

En `pierri_core.js`: `PierriCore.PROMPT_SISTEMA` (≈12k caracteres, se cachea) y `PierriCore.PROMPT_USUARIO`. Se manda con las dos páginas del PDF como imágenes en un mismo mensaje de usuario, en orden. Puntos clave:

1. Explica la anatomía de las dos páginas y dónde está cada dato (fecha en el sello de página 1; frase de antigüedad en ambas; expediente en VISTO y art. 2°).
2. Instrucción explícita: si la firma tapa algo en página 2, tomarlo de página 1; si las páginas difieren, prevalece la parte resolutiva y se anota en `observaciones`.
3. Solo JSON, esquema exacto, `null` cuando falta, nunca inventar.
4. Las tres variantes de la frase de antigüedad con su mapeo, incluidos **números en palabras** y años + meses.
5. Regla para inferir la cuenta de cada matrícula afectada a partir de los linderos con la misma MFR.
6. `origen_mencionado` a partir de la documental de los considerandos (cesión, herencia, compra).
7. Tres ejemplos de salida completos, reales, uno por variante.

**Calibración pendiente:** correr el prompt sobre los tres PDF reales con la API key (Claude Code, etapa E1) y comparar con `EJEMPLOS`; luego sobre muestras de años anteriores a 2019 cuando lleguen. Registrar acá cada variante nueva.

## 11 bis. Qué significa "leer bien" y cómo se mide (decisión 16/09)

El motor de lectura es la base de todo; por eso no se confía en él, se lo mide.

**Dos carriles.** `pierri_texto.js` (carril 1, gratis) lee la capa de texto del PDF con reglas. Solo se acepta si (a) están los campos críticos: expediente, antigüedad, cuenta, tipo de documento; (b) el expediente coincide con el del nombre del archivo; (c) la frase de antigüedad, que aparece en las dos páginas, dice lo mismo en las dos; (d) los valores son plausibles (año de referencia entre 2003 y hoy, antigüedad entre 1 y 100 años, departamento de la cuenta entre 11 y 36); (e) hay un solo rogante en el art. 1° (si hay varios, va al modelo, que sí los estructura). Cualquier duda manda la resolución al carril 2 (modelo, `procesar_lote.js`), que recibe el PDF entero y cuyo resultado se fusiona con lo que el texto sí leyó bien.

**Banco de pruebas.** `banco_pruebas_texto.js` corre 12 casos construidos sobre la plantilla real: las tres variantes de antigüedad, páginas contradictorias, valores absurdos, expediente distinto al archivo, dos rogantes, OCR sucio, hoja que no es resolución. Todos pasan. Cada variante nueva que aparezca en las muestras de la UEST se agrega como caso.

**Doble lectura.** `--doble-lectura <n>` relee con el modelo n resoluciones que el texto ya resolvió y compara campo por campo (`compararLecturas`). Deja `control_lectura.json` con la tasa de coincidencia por campo. Si difieren en algo que decide la clasificación, la resolución va a revisión con las dos lecturas guardadas. Es la prueba de campo: con 100 PDF reales de años distintos y `--doble-lectura 100` se sabe cuánto vale el carril texto antes de tirarle 10.000.

**Provenance.** Cada registro guarda `fuente` (texto / modelo / texto_incompleto), cobertura y campos faltantes, para poder filtrar después "mostrame solo lo que leyó el modelo" o "solo lo que no llegó a nada".

## 11 ter. Carga masiva: cómo entra el lote (decisión 16/09)

La herramienta reconoce cada archivo por su forma, no por su nombre, así que da igual cómo lo entregue la UEST:

- **Un PDF por expediente** (2 páginas, `documento_<expediente>_<hash>.pdf`): una unidad por archivo; el expediente del nombre se usa como control.
- **Tomos** (un PDF por año, o uno solo gigante): `cortarTomo` recorre las páginas. Inicio de resolución = "VISTO: El expediente" o un número de expediente cerca del principio de la página (para cuando el OCR se comió el VISTO). Fin = "PROTOCOLÍCESE" (fuerte) o "RESUELVE / ORDENAR / DESESTIMAR" (débil). Una unidad absorbe hasta 4 páginas. Una página resolutiva huérfana se une con la suelta anterior (caso: primera página con OCR ilegible) y queda marcada como corte dudoso. Portadas, índices y oficios quedan como páginas sueltas en `errores.log`. Al modelo se le manda solo el recorte de esa resolución (`pdf-lib`), así el costo por resolución es el mismo que con archivos sueltos. Probado con un tomo sintético de 8 páginas (portada + 3 resoluciones reales + oficio): 3 unidades correctas, 2 sueltas.
- **Mezcla con repetidos**: se agrupa por expediente y se conserva la resolución de fecha más nueva; las demás quedan con `repetido_de` y no cuentan.
- **Reanudación**: un tomo cuenta como hecho por su archivo; cerrar y volver a abrir no lo vuelve a cortar ni a cobrar.
- Dependencias del script: `pdfjs-dist` (texto) y `pdf-lib` (recorte). Nada nativo.

## 11 quater. Nombres, lote de prueba, Padrón y Tablero (decisiones 16/09, tarde)

**Nombres de las piezas (usar siempre estos):** el **Embudo** (carpeta donde se tiran los PDF), el **Lector** (`procesar_lote.js` + módulos), el **Padrón** (planilla POS del Registro General) y el **Tablero** (`tablero_pierri.html`). La fase 2 (sistema con CiDi UEST–EGG) es otro proyecto y se bautiza cuando llegue.

**Lote de prueba sintético.** `generar_lote_prueba.py` arma un Embudo de 60 resoluciones con la plantilla real, cuentas reales de Catastro (280 parcelas urbanas edificadas de 7 localidades, `parcelas_reales.json`) y personas inventadas: sueltas, escaneadas con OCR de tesseract (buena y mala calidad), un tomo con portada y oficio, repetidas, desestimatorias, rectificatorias, dos rogantes, varias matrículas, familias que comparten lote, todas las variantes de antigüedad, y `verdad.csv`. Resultado del Lector sin clave: 56 de 63 unidades resueltas por texto, **0 errores de clasificación en lo aceptado**; las 7 restantes (escaneos ilegibles, dos rogantes) van al modelo por diseño. `evaluar_motor.js` da 96,7 % de clasificación correcta contando esas pendientes como error. Hallazgo del lote: el OCR escribe "antigúedad" con ú; el patrón pasó a `antig[üuúù]edad`. Las desestimatorias y rectificatorias ya no exigen antigüedad ni cuenta para aceptarse por texto.

**Padrón del Registro (recibido 16/09 del director del Registro General).** 8.021 filas, 7.142 anotaciones POS únicas: 6.475 definitivas, 568 observadas, 99 provisorias. Nombre del poseedor solo desde 2008 (1.528 anotaciones de 2003–2004 sin nombre). Sin DNI, cuenta, matrícula ni expediente. `cruzar_padron.js` cruza por nombre normalizado, solo si el nombre es único de los dos lados y el año del diario es igual o hasta 3 años posterior al de la resolución; lo demás queda ambiguo. Verificado con las tres reales: Cravero Raúl → inscripta (diario 346/2026); Cravero Miriam → figura inscripta (452/2026) pero el texto no leyó su nombre; Farias Pura Silveria → **no figura**: resolución 554/2024 dictada y nunca inscripta. Irene confirmó que la UEST no sabe si lo que manda a inscribir se inscribe: el circuito está cortado en el medio. Pedido pendiente al Registro: agregar DNI (y matrícula o expediente) a la misma consulta.

**Tablero.** `tablero_pierri.html`, un solo archivo: carga `resultados.jsonl`, métricas, criterio editable (corte fijo / plazo móvil / margen) con recálculo instantáneo y aviso de cuántos cambiarían con el otro criterio, filtros, búsqueda, tabla ordenable y paginada con detalle por fila, ranking de localidades por elegibles (clic filtra), mapa Leaflet, exportación CSV, KML y JSON. Sin API ni backend.

**Costos verificados (docs.claude.com, 16/09/2026):** Haiku 4.5 $1/$5 por millón de tokens (caché $0,10), Sonnet 4.6 $3/$15, Batch −50 %. Una resolución de dos páginas por el modelo ≈ un centavo de dólar. 10.000 resoluciones: entre ~20 y ~105 USD según cuántas resuelva el texto; con Batch, la mitad. El costo real es humano: la cola de revisión manual y el relevamiento presencial.

## 11 quinquies. La aplicación unificada (decisión 17/09)

Balta pidió una sola cosa prolija: una base que cualquiera pueda abrir y a la que cualquiera pueda cargar, que acumule. Se construyó `pierri.js`:
- **Un comando** (`node pierri.js`) levanta un servidor local (Node `http`, sin frameworks) en http://localhost:3777 y abre el Tablero. El Tablero detecta si está servido (modo aplicación) o abierto por archivo (modo JSONL) y muestra el Embudo, el botón del Padrón, la configuración y las acciones.
- **Base SQLite** `pierri.db` con `node:sqlite` (incorporado en Node ≥ 22.13, sin dependencias nativas). Tablas: `archivos` (hash, nombre, tipo, páginas, unidades, sueltas), `resoluciones` (columnas planas para consultar desde fuera —expediente, clasificación, posee_desde, rogante, DNI, departamento, pedanía, localidad, manzana, cuenta, matrículas, lat/lon, fuente, revisar, inscripción, válida, fecha de resolución, tokens, error— más el registro completo en `json`), `padron`, `meta`. Índices por expediente y localidad.
- **Reglas de acumulación**: archivo por hash (el mismo PDF dos veces se ignora, aunque cambie el nombre); expediente con varias resoluciones → la de fecha más nueva es la válida (`valida = 1`), las demás quedan con `repetido_de`; el Padrón se reemplaza entero y se recruza; cambiar el criterio recalcula todo sin releer PDF.
- **Endpoints**: `GET /api/datos`, `POST /api/pdf?nombre=`, `POST /api/padron?nombre=`, `POST /api/config`, `POST /api/completar` (relee con el modelo las incompletas, cuando se carga la clave después), `POST /api/catastro`, `GET /api/planilla.csv`.
- `pierri_lector.js` es el Lector como módulo; lo usan la aplicación y `procesar_lote.js` (que queda como alternativa de línea de comandos para lotes enormes). Una sola implementación.
- Probado con los tres PDF reales, el tomo de prueba y el Padrón real: repetidos detectados entre sueltas y tomo, Cravero Raúl cruzado como inscripta (346/2026), Farias no figura, base persistida entre reinicios, cambio de criterio en vivo, planilla y SQL directo sobre la base.

## 11 sexies. Diseño elegido (17/09)

Balta eligió la propuesta **C · Gestión** (lienzo con las tres: https://claude.ai/artifact/8uauSizBn1XD7KsyqybwSc). `tablero_pierri.html` quedó rehecho en ese diseño: navegación lateral (Embudo, Resumen, Expedientes, Localidades y mapa, Padrón del Registro, Configuración), tarjetas de métricas con porcentaje, estados por color (elegible verde, borde ámbar, no elegible gris, revisar rojo, inscripta azul), Manrope + Public Sans, azul institucional #16436e. El Embudo es la primera pantalla; el mapa tiene pantalla propia con ranking de localidades al costado. Mapa base: CARTO Voyager (calles) y Esri World Imagery (satélite), con las parcelas oficiales de Catastro (WMS de IDECOR) superpuestas al acercar; OpenStreetMap se descartó porque bloquea a las aplicaciones locales (403 "Access blocked"). Probado de punta a punta con la aplicación: tres PDF reales, tomo, Padrón, repetidos, cruce y coordenadas.

## 11 septies. El Inventario de la UEST (recibido 17/09) — cambia la escala

Irene mandó dos CSV del sistema de la UEST: `Expedientes_Digitalizados.csv` (35.096 expedientes; columnas Expediente, Departamento, Hojas, Cuenta, Categoría cuenta, Nº Resolución, Estado resol., En universo) y `Solo_Resoluciones.csv` (los 6.891 con estado "Solo resolucion", subconjunto del primero).

Lo que dice: **el universo no son 10.000 sino 35.096 expedientes digitalizados**, pero solo **7.082 tienen la resolución escaneada** ("Solo resolucion" 6.891 + "Resolucion+Cuerpo" 191); 27.443 tienen solo el cuerpo y 571 están sin clasificar. Ese 7.082 coincide con las 7.142 anotaciones del Padrón: es el universo real del Lector. 28.312 expedientes traen **cuenta válida a 12 dígitos**, lo que permite ubicar el 80 % del inventario en Catastro sin abrir PDF (probado: ~93 % de las cuentas existen en Catastro; 500 cuentas por lote en pocos segundos). De los 7.082 con resolución, solo 4.005 traen cuenta en el inventario; el resto la aporta la resolución al leerla. El departamento de la cuenta coincide con la columna Departamento en el 96,5 %. Las tres muestras reales aparecen con la misma cuenta y el mismo número de resolución que leyó el Lector.

Implementado en la aplicación: tabla `inventario` (se reemplaza entera al cargar), tabla `parcelas` (cuenta → nomenclatura, localidad, estado, coordenadas), endpoints `POST /api/inventario`, `POST /api/inventario/ubicar?maximo=500` (reanudable), `GET /api/inventario/localidades`; cada resolución leída se cruza con su fila del inventario (cuenta y número de resolución coinciden o no); pantalla **Inventario UEST** en el Tablero con tarjetas, mapa por localidad (círculos proporcionales a expedientes con resolución) y tabla por localidad con baldías.

**ABIERTO (preguntar a Irene):** qué significa "En universo" (33.331 Sí / 1.765 No); si los 27.443 "Solo cuerpo" son expedientes nunca resueltos, archivados o resueltos con resolución sin escanear; si los "Sin clasificar" tienen resolución.

## 11 octies. El SUAC tiene iniciador y DNI (17/09)

`Expedientes_Faltantes_por_Digitalizar.csv` (16.369 filas) viene del sistema provincial de expedientes (SUAC), no de Ypsilon, y trae **Iniciador, Nº Doc (DNI), Cuenta, Fecha ingreso, Fecha resol.** (esta última casi vacía). Estados: INC-Incompleto 8.577, Sin estado 7.319, Archivado 422, OK 45, Anulado 4. 15.709 con número de expediente normalizable; el resto son números de otros sistemas (DRGP…). Implicación: el SUAC tiene iniciador y DNI de **todos** los expedientes; el export de los 35.096 digitalizados que mandó Ypsilon no los incluye porque es de otro sistema. **Pedido concreto:** el mismo export del SUAC para los expedientes digitalizados (o para el universo entero). Con el DNI, el cruce resolución ↔ expediente ↔ Padrón deja de depender del nombre.

Implementado: `cargarInventario` reconoce los dos formatos por sus columnas (Ypsilon: `Expediente; Estado resol.; …`; SUAC: `Nº Exp. SUAC; Iniciador; Nº Doc; …`), normaliza los números del SUAC ("++00000535-101806--2012" → "0535-101806-2012") y fusiona por expediente (un CSV nuevo del mismo origen reemplaza; uno de otro origen completa columnas). El Padrón se cruza con el nombre de la resolución y, si el Lector no lo leyó, con el iniciador del SUAC. Probado: 35.044 + 15.890 = 50.934 expedientes en la base, 15.729 con DNI, recarga sin duplicar. Dashboard Y-Neura (yneura.ypsilon.ar, acceso de Irene): universo 49.668, digitalizados 35.096 (67 %), faltan 16.369; de los 6.784 sin cuenta válida, 3.077 tienen resolución: el Lector recupera esa cuenta del texto de la resolución.

## 12. Rendimiento, costo, resiliencia

- Concurrencia 3 (configurable). Una llamada por resolución (dos imágenes). Con ~5 s por llamada, 10.000 resoluciones ≈ 5 horas de pared en una sesión, o varias sesiones reanudables.
- Imagen: JPEG escala de grises, lado mayor 1600 px. Suficiente para leer dígitos bajo la firma; reduce tokens.
- Costo: orden de decenas de dólares para 10.000 imágenes con Haiku (verificar tarifa vigente antes de estimar en pantalla).
- Errores: 429 → esperar y reintentar; 5xx → reintentar; JSON inválido → reintentar una vez pidiendo "solo JSON"; segunda falla → fallback Sonnet; tercera → estado `ERROR` y cola de revisión.
- Nunca perder trabajo: cada resultado se escribe en IndexedDB antes de pasar a la siguiente página.

---

## 13. Datos personales

Las resoluciones tienen nombre, DNI, CUIL y domicilio. La extracción manda la imagen a la API de Anthropic. Antes de procesar el lote real: **autorización por escrito de la UEST/EGG** y revisión de los términos de uso de datos de la API. La herramienta no guarda imágenes completas, solo miniaturas de los casos en revisión, y todo queda en la computadora del usuario. **ABIERTO:** confirmar con la UEST.

---

## 14. Dependencias de la UEST (preguntas ya enviadas a Balta el 15/09)

Ya respondido por las muestras: formato (un PDF de dos páginas por expediente, exportado del sistema), dónde está la fecha (sello de página 1), y que el nombre del archivo trae el expediente.

Siguen abiertas y cambian el diseño: export de la base del sistema (y qué campos tiene); cómo se exportan los 10.000 PDF en masa; cantidad real de resoluciones; si las anteriores a 2019 tienen el mismo formato; cómo se marcan desestimaciones/rectificaciones/cancelaciones; nivel geográfico requerido; criterio estricto o con margen para el corte; cómo tratan los cesionarios/continuadores; autorización de datos personales.

Si aparece el export de la base: la herramienta pasa a modo "completar y verificar" (cruza por expediente o cuenta, extrae solo lo que falta, marca discrepancias). Diseñar el store `resoluciones` con `expediente` como índice para que ese cruce sea trivial.

---

## 15. Plan de trabajo

| Etapa | Entregable | Depende de |
|---|---|---|
| E0 (hecho) | Esta spec v2, `pierri_core.js` v2 probado contra tres resoluciones reales, tabla de códigos | — |
| E1 Prototipo (hecho) | HTML con Cargar + Procesar sobre los tres PDF reales (dos páginas por llamada), comparación contra `EJEMPLOS` | API key |
| E2 Clasificador (hecho) | `relevamiento_pierri_E2.html`: clasificación con filtros, Catastro por cuenta, resumen por localidad/manzana, mapa, planilla CSV, importar/guardar JSON, carga de estados de inscripción. Sin IndexedDB todavía; el JSON guardado hace de persistencia | Probar con la API key |
| E2 Calibración | Prompt ajustado con muestras de años anteriores a 2019; variantes documentadas | muestras de la UEST |
| E3 Motor de lote (hecho) | `procesar_lote.js` + `pierri_texto.js` + `evaluar_motor.js`: carril texto, carril modelo, reanudable, paralelo, Catastro, doble lectura, evaluador | export masivo de la UEST para correrlo en serio |
| E3b Calibración medida | Conjunto de verdad de 30–50 resoluciones leídas a mano (años variados) + `--doble-lectura` sobre las primeras 200 del lote real. Meta: ≥98% en posee_desde, cuenta y expediente antes de confiar en el clasificador | muestras de la UEST; alguien que lea a mano |
| E4 Visor | Construir el visor del mockup sobre `resultados.jsonl`: métricas, filtros, buscador, localidades por elegibles, manzanas, mapa, KML | E3b |
| E4 Revisión y export | Pestaña Revisar, XLSX/JSON, Resumen | E3 |
| E5 (opcional) | Mapa por barrio con IDECOR; modo "completar" si hay export de la base | respuesta UEST |

---

## 16. Base normativa (verificada el 15/09/2026)

- **Ley 24.374** texto actualizado (art. 1 según Leyes 26.493 y 27.118; art. 8 según Ley 25.797): https://www.argentina.gob.ar/normativa/nacional/ley-24374-755/actualizacion
- **Ley 8932** (Córdoba, adhesión; art. 2 vetado; art. 6 contribución 1%; art. 7 escritura gratuita por la EGG; arts. 9–10 consolidación por resolución de la autoridad de aplicación): https://www.argentina.gob.ar/normativa/provincial/ley-8932-123456789-0abc-defg-239-8000ovorpyel/actualizacion
- **Ley 9150** (Córdoba; arts. 6–18 Registro Personal de Poseedores; art. 27 UEST; art. 35: la UEST es autoridad de aplicación de la Ley 8932): https://www.argentina.gob.ar/normativa/provincial/ley-9150-123456789-0abc-defg-051-9000ovorpyel/actualizacion
- **Borrador de decreto reglamentario de la Ley 8932** (docx, 6 artículos: delega en la UEST el dictado de disposiciones e instructivos, administra el fondo del 1%). Las presentaciones de NotebookLM que describen un decreto de 13 artículos no coinciden con ese borrador; no usar como fuente.
- **Proyecto PE-13/26** (Inviolabilidad de la Propiedad Privada), media sanción Senado agosto 2026: plazo móvil de 10 años para la 24.374. Seguir su trámite en Diputados.
