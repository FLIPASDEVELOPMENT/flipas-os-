# Home Depot Pro Xtra — CSV directo en Phase 5A

## Causa del rechazo anterior

El importador admitía exclusivamente 18 encabezados normalizados en la primera fila. El archivo proporcionado por OWNER es un export `Purchase Tracking` de Pro Xtra con metadatos iniciales y 17 encabezados en la séptima fila. Es un historial de transacciones, no un detalle de productos. El archivo privado **no se incluye en Git**.

El adaptador `HOME_DEPOT_PRO_XTRA_V1` está basado en ese formato observado. El ejemplo `docs/examples/home-depot-pro-xtra-synthetic.csv` reproduce estructura, campos vacíos, órdenes online repetidas y devoluciones usando exclusivamente datos ficticios. No se hizo scraping ni se conectó una API de Home Depot.

## Flujo para OWNER

1. En `/owner/purchases`, seleccionar el CSV original y pulsar **Preview CSV import**.
2. Revisar `/owner/purchases/imports/[id]`: filas válidas, movimientos no soportados retenidos, filas rechazadas, repeticiones exactas, posibles registros existentes y advertencias. Los bytes originales se conservan como documento privado; aún no se crean compras ni costos.
3. Confirmar moneda USD y advertencias; pulsar **Confirm import — no costs recorded**. Se crean compras pendientes únicamente. Las filas rechazadas no se convierten en compras; siguen visibles en la vista previa y documento original.
4. Abrir una compra, verificar recibo y fecha de compra, clasificar manualmente proyecto/categoría/partida, guardar revisión y aprobar la versión exacta en un paso independiente. Conciliar primero costos ya registrados: la importación nunca los reemplaza.

Con el archivo privado se realizó **solo parseo en memoria**: 155 movimientos; 136 disponibles para clasificación; 19 retenidos por devoluciones, signos o identidad ambigua; 0 filas rechazadas. No se importó ese archivo a la base de aplicación ni se generaron costos reales.

## Mapeo y límites

- Encabezados localizados después de metadatos, no por un número fijo de fila. Sigue admitiéndose el CSV normalizado previo.
- `Transaction ID` conserva su valor original. No es globalmente único: el ejemplo real incluye una reutilización. Identidad conservadora combina fecha reportada, tienda, register, transaction, order e invoice. El ID interno `HD-…` es derivado, **no un número de recibo del proveedor**.
- `Project Name` y `Job Name` se conservan separados y no se asignan automáticamente a proyectos. `Order Number`/`Invoice Number` se preservan; no se usa el número de orden para colapsar movimientos.
- `Date` se utiliza cuando contiene una fecha ISO válida. Si está vacío, se conserva `Receipt Added Date` como fecha reportada, claramente etiquetada. No se afirma que sea la fecha de compra: OWNER debe verificarla antes de aprobar. Los informes por mes usan esa fecha reportada; no representan necesariamente el mes contable de la compra.
- `Order Origin` preserva tienda/online. Purchaser, Payment, Card/Account Nickname y teléfono de metadatos no se copian a datos normalizados; permanecen en el original privado descargable solo por OWNER.
- `Pre-tax Amount` y `Total Amount Paid` se interpretan con aritmética decimal, signos, `$`, comas de miles y paréntesis. La diferencia pagado−pre-tax se muestra como impuesto/diferencia **derivado**, no como impuesto o tasa fiscal verificados.
- `Program Disc Amt`/`Other Disc` se conservan separados. No se descuentan otra vez del pre-tax. Signos inesperados o total positivo menor al pre-tax quedan bloqueados para reconocimiento. El archivo no contiene precios antes de descuentos para una validación fiscal independiente.
- No hay cantidades, SKU, precios unitarios ni descripciones de artículos en este formato. La única línea es un **resumen contable**; su unidad técnica 1 no se presenta como cantidad de producto. Una variante itemizada con columnas de artículos queda pendiente bloqueada; requiere otro adaptador verificado. Una descripción suministrada se conserva, sin inventarla.
- Devoluciones, créditos y ceros conservan montos con signo y permanecen `NEEDS_REVIEW`. Tanto guardar clasificación como aprobar se bloquean en el servidor. No se convierten en costos positivos ni se compensan automáticamente. Pueden dejarse pendientes o rechazarse con motivo; su reconocimiento exige un futuro módulo de ajustes auditados.
- Identidad transaccional igual con evidencia distinta: movimientos separados y bloqueados. Filas exactamente repetidas: omisión con advertencia. Mismo número de orden con movimientos diferentes **no** implica duplicación. Reexportar datos sin cambios es idempotente; la misma identidad ya aprobada no puede contabilizarse dos veces.
- La aprobación puede enlazar un costo ACTUAL previo verificado. Una referencia manual antigua distinta del ID interno no puede reconciliarse automáticamente; OWNER debe comprobarla explícitamente. No se garantiza detectar duplicados semánticos entre sistemas sin evidencia compartida.
- Límite existente de 1 MiB/500 filas, cuota global de 100 MiB. Originales/vistas previas pendientes consumen cuota y no se borran. La vista previa se recalcula desde bytes inmutables del servidor; ningún monto normalizado del navegador se acepta como fuente.

## Seguridad y datos existentes

Sin cambios de esquema o migraciones. Reutiliza PurchaseDocument y los modelos de 5A; metadata adicional queda dentro del JSON original. Se conserva el ledger append-only, snapshots, aprobación por versión, conciliación, auditoría y RBAC. Acciones/servicios verifican OWNER activo y las acciones verifican Origin; las demás cuentas no reciben datos financieros por HTML/RSC/API. No se alteraron `.env`, Financial Policy, Zoho, Emergency Pause ni límites de IA. No hay escritura a QuickBooks, correos, merge o despliegue.

## Pruebas

- 82 unitarias: PASS, incluidos tres casos nuevos del adaptador.
- 6 pruebas de integración de compras: PASS; preview sin compras/costos, confirmación explícita, reintentos, todos los roles, bloqueo de devoluciones y aprobación concurrente sin duplicación.
- Lint, TypeScript y build: PASS.
- HTTP de producción local: smoke/Estimator/OWNER/AI/operaciones/equipo/compras, incluyendo nueva ruta de preview y confirmaciones falsificadas: PASS.
- Chromium: CSV sintético → preview → confirmación explícita, 5 movimientos pendientes y cero costos nuevos: PASS. Controles de compras a 375/390/430/1280 px: PASS. No equivale a una revisión visual humana en Safari/iPhone.

## Actualizar tu Mac

Detener Next.js y worker con Control+C; mantener Docker Desktop abierto. No borrar volúmenes ni cambiar `.env`. Si existen cambios locales, preservarlos antes de continuar:

```sh
cd ~/Projects/flipas-os-
git status --short
```

Si está limpio:

```sh
git switch feature/phase-5-financial-intelligence
git pull --ff-only origin feature/phase-5-financial-intelligence
npm ci
npm run db:generate
npm run dev
```

No hay migración nueva. Si tu instalación aún no tiene la migración base de 5A, respaldar primero siguiendo `docs/PHASE_5A.md` y ejecutar `npm run db:migrate` antes de iniciar. No se requiere nueva variable o clave. Reiniciar el worker en otra terminal solo si ya se usaba.

Abrir http://localhost:3000/owner/purchases con OWNER, subir el archivo original y revisar la vista previa. Confirmar importa registros pendientes: no aprueba ni contabiliza compras. No avanzar a IA/conectores externos por esta actualización.
