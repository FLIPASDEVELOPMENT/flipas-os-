# OpenAI para FLIPAS OS — prueba local de Fase 3

La rama es `feature/phase-3-ai-sales`. Se conserva Zoho Mail en modo lectura, el CRM, el Estimator y las aprobaciones. **No hay envío real de correo.** MOCK sigue disponible y es el valor inicial. La integración usa el SDK oficial `openai@7.30.1`, API Responses, endpoint fijo `https://api.openai.com/v1/responses`, sin herramientas, sin almacenamiento de respuestas (`store: false`) y sin reintentos del SDK.

## Configuración en tu Mac, un paso cada vez

1. En las terminales de FLIPAS OS, detén la aplicación y el worker con **Control-C**. Mantén Docker Desktop abierto.
2. Actualiza la rama en una terminal:
   ```sh
   cd ~/Projects/flipas-os-
   git switch feature/phase-3-ai-sales
   git pull --ff-only origin feature/phase-3-ai-sales
   ```
3. Instala y actualiza la base de datos sin borrar tus datos:
   ```sh
   npm ci
   npm run db:generate
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
   npm run db:migrate
   ```
   Debe aplicar `202610080003_openai_budget`. No ejecutes resets, no borres volúmenes y no regeneres `.env`.
4. Abre [el modelo oficial](https://developers.openai.com/api/docs/models/gpt-4.1-mini) y [las tarifas oficiales](https://developers.openai.com/api/docs/pricing). El 8 de octubre de 2026 se verificó **gpt-4.1-mini**, Responses y Structured Outputs, con tarifas publicadas de **$0.40 de entrada y $1.60 de salida por millón de tokens**. Usa precios estándar de texto, no Batch, cached input, Flex ni herramientas. Puedes elegir otro modelo que admita Responses y JSON Schema; revisa su ID exacto y sus precios antes de configurarlo. La disponibilidad para tu proyecto no se puede confirmar sin una cuenta autorizada. En [OpenAI Platform](https://platform.openai.com/), verifica el proyecto, la facturación API y el acceso al modelo. ChatGPT Plus no incluye crédito API.
5. Crea una clave de API de un proyecto dedicado en OpenAI Platform. Configura los permisos mínimos de generación de respuestas disponibles en tu proyecto. Guarda la clave en tu gestor de contraseñas; **no la pegues en el chat ni envíes capturas con ella**.
6. En tu Terminal ejecuta:
   ```sh
   npm run env:openai
   ```
   El asistente pide el ID del modelo y las dos tarifas verificadas. Finalmente pide la clave con entrada oculta: pégala **solo en esa Terminal**. La guarda en tu `.env` ignorado por Git con permisos `600`, conserva PostgreSQL y la clave de Zoho, y no hace ninguna solicitud API. Para el modelo verificado, las respuestas serían `gpt-4.1-mini`, `0.40` y `1.60`. No son valores predeterminados del programa; vuelve a comprobarlos.
7. Reinicia la aplicación:
   ```sh
   npm run dev
   ```
   En otra Terminal:
   ```sh
   cd ~/Projects/flipas-os-
   npm run worker:ai
   ```
8. Abre [OWNER AI Administration](http://localhost:3000/owner/ai) y entra con tu cuenta OWNER existente. Comprueba que el servidor muestra el modelo y las tarifas configuradas, **nunca la clave**. Mantén presupuesto mensual **10 USD**, alerta **5 USD**, envío pausado y permiso de envío real deshabilitado. Antes de seleccionar OpenAI revisa las tareas `ANALYZE` pendientes: el worker también procesa nuevas consultas y reintenta tareas pendientes. Para una primera prueba aislada, detén el worker con Control-C y no sincronices todo el buzón.
9. Selecciona **OpenAI**, activa el procesamiento y desmarca **Pause AI requests**. Guarda. Esta acción autoriza transmitir a OpenAI el texto reducido de las consultas.
10. Abre en Inbox el correo sintético de la prueba de cocina que ya importaste. Pulsa **Analyze this conversation again** una sola vez. Este botón funciona sin el worker. Comprueba: tipo de correo, servicio, idioma, presupuesto explícito, datos ausentes, confianza y citas. Una clasificación incierta requiere revisión humana. No crees oportunidades para publicidad o spam.
11. En `/owner/ai`, comprueba tokens de entrada/salida, operación `ANALYZE`, modelo, fecha y costo estimado. Si aparece un error, no repitas muchas veces: revisa configuración y reservas. Nunca compartas `.env` o mensajes de error de OpenAI que incluyan credenciales.
12. Tras confirmar la clasificación comercial, puedes generar un borrador en **Customer language (automatic)**, inglés o español. Revísalo y aprueba su versión exacta. **Aprobar no envía correo.** Hay cuatro solicitudes máximas de OpenAI por último correo, contando análisis, borradores y errores. Reinicia el worker solo cuando estés listo para analizar las consultas pendientes; puedes pausar IA en OWNER Console en cualquier momento.

## Variables privadas exactas

| Variable | Uso |
| --- | --- |
| `OPENAI_API_KEY` | Clave privada del servidor; nunca `NEXT_PUBLIC_`, navegador, base de datos ni logs. |
| `OPENAI_MODEL` | ID verificado del modelo compatible. No existe modelo predeterminado. |
| `OPENAI_INPUT_USD_PER_MILLION` | Precio estándar de entrada, USD por millón. Obligatorio y positivo. |
| `OPENAI_OUTPUT_USD_PER_MILLION` | Precio estándar de salida, USD por millón. Obligatorio y positivo. |
| `OPENAI_PRICING_VERIFIED_AT` | Fecha UTC `YYYY-MM-DD` de la comprobación de tarifas. |

App y worker deben recibir las mismas variables. Ambos las leen en el servidor; reinícialos después de cambiar `.env`. Compose transmite las variables privadas a ambos servicios sin agregarlas a la imagen. La migración elimina la antigua clave OpenAI cifrada de la base de datos; esa clave debe configurarse de nuevo exclusivamente en el entorno privado. Tokens de Zoho y su clave de cifrado se conservan.

## Presupuesto y trazabilidad

- Mes calendario UTC. Defaults: límite 10 USD, alerta 5 USD. El OWNER puede editar los límites y pausar/reactivar solicitudes; cada cambio registra valores anteriores/nuevos en auditoría. SALES no puede acceder a esta configuración ni sus reportes.
- Antes de cada llamada se reserva un costo conservador de hasta 60,000 tokens de entrada y 1,500 de salida a las tarifas configuradas. Se envían hasta tres mensajes recientes, hasta 3,000 caracteres de cuerpo por mensaje, asunto hasta 500 y máximo 45,000 bytes de consulta. El esquema e instrucciones caben dentro de la reserva de entrada. Se rechaza la petición si no cabe la reserva; puede bloquearse antes de llegar exactamente a 10 USD.
- Un bloqueo PostgreSQL serializa reservas entre aplicación y workers; no se usa un contador en memoria. Límite de cuatro llamadas durante la vida del último mensaje, incluyendo fallas y borradores. No hay reintentos internos del SDK. Fallos terminales de presupuesto/límites/salida inválida no se reintentan por el worker.
- El ledger conserva modelo, tarifas aplicadas, fecha, operación, tokens observados, costo estimado y estado. También conserva consumo de respuestas inválidas/incompletas cuando OpenAI devuelve tokens. No se descuentan precios cacheados: la estimación usa la tarifa completa de entrada.
- Una llamada con resultado desconocido o un proceso interrumpido conserva su reserva. No se libera automáticamente por tiempo: un timeout no demuestra que el proveedor no facturó. El mes siguiente inicia un límite nuevo; verifica externamente las solicitudes inciertas. Los registros históricos de costo desconocido bloquean conservadoramente nuevas llamadas del mes.
- La alerta es interna: tarjeta y auditoría, no correo automático. El consumo observado y reservas aparecen separados.
- **Este control interno no garantiza un límite exacto de facturación de OpenAI.** Depende de tarifas correctas, conteos del proveedor y que otras aplicaciones no usen la misma clave/proyecto. Usa un proyecto separado y revisa también sus controles, alertas y Usage Dashboard; no supongas que un presupuesto del proveedor sea un bloqueo duro.

## Privacidad, revisión y límites

Los correos son datos no confiables. Se eliminan HTML, credenciales reconocibles y el encabezado de remitente del contenido enviado; solo se transmite contexto breve. El remitente se resuelve localmente. El nombre, teléfono, ubicación, presupuesto y fecha requieren citas exactas; los valores ausentes permanecen null. El tipo comercial es independiente del servicio: cliente potencial, existente, proveedor, publicidad, spam u otro. El modelo no recibe el CRM, políticas financieras, claves, herramientas, enlaces abiertos ni adjuntos. Puede recomendar; no modifica precios, descuentos, contratos, presupuestos ni oportunidades.

Prompt injection no se resuelve únicamente con instrucciones: se validan formato/citas, se bloquean salidas peligrosas de borrador y se conserva revisión y aprobación humana de cada versión. No se garantiza que una clasificación de IA sea correcta. Revisa los resultados, especialmente publicidad que mencione servicios de remodelación. Tampoco `store: false` elimina por sí solo todas las políticas de retención del proveedor; revisa sus controles de datos antes de enviar información real.

La clasificación y los borradores se probaron con respuestas HTTP simuladas; no se usó una clave real ni se incurrió en gasto API durante desarrollo. La primera prueba autenticada queda a cargo del OWNER.

## Validación

`npm run test`, `npm run test:openai` (base desechable terminada en `_test`), suites de integración CRM/Estimator/OWNER/AI/Zoho, lint, TypeScript y build. Las pruebas de OpenAI simulan respuestas del SDK y verifican concurrencia, límites, pausa, gastos de salida inválida, reservas inciertas, bloqueo de publicidad/revisión y autoridad del OWNER. Nunca ejecutes pruebas de integración contra tu base de datos de trabajo.
