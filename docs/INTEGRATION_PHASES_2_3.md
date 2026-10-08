# Integración de Fases 2 y 3 — 8 de octubre de 2026

## Estado y ascendencia verificados

- Repositorio: FLIPASDEVELOPMENT/flipas-os-.
- `main` local/remoto: `6342ef247f60bb4dafc599d67ebb27dbd3f03363` (Fase 1).
- Fase 2 local/remota: `65c999eedafa67d9469f52fa5f96af0845b5db8e`.
- Fase 3 local/remota: `72123a2d630dc343475cfe6a73269806addb796c`.
- Fase 2 es ancestro de Fase 3; main es ancestro de ambas. No son ramas independientes.
- Árbol inicialmente limpio. Rama `integration/phases-2-3` creada desde `origin/main`, seguida de fast-forward a Fase 3: 14 commits preservados, sin conflictos, cherry-picks ni cambios en main. No se descartaron cambios del usuario.
- La rama añade esta revisión, correcciones de empaquetado y configuración y una prueba de artefactos. Merge final pendiente de autorización explícita.

## Correcciones de integración

1. Next.js copiaba `.env` al artefacto standalone al construir localmente. `copy-static.mjs` elimina únicamente las copias `.env*` del directorio generado. No lee, imprime ni altera el `.env` privado original. Una prueba comprueba eliminación, conservación del original y copia de assets.
2. `npm start` usa Node 24 con `--env-file-if-exists=.env`, cargando configuración privada del directorio del proyecto en tiempo de ejecución; el artefacto ya no la incluye. Docker recibe variables externas y no depende de un archivo incorporado.
3. `.env.example` documenta `ZOHO_SEND_ENABLED=false`; Compose lo transmite a app y worker con fallback false. No se modificó el entorno privado ni se activó el gate. Configuración comprobada con valores ausente/false/true en procesos aislados, sin iniciar servicios con gate activo.
4. La introducción de OPENAI_SETUP documenta el envío controlado actual, en lugar de afirmar que solo existe recepción.

## Validación PASS/FAIL

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Historial/ramas/árbol limpio/conflictos | PASS | Ascendencia verificada con git y referencias remotas; integración fast-forward. |
| Lint y TypeScript | PASS | `npm run lint`, `npm run typecheck`. |
| Pruebas unitarias | PASS | 62, incluida la nueva prueba de artefactos sin configuración privada. |
| Integración CRM/Estimator/OWNER/AI/Zoho/OpenAI | PASS | 41: CRM 1, Estimator 1, OWNER 1, AI 18, Zoho read 1, commercial 7, OpenAI budget 1, Zoho delivery 11. Bases PostgreSQL desechables y proveedores simulados. |
| Autenticación/roles/pipeline/catálogo/cálculos/revisiones/aprobaciones/PDF/proyectos | PASS | Suites CRM, Estimator, OWNER y HTTP; propuestas/PDF privados y revocación de sesiones incluidos. |
| AI Inbox/CRM linking/follow-ups/auditoría | PASS | Suites AI/commercial/HTTP; identidad, permisos y datos confirmados preservados. |
| Seguridad de envío | PASS | Versión exacta, aprobación y Send separados, pausa en solicitud/dispatch, duplicados, resultado incierto sin reenvío automático, SELF_TEST y bucles. |
| Build Next.js | PASS | `npm run build`; artefacto sin `.env*`. |
| Actualización desde Fase 1 con datos | PASS | Base desechable con las dos migraciones iniciales y OWNER/cliente/lead/oportunidad/valor ficticios. Migraciones restantes conservan esos datos y relaciones. Segunda ejecución no agrega migraciones. |
| Docker Compose | PASS | Configuración válida; gate false por defecto y consistente entre app/worker. PostgreSQL existente healthy. |
| Runtime Docker y worker | PASS | Imagen local del artefacto actual validado; AI HTTP con siete roles y CSRF dentro del contenedor; worker actual ejecuta `--once` con código/dependencias montados read-only y base desechable. |
| Construcción Docker limpia del Dockerfile | BLOCKED | Descarga `npm ci` del registro se atasca en este entorno, incluso usando proxy/certificado. No se presenta el runtime de artefacto como una construcción limpia. Repetir con acceso normal al registro antes de publicar. |
| Auditoría npm de dependencias de producción | PASS | `npm audit --omit=dev`: 0 vulnerabilidades reportadas. |
| Auditoría npm completa | FAIL / pendiente | 6 altas: @next/eslint-plugin-next, eslint-config-next, @prisma/client-generator-ts, braces, fast-glob y micromatch; sin fixAvailable. No se aplicó `audit fix --force`. Revisión/actualización de herramientas pendiente antes de producción. |

Las pruebas no enviaron correos ni consultaron proveedores reales. No modificaron la base existente, credenciales, tokens, DNS, presupuesto o contadores. Solo se crearon/eliminaron bases de prueba propias. El warning de pg sobre queries concurrentes permanece como aviso de compatibilidad futura con pg 9; las suites pasan con la versión actual.

## Esquema y migraciones

Las dos migraciones de Fase 1 permanecen idénticas. Total: nueve migraciones históricas; no se añade una migración de integración.

Faltantes en main: `202610070003_estimator`, `202610070004_owner_console`, `202610080001_ai_sales`, `202610080002_zoho_readonly`, `202610080003_openai_budget`, `202610080004_commercial_safety`, `202610080005_zoho_delivery`.

No hay DROP TABLE, DROP COLUMN ni TRUNCATE. La migración histórica OpenAI limpia el campo legado `aiKeyCipher`: OpenAI ya usa exclusivamente variables privadas del servidor. No cambia la clave privada actual ni los tokens Zoho. La migración de delivery pone `outboundPaused=true`. En un Mac actualizado a Fase 3 las nueve migraciones ya están aplicadas; una repetición no vuelve a ejecutar sus updates. Por ello, verificar manualmente Emergency Pause antes de actualizar, sin asumir que una migración ya aplicada volverá a pausar.

Conservar `.env`, MAIL_ENCRYPTION_KEY y su respaldo, claves privadas OpenAI y registros OAuth cifrados. No ejecutar env:local/env:mail/env:openai, seeds ni resets para esta actualización. Node 24, PostgreSQL 17 y Docker existentes siguen siendo válidos. App y worker deben reiniciarse juntos después del cambio de código/configuración. El worker puede ejecutar análisis pendientes si la IA está activa; para una revisión sin llamadas reales mantener pausada la IA antes de arrancarlo.

## Actualización segura del Mac

1. En OWNER → AI Administration, guardar Emergency Pause activa. Si solo se revisará código sin llamadas reales, mantener pausada también la IA. Mantener `ZOHO_SEND_ENABLED=false` en la configuración privada. No cambiar claves ni reconectar OAuth.
2. Detener app y worker con Control+C. Mantener Docker/PostgreSQL funcionando.
3. Revisar el estado; si aparecen cambios locales, detenerse y conservarlos antes de cambiar ramas:

```bash
cd ~/Projects/flipas-os-
git status --short
```

4. Crear respaldos privados fuera del repositorio (no compartir ni subir a GitHub):

```bash
umask 077
flipas_backup_dir="$HOME/FLIPAS-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$flipas_backup_dir"
cp .env "$flipas_backup_dir/.env"
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T db pg_dump -U flipas -d flipas -Fc > "$flipas_backup_dir/flipas.dump"
test -s "$flipas_backup_dir/flipas.dump"
```

Comprobar que pg_dump y test terminan sin error; no continuar si fallan. El respaldo .env incluye la clave necesaria para descifrar OAuth y debe permanecer privado.

5. Para revisar ahora la integración (main aún no fusionada):

```bash
git fetch origin
git switch --track origin/integration/phases-2-3
npm ci
npm run db:generate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
npm run db:migrate
npm run dev
```

Si la rama de integración ya existe localmente, usar `git switch integration/phases-2-3` y `git pull --ff-only origin integration/phases-2-3` en lugar de crearla de nuevo. No ejecutar las suites de integración contra la base local con clientes: requieren bases desechables.

6. Abrir http://localhost:3000, comprobar login, OWNER y pause; revisar CRM/pipeline, estimado/PDF y AI Inbox. En otra terminal, solo cuando se quiera procesar trabajo pendiente:

```bash
cd ~/Projects/flipas-os-
npm run worker:ai
```

7. Después de la aprobación y merge explícitos, sustituir el cambio de rama del paso 5 por `git switch main` y `git pull --ff-only origin main`, y repetir instalación/generación/migración/reinicio. Nunca usar reset, force push o `docker compose down -v`. Cambiar de rama no revierte la base: para código anterior usar una copia de la base, no restaurar sobre datos existentes sin un plan separado.

## Decisión

Lista para revisión de integración funcional y para planificar Fase 4. No hay autorización de merge final. Antes de producción: resolver/aceptar explícitamente la auditoría de herramientas, repetir Docker clean build y revisar configuración/infraestructura. Ninguna validación habilita envíos automáticos.
