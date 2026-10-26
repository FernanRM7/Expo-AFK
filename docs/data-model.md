# Modelo de datos local (esquema 2)

CampusOps usa SQLite mediante `expo-sqlite`. `LocalStore` abre `campusops.db` para snapshots y `SQLitePendingWorkQueue` abre `campusops-offline.db` para el outbox activo; ambas usan el mismo esquema versionado y migraciones transaccionales. Las notas y referencias de fotos pendientes viven dentro del payload serializado de la operación junto con su snapshot base.

## Entidades

- `incidents`: `id` (clave primaria), `version` (versión remota o `null`), `status` y `snapshot_json` (snapshot del incidente).
- `pending_operations`: `operation_id` (identidad estable y clave primaria), `incident_id`, `base_version`, `actor_id` y `operation_json`. En el outbox activo, el JSON conserva la operación, el snapshot base, el estado de revisión y campos adicionales del payload como notas y referencias a fotos pendientes.

La cola conserva los metadatos de la foto como referencia; las imágenes futuras deberán guardarse en almacenamiento de documentos de la app y referenciar su URI persistente, no una ruta temporal de caché. No se guardan tokens ni credenciales en esta base; siguen en SecureStore.

## Versiones y recuperación

- Esquema 0 → 1: crea `incidents`.
- Esquema 1 → 2: crea `pending_operations` e índice por incidencia. Si el archivo offline tiene la tabla anterior `pending_work_operations`, copia todas sus entradas y luego la retira dentro de la misma transacción.
- Ambas migraciones y `PRAGMA user_version` se ejecutan dentro de una transacción. Un error revierte tablas y versión; una base con versión futura se rechaza sin degradarla.
- `enqueue` es idempotente por `operationId` y conserva la primera entrada. Sólo la confirmación satisfactoria del servidor permite retirar una operación; conflicto, rechazo o timeout dejan la entrada pendiente.
- Tras cerrar y reabrir la base, `getIncident`, `listIncidents` y `pendingOperations` recuperan snapshots y operaciones. La pantalla de trabajo usa esta misma cola persistida.

Las pruebas ejercitan SQLite real en archivos temporales: upgrade con fila previa, migración de la cola anterior sin pérdida, rollback tras una falla inyectada, reintento y cierre/reapertura con notas y referencias de fotos. También se conservan pruebas de unidad deterministas para los límites del adaptador.
