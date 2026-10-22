# Modelo de datos local (esquema 2)

La persistencia de CampusOps usa SQLite mediante `expo-sqlite`. `openLocalStore()` abre `campusops.db` y aplica migraciones antes de devolver el servicio. Las tablas y `PRAGMA user_version` se actualizan dentro de una transacción; un error revierte el cambio completo y permite volver a intentar la migración.

## Entidades

- `incidents`: `id` (clave primaria), `version` (versión remota o `null`), `status` e `snapshot_json` (snapshot completo, incluidos descripción, nota/detalle y ubicación). Se actualiza por ID, preservando el último snapshot.
- `pending_operations`: `operation_id` (identidad estable, clave primaria), `incident_id`, `base_version`, `actor_id` y `operation_json`. La operación serializada conserva acción, payload, nota y referencias a fotos pendientes; son referencias/metadatos, no archivos de imagen subidos. El índice por incidencia facilita carga de la cola.

Los valores JSON conservan campos adicionales del dominio sin acoplar el esquema relacional a cada detalle del payload. No se guardan credenciales ni tokens aquí; éstos siguen usando SecureStore.

## Versiones y recuperación

- Esquema 0 → 1: crea `incidents`.
- Esquema 1 → 2: crea `pending_operations` e índice.
- Una base con versión mayor que la soportada se rechaza sin degradarla.
- `enqueue` es idempotente por `operationId` y no reemplaza el registro original. Sólo `acknowledge` elimina las operaciones confirmadas; los fallos y conflictos permanecen pendientes.
- La recuperación tras cerrar/reabrir consiste en abrir la misma base SQLite y consultar `getIncident`, `listIncidents` y `pendingOperations`.

Las pruebas inyectan una falla en la ruta transaccional de migración, verifican rollback íntegro y reintento, además del upgrade desde v1. La capa de almacenamiento se inyecta en `LocalStore` para que estos escenarios sean deterministas y no dependan de red.
