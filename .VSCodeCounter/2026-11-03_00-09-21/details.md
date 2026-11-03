# Details

Date : 2026-11-03 00:09:21

Directory c:\\Users\\Rafael\\Documents\\clases\\si-payments

Total : 61 files,  8752 codes, 28 comments, 375 blanks, all 9155 lines

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [README.md](/README.md) | Markdown | 125 | 0 | 45 | 170 |
| [backend/.dockerignore](/backend/.dockerignore) | Ignore | 7 | 0 | 1 | 8 |
| [backend/Dockerfile](/backend/Dockerfile) | Docker | 20 | 0 | 3 | 23 |
| [backend/package-lock.json](/backend/package-lock.json) | JSON | 5,075 | 0 | 1 | 5,076 |
| [backend/package.json](/backend/package.json) | JSON | 44 | 0 | 1 | 45 |
| [backend/prisma.config.ts](/backend/prisma.config.ts) | TypeScript | 13 | 1 | 3 | 17 |
| [backend/prisma/migrations/20261103033524\_init/migration.sql](/backend/prisma/migrations/20261103033524_init/migration.sql) | MS SQL | 34 | 9 | 10 | 53 |
| [backend/prisma/migrations/migration\_lock.toml](/backend/prisma/migrations/migration_lock.toml) | TOML | 1 | 2 | 1 | 4 |
| [backend/prisma/schema.prisma](/backend/prisma/schema.prisma) | Prisma | 43 | 0 | 8 | 51 |
| [backend/src/app.ts](/backend/src/app.ts) | TypeScript | 23 | 1 | 8 | 32 |
| [backend/src/config/env.ts](/backend/src/config/env.ts) | TypeScript | 17 | 0 | 6 | 23 |
| [backend/src/db/seed.ts](/backend/src/db/seed.ts) | TypeScript | 56 | 2 | 12 | 70 |
| [backend/src/lib/http-error.ts](/backend/src/lib/http-error.ts) | TypeScript | 9 | 0 | 1 | 10 |
| [backend/src/lib/prisma.ts](/backend/src/lib/prisma.ts) | TypeScript | 6 | 0 | 2 | 8 |
| [backend/src/lib/validation.ts](/backend/src/lib/validation.ts) | TypeScript | 4 | 1 | 4 | 9 |
| [backend/src/middleware/authenticate.ts](/backend/src/middleware/authenticate.ts) | TypeScript | 21 | 0 | 6 | 27 |
| [backend/src/middleware/authorize.ts](/backend/src/middleware/authorize.ts) | TypeScript | 12 | 1 | 4 | 17 |
| [backend/src/middleware/error-handler.ts](/backend/src/middleware/error-handler.ts) | TypeScript | 25 | 1 | 6 | 32 |
| [backend/src/modules/auth/auth.routes.ts](/backend/src/modules/auth/auth.routes.ts) | TypeScript | 42 | 0 | 9 | 51 |
| [backend/src/modules/auth/auth.service.ts](/backend/src/modules/auth/auth.service.ts) | TypeScript | 55 | 2 | 12 | 69 |
| [backend/src/modules/roles/roles.routes.ts](/backend/src/modules/roles/roles.routes.ts) | TypeScript | 18 | 0 | 4 | 22 |
| [backend/src/modules/users/users.routes.ts](/backend/src/modules/users/users.routes.ts) | TypeScript | 28 | 0 | 8 | 36 |
| [backend/src/modules/users/users.service.ts](/backend/src/modules/users/users.service.ts) | TypeScript | 58 | 1 | 12 | 71 |
| [backend/src/rbac/permissions.ts](/backend/src/rbac/permissions.ts) | TypeScript | 69 | 1 | 7 | 77 |
| [backend/src/server.ts](/backend/src/server.ts) | TypeScript | 13 | 0 | 4 | 17 |
| [backend/tests/global-setup.ts](/backend/tests/global-setup.ts) | TypeScript | 9 | 0 | 3 | 12 |
| [backend/tests/rbac.test.ts](/backend/tests/rbac.test.ts) | TypeScript | 145 | 0 | 27 | 172 |
| [backend/tests/test-env.ts](/backend/tests/test-env.ts) | TypeScript | 6 | 0 | 1 | 7 |
| [backend/tsconfig.build.json](/backend/tsconfig.build.json) | JSON | 9 | 0 | 1 | 10 |
| [backend/tsconfig.json](/backend/tsconfig.json) | JSON with Comments | 16 | 0 | 1 | 17 |
| [backend/vitest.config.ts](/backend/vitest.config.ts) | TypeScript | 9 | 0 | 2 | 11 |
| [docker-compose.yml](/docker-compose.yml) | YAML | 35 | 0 | 3 | 38 |
| [frontend/.dockerignore](/frontend/.dockerignore) | Ignore | 3 | 0 | 1 | 4 |
| [frontend/Dockerfile](/frontend/Dockerfile) | Docker | 10 | 0 | 2 | 12 |
| [frontend/index.html](/frontend/index.html) | HTML | 12 | 0 | 1 | 13 |
| [frontend/nginx.conf](/frontend/nginx.conf) | Properties | 22 | 2 | 5 | 29 |
| [frontend/package-lock.json](/frontend/package-lock.json) | JSON | 1,783 | 0 | 1 | 1,784 |
| [frontend/package.json](/frontend/package.json) | JSON | 28 | 0 | 1 | 29 |
| [frontend/src/App.vue](/frontend/src/App.vue) | Vue | 3 | 0 | 1 | 4 |
| [frontend/src/api/auth.ts](/frontend/src/api/auth.ts) | TypeScript | 23 | 0 | 5 | 28 |
| [frontend/src/api/http.ts](/frontend/src/api/http.ts) | TypeScript | 52 | 1 | 11 | 64 |
| [frontend/src/api/roles.ts](/frontend/src/api/roles.ts) | TypeScript | 12 | 0 | 3 | 15 |
| [frontend/src/api/users.ts](/frontend/src/api/users.ts) | TypeScript | 27 | 0 | 7 | 34 |
| [frontend/src/env.d.ts](/frontend/src/env.d.ts) | TypeScript | 0 | 1 | 1 | 2 |
| [frontend/src/layouts/AppLayout.vue](/frontend/src/layouts/AppLayout.vue) | Vue | 35 | 0 | 5 | 40 |
| [frontend/src/main.ts](/frontend/src/main.ts) | TypeScript | 15 | 1 | 4 | 20 |
| [frontend/src/rbac/permissions.ts](/frontend/src/rbac/permissions.ts) | TypeScript | 5 | 1 | 1 | 7 |
| [frontend/src/router/index.ts](/frontend/src/router/index.ts) | TypeScript | 70 | 0 | 5 | 75 |
| [frontend/src/stores/auth.ts](/frontend/src/stores/auth.ts) | TypeScript | 34 | 0 | 9 | 43 |
| [frontend/src/styles.css](/frontend/src/styles.css) | PostCSS | 229 | 0 | 40 | 269 |
| [frontend/src/views/DashboardView.vue](/frontend/src/views/DashboardView.vue) | Vue | 16 | 0 | 3 | 19 |
| [frontend/src/views/ForbiddenView.vue](/frontend/src/views/ForbiddenView.vue) | Vue | 5 | 0 | 1 | 6 |
| [frontend/src/views/LoginView.vue](/frontend/src/views/LoginView.vue) | Vue | 45 | 0 | 5 | 50 |
| [frontend/src/views/NotFoundView.vue](/frontend/src/views/NotFoundView.vue) | Vue | 4 | 0 | 1 | 5 |
| [frontend/src/views/RolesView.vue](/frontend/src/views/RolesView.vue) | Vue | 50 | 0 | 6 | 56 |
| [frontend/src/views/UsersView.vue](/frontend/src/views/UsersView.vue) | Vue | 142 | 0 | 13 | 155 |
| [frontend/tsconfig.app.json](/frontend/tsconfig.app.json) | JSON | 8 | 0 | 1 | 9 |
| [frontend/tsconfig.json](/frontend/tsconfig.json) | JSON with Comments | 4 | 0 | 1 | 5 |
| [frontend/tsconfig.node.json](/frontend/tsconfig.node.json) | JSON | 15 | 0 | 1 | 16 |
| [frontend/vite.config.ts](/frontend/vite.config.ts) | TypeScript | 13 | 0 | 2 | 15 |
| [proyecto.md](/proyecto.md) | Markdown | 40 | 0 | 22 | 62 |

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)