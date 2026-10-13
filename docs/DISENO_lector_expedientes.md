# Lector de expedientes completos (cuerpos): diseño

> **Diseño, no implementado. Fecha: 13/10/2026.** Versión final. Incorpora las observaciones de la revisión jurídica y de la revisión técnica. Las dudas sobre la revisión están en §13.E.

Este documento tiene dos públicos:

- **Balta.** Cada sección empieza con un bloque **En pocas palabras**, escrito en castellano llano.
- **Las sesiones de Claude Code que lo implementen.** Lo técnico está en los bloques **Detalle técnico**.

Cuando se escribió no había cuerpos de muestra. Todo lo que depende de cómo son los cuerpos reales lleva la marca **a calibrar con muestras**.

**Marcas jurídicas.** En la sesión de investigación no se pudo abrir ninguna página oficial. El buscador devolvió solo fragmentos.
- **[T]**: fragmento textual que devolvió el buscador. No está cotejado con la página completa.
- **[P]**: resumen del buscador. El contenido tiene respaldo, pero la redacción no está verificada.
- **[NV]**: no verificado.

Antes de usar cualquier cita en un documento oficial hay que cotejarla con InfoLEG, argentina.gob.ar o el Boletín Oficial de Córdoba.

**Numeración de la Ley 9150.** Las copias consultadas numeran distinto algunos artículos. Todo número de artículo de la Ley 9150 que aparece en este documento está **a cotejar (§13.11)**, aunque la cita lleve [T].

**Vocabulario.**
- **Página**: página del PDF, contada desde 1. Es la unidad por la que se cobra el modelo.
- **Hoja**: lo que cuenta el inventario (`inventario.hojas`). Si el escaneo tiene anverso y reverso, una hoja puede ser dos páginas.
- **Foja**: número impreso en el expediente. Puede no coincidir con la página.
- **Cuerpo**: todo lo que no es la resolución conservada.
- **Indicio**: documento que vincula a una persona con un inmueble en una fecha. No es prueba.

---

## 1. Para qué

**En pocas palabras.** Hoy el sistema lee solo las resoluciones de la Unidad Ejecutora (UEST) y descarta el resto del expediente. Eso deja tres problemas:

1. **27.443 expedientes digitalizados tienen solo cuerpo, sin resolución.** El sistema no dice nada sobre ellos.
2. **Muchos cuerpos traen documentación que puede mostrar que alguien estaba en el inmueble el 1/1/2006 o antes:** boletas de impuestos, facturas de servicios, boletos, cesiones de derechos posesorios, planos.
3. **La UEST dio de baja, archivó o desestimó expedientes sin que se sepa por qué.** De la resolución, el sistema guarda solo el verbo ("desestímase") y no el fundamento. El único dato de baja que tiene es el estado del SUAC, y solo para los expedientes que **faltan** digitalizar. Para los cuerpos digitalizados no tiene ninguno.

Por eso la pregunta "¿esta persona podría entrar en la Ley Pierri?" no se contesta mirando solo la resolución. El lector de cuerpos es una **segunda vía, al lado de la actual**. No cambia cómo se cargan ni cómo se clasifican las resoluciones.

**Qué hace:**
- Ordena cada expediente: qué documentos tiene, de qué fecha, a nombre de quién y sobre qué inmueble.
- Identifica al rogante cuando no hay resolución. Lo toma de la carátula o de la declaración jurada, como propuesta que una persona revisa. Hoy el inventario no trae nombre ni DNI de los expedientes digitalizados.
- Encuentra el documento más antiguo que vincula al rogante (o a quien le cedió) con el inmueble. Lo compara con el 1/1/2006 y muestra si hay documentos entre 2006 y 2008.
- Busca por qué se cerró el expediente y lo guarda textual, con la foja de donde sale.
- Recupera la cuenta que les falta a 3.688 expedientes que ya tienen el cuerpo escaneado.

**Qué no hace:**
- No dice "elegible" ni "posesión acreditada". Dice "hay un indicio documental de tal fecha". La decisión la toma una persona y queda en la auditoría.
- No dice que un caso pueda tramitarse por la Ley Pierri: la reglamentación de la Ley 8932 no está dictada.
- No toca la clasificación de las resoluciones, la planilla ni el Embudo.
- No lee lo que no está digitalizado (16.358 expedientes).

### Universo

Fuente: inventario de Neura/Ypsilon, captura del 13/10/2026.

| | Cantidad |
|---|---|
| Expedientes registrados en la UEST (vía SIA) | 49.668 |
| Digitalizados | 35.096 |
| — solo cuerpo | **27.443** |
| — resolución y cuerpo | **191** |
| — solo resolución | 6.891 |
| — sin recuperar | 571 |
| Sin digitalizar | 16.358: INC-incompleto 8.572, sin estado 7.814, ARCHIVADO 422, OK 44, ANULADO 4, otros 2 |
| Número de cuenta (digitalizados) | 28.312 correctas (12 dígitos), 6.584 con pocos dígitos, 140 con exceso, 2 con texto, 58 vacías |
| Sin cuenta válida | 6.784: 2.963 con resolución y sin cuerpo, 3.688 con cuerpo y sin cuenta, 133 sin recuperar |

- **Cuerpos que se pueden leer: 27.634** (27.443 + 191). Según la SPEC, un expediente "solo cuerpo" tiene 6 hojas o más.
- **Cómo cierran los totales.** 49.668 = 33.310 digitalizados "en universo" + 16.358 sin digitalizar. Los otros 1.786 digitalizados (1.746 "fuera" y 40 sin el dato) no están entre los 49.668. Es una inferencia hecha con los números y hay que confirmarla con Neura.
- **Diferencia con la SPEC.** La SPEC (línea 508) dice 33.331 / 1.765. Son cifras de otra captura.
- **Dos datos que faltan para los digitalizados.** El export de Ypsilon no trae iniciador, DNI ni estado del SUAC. Esos datos llegan solo del CSV del SUAC de los expedientes sin digitalizar (`pierri.js:344-353`; SPEC §11 octies). Esto pesa en §6.1 y en §7.

---

## 2. Qué dice la norma sobre la prueba de la posesión

**En pocas palabras.**
- **Plazo.** La Ley 24.374 exige posesión pública, pacífica y continua durante los tres años anteriores al 1/1/2009 (art. 1 [T]). O sea, iniciada a más tardar el 1/1/2006 y mantenida hasta el 1/1/2009.
- **Otros requisitos.** Causa lícita, e inmueble edificado urbano destinado a casa habitación única y permanente.
- **Exclusión.** Quedan afuera quienes tengan otros inmuebles con capacidad para satisfacer sus necesidades de vivienda (art. 4 a [T]).
- **No hay lista de pruebas.** La ley pide una declaración jurada con el origen y el año de la posesión, admite la documentación que tenga el interesado y deja la evaluación a la autoridad de aplicación.
- **En Córdoba la reglamentación de la Ley 8932 no está dictada.**

Con respaldo, el sistema puede hacer solo dos cosas: **comparar fechas contra el corte** y **rotular documentos**. Todo lo demás es una pregunta para Balta (§13).

### 2.1 Anclas: qué hace el sistema y en qué se apoya

| Qué hace el sistema | En qué se apoya | Marca |
|---|---|---|
| Compara cada fecha contra el 1/1/2006, siempre con la regla `CORTE_FIJO` (§6.5). Nunca usa el Proyecto PE-13/26, que no es ley | Ley 24.374 art. 1, texto según Ley 27.118 art. 35: "acrediten la posesión pública, pacífica y continua durante tres (3) años con anterioridad al 1° de enero de 2009" | [T] |
| Muestra, sin umbral, si hay documentos entre el 1/1/2006 y el 31/12/2008 | art. 1: "durante tres (3) años con anterioridad al 1° de enero de 2009" | [T] |
| Muestra los demás requisitos del art. 1 **sin evaluarlos**: causa lícita; posesión pública, pacífica y continua; "inmuebles edificados urbanos"; "que tengan como destino principal el de casa habitación única y permanente" | art. 1 | [T] |
| Muestra, sin evaluarla, la exclusión del art. 4 inc. a: "propietarios o poseedores de otros inmuebles con capacidad para satisfacer sus necesidades de vivienda" | Ley 24.374 art. 4 a | [T] |
| Nunca dice "posesión acreditada" | art. 6 inc. b: la autoridad verifica, "pudiendo desestimar las solicitudes que no reúnan los requisitos exigidos"; si hay falseamiento, "se rechazará la misma sin más trámite" | [T] |
| Busca la DDJJ de la Ley 9150, con el origen y la fecha de la posesión que declaró el rogante | Ley 9150 arts. 9 y 10 | [T]/[P]; numeración [NV] (§13.11) |
| Arma la cadena de cesiones y sucesiones **sin sumar posesiones** | Ley 24.374 art. 2 incs. b a d: cónyuge y sucesores; convivientes con trato familiar; quienes por acto legítimo sean "continuadores de dicha posesión" | [P]; la frase citada [T]; qué inciso es cuál [NV] (§2.4) |
| Espera encontrar una DDJJ con dos testigos y firmas certificadas | Ley 9150 art. 9 | [T]; numeración a cotejar (§13.11) |
| …con el origen y la fecha de la posesión "en forma clara y expresa", los antecedentes documentales y el año de las mejoras | Ley 9150 art. 10 | [P]; numeración [NV] (§13.11) |
| …un informe de Catastro cuando no hay titular determinado, y edictos | Ley 9150 art. 13 | [T] |
| …la oposición del titular registral dentro de los 60 días | Ley 9150 art. 14 | [T] |
| …el emplazamiento para presentar plano: "emplazará al poseedor para que dentro del plazo de sesenta (60) días acompañe un plano" | Ley 9150 | [T]; que sea el art. 14 [NV] |
| …la oposición con mediación negativa, que termina en desestimación y archivo | Ley 9150 art. 17 | [T]; numeración a cotejar (§13.11) |
| …un pedido de ampliación de datos o antecedentes | Decreto 586/04 art. 9 | [T] |
| No toma una boleta impaga como dato en contra | Ley 9150: la deuda tributaria "no constituirá obstáculo alguno para el rogante" (citada por doctrina). Para Pierri rige la Ley 8932: las deudas tributarias provinciales no impiden el trámite [P], "con excepción de la contribución prevista en el artículo siguiente" [T]. Que una boleta, paga o impaga, sirva como indicio no surge de ninguna de las dos: es la lista de trabajo del §3 | 9150: [T], artículo [NV]; 8932: [P]/[T], número de artículo [NV] |
| Trata la lista de tipos de documento como lista de trabajo, no como lista legal | La UEST pide "la mayor cantidad de documentación requerida que acredita la posesión invocada, su origen y/o antigüedad" (cba.gov.ar). Es práctica administrativa, no norma | [T] |
| Considera a la UEST autoridad de aplicación de la Ley 8932 | Ley 9150 art. 35 | [P]; redacción [NV] |
| Considera a la EGG quien labra la escritura | Ley 8932 art. 7: "será labrada gratuitamente por la Escribanía General de Gobierno" | [T] |

**Lo que no figura en esta tabla no se codifica.**

**La DDJJ del cuerpo no es la DDJJ de Pierri.** La DDJJ de la Ley 9150 no es la solicitud ni la DDJJ del art. 6 inc. a de la Ley 24.374. Esta última debe indicar el carácter de poseedor, el origen y el año de la posesión y "todo otro requisito que fije la reglamentación" [P]. El sistema no toma una por la otra.

### 2.2 Lo que el sistema puede afirmar

1. **Si una fecha es anterior o posterior al 1/1/2006.**
   - Es la cuenta del art. 1 en su texto vigente y coincide con la `fechaCorte` de la SPEC.
   - Supone que la adhesión de la Ley 8932 (2001) alcanza la reforma que llevó la fecha al 1/1/2009 (pregunta 12). Es la regla vigente del sistema y este diseño no la cambia, pero se presenta como **supuesto**.
   - Queda además la discrepancia sobre si esa fecha la fijó la Ley 26.493 o la 27.118 [NV].
2. **Que un documento menciona a tal persona, tal inmueble y tal fecha.** Es un rótulo, no una valoración.
3. **Que en el expediente hay, o no hay, tal pieza del trámite de la Ley 9150.**

### 2.3 Lo que no se codifica (va como pregunta al §13)

- **Qué documento alcanza para probar la posesión o la causa lícita.** No hay lista legal. San Juan tiene una (Decreto Reglamentario 9-2018-C, art. 5 [P]) y también la tienen guías municipales bonaerenses ([T]/[P]). Son de otras jurisdicciones y sirven solo como referencia de trabajo.
- **Si la ocupación de hecho sin boleto es causa lícita.**
  - Un documento nacional dice que la lectura restrictiva "parece haber sido abandonada" [P].
  - Un fallo atribuido dice que el boleto "no es un requisito para el otorgamiento de los beneficios" [T]. Tribunal y fecha [NV].
  - Ninguna de las dos cosas alcanza para codificarlo.
- **Si se suman posesiones** por cesión o herencia. "Continuadores" no está definido en lo relevado.
- **Qué hueco entre documentos interrumpe la posesión "continua".**
- **Con qué fecha vale un documento privado:** la del acto o la de la certificación de firmas.
- **Qué fecha prevalece** si la DDJJ, la resolución y los documentos no coinciden.
- **El art. 4 inc. b no se aplica como filtro.** Excluye los inmuebles cuyas características excedan "las fijadas en la reglamentación" [T], y en Córdoba esa reglamentación no existe.
- **El art. 4 inc. a no se evalúa.** Se muestra como "no evaluado".

### 2.4 Supuestos del código y de la SPEC, revisados

- **"Pierri exige inmueble edificado"** (SPEC §9).
  - Para lo urbano tiene respaldo textual: "inmuebles edificados urbanos" [T].
  - Para el inmueble rural del agricultor familiar, el texto dice "donde residan y produzcan" [T] y no exige edificación con esas palabras.
  - Si la adhesión de la Ley 8932 alcanza esa reforma es la pregunta 12.
  - Al agregar la cita a la SPEC, hay que limitarla a lo urbano.
- **"La Ley 24.374 es para personas humanas que ocupan el inmueble como vivienda"** (`pierri_core.js:341-342, 363`).
  - El destino de vivienda tiene respaldo en el art. 1 [T].
  - "Personas físicas" aparece en un resumen del art. 2 inc. a [P].
  - Hay que cotejarlo antes de citarlo.
- **La señal `RURAL` y el corte.** El art. 1 vigente agrega que "en las mismas condiciones podrán acceder a estos beneficios los agricultores familiares respecto del inmueble rural donde residan y produzcan" [T]. La pregunta 12 (si la adhesión de 2001 alcanza las reformas posteriores) abarca esto y **también el corte**: el texto original decía "1 de enero de 1992" [T].
- **Continuadores.** Hay dos citas distintas para lo mismo:
  - La SPEC §7 (línea 390) titula "Continuadores (art. 2 inc. c Ley 24.374)" y los describe como convivientes no sucesores.
  - Según la investigación, el inc. c son los convivientes con trato familiar (dos años antes de la fecha del art. 1 [P]) y los "continuadores de dicha posesión" son los del inc. d [T].
  - Las dos citas quedan [NV] hasta cotejar el texto oficial. Después se unifican la SPEC y este diseño (§13.D).
  - En la cadena, la convivencia se registra solo como rótulo (`CONVIVENCIA`, §5.1), sin evaluar los dos años.
- **"A más tardar" contra "antes del".** `evaluarElegibilidad` compara con `<` (`pierri_core.js:176`), así que el 1/1/2006 exacto queda afuera. Con el margen de 12 meses cae igual en borde. Se anota como observación para la SPEC §7 y la regla no cambia en este diseño (§13.D).

### 2.5 Fuentes

| Norma o documento | URL |
|---|---|
| Ley 24.374, texto actualizado | https://www.argentina.gob.ar/normativa/nacional/ley-24374-755/actualizacion |
| Ley 24.374, texto original | https://www.argentina.gob.ar/normativa/nacional/ley-24374-755/texto |
| Ley 24.374, arts. 6 y 4 | https://www.rpba.gov.ar/files/Normas/Leyes/Ley-24374-Nacional-06.pdf · https://ar.vlex.com/vid/ley-24374-219540778 |
| Ley 24.374, art. 2 | https://agrimensorescordoba.org.ar/wp-content/uploads/2022/07/ley-no-24374-ley-nacional-de-regularizacion-dominial.pdf |
| Destino de vivienda y DDJJ | https://www.colescba.org.ar/descarga/archivos/manuales/2014/curso-rd-2014.pdf · https://www.colescba.org.ar/descarga/archivos/manuales/2014/curso-rd-2014-act-ley-24374.pdf |
| Ley 26.493 | https://www.argentina.gob.ar/normativa/nacional/ley-26493-151955/texto |
| Ley 27.118 | https://www.argentina.gob.ar/normativa/nacional/norma-241352/normas-modificadas · https://www.fonaf.org.ar/documentos/Ley_27118_Reparacion_historica_AF.pdf |
| "Causa lícita" | https://www.argentina.gob.ar/sites/default/files/2021/05/sisu_ley_24.374_ley_pierri_julio_2022.pdf |
| Ley 8932 | https://www.argentina.gob.ar/normativa/provincial/ley-8932-123456789-0abc-defg-239-8000ovorpyel/actualizacion |
| Ley 9150 | https://www.escribanos.org.ar/Archivos/Revista/file/legislacion/Ley%20Provincial%209150.pdf · https://agrimensorescordoba.org.ar/wp-content/uploads/2022/07/ley-no-9150-saneamiento-de-titulos-poseedores.pdf · https://www.argentina.gob.ar/normativa/provincial/ley-9150-123456789-0abc-defg-051-9000ovorpyel/actualizacion |
| Decreto 586/04 | https://agrimensorescordoba.org.ar/wp-content/uploads/2022/07/decreto-no-58604-reglamentacion-de-ley-no-9150.pdf |
| Práctica de la UEST | https://www.cba.gov.ar/saneamiento-de-titulos/ · https://www.cba.gov.ar/wp-content/uploads/2023/12/Formulario_electronico_posesion.pdf |
| Referencia de otras jurisdicciones | San Juan: https://www.jussanjuan.gov.ar/descargas/ri/otras/DR-9-2018-%20C.PDF · Luján: https://ga.lujan.gov.ar/regdominial/docs/Ley_24.374_de_Regularizaci%C3%B3n_Dominial,_Ley_Pierri.pdf |
| Ley 25.326, art. 2 (datos personales y sensibles) | La aportó la revisión jurídica y no estaba en la investigación. [P]: cotejar en InfoLEG |

---

## 3. Qué hay en un expediente

**En pocas palabras.** En un cuerpo hay dos familias de documentos:

- **Las piezas del trámite de la Ley 9150**, cuya existencia surge de la ley: la declaración jurada, el informe de Catastro, los edictos, la oposición, el plano, los requerimientos, las providencias y las resoluciones.
- **Lo que aportó el rogante para probar:** boletos, cesiones, boletas, facturas, actas.

Cada tipo tiene un **rol**, que dice para qué sirve en el análisis. Es una lista de trabajo. Qué aparece de verdad y cómo se reconoce **está todo a calibrar con muestras**, y Balta la valida en el piloto.

**Roles:**

| Rol | Qué significa |
|---|---|
| `DECLARA` | Lo que declara el rogante, o la antigüedad que la UEST tuvo por cierta en una resolución |
| `FECHA` | Muestra un vínculo entre una persona y el inmueble en un momento dado |
| `ORIGEN` | Es un eslabón de la cadena (de quién viene la posesión) |
| `INMUEBLE` | Identifica la parcela |
| `CIERRE` | Providencia de archivo, resolución desestimatoria o cancelatoria, u oposición con mediación |
| `TRAMITE` | Actuación de la UEST que le pide algo al rogante o mueve el trámite. Por sí sola no explica un cierre |
| `ESTRUCTURA` | No prueba nada. Sirve para saber dónde empieza y dónde termina cada documento |

**A. Piezas del trámite de la Ley 9150**

| Código | Rol | Qué se extrae |
|---|---|---|
| `DDJJ_POSESION` (DDJJ de la Ley 9150; no es la DDJJ del art. 6 a de la Ley 24.374) | DECLARA | Rogante (nombre y DNI); fecha; origen y fecha de la posesión declarados; testigos (nombre y DNI); quién certificó las firmas; si hay croquis; año de las mejoras |
| `INFORME_CATASTRO` | INMUEBLE | Titular registral, nomenclatura, cuenta, matrícula |
| `EDICTO_NOTIFICACION` | ESTRUCTURA | Fecha |
| `OPOSICION_MEDIACION` | CIERRE | Fecha, quién se opone, resultado |
| `PLANO_CROQUIS` | INMUEBLE | Fecha de visado, nomenclatura, superficie, mejoras |
| `REQUERIMIENTO` (emplazamiento, intimación, cédula) | TRAMITE | Qué se pidió, plazo, fecha, y si hay respuesta en fojas posteriores |
| `PROVIDENCIA_ARCHIVO` | CIERRE | Fecha y fundamento literal |
| `RESOLUCION` | CIERRE si desestima, cancela o archiva; DECLARA si fija la antigüedad que la UEST tuvo por cierta | El lector actual la sigue leyendo. Acá se ubica y se clasifica, sin saltearla (§4.2, Paso 2) |
| `RESOLUCION_TRAMITE` (emplácese, suspéndase, aprueba formalmente, desestima una oposición; incluye las que hoy descarta `unaPorExpediente`) | TRAMITE, o CIERRE si dispone el archivo | Fecha, qué dispone, fundamento literal |
| `TRAMITE_INTERNO` (carátula, pase, foliatura) | ESTRUCTURA | Fecha. En la carátula, además, el iniciador (nombre y DNI) |

**Expedientes anteriores a la Ley 9150.** Los expedientes iniciados antes de que rigiera la Ley 9150 pueden haberse tramitado bajo la Ley 9100. La investigación dice que la 9150 la derogó; el alcance de esa derogación está a cotejar. El padrón del Registro tiene anotaciones de 2003 y 2004 (SPEC, línea 480). Para esos expedientes, la lista de piezas de esta tabla y las bases del §7.2 no se aplican sin verificar. Hay que calibrarlo con muestras de 2003 y 2004 (§13.11).

**B. Antecedentes que aporta el rogante.** La base es el art. 10 de la Ley 9150 ("antecedentes documentales" [P]). Los tipos concretos salen de la práctica de la UEST y de otras jurisdicciones, que valen solo como referencia.

| Código | Rol | Qué se extrae, además de los campos comunes |
|---|---|---|
| `BOLETO_COMPRAVENTA` | ORIGEN | Vendedor, comprador, fecha del acto, fecha de certificación de firmas |
| `CESION_POSESORIA` | ORIGEN | Cedente, cesionario, fecha, si se hizo por escritura, desde cuándo dice poseer el cedente |
| `DOC_SUCESORIO` | ORIGEN | Causante, herederos, fecha |
| `TITULO_ANTECEDENTE` | INMUEBLE | Titular, matrícula |
| `ACTA_CONSTATACION` | FECHA | Fecha, quién ocupa, descripción |
| `BOLETA_TRIBUTO` | FECHA | Emisor, período, contribuyente, cuenta o nomenclatura |
| `SERVICIO` (factura o certificado del prestador) | FECHA | Emisor, período o "titular desde…", domicilio del suministro |
| `DNI_DOMICILIO` | FECHA | Fecha de emisión, domicilio |
| `OTRO_CON_DOMICILIO` | FECHA | Emisor, fecha, domicilio |
| `DOC_SENSIBLE` (salud, informe social u otro con datos especialmente protegidos) | FECHA | Solo `fecha_doc`, `fecha_tipo`, domicilio y `vinculo_persona`. `cita`, emisor y `json` quedan vacíos (§5.5) |
| `FOTOGRAFIA` | — | Solo se registra |
| `VACIA` | — | Solo se registra |
| `NO_IDENTIFICADO` | — | Va a revisión |

**Campos comunes a todos los tipos:**
- `fecha_doc`, siempre como `AAAA-MM-DD` (si el documento trae solo mes o año, el primer día del período), con `fecha_precision` (`DIA`, `MES` o `ANIO`), `fecha_tipo`, `periodo_desde` y `periodo_hasta`;
- emisor; titular (nombre y DNI); domicilio;
- cuenta, nomenclatura y matrícula;
- foja impresa;
- `cita`: el fragmento literal justo, de 200 caracteres como máximo;
- legibilidad, y si es manuscrito.

**`fecha_tipo` es la pieza que ordena todo.** Puede valer `EMISION`, `PERIODO`, `ACTO`, `CERTIFICACION` o `DECLARADA_EN_DOC`. Por qué importa:
- Una boleta de 1998 prueba que en 1998 alguien figuraba como contribuyente. No prueba que poseyera desde 1998.
- Un certificado que dice "titular desde abril de 2000" trae una fecha que declara el emisor.
- La fecha de un boleto es la de un acto.

El sistema no mezcla estas fechas (§6.3).

---

## 4. Cómo se lee

**En pocas palabras.** Funciona como un embudo:

1. Primero van los pasos gratis: mirar cada página y aplicar reglas sobre el texto.
2. Lo que las reglas no resuelven va al **modelo barato**.
3. Solo unos pocos documentos decisivos van a un **modelo más caro**, con un tope.

Cada paso guarda lo que hizo, así se puede cortar y retomar. Corre desde la línea de comandos y no desde el Embudo, porque son decenas de miles de cuerpos. El Embudo sigue funcionando como hoy.

```
inventario ──▶ 0 Prioridad (SQL, gratis)
PDF del cuerpo ──▶ 1 Perfil de página (gratis) ──▶ 2 Reglas por foja (gratis) ──▶ resueltas
                                                     │ sin texto, dudosas o sin campos
                                                     ▼
                                   3 Modelo barato (claude-haiku-5-5, Batch)
                                                     │ decisivas o dudosas, con tope
                                                     ▼
                                   4 Segunda lectura (claude-sonnet-5-5, Batch, opcional)
                                                     ▼
                     5 Documentos → importación → consolidación por expediente (§6 y §7)
```

### 4.1 Por dónde entran los cuerpos

> **Decisión:** los cuerpos entran por un programa de línea de comandos nuevo, `procesar_cuerpos.js`, y no por el Embudo. **Por qué:** el Embudo procesa de a un archivo, recalcula toda la base en cada carga (`pierri.js:424-428`) y copia cada PDF a `embudo/`, con un tope de 80 MB. Eso no aguanta cientos de miles de fojas.

**Detalle técnico.**

- **Ubicación de los PDF.** Los cuerpos viven en la carpeta que indique `config.json` (`carpetaCuerpos`). Se guarda la ruta relativa y **no se copian a `embudo/`**.
- **Identificación del expediente.**
  - El número sale del nombre del archivo (`expedienteDelNombre`).
  - Para todas las claves de las tablas nuevas y para los `JOIN` con `inventario` y `resoluciones` se usa **una sola normalización, con relleno a 6 dígitos**: la lógica de `normalizarExpediente` (`pierri.js:312`). Hoy `expInventario` (`pierri.js:178`), `expedienteDelNombre` y el CSV de digitalizados dejan 5 o 7 dígitos tal como vienen, y un cuerpo nombrado con 5 dígitos no cruzaría con su fila.
  - Cómo nombra Neura los archivos, y si un expediente viene en uno o en varios PDF, queda a calibrar. Si viene en varios, se agrupan por expediente.
- **El Embudo, sin cambios de uso.** Solo pasa a guardar los rangos de páginas de cuerpo de lo que se carga (§4.7), para leerlos más adelante sin volver a subirlos.
- **El programa nuevo no escribe en la base.** Abre `pierri.db` **en solo lectura** para leer el inventario, las prioridades y las huellas ya leídas, y escribe únicamente en su carpeta de salida. Después, `node pierri.js --importar-cuerpos` incorpora el resultado.
- **Clave de API.** `procesar_cuerpos.js` lee solo `ANTHROPIC_API_KEY` del entorno, o `config.json` local, que no se versiona. No tiene opción `--key`, porque lo que se escribe en la línea de comandos queda en el historial de la consola.
- **Importar con la aplicación cerrada.**
  - `node:sqlite` arranca con `busy_timeout` en 0. Una escritura concurrente da "database is locked": fallarían los pedidos del servidor o la importación.
  - `--importar-cuerpos` verifica que no haya nada escuchando en el puerto 3777, o toma un archivo de bloqueo. Si encuentra algo, se niega con un mensaje claro.
  - Opcional: `PRAGMA busy_timeout=5000` en los dos procesos.

> **Decisión:** salida a archivos más importación, no escritura directa en `pierri.db`. **Por qué:** es el mismo patrón que `procesar_lote.js` + `--importar`, que Balta ya usa, y así la base de producción tiene un solo proceso que escribe.

**Uso previsto, para la consola de Windows.** Las rutas son ejemplos. Nada de esto existe todavía.

```
node procesar_cuerpos.js perfilar --dir D:\cuerpos --salida D:\salida_cuerpos
node procesar_cuerpos.js reglas   --salida D:\salida_cuerpos
set ANTHROPIC_API_KEY=(pegar la clave acá, sin paréntesis)
node procesar_cuerpos.js enviar   --salida D:\salida_cuerpos --modelo claude-haiku-5-5 --simular
node procesar_cuerpos.js enviar   --salida D:\salida_cuerpos --modelo claude-haiku-5-5 --tope-usd 20
node procesar_cuerpos.js recoger  --salida D:\salida_cuerpos
node procesar_cuerpos.js segunda  --salida D:\salida_cuerpos --max-porcentaje 5
```

Antes de importar, cerrar la aplicación con **Ctrl+C**. Después:

```
node pierri.js --importar-cuerpos D:\salida_cuerpos
```

- **`--simular`** arma los pedidos sin mandarlos y muestra:
  - cuántos pedidos son y cuántas páginas llevan;
  - los tokens estimados por clase de página;
  - los dólares estimados;
  - los MB totales, la cantidad de lotes y el tiempo de subida estimado.
- **`--tope-usd`** deja de mandar lotes nuevos cuando el gasto estimado de la corrida llega al tope. Ningún lote pasa del 10% del tope (§9.7).
- **Cada subcomando es idempotente.** El estado vive en la carpeta de salida:
  - `paginas.jsonl`: perfil, ruta y huella de cada página, **sin texto**;
  - `lotes.json`, `lecturas.jsonl` y `uso.jsonl`.
- **`reglas` vuelve a extraer el texto del PDF** desde la ruta que guardó `perfilar`. El texto completo de las fojas no queda en disco (§5.5).
- **Se reanuda por huella, no por nombre.** `procesar_lote.js:149` reanuda por nombre de archivo, y eso no se repite acá.

### 4.2 Los pasos

**Paso 0. Prioridad (gratis).**

La cola se arma desde `inventario`, filtrando por `estado_digitalizacion`, `tiene_resolucion`, `cuenta_valida`, `anio` y `departamento`. También se puede filtrar por `estado_suac`, pero hoy ese dato existe solo para los no digitalizados (§7.1). Otra opción es una lista exportada de la vista Cuerpos (`--lista`). El orden lo decide Balta: es una decisión operativa, no jurídica.

Antes de gastar nada, `inventario.hojas` da las hojas reales de cada expediente. Con eso se reemplaza el supuesto de 20, 50 o 100 fojas del §9. Hay que filtrar por **valor exacto**, porque un filtro amplio mete a los 16.358 del SUAC (que tienen `hojas = 0`) y deja afuera a los 191 con resolución y cuerpo:

```sql
-- 1) Ver las etiquetas reales de Ypsilon
SELECT estado_digitalizacion, COUNT(*), SUM(hojas) FROM inventario GROUP BY 1;

-- 2) Hojas de los cuerpos, con las etiquetas exactas que devolvió la consulta 1
SELECT COUNT(*), SUM(hojas), AVG(hojas) FROM inventario
WHERE estado_digitalizacion IN ('<Solo cuerpo>', '<Resolucion+Cuerpo>') AND hojas > 0;
```

- Hay que informar la mediana y los percentiles 50, 90 y 99, no solo el promedio. Se calculan en JavaScript ordenando `hojas`. Los cuerpos largos son los que pasan el umbral de 100.000 tokens.
- **Hojas no son páginas.** El costo se cobra por página. Si Neura escaneó anverso y reverso, hay hasta dos páginas por hoja. La relación real se mide en las muestras y en el Paso 1.

**Paso 1. Perfil de página (`perfilarPdf(buf)`, gratis).** Para cada página registra:
- los caracteres útiles de la capa de texto, con `getTextContent` de pdfjs, como `textoPorPagina`;
- las imágenes de la página, leídas del diccionario `XObject` con pdf-lib: cantidad, `Width`, `Height`, `Filter` y `Length`, **sin decodificar**. No se usa `getOperatorList` de pdfjs, que decodifica cada imagen: sobre más de un millón de escaneos sería mucha CPU y memoria;
- los MB de la página;
- la huella;
- una clase: `TEXTO`, `IMAGEN`, `MIXTA` o `VACIA`.
  - `VACIA` incluye los **dorsos en blanco escaneados**: una página sin texto cuya imagen comprimida es muy chica para su área. Sin esta regla, un dorso en blanco quedaría como `IMAGEN` e iría al modelo.
  - Los umbrales entre clases quedan a calibrar.

Usa pdfjs-dist y pdf-lib, que ya están en `package.json`: **no agrega dependencias**. Se puede correr sobre todo el universo en cuanto se tengan los archivos. Contesta las preguntas que más pesan en el costo:
- si los cuerpos traen OCR;
- cuántas páginas hay por hoja;
- qué parte son dorsos en blanco;
- cuántos MB pesa cada página.

El tiempo de CPU queda a medir.

**Paso 2. Reglas por foja (carril texto, gratis).**
- Va en un módulo nuevo, `pierri_cuerpo.js`, con el mismo formato que `pierri_texto.js`: `clasificarFoja(texto)`, `extraerCampos(tipo, texto)`, `cuentasEnPagina(texto)`.
- **No toca** `extraerDeTexto` ni `tipoDocumento`, porque su lógica de suficiencia es de resolución.
- Reusa `RE_CTA`, `RE_CTA_SUELTA` y `apariciones`, que ya distinguen la cuenta del inmueble de la de un lindero. Para eso se agregan al `return` de `pierri_texto.js`, sin cambiar su comportamiento.
- **Fojas resolutivas.**
  - `RE_RESOLUTIVA` (`pierri_lector.js:58`) se pensó para bloques que ya empiezan con VISTO o con el número de expediente. Incluye `ORDENAR` y `ARTÍCULO 1`, que también aparecen en ordenanzas, certificados municipales, informes y escrituras.
  - Por eso, una foja se marca `RESOLUCION` solo si además cumple `RE_INICIO` o trae el sello o el número de resolución.
  - **La foja no se saltea.** Se clasifica, entra a `fojas` y a `documentos_cuerpo` con el rol que le corresponde (§3), y además se lista en `traspaso_resoluciones.jsonl`, por si hace falta leerla con `procesar_lote.js` como resolución.
  - Si la foja tiene texto, todo esto es gratis. Si no tiene, se lee una sola vez, en el carril de cuerpos. El traspaso al lector de resoluciones es una decisión explícita.
- Las palabras que identifican cada tipo (nombre del prestador, "cede y transfiere", "período", etc.) quedan **a calibrar con muestras**.

**Paso 3. Modelo barato (`claude-haiku-5-5` en Batch).**

Van al modelo:
- las fojas de clase `IMAGEN` o `MIXTA`;
- las fojas con texto que quedaron `NO_IDENTIFICADO`;
- las fojas de rol `ORIGEN` o `FECHA` a las que las reglas no les sacaron fecha y titular.

No van nunca:
- las fojas con texto clasificadas como `ESTRUCTURA` o `RESOLUCION`;
- las `VACIA`;
- las que ya se leyeron, según su huella (§4.5).

> **Decisión:** cada foja de imagen va al modelo **una sola vez**, y en el mismo pedido se clasifica y se extraen los datos. No hay un triaje previo con miniaturas. **Por qué:** sin rasterizar localmente, que exige una dependencia nueva, mandar una foja para clasificarla cuesta lo mismo que mandarla para leerla. La salida de una foja no candidata es mínima (`{pagina, tipo}`, unos 15 tokens).

**Cómo se arman los tramos.** Los pedidos llevan tramos de páginas armados con `recortarPaginas`, como hoy. Cada tramo se corta **por el menor de dos límites**:
- **≈80.000 tokens de entrada estimados**, según la clase de cada página. Por encima de 100.000, Haiku 5.5 cobra todo el pedido cinco veces más caro, también en Batch (§9.1).
- **≈28 MB en base64.** El límite es de 32 MB por pedido y el base64 agrega un 33%.

Detalles:
- **Tokens por clase.** Se miden en el piloto con `count_tokens`:
  - `IMAGEN`: la imagen;
  - `MIXTA`: la imagen más el texto de la capa, que se cobra aparte (1.500 a 3.000 tokens en una página típica);
  - `TEXTO`: solo texto.
- **Orden de magnitud por tramo:**
  - con 3.000 tokens por página entran unas 26 páginas;
  - con la imagen al tope (≈4.800), unas 16;
  - con una `MIXTA` de ≈5.800, unas 13.
- **Fojas `TEXTO` que igual van al modelo** (`NO_IDENTIFICADO` o sin campos): en el piloto se evalúa mandar solo su texto, como bloque de texto y sin el PDF. Es mucho más barato.
- **Control.** `recoger` revisa el `usage` de cada respuesta y avisa si algún pedido pasó de 100.000 tokens.
- **Lotes.** Se arman por debajo de ≈240 MB. El límite es de 256 MB.

**Paso 4. Segunda lectura (`claude-sonnet-5-5` en Batch, opcional).** Se decide en el piloto. Va solo lo que cumple alguna de estas reglas:
- un `BOLETO_COMPRAVENTA`, una `CESION_POSESORIA` o una `DDJJ_POSESION` con fecha dentro de los 24 meses alrededor del corte, o anterior al corte pero con confianza baja;
- un manuscrito ilegible para Haiku;
- fechas o titulares contradictorios dentro del mismo expediente;
- una pieza de cierre sin fundamento legible en un expediente con resolución `DESESTIMA`, `CANCELA` o `TRAMITE` ya leída;
- ARCHIVADO, INC o ANULADO cuentan como criterio solo si se confirma que hay digitalizados con ese estado (§7.1).

Tiene **un tope duro** (`--max-porcentaje`, 5% de las fojas por defecto). **Por qué el tope:** al 5%, la segunda lectura cuesta tanto como toda la primera pasada (§9.4).

**Paso 5. Documentos, importación y consolidación.**
- `agruparDocumentos` une las fojas consecutivas que forman un mismo documento (§4.3).
- La importación carga las tablas del §5.
- `pierri_evidencia.js` arma, por expediente, el rogante, los vínculos, la línea de tiempo, el estado propuesto (§6) y los motivos de cierre (§7).

### 4.3 Cortado en documentos

- Cada foja trae `continua_anterior`, sí o no, según las reglas o el modelo.
- `agruparDocumentos` une las fojas consecutivas del mismo tipo que continúan la anterior. Así se arreglan también los documentos partidos entre dos tramos del modelo.
- Las marcas de comienzo quedan **a calibrar con muestras**: encabezado de boleta, título del instrumento, carátula, sello de foliatura.
- La métrica que manda es el acierto en los límites de cada documento (§10).

### 4.4 El pedido al modelo

**Detalle técnico.**

**Función.** `leerConModelo(buf, {key, modelo, prompt, esquema, maxTokens, effort, thinking})`. Llamada sin parámetros nuevos hace exactamente lo de hoy: Haiku 4.5, `PROMPT_SISTEMA`, `max_tokens 3000` y `temperature 0`. La lectura de resoluciones no cambia.

**Parámetros según el modelo.** Fuente: skill `claude-api`, tabla del 06/10/2026. Hoy `leerConModelo` manda siempre `temperature: 0` (`pierri_lector.js:181`), y los modelos 5.5 responden con error 400 a una temperatura distinta de la de por defecto.

| Modelo | `temperature` | Razonamiento (`thinking`) | `effort` |
|---|---|---|---|
| `claude-haiku-4-5` (resoluciones, como hoy) | 0, como hoy | No se manda | No se manda (da error en este modelo) |
| `claude-haiku-5-5` | No se manda | Adaptativo por defecto. `{type: "disabled"}` solo con effort `high` o menor | Explícito; por defecto es `medium` |
| `claude-sonnet-5-5` | No se manda | `disabled` da 400. Para apagarlo: `{type: "between_tools"}`, solo con effort `high` o menor y sin otros campos | Explícito; empezar por `low` |
| `claude-opus-5-5` (solo para contrastar) | No se manda | No se puede apagar: `disabled` da 400 con cualquier effort | Es el único control |

- **Qué se compara en el piloto, con Haiku 5.5:** `output_config.effort: "low"` contra `thinking: {type: "disabled"}`.
- **Tokenizador.** Haiku 5.5 cuenta el mismo texto como ≈30% más tokens que Haiku 4.5. Hay que volver a medir con `count_tokens`.

**`max_tokens`.**
- Es proporcional a las páginas del tramo: unos 300 por página más un margen para el razonamiento, a calibrar. El razonamiento cuenta dentro de `max_tokens`, y 3.000 no alcanzan para un tramo largo.
- Si la respuesta llega con `stop_reason: "max_tokens"`, el JSON viene truncado. El tramo se parte en dos y se reintenta. Si vuelve a pasar, va a revisión.

**Rechazos.**
- Un `stop_reason: "refusal"` marca las fojas como `ERROR` y las manda a revisión manual.
- Haiku 5.5 no tiene respaldo automático del lado del servidor, y además el parámetro `fallbacks` no se acepta en Batch.
- En todos los casos se registra el uso del intento.

**Prompt.**
- `PROMPT_CUERPO` es nuevo y fijo. Vive en `pierri_cuerpo.js`, **no** en `pierri_core.js`, que está copiado literal en el Tablero (§10).
- Lleva **ejemplos inventados**, nunca datos reales, y `cache_control`. En Batch conviene la caché de 1 hora.
- Indica expresamente que de un `DOC_SENSIBLE` se devuelvan solo el tipo, la fecha y el domicilio, sin cita (§5.5).
- **Caché.** El mínimo cacheable de Haiku 5.5 es de 512 tokens, así que este prompt se cachea. En Haiku 4.5 el mínimo es de 4.096 tokens: el `PROMPT_SISTEMA` de hoy (≈4.000 a 5.000 tokens, estimado) puede no estar cacheando. Se confirma con los contadores desglosados de la Etapa 0.

**Salida con esquema** (`output_config.format`). Evita el reintento por JSON inválido, que hoy además pierde los tokens del intento fallido (`pierri_lector.js:200`). Batch acepta este parámetro. Que funcione en la práctica con este modelo se prueba en el piloto. Esquema orientativo, con valores inventados:

```json
{"fojas": [{"pagina": 3, "tipo": "BOLETA_TRIBUTO", "continua_anterior": false, "legible": true, "manuscrito": false}],
 "documentos": [{"desde": 3, "hasta": 3, "tipo": "BOLETA_TRIBUTO",
   "fecha_doc": "1998-03-01", "fecha_precision": "MES", "fecha_tipo": "PERIODO",
   "periodo_desde": "1998-01-01", "periodo_hasta": "1998-03-01", "emisor": "Municipalidad de Ejemplo",
   "titular_nombre": "Juan PÉREZ", "titular_dni": "10000000", "domicilio": "Calle Falsa 123",
   "cuenta": "110100000000", "nomenclatura": null, "matricula": null, "cita": "…"}],
 "cierre": null}
```

**Identificador de cada pedido.** `custom_id = <hash16>_<desde>_<hasta>`.
- Según la documentación de Batch (`docs/build-with-claude/batch-processing`, citada por la revisión técnica), tiene que cumplir `^[a-zA-Z0-9_-]{1,64}$`. Este formato entra; el `#` del id de hoy no.
- Los resultados de Batch llegan en cualquier orden y se enlazan por `custom_id`.

**Uso y costo.**
- Se guardan los cuatro contadores (`input`, `output`, `cache_read`, `cache_creation`) y el `stop_reason` **por pedido**, también en los intentos fallidos.
- El costo en USD se calcula con una tabla de precios **por defecto en el código**, con fecha y fuente, que `config.json` puede reemplazar.
- `enviar` se niega a correr si el modelo no tiene precio (§9.7).

**Batch.**
- Hasta 100.000 pedidos o 256 MB por lote.
- Vence a las 24 horas. Lo vencido no se cobra y vuelve a la cola.
- Los resultados quedan 29 días del lado del proveedor: `recoger` los baja en cuanto el lote termina.
- Batch acepta casi cualquier pedido de Messages. Quedan afuera, entre otros, `stream`, `speed`, `max_tokens: 0` y `fallbacks`.
- Si la Files API (`file_id`) funciona dentro de Batch, los pedidos se achican mucho. Se prueba en el piloto. Si se usa, `recoger` borra los archivos subidos.

### 4.5 No pagar dos veces

- **`huella`** = sha1 de los bytes crudos de las imágenes de la página más su texto normalizado. pdf-lib da los bytes sin decodificar.
- Antes de mandar un tramo, se buscan sus huellas en `fojas`. Si una página ya se leyó con el mismo `modelo` y la misma `version_prompt`, se reutiliza la lectura.
- **Límite:** detecta copias exactas (el mismo PDF con otro nombre, la superposición entre resolución y cuerpo). **Un reescaneo del mismo papel da otros bytes y no se detecta.** Cuánto ahorra queda a medir.
- **Cambiar el prompt no obliga a releer.** Las lecturas viejas conservan su `version_prompt`, y releer es una decisión explícita (`--releer-version`).

### 4.6 Fojas sin capa de texto: opciones

| Opción | Dependencia nueva | Cuándo |
|---|---|---|
| Pedirle a Neura los PDF con OCR (muchos escáneres lo generan solos) | No | **Preguntarlo ya.** Es la más barata de todas |
| Mandar el tramo recortado a Haiku 5.5 en Batch | No | Opción por defecto |
| OCR local (tesseract) | Sí | Lleva mucha CPU: ≈1,4 millones de fojas × ≈5 s ≈ 80 días de una PC (estimado; el doble si hay dorsos). Solo se justifica si **no** hay autorización para mandar cuerpos a la API: en ese caso es el único camino para las fojas sin texto |
| Rasterizar a baja resolución (canvas) | Sí | Solo si el piloto muestra que los tokens de imagen por foja están cerca del tope y que la miniatura sigue siendo legible |

### 4.7 Arreglos al lector actual (Etapa 0)

1. **`cortarTomo` devuelve también `rangosCuerpo`.**
   - **Hoy:** las páginas de cuerpo solo se cuentan (`pierri_lector.js:111-116`). Las resoluciones de trámite que descarta `unaPorExpediente` (emplazamientos, archivo, suspensión, desestimación de una oposición) desaparecen: no figuran en `unidades`, en `sueltas` ni en `paginasCuerpo`, y solo quedan contadas en `resolucionesTramite`.
   - **Cambio:** `rangosCuerpo` es el **complemento de las páginas de `elegidas`**, o sea, todo lo que no es la resolución conservada.
   - Los bloques resolutivos descartados se guardan además como `RESOLUCION_TRAMITE` o `PROVIDENCIA_ARCHIVO` propuestos, y pasan por `extraerMotivoCierre` (§7.1). Son justo las piezas de cierre que interesan.
   - Todo se guarda en `archivos_cuerpo` con origen `EMBUDO`.
2. **Un PDF sin parte dispositiva deja de mandar falsas "resoluciones" al modelo.**
   - **Hoy:** cuando ningún bloque tiene parte dispositiva, se devuelven todos los bloques (`pierri_lector.js:118-119`). El gasto inútil se da exactamente en los tomos **con capa de texto**, con el número de expediente al principio de cada foja y sin `RE_RESOLUTIVA`: terminan en el modelo **con el prompt de resolución**.
   - **Cambio:** si hay texto suficiente por página, el archivo queda como cuerpo y figura así en "Qué aportó cada archivo", para que se note si se escapó una resolución.
   - **Si no hay capa de texto, este arreglo no cambia nada.** Ojo: hoy un tomo de más de 6 páginas sin texto no produce ninguna unidad. Todas sus páginas quedan como "sueltas" y no se leen ni por texto ni por el modelo (probado con `cortarTomo` sobre 10 páginas vacías). Solo los PDF de 6 páginas o menos sin texto van al modelo. Es un tema aparte (§13.D).
   - El umbral se calibra con los 191 expedientes de resolución y cuerpo.
3. **`esTomo`.** Usa `> 6` (`pierri_lector.js:72`), pero la SPEC dice que un cuerpo tiene 6 o más hojas. Pasarlo a `>= 6` se decide con la regresión, porque cambia cómo se corta un PDF de 6 páginas.
4. **Tokens desglosados.** Hoy se guarda un solo entero (`pierri_lector.js:203`) y el costo no se puede reconstruir. `resoluciones.tokens` sigue como suma, por compatibilidad.

---

## 5. Qué se guarda

**En pocas palabras.**
- Todo lo nuevo va en **tablas nuevas** dentro de la misma base, `pierri.db`.
- Las tablas de hoy (resoluciones, archivos, inventario) **no se tocan**. Cambian solo tres consultas del mapa del Inventario, para que tomen las cuentas halladas (§5.2).
- Antes de cambiar la estructura de la base, el sistema hace solo una copia de respaldo.
- Los PDF de los cuerpos no se copian: se leen desde donde están.

### 5.1 Tablas

```sql
CREATE TABLE IF NOT EXISTS archivos_cuerpo (
  hash TEXT PRIMARY KEY, expediente TEXT, origen TEXT,        -- EMBUDO | CARPETA
  ruta TEXT, paginas INTEGER,
  rangos TEXT,                                                -- JSON [[desde,hasta],...]: complemento de la resolución conservada; vacío = todo el archivo
  paginas_con_texto INTEGER, version_reglas TEXT, procesado_en TEXT);

CREATE TABLE IF NOT EXISTS fojas (
  hash_archivo TEXT, pagina INTEGER, expediente TEXT, foja_impresa TEXT, huella TEXT,
  chars_texto INTEGER, imagenes INTEGER, filtro_imagen TEXT, ancho INTEGER, alto INTEGER, bytes INTEGER,
  clase TEXT,                                                 -- TEXTO | IMAGEN | MIXTA | VACIA
  tipo TEXT, rol TEXT, confianza TEXT, fuente TEXT,           -- fuente: TEXTO | MODELO | MANUAL
  continua_anterior INTEGER, estado TEXT,                     -- PERFILADA | REGLA_OK | PENDIENTE_MODELO | LEIDA | ERROR
  modelo TEXT, version_prompt TEXT, version_reglas TEXT, json_lectura TEXT,
  PRIMARY KEY (hash_archivo, pagina));
CREATE INDEX IF NOT EXISTS ix_fojas_huella ON fojas(huella);

CREATE TABLE IF NOT EXISTS documentos_cuerpo (
  id TEXT PRIMARY KEY,                                        -- hash16#desde
  expediente TEXT, hash_archivo TEXT, pag_desde INTEGER, pag_hasta INTEGER, foja TEXT,
  tipo TEXT, rol TEXT, confianza TEXT, fuente TEXT,
  fecha_doc TEXT,                                             -- siempre AAAA-MM-DD (primer día del período)
  fecha_precision TEXT,                                       -- DIA | MES | ANIO
  fecha_tipo TEXT, periodo_desde TEXT, periodo_hasta TEXT,
  emisor TEXT, titular_nombre TEXT, titular_dni TEXT, domicilio TEXT,
  cuenta TEXT, nomenclatura TEXT, matricula TEXT, manuscrito INTEGER, legibilidad TEXT,
  vinculo_persona TEXT,                                       -- ROGANTE | ESLABON | OTRA | SIN_DATO
  vinculo_inmueble TEXT,                                      -- CUENTA | NOMENCLATURA | MATRICULA | DOMICILIO | DISTINTO | SIN_DATO
  cita TEXT, json TEXT,                                       -- vacíos en DOC_SENSIBLE
  modelo TEXT, version_prompt TEXT,
  revision TEXT DEFAULT 'PROPUESTO',                          -- PROPUESTO | ACEPTADO | RECHAZADO | CORREGIDO
  motivo_revision TEXT, revisor TEXT, revisado_en TEXT, nota TEXT);
CREATE INDEX IF NOT EXISTS ix_doc_exp ON documentos_cuerpo(expediente);

CREATE TABLE IF NOT EXISTS eslabones (
  id INTEGER PRIMARY KEY, expediente TEXT, de_clave TEXT, a_clave TEXT,
  tipo TEXT,                                                  -- CESION | BOLETO | SUCESION | CONVIVENCIA (solo rótulo, §2.4)
  fecha TEXT, documento_id TEXT, revision TEXT DEFAULT 'PROPUESTO',
  revisor TEXT, revisado_en TEXT);

CREATE TABLE IF NOT EXISTS hallazgos_cuenta (
  id INTEGER PRIMARY KEY, expediente TEXT, cuenta TEXT, hash_archivo TEXT, pagina INTEGER,
  lado TEXT,                                                  -- INMUEBLE | LINDERO | SIN_MARCA
  cita TEXT, fuente TEXT, catastro_encontrada INTEGER,
  depto_coincide INTEGER,                                     -- decodificarCuenta(...).dep_nombre vs inventario.departamento con mismoNombre
  estado TEXT DEFAULT 'PROPUESTA',                            -- PROPUESTA | ACEPTADA | RECHAZADA
  revisor TEXT, revisado_en TEXT);

CREATE TABLE IF NOT EXISTS motivos_cierre (
  id INTEGER PRIMARY KEY, expediente TEXT,
  fuente TEXT,                                                -- INVENTARIO | RESOLUCION | CUERPO
  documento_id TEXT, resolucion_id TEXT, foja TEXT, fecha TEXT,
  cita TEXT,
  marca TEXT,                                                 -- CIERRE_SIN_FUNDAMENTO | SIN_PIEZA_DE_CIERRE (§7.2)
  categoria TEXT,                                             -- vacía hasta que exista el catálogo (§7.2)
  revision TEXT DEFAULT 'PROPUESTO', revisor TEXT, revisado_en TEXT);

CREATE TABLE IF NOT EXISTS expedientes (
  expediente TEXT PRIMARY KEY,                                -- 0535-nnnnnn-aaaa, normalizado a 6 dígitos (§4.1)
  estado_inventario TEXT,
  rogante_clave TEXT, rogante_fuente TEXT,                    -- RESOLUCION | INVENTARIO | CUERPO
  rogante_doc TEXT,                                           -- documento del cuerpo del que sale, si la fuente es CUERPO
  cuenta TEXT, cuenta_fuente TEXT,                            -- INVENTARIO | RESOLUCION | CUERPO
  posee_desde_resolucion TEXT, posee_desde_ddjj TEXT, ddjj_doc TEXT,
  indicio_rogante TEXT, indicio_rogante_doc TEXT, indicio_cadena TEXT, indicio_cadena_doc TEXT,
  indicios_revisados INTEGER, estado_propuesto TEXT, senales TEXT,
  ultima_actuacion_tipo TEXT, ultima_actuacion_fecha TEXT,
  fojas_total INTEGER, fojas_modelo INTEGER, usd REAL,
  decision TEXT,                                              -- A_ESTUDIAR_PIERRI | SIN_SEGUIMIENTO | CONSULTAR (§6.7)
  decision_por TEXT, decision_en TEXT, decision_nota TEXT,
  version_lector TEXT, consolidado_en TEXT, json TEXT);       -- json = línea de tiempo

CREATE TABLE IF NOT EXISTS lotes_api (
  batch_id TEXT PRIMARY KEY, etapa TEXT, modelo TEXT, pedidos INTEGER, bytes INTEGER,
  usd_estimado REAL, estado TEXT, creado_en TEXT, terminado_en TEXT);

CREATE TABLE IF NOT EXISTS uso_modelo (
  custom_id TEXT PRIMARY KEY, batch_id TEXT, etapa TEXT, expediente TEXT, hash_archivo TEXT,
  desde INTEGER, hasta INTEGER, modelo TEXT, version_prompt TEXT, estado TEXT, stop_reason TEXT,
  entrada INTEGER, salida INTEGER, cache_lectura INTEGER, cache_escritura INTEGER,
  usd_estimado REAL, error TEXT, fecha TEXT);
```

> **Decisión:** los tokens se guardan **por pedido** (`uso_modelo`), no por documento. **Por qué:** un pedido lleva un tramo de varias fojas con varios documentos. El costo por expediente se suma desde ahí.

> **Decisión:** los datos extraídos van en la misma fila del documento (`documentos_cuerpo`), sin una tabla aparte de "evidencias". **Por qué:** cada documento se revisa una sola vez, y lo que sí es una relación entre personas (la cadena) ya tiene su tabla, `eslabones`.

### 5.2 Reglas de escritura

- **Se escribe con `INSERT` y `UPDATE`, nunca con `INSERT OR REPLACE`.** Esa es la trampa de `insRes` (`pierri.js:134-136`), que borra la revisión al reescribir la fila.
- **Releer un expediente reemplaza solo las filas en `PROPUESTO`.** Lo que una persona aceptó, corrigió o rechazó se conserva. Si una lectura nueva corta los documentos distinto y se superpone con uno ya revisado, se marca para revisión.
- **No se agrega ninguna columna a `archivos`.** `insArchivo` inserta 7 valores por posición (`pierri.js:133` y `:902`): una columna más rompería el código viejo y el nuevo.
- **No se escribe en `inventario`.** Cada carga del CSV borra y reescribe su origen (`invBorrarOrigen`, `pierri.js:149, 335`), así que una cuenta guardada ahí se perdería. Se cruza con `JOIN`.
- **No se escribe en `resoluciones`.**
- **Cuentas aceptadas.** Hacen falta dos cosas:
  1. Se suman a `invCuentasSinParcela` (`pierri.js:163`) con un `UNION`, para que se consulten en Catastro y queden en `parcelas`.
  2. Hay que cambiar `invPorLocalidad`, `invUbicadas` e `invPendientes` (`pierri.js:169-174`). Hoy cruzan por `p.cuenta = i.cuenta`, y para estos expedientes `i.cuenta` es NULL, así que no aparecerían en el mapa ni en las tarjetas. Pasan a cruzar por `COALESCE(i.cuenta, h.cuenta)`, con un `LEFT JOIN` a `hallazgos_cuenta h` en estado `ACEPTADA`, o mediante una vista `inventario_cuentas`.
- **Una sola clave de expediente** en todas las tablas nuevas (§4.1).

### 5.3 Migración y respaldo

- Hoy no hay versión de esquema. Se agrega una, guardada en **`PRAGMA user_version`**.
  - No va en la tabla `meta`, porque `/api/vaciar` hace `DELETE FROM meta` (`pierri.js:718`). En el arranque siguiente, `migrar` creería que está en la versión 0, volvería a correr todo y haría otro respaldo.
  - `node:sqlite` lee `user_version` (verificado en la revisión técnica).
- Se agrega `migrar(db)`, con pasos numerados. **Cada paso solo crea tablas o índices: nunca borra ni modifica.**
- Antes del primer paso pendiente, el servidor hace `fs.mkdirSync('respaldos', {recursive: true})` y después `VACUUM INTO 'respaldos/pierri_antes_v<N>_<fecha>.db'`. Sin la carpeta, `VACUUM INTO` falla. Es SQLite puro, sin dependencias.
- **Como la migración solo agrega, el código viejo abre la base nueva.**
- `/api/vaciar` se amplía para incluir las tablas nuevas, y su confirmación avisa cuántas lecturas pagas se pierden.

### 5.4 Disco

- Los cuerpos no se duplican. Cada foja se recorta en el momento con `recortarPaginas` cuando alguien la quiere ver.
- Las 7.083 resoluciones ocupan alrededor de 1 GB. Los cuerpos escaneados pueden ocupar decenas de GB (a calibrar, con los MB por página del Paso 1).

### 5.5 Datos personales

Los cuerpos suman datos de **terceros**: cedentes, titulares de servicios, testigos, oponentes.

- **Dónde vive todo.** En `pierri.db` y en la carpeta de salida, las dos fuera del repositorio.
  - Hay que sumar al `.gitignore`: `*.db` (cubre los respaldos), `respaldos/`, `*.jsonl`, `muestras/` y `salida_cuerpos/`.
  - Hoy la base se excluye solo por el nombre `pierri.db`, así que un respaldo `.db` entraría al repositorio.
  - Los `verdad_*.csv` ya están cubiertos por `*.csv`.
- **Cuánto texto se guarda.**
  - `cita`: 200 caracteres como máximo. No se guarda el texto entero de las boletas.
  - `paginas.jsonl` no guarda texto: `reglas` lo vuelve a extraer del PDF cada vez (§4.1).
- **Datos especialmente protegidos.** Un cuerpo puede traer certificados médicos, informes sociales o constancias de discapacidad.
  - La Ley 25.326 art. 2 incluye entre los datos sensibles la "información referente a la salud" [P]. La cita la aportó la revisión jurídica; hay que cotejarla en InfoLEG.
  - Independientemente de esa cita, el diseño minimiza: de esas fojas se guardan solo el tipo (`DOC_SENSIBLE`), la fecha y el domicilio, sin cita, sin emisor y sin `json`.
  - `PROMPT_CUERPO` lo indica expresamente.
- **Ver fojas.** Abrir una foja requiere el permiso `revisar` (editor y admin). El veedor ve la ficha, los rótulos y las fechas, pero no abre las fojas (§8).
- **Exportaciones.** Las planillas no incluyen terceros ni citas, salvo que se pidan.
- **Prompts, muestras y verdades.** Los ejemplos de los prompts nuevos son inventados. Las muestras y las verdades viven fuera del repositorio.
- **Autorización.** Mandar cuerpos a la API requiere dos cosas (SPEC §13, ABIERTO):
  - la autorización escrita de la UEST y la EGG;
  - la revisión de los términos de uso de datos de la API.

  La autorización que prevé la SPEC es para resoluciones. Para los cuerpos **tiene que nombrar expresamente los cuerpos y los datos de terceros**. Sin ella corre solo el carril texto, y las fojas sin texto quedan pendientes. Los resultados de Batch quedan 29 días del lado del proveedor.
- **Detectado al relevar (fuera de este diseño).** Hoy hay datos reales versionados (§13.26):
  - en `pierri_core.js:704-751` (ejemplos del prompt: nombres, DNI y testigos);
  - en `evaluar_motor.js:15`;
  - en `docs/SPEC.md`, incluido un número de expediente real con la antigüedad declarada de esa persona (SPEC:117-118).

  Conviene resolverlo aparte. Ojo: borrarlos del archivo no los borra del historial de git.

---

## 6. Cómo se arma la evidencia y la propuesta

**En pocas palabras.**
- Primero se identifica al rogante: de la resolución, del inventario o, si no hay otra cosa, de la carátula o la declaración jurada del cuerpo.
- Cada documento se vincula, o no, con el rogante y con el inmueble.
- Con los documentos vinculados se arma una línea de tiempo.
- El documento más antiguo pasa a ser el **indicio** y se compara con el 1/1/2006. Además se muestra si hay documentos entre 2006 y 2008, los tres años que pide la ley.
- El resultado es una **propuesta**: una persona revisa cada documento y decide sobre el expediente.

La clasificación de la resolución no cambia. El expediente tiene su propio estado, que corre en paralelo. Por ejemplo, una desestimatoria sigue siendo NO_APLICA como resolución, pero su expediente puede quedar "con indicio anterior al corte".

### 6.1 Rogante y vínculos (`pierri_evidencia.js`)

Son funciones puras, como las de `pierri_core.js`. Las corre solo el servidor, así que **no hay que pegarlas en el Tablero**, a diferencia de `pierri_core.js`.

- **`claveDePersona({nombre, dni})`.** El DNI sin ceros a la izquierda. Si no hay DNI, el nombre pasado por `normalizarTexto` con las palabras ordenadas, igual que `CAMPOS_CONTROL.rogante`.
- **El rogante**, en este orden:
  1. **RESOLUCION:** la resolución leída.
  2. **INVENTARIO:** `iniciador` y `dni`. Ojo: hoy `cargarInventario` los deja en NULL para las filas de Ypsilon (`pierri.js:344-347`). Solo existen para los expedientes sin digitalizar, que vienen del SUAC (`pierri.js:349-353`).
  3. **CUERPO:** nombre y DNI de la carátula o de la `DDJJ_POSESION`, en estado `PROPUESTO` y revisables. Mientras nadie lo revise, el expediente lleva la señal `ROGANTE_SIN_REVISAR`.
  4. **Ninguno:** el estado es `SIN_ROGANTE`, no `SIN_INDICIOS`. Sin rogante no se puede calcular `indicio_rogante`.

  Para casi todo el universo de este diseño (los "solo cuerpo"), el rogante va a salir del cuerpo hasta que llegue el export del SUAC para los digitalizados (§12). La Etapa 0 lo mide gratis.
- **`vincularPersona(doc, cadena)`** devuelve `ROGANTE`, `ESLABON` (la persona aparece en la cadena), `OTRA` o `SIN_DATO`.
- **`vincularInmueble(doc, exp)`** devuelve:
  - `CUENTA`: 12 dígitos iguales, con la misma validación que usa el inventario;
  - `NOMENCLATURA`, `MATRICULA` o `DOMICILIO`;
  - `DISTINTO`;
  - `SIN_DATO`.

  Cómo normalizar los domicilios, sobre todo los rurales, queda a calibrar.

Es una comparación de datos, no un criterio jurídico.

### 6.2 Cadena

- **`armarCadena(eslabones, rogante)`** arranca en el rogante y va hacia atrás por los eslabones. Corta los ciclos y marca los eslabones que quedan sueltos.
- **No suma posesiones.** Solo muestra quién le pasó el inmueble a quién y cuándo. Si la antigüedad del cedente o del causante cuenta para el rogante es una pregunta abierta (§13.3).
- `CONVIVENCIA` aparece como rótulo, sin evaluar el requisito de los dos años (§2.4).

### 6.3 Qué fecha de cada documento cuenta para el indicio

- **Cuentan** las fechas que el documento acredita de sí mismo: `EMISION`, `PERIODO` (se toma `periodo_desde`), `ACTO` y `CERTIFICACION`.
- **`DECLARADA_EN_DOC` no cuenta.** Por ejemplo, "el cedente poseía desde 1980". Se muestra en la línea de tiempo como declaración. **Por qué:** una fecha que alguien declara no es la fecha de un documento.
- **Boleto o cesión con fecha del acto y fecha de certificación.** El indicio usa la más antigua y muestra las dos. Cuál vale es pregunta abierta (§13.4). **Por qué la más antigua:** cada propuesta la revisa una persona, y perder un caso es peor que proponer uno de más.
- **Precisión.**
  - `fecha_doc` se guarda siempre como `AAAA-MM-DD`, con `fecha_precision` al lado.
  - `parseFecha` (`pierri_core.js:56-69`) no acepta `AAAA-MM` y devuelve null, así que la conversión va en `pierri_evidencia.js`, **sin tocar `parseFecha`**, que está copiada en el Tablero.
- **Validaciones.** No se aplican las de `pierri_core.js:320-336`, que exigen fechas de 2003 en adelante: una boleta puede ser de los años sesenta.

### 6.4 Cuatro fechas por expediente

Ninguna absorbe a las otras.

| Fecha | De dónde sale | Qué es |
|---|---|---|
| `posee_desde_resolucion` | La resolución (lector actual) | Lo que la UEST tuvo por cierto |
| `posee_desde_ddjj` | La DDJJ de la Ley 9150 del cuerpo | El origen y la fecha que declaró el rogante (Ley 9150 art. 10 [P]). No es la DDJJ del art. 6 a de la Ley 24.374 (§2.1) |
| `indicio_rogante` | Documentos del rogante | El más antiguo que vincula **al rogante** con el inmueble por `CUENTA`, `NOMENCLATURA`, `MATRICULA` o `DOMICILIO` |
| `indicio_cadena` | Documentos de cedentes o causantes | Lo mismo, para los eslabones de la cadena |

- **Un documento con vínculo de inmueble `SIN_DATO` no sostiene un indicio.** El indicio, por definición, vincula a una persona con un inmueble. Si el documento `SIN_DATO` más antiguo es anterior al corte, se agrega la señal `INDICIO_SIN_INMUEBLE` para que lo vea quien revisa.

**`armarLineaTiempo(exp, docs, cadena)`:**
- arma un tramo por cada persona de la cadena, del primer al último documento de rol `FECHA`;
- muestra los eslabones como hitos, y la DDJJ y las resoluciones como marcas;
- **sombrea la franja del 1/1/2006 al 31/12/2008**, los tres años del art. 1 [T];
- muestra los **huecos** en años, **sin umbral**. La ley pide posesión "continua" [T] pero no dice qué hueco la interrumpe.

> **Decisión:** los indicios se calculan con los documentos **no rechazados** (propuestos y aceptados), y `indicios_revisados = 1` solo si el documento que sostiene el indicio fue aceptado. **Por qué:** si se calcularan solo con documentos aceptados, ningún caso subiría a la lista para revisar. La marca "sin revisar" impide confundir una propuesta con un hecho.

### 6.5 Comparación con el corte

- Cada fecha se compara con el corte de la ley vigente, **forzando la regla**: `evaluarElegibilidad(fecha, {...cfgElegibilidad(), regla: 'CORTE_FIJO'})`.
  - `cfgElegibilidad()` (`pierri.js:78`) lee la regla de `config.json`, que se cambia desde `/api/config` y admite `PLAZO_MOVIL`, el Proyecto PE-13/26. Un proyecto no es ley: el lector de cuerpos nunca lo usa.
  - El margen de borde de 12 meses queda como está.
- La respuesta se traduce a **ANTERIOR, POSTERIOR o BORDE** antes de mostrarla. La palabra "elegible" no aparece.
- El texto en pantalla toma la fecha del campo `fechaLimite` del resultado, no la escribe fija:

  *"Hay documentación anterior al {fechaLimite} vinculada al rogante. Es un indicio, no posesión acreditada: verificarla le corresponde a la autoridad de aplicación (Ley 24.374 art. 6 b), y la reglamentación de la Ley 8932 no está dictada."*
- Junto al resultado, la ficha aclara que el corte supone que la adhesión de la Ley 8932 alcanza la reforma que llevó la fecha al 1/1/2009 (§2.2, pregunta 12).

### 6.6 Estados propuestos y señales

**`estado_propuesto`:**
- `SIN_CUERPO_DIGITALIZADO`: los 16.358 sin digitalizar y los 2.963 con resolución y sin cuerpo.
- `SIN_CUERPO_LEIDO`
- `SIN_ROGANTE`: hay cuerpo leído, pero no se pudo identificar al rogante por ninguna fuente (§6.1).
- `SIN_INDICIOS`
- `INDICIO_ROGANTE_ANTERIOR_AL_CORTE`
- `INDICIO_SOLO_EN_CADENA_ANTERIOR_AL_CORTE`. Su peso depende de la pregunta sobre continuadores (§13.3).
- `INDICIOS_POSTERIORES_AL_CORTE`

**`senales`** (marcas, no estados):
- `INDICIO_EN_BORDE`
- `INDICIO_SIN_REVISAR`
- `INDICIO_SIN_INMUEBLE`: hay un documento del rogante o de la cadena anterior al corte, pero sin cuenta, nomenclatura, matrícula ni domicilio que lo ate al inmueble.
- `SIN_INDICIO_2006_2008`: no hay documentos vinculados al rogante ni a la cadena con fecha entre el 1/1/2006 y el 31/12/2008. Es un hecho, no un juicio sobre la continuidad (§13.6).
- `ROGANTE_SIN_REVISAR`: el rogante salió del cuerpo y nadie lo revisó todavía.
- `CONTRADICCION`
- `HUECO_SIN_INDICIOS`
- `DOCUMENTO_DE_TERCERO`
- `INMUEBLE_DISTINTO`
- `CUENTA_RECUPERADA`
- `MANUSCRITO`
- `ILEGIBLE`
- `FECHA_DECLARADA_ANTERIOR`: la DDJJ o una cesión declara una fecha anterior al indicio.

> **Decisión:** `CONTRADICCION` es una señal y no un estado. **Por qué:** si fuera un estado, un expediente contradictorio con indicio anterior al corte quedaría escondido detrás de la contradicción.

Por ahora, `CONTRADICCION` se marca solo cuando cambia el titular o la cuenta entre documentos. La diferencia en años entre la DDJJ y los documentos se muestra, pero no se marca hasta que Balta fije a partir de cuántos años importa (§13.5).

### 6.7 El sistema propone, una persona decide

- **Revisión de cada documento, eslabón, cuenta, motivo o rogante propuesto:** `ACEPTAR`, `RECHAZAR` o `CORREGIR`.
  - Motivos de rechazo: no es el inmueble, no es la persona, la fecha se leyó mal, está mal clasificado, ilegible.
  - Se puede corregir el tipo, la fecha, el titular y la cuenta.
  - Cada acción pasa por `auditar`.
- **Decisión sobre el expediente:** `A_ESTUDIAR_PIERRI`, `SIN_SEGUIMIENTO` o `CONSULTAR`, con nota obligatoria.
  - Las tres son decisiones de **priorización interna de la EGG**. Ninguna es una desestimación ni una declaración de elegibilidad: esas le corresponden a la autoridad de aplicación (Ley 24.374 art. 6 b), que en Córdoba es la UEST (Ley 9150 art. 35 [P]).
  - `A_ESTUDIAR_PIERRI` es una marca interna de estudio, no el inicio de un trámite.
  - **El lector nunca escribe `decision`.** Quién decide es pregunta abierta (§13.10).
- **Lo que la ficha muestra sin evaluar:** los requisitos del art. 1 (causa lícita; posesión pública, pacífica y continua; inmueble edificado urbano; casa habitación única y permanente) y "Art. 4 a: no evaluado".
- **Lo que no cambia:** `clasificar`, `evaluarElegibilidad`, `TIPOS_NO_EVALUABLES`, `posee_desde`, la clasificación y la planilla.

> **Decisión:** las desestimatorias **no** pasan a un estado nuevo tipo "baja a analizar" dentro de la clasificación de resoluciones. **Por qué:** que no apliquen fue una decisión de Balta del 20/09, y le corresponde a él cambiarla. Lo nuevo corre en paralelo, en `expedientes`.

---

## 7. Motivo de baja, archivo o desestimación

**En pocas palabras.** El sistema junta, por separado, lo que dice cada fuente sobre por qué se cerró el expediente:

- el inventario: el estado del SUAC, que **hoy existe solo para los expedientes sin digitalizar**;
- el fundamento de la resolución;
- las providencias, resoluciones de trámite y requerimientos del cuerpo.

Guarda siempre el texto literal y la foja. **No inventa categorías:** el catálogo de motivos lo arma Balta con la UEST después de leer casos reales. Desde el primer día marca solo un hecho: **"se cerró sin decir por qué"**. Cuando llegue el estado del SUAC de los digitalizados, marcará además **"el SUAC dice archivado o anulado y en el cuerpo leído no aparece ninguna pieza de cierre"**.

Ojo: mientras no llegue ese export, el motivo de baja de un cuerpo sale solo del propio cuerpo y de las resoluciones ya leídas.

### 7.1 Tres fuentes, sin unificar

1. **INVENTARIO:** `estado_suac` y `estado_digitalizacion`.
   - "Baja", INC-incompleto, ARCHIVADO, ANULADO y "sin estado" no aparecen en la ley ni en el decreto relevados [NV]. Podrían estar definidos en instructivos de la UEST (Decreto 586/04 art. 8 [T]).
   - Hasta saberlo (§13.9), el sistema los muestra tal como vienen, sin asignarles una causa. INC-incompleto y "sin estado" se muestran como "estado del SUAC: INC-incompleto (significado a confirmar)".
   - Hoy `estado_suac` existe solo para las filas del SUAC de faltantes (`pierri.js:349-353`). La Etapa 0 lo confirma con `SELECT estado_digitalizacion, estado_suac, COUNT(*) FROM inventario GROUP BY 1, 2`.
2. **RESOLUCION:** una función nueva, `extraerMotivoCierre(texto)`, toma el fundamento literal de los considerandos.
   - Se aplica a las resoluciones `DESESTIMA`, `CANCELA` y `TRAMITE`, y a las resoluciones de trámite que hoy descarta `unaPorExpediente` (§4.7). No toca `extraerDeTexto`. Hoy solo se guarda el verbo.
   - **No es del todo gratis.** La base no guarda el texto de las resoluciones, solo `extraido` y `derivado`. Hay que releer los PDF de `embudo/` con `textoPorPagina`, recortando con `r.tomo` cuando corresponda.
   - Hay que informar cuántas `DESESTIMA`, `CANCELA` o `TRAMITE` no tienen capa de texto. Esas, si se quieren, van al modelo con un prompt corto, con su costo estimado antes.
3. **CUERPO:** providencias de archivo, resoluciones de trámite, requerimientos (y si tuvieron respuesta en fojas posteriores), oposiciones y mediaciones.

Una contradicción entre fuentes es información útil. Por ejemplo, cuando haya estado del SUAC para los digitalizados: el SUAC dice ARCHIVADO y en el cuerpo leído no hay ninguna providencia.

### 7.2 Catálogo

> **Decisión:** `categoria` arranca vacía. Solo se llenan **marcas de hecho**, y el borrador de categorías de abajo no se aplica hasta que Balta lo apruebe. **Por qué:** un catálogo impuesto antes de leer casos reales sería normativa inventada.

**Marcas de hecho (`marca`):**
- **`CIERRE_SIN_FUNDAMENTO`:** hay una pieza de cierre (providencia de archivo, resolución desestimatoria o cancelatoria) que no dice por qué.
- **`SIN_PIEZA_DE_CIERRE`:** se marca solo si se cumplen las tres condiciones:
  - el cuerpo se leyó completo (el estado no es `SIN_CUERPO_DIGITALIZADO` ni `SIN_CUERPO_LEIDO`);
  - el inventario trae ARCHIVADO o ANULADO;
  - en las fojas leídas no apareció ninguna providencia de archivo, resolución ni oposición.

  **Si no hay cuerpo leído no se marca nada:** se muestra "sin cuerpo para verificar". Con los datos de hoy esta marca no se dispara, porque los digitalizados no tienen estado del SUAC. Requiere el export del §12.
- **INC-incompleto y "sin estado" no se tratan como cierre** hasta que se responda §13.9. "Incompleto" puede ser un trámite en curso al que le falta algo.

**Borrador de categorías**, para discutir después de leer entre 100 y 200 bajas:

| Categoría | Base |
|---|---|
| `OPOSICION_MEDIACION_NEGATIVA` | Ley 9150 art. 17 [T]; numeración a cotejar (§13.11) |
| `CANCELACION_PEDIDO_TITULAR` | Frase [T] ("se cancelarán ante el requerimiento del titular dominial…") que figura en el texto de la Ley 9100 (derogada) que publica Catastro y en copias atribuidas a la Ley 9150. Por su redacción parece referirse a cancelar anotaciones ya registradas, no a archivar el trámite. **No se usa hasta confirmar que está en la 9150 vigente (§13.11)** |
| `PARCELA_CON_POSESION_REGISTRADA` | Ley 9150 art. 15: "no podrá registrarse otra sobre la misma parcela" [T]; numeración a cotejar (§13.11) |
| `FALSEAMIENTO` | No se relevó en la Ley 9150 una causal de archivo por falsedad. La DDJJ del art. 9 queda encuadrada en el art. 293 del Código Penal [P], pero eso no es una causal de archivo. Se transcribe lo que diga la resolución o la providencia |
| `REQUERIMIENTO_SIN_RESPUESTA` | El requerimiento tiene base (Decreto 586/04 art. 9 [T]; emplazamiento para el plano [T]). Que no responder lleve al archivo **no** surge de lo relevado |
| `REQUISITOS_NO_REUNIDOS` | Sin base relevada en la Ley 9150. La facultad de desestimar por requisitos es de la Ley 24.374 art. 6 b. Se transcribe lo que dice la resolución |
| `DESISTIMIENTO` | Sin base relevada; a calibrar |
| `OTRO` | Texto libre |

En los expedientes tramitados bajo la Ley 9100 (§3), estas bases no se aplican sin verificar.

### 7.3 Lo que se muestra al lado del motivo

Junto a cada motivo, el sistema pone los documentos del cuerpo relacionados. Por ejemplo:
- si se archivó por falta de plano, si hay un plano en fojas posteriores;
- si hubo un requerimiento, si hay una respuesta después.

El requerimiento (rol `TRAMITE`) se muestra como documento relacionado, no como causa del cierre.

**El sistema no decide si el motivo se puede subsanar.**

---

## 8. Qué ve Balta en el Tablero

**En pocas palabras.** Una pantalla nueva, **Cuerpos**, con:
- todos los expedientes del inventario, tengan o no resolución (hoy un expediente sin resolución no tiene fila);
- la ficha de cada uno, con su línea de tiempo y botones para ver la foja, aceptar o rechazar cada documento y anotar la decisión.

Lo de todos los días no cambia.

> **Decisión:** la vista nueva se llama **Cuerpos** (`v-cuerpos`) y no "Expedientes". **Por qué:** ya existe una vista `expedientes` en `VISTAS` (`tablero_pierri.html:1373`), la que lista resoluciones.

**Lista.**
- Paginada desde el servidor (`GET /api/cuerpos?filtro=&pagina=`). No pasa por `/api/datos`, que manda todo al navegador.
- Incluye a los 16.358 sin digitalizar, que se ven solo con su `estado_suac`.
- Filtros:
  - estado propuesto, incluido `SIN_ROGANTE`;
  - "indicio anterior al corte", rotulado **"indicio, no elegibilidad"**;
  - sin indicio en 2006-2008;
  - cerrado sin fundamento; sin pieza de cierre (solo cuando haya estado del SUAC para digitalizados);
  - motivo;
  - cuenta hallada sin revisar;
  - documentos o rogante por revisar;
  - departamento;
  - cuerpo leído o no.
- Botón **"Pedir escaneo"**: exporta los 2.963 expedientes con resolución y sin cuerpo, solo con su número y una columna que dice si la resolución leída ya trae la cuenta.

**Ficha** (`GET /api/expediente?exp=`):
- el rogante y de dónde salió;
- las cuatro fechas del §6.4;
- los requisitos del art. 1 y "Art. 4 a: no evaluado", junto con el supuesto del corte (§6.5);
- la línea de tiempo: una barra por persona, los eslabones como hitos, los huecos en gris y la franja 2006-2008 sombreada;
- los documentos, con los botones de revisión y "ver foja" (abre el tramo en el visor del propio navegador, sin librería nueva; solo para perfiles con `revisar`);
- los motivos de cierre, separados por fuente;
- la decisión, con nota obligatoria y la aclaración del §6.7.

**Otras pantallas:**
- **Inventario:** una tarjeta "Cuenta hallada en el cuerpo: propuestas / aceptadas".
- **Ficha de resolución actual:** un enlace "ver expediente".
- **Gasto del modelo:** un panel dentro de Cuerpos con fojas, porcentaje de fojas que fue al modelo, tokens desglosados y USD, por lote, por etapa y por expediente.

**Rutas y permisos.** Se suman al mapa `necesita` (`pierri.js:669-671`) y a `auditar`. Perfiles de hoy (`pierri.js:585`): `ver` = veedor, editor y admin; `revisar` = editor y admin.

| Ruta | Permiso |
|---|---|
| `GET /api/cuerpos`, `GET /api/expediente`, `GET /api/cuerpos/costo` | `ver` (todos los perfiles) |
| `GET /api/cuerpo/pdf?hash=&desde=&hasta=` | `revisar` (editor y admin). El veedor no abre fojas: los cuerpos traen copias de DNI de testigos y cedentes, facturas y, eventualmente, datos de salud. Toda apertura queda en la auditoría como `ver_documento` |
| `POST /api/cuerpo/revision {objeto: documento\|eslabon\|cuenta\|motivo\|rogante, id, accion, motivo, cambios}` | `revisar` |
| `POST /api/expediente/decision` | A definir (§13.10); provisoriamente `revisar` |
| Importación de cuerpos | Solo por línea de comandos, con la aplicación cerrada |

---

## 9. Costo

**En pocas palabras.**
- **Cuánto costaría leer los 27.634 cuerpos**, como orden de magnitud:
  - desde unos USD 50 hasta unos USD 1.750 con los supuestos de §9.3;
  - hasta unos **USD 2.300** si cada página llega al tope de imagen y se suma un 30% de margen.
- **De qué depende.** Sobre todo de tres cosas que todavía no sabemos:
  - si los escaneos traen texto;
  - cuántas páginas tiene un cuerpo en promedio;
  - si se escanearon anverso y reverso. En ese caso se cuentan páginas y no hojas, y el número **puede duplicarse**.
- **Con el modelo y la forma de mandar de hoy**, lo mismo costaría entre USD 2.500 y USD 12.400.
- **No se gasta nada en volumen** antes de un piloto de unos **USD 19 a 27** que mida los números reales y de que Balta apruebe el presupuesto medido.

### 9.1 Precios

En USD por millón de tokens, API directa de Anthropic.

| Modelo (id exacto) | Entrada | Salida | Lectura de caché | Batch (entrada / salida) | Uso en este diseño |
|---|---|---|---|---|---|
| `claude-haiku-5-5` | 0,10 (pedido ≤100K tokens) · 0,50 (>100K) | 0,50 · 2,50 | 0,1× entrada | 0,05 / 0,25 (≤100K) · 0,25 / 1,25 (>100K) | Clasificar y extraer en volumen |
| `claude-haiku-4-5` (el de hoy, `-20251001`) | 1 | 5 | 0,10 | 0,50 / 2,50 | Sigue para resoluciones; no para cuerpos |
| `claude-sonnet-5-5` | 2 | 10 | 0,10 según la página oficial; 0,20 según el skill | 1 / 5 | Segunda lectura, con tope |
| `claude-opus-5-5` | 4 | 20 | 0,20 | 2 / 10 | Solo, si acaso, para contrastar en el piloto |

**Fuentes:**
- https://platform.claude.com/docs/en/about-claude/pricing, consultada el 13/10/2026.
- Skill `claude-api` (tabla del 06/10/2026, que confirma los precios de entrada y salida y el umbral de 100K de Haiku 5.5).
- La diferencia en la lectura de caché de Sonnet no afecta las cuentas, porque acá la caché no abarata las imágenes.
- Esta tabla queda también en el código como valores por defecto, con fecha y fuente (§9.7).

**La trampa de Haiku 5.5:** si un pedido pasa de 100.000 tokens de entrada, **todo** el pedido se cobra cinco veces más caro, también en Batch. Por eso existe el tope de cada tramo (§4.2).

### 9.2 Cómo se cobra una página

Fuentes: documentación de Anthropic (`docs/build-with-claude/vision`, `pdf-support` y `batch-processing`).

- **PDF.** Cada página se convierte en imagen y además se extrae su texto. Se cobran las dos cosas.
  - El texto de una página típica suma 1.500 a 3.000 tokens.
  - En un escaneo sin OCR, el texto es casi nulo y manda la imagen.
- **Imagen.** Cuesta ≈ ⌈ancho/28⌉ × ⌈alto/28⌉ tokens.
  - Una A4 a unos 150 ppp (1.240 × 1.754 px) son ≈2.835 tokens.
  - En los modelos nuevos el tope es de ≈4.784 tokens por imagen. Que Haiku 5.5 esté en ese grupo es una deducción: se verifica con `count_tokens`.
- **Límites.**
  - 32 MB por pedido, contando el base64 (+33%). Un escaneo color o gris a 300 ppp pesa 0,5 a 2 MB por página.
  - Batch: 100.000 pedidos o 256 MB por lote.
  - Para cientos de miles de páginas son muchos lotes y muchos GB subidos desde la red del Gobierno. `--simular` lo cuantifica.
- **Caché.** Sirve solo para el prompt fijo. Las fojas no se repiten entre expedientes.
- **Se cobra por página, no por hoja.**

### 9.3 Fórmula y supuestos (a calibrar con muestras)

```
Costo por página = (T_imagen + T_texto + T_prompt / k) × P_entrada + T_salida × P_salida
```

donde k es la cantidad de páginas por pedido.

**Supuestos:** 3.000 tokens de entrada efectivos por página (imagen más la parte del prompt) y 300 de salida. **No incluyen el texto de la capa**, que suma en las páginas `MIXTA` (§9.5).

| Modelo | Costo por página |
|---|---|
| Haiku 5.5, sin Batch | 3.000 × 0,10/10⁶ + 300 × 0,50/10⁶ = **USD 0,00045** |
| Haiku 5.5, Batch | **USD 0,000225** |
| Sonnet 5.5, sin Batch | USD 0,009 |
| Sonnet 5.5, Batch | **USD 0,0045** |
| Haiku 4.5, sin Batch (como hoy) | USD 0,0045 |

**Universo:** 27.634 cuerpos.
- Con un promedio de 20, 50 o 100 páginas por cuerpo, son 552.680, 1.381.700 o 2.763.400 páginas.
- El promedio real sale de `inventario.hojas` (§4.2, Paso 0), multiplicado por la relación páginas/hojas que se mida en las muestras.

### 9.4 Escenarios para los 27.634 cuerpos, en USD

| Escenario | 20 págs./exp. | 50 | 100 |
|---|---|---|---|
| **Optimista:** cuerpos con OCR; 20% de las páginas a Haiku 5.5 y 1% a Sonnet 5.5, ambos en Batch | 50 | 124 | 249 |
| **Pesimista:** solo imagen; 100% a Haiku 5.5 y 5% a Sonnet 5.5, ambos en Batch | 249 | 622 | 1.244 |
| Pesimista más 30% de margen (ajustes de prompt, relecturas, errores) | 323 | 808 | 1.617 |
| **Pesimista con la imagen al tope** (≈4.800 tokens de entrada por página) | 348 | 870 | 1.741 |
| Pesimista con la imagen al tope, más 30% de margen | 453 | 1.132 | 2.263 |
| *Comparación:* 100% con Haiku 4.5 sin Batch, como hoy, sin segunda lectura | 2.487 | 6.218 | 12.435 |

- En los escenarios con segunda lectura, Sonnet pesa la mitad del total. Por eso existe su tope.
- El escenario optimista **subestima**: las páginas con OCR que van al modelo son `MIXTA` y pagan además su texto (§9.5).

### 9.5 Sensibilidad

- **Razonamiento.** Si la salida sube a 1.000 tokens por página, Haiku 5.5 pasa a USD 0,0008 por página (+78%). Se controla con `effort` o desactivándolo (§4.4).
- **Texto de la capa en páginas `MIXTA`.** Suma 1.500 a 3.000 tokens por página: el escenario optimista sube entre 30% y 60%.
- **Imagen al tope.** Ya está en la tabla: la entrada sube alrededor de 60% y el tramo baja a unas 16 páginas.
- **Pedidos de más de 100.000 tokens.** Cuestan cinco veces más.
- **Anverso y reverso.** Con hasta dos páginas por hoja, todo se duplica, salvo los dorsos en blanco que el Paso 1 detecte como `VACIA`.
- **Bytes.** Más MB por página significan más lotes y más tiempo de subida. No cambian el precio por token.
- **Triaje con miniaturas.** Si se adoptara (requiere rasterizar, que es una dependencia nueva), costaría ≈USD 0,000065 por página: USD 36, 90 o 180 para 20, 50 o 100 páginas, y la mitad en Batch. Solo si el piloto lo justifica.

### 9.6 Piloto y etapa de la cuenta

- **Piloto:** los 40 cuerpos del §12, de unas 50 páginas (≈2.000 páginas), sin Batch.

  | Modelo | Con 3.000 tokens por página | Con la imagen al tope |
  |---|---|---|
  | Haiku 5.5 | ≈ USD 0,9 | ≈ USD 1,3 |
  | Sonnet 5.5 | ≈ USD 18 | ≈ USD 25 |
  | **Total** | **≈ USD 19** | **≈ USD 27** |

  - Sumar Opus 5.5 para contrastar agrega ≈ USD 36 a 50. Es opcional, porque la verdad se carga a mano igual.
  - Si hay dorsos, el número de páginas sube; se ajusta con el perfil (Paso 1) antes de correr.
- **Cuenta de los 3.688 (Etapa 3), tope estimado.** Si cada uno tuviera 20 páginas sin texto y se leyeran todas con Haiku 5.5:
  - unos **USD 33**, o **USD 17** en Batch;
  - con la imagen al tope, ≈ USD 23 en Batch.

### 9.7 Control del gasto

1. **`enviar --simular`** antes de cada corrida grande: tokens, USD, MB, cantidad de lotes y tiempo de subida.
2. **`--tope-usd`** por corrida. Además, **cada lote se limita al 10% del tope**: un lote ya enviado se cobra entero.
3. **Precios por defecto en el código**, con fecha y fuente, que `config.json` puede reemplazar. `enviar` **se niega a correr** si el modelo no tiene precio, para que el gasto estimado nunca dé 0 y el tope nunca deje de cortar.
4. **Un Workspace y una clave de API propios** para este trabajo, con límite de gasto en la Console.
   - Es un techo duro. Según la revisión técnica, la documentación de Batch avisa que un lote puede pasar levemente ese límite.
   - Además separa el costo del lector de resoluciones.
5. **Panel "Gasto del modelo"** (§8).
6. **Ningún lote masivo** sin el presupuesto aprobado por Balta con números del piloto.

---

## 10. Cómo se mide la calidad

**En pocas palabras.** Alguien de la Escribanía lee a mano las muestras y anota qué hay. Esa es la "verdad". Para que sea realista, la verdad tiene dos niveles:
- **por expediente, en los 40 cuerpos:** el motivo de baja y su foja, el indicio más antiguo y la cuenta;
- **foja por foja, solo en 10 a 12 cuerpos:** la mitad para calibrar y la mitad a ciegas.

El sistema se compara contra esa verdad **en expedientes que no vio antes**. Lo que más importa no es acertar todo, sino **no perder documentos que prueban**: un documento de más lo descarta quien revisa; uno de menos no lo ve nadie.

**Detalle técnico.**

**Verdades**, fuera del repositorio:

| Archivo | Alcance | Columnas |
|---|---|---|
| `verdad_expediente.csv` | Los 40 cuerpos | expediente, rogante (nombre y DNI), motivo literal, foja del motivo, indicio_rogante, indicio_cadena, cuenta |
| `verdad_cuenta.csv` | 50 para calibrar y 50 a ciegas (Etapa 3) | expediente, cuenta, foja |
| `verdad_fojas.csv` | 10 a 12 cuerpos | expediente, desde, hasta, tipo, fecha_doc, fecha_precision, fecha_tipo, titular_dni, cuenta |

**Medición.** `evaluar_motor.js --modo cuenta|fojas|expediente`.
- `CAMPOS_CONTROL_CUERPO` y su comparador viven en `pierri_cuerpo.js` (o en `evaluar_motor.js`), **sin tocar `pierri_core.js`**.
- **Se corrige el denominador.** Hoy la exactitud por campo divide por todos los casos, aunque el campo no esté cargado en la verdad (`evaluar_motor.js:89-91`, `pierri_core.js:635`). Pasa a contar solo los casos en que la verdad tiene el dato.
  - **Ojo: cambian los porcentajes de hoy, y hay que avisarlo.**
  - Como toca `pierri_core.js`, obliga a **reensamblar `tablero_pierri.html`**, que lleva una copia literal (líneas 377-1183, SPEC:16), y a verificar con un diff entre `pierri_core.js` y el bloque embebido.

**Métricas:**

| Métrica | Qué mide |
|---|---|
| **Fojas probatorias perdidas** (la que manda) | Boletas, facturas, boletos o cesiones clasificadas como otra cosa, incluidas las que la regla de fojas resolutivas (§4.2, Paso 2) marcó como `RESOLUCION` |
| **Cuentas de lindero tomadas como propias** | El error caro: ubica la parcela de al lado |
| Límites de documento | Aciertos en el corte de páginas |
| Tipos | Matriz de confusión |
| Campos | Exactitud campo por campo (fecha, `fecha_tipo`, titular, cuenta) |
| Rogante | Si identificó al rogante cuando no hay resolución |
| Motivo de baja | Si encontró la foja correcta |
| Indicio | Año del indicio más antiguo por expediente |
| Costo | Porcentaje de páginas que van al modelo; tokens y USD por expediente |

**Cómo se reparte la muestra.** La mitad sirve para calibrar. La otra mitad no se mira hasta la medición a ciegas. Un cambio que mejora un caso y rompe otro no es una mejora.

**Regresión del lector actual,** en cada etapa que lo toque:
- `banco_pruebas_texto.js` tiene que seguir en 23 de 23.
- Los 60 PDF de `embudo_prueba.zip` y un lote real, procesados antes y después, tienen que dar el mismo `resultados.jsonl`, salvo los campos nuevos (comparación campo por campo).
- Hay que abrir el Tablero y verificar que las vistas de hoy cargan igual.

---

## 11. Etapas

**En pocas palabras.** Cada etapa deja algo útil aunque las siguientes no se hagan. Todo va en una rama aparte y llega a la copia de Balta recién cuando pasó su prueba. Mientras tanto, el sistema se sigue usando como hoy.

### Etapa 0. Cimientos (sin muestras, sin gasto)

**Qué sale:**
- `leerConModelo` con parámetros y la tabla por modelo (§4.4).
- Contadores de uso desglosados en `uso_modelo`, incluidos los intentos fallidos y el `stop_reason`.
- `cortarTomo` con `rangosCuerpo` como complemento de la resolución conservada. Las resoluciones de trámite descartadas quedan guardadas (§4.7).
- Los cuerpos con texto dejan de ir al prompt de resolución (§4.7).
- La decisión sobre `esTomo`.
- `PRAGMA user_version`, `migrar(db)`, respaldo automático (creando la carpeta) y tablas vacías.
- `.gitignore` ampliado.
- Una sola normalización de la clave de expediente (§4.1).
- **Consultas gratis:**
  - etiquetas reales de `estado_digitalizacion`, y hojas de los cuerpos con mediana y percentiles (§4.2, Paso 0);
  - `estado_suac` por `estado_digitalizacion`, para confirmar que los digitalizados no lo tienen (§7.1);
  - cuántos "solo cuerpo" no tienen iniciador: `SELECT COUNT(*) FROM inventario WHERE estado_digitalizacion = '<Solo cuerpo>' AND iniciador IS NULL`;
  - cuántos de los 3.077 sin cuenta válida y con resolución (SPEC, línea 123) ya tienen la cuenta en la resolución leída (`inventario` JOIN `resoluciones`). Incluye los ≈114 con resolución y cuerpo que están entre los 3.688 (3.077 − 2.963).
- Vista Cuerpos mínima: el inventario con `estado_suac` y el botón "Pedir escaneo".
- Si se toca `pierri_core.js`: reensamblar el Tablero y verificar con diff (§10).

**Cómo se prueba:** con la regresión del §10.

**Qué necesita:** que Balta corra la regresión en su máquina, porque el banco vive fuera del repositorio.

**Útil sola:**
- deja de gastar en falsas resoluciones;
- muestra cuánto cuesta cada lectura;
- guarda los rangos de cuerpo de todo lo que se cargue desde hoy;
- dice cuántas hojas hay de verdad, y de dónde va a salir el rogante.

### Etapa 1. Lo que sale casi gratis

**Qué sale:**
- `extraerMotivoCierre` sobre las desestimatorias, cancelatorias y de trámite ya cargadas, releyendo los PDF de `embudo/` (§7.1). Es el primer listado de fundamentos, con la fuente RESOLUCION. Las que no tienen texto se informan aparte, con su costo estimado si se quieren leer con el modelo.
- `perfilar` sobre los cuerpos, en cuanto se tengan en disco:
  - porcentaje real con OCR;
  - páginas por hoja y dorsos en blanco;
  - MB por página;
  - páginas reales.

**Cómo se prueba:** `verdad_expediente.csv` (motivo y foja) sobre 50 resoluciones de baja.

**Qué necesita:**
- acceso a una copia de los cuerpos, para el perfil;
- para las resoluciones sin texto que vayan al modelo, las mismas condiciones que hoy rigen para leer resoluciones.

**Útil sola:** el primer mapa de por qué se cerraron los casos, y los números que definen el presupuesto.

### Etapa 2. Piloto con muestras

**Qué sale:**
- tipos y palabras clave calibrados;
- `PROMPT_CUERPO` v1;
- verdades armadas a mano, en dos niveles (§10);
- tokens reales por página y por clase (`count_tokens`);
- tamaño de tramo, en tokens y en MB;
- comparación de Haiku 5.5 contra Sonnet 5.5, y de `effort` contra `thinking` desactivado;
- prueba práctica de la salida con esquema y de `file_id` dentro de un lote.

Termina con un **informe del piloto y un presupuesto medido**.

**Costo:** ≈ USD 19 a 27.

**Qué necesita:**
- las muestras (§12);
- la autorización de datos que nombre los cuerpos y los datos de terceros, y la revisión de los términos de uso (§5.5). Sin ella, el piloto corre solo por texto;
- que Balta valide la lista de tipos.

### Etapa 3. La cuenta que falta (3.688 con cuerpo y sin cuenta)

**Qué sale:** filas en `hallazgos_cuenta`.
- **Carril texto:** `cuentasEnPagina`.
- **Validación gratis:**
  - el departamento de la cuenta coincide con `inventario.departamento`. Se compara `decodificarCuenta(cuenta, tabla).dep_nombre` con `mismoNombre(...)`, no un código contra un nombre;
  - `consultarCatastro` encuentra la parcela;
  - si aparecen varias cuentas distintas del inmueble, no se propone ninguna.
- **Carril modelo:** solo para fojas sin texto, con un prompt corto.
- **La cuenta aceptada entra al mapa:** `invCuentasSinParcela` con `UNION`, más las tres consultas del mapa con `COALESCE` o la vista `inventario_cuentas` (§5.2).

**Cómo se prueba:** `verdad_cuenta.csv`, con 50 expedientes para calibrar y 50 a ciegas. Métricas: cuenta exacta, porcentaje sin hallazgo y **cuentas de lindero tomadas como propias**.

**Costo:** ≤ USD 17 en Batch (≈ 23 con la imagen al tope).

**Qué necesita:** la autorización escrita de la UEST y la EGG para mandar cuerpos con datos de terceros a la API, y la revisión de los términos de uso de datos de la API (SPEC §13). Sin ella corre solo el carril texto (`cuentasEnPagina` y las reglas), y las fojas sin texto quedan pendientes.

**Útil sola:** parcelas ubicadas en el mapa y el cruce con Catastro para miles de expedientes.

### Etapa 4. Qué es cada foja

**Qué sale:** `fojas` y `documentos_cuerpo`.
- Se empieza por los 191 con resolución y cuerpo, que se pueden contrastar con lo ya leído.
- Después, por la prioridad que fije Balta.

**Cómo se prueba:** `verdad_fojas.csv`, con matriz de confusión. Manda la métrica de fojas probatorias perdidas.

**Qué necesita:** la misma autorización y la misma revisión de términos que la Etapa 3. Sin ellas corren solo las reglas sobre las fojas con texto, y las demás quedan pendientes.

### Etapa 5. Evidencia, motivos del cuerpo, revisión y decisión

**Qué sale:**
- `pierri_evidencia.js` (§6), incluido el rogante tomado del cuerpo;
- motivos desde el cuerpo (§7);
- la ficha completa con revisión y decisión (§8).

**Qué necesita:** las respuestas jurídicas del §13 para pesar la cadena, las fechas y los huecos. **Sin ellas, el sistema muestra evidencia, no conclusiones**, y sigue siendo útil.

### Etapa 6. Lote completo

Por prioridad, con `--tope-usd` y el panel de gasto vigilando cada lote.

**Orden tentativo:**
1. Expedientes con resolución `DESESTIMA`, `CANCELA` o `TRAMITE` ya leída y con cuerpo. ARCHIVADO, INC o ANULADO entran en este grupo solo si se confirma que hay digitalizados con ese estado (§7.1).
2. El resto de los "solo cuerpo".

Los 3.688 sin cuenta ya pasaron en la Etapa 3.

**Qué necesita:** el presupuesto aprobado, la autorización de datos y la revisión de términos.

### Cómo actualiza Balta su copia sin perder la base

En la carpeta del sistema (por ejemplo `C:\pierri`) hay tres cosas que **no se tocan nunca**: `pierri.db`, `embudo\` y `config.json`. Todo lo demás es código.

1. Cerrar la aplicación con **Ctrl+C**. Así SQLite pasa a la base lo que quedó en el archivo `-wal`.
2. Copiar la base a otra carpeta:
   ```
   mkdir C:\respaldos_pierri
   copy C:\pierri\pierri.db C:\respaldos_pierri\pierri_2026-10-13.db
   ```
3. Actualizar el código:
   - si la carpeta es un clon de git, con `git pull` (el `.gitignore` protege la base, el embudo y la configuración);
   - si vino en un zip, reemplazando solo `pierri*.js`, `procesar_*.js`, `evaluar_motor.js`, `tablero_pierri.html` y los `.json` de tablas.
4. Abrir `2_abrir.bat`. El servidor detecta el esquema viejo, hace su propio respaldo en `respaldos\`, migra y avisa: "Base actualizada a la versión N; respaldo en …".
5. Si algo falla, volver al código anterior. Como la migración solo agrega tablas, el código viejo abre la base nueva. Si hace falta, se copia el respaldo como `pierri.db`.

**Para importar cuerpos** (`node pierri.js --importar-cuerpos ...`), la aplicación tiene que estar cerrada. Si está abierta, la importación se niega y lo avisa.

Los PDF se cargan al sistema, **nunca** al repositorio de git.

---

## 12. Qué hace falta de Balta y de la UEST

**Muestras.** 40 cuerpos (30 como mínimo), guardados fuera del repositorio en `muestras\`.

Hoy los digitalizados no tienen estado del SUAC. Por eso los grupos se arman con lo que sí se sabe de ellos:

| Grupo | Cantidad | Para qué |
|---|---|---|
| De los 191 con resolución y cuerpo, con resolución que ordena la inscripción | 8 | Contrastar con lo ya leído |
| De los 191, con resolución desestimatoria, cancelatoria o de trámite. Si no alcanzan, se completan con el grupo siguiente | 8 | Motivos de baja |
| Solo cuerpo, elegidos al azar | 8 | Qué hay en un expediente sin resolución, y de dónde sale el rogante |
| Solo cuerpo con estado ARCHIVADO, INC o ANULADO en el SUAC, si el export de digitalizados permite identificarlos. Si no, solo cuerpo de 2003 a 2006 | 8 | Expedientes detenidos o cerrados; expedientes de la época de la Ley 9100 |
| De los 3.688 con cuerpo y sin cuenta | 8 | Etapa 3 |

- Que haya años distintos (2003-2004, y antes y después de 2010) y departamentos distintos (Capital y alguno rural).
- Que haya escaneos con y sin capa de texto, si existen los dos.
- **La mitad, elegida al azar, no se abre hasta la medición a ciegas.**
- **Verdad.** En los 40, la verdad por expediente. Foja por foja, solo en 10 a 12 (§10).

**De Neura o la UEST:**
- **El export del SUAC (iniciador, DNI y estado) para los 35.096 digitalizados**, o para el universo entero. Es el pedido que ya está abierto en la SPEC §11 octies (línea 512).
  - Sin él, el rogante de los "solo cuerpo" sale solo del cuerpo (§6.1).
  - La marca `SIN_PIEZA_DE_CIERRE` no se puede usar (§7.2).
- Cómo se exportan los cuerpos en masa, cómo se llaman los archivos (si el nombre trae el expediente) y si un expediente viene en uno o en varios PDF.
- **Si escanearon anverso y reverso**, y cuántas páginas hay por hoja.
- **Si pueden entregar los PDF con OCR.** Es la forma más barata de bajar el costo.
- Escanear los cuerpos de los 2.963 expedientes que tienen resolución y no tienen cuerpo. La lista sale del botón "Pedir escaneo".
- Los instructivos internos de la UEST sobre bajas, archivos e INC, si existen. El Decreto 586/04 art. 8 la habilita a dictarlos [T].
- Qué significa "En universo" y qué son los 27.443 "solo cuerpo": nunca resueltos, archivados, o resueltos con la resolución sin escanear (SPEC:508, ABIERTO).

**De Balta:**
- **La autorización escrita de la UEST y la EGG** para mandar cuerpos con datos de terceros a la API, y la revisión de los términos de uso de datos de la API (SPEC §13, ABIERTO).
  - La autorización tiene que nombrar expresamente los cuerpos y los datos de terceros, no solo las resoluciones.
  - Sin ella, todo corre solo por texto o con OCR local.
- Un Workspace y una clave de API propios para este trabajo, con límite de gasto (§9.7).
- La validación de la lista de tipos del §3, durante el piloto.
- La aprobación del presupuesto medido, antes de la Etapa 6.
- El orden de prioridad de los lotes.
- Las respuestas jurídicas del §13.A, a medida que se puedan, con Irene y Amelia cuando corresponda.

---

## 13. Abierto

### A. Jurídicas (para Balta, Irene y Amelia)

1. **Indicios de posesión y causa lícita.** ¿Qué documentos tomarían la UEST o la EGG como indicio? ¿Usamos la lista del §3 B como lista de trabajo, rotulada "referencia"?
2. **Ocupación de hecho.** ¿La ocupación de hecho sin boleto cuenta como causa lícita? ¿Con qué criterio la marca el sistema?
3. **Continuadores.** ¿La antigüedad del cedente o del causante cuenta para el rogante? La ley dice "continuadores de dicha posesión" [T] sin definir el alcance. La SPEC lo deja "a definir con Irene/Amelia". Qué inciso del art. 2 es cuál está en §2.4 y en el punto 31.
4. **Fecha de un documento privado.** Un boleto o una cesión sin firmas certificadas, ¿vale con su propia fecha o con la de la certificación?
5. **Fechas que no coinciden.** Si la DDJJ, la resolución y los documentos difieren, ¿qué fecha va como principal? ¿A partir de cuántos años de diferencia se marca `CONTRADICCION`?
6. **Huecos y continuidad.** ¿Hay algún criterio sobre cuánto tiempo sin documentos importa, o los huecos solo se muestran? En particular, ¿qué peso tiene la falta de documentos entre 2006 y 2008 (`SIN_INDICIO_2006_2008`)?
7. **Testigos.** ¿Los testigos de la DDJJ de la Ley 9150 cuentan como prueba para Pierri?
8. **Expedientes cerrados.** Un expediente 9150 desestimado o archivado, ¿puede ser candidato a Pierri si la documentación alcanza?
   - Igual haría falta una solicitud y una DDJJ nuevas (Ley 24.374 art. 6 a), cuyo contenido incluye "todo otro requisito que fije la reglamentación" [P].
   - La reglamentación de la Ley 8932 no está dictada: este diseño no afirma que el trámite pueda hacerse sin ella.
9. **Estados del inventario.** ¿Qué significan en la práctica "baja", INC-incompleto, ARCHIVADO, ANULADO y "sin estado"? ¿INC es un trámite en curso o un cierre?
10. **Revisión y decisión.** ¿Quién revisa los documentos y quién marca la decisión interna sobre el expediente?
11. **Textos oficiales.**
    - ¿Tenés el texto oficial de los arts. 9, 10, 13, 14, 15, 16, 17 y 35 de la Ley 9150? Las copias los numeran distinto.
    - ¿Sigue vigente el Decreto 586/04 sin cambios?
    - La frase sobre cancelación a pedido del titular, ¿está en la 9150 vigente o solo en la Ley 9100?
    - Los expedientes iniciados antes de la Ley 9150, ¿se tramitaron bajo la Ley 9100? ¿Qué alcance tuvo la derogación? ¿Les corresponden las mismas piezas y causales?
12. **Alcance de la adhesión.** La Ley 8932 es de 2001. ¿Su adhesión alcanza las reformas de las Leyes 26.493 y 27.118? Esto define **el corte mismo**: si no las alcanzara, la fecha no sería el 1/1/2006, porque el texto original decía "1 de enero de 1992" [T]. Define también los inmuebles rurales de agricultores familiares.
13. **Casos detenidos.** Hay expedientes 9150 detenidos con una antigüedad declarada muy vieja (hay un ejemplo en SPEC:117-118). ¿Se tratan como candidatos prioritarios?

### B. Operativas (UEST y Neura)

14. **Formato de los cuerpos.** Exportación en masa, nombres de archivo, uno o varios PDF por expediente, OCR.
15. **Providencias de archivo.** ¿Están en el cuerpo, o solo en el SIA o el SUAC?
16. **Autorización de datos personales** (SPEC §13), con mención expresa de los cuerpos y los datos de terceros, y la revisión de los términos de uso de datos de la API.
17. **Export del SUAC para los digitalizados** (iniciador, DNI y estado). Sin él no hay rogante del inventario ni marca `SIN_PIEZA_DE_CIERRE` para los cuerpos.
18. **Páginas por hoja.** ¿Se escanearon anverso y reverso?

### C. Técnicas (se contestan con el perfil y el piloto)

19. **Las que más pesan en el costo:**
    - si los cuerpos traen capa de texto;
    - páginas por cuerpo (mediana y percentiles) y páginas por hoja;
    - tokens reales por página según su clase;
    - MB por página.
20. **Sobre las fojas:**
    - si la foja impresa coincide con la página del PDF;
    - cómo se ve el corte entre documentos;
    - qué tipos aparecen, con qué frecuencia y cuántos son manuscritos;
    - en qué fojas está la cuenta y en cuáles el rogante.
21. **Sobre la API:**
    - si funcionan en la práctica, dentro de un lote, la salida con esquema y `file_id`;
    - si Haiku 5.5 usa el tope de imagen de ≈4.784 tokens;
    - `custom_id` se considera resuelto (§4.4).
22. **Sobre el triaje y el carril texto:**
    - si una miniatura alcanza para clasificar (solo importa si se adopta rasterizar);
    - si conviene mandar solo el texto de las páginas `TEXTO`;
    - cómo normalizar domicilios rurales;
    - los umbrales de texto por página, para la clase `TEXTO` y para el arreglo del §4.7;
    - el umbral de bytes por área para detectar dorsos en blanco.
23. **`esTomo`:** si pasa de `> 6` a `>= 6`.

### D. Detectadas al relevar (fuera de este diseño)

24. **Cifras.** La SPEC:508 dice 33.331 / 1.765 y la captura del 13/10/2026 dice 33.310 / 1.746. Además, 35.096 digitalizados − 33.310 − 1.746 = 40 sin el dato de universo.
25. **Tolerancia del cruce texto-modelo.** La SPEC §8 dice ±40 días y el código usa 120 (`pierri_core.js:331`).
26. **Datos reales versionados** en `pierri_core.js:704-751`, `evaluar_motor.js:15` y `docs/SPEC.md`, incluido el número de expediente con su antigüedad declarada de SPEC:117-118. Hay que resolverlo aparte, teniendo en cuenta el historial de git.
27. **Caché del lector actual.** Con Haiku 4.5 puede no estar funcionando: el mínimo es de 4.096 tokens y el prompt mide ≈4.000 a 5.000 (estimado). Se confirma con los contadores de la Etapa 0.
28. **Otros caminos del lector actual:**
    - `POST /api/releer` relee solo por texto y pisa lo que leyó el modelo (`pierri.js:769`).
    - `completarConModelo` recorre `embudo/` entero por cada registro (`pierri.js:470`).

    No bloquean este diseño, pero conviene anotarlos.
29. **El corte exacto.** `evaluarElegibilidad` compara con `<` (`pierri_core.js:176`), así que una posesión iniciada el 1/1/2006 exacto queda afuera, aunque el art. 1 [T] admite leerlo como "a más tardar". Observación para la SPEC §7. No se cambia la regla en este diseño.
30. **Tomos escaneados sin OCR cargados por el Embudo.** Un PDF de más de 6 páginas sin capa de texto no produce ninguna unidad: todas sus páginas quedan como "sueltas" y no se leen ni por texto ni por el modelo. Hoy se pierden en silencio, con solo el aviso de páginas sueltas (§4.7).
31. **Continuadores en la SPEC.** La SPEC §7 (línea 390) cita "art. 2 inc. c" para los continuadores. Según la investigación, "continuadores de dicha posesión" es el inc. d [T], y el c son los convivientes [P]. Hay que cotejar el texto oficial y unificar.
32. **"Inmueble edificado" en la SPEC §9.** Al agregar la cita del art. 1, limitarla a lo urbano (§2.4).
33. **Clave de expediente.** `expInventario` y `expedienteDelNombre` no rellenan con ceros; `normalizarExpediente` sí. Afecta también al lector actual, no solo a este diseño.

### E. Dudas sobre la revisión (observaciones aplicadas en parte o con cambios)

34. **Continuadores.** La revisión jurídica pedía corregir la SPEC ya. No se aplicó así: la ubicación de los incisos c y d viene de un resumen del buscador [P]. Se deja [NV] hasta cotejar (punto 31), como proponía la revisión técnica.
35. **`SIN_ROGANTE`.** La revisión técnica lo proponía como señal. Acá se aplicó como **estado** (§6.6), porque sin rogante no se puede calcular `indicio_rogante`, y como señal el expediente igual quedaba en algún estado de indicios que no corresponde. El efecto buscado ("no quedar como `SIN_INDICIOS`") es el mismo. Se agregó además la señal `ROGANTE_SIN_REVISAR` para el rogante tomado del cuerpo.
36. **Parámetros admitidos en Batch.** La revisión técnica dice que los únicos parámetros no admitidos son `stream`, `speed` y `max_tokens: 0`. Según el skill `claude-api`, `fallbacks` tampoco se acepta en Batch. Se escribió "entre otros".
37. **Datos no cotejados en esta sesión.** Tres afirmaciones vienen de la documentación citada por la revisión técnica y no se pudieron cotejar contra la página:
    - el patrón de `custom_id`;
    - que un lote pueda pasar levemente el límite de gasto del Workspace;
    - los 1.500 a 3.000 tokens de texto por página.

    Se usan como están. Si el piloto muestra otra cosa, se corrigen.
38. **Ley 25.326.** Las dos menciones (datos de personas determinables; datos de salud como sensibles) las aportó la revisión jurídica y no estaban en la investigación normativa. En §5.5 van marcadas [P], a cotejar. La decisión de minimizar los datos de salud se sostiene igual como prudencia, sin depender de esa cita.
39. **Muestras.** La revisión no tocó los grupos del §12, pero tienen el mismo problema que la marca `SIN_PIEZA_DE_CIERRE`: los grupos "INC-incompleto" y "solo cuerpo, sin estado" no se pueden armar con los digitalizados, que no tienen estado del SUAC. Se rearmaron con lo que sí se sabe (§12).