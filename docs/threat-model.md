# Modelo de amenazas y controles reproducibles

## Alcance y criterio de prioridad

El alcance es el cliente Expo, el backend controlado de CampusOps, el flujo de
sincronización offline-first y el workflow de CI. La prioridad combina impacto
y probabilidad: **Alta** requiere bloquear la entrega ante un fallo; **Media**
requiere evidencia en cada cambio; **Baja** se revisa como parte de la
verificación de CI.

## Matriz de amenazas

| ID / amenaza | Activo afectado | Control | Prueba o comando reproducible | Resultado esperado | Prioridad y justificación | Riesgo residual |
| --- | --- | --- | --- | --- | --- | --- |
| T-01. Un usuario modifica una incidencia fuera de su rol, propiedad o asignación. | Incidencias, transiciones de estado y trazabilidad. | **Autorización por rol, propietario y asignación** en el servicio; la UI no se considera una barrera de seguridad. | `npm test -- --runInBand course-tests/public/week-02.test.ts` y revisión de `src/campusops/contracts.ts` para las reglas de transición. | Las transiciones no autorizadas son rechazadas y las reglas públicas pasan sin depender de ocultar botones. | **Alta**: afecta integridad y separación de funciones; un bypass permitiría alterar el historial del campus. | Un defecto nuevo en una ruta no cubierta por las pruebas públicas podría permitir una autorización incorrecta; requiere pruebas de servicio adicionales al añadir rutas.
| T-02. Reintentos o reconexiones duplican operaciones y corrompen la cola offline. | Cola local, incidencias y consistencia entre cliente y backend. | **Validación de versiones e idempotencia**: rechazar versiones obsoletas y reutilizar una clave de operación para reintentos. | `npm test -- --runInBand course-tests/public/week-01.test.ts course-tests/public/week-02.test.ts` y `npm run typecheck`. | Los conflictos de versión se detectan de forma explícita, un reintento no crea una segunda transición y el contrato compila. | **Alta**: pérdida o duplicación de transiciones rompe el requisito central offline-first y la trazabilidad. | Un conflicto distribuido no representado en los fixtures podría requerir resolución manual; la persistencia real debe probarse cuando se incorpore.
| T-03. Un secreto llega al repositorio o datos sensibles quedan en logs y artefactos. | Credenciales, tokens, payloads de incidencias y evidencias de CI. | **Secret scan y logs sanitizados**; usar fixtures sintéticos y no imprimir headers, tokens ni payloads sensibles. | `git grep -n -I -E '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})' -- . ':!node_modules'` y `npm audit --omit=dev --audit-level=critical`. | El scan no encuentra patrones de credenciales; la auditoría termina sin vulnerabilidades críticas y los logs no exponen secretos. | **Alta**: una filtración puede comprometer cuentas y artefactos aunque la aplicación funcione correctamente. | Los patrones no detectan secretos con formatos nuevos ni credenciales inyectadas por el entorno; el runner debe permanecer sin secretos de producción.
| T-04. Un workflow de contribución obtiene permisos excesivos o relaja las puertas de calidad. | Repositorio, historial GitHub y resultados de CI. | **Permisos mínimos del workflow**: `contents: read`, instalación reproducible y fallos no ignorados. | `npm test -- --runInBand course-tests/public/week-03.test.ts` y `Select-String -Path .github/workflows/week-03-ci-amenazas-feedback.yml -Pattern 'permissions:|contents: read|continue-on-error|\|\| true'`. | La prueba pasa; el workflow declara solo lectura, ejecuta las verificaciones y no contiene `continue-on-error` ni `|| true`. | **Alta**: un workflow comprometido puede leer o modificar más recursos que el necesario y ocultar fallos de seguridad. | Un action de terceros actualizado podría cambiar su comportamiento; fijar versiones mayores y revisar cambios del workflow antes de fusionar.
| T-05. Fixtures o evidencias contienen datos reales y se publican en CI. | Evidencias académicas, reportes y privacidad de usuarios. | **Fixtures sintéticos sin credenciales reales**; datos deterministas de prueba y revisión de archivos antes de subir artefactos. | `npm test -- --runInBand course-tests/public/week-03.test.ts` y `git grep -n -I -E '(password|token|secret|Authorization: Bearer)' -- course-tests evidence reports ':!node_modules'`. | El modelo y las pruebas pasan; los fixtures y reportes no contienen credenciales ni tokens reales. | **Media**: el impacto de una filtración es alto, pero el alcance se limita a datos de prueba si el control se aplica desde el inicio. | Un secreto codificado o una muestra que parezca inocua puede evadir el grep; complementar con revisión humana antes de publicar artefactos.

## Evidencia y decisión

Cada amenaza tiene un control operativo y una verificación ejecutable. La
prioridad no significa que las amenazas medias o bajas se omitan: el workflow
de week 03 ejecuta instalación reproducible, typecheck, pruebas públicas,
auditoría y generación de evidencia. Un resultado distinto del esperado debe
bloquear la entrega y conservarse como evidencia para corregir el control.