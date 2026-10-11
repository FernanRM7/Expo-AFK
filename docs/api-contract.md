# Contrato del cliente de incidencias CampusOps

Este documento describe el DTO del backend didáctico y el límite antes del modelo de dominio. Todas las identidades, operaciones y ubicaciones mencionadas son fixtures sintéticos del simulador local; no representan autenticación ni datos de producción. El backend se ejecuta en loopback y las pruebas no dependen de Internet público.

## Encabezados y fixture

Las rutas de incidencias usan `Authorization: Bearer course-valid-token` y `X-Course-Actor` con uno de los actores públicos de prueba (`reporter-1`, `reporter-2`, `technician-1`, `technician-2`, `coordinator-1`). Son valores de fixture del backend, no credenciales reales. El rol enviado por el cliente no sustituye la autorización del servidor. Las escrituras requieren además `Idempotency-Key` estable.

## DTO remoto

El sobre de una incidencia remota tiene esta forma:

```json
{
  "id": "campus-inc-001",
  "version": 1,
  "status": "assigned",
  "payload": {
    "category": "connectivity",
    "description": "Sin conexión en laboratorio ficticio",
    "location": "Edificio de prueba A",
    "reporterId": "reporter-1",
    "assignedTechnicianId": "technician-1",
    "priority": "medium",
    "notes": [],
    "evidence": [],
    "history": []
  }
}
```

`parseRemoteResource` sólo valida el sobre: `id` y `status` deben ser cadenas no vacías; `version` debe ser un entero no negativo; `payload` debe estar presente y ser un objeto o `null`. Devuelve los cuatro campos conocidos en el `ParseResult` compartido e ignora campos desconocidos del sobre para permitir extensiones compatibles. No valida reglas de negocio ni convierte el payload a `Incident`.

`payload: null` es una respuesta válida del escenario `nullable`. El parser conserva `null` literalmente. El consumidor no debe fabricar una categoría, ubicación u otros valores para construir un `Incident`; debe tratar la ausencia del payload de acuerdo con el estado de carga/dominio. Un payload objeto también sigue siendo DTO sin validar: la creación o actualización del modelo `Incident` requiere validación de dominio por separado. El tipo `Incident` no está declarado como tipo compuesto en `src/campusops/contracts.ts`; este límite no pretende inventar uno.

## Proyección a la aplicación

`RemoteIncidentRepository` valida los campos que CampusOps consume: categoría y estado publicados, descripción y ubicación no vacías, identidad de reportante y técnico asignado textual o nula. Después proyecta únicamente esos campos al modelo `Incident`; prioridad, notas, evidencia e historial no se copian al modelo de lista/detalle. La ubicación textual se representa como ubicación manual con la misma etiqueta. El backend no proporciona `title` ni `createdAt`, por lo que ambos son opcionales en `Incident` y el adaptador los deja ausentes.

El puerto devuelve `FetchResult` para distinguir `{ ok: true, value }` de `contract-invalid`, `timeout` y `server-error`. Una lista vacía es `{ ok: true, value: [] }`. Un DTO con `payload: null` se conserva como snapshot con `incident: null`, su `id`, `version` y `status`; un 404 de detalle es una respuesta HTTP fallida, no un payload nulo. La UI no recibe ni interpreta el DTO directamente y presenta errores genéricos.

## Rutas

### `GET /v1/incidents`

Respuesta `200`:

```json
{
  "items": [
    {
      "id": "campus-inc-001",
      "version": 1,
      "status": "assigned",
      "payload": { "category": "connectivity", "description": "Falla sintética" }
    }
  ]
}
```

El backend filtra los elementos por actor: el reportante ve sus reportes, el técnico sus asignaciones y el coordinador el conjunto. `items` contiene DTOs, no modelos `Incident` ya validados. Con `X-Course-Scenario: nullable`, cada DTO lleva `payload: null`.

### `GET /v1/incidents/:id`

Respuesta `200`: un DTO directamente en el cuerpo (sin wrapper `items` ni `incident`). Para el fixture inicial, el ID es `campus-inc-001`, versión `1` y estado `assigned`. El escenario `nullable` mantiene el sobre y reemplaza su `payload` por `null`.

### `POST /v1/incidents`

Solicitud con `Idempotency-Key` estable y cuerpo:

```json
{
  "category": "connectivity",
  "description": "Conexión intermitente en laboratorio sintético",
  "location": "Edificio de prueba B"
}
```

`category` debe pertenecer a las categorías publicadas por el backend; descripción y ubicación deben ser cadenas no vacías. Sólo un actor reportante puede crear incidencias.

Respuesta `201`:

```json
{
  "incident": {
    "id": "campus-inc-101",
    "version": 1,
    "status": "open",
    "payload": {
      "category": "connectivity",
      "description": "Conexión intermitente en laboratorio sintético",
      "location": "Edificio de prueba B",
      "reporterId": "reporter-1",
      "assignedTechnicianId": null,
      "priority": "medium",
      "notes": [],
      "evidence": [],
      "history": []
    }
  },
  "operationId": "create-operation-001",
  "duplicate": false
}
```

El campo `incident` es un DTO que el cliente extrae antes de pasarlo al parser del sobre. Repetir la misma clave y el mismo cuerpo devuelve `200` con el resultado previo y `duplicate: true`; reutilizar la clave con contenido diferente devuelve conflicto.

El adaptador requiere una clave estable de al menos ocho caracteres, proporcionada por el llamador para que un reintento pueda reutilizarla. La URL base, el actor y el token de fixture se inyectan; por defecto la URL es `http://127.0.0.1:4310` (para emulador Android, configura el host documentado en `docs/CAMPUSOPS_API.md`). Las pruebas sustituyen `fetch` y no acceden a servicios externos.

## Errores y escenarios

| Ruta/situación | HTTP | Cuerpo o semántica del backend didáctico |
|---|---:|---|
| Actor o fixture no autorizado | `401` | `{ "code": "unauthorized" }` |
| Recurso no visible para el actor | `403` | `{ "code": "forbidden" }` |
| Incidencia inexistente | `404` | `{ "code": "not_found" }` |
| Método no admitido | `405` | `{ "code": "method_not_allowed" }` |
| Falta `Idempotency-Key` válida | `400` | `{ "code": "idempotency_key_required" }` |
| Cuerpo JSON inválido o no objeto | `422` | `{ "code": "invalid_contract" }` |
| Categoría, descripción o ubicación inválida | `422` | `{ "code": "invalid_incident" }` |
| Misma clave con contenido distinto | `409` | `{ "code": "idempotency_key_reused" }` |
| Límite de solicitudes del escenario | `429` | `{ "code": "rate_limited" }` y `Retry-After` |
| Fallo controlado del servidor | `500` | `{ "code": "controlled_failure" }` |
| Escenario `malformed` | `200` | Cuerpo JSON malformado; el cliente debe rechazarlo como contrato inválido |
| Escenario `slow` o timeout del cliente | variable | El cliente puede abortar; no asumir que una escritura no se guardó |

El parser devuelve `{ "ok": false, "error": "contract" }` si el sobre no satisface su contrato. Esto no reemplaza los errores HTTP del cliente ni la validación de dominio: son límites distintos y no deben convertirse en un `Incident` sintético.

## Referencias de fixtures

Las formas y respuestas descritas corresponden a `docs/CAMPUSOPS_API.md`, `course-backend/campusops.mjs` y `course-backend/server.mjs`. El servidor mantiene el estado en memoria y puede reiniciarse; no se despliega a Internet.
