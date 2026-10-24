# Política de sincronización de trabajo

## Inicio offline y reasignación remota

El backend valida `baseVersion` para cada acción. Si coordinación reasigna una incidencia mientras el técnico está sin conexión y este inicia atención localmente, el registro más reciente del servidor es el estado canónico. La app no debe reasignarla al técnico anterior ni marcar automáticamente la atención como iniciada.

El adaptador `work` agrupa técnico asignado y estado para detectar cambios concurrentes. Esa agrupación de dominio no obliga a replicarla en el esquema de la base de datos.

## Captura y persistencia

`OfflineWorkQueueScreen` permite cargar incidencias asignadas y guardar el inicio offline desde el snapshot ya cargado, sin hacer una petición al pulsar el botón. `SQLitePendingWorkQueue` persiste la operación y su snapshot base en `campusops-offline.db`, incluyendo `operationId`, `actorId`, `baseVersion`, acción y payload. La operación sobrevive a la reapertura de la cola.

`offlineWorkSyncService` vuelve a consultar el servidor antes de enviar la acción. Solo retira la operación después de recibir confirmación satisfactoria del servidor. Los fallos de red conservan estado `pending`; una falta de autorización o un conflicto de versión cambia a `needs-review`.

## Reconciliación y presentación

`reconcileSync()` compara la base, el cambio local y el registro remoto. Cambios en campos independientes se pueden combinar. Si ambos lados cambian `work` de forma incompatible, devuelve `kind: 'conflict'` y `status: 'needs-review'`, conservando `base`, `local`, `remote` y la intención pendiente sin mutar sus metadatos.

La pantalla presenta el resultado como **Conflicto de sincronización**, junto con la operación, autor y versión base. Si el servidor entrega un snapshot accesible, también muestra la asignación vigente. Si el técnico perdió acceso por una reasignación, la app no finge que la base local sea el estado remoto: informa que el servidor no revela la asignación a ese perfil y que coordinación debe revisarla. Una respuesta de conflicto nunca se presenta como sincronización exitosa ni provoca la eliminación de la acción local.

## Resolución explícita

1. **Reintentar tras revisar:** se vuelve a leer el servidor. Solo se reintenta si el autor vuelve a ser el técnico asignado y la incidencia sigue `assigned`. Se conserva `operationId`, autor, acción y payload; solo se actualiza `baseVersion` a la versión vigente. La operación se elimina después de que el servidor confirme el inicio. Si la asignación o el estado no permiten iniciar, queda en revisión.
2. **Descartar intención local:** requiere una confirmación explícita en la interfaz. Se elimina solo esa operación; nunca modifica el registro remoto.

La cola usa `operationId` estable para evitar duplicar una acción al reintentar. El servidor sigue siendo la autoridad sobre asignación y estado.
