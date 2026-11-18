# Documentación técnica

Sistema de Control de Pagos y Asignaciones. Proyecto final de Sistemas de Información (Universidad de Carabobo).

Este documento explica cómo está construido el sistema y por qué se tomó cada decisión técnica. También recoge el estado del proyecto. Las instrucciones de instalación y uso están en el [README](../README.md); el enunciado, en [proyecto.md](../proyecto.md).

- **Actualizado:** 18 de noviembre de 2026
- **Versión descrita:** `main` en `604dd7d`, que incluye los PR #1 al #19. Lo que agrega el PR #20, todavía en revisión, se marca como *(PR #20)*

## Contenido

1. [Visión general](#1-visión-general)
2. [Arquitectura](#2-arquitectura)
3. [Backend](#3-backend)
4. [Modelo de datos](#4-modelo-de-datos)
5. [Reglas de negocio por módulo](#5-reglas-de-negocio-por-módulo)
6. [Seguridad](#6-seguridad)
7. [Frontend](#7-frontend)
8. [Decisiones técnicas](#8-decisiones-técnicas)
9. [Pruebas](#9-pruebas)
10. [Despliegue](#10-despliegue)
11. [Cómo extender el sistema](#11-cómo-extender-el-sistema)
12. [Estado del proyecto](#12-estado-del-proyecto)
13. [Glosario](#13-glosario)

---

## 1. Visión general

El sistema reemplaza el control en hojas de cálculo de los pagos al personal de proyectos de física, química y biología. Responde cinco preguntas: cuánto se ha causado, cuánto se ha pagado, cuándo, a quién y por qué proyecto, y cuánto se le adeuda a cada persona. Los montos son asignaciones en USD, sin deducciones: no es una nómina legal.

### Roles

| Rol | Qué hace | Qué no hace |
|---|---|---|
| Administrador del Sistema | Gestiona usuarios, parámetros y áreas, y consulta la auditoría | No participa en operaciones de dinero ni ve los reportes |
| Generador de Nómina | Gestiona personas, proyectos, asignaciones y grupos de pago. Genera la causación, crea y envía las solicitudes de pago, y pide y rinde vales | No aprueba solicitudes ni entrega fondos |
| Receptor de Nómina | Aprueba o rechaza solicitudes, registra la entrega de fondos y gestiona las cajas chicas | No crea solicitudes ni causa |

Los beneficiarios (las personas que cobran) no tienen usuario en el sistema.

### Flujo principal

```text
Persona + Proyecto + Grupo de pago
        │
        ▼
   Asignación (monto por período, desde/hasta)
        │   el período cierra
        ▼
   Causación por lote (prorrateo por días activos)  ── anulable con motivo
        │
        ▼
   Solicitud de pago: Borrador → Enviada → Aprobada / Rechazada
        │                                   │
        │                                   ▼
        │                     Pagos por persona (FIFO, parciales) ── anulables con motivo
        │                                   │
        ▼                                   ▼
   Reportes y PDFs  ◄──────────────────  Cerrada
```

En paralelo funcionan las **cajas chicas**: apertura mensual, vales (solicitud, aprobación, desembolso, rendición) y arrastre del saldo al mes siguiente.

---

## 2. Arquitectura

Es una arquitectura cliente-servidor en tres capas, con un contenedor por capa ejecutable.

```text
                    ┌──────────────────────────────────────────────┐
  Navegador ───────►│ facyt_payments_app (nginx, :8080 → host 8083)│
                    │  /        SPA Vue (archivos estáticos)       │
                    │  /api/*   proxy inverso ─────────────┐       │
                    └──────────────────────────────────────┼───────┘
                                                           │  red Docker
                    ┌──────────────────────────────────────▼───────┐
                    │ facyt_payments_back (Express, :3000)         │
                    │  middleware → rutas → servicios → Prisma     │
                    └──────────────────────────────────────┬───────┘
                                                           │
                                          SQLite /data/app.db (volumen backend-data)
```

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Presentación | Vue 3, Vue Router 5, Pinia 4, Vite 8, TypeScript | Interfaz, navegación según el rol y formato de los datos |
| Servidor web | nginx (`nginx-unprivileged`) | Sirve la SPA, hace de proxy de `/api` y agrega las cabeceras de seguridad |
| Aplicación | Express 5, TypeScript, Zod 4 | Autenticación, autorización, validación, reglas de negocio, auditoría y PDFs |
| Datos | SQLite y Prisma 7 (adaptador `better-sqlite3`) | Persistencia, más los triggers de inmutabilidad y auditoría |

**Mismo origen.** El navegador solo habla con nginx. La API vive en `/api` del mismo origen que la SPA, así que no hace falta CORS y la cookie de sesión puede ser `SameSite=Strict`. El backend no publica ningún puerto en el host.

### Estructura del repositorio

```text
├── docker-compose.yml
├── .env.example
├── docs/                      # Esta documentación
├── backend/
│   ├── Dockerfile
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/        # SQL versionado, incluidos los triggers
│   ├── src/
│   │   ├── app.ts             # Arma la app Express (middlewares y routers)
│   │   ├── server.ts          # Arranque y apagado ordenado
│   │   ├── config/env.ts      # Variables de entorno validadas con Zod
│   │   ├── db/                # seed.ts y demo-activity.ts
│   │   ├── lib/               # Utilidades transversales
│   │   ├── middleware/        # authenticate, requirePermission, errores
│   │   ├── modules/<módulo>/  # *.routes.ts y *.service.ts por dominio
│   │   └── rbac/permissions.ts
│   └── tests/                 # Vitest y Supertest con su propia base
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── api/               # Un archivo por recurso, sobre http.ts
        ├── components/        # AppModal, CommandPalette, PaginationBar, StatusBadge, reports/…
        ├── layouts/AppLayout.vue
        ├── lib/               # Fechas, dinero, estados
        ├── rbac/permissions.ts
        ├── router/index.ts
        ├── stores/            # auth y pending
        ├── styles.css
        └── views/
```

---

## 3. Backend

### 3.1 Capas

Cada petición pasa por las mismas etapas:

```text
petición
  → helmet, express.json (100 kB), cookie-parser
  → router del módulo
      → authenticate          lee la cookie, verifica el JWT y carga el usuario y sus permisos de la BD
      → requirePermission(…)  403 si falta algún permiso
      → handler               valida la entrada con Zod y llama al servicio
          → servicio          reglas de negocio en prisma.$transaction(tx => …)
              → audit(tx, …)  registro en audit_log, en la misma transacción
  → errorHandler              traduce cualquier error a { error: { code, message, details? } }
```

- **Rutas** (`*.routes.ts`): definen el esquema Zod de la entrada, el permiso requerido y la forma de la respuesta. No contienen reglas de negocio.
- **Servicios** (`*.service.ts`): contienen las reglas. Toda escritura va dentro de una transacción y deja su registro de auditoría. Los errores esperados se lanzan como `HttpError(status, code, message)`.
- **DTOs:** los servicios no devuelven los registros de Prisma tal cual. Los convierten con funciones `toXxxDto`, que formatean las fechas sin hora como `AAAA-MM-DD` y ocultan los campos internos.

### 3.2 Módulos

| Módulo | Prefijo | Responsabilidad |
|---|---|---|
| `auth` | `/api/auth` | Login, logout y `me`. Emite el JWT y aplica los límites de intentos |
| `users` | `/api/users` | Alta, edición, desactivación y borrado lógico de usuarios |
| `roles` | `/api/roles` | Consulta de roles y permisos (solo lectura) |
| `settings` | `/api/settings` | Parámetros de la empresa para los PDFs (nombre, RIF, dirección y pie de recibo) |
| `areas` | `/api/areas` | Áreas, con descripción obligatoria. Se desactivan, no se borran |
| `payment-groups` | `/api/payment-groups` | Grupos de pago y generación de sus períodos |
| `audit` | `/api/audit-log` | Consulta paginada y filtrable del log |
| `people` | `/api/people` | Beneficiarios. Normaliza la cédula |
| `projects` | `/api/projects` | Proyectos. Genera el código y valida la vigencia |
| `assignments` | `/api/assignments` | Asignaciones, cambio de monto, fecha de fin y anulación *(PR #20)* |
| `accruals` | `/api/accruals` | Causación por lote, prorrateo y anulaciones |
| `payment-requests` | `/api/payment-requests`, `/api/payments` | Ciclo de las solicitudes, pagos FIFO y anulación de pagos |
| `petty-cash` | `/api/petty-cash` | Cajas, meses y vales |
| `reports` | `/api/reports` | Saldos, pagos, estado de cuenta y PDFs. Solo lectura |

### 3.3 Utilidades transversales (`backend/src/lib/`)

| Archivo | Qué resuelve |
|---|---|
| `audit.ts` | `audit(tx, ...entries)`: inserta en `audit_log` con el cliente de la transacción |
| `dates.ts` | Fechas sin hora a medianoche UTC, zona de negocio `America/Caracas` (`businessToday()`) y `dateOnlySchema` |
| `money.ts` | `amountCentsSchema` (entero positivo, máximo USD 1.000.000) y formato en `es-VE` |
| `pagination.ts` | `paginationQuerySchema()`, `pageArgs()` y `pageResult()`. Por defecto 50 por página, con un máximo de 200 |
| `names.ts` | Compara nombres sin distinguir mayúsculas ni acentos ("Física" y "fisica" son el mismo nombre) |
| `zod-es.ts` | Mensajes de validación en español |
| `http-error.ts` | `HttpError` con estado, código y mensaje |
| `prisma-errors.ts` | Detecta violaciones de unicidad y otras conocidas |

### 3.4 Errores

`middleware/error-handler.ts` responde siempre con el mismo formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Datos inválidos", "details": { "email": ["..."] } } }
```

| Origen | Respuesta |
|---|---|
| `HttpError` | Su estado y su código |
| `ZodError` | `400 VALIDATION_ERROR`, con los errores por campo |
| Prisma P2002, P2003 y P2025 | `409`, `409` y `404` |
| JSON malformado o cuerpo demasiado grande | `400 BAD_REQUEST` |
| Cualquier otro | `500 INTERNAL_ERROR`. Se registra en el servidor sin exponer detalles |

Express 5 reenvía al manejador las promesas rechazadas, así que los handlers `async` no necesitan `try/catch`. Las excepciones fuera del ciclo de petición cierran el proceso de forma ordenada, para que Docker lo reinicie.

---

## 4. Modelo de datos

```text
Role ─< RolePermission >─ Permission
  │
User ─────────────────────────────── (autor de lotes, decisiones, pagos, vales, anulaciones, auditoría)

Area ─< Project ─< Assignment >─ Person
                       │    └──── PaymentGroup ─< Period
                       │                            │
AccrualBatch (Project × Period) ─< Accrual >────────┘
                                    │
PaymentRequest (Project) ─< PaymentRequestItem >─ Accrual
        └─< Payment (Person) ─< PaymentAllocation >─ Accrual

Project ─< PettyCashFund ─< PettyCashPeriod (año, mes) ─< PettyCashVoucher

AuditLog (append-only)      Setting (clave/valor)
```

| Grupo | Modelos | Notas |
|---|---|---|
| Acceso | `User`, `Role`, `Permission` y `RolePermission` | `User` tiene borrado lógico (`delete_date` y `deleted_by_id`) |
| Control | `AuditLog` y `Setting` | `audit_log` es de solo inserción |
| Catálogos | `Area`, `PaymentGroup` y `Period` | Los períodos son consecutivos y con ambos extremos inclusivos |
| Operación | `Person`, `Project` y `Assignment` | `Assignment` se anula con `annulledAt`, `annulledById` y `annulmentReason` *(PR #20)* |
| Causación | `AccrualBatch` y `Accrual` | `Accrual` guarda una copia del monto y de los días usados en el prorrateo |
| Pagos | `PaymentRequest`, `PaymentRequestItem`, `Payment` y `PaymentAllocation` | `PaymentRequestItem.requestedCents` guarda el saldo que tenía la causación al incluirla |
| Caja chica | `PettyCashFund`, `PettyCashPeriod` y `PettyCashVoucher` | Hay un mes por caja y por año-mes (`@@unique`) |

**Convenciones:**

- **Dinero:** siempre en centavos enteros (`amountCents`, `spentCents`…).
- **Fechas sin hora** (vigencias, períodos, pagos): `DateTime` a medianoche UTC.
- **Estados:** `String` con valores en inglés (`DRAFT`, `SUBMITTED`…). La interfaz los traduce.
- **Llaves foráneas:** todas con `onDelete: Restrict`. Nada se borra en cascada.

### 4.1 Migraciones

| Migración | Contenido |
|---|---|
| `20261103033524_init` | Usuarios, roles y permisos |
| `20261103230000_audit_catalogs` | `audit_log` (con sus triggers de solo inserción), parámetros, áreas, grupos de pago y períodos |
| `20261104001912_people_projects_assignments` | Personas, proyectos y asignaciones |
| `20261108125839_accruals_payments_petty_cash` | Causación, solicitudes, pagos, cajas chicas y **los triggers de inmutabilidad financiera** |
| `20261111213000_user_soft_delete` | Borrado lógico de usuarios |
| `20261118010000_area_description_no_delete` | Descripción de las áreas y triggers `area_no_delete` y `project_no_delete` |
| `20261118030000_assignment_annulment` *(PR #20)* | Redefine `Assignment` para la anulación y agrega los triggers `assignment_no_delete`, `assignment_annulled_is_final` y `assignment_annulment_complete` |

Las dos migraciones que redefinen una tabla (`User` y `Assignment`) usan el patrón de Prisma para SQLite: `PRAGMA foreign_keys=OFF`, crear la tabla nueva, copiar los datos y renombrar. SQLite no permite agregar una llave foránea con `ALTER TABLE`. La de `Assignment` se probó sobre una base con datos de demostración: conserva asignaciones y causaciones, sin violaciones de integridad.

### 4.2 Triggers

| Tablas | Qué garantizan |
|---|---|
| `audit_log` | No se modifica ni se borra |
| `Accrual`, `Payment` | No se borran. El único cambio permitido es anularlos una vez, con usuario y motivo |
| `Accrual` | No puede haber dos causaciones vigentes de la misma asignación en el mismo período |
| `AccrualBatch`, `PaymentRequestItem`, `PaymentAllocation` | No se modifican ni se borran |
| `PaymentRequest`, `PettyCashPeriod`, `PettyCashVoucher` | No se borran. En estado final (cerrada, rechazada, cancelada; mes cerrado; vale terminado) no cambian |
| `Area`, `Project` | No se borran |
| `Assignment` *(PR #20)* | No se borra. Una vez anulada no cambia, y la anulación exige usuario y motivo |

---

## 5. Reglas de negocio por módulo

### 5.1 Grupos de pago y períodos (`payment-groups/periods.ts`)

| Periodicidad | `cutoffDay` | Ejemplo |
|---|---|---|
| `WEEKLY` | Día de la semana en que cierra (0 = domingo … 6 = sábado) | Cierre viernes: sáb 3 → vie 9 |
| `BIWEEKLY` | Último día de la primera quincena (1 a 27, por defecto 15). La segunda cierra a fin de mes | 1 → 15 y 16 → 31 |
| `MONTHLY` | Día del mes en que cierra (1 a 28), o `null` para fin de mes | Corte 25: 26 nov → 25 dic |

- **Primer período:** empieza en la fecha indicada y cierra en el siguiente corte, así que puede ser más corto.
- **Generaciones siguientes:** continúan desde el día posterior al último corte. No hay huecos ni solapamientos.
- **Cambios de configuración:** cambiar la periodicidad o el corte solo afecta a los períodos que se generen después.
- **Borrado:** solo se puede borrar el último período, y solo si no tiene causaciones.

### 5.2 Personas, proyectos y asignaciones

- **Cédula:** se normaliza a `V-12345678` o `E-12345678`, y es única.
- **Código de proyecto:** se genera al guardar, con el prefijo del área más 4 caracteres al azar (`BIO-7KQ3`).
  - Usa `crypto.randomInt` y un alfabeto sin 0, O, 1, I ni L.
  - Se comprueba que el código no exista y se reintenta hasta 10 veces.
  - Después no se edita: el PATCH es `.strict()` y rechaza `code`.
- **Vigencia:** no se crea un proyecto con la vigencia ya terminada (`PROJECT_ALREADY_ENDED`). Sí puede empezar en el pasado, para registros retroactivos.
- **Asignación:**
  - Debe caber en la vigencia de su proyecto, y no puede solaparse con otra de la misma persona, proyecto y grupo de pago.
  - Sin fecha de fin, dura lo mismo que el proyecto.
- **El monto no se edita.** `POST /api/assignments/:id/amount-change` cierra la asignación el día anterior y crea otra desde la fecha indicada, en una sola transacción.
- **Protección de lo causado:** no se puede mover una fecha de fin, cambiar un monto ni mover el fin de un proyecto si eso altera los días de un período ya causado.
- **Desactivación:** personas, proyectos y grupos de pago solo se desactivan si no tienen asignaciones vigentes o futuras (`openAssignmentWhere`).
- **Anulación** *(PR #20)*: `POST /api/assignments/:id/annul` con motivo.
  - No se puede si la asignación tiene causaciones vigentes: primero se anulan en Causación.
  - Una asignación anulada no se causa y no cuenta para solapamientos, desactivaciones ni vigencia.

### 5.3 Causación (`accruals/`)

- **Prorrateo** (`proration.ts`):

  ```text
  díasActivos = |[max(inicioAsignación, inicioPeríodo), min(finEfectivo, finPeríodo)]|  (ambos extremos inclusivos)
  causado     = round_half_up(montoPorPeríodo × díasActivos ÷ díasDelPeríodo)
              = floor((monto × activos × 2 + total) / (2 × total))   ← solo enteros
  ```

  Ejemplo: USD 450 por quincena, con inicio el 6 de enero, causa 10/15 × 450 = USD 300.
- **Por lote:** `POST /api/accruals/generate` con `periodId` y, opcionalmente, `projectId`. Crea un `AccrualBatch` por proyecto con las asignaciones que tienen días activos en el período.
- **Solo períodos cerrados:** la fecha de fin del período debe ser igual o anterior a hoy, en la zona del negocio.
- **Sin duplicados:** si se agrega una asignación retroactiva o se anula una causación, volver a generar crea un **lote complementario** solo con lo que falta. El trigger `accrual_unique_active` lo refuerza.
- **Anulación:** se anula una causación o un lote completo, siempre con motivo. No se puede anular lo que tiene pagos vigentes o está en una solicitud abierta.
- **Pantalla:** muestra los lotes, con causado, pagado y pendiente. Lo pagado sale de `paidByAccrual`, que solo suma pagos no anulados.

### 5.4 Solicitudes de pago y pagos (`payment-requests/`)

```text
DRAFT ──submit──► SUBMITTED ──approve──► APPROVED ──close──► CLOSED
  │                 │   │                   │
  └──cancel──► CANCELLED ◄─┘ └──reject──► REJECTED      (pagos mientras está APPROVED)
```

| Transición | Permiso | Regla |
|---|---|---|
| Crear (borrador) | `payment-requests:create` | Incluye las causaciones vigentes del proyecto que tienen saldo y no están en otra solicitud abierta. Guarda el saldo de cada una (`requestedCents`) |
| Enviar o cancelar | `payment-requests:create` | Se puede cancelar en borrador o enviada |
| Aprobar o rechazar | `payment-requests:decide` | El rechazo exige motivo |
| Registrar un pago | `payments:register` | Por persona y con un monto parcial permitido. Se reparte **FIFO** sobre las causaciones de la persona en la solicitud, de la más antigua a la más nueva |
| Cerrar | `payments:register` | Si queda saldo pendiente, exige un motivo. Ese saldo vuelve a la deuda |
| Anular un pago | `payments:register` | Exige motivo. El monto vuelve a la deuda de la persona |

`fifo.ts` es una función pura: recibe las deudas en orden y el monto, y devuelve cuánto se aplica a cada causación. Si el monto supera la deuda total, devuelve `null`. El reparto queda guardado en `PaymentAllocation`, así que cada recibo puede mostrar cómo se aplicó.

### 5.5 Cajas chicas (`petty-cash/`)

- **Cajas:** cada una pertenece a un proyecto activo y se puede reasignar. Solo se desactiva si no tiene un mes abierto.
- **Meses:**
  - El primero necesita un monto inicial. Los siguientes son consecutivos y abren con el saldo final del mes anterior (arrastre), más la reposición que se indique.
  - No se abren meses futuros.
- **Vales:**

  ```text
  REQUESTED ──approve──► APPROVED ──disburse──► DISBURSED ──settle──► SETTLED
      │  └──reject──► REJECTED
      └──cancel──► CANCELLED
  ```

  - Aprobar **reserva** el monto, así que solo se aprueba si el saldo disponible lo cubre.
  - Solo **quien pidió el vale** puede cancelarlo o rendirlo.
  - La rendición indica lo gastado (como máximo, lo desembolsado), el número y la fecha del comprobante. Lo no gastado vuelve a la caja.
- **Cierre:** solo cuando todos los vales del mes terminaron. `saldo final = saldo inicial + reposición − gastado`.

### 5.6 Reportes y PDFs (`reports/`)

| Endpoint | Contenido |
|---|---|
| `GET /api/reports/balances?groupBy=person\|project` | Causado, pagado y adeudado, con totales |
| `GET /api/reports/payments` | Pagos: cuándo, a quién y por qué proyecto. Los anulados se listan, pero no suman |
| `GET /api/reports/people/:id/statement` | Estado de cuenta: cada causación con lo pagado y lo adeudado, más los pagos |
| `GET /api/reports/payments/:id/receipt` | PDF del recibo individual: monto en números y en letras, aplicación FIFO y firmas. Si el pago está anulado, sale con la marca ANULADO |
| `GET /api/reports/payment-requests/:id/consolidated` | PDF de la solicitud consolidada: historial, resumen por persona, detalle y firmas. Si no está aprobada, sale con marca de agua |

- **Filtros:** todos aceptan `projectId`, `personId`, `areaId`, `from` y `to`. Las causaciones se ubican por la fecha de fin de su período, y los pagos por su fecha de entrega.
- **Generación de los PDFs:** se generan en el servidor con pdfkit (`pdf.ts` y `documents.ts`), con los datos de la empresa tomados de los parámetros. `amount-in-words.ts` convierte el monto a letras.

---

## 6. Seguridad

| Aspecto | Implementación |
|---|---|
| Contraseñas | bcrypt con costo 10. Si el usuario no existe, se compara contra un hash de relleno, para que el tiempo de respuesta no revele qué correos existen |
| Sesión | JWT firmado con `JWT_SECRET` (mínimo 32 caracteres), en la cookie `session`: `httpOnly`, `SameSite=Strict`, `path=/api` y `Secure` si `COOKIE_SECURE=true`. **Sin `maxAge`**: se borra al cerrar el navegador. El token vence a las `JWT_EXPIRES_IN_HOURS` (8 por defecto) |
| Revocación | `authenticate` lee el usuario de la BD en cada petición. Un cambio de rol, una desactivación o un borrado aplican de inmediato |
| Autorización | `requirePermission` en **cada** ruta. El frontend solo oculta lo que el usuario no puede hacer |
| Segregación de funciones | La matriz está en código (`rbac/permissions.ts`), el seed la sincroniza en cada arranque y la interfaz la muestra en solo lectura. Nadie puede cambiar su propio rol, desactivarse ni eliminarse |
| Fuerza bruta | 20 intentos fallidos por IP y 10 por cuenta, cada 15 minutos (`express-rate-limit`). `TRUST_PROXY_HOPS` define cuántos proxies hay delante, para tomar la IP real |
| Cuenta desactivada *(PR #20)* | Con la contraseña correcta: `403 ACCOUNT_INACTIVE`. En los demás casos: `401` genérico |
| CSRF | Cubierto por `SameSite=Strict` y el mismo origen. No se usan tokens CSRF |
| Cabeceras | En la API, Helmet. En la SPA, nginx agrega CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `nosniff` y `Referrer-Policy` |
| Entrada | Todo pasa por Zod. Cuerpo máximo de 100 kB |
| Exposición | Solo nginx publica un puerto. El backend corre en el contenedor como el usuario `node`, sin privilegios |
| Auditoría | Cada escritura deja su registro. El hash de la contraseña nunca se guarda: solo `passwordChanged: true` |
| Interfaz | `?redirect=` tras el login solo se sigue si el usuario puede ver esa página. Al volver a una pestaña, la sesión se revalida |

---

## 7. Frontend

### 7.1 Organización

- **`api/`:** un archivo por recurso (`projects.ts`, `accruals.ts`…), todos sobre `http.ts`. Cada uno declara los tipos de la respuesta y las etiquetas en español de los estados.
- **`http.ts`:** hace `fetch` a `/api` con la cookie. Si la respuesta no es correcta lanza `ApiError(status, code, message, details)`. Ante un `401` llama a `onUnauthorized`, que lleva al login.
- **`stores/auth.ts`:** usuario actual, `can(permiso)`, `ensureLoaded()` y `revalidate()`.
- **`stores/pending.ts`:** lo que espera una acción del usuario según su rol. Alimenta los contadores del menú, el Inicio y la paleta de comandos.
- **`router/index.ts`:** cada ruta declara `meta.permission`, y `beforeEach` redirige a login o a "Sin acceso". El menú lateral se arma con `navLabel`, `navGroup`, `navIcon` y `navPermission`.
- **`rbac/permissions.ts`:** copia de los códigos de permiso del backend. Solo decide qué se muestra.
- **`lib/`:** `dates.ts` (formato `es-VE` y rangos), `money.ts` (de centavos a USD) y `status.ts` (tonos de las insignias).

### 7.2 Patrones

- **Solo la última petición actualiza la pantalla.** Cada carga incrementa un contador (`seq`). Si llega una respuesta vieja después de una nueva, se descarta. Así los filtros rápidos no muestran datos cruzados.
- **Modales** (`AppModal`) para crear, editar y confirmar acciones con motivo, como anular, rechazar o cerrar con saldo.
- **Paginación** con `PaginationBar` en las listas grandes (auditoría, causaciones y lotes).
- **Sin librería de componentes:** todo el estilo está en `styles.css`, con tema claro fijo. Se eligió así para no depender de una librería de UI y tener control total del diseño.
- **Detalle con dirección propia:** `/solicitudes-de-pago`, y desde el PR #20 también `/proyectos/:id`, `/reportes/personas/:id` y `/reportes/proyectos/:id`. Se pueden recargar, compartir y volver con Atrás.

---

## 8. Decisiones técnicas

| # | Decisión | Alternativas | Por qué |
|---|---|---|---|
| D1 | **SQLite** como base de datos | PostgreSQL, MySQL | Despliegue en un solo archivo y en un volumen, sin otro contenedor. Las escrituras se serializan, así que no hay carreras al validar solapamientos o saldos. Soporta los triggers que necesitamos. Límite: poca concurrencia de escritura, suficiente para el uso esperado |
| D2 | **Prisma 7** como ORM | SQL a mano, Knex | Esquema tipado y migraciones versionadas. Los triggers se escriben en SQL dentro de las migraciones |
| D3 | **Dinero en centavos enteros** | `Decimal`, `float` | Sumas y prorrateos exactos. Con `float` aparecen errores de redondeo, y el redondeo se hace explícito (la mitad sube) |
| D4 | **Fechas sin hora a medianoche UTC**, con zona de negocio `America/Caracas` | `DateTime` local | El conteo de días del prorrateo no depende de la zona del servidor. "Hoy" se calcula en la zona del negocio |
| D5 | **Inmutabilidad con anulaciones y triggers** | Solo validar en el servicio | Lo exige el enunciado (2.3). Los triggers son una segunda defensa, que funciona incluso con SQL directo |
| D6 | **Auditoría en la misma transacción**, con `before` y `after` en JSON | Triggers de auditoría, auditoría asíncrona | O se guardan el cambio y su registro, o ninguno de los dos. Además se sabe **qué usuario** hizo el cambio, algo que un trigger no conoce |
| D7 | **JWT en una cookie `httpOnly` de sesión, verificado contra la BD** en cada petición | `localStorage`, tokens de refresco | El JavaScript no puede leer la cookie (protege contra XSS). `SameSite=Strict` cubre el CSRF. Leer la BD da revocación inmediata sin listas negras |
| D8 | **RBAC en código, sincronizado por el seed y en solo lectura en la interfaz** | Matriz editable desde la pantalla | La matriz garantiza la segregación de funciones. Una versión editable permitía que el Administrador se diera permisos de dinero, y además el seed la reescribía en cada arranque (se quitó en el PR #14) |
| D9 | **El cambio de monto crea una asignación nueva** | Editar el monto | La causación necesita saber qué monto correspondía a cada día, y así queda el historial |
| D10 | **Solo se causan períodos cerrados**, con lotes complementarios | Causar por adelantado | No se causa lo que aún no ocurrió. Las altas retroactivas se resuelven sin duplicar |
| D11 | **FIFO con el reparto guardado** (`PaymentAllocation`) | Calcular el reparto al vuelo | El recibo muestra qué deuda cubrió cada pago, y una anulación revierte exactamente eso |
| D12 | **El saldo se guarda en `PaymentRequestItem`** | Leer el saldo actual | La solicitud refleja lo que se pidió al crearla, aunque después cambien otras cosas |
| D13 | **PDFs en el servidor con pdfkit** | Generarlos en el navegador | Un mismo formato para todos y los datos de la empresa en un solo lugar. El navegador no recibe datos de más |
| D14 | **Backend sin puerto publicado, detrás de nginx** | Publicar los dos | Mismo origen (sin CORS) y no se puede saltar el proxy ni falsear `X-Forwarded-For` |
| D15 | **Límite de login por IP y por cuenta** | Solo por IP | La IP se comparte (NAT) o se falsea. Contrapartida: alguien puede bloquear una cuenta conocida durante 15 minutos |
| D16 | **Borrado lógico de usuarios** | Borrado físico | Los usuarios son autores de registros financieros y de auditoría (llaves foráneas `Restrict`) |
| D17 | **Áreas, proyectos y asignaciones no se borran** | Borrado físico | Se conserva el historial de lo causado y lo pagado. Se desactivan o se anulan |
| D18 | **Código de proyecto aleatorio con el prefijo del área** | Correlativo, código manual | Se lee y se dicta sin confusiones. No revela cuántos proyectos hay. Al no editarse, recibos y reportes siguen siendo coherentes |
| D19 | **Grupos de pago a cargo del Generador** (`assignments:manage`, PR #9) | A cargo del Administrador (`catalogs:manage`) | El Generador es quien arma las asignaciones y conoce los calendarios de pago. **Nota:** el enunciado ubica los grupos de pago en "Gestión de Catálogos", así que esta decisión debe justificarse en la defensa |
| D20 | **Mensajes y textos en español; códigos y estados en inglés** | Todo en un idioma | Los códigos (`ASSIGNMENT_HAS_ACCRUALS`) son estables para el frontend y los tests, y los mensajes son para el usuario |
| D21 | **Sin librería de UI en el frontend** | Vuetify, PrimeVue, Tailwind | Menos dependencias y un diseño propio y consistente |

---

## 9. Pruebas

- **Herramientas:** Vitest y Supertest contra la app real (`createApp()`), con una base SQLite propia (`prisma/test.db`). `global-setup.ts` la recrea, aplica las migraciones y ejecuta el seed. No toca `dev.db`.
- **Cobertura** (10 archivos, 166 tests con el PR #20):

| Archivo | Qué prueba |
|---|---|
| `rbac.test.ts` | Login, cookie, límites de intentos, permisos por rol, revocación inmediata, protección contra bloqueo, borrado lógico y cuenta desactivada |
| `catalogs.test.ts` | Áreas, grupos de pago, parámetros, nombres duplicados y auditoría |
| `periods.test.ts` | Generación de períodos por periodicidad y corte |
| `people-projects.test.ts` | Cédulas, código de proyecto, vigencias, asignaciones, solapamientos, cambio de monto y anulación |
| `proration.test.ts` | Fórmula de prorrateo y redondeo |
| `accruals.test.ts` | Causación por lote, lotes complementarios, anulaciones, filtros y totales |
| `payment-requests.test.ts` | Ciclo de las solicitudes, segregación de funciones, FIFO, cierre con saldo y anulación de pagos |
| `petty-cash.test.ts` | Meses, arrastre, vales, reserva de saldo, cierre y vales solo del solicitante |
| `reports.test.ts` | Saldos, pagos, estado de cuenta, PDFs y montos en letras |
| `pagination-errors.test.ts` | Paginación y formato de errores |

- **Inmutabilidad:** los tests modifican y borran registros directamente en la base de datos, sin pasar por la API, para comprobar que los triggers lo rechazan.
- **Comandos:** `npm test` y `npm run typecheck` en `backend/`, y `npm run typecheck` y `npm run build` en `frontend/`.

---

## 10. Despliegue

- **Backend** (`backend/Dockerfile`): imagen `node:24-slim` en varias etapas.
  - Al arrancar ejecuta `prisma migrate deploy`, después el seed y por último el servidor.
  - El seed es idempotente: sincroniza roles y permisos y crea lo que falta. Con `SEED_USER_PASSWORD` también carga usuarios y datos de demostración, solo si la base no tiene movimientos.
  - Corre como el usuario `node`.
- **Frontend** (`frontend/Dockerfile`): Vite compila y `nginx-unprivileged` sirve en el puerto 8080.
- **Compose** (`docker-compose.yml`):
  - El backend tiene un healthcheck sobre `/api/health`, y el frontend espera a que esté sano.
  - Contenedores `facyt_payments_back` y `facyt_payments_app`.
  - Los datos viven en el volumen `backend-data`.
  - Ambos contenedores usan la red **externa** `portainer_network`. nginx apunta a `facyt_payments_back:3000` por nombre de contenedor, porque en una red compartida el alias `backend` podría resolver a otro stack.

| Variable | Uso |
|---|---|
| `JWT_SECRET` | Obligatoria, mínimo 32 caracteres |
| `SEED_USER_PASSWORD` | Contraseña de los usuarios de prueba. Vacía significa que no se crean |
| `FRONTEND_PORT` | Puerto del host (8083 por defecto) |
| `COOKIE_SECURE` | `true` si se sirve por HTTPS |
| `TRUST_PROXY_HOPS` | Proxies delante del backend: `1` si solo está nginx, `2` si hay otro que termina HTTPS |

**En una máquina sin Portainer** hay que crear la red antes de `docker compose up`:

```bash
docker network create portainer_network
```

---

## 11. Cómo extender el sistema

### Agregar un módulo

1. Modelo en `schema.prisma` y `npm run db:migrate`. Si los registros deben ser inmutables, agregar el trigger a mano en el SQL de la migración.
2. `backend/src/modules/<módulo>/<módulo>.service.ts`: reglas dentro de `prisma.$transaction`, `audit(tx, …)` en cada escritura, `HttpError` para los errores esperados y un DTO para la salida.
3. `<módulo>.routes.ts`: esquemas Zod y `authenticate` más `requirePermission(...)` en cada ruta. Registrar el router en `app.ts`.
4. Si hace falta un permiso nuevo, agregarlo en `PERMISSIONS` y `PERMISSION_DESCRIPTIONS`, asignarlo en `ROLES` y copiarlo en `frontend/src/rbac/permissions.ts`.
5. Tests en `backend/tests/` con los helpers de `helpers.ts`.
6. Frontend: `api/<módulo>.ts`, la vista en `views/` y la ruta con `meta.permission` (y `navLabel` si va en el menú).

### Reglas que no se deben romper

- Ninguna escritura sin transacción y sin auditoría.
- Nada financiero se borra ni se edita: se anula con motivo.
- Montos en centavos enteros y fechas sin hora a medianoche UTC.
- La autorización vive en el backend. Ocultar algo en el frontend no lo protege.

---

## 12. Estado del proyecto

### 12.1 Cumplimiento del enunciado

| Requerimiento | Estado |
|---|---|
| 2.1 Roles, segregación, catálogos, proyectos, grupos de pago y asignaciones | Completo |
| 2.2 Prorrateo exacto y causación por lote | Completo |
| 2.3 Flujo de solicitudes, pagos parciales FIFO e inmutabilidad | Completo |
| 2.4 Cajas chicas con apertura mensual, vales, rendición y arrastre | Completo |
| 2.5 PDFs (recibo individual y solicitud consolidada) y `audit_log` | Completo |
| 4 Código, scripts de base de datos, seed y README | Completo. El README tiene detalles por corregir (ver 12.3) |

### 12.2 Historial de PRs

| PR | Contenido |
|---|---|
| #1, #2 | Auditoría, parámetros y catálogos. Personas, proyectos y asignaciones |
| #3, #4 | Causación, solicitudes y pagos, cajas chicas, reportes y PDFs |
| #5 a #7 | Formato de fechas unificado y protección contra respuestas que llegan fuera de orden |
| #8 | Modales, comparación en Auditoría y borrado lógico de usuarios |
| #9 | Reportes por componentes. Grupos de pago a cargo del Generador |
| #10 a #12 | Despliegue en Portainer |
| #13 | Navegación por rol, pendientes en el menú y paleta de comandos |
| #14 | Matriz de permisos en solo lectura y auditoría sin registros vacíos |
| #15 | Sesión que se cierra con el navegador y `?redirect=` seguro |
| #16 | Vales solo del solicitante, límite de login por cuenta, CSP en la SPA y backend sin puerto publicado |
| #17 | `dev` → `main` |
| #18 | Revisión funcional: descripción de áreas, código y vigencia de proyectos, filtros y UX |
| #19 | Causación por lotes desplegables y código de proyecto aleatorio |
| #20 *(en revisión)* | Anulación de asignaciones, ficha de proyecto, reportes por dirección e Inicio del administrador |

### 12.3 Pendientes conocidos

| Prioridad | Pendiente |
|---|---|
| Media | **README:** dice puerto 8080 (es 8083), la sección "Desarrollo local sin Docker" está duplicada y faltan `TRUST_PROXY_HOPS`, la red `portainer_network` y el borrado lógico de usuarios |
| Media | **Despliegue local:** Compose depende de `portainer_network`. Conviene un `docker-compose.override.yml` para máquinas sin Portainer, o al menos documentar `docker network create` |
| Media | **Decisión D19** (grupos de pago a cargo del Generador): confirmarla en equipo y tener la justificación lista para la defensa |
| Media | **Usuarios eliminados:** su email queda ocupado y no hay forma de restaurarlos. Decidir si se libera el email, si se permite reactivar o si se deja así |
| Baja | La API de usuarios devuelve cada campo dos veces (`deleteDate` y `delete_date`…). Dejar solo camelCase |
| Baja | `POST /api/projects` todavía acepta un `code` manual, aunque la interfaz no lo envía |
| Baja | No existe `GET /api/projects/:id`: la ficha del proyecto carga la lista completa *(PR #20)* |
| Baja | Acortar una asignación en el pasado solo se limita en la interfaz; el servidor lo permite por decisión del equipo *(PR #20)* |
| Baja | `dev` quedó detrás de `main`: hay que sincronizarla antes de abrir PRs hacia `dev` |

---

## 13. Glosario

| Término | Significado |
|---|---|
| Asignación | Monto en USD que una persona gana por cada período completo en un proyecto, según un grupo de pago |
| Grupo de pago | Calendario de cortes (semanal, quincenal o mensual) que define los períodos |
| Período | Tramo entre dos cortes de un grupo de pago, con ambos extremos inclusivos |
| Causación | Registro de lo que se le debe a una persona por un período, prorrateado por los días activos |
| Lote | Conjunto de causaciones de un proyecto en un período, generadas juntas |
| Lote complementario | Lote nuevo del mismo proyecto y período, solo con lo que faltaba causar |
| Solicitud de pago | Pedido de fondos para pagar la deuda pendiente de un proyecto |
| FIFO | Un pago cubre primero la causación más antigua de la persona |
| Anulación | Corrección de un registro inmutable. Queda quién, cuándo y por qué, y el registro no se borra |
| Caja chica | Fondo de un proyecto para gastos menores, que se administra por mes |
| Vale | Pedido de dinero de la caja chica |
| Rendición | Justificación de lo gastado de un vale, con su comprobante |
| Arrastre | El saldo final de un mes pasa a ser el saldo inicial del siguiente |
