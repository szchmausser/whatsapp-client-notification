# `fetch-day.ts` — Guía operativa y matriz de comportamiento

Script independiente que se conecta a WhatsApp con su propia sesión (`./auth-fetch`), pagina el historial de mensajes desde WhatsApp Web y los persiste en MySQL de forma **idempotente** (gracias a la clave `UNIQUE (message_id)`).

```bash
npx tsx src/scripts/fetch-day.ts <dd-mm-aaaa> [--verbose] [--fill-gaps]
```

---

## Mecanismo de paginación (Cómo funciona internamente)

WhatsApp Web siempre entrega el historial **de lo más reciente a lo más antiguo** (orden cronológico inverso). Para que el script pueda descargar mensajes de un día específico, ejecuta los siguientes pasos:

1. **Conexión y descarga de notificaciones offline:**
   Al iniciar, el script se conecta a WhatsApp Web y procesa en la BD cualquier mensaje acumulado (*offline notifications* entregadas por WhatsApp durante la conexión). Se da un margen de 3 segundos para que estos mensajes se escriban en MySQL.

2. **Resolución del Seed (Semilla de paginación):**
   *Posterior a la conexión*, se consulta la BD para seleccionar el mensaje semilla desde el cual iniciar la paginación hacia atrás:
   - **Seed primario (Día futuro disponible):** Busca el primer mensaje en la BD con `timestamp >= 23:59:59 del día solicitado` (es decir, del día siguiente).
   - **Seed secundario / Fallback (Día actual o sin datos futuros):** Si no existe un mensaje posterior (ej. solicitando hoy), busca **el mensaje más reciente en la BD para ese chat** cuya fecha sea `>= 00:00:00 del día solicitado` (incluyendo notificaciones offline recién guardadas al conectar).

3. **Criterio de guardado en la BD:**
   - **Modo estándar (Sin `--fill-gaps`):** Pagina hacia atrás descartando todo mensaje fuera de la ventana exacta del día solicitado (`00:00:00` a `23:59:59`).
   - **Modo vaciado de huecos (Con `--fill-gaps`):** Procesa e inserta **todos los mensajes no registrados** desde la fecha del seed hasta las `00:00:00` del día solicitado. Los mensajes que ya existan se omiten (`skipped`) sin duplicar.

---

## Matriz predecible de escenarios

A continuación se detallan los comportamientos predecibles según la fecha de ejecución, la fecha solicitada, el estado de la base de datos y los flags utilizados.

---

### Escenario 1: Solicitar el día actual (Hoy)

* **Fecha de ejecución:** 16-08-2026 (17:00 hs)
* **Fecha solicitada:** `16-08-2026`
* **Estado previo de la BD:** Collector apagado desde el 14-08-2026. No había datos del 16-08-2026 en la BD al arrancar.

| Configuración | Seed detectado | Comportamiento y resultado |
|---|---|---|
| **Sin `--fill-gaps`** | Mensaje del 16-08-2026 17:00 hs (entregado por la notificación offline al conectar) | Pagina desde las 17:00 hs de hoy hacia atrás. **Inserta únicamente** los mensajes de hoy hasta las `00:00:00`. Los mensajes de los días 15 y 14 se omiten. |
| **Con `--fill-gaps`** | Mensaje del 16-08-2026 17:00 hs | Pagina desde las 17:00 hs hacia atrás. **Inserta los mensajes de hoy (16-08) y también rellena los mensajes faltantes del 15-08 y 14-08** en la misma corrida. |

---

### Escenario 2: Solicitar un día pasado entre fechas ya capturadas (Hueco intercalado)

* **Fecha de ejecución:** 16-08-2026
* **Fecha solicitada:** `14-08-2026`
* **Estado previo de la BD:** Ya existen mensajes guardados del día `15-08-2026` y del `16-08-2026`.

| Configuración | Seed detectado | Comportamiento y resultado |
|---|---|---|
| **Sin `--fill-gaps`** | Primer mensaje del 15-08-2026 (`timestamp >= 14-08-2026 23:59:59`) | Pagina hacia atrás desde el inicio del 15-08-2026. Omite el 15-08 e **inserta únicamente** los mensajes del 14-08-2026 entre las `00:00:00` y `23:59:59`. |
| **Con `--fill-gaps`** | Primer mensaje del 15-08-2026 *(mismo seed)* | Pagina hacia atrás desde el inicio del 15-08-2026. Inserta cualquier mensaje faltante del 15-08 e **inserta todos los faltantes del 14-08-2026**. (Los mensajes de hoy 16-08 que ya estaban en la BD no se tocan). |

---

### Escenario 3: Solicitar un día posterior al último dato retrasado en BD (Recuperación desde inactividad)

* **Fecha de ejecución:** 16-08-2026
* **Fecha solicitada:** `14-08-2026`
* **Estado previo de la BD:** El último mensaje registrado en la BD era del `10-08-2026` (collector apagado del 11 al 16).

| Configuración | Seed detectado | Comportamiento y resultado |
|---|---|---|
| **Sin `--fill-gaps`** | Mensaje reciente del 16-08-2026 (entregado por la notificación offline al conectar) | No hay mensajes del 15-08 en la BD para el seed primario. El fallback toma el mensaje del 16-08-2026 recibido al conectar como seed. Pagina hacia atrás, **ignora los mensajes del 16 y 15**, y al llegar al 14-08-2026 **inserta únicamente los del día 14**. |
| **Con `--fill-gaps`** | Mensaje reciente del 16-08-2026 | Pagina hacia atrás desde el 16-08-2026. **Inserta todos los mensajes faltantes** de los días 16, 15 y 14 de una sola pasada. |

---

### Escenario 4: Base de datos completamente vacía (Primera inicialización)

* **Fecha de ejecución:** 16-08-2026
* **Fecha solicitada:** Cualquier fecha (`14-08-2026` o `16-08-2026`)
* **Estado previo de la BD:** `0` mensajes en la BD y WhatsApp entrega `0` notificaciones offline al conectar.

| Configuración | Seed detectado | Comportamiento y resultado |
|---|---|---|
| **Sin `--fill-gaps`** | `null` | El script activa el **modo bootstrap** (espera la sincronización inicial de Baileys). De los mensajes que llegan durante esa sincronización, **solo inserta los que caen dentro del día solicitado**; el resto se usa únicamente para ubicar la semilla de paginación hacia atrás, pero no se guarda. |
| **Con `--fill-gaps`** | `null` | Modo bootstrap igual que arriba, pero inserta **todos** los mensajes de la sincronización inicial con `timestamp >= 00:00:00 del día solicitado` (no solo los del día exacto). |

> **Nota:** en versiones anteriores del script, el modo bootstrap insertaba *todos* los mensajes recibidos en la sincronización inicial sin filtrar por fecha, incluso sin `--fill-gaps`. Esto quedó corregido para que el bootstrap sea consistente con el resto de los escenarios.

---

## Resumen de Flags de CLI

| Flag | Descripción | Uso típico |
|---|---|---|
| *(Sin flags)* | Descarga e inserta **únicamente** los mensajes que pertenecen al día indicado por argumento. | Reparación atómica de un día específico sin alterar otros datos ni contaminar métricas de logs. |
| `--fill-gaps` | Descarga e inserta **todos los mensajes no registrados** desde la fecha del seed hasta la medianoche del día solicitado. | Recuperación masiva cuando el collector estuvo apagado varios días seguidos. |
| `--verbose` | Muestra en tiempo real por consola el estado de cada mensaje (`[processed]`, `[skipped]`, `[error]`). | Depuración o auditoría detallada de la ejecución. |

---

## Modos de falla y diagnóstico

| Síntoma | Causa | Acción recomendada |
|---|---|---|
| `Bootstrap timeout: no messages received within 240s` | BD sin mensajes y la sesión existente no emitió sincronización inicial | Eliminar `./auth-fetch/` para forzar un nuevo escaneo de QR con sync completo. |
| `fetchMessageHistory timeout, retrying in Xs` | WhatsApp Web no respondió a tiempo la solicitud del lote | No requiere acción; el script reintenta automáticamente hasta 3 veces con backoff. |
| `Connection closed (status 440)` | La sesión de `./auth-fetch` fue abierta en otro proceso simultáneo | Cerrar otras instancias del script y volver a ejecutar. |
| `Fecha inexistente en el calendario: dd-mm-aaaa` | Se pidió una fecha que no existe (ej. `31-02-2026`) | Revisar el argumento; el script ya no la acepta silenciosamente. |

---

## Notas de esta versión (correcciones aplicadas)

Esta versión de `fetch-day.ts` corrige los siguientes problemas respecto a la anterior:

1. **Validación real de calendario.** Antes, una fecha como `31-02-2026` pasaba la validación de formato y `computeEpochRange` la "normalizaba" silenciosamente (JS corría la fecha a marzo), paginando el día equivocado sin ningún aviso. Ahora se valida que día/mes/año formen una fecha real y se aborta con un mensaje claro si no.
2. **Cálculo de rango de día robusto ante DST.** El límite superior del día se calculaba como `start + 86400`, lo cual asume que todo día dura 24h exactas. En timezones con horario de verano, el día del cambio dura 23h o 25h, así que ese cálculo podía correr la ventana del día. Ahora se calcula la medianoche local siguiente directamente con `new Date(...)`, sin asumir una duración fija.
3. **`cancel()` del listener de bootstrap ahora desregistra el handler de verdad.** Antes, cancelar el bootstrap (cuando ya se encontró un seed en la BD) solo limpiaba timers pero dejaba el listener de `messaging-history.set` colgado en el socket indefinidamente, lo que podía procesar mensajes duplicados sin necesidad. Ahora `cancel()` hace `sock.ev.off(...)` real.
4. **El modo bootstrap ahora respeta el filtro de fecha del día solicitado** (salvo `--fill-gaps`), en vez de insertar todo lo que llega en la sincronización inicial — ver nota en el Escenario 4 más arriba.
5. **Endurecimiento menor:** ya no se fuerzan con `!` (non-null assertion) campos que la base puede devolver como `null` (`messageId`, `key.id`); si falta el dato, se registra un warning y se degrada de forma segura en vez de fabricar una semilla inválida.

Estos cambios fueron validados con `vitest` (tests reales, incluyendo casos de DST y fechas inválidas) y con `tsc --noEmit` en modo `strict`, sin errores.