# Modelo de amenazas y controles reproducibles

## Alcance y criterio de prioridad

El alcance es el cliente Expo, el backend controlado de CampusOps, el flujo de
sincronización offline-first y el workflow de CI. La prioridad combina impacto
y probabilidad: **Alta** requiere bloquear la entrega ante un fallo; **Media**
requiere evidencia en cada cambio; **Baja** se revisa como parte de la
verificación de CI.

## Activos

| Activo | Descripción |
| --- | --- |
| Sesiones | Token sintético `Bearer course-valid-token` y `actorId` de prueba; identifican al actor en cada solicitud. |
| Incidencias | Datos, estado, historial y payload de cada reporte gestionado por CampusOps. |
| Fotografías | Evidencia visual adjunta a una incidencia; metadatos y referencia de archivo sintético. |
| Ubicaciones | Coordenadas o etiqueta manual asociadas a una incidencia. |
| Asignaciones | Relación entre una incidencia y el técnico responsable, junto con su prioridad. |
| Credenciales sintéticas | Identificadores de actor (`reporter-1`, `technician-1`, `coordinator-1`) y tokens de prueba usados por el backend didáctico. |

## Fronteras

| Frontera | Descripción |
| --- | --- |
| Aplicación móvil / backend | Límite de red entre el cliente Expo y el backend didáctico (`make run-backend`, `http://127.0.0.1:4310`). |
| Actor / autorización | Límite entre la identidad que envía el cliente y la validación real de rol/propiedad/asignación en el servicio. |
| Cliente offline / cola local | Límite entre operaciones pendientes en la cola local y el estado ya confirmado por el backend. |
| Backend / logs | Límite entre los datos que procesa el backendy lo que realmente se persiste en logs o telemetría. |
| Aplicación / proveedor de ubicación | Límite entre la app y el doble determinista de geocodificación/mapas, sin depender de un proveedor real. |

## Matriz de amenazas

| ID / amenaza | Activo afectado | Control | Prueba o comando reproducible | Resultado esperado | Prioridad y justificación | Riesgo residual |
| --- | --- | --- | --- | --- | --- | --- |
| T-01. Un usuario modifica una incidencia fuera de su rol, propiedad o asignación. | Incidencias, transiciones de estado y trazabilidad. | **Autorización por rol, propietario y asignación** en el servicio; la UI no se considera una barrera de seguridad. | `npm test -- --runInBand course-tests/public/week-02.test.ts` y revisión de `src/campusops/contracts.ts` para las reglas de transición. | Las transiciones no autorizadas son rechazadas y las reglas públicas pasan sin depender de ocultar botones. | **Alta**: afecta integridad y separación de funciones; un bypass permitiría alterar el historial del campus. | Un defecto nuevo en una ruta no cubierta por las pruebas públicas podría permitir una autorización incorrecta; requiere pruebas de servicio adicionales al añadir rutas.
| T-02. Reintentos o reconexiones duplican operaciones y corrompen la cola offline. | Cola local, incidencias y consistencia entre cliente y backend. | **Validación de versiones e idempotencia**: rechazar versiones obsoletas y reutilizar una clave de operación para reintentos. | `npm test -- --runInBand course-tests/public/week-01.test.ts course-tests/public/week-02.test.ts` y `npm run typecheck`. | Los conflictos de versión se detectan de forma explícita, un reintento no crea una segunda transición y el contrato compila. | **Alta**: pérdida o duplicación de transiciones rompe el requisito central offline-first y la trazabilidad. | Un conflicto distribuido no representado en los fixtures podría requerir resolución manual; la persistencia real debe probarse cuando se incorpore.
| T-03. Un secreto llega al repositorio o datos sensibles quedan en logs y artefactos. | Credenciales, tokens, payloads de incidencias y evidencias de CI. | **Secret scan y logs sanitizados**; usar fixtures sintéticos y no imprimir headers, tokens ni payloads sensibles. | `git grep -n -I -E '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})' -- . ':!node_modules'` y `npm audit --omit=dev --audit-level=critical`. | El scan no encuentra patrones de credenciales; la auditoría termina sin vulnerabilidades críticas y los logs no exponen secretos. | **Alta**: una filtración puede comprometer cuentas y artefactos aunque la aplicación funcione correctamente. | Los patrones no detectan secretos con formatos nuevos ni credenciales inyectadas por el entorno; el runner debe permanecer sin secretos de producción.
| T-04. Un workflow de contribución obtiene permisos excesivos o relaja las puertas de calidad. | Repositorio, historial GitHub y resultados de CI. | **Permisos mínimos del workflow**: `contents: read`, instalación reproducible y fallos no ignorados. | `npm test -- --runInBand course-tests/public/week-03.test.ts` y `Select-String -Path .github/workflows/week-03-ci-amenazas-feedback.yml -Pattern 'permissions:|contents: read|continue-on-error|\|\| true'`. | La prueba pasa; el workflow declara solo lectura, ejecuta las verificaciones y no contiene `continue-on-error` ni `|| true`. | **Alta**: un workflow comprometido puede leer o modificar más recursos que el necesario y ocultar fallos de seguridad. | Un action de terceros actualizado podría cambiar su comportamiento; fijar versiones mayores y revisar cambios del workflow antes de fusionar.
| T-05. Fixtures o evidencias contienen datos reales y se publican en CI. | Evidencias académicas, reportes y privacidad de usuarios. | **Fixtures sintéticos sin credenciales reales**; datos deterministas de prueba y revisión de archivos antes de subir artefactos. | `npm test -- --runInBand course-tests/public/week-03.test.ts` y `git grep -n -I -E '(password|token|secret|Authorization: Bearer)' -- course-tests evidence reports ':!node_modules'`. | El modelo y las pruebas pasan; los fixtures y reportes no contienen credenciales ni tokens reales. | **Media**: el impacto de una filtración es alto, pero el alcance se limita a datos de prueba si el control se aplica desde el inicio. | Un secreto codificado o una muestra que parezca inocua puede evadir el grep; complementar con revisión humana antes de publicar artefactos.
| T-06. Un actor consulta incidencias ajenas a su rol o propiedad. | Incidencias, sesiones. | **Autorización por rol y propietario** en `GET /v1/incidents` y `GET /v1/incidents/:id`; el backend filtra por actor, no la UI. | `npm test -- --runInBand course-tests/public/week-05.test.ts` y prueba manual con distintos `X-Course-Actor` contra `/v1/incidents`. | Un reportante solo ve sus propios reportes; un técnico solo sus asignaciones; intentos de acceso cruzado son rechazados o filtrados. | **Alta**: expone información de otros perfiles y rompe confidencialidad entre actores. | Una ruta nueva sin el mismo filtro podría exponer datos; revisar autorización en cada endpoint agregado. |
| T-07. Un actor altera una asignación sin permiso o fuera de su rol. | Asignaciones, incidencias. | **Autorización por rol y asignación** en la acción `assign`; sólo coordinador reasigna, 403 ante rol incompatible. | `npm test -- --runInBand course-tests/public/week-02.test.ts` y prueba manual de `POST /v1/incidents/:id/actions` con `action: assign` desde un actor no autorizado. | La reasignación no autorizada devuelve 403 y no modifica el recurso. | **Alta**: una asignación alterada rompe trazabilidad y responsabilidad del caso. | Una nueva acción de asignación futura debe replicar la misma verificación de rol. |
| T-08. Datos sensibles de incidencias quedan expuestos en logs o telemetría. | Fotografías, ubicaciones, incidencias. | **Logs sanitizados**: `redactForTelemetry` reemplaza campos como `location`, `photos`, `evidence`, `name` y `email` antes de registrar. | `npm test -- --runInBand course-tests/public/week-04.test.ts` y revisión manual de la salida de logs de un caso con foto y ubicación. | Los campos sensibles aparecen como `[REDACTED]`; los campos técnicos (`incidentId`, `status`, `durationMs`) se conservan. | **Media**: afecta privacidad, pero el dato ya es sintético en este proyecto. | Un campo nuevo agregado al payload podría quedar sin sanitizar si no se actualiza la lista de claves. |
| T-09. Credenciales sintéticas de sesión quedan expuestas en el repositorio o en evidencia publicada. | Sesiones, credenciales sintéticas. | **Secret scan y fixtures sin credenciales reales**; usar sólo actores públicos de prueba (`reporter-1`, etc.), nunca tokens de producción. | `git grep -n -I -E 'Bearer\s+[A-Za-z0-9._-]+' -- . ':!node_modules'` y revisión de `evidence/` antes de subir. | El scan sólo encuentra el token público documentado (`course-valid-token`), nunca un token real o de otro entorno. | **Alta**: aunque el token de prueba no es secreto real, confirma el hábito de no commitear credenciales verdaderas cuando el proyecto crezca. | Un desarrollador podría pegar por error un token real de otro servicio; reforzar con revisión antes de cada push. |

## Evidencia y decisión

Cada amenaza tiene un control operativo y una verificación ejecutable. La
prioridad no significa que las amenazas medias o bajas se omitan: el workflow
de week 03 ejecuta instalación reproducible, typecheck, pruebas públicas,
auditoría y generación de evidencia. Un resultado distinto del esperado debe
bloquear la entrega y conservarse como evidencia para corregir el control.