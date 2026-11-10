# Sistema de Control de Pagos y Asignaciones

Proyecto final de Sistemas de Información (Universidad de Carabobo). El enunciado está en [proyecto.md](proyecto.md).

Estado actual: autenticación, RBAC, gestión de usuarios, log de auditoría, parámetros, catálogos (áreas, grupos de pago y períodos), personas, proyectos, asignaciones, causación con prorrateo, solicitudes de pago con pagos parciales FIFO, cajas chicas, reportes y PDFs de recibos individuales y solicitudes consolidadas.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | SPA con Vue 3, Vue Router, Pinia, Vite y TypeScript, servida por nginx |
| Backend | Express 5 y TypeScript |
| Base de datos | SQLite con Prisma como ORM |
| Despliegue | Un Dockerfile por proyecto y Docker Compose |

## Ejecución con Docker

Requisito: Docker con Compose.

1. Crea el archivo `.env` a partir del ejemplo:

   ```bash
   cp .env.example .env
   ```

2. Define `JWT_SECRET` en `.env` con al menos 32 caracteres. Puedes generarlo con `openssl rand -hex 32`. Sin este valor, Compose no arranca.

3. Levanta el sistema:

   ```bash
   docker compose up --build
   ```

4. Abre <http://localhost:8080>.

Al arrancar, el backend aplica las migraciones y ejecuta el seed. El seed carga roles, permisos, las áreas (Física, Química y Biología) y los parámetros. Si `SEED_USER_PASSWORD` tiene valor, también carga los usuarios de prueba, tres grupos de pago de ejemplo con sus períodos de 2026, y personas, proyectos y asignaciones ficticias.

En una base sin movimientos, el seed también genera actividad financiera de demostración ([demo-activity.ts](backend/src/db/demo-activity.ts)) con los mismos servicios de la aplicación, a nombre del Generador y el Receptor de prueba. Por eso queda registrada en la auditoría:

- Causaciones de todos los períodos cerrados hasta octubre de 2026, con una anulada.
- Solicitudes en todos los estados: cerradas, aprobada con un pago parcial, cerrada con saldo pendiente, rechazada, cancelada, enviada y borrador.
- Pagos, uno de ellos anulado.
- Una caja chica con meses cerrados desde agosto, arrastre de saldo, el mes actual abierto y vales en cada estado.

No genera nada con fecha futura y no se ejecuta en los tests.

Los datos se guardan en el volumen `backend-data`. Para borrarlos y empezar de cero, usa `docker compose down -v`.

## Desarrollo local sin Docker

Es la forma recomendada para programar: el backend se reinicia solo al guardar y el frontend recarga en caliente. Requisito: Node.js 24 o superior.

1. Backend. Desde `backend/`:

   ```bash
   cp .env.example .env     # define JWT_SECRET con al menos 32 caracteres (openssl rand -hex 32)
   npm ci
   npm run db:setup         # aplica las migraciones y ejecuta el seed (crea prisma/dev.db)
   npm run dev              # API en http://localhost:3000
   ```

2. Frontend. En otra terminal, desde `frontend/`:

   ```bash
   npm ci
   npm run dev              # http://localhost:5173
   ```

3. Abre <http://localhost:5173>. Vite hace de proxy de `/api` hacia el backend; si el backend corre en otro puerto, define `VITE_API_PROXY` (por ejemplo `http://localhost:4000`).

Los usuarios de prueba son los de la sección siguiente, con la contraseña de `SEED_USER_PASSWORD` en `backend/.env`.

| Comando (en `backend/`) | Qué hace |
|---|---|
| `npm run db:setup` | Aplica migraciones y ejecuta el seed. Es seguro repetirlo. |
| `npm run db:migrate` | Crea y aplica una migración nueva tras cambiar `schema.prisma`. |
| `npm run db:seed` | Solo el seed. |
| `npm test` | Tests con su propia base (`prisma/test.db`); no tocan `dev.db`. |
| `npm run typecheck` | Comprueba los tipos. |

Para empezar de cero, borra `backend/prisma/dev.db` y ejecuta `npm run db:setup`.

### Usuarios de prueba

La contraseña es el valor de `SEED_USER_PASSWORD` en `.env` (`Demo1234!` en el ejemplo).

| Email | Rol |
|---|---|
| `admin@example.com` | Administrador del Sistema |
| `generador@example.com` | Generador de Nómina |
| `receptor@example.com` | Receptor de Nómina |

Si `SEED_USER_PASSWORD` está vacío, el seed solo carga roles y permisos, sin usuarios.

## Estructura

```text
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── prisma/             # Esquema y migraciones
│   ├── src/
│   │   ├── config/         # Validación de variables de entorno
│   │   ├── db/seed.ts      # Carga inicial
│   │   ├── lib/            # Prisma, auditoría, fechas, errores HTTP, validaciones
│   │   ├── middleware/     # authenticate, requirePermission, errores
│   │   ├── modules/        # auth, users, roles, settings, areas, payment-groups, audit,
│   │   │                   # people, projects, assignments, accruals, payment-requests,
│   │   │                   # petty-cash, reports
│   │   └── rbac/           # Permisos y matriz por rol
│   └── tests/
└── frontend/
    ├── Dockerfile
    ├── nginx.conf          # Sirve la SPA y hace de proxy de /api al backend
    └── src/
        ├── api/            # Cliente HTTP y llamadas a la API
        ├── layouts/
        ├── rbac/           # Permisos usados por la interfaz
        ├── router/         # Rutas y guardia de navegación
        ├── stores/         # Sesión del usuario
        └── views/
```

Solo el frontend publica un puerto. El backend es accesible únicamente a través del proxy de nginx.

## RBAC

Los permisos se asignan a los roles, y cada usuario tiene un rol. La matriz está en [backend/src/rbac/permissions.ts](backend/src/rbac/permissions.ts). El seed la sincroniza con la base de datos en cada arranque.

| Permiso | Administrador | Generador | Receptor |
|---|---|---|---|
| `users:read`, `users:manage`, `roles:read` | Sí | — | — |
| `settings:manage`, `catalogs:manage`, `audit:read` | Sí | — | — |
| `catalogs:read` | Sí | Sí | Sí |
| `people:read`, `projects:read` | — | Sí | Sí |
| `people:manage`, `projects:manage`, `assignments:manage` | — | Sí | — |
| `payroll:read`, `petty-cash:read` | — | Sí | Sí |
| `accruals:generate`, `payment-requests:create` | — | Sí | — |
| `petty-cash:request` | — | Sí | — |
| `payment-requests:decide`, `payments:register` | — | — | Sí |
| `petty-cash:manage` | — | — | Sí |
| `reports:read` | — | Sí | Sí |

El Administrador no tiene `reports:read`: no participa en operaciones de dinero, así que tampoco ve los reportes ni los PDFs.

### Cómo funciona

- **Sesión:** el login entrega un JWT en una cookie `httpOnly` y `SameSite=Strict`.
- **Revocación inmediata:** `authenticate` lee el usuario y sus permisos de la base de datos en cada petición, así que un cambio de rol o una desactivación aplican de inmediato.
- **Autorización:** `requirePermission` protege cada ruta del backend y responde 403 si falta el permiso.
- **Interfaz:** el frontend oculta rutas y acciones según los permisos del usuario. Es solo una ayuda de navegación, porque quien autoriza es el backend.
- **Protección contra bloqueo:** nadie puede cambiar su propio rol ni desactivarse, por lo que siempre queda al menos un administrador activo.

### Proteger una ruta nueva

```ts
router.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.PROJECTS_MANAGE),
  async (req, res) => { /* ... */ },
);
```

Para crear un permiso, agrégalo en `PERMISSIONS` y `PERMISSION_DESCRIPTIONS`, y asígnalo a los roles en `ROLES`. Se aplicará en el siguiente arranque.

## Auditoría

Cada cambio hecho desde la API se registra en la tabla `audit_log`: quién lo hizo, cuándo, la acción (`CREATE`, `UPDATE` o `DELETE`), la entidad, el id y una copia en JSON del registro antes y después del cambio.

- **Misma transacción:** los servicios llaman a `audit(tx, ...)` ([backend/src/lib/audit.ts](backend/src/lib/audit.ts)) con el cliente de la transacción, así que el cambio y su registro se guardan juntos o ninguno.
- **Solo inserción:** dos triggers de la base de datos impiden modificar o borrar registros de `audit_log`, incluso con SQL directo.
- **Sin secretos:** de los usuarios nunca se guarda el hash de la contraseña; solo `passwordChanged: true` cuando cambia.
- **Consulta:** el administrador la ve en la pantalla Auditoría, con filtros por entidad y fechas.

Al crear un módulo nuevo, todo servicio que escriba en la base de datos debe hacerlo dentro de `prisma.$transaction` y llamar a `audit`.

## Catálogos

| Catálogo | Qué es |
|---|---|
| Parámetros | Datos de la empresa y textos para los documentos. Las claves válidas están en [settings.definitions.ts](backend/src/modules/settings/settings.definitions.ts). |
| Áreas | Física, Química, Biología y las que agregue el administrador. No se borran, se desactivan. |
| Grupos de pago | Periodicidad y día de corte. Cada grupo genera sus períodos de pago. |

### Períodos y fechas de corte

Los períodos son consecutivos, sin huecos, y ambos extremos son inclusivos. El día de corte depende de la periodicidad:

| Periodicidad | Día de corte | Ejemplo |
|---|---|---|
| Semanal | Día de la semana en que cierra (0 = domingo … 6 = sábado) | Cierre viernes: sáb 3 → vie 9 |
| Quincenal | Último día de la primera quincena (1-27, por defecto 15). La segunda cierra a fin de mes | 1 → 15 y 16 → 31 |
| Mensual | Día del mes en que cierra (1-28), o vacío para fin de mes | Corte 25: 26 nov → 25 dic |

El primer período empieza en la fecha que se indique y cierra en el siguiente corte, por lo que puede ser más corto. Las siguientes generaciones continúan desde el día posterior al último corte. Cambiar la periodicidad o el corte de un grupo solo afecta a los períodos que se generen después. Para corregir un corte se puede eliminar el último período y volver a generarlo.

En un grupo quincenal la segunda quincena va hasta fin de mes, así que su largo cambia según el mes (del 16 al 28 de febrero son 13 días; del 16 al 31 de enero, 16). El prorrateo debe usar los días reales de cada período.

Las fechas sin hora se guardan a medianoche UTC para que el conteo de días, que usará el prorrateo, no dependa de la zona horaria del servidor.

### Zona horaria y nombres

- **Zona horaria del negocio:** `America/Caracas` ([backend/src/lib/dates.ts](backend/src/lib/dates.ts)). Define qué día es "hoy" (por ejemplo, para saber si una asignación sigue vigente) y cómo se interpretan los filtros por fecha de la auditoría, aunque el servidor corra en UTC.
- **Nombres sin duplicados:** los nombres de áreas y grupos de pago no se repiten aunque cambien mayúsculas o acentos ("Física" y "fisica" son el mismo).
- **Desactivación:** no se puede desactivar un área con proyectos activos ni un grupo de pago con asignaciones vigentes.
- **Mensajes de validación:** se devuelven en español ([backend/src/lib/zod-es.ts](backend/src/lib/zod-es.ts)).

## Personas, proyectos y asignaciones

Los gestiona el Generador de Nómina; el Receptor solo los consulta.

| Entidad | Qué es |
|---|---|
| Persona | Beneficiario que cobra, sin usuario en el sistema. La cédula se guarda como `V-12345678` o `E-12345678` y no se repite: `v12.345.678` o `V-012345678` se normalizan a la misma. Teléfono y email son opcionales; vacíos se guardan como `null`. |
| Proyecto | Código único, área, ámbito (interno o externo) y vigencia (desde y hasta, inclusivos). |
| Asignación | Persona × proyecto × grupo de pago, con un monto en USD por cada período completo y fechas desde y hasta. Sin fecha hasta, dura lo que dure el proyecto. |

### Reglas

- **Dinero en centavos:** los montos viajan y se guardan como enteros (`amountCents`; `15050` es USD 150,50), para que sumas y prorrateos no pierdan centavos. El frontend los convierte al mostrarlos.
- **Dentro de la vigencia:** una asignación debe empezar y terminar dentro de la vigencia de su proyecto. Por lo mismo, no se puede acortar la vigencia de un proyecto si deja asignaciones fuera.
- **Sin solapamientos:** una persona no puede tener dos asignaciones del mismo proyecto y grupo de pago con días en común, porque se le causaría dos veces el mismo período.
- **El monto no se edita:** un cambio de monto (`POST /api/assignments/:id/amount-change`) cierra la asignación el día anterior y crea otra desde la fecha indicada, en una sola transacción. Así la causación sabe qué monto correspondía a cada día y queda el historial. De una asignación solo se puede cambiar la fecha de fin.
- **Nada se borra:** personas y proyectos se desactivan, y solo si no tienen asignaciones vigentes o futuras. No se crean asignaciones con personas, proyectos o grupos de pago inactivos, ni se reabre (quitando o moviendo la fecha de fin) una asignación cuyas partes estén inactivas.
- **Límite conocido:** el control de solapamientos se hace en el servicio, no con una restricción de la base de datos. Con SQLite las escrituras se serializan, así que en la práctica no hay carreras.

## Causación

Pantalla **Causación**. La genera el Generador de Nómina; el Receptor la consulta.

- **Prorrateo:** monto causado = monto por período de la asignación × días activos ÷ días reales del período, redondeado al centavo (la mitad sube). Se calcula con enteros ([proration.ts](backend/src/modules/accruals/proration.ts)). Ejemplo: USD 450 por quincena con inicio el 6 de enero causa 10/15 de 450 = USD 300 en la primera quincena de enero.
- **Por lote:** `POST /api/accruals/generate` con `periodId` y, opcionalmente, `projectId`. Crea un lote por proyecto con las asignaciones del grupo de pago del período que tengan días activos en él. Solo se causan períodos que ya cerraron (fecha de fin igual o anterior a hoy).
- **Sin duplicados:** una asignación tiene como máximo una causación vigente por período. Si se agrega una asignación retroactiva o se anula una causación, volver a generar crea un lote complementario solo con lo que falta.
- **Protección de lo causado:** no se puede cambiar la fecha de fin de una asignación, hacer un cambio de monto ni mover el fin de un proyecto si eso altera los días de un período ya causado. Tampoco se puede eliminar un período con causaciones.
- **Anulación:** una causación o un lote completo se anulan con motivo (`POST /api/accruals/:id/annul`, `POST /api/accruals/batches/:id/annul`). No se puede anular lo que tiene pagos vigentes o está en una solicitud abierta.

## Solicitudes de pago y pagos

Pantalla **Solicitudes de pago**.

| Estado | Quién | Siguiente |
|---|---|---|
| Borrador | Generador la crea con la deuda pendiente de un proyecto | Enviar o cancelar |
| Enviada | Generador | El Receptor aprueba o rechaza (con motivo); el Generador aún puede cancelarla |
| Aprobada | Receptor | El Receptor registra la entrega de fondos y la cierra |
| Cerrada, Rechazada o Cancelada | — | Estados finales |

- **Contenido:** la solicitud incluye las causaciones vigentes del proyecto con saldo que no estén en otra solicitud abierta, cada una con el monto pendiente que tenía al incluirla. Mientras la solicitud está abierta, esas causaciones no entran en otra ni se anulan.
- **Pagos parciales con FIFO:** cada pago es por persona y puede ser menor a lo pendiente. Se aplica primero a la causación más antigua de la persona en la solicitud ([fifo.ts](backend/src/modules/payment-requests/fifo.ts)) y queda registrado cómo se repartió (`PaymentAllocation`). Cada pago es un recibo individual.
- **Cierre con saldo:** cerrar una solicitud con saldo pendiente exige un motivo; ese saldo vuelve a la deuda y puede ir en otra solicitud.
- **Anulación de pagos:** `POST /api/payments/:id/annul` con motivo. El monto vuelve a la deuda de la persona.

## Cajas chicas

Pantalla **Cajas chicas**. El Receptor gestiona las cajas, abre y cierra los meses, aprueba y desembolsa vales. El Generador solicita, cancela y rinde vales.

- **Cajas:** cada caja pertenece a un proyecto activo y se puede reasignar a otro desde la interfaz. No se borran; se desactivan, y solo sin un mes abierto.
- **Apertura mensual:** el primer mes se elige y necesita un monto inicial. Los siguientes son consecutivos: empiezan con el saldo final del mes anterior (arrastre) más la reposición que se indique. No se abren meses futuros.
- **Vales:** solicitado → aprobado o rechazado (con motivo) → desembolsado → rendido. Un vale solicitado también se puede cancelar. Aprobar reserva el monto, así que solo se aprueba si el saldo disponible lo cubre.
- **Rendición:** se indica lo gastado (como máximo lo desembolsado), el número y la fecha del comprobante. Lo no gastado vuelve a la caja.
- **Cierre:** solo cuando todos los vales del mes terminaron (rendidos, rechazados o cancelados). Saldo final = saldo inicial + reposición − gastado.

## Reportes y PDFs

Pantalla **Reportes**, para el Generador y el Receptor (permiso `reports:read`). Solo leen datos; no escriben en la base de datos.

| Reporte | Endpoint | Qué responde |
|---|---|---|
| Saldos | `GET /api/reports/balances?groupBy=person\|project` | Causado, pagado y adeudado por persona o por proyecto, con totales |
| Pagos | `GET /api/reports/payments` | Cuándo, a quién y por qué proyecto se pagó. Los anulados se listan, pero no suman |
| Estado de cuenta | `GET /api/reports/people/:id/statement` | Cada causación de la persona con lo pagado, lo adeudado y su estado, más sus pagos |

Todos aceptan `projectId`, `personId`, `areaId`, `from` y `to` (AAAA-MM-DD, inclusivos). Las causaciones se ubican por la fecha de fin de su período y los pagos por su fecha de entrega. En los saldos, lo pagado es lo aplicado a esas causaciones por pagos vigentes, sin importar la fecha del pago.

Los PDFs se generan en el backend con [pdfkit](https://pdfkit.org) y se abren en una pestaña nueva. Llevan el nombre, RIF y dirección de la empresa tomados de los parámetros:

- **Recibo individual** (`GET /api/reports/payments/:id/receipt`): beneficiario, proyecto, solicitud, monto en números y en letras, cómo se aplicó el pago a la deuda (FIFO), el pie de recibo de los parámetros y las firmas de quien entrega y quien recibe. Un recibo anulado sale con la marca ANULADO y el motivo.
- **Solicitud consolidada** (`GET /api/reports/payment-requests/:id/consolidated`): estado e historial, resumen por persona, detalle por causación, pagos registrados y firmas de quien elabora y quien aprueba. Si no está aprobada, sale con una marca de agua.

En la pantalla **Solicitudes de pago** también hay un botón para cada PDF.

## Inmutabilidad

Los registros financieros no se modifican ni se borran: los errores se corrigen con anulaciones que guardan quién, cuándo y por qué. Además de las validaciones del servicio, triggers de la base de datos lo garantizan incluso con SQL directo:

- Causaciones y pagos: no se borran; el único cambio permitido es anularlos una vez, con usuario y motivo.
- Lotes, renglones de solicitud y aplicaciones de pagos: no se modifican ni se borran.
- Solicitudes cerradas, rechazadas o canceladas, meses de caja cerrados y vales finalizados: no cambian. Nada de esto se borra.
- Un trigger impide insertar una segunda causación vigente de la misma asignación en el mismo período.

## Tests

Los tests cubren autenticación, permisos por rol, revocación de sesiones, segregación de funciones, catálogos, generación de períodos, auditoría, personas, proyectos, asignaciones, prorrateo, causación por lote, solicitudes y pagos FIFO, cajas chicas, reportes, PDFs, montos en letras e inmutabilidad de los registros financieros. Usan una base de datos SQLite propia.

Con Node 24 instalado:

```bash
cd backend
npm ci
npm test
```

Sin Node, desde PowerShell en la raíz del proyecto:

```powershell
docker run --rm -v "${PWD}/backend:/app" -v /app/node_modules -w /app node:24-slim sh -c "apt-get update -qq && apt-get install -y -qq openssl && npm ci && npm test"
```

## Desarrollo local sin Docker

Requisito: Node 24.

Backend, en <http://localhost:3000>:

```bash
cd backend
cp .env.example .env   # Define JWT_SECRET
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Frontend, en <http://localhost:5173>, con proxy de `/api` hacia el backend:

```bash
cd frontend
npm ci
npm run dev
```

Para cambiar el esquema, edita `backend/prisma/schema.prisma` y ejecuta `npm run db:migrate`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Obligatoria, mínimo 32 caracteres |
| `SEED_USER_PASSWORD` | Contraseña de los usuarios de prueba |
| `FRONTEND_PORT` | Puerto en el host, 8080 por defecto |
| `COOKIE_SECURE` | Ponla en `true` si el sistema se sirve por HTTPS |
