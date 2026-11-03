# Sistema de Control de Pagos y Asignaciones

Proyecto final de Sistemas de Información (Universidad de Carabobo). El enunciado está en [proyecto.md](proyecto.md).

Estado actual: autenticación, RBAC, gestión de usuarios, log de auditoría, parámetros y catálogos (áreas, grupos de pago y períodos). Faltan los módulos de personas, proyectos y asignaciones, causación, pagos, cajas chicas y reportes.

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

Al arrancar, el backend aplica las migraciones y ejecuta el seed. El seed carga roles, permisos, las áreas (Física, Química y Biología) y los parámetros. Si `SEED_USER_PASSWORD` tiene valor, también carga los usuarios de prueba y tres grupos de pago de ejemplo con sus períodos de 2026. Los datos se guardan en el volumen `backend-data`. Para borrarlos y empezar de cero, usa `docker compose down -v`.

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
│   │   ├── modules/        # auth, users, roles, settings, areas, payment-groups, audit
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
| `people:manage`, `projects:manage`, `assignments:manage` | — | Sí | — |
| `accruals:generate`, `payment-requests:create` | — | Sí | — |
| `petty-cash:request` | — | Sí | — |
| `payment-requests:decide`, `payments:register` | — | — | Sí |
| `petty-cash:manage` | — | — | Sí |
| `reports:read` | — | Sí | Sí |

Por ahora, la API aplica `users:*`, `roles:read`, `settings:manage`, `catalogs:*` y `audit:read`. Los demás permisos quedan definidos para los módulos futuros.

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

Las fechas sin hora se guardan a medianoche UTC para que el conteo de días, que usará el prorrateo, no dependa de la zona horaria del servidor.

## Tests

Los tests cubren autenticación, permisos por rol, revocación de sesiones, segregación de funciones, catálogos, generación de períodos y auditoría. Usan una base de datos SQLite propia.

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
