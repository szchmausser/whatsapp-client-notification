# RFC: WhatsApp Notification System

## Visión General

Sistema compuesto por dos procesos independientes que comparten una base de datos MySQL:

```
┌─────────────────────┐
│ WhatsApp Collector  │ ← Proceso 1 (Baileys, 24/7)
│ client-notification │   Captura, clasifica, guarda
└──────────┬──────────┘
           │ MySQL
┌──────────▼──────────┐
│ Astro Web UI        │ ← Proceso 2 (Cuando se necesita)
│ astro-client-       │   Lee, edita, envía
│ notification        │
└─────────────────────┘
```

---

## Proyecto 1: WhatsApp Collector (`client-notification`)

### Estado actual ✅ COMPLETADO

- ✅ Conexión WhatsApp con Baileys
- ✅ Captura de mensajes en tiempo real
- ✅ Persistencia en MySQL con Drizzle ORM
- ✅ Migraciones versionadas
- ✅ Filtrado por dirección (incoming/outgoing/both)
- ✅ **Clasificador de mensajes de despacho** (gate-based)
- ✅ **Extractor de campos** (regex corregidos)
- ✅ **Matcher de empresas** (Levenshtein + word overlap)
- ✅ **Tabla dispatch_notifications** (48 campos de messages + 20 extras)
- ✅ **Integración en handler** (classify → extract → match → save)
- ✅ **46 tests unitarios** (vitest)

### Arquitectura del Clasificador

```
Mensaje WhatsApp
    ↓
classifyDispatch(text) → isDispatch: boolean
    ↓ (si es despacho)
extractDispatchFields(text) → plate, driver, destination, etc.
    ↓
matchCompany(destination) → companyId, confidence
    ↓
db.insert(dispatchNotifications) → save con todos los campos
```

**Algoritmo de clasificación (gate-based):**
- `hasDeparture` = detecta verbos de salida ("sale", "retira", "parte")
- `hasArrival` = detecta verbos de llegada ("llega", "arriba")
- `hasPlate` = detecta formato de placa (121XJB, ABC123, etc.)
- `hasMotos` = detecta "motos", "moto", "unidades"
- **Resultado:** `hasDeparture && !hasArrival && (hasPlate || hasMotos)`

### Esquema de dispatch_notifications

```
┌─────────────────────────────────────────────────────┐
│  48 campos de messages (mismo orden, mismo tipo)    │
│  chat_jid, message_id, sender, content, text,      │
│  timestamp, created_at, mime_type, latitude, ...    │
├─────────────────────────────────────────────────────┤
│  20 campos de despacho (extras)                     │
│  is_dispatch, confidence, dispatch_type,            │
│  vehicle_type, plate, driver_name, driver_id,       │
│  driver_phone, motorcycle_count, destination_name,  │
│  invoices, control_notes, franelas, warranty,       │
│  matched_company_id, matched_confidence,            │
│  status, classified_at, sent_at, error_message      │
└─────────────────────────────────────────────────────┘
```

**Status enum:**
- `pending_extraction` — Detectado como despacho, sin campos extraídos
- `pending_review` — Campos extraídos (best-effort), necesita verificación
- `ready_to_send` — Campos completos y verificados
- `sent` — Enviado exitosamente
- `error` — Error al enviar

### Dependencias

```json
{
  "@whiskeysockets/baileys": "github:WhiskeySockets/Baileys",
  "mysql2": "^3.23.2",
  "drizzle-orm": "^0.38.0",
  "dotenv": "^16.4.7",
  "pino": "^9.6.0",
  "pino-pretty": "^13.0.0",
  "qrcode-terminal": "^0.12.0",
  "vitest": "^4.1.10"
}
```

---

## Proyecto 2: Astro Web UI (`astro-client-notification`)

### Estado actual
- ❌ No iniciado

### Arquitectura propuesta

```
src/
├── pages/
│   ├── index.astro              # Dashboard
│   ├── dispatches/
│   │   ├── index.astro          # Lista de notificaciones
│   │   └── [id].astro           # Editar notificación
│   └── api/
│       ├── dispatches/
│       │   ├── index.ts         # GET/POST
│       │   └── [id].ts          # GET/PUT
│       └── send/
│           └── [id].ts          # POST
├── components/
│   ├── DispatchList.tsx         # Lista (React island)
│   ├── DispatchForm.tsx         # Formulario edición
│   └── DispatchPreview.tsx      # Preview mensaje
├── layouts/
│   └── Layout.astro
└── lib/
    ├── db.ts                    # Conexión MySQL
    └── company-matcher.ts       # Match con companies
```

### Pasos pendientes

#### Fase 1: Configuración base
- Crear proyecto Astro
- Agregar integración React (`npx astro add react`)
- Configurar conexión a MySQL (mismas credenciales del collector)
- Crear layout base

#### Fase 2: Página de lista
- Mostrar notificaciones pendientes
- Indicadores: pendientes / enviadas / errores
- Filtros por fecha, empresa, estado

#### Fase 3: Formulario de edición
- Campos editables con valores inferidos
- Sección de campos faltantes (resaltados)
- Autocompletado desde companies

#### Fase 4: Preview de notificación
- Template de notificación configurable
- Vista previa antes de enviar
- Edición del mensaje final

#### Fase 5: Envío de WhatsApp
- Reutilizar conexión Baileys existente
- Función `sendMessage(jid, text)`
- Marcar como enviado en la BD

### Dependencias

```json
{
  "astro": "^5.12.0",
  "@astrojs/react": "^4.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "mysql2": "^3.23.2",
  "drizzle-orm": "^0.38.0"
}
```

---

## Stack Técnico

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js + TypeScript |
| WhatsApp | @whiskeysockets/baileys |
| Base de datos | MySQL |
| ORM | Drizzle ORM |
| Testing | Vitest |
| Frontend | Astro + React |
| Estilos | Tailwind CSS (CDN) |

---

## Criterios de Aceptación

### Collector ✅ COMPLETADO
- [x] Mensajes de despacho se clasifican correctamente
- [x] Campos se extraen con precisión > 80%
- [x] Match con empresas funciona > 70% de los casos
- [x] No duplica mensajes (idempotencia)
- [x] Migraciones versionadas con Drizzle Kit
- [x] 46 tests unitarios pasan

### Astro UI
- [ ] Lista de notificaciones se carga correctamente
- [ ] Formulario permite editar campos
- [ ] Preview muestra template correcto
- [ ] Envío de WhatsApp funciona
- [ ] Responsive en desktop y móvil

---

## Decisiones Tomadas

1. **Dos proyectos separados** — Collector y UI son independientes
2. **MySQL como puente** — Ambos proyectos acceden a la misma BD
3. **Drizzle ORM** — Para versionado de esquema y type safety
4. **Astro + React** — HTML puro + islands para interactividad
5. **Gate-based classifier** — `hasDeparture && !hasArrival && (hasPlate || hasMotos)`
6. **Campos de messages en dispatch_notifications** — Proyección completa, sin JOINs necesarios
7. **Status con 5 estados** — Flujo claro: extraction → review → ready → sent | error
8. **Vitest para testing** — 46 tests cubriendo casos válidos, inválidos y edge cases

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Patrones de mensajes cambian | Alto | Clasificador gate-based, fácil de ajustar |
| Match con empresas falla | Medio | Umbral configurable + manual override |
| Baileys se desconecta | Bajo | Reconexión automática ya implementada |
| MySQL no disponible | Alto | Health checks + reintentos |

---

## Documentación Relacionada

- `AGENTS.md` — Documentación del proyecto collector
- `src/db/schema.ts` — Esquema Drizzle ORM
- `src/dispatch/classifier.ts` — Clasificador de mensajes
- `src/dispatch/extractor.ts` — Extractor de campos
- `src/dispatch/matcher.ts` — Matcher de empresas
- `src/dispatch/classifier.test.ts` — 46 tests unitarios
- `drizzle/` — Migraciones versionadas
