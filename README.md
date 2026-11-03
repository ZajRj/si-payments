# Sistema de Control de Pagos y Asignaciones

Proyecto final de Sistemas de Información (Universidad de Carabobo). El enunciado está en [proyecto.md](proyecto.md).

Estado actual: estructura base con autenticación, RBAC y gestión de usuarios. Los módulos de negocio (proyectos, causación, pagos, cajas chicas, reportes y auditoría) aún no están implementados.

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

Al arrancar, el backend aplica las migraciones y ejecuta el seed. Los datos se guardan en el volumen `backend-data`. Para borrarlos y empezar de cero, usa `docker compose down -v`.

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
│   │   ├── lib/            # Cliente Prisma, errores HTTP, validaciones
│   │   ├── middleware/     # authenticate, requirePermission, errores
│   │   ├── modules/        # auth, users, roles (rutas y servicios)
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
| `people:manage`, `projects:manage`, `assignments:manage` | — | Sí | — |
| `accruals:generate`, `payment-requests:create` | — | Sí | — |
| `petty-cash:request` | — | Sí | — |
| `payment-requests:decide`, `payments:register` | — | — | Sí |
| `petty-cash:manage` | — | — | Sí |
| `reports:read` | — | Sí | Sí |

Por ahora, la API solo aplica `users:*` y `roles:read`. Los demás permisos quedan definidos para los módulos futuros.

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

## Tests

Los tests cubren autenticación, permisos por rol, revocación de sesiones y segregación de funciones. Usan una base de datos SQLite propia.

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
