# Plan de Proyecto: WhatsApp Channel Collector

## 1. Propósito

Construir un servicio independiente en **Node.js + TypeScript** que use `@whiskeysockets/baileys` para:

1. Conectarse a WhatsApp Web con una cuenta dedicada.
2. Escuchar en tiempo real los mensajes publicados en Canales de WhatsApp (JIDs terminados en `@newsletter`).
3. Realizar un backfill (sincronización del historial disponible) al arrancar o bajo demanda.
4. Persistir todo en una base de datos **SQLite local**.

Este servicio es un **"data collector"**, no un producto final. Otros sistemas (procesadores de IA, APIs, dashboards) van a consumir la base de datos SQLite directamente. Este proyecto **no** implementa esos consumidores.

## 2. Filosofía de diseño (obligatoria)

Este proyecto debe seguir **KISS y YAGNI de forma estricta**. El agente que lo implemente debe evaluar cada decisión técnica contra esta pregunta: *"¿esto resuelve un requisito de este documento, o estoy anticipando algo que no se pidió?"*. Si es lo segundo, no se hace.

Reglas concretas de diseño que aplican salvo que un requisito explícito las contradiga:

- **Usar Drizzle ORM + drizzle-kit** para el acceso a datos y las migraciones versionadas. Se prefiere sobre Prisma para este proyecto porque no requiere un engine binario aparte, se integra de forma más directa con drivers síncronos de SQLite (p. ej. `better-sqlite3`), y su capa de abstracción es más cercana a SQL plano — lo cual encaja mejor con la filosofía KISS del resto del proyecto sin renunciar a tipado fuerte ni a migraciones versionadas. Las migraciones generadas por `drizzle-kit` deben commitearse al repositorio como fuente de verdad del esquema.
- Aun usando ORM, se debe evitar construir sobre él capas adicionales de abstracción (repository pattern, interfaces desacopladas "por si acaso"). El ORM ya es la capa de acceso a datos; no se envuelve en otra capa sin una razón concreta.
- **No crear capas de arquitectura en abstracto** (no "repository pattern" con interfaces intercambiables, no `controllers/services/dtos` de un framework web que no existe en este proyecto). La estructura de carpetas debe reflejar responsabilidades reales del dominio, no una plantilla genérica de "arquitectura limpia".
- **No construir una API HTTP, cola de mensajes, sistema multi-tenant, ni panel de administración.** Eso es explícitamente fuera de alcance (ver sección 6).
- **Preferir guardar el payload crudo del mensaje** (JSON) sobre modelar exhaustivamente cada tipo de mensaje de WhatsApp en columnas normalizadas. Extraer a columnas solo los campos que este documento pide consultar.
- El agente tiene libertad de elegir librerías auxiliares menores (driver de SQLite, manejo de variables de entorno, etc.) siempre que sean minimalistas y ampliamente usadas — no debe justificar la elección con un documento de decisión, pero sí debe evitar herramientas que traigan complejidad no solicitada (generadores de código, engines binarios adicionales, frameworks de configuración).

## 3. Alcance funcional (qué debe hacer)

### 3.1 Conexión y sesión
- Establecer conexión con WhatsApp Web vía Baileys, con autenticación persistida en disco (para no requerir escanear QR en cada arranque).
- Manejar reconexión ante caídas de conexión, con una estrategia de reintento simple y acotada (no se requiere un motor de resiliencia sofisticado).
- Registrar en logs los eventos relevantes del ciclo de vida de la conexión (conectado, desconectado, error, reconectando).

### 3.2 Captura en tiempo real
- Por ahora, el servicio se enfoca en **un único chat/canal específico**, identificado por su JID y configurable (por ejemplo, vía variable de entorno). No se requiere en esta fase descubrir ni monitorear múltiples canales dinámicamente.
- Escuchar los eventos de mensajes entrantes correspondientes a ese chat/canal y reenviar (persistir) cada mensaje que llegue hacia la base de datos SQLite local.
- Procesar cada mensaje entrante y persistirlo de forma **idempotente**: si el mismo mensaje llega más de una vez (reconexión, reintentos de WhatsApp, etc.), no debe duplicarse ni fallar el proceso.
- El agente debe determinar, durante la implementación, cuál es el evento/mecanismo correcto de la versión instalada de Baileys para capturar estos mensajes, dado que la superficie de la librería cambia entre versiones. No se prescribe aquí un nombre de evento específico.
- El diseño debe dejar la puerta abierta a soportar más de un chat/canal en una iteración futura (p. ej., que el JID no quede hardcodeado en la lógica de negocio), pero no es necesario construir esa generalización ahora si añade complejidad significativa.

### 3.3 Sincronización de continuidad (catch-up sync)
El requisito central de esta sección **no es traer historial arbitrariamente profundo**, sino garantizar que la base de datos nunca pierda continuidad cronológica, sin importar apagones o desconexiones del servicio:

- El servicio debe poder determinar, en todo momento, **cuál es el último mensaje que tiene guardado** para el chat/canal monitoreado (por timestamp y/o id de mensaje).
- Al arrancar o reconectarse, el servicio debe usar ese "último mensaje conocido" como punto de referencia para recuperar y persistir cualquier mensaje que se haya emitido mientras el servicio estuvo apagado o desconectado, de modo que no queden huecos entre lo último guardado y los mensajes nuevos que empiecen a llegar en tiempo real.
- Este proceso debe ser idempotente: si algún mensaje ya capturado se vuelve a recibir durante la resincronización, no debe duplicarse.
- **Limitación de plataforma a tener en cuenta**: la profundidad de historial que WhatsApp expone para canales a través de Baileys no es ilimitada ni está garantizada. Si el tiempo de desconexión excede lo que la plataforma permite recuperar, puede haber un hueco real que el servicio no pueda cerrar. El agente debe:
  - Validar empíricamente, temprano en el desarrollo, cuánto se puede recuperar tras una desconexión (minutos, horas, días).
  - Dejar evidencia (log o registro en la propia base de datos) cuando detecte que no pudo cerrar el hueco completo, en vez de fallar silenciosamente o asumir que todo quedó sincronizado.
  - No intentar rodear esta limitación con técnicas no convencionales (scraping de WhatsApp Web, uso de APIs no documentadas fuera de lo que Baileys ya expone, etc.).
- Un backfill de historial profundo (traer todo lo que existía antes de que este servicio empezara a operar) **no es un requisito de esta fase**; si se logra como efecto secundario de la sincronización de continuidad, bien, pero no es un objetivo a perseguir activamente todavía.

### 3.4 Identificación del chat/canal monitoreado
- Mantener un registro simple del chat/canal configurado (JID, y su metadata básica si está disponible: nombre, descripción).
- El servicio asume que la cuenta de WhatsApp usada ya tiene acceso a ese chat/canal (p. ej., ya lo sigue si es un canal). No es necesario automatizar el proceso de "seguir" un canal en esta fase.

### 3.5 Persistencia
- Toda la información debe quedar en un archivo SQLite local, estructurado de forma que sistemas externos puedan leerlo directamente (sin pasar por una API de este servicio).
- El esquema (definido con Drizzle) debe cubrir como mínimo: el/los chat(s) monitoreados, mensajes, y estado de sincronización (último mensaje conocido) por chat. El diseño exacto de columnas queda a criterio del agente, siguiendo el principio de guardar el payload crudo del mensaje además de las columnas normalizadas que se necesiten consultar directamente.
- Las migraciones generadas por drizzle-kit deben quedar versionadas junto al código, de forma que el esquema de la base de datos tenga un historial claro y reproducible.

## 4. Fuera de alcance (explícitamente, no ambigüedad permitida)

El agente **no debe** implementar nada de lo siguiente en esta fase, aunque parezca una extensión natural. El objetivo de esta primera versión es exclusivamente tener la base de datos local bien sincronizada con el historial y los mensajes nuevos del chat/canal configurado:

- **API HTTP/REST para exponer los datos — planeada para una iteración posterior, no para esta fase.** El agente puede diseñar el esquema y el código de forma que no dificulte agregar una API después (por ejemplo, evitando acoplar la lógica de persistencia a detalles internos de Baileys), pero no debe construirla todavía.
- Procesamiento, clasificación o análisis con IA de los mensajes capturados.
- Envío de mensajes o cualquier interacción saliente con WhatsApp (este es un servicio de solo lectura/captura).
- Soporte multi-cuenta o multi-tenant.
- Colas de mensajes, sistemas de eventos externos (Redis, Kafka, etc.).
- Interfaz de usuario o panel de administración.
- Tests end-to-end contra la WhatsApp real (los tests deben limitarse a lógica pura del proyecto: mapeo de mensajes, idempotencia, cálculo del "último mensaje conocido", etc.).

Si durante la implementación el agente identifica que algo de esta lista es un prerrequisito ineludible para cumplir la sección 3, debe señalarlo explícitamente antes de implementarlo, no decidirlo unilateralmente.

## 5. Riesgos técnicos a validar antes de construir la versión final

Antes de comprometerse con un diseño de esquema o flujo definitivo, el agente debe dedicar un ciclo corto de validación exploratoria para confirmar:

1. En qué evento(s) de Baileys llegan realmente los mensajes del chat/canal configurado en la versión instalada.
2. Qué método(s) expone Baileys para recuperar mensajes ocurridos mientras el servicio estuvo desconectado, y cuánto tiempo/profundidad de desconexión es capaz de cubrir en la práctica.
3. Qué requiere la cuenta de WhatsApp usada para poder recibir mensajes de ese chat/canal (p. ej., estar siguiéndolo, si es un canal).

Los hallazgos de esta validación deben ajustar el diseño de las fases 3.2 y 3.3 si difieren de lo asumido aquí.

## 6. Criterios de "terminado" para esta primera versión

El proyecto se considera completo cuando:

- El servicio puede arrancar, autenticarse una vez (QR o pairing code) y mantener la sesión en corridas posteriores sin reautenticar.
- Con el chat/canal configurado, los mensajes nuevos se capturan en tiempo real y quedan en SQLite sin duplicados.
- Tras apagar el servicio y volver a levantarlo (o tras una desconexión), el servicio identifica el último mensaje guardado y recupera lo que se emitió mientras estuvo desconectado, sin duplicar ni dejar huecos evitables, dentro de los límites validados en la sección 5.
- El servicio se recupera solo de una desconexión temporal sin intervención manual.
- El esquema de la base de datos está definido y versionado con Drizzle, y un tercero (otro proceso) puede abrir el archivo SQLite y leer los datos sin necesitar conocer detalles internos del servicio.

## 7. Libertad de decisión del agente

El agente tiene autonomía completa sobre:
- Estructura interna de archivos/módulos (siempre alineada a responsabilidades reales, no a una plantilla genérica).
- Elección de librerías auxiliares menores.
- Diseño exacto de columnas y tipos en el esquema Drizzle/SQLite.
- Estrategia concreta de reconexión y manejo de errores.
- Orden interno de implementación, siempre que respete la validación de riesgos (sección 5) antes de cerrar el diseño de backfill.

El agente **no** tiene autonomía para expandir el alcance más allá de la sección 3, ni para introducir la infraestructura listada en la sección 4, sin señalarlo explícitamente primero.
