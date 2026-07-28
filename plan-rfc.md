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

### Estado actual
- ✅ Conexión WhatsApp con Baileys
- ✅ Captura de mensajes en tiempo real
- ✅ Persistencia en MySQL con Drizzle ORM
- ✅ Migraciones versionadas
- ✅ Filtrado por dirección (incoming/outgoing/both)

### Próximos pasos

#### Fase 1: Clasificador de mensajes
**Objetivo:** Detectar si un mensaje es de despacho

**Criterio de aceptación:**
- Mensajes de despacho se identifican correctamente
- Mensajes que no son de despacho se ignoran
- Tasa de acierto > 80%

**Patrones detectados:**
- "Para la hora sale vehículo"
- "Siendo las X horas sale vehículo"
- "En estos momentos se retira"
- Contiene: vehículo, placa, chofer, cantidad de motos, destino

#### Fase 2: Extractor de campos
**Objetivo:** Parsear el mensaje y extraer datos estructurados

**Campos a extraer:**
| Campo | Ejemplo | Método |
|-------|---------|--------|
| vehicle_type | NODRIZA | Keyword list |
| plate | A56AH3L | Regex |
| driver_name | YORBIS GOMEZ | Después de "conducido por" |
| driver_id | 18.498.545 | Después de CI/cédula |
| driver_phone | 0424-7767350 | Regex teléfono |
| motorcycle_count | 32 | Después de "cantidad de" |
| destination | EMPRENDIMIENTO... | Después de "destino al concesionario" |
| invoices | 00014551 | Después de "Factura" |
| control_notes | 019125 | Después de "NOTA DE CONTROL" |
| franelas | 32 | Después de "LLEVA X FRANELAS" |
| warranty | 3096 | Después de "GARANTÍA NÚMERO" |

#### Fase 3: Matcher de empresas
**Objetivo:** Cruzar nombre del concesionario con BD MySQL

**Estrategia:**
- Normalizar texto (quitar tildes, uppercase, espacios extra)
- Búsqueda fuzzy (Levenshtein distance)
- Umbral de confianza: 80% mínimo

**Base de datos:** `hj-app.companies`

#### Fase 4: Tabla dispatch_notifications
**Objetivo:** Almacenar notificaciones de despacho procesadas

**Esquema:**
```sql
CREATE TABLE dispatch_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE,
  raw_text TEXT,
  vehicle_type VARCHAR(100),
  plate VARCHAR(20),
  driver_name VARCHAR(255),
  driver_id VARCHAR(50),
  driver_phone VARCHAR(50),
  motorcycle_count INT,
  destination_name VARCHAR(500),
  matched_company_id BIGINT,
  matched_confidence REAL,
  invoices TEXT,
  control_notes TEXT,
  franelas INT,
  warranty VARCHAR(100),
  status ENUM('pending', 'sending', 'sent', 'error'),
  notification_template TEXT,
  notification_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Fase 5: Integración
**Objetivo:** Conectar todo en el handler

**Flujo:**
```
Mensaje llega
    ↓
Clasificar → ¿Es despacho?
    ↓ SI
Extraer campos
    ↓
Matchear con companies
    ↓
Guardar en dispatch_notifications
    ↓
列表 en Astro UI
```

---

## Proyecto 2: Astro Web UI (`astro-client-notification`)

### Estado actual
- ✅ Proyecto Astro creado
- ✅ Servidor de desarrollo funcionando

### Arquitectura

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

### Próximos pasos

#### Fase 1: Configuración base
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

---

## Stack Técnico

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js + TypeScript |
| WhatsApp | @whiskeysockets/baileys |
| Base de datos | MySQL |
| ORM | Drizzle ORM |
| Frontend | Astro + React |
| Estilos | Tailwind CSS (CDN) |

---

## Dependencias

### client-notification
```json
{
  "@whiskeysockets/baileys": "github:WhiskeySockets/Baileys",
  "mysql2": "^3.23.2",
  "drizzle-orm": "^0.38.0",
  "dotenv": "^16.4.7",
  "pino": "^9.6.0",
  "pino-pretty": "^13.0.0",
  "qrcode-terminal": "^0.12.0"
}
```

### astro-client-notification
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

## Criterios de Aceptación

### Collector
- [ ] Mensajes de despacho se clasifican correctamente
- [ ] Campos se extraen con precisión > 80%
- [ ] Match con empresas funciona > 70% de los casos
- [ ] No duplica mensajes (idempotencia)
- [ ] Migraciones versionadas con Drizzle Kit

### Astro UI
- [ ] Lista de notificaciones se carga correctamente
- [ ] Formulario permite editar campos
- [ ] Preview muestra template correcto
- [ ] Envío de WhatsApp funciona
- [ ] Responsive en desktop y móvil

---

## Cronograma Estimado

| Fase | Collector | Astro | Duración |
|------|-----------|-------|----------|
| 1 | Clasificador | Config base | 2-3 días |
| 2 | Extractor | Página lista | 2-3 días |
| 3 | Matcher | Formulario | 2-3 días |
| 4 | Tabla DB | Preview | 1-2 días |
| 5 | Integración | Envío | 2-3 días |
| **Total** | | | **9-14 días** |

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Patrones de mensajes cambian | Alto | Mantener clasificador flexible |
| Match con empresas falla | Medio | Umbral configurable + manual override |
| Baileys se desconecta | Bajo | Reconexión automática ya implementada |
| MySQL no disponible | Alto | Health checks + reintentos |

---

## Decisiones Tomadas

1. **Dos proyectos separados** — Collector y UI son independientes
2. **MySQL como puente** — Ambos proyectos acceden a la misma BD
3. **Drizzle ORM** — Para versionado de esquema y type safety
4. **Astro + React** — HTML puro + islands para interactividad
5. **Template fijo** — Notificación con formato estándar

---

## Documentación Relacionada

- `AGENTS.md` — Documentación del proyecto collector
- `plan-proyecto-whatsapp-channel-collector.md` — Plan original del collector
- `src/db/schema.ts` — Esquema Drizzle ORM
- `drizzle/` — Migraciones versionadas
