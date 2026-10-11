# Phase 5A — compras bajo control de OWNER

## Auditoría y alcance

Base inspeccionada: Phase 4 `22e65aa`, árbol inicialmente limpio. En el remoto, `main` estaba en `51c9824`, mientras Phase 4 conservaba cambios posteriores. Esta rama parte de Phase 4, sin descartar esos cambios, fusionar ni reescribir historial.

Ya existían: autenticación y sesiones revocables, seis roles, CRM y pipeline; estimados/revisiones y snapshots históricos; catálogo y Financial Policy versionados; proyectos, materiales/órdenes de compra, horas y change orders; ledger append-only de costos ACTUAL/COMMITTED y revisión de costos para rentabilidad provisional; evidencia y auditoría; Zoho OAuth, aprobaciones exactas, pausa y presupuesto de OpenAI. Se reutilizan estas bases. Las jornadas no se convierten automáticamente en costos de nómina.

El índice existente `ProjectCostEntry_source_unique` impide repetir una referencia dentro del mismo proyecto/tipo. Una compra dividida necesita referencias únicas por asignación: `purchase:<id>:<índice>`. La compra conserva su recibo original; se bloquea una captura manual posterior con ese recibo. La conciliación con una entrada existente requiere selección humana, proyecto, tipo ACTUAL y monto exactos; nunca se identifica un gasto solamente por importe.

Implementado **solo 5A**. Las integraciones externas y la clasificación IA no están implementadas ni habilitadas. No se modificaron políticas financieras, snapshots, credenciales, Zoho, pausa ni contadores de IA.

## Arquitectura de Phase 5 y orden posterior

- **5A:** evidencia CSV inmutable → revisión manual versionada → consentimiento OWNER de versión exacta → asignaciones y costos transaccionales → informes. Una importación o revisión no reconoce costos.
- **5B, pendiente de autorización:** códigos/alias de proyecto confirmados; reglas exactas antes de coincidencias ambiguas; sugerencias IA con IDs válidos, evidencia, versión del motor y confianza explicable. Reutilizar presupuesto/pausa de IA. Guardar correcciones no equivale a entrenar el modelo. No autoaprobación ni escritura de precios.
- **5C:** adaptador Intuit separado, OAuth oficial, sandbox y operaciones de lectura únicamente en el código. El alcance OAuth contable no debe describirse como una garantía del proveedor de solo lectura: restringir métodos y entidades en el servidor. Verificar documentación, entidades, scopes, renovación y revocación antes de implementar; conciliación conservadora entre fuentes.
- **5D:** adaptadores separados Home Depot y Lowe's. Verificar exportaciones y permisos reales de cada cuenta; no asumir API pública, endpoints privados, formatos iguales ni acceso por scraping. Hoy solo se aceptan archivos previamente normalizados, no exportaciones nativas arbitrarias.
- **5E:** comparaciones por partidas, cantidades/horas verificadas, ajustes append-only para créditos y correcciones, inventario/consumo sin doble reconocimiento; rentabilidad provisional hasta conciliación completa; recomendaciones con evidencia y tamaño de muestra. No alterar catálogo/políticas automáticamente.

La disponibilidad oficial de APIs/exportaciones de proveedores, endpoints/scopes de Intuit y acceso de las cuentas **no se verificaron en 5A**. No hay solicitudes a proveedores ni promesa de conector operativo. Esa investigación y los cambios de OAuth pertenecen al incremento correspondiente, sujeto a revisión.

## Modelos y migración

Nueva migración incremental: `202610110001_purchase_foundation`. Crea únicamente tablas/índices/funciones de integridad de compras; no modifica migraciones anteriores ni reinicia tablas existentes.

| Modelo           | Responsabilidad                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| PurchaseDocument | CSV original, SHA-256, bytes, tamaño, nombre saneado, actor                                               |
| ImportedPurchase | Identidad externa normalizada, evidencia del recibo, contenido original, estado y versión aprobada        |
| PurchaseReview   | Distribución y motivo inmutables por versión/actor                                                        |
| PurchasePosting  | Reconocimiento inmutable por asignación; proyecto/categoría/partida y vínculo opcional al costo existente |

FKs de PostgreSQL protegen usuarios, proyectos, partidas y ledger. Triggers impiden modificar/borrar evidencia, revisiones, postings y compras finalizadas. Asignación a partida exige que pertenezca al estimado original del proyecto, no a otra revisión. Proyectos antiguos sin partida pueden recibir una compra sin vínculo a partida.

Importaciones usan identidad fuente/proveedor/ID externo y hash del archivo. Evidencia proveedor/recibo/fecha/moneda bloquea aprobar duplicados entre fuentes; es un bloqueo conservador que requiere revisión, no una identidad inferida por importe. Mismo ID con contenido diferente se rechaza íntegramente. Objetos JSONB se comparan canónicamente. Reordenar líneas con el mismo ID se considera evidencia cambiada y requiere revisar la importación original.

Lock transaccional de compras serializa aprobación/importación y valida nuevamente OWNER activo. Los proyectos se bloquean en orden estable al reconocer costos. Reintentos y aprobaciones simultáneas de la misma versión no generan postings duplicados. El lote confirma solo las revisiones explícitamente seleccionadas: cada compra es atómica; otra puede quedar bloqueada y el resultado informa aprobadas/bloqueadas.

## Pantallas y flujo

- `/owner/purchases`: bandeja (últimas 200), importación y estado deshabilitado de conectores.
- `/owner/purchases/[id]`: evidencia/posibles duplicados; distribución por línea entre proyectos/gastos generales; categoría/tipo/partida; historial y aprobación o rechazo con motivo.
- `/owner/purchases/batch`: hasta 20 revisiones guardadas, versiones visibles, selección humana y resultados individuales.
- `/owner/purchases/reports`: últimos 1.000 postings aprobados por proyecto/proveedor/categoría/mes/partida; enlaza rentabilidad existente, sin afirmar resultados definitivos.
- `/api/owner/purchases/documents/[id]`: descarga original solo OWNER, `no-store`, `nosniff`, texto no confiable `.csv.txt`, para evitar apertura automática de fórmulas como hoja de cálculo.

Guardar clasificación requiere destino y distribución exacta por línea, incluido impuesto/descuento. Es independiente de aprobar: seleccionar el consentimiento y aprobar la versión guardada. Cambio concurrente invalida esa versión. Gastos generales no generan costo de proyecto ni cambian overhead de políticas. Un nuevo costo pone la conciliación del proyecto otra vez como pendiente.

OWNER es validado en páginas, servicios, acciones y descarga. Otros roles reciben denegación antes de consultar/renderizar contenido financiero; las pruebas cubren HTML, RSC, API y acciones falsificadas. Los eventos de proyecto conservan la proyección existente sin metadatos financieros para trabajadores.

## Formato CSV

Usar `docs/examples/purchases-5a.csv` como **ejemplo sintético**, no como gasto real. UTF-8, encabezados exactos:

```text
source,external_id,vendor,date,receipt_id,po_number,job_name,store,currency,line_id,sku,description,quantity,unit_price,tax,discount,line_total,transaction_total
```

`source`: MANUAL_CSV, HOME_DEPOT_CSV, LOWES_CSV o QUICKBOOKS_CSV. Estas etiquetas indican procedencia de archivo normalizado, no conexión real. ID externo/recibo/proveedor/fecha/line_id son obligatorios; PO/job/store/SKU pueden quedar vacíos. Fecha ISO `YYYY-MM-DD`, moneda USD, cantidades positivas hasta cuatro decimales, montos no negativos con hasta dos decimales. No usar `$` ni separadores de miles.

Cada línea debe cumplir `redondear(quantity × unit_price, 2) + tax − discount = line_total`; suma de líneas = `transaction_total`. Impuesto y descuento son montos de la línea, no porcentajes ni totales de factura repetidos. Distribuirlos explícitamente al preparar el archivo. En una factura multilínea repetir la misma información de cabecera y total, con line_id único. CSV admite comillas y campos escapados; archivos mal formados se rechazan sin escrituras parciales.

## Límites y riesgos pendientes

- Máximo 1 MiB por documento, 500 líneas y 100 MiB totales. PostgreSQL almacena evidencia persistente incluida en respaldos. El límite de cuerpo Server Action puede rechazar archivos cercanos al máximo por overhead multipart: usar archivos menores/dividir facturas completas. No hay almacenamiento externo configurado.
- Se reconocen solo compras positivas que OWNER identifica como gasto real. Retornos/créditos, PDF/imágenes/OCR, inventario/consumo, depreciación, ajustes de una aprobación final y aprendizaje están pendientes. Mantener compras dudosas sin aprobar. No sustituir un movimiento negativo por positivo para sortear validación.
- No existe todavía adaptador de almacenamiento de compras intercambiable; introducirlo con object storage antes de superar cuota. No se debe purgar evidencia aprobada para recuperar espacio.
- Si un costo previo usa otra referencia o contiene varias compras agrupadas, no se puede garantizar detección semántica; OWNER debe conciliar antes de aprobar. Las referencias de conciliación exigen igualdad exacta de la asignación, no conciliación parcial de una entrada agrupada.
- Una compra aprobada es definitiva en 5A; correcciones posteriores requieren un futuro ajuste auditado, nunca borrar el costo. Verificar bien la versión antes de aprobar.
- Informes acotados, sin paginación completa aún; no equivalen a libro contable completo ni declaración tributaria. Categorías y partidas financieras son distintas del tipo operativo MATERIAL/LABOR/SUBCONTRACTOR/OTHER.
- No hay conectores, sandbox externo, PDF de proveedores, IA de compras ni validación de compatibilidad con exportaciones nativas. No se consumió API real.

## Verificación realizada

Lint, TypeScript y build: PASS. Unitarias: 79 PASS. Integración PostgreSQL: 62 PASS (57 de Fases 1–4 y 5 de compras). Pruebas nuevas incluyen importación inválida/reintentos/contenido cambiado, versiones stale, consentimiento, aprobación concurrente, duplicados entre fuentes, snapshots originales, reparto entre proyectos y varias asignaciones en un proyecto, gastos generales, conciliación y roles inactivos/no autorizados. No se ejecutaron migraciones contra la base de aplicación existente.

HTTP de producción local: login/smoke, Estimator, OWNER, AI, operaciones, equipo y compras PASS; respuestas HTML/RSC/API restringidas y acciones falsas cubiertas. Navegación existente en Chromium: OWNER/PROJECT_MANAGER/CREW a 375/390/430/1280 px PASS. Formulario de compras OWNER a 375/390/430/1280 px: PASS (añadir/quitar reparto, destino general, guardar revisión sin contabilizar, sin desbordamiento horizontal). Las comprobaciones automatizadas de navegador no equivalen a una revisión visual humana en iPhone/Safari.

Comandos de compras:

```sh
npm run lint
npm run typecheck
npm test
npm run test:purchases:local
npm run build
```

El comando `test:purchases:local` crea y elimina **solo una base temporal de pruebas**, migra allí y mantiene el gate de correo deshabilitado. HTTP/browser necesitan también una base `_test` y servidor aislado, nunca la base normal. Playwright/Chromium son herramientas opcionales de validación; no se añadieron como dependencia de la aplicación.

## Actualizar el Mac preservando datos y .env

1. Detener Next.js y worker con `Control+C` en sus terminales. Mantener Docker Desktop abierto. No borrar volúmenes ni ejecutar reset. Revisar que Emergency Pause siga activada; esta entrega no modifica ese estado.
2. En Terminal, respaldar PostgreSQL (contiene evidencia y tokens cifrados; proteger el respaldo):

```sh
cd ~/Projects/flipas-os-
umask 077
mkdir -p ~/FLIPAS-backups
BACKUP_FILE="$HOME/FLIPAS-backups/before-phase-5a-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U flipas -d flipas -Fc > "$BACKUP_FILE"
test -s "$BACKUP_FILE" && echo "Respaldo creado"
```

Respaldar `.env` por separado en almacenamiento privado seguro: la clave de cifrado existente es necesaria para descifrar los tokens. Nunca compartir respaldos ni subirlos al repositorio. Si pg_dump falla, detenerse antes de migrar. Estos comandos corresponden a los nombres de DB/usuario del Docker Compose actual.

3. Revisar cambios locales. Si `git status --short` muestra archivos, detenerse y preservarlos; no usar reset/clean ni sobrescribirlos.

```sh
git status --short
git fetch origin feature/phase-5-financial-intelligence
git switch --track origin/feature/phase-5-financial-intelligence
```

Si la rama ya existe en el Mac: `git switch feature/phase-5-financial-intelligence` y `git pull --ff-only origin feature/phase-5-financial-intelligence`. Un error de divergencia requiere revisión, no force push.

4. Instalar/generar y aplicar únicamente migraciones pendientes, después del respaldo:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

La nueva migración esperada es `202610110001_purchase_foundation`; otras migraciones pendientes anteriores también se aplicarán por orden. No ejecutar `env:local`, no reemplazar `.env`, no activar envío. No se requieren variables nuevas ni claves de proveedores. Reiniciar `npm run worker:ai` en otra terminal solo si ya se usaba: su configuración permanece existente.

5. Abrir http://localhost:3000/owner/purchases con OWNER. Preparar un CSV sintético o normalizar una compra **todavía no contabilizada**. Importar: verificar que no cambia costos. Guardar una clasificación: tampoco cambia costos. Revisar partida/proyecto/importe, consentimiento y aprobar. Verificar ledger/reporte; repetir aprobación no debe duplicarlo. Para una compra contabilizada previamente, seleccionar la referencia ACTUAL verificada en conciliación avanzada en lugar de crear un costo.

### Recuperación sin borrar la base actual

Si fuera necesario, detener app/worker y restaurar primero en una base nueva; no sobrescribir datos existentes:

```sh
# Elegir un nombre nuevo y la ruta real de su respaldo:
RESTORE_DB="flipas_recovery_$(date +%Y%m%d%H%M%S)"
docker compose exec -T db createdb -U flipas "$RESTORE_DB"
docker compose exec -T db pg_restore -U flipas -d "$RESTORE_DB" --exit-on-error < "$BACKUP_FILE"
```

En una terminal nueva, definir `BACKUP_FILE` con la ruta del archivo guardado antes de restaurar. Verificar esa base restaurada y la versión compatible de código con asistencia antes de cambiar la URL privada; conservar intacta la base original. Un downgrade de código no deshace costos ya aprobados. No ejecutar down migrations destructivas.

Próximo paso: revisión humana de 5A y autorización explícita antes de 5B.
