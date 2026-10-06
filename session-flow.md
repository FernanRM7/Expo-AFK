# Flujo de sesión autenticada — CampusOps

## 1. Inventario (estado actual del código)

### Almacenamiento de tokens
Archivo: `src/features/session/infrastructure/secureSessionStorage.ts` (usa `expo-secure-store`).

| Operación | Función | Almacenamiento |
|---|---|---|
| Guardar access token legado | `saveSessionToken(token)` | `campusops.session.access-token` |
| Guardar ambos tokens | `saveSessionTokens(tokens)` | access y refresh en claves separadas |
| Leer ambos tokens | `readSessionTokens()` | Devuelve `null` si falta cualquiera de los dos |
| Eliminar sesión | `deleteSessionTokens()` / `deleteSessionToken()` | Intenta eliminar ambas claves |

- Los tres métodos capturan cualquier fallo de `SecureStore` y lanzan un error genérico ("Unable to save/read/clear the session securely."), sin exponer el token.
- Clave usada: `campusops.session.access-token`.
- El access token y el refresh token se almacenan por separado en `SecureStore`. Si guardar uno falla, se intenta borrar el par para no dejar una sesión parcial.

### Uso del token en solicitudes
Archivo: `src/features/incidents/infrastructure/remoteIncidentRepository.ts`
- Recibe el access token inicial y lo envía como `Authorization: Bearer ...`.
- Las llamadas protegidas usan `fetchJsonWithSessionRefresh`; una respuesta 401 puede compartir la renovación activa y reintentar una vez.

### Cliente HTTP y rutas
| Archivo | Uso | Ruta |
|---|---|---|
| `src/features/incidents/infrastructure/remoteIncidentRepository.ts` | Cliente de incidencias | `GET /v1/incidents`, `GET /v1/incidents/:id`, `POST /v1/incidents` |
| `src/api/courseBackend.ts` | Salud del backend | `GET /health` |
| `src/api/cloudClient.ts` | `fetchJson` con errores tipados (contract-invalid, timeout, server-error) | URL recibida por parámetro |

Rutas del backend didáctico relevantes para sesión:
`POST /v1/session/login` y `POST /v1/session/refresh`.

## 2. Flujo normal
1. El usuario inicia sesión con `POST /v1/session/login` y recibe `accessToken`, `refreshToken` y `expiresIn`.
2. La capa de sesión guarda ambos tokens en `SecureStore` con `saveSessionTokens`.
3. Cada solicitud a `/v1/incidents` envía `Authorization: Bearer <accessToken>`.
4. El backend responde 200 y la app muestra los datos.

## 3. Expiración con refresh compartido (flujo objetivo)
1. Una solicitud recibe 401 porque el `accessToken` expiró.
2. El cliente inicia **un solo** `POST /v1/session/refresh` con el `refreshToken`, sin pasar por el wrapper autenticado y sin Authorization, por lo que el refresh no puede iniciar otro refresh.
3. Las demás solicitudes que reciban 401 mientras tanto **esperan ese mismo refresh** y no inician otro.
4. Con el refresh exitoso, se guarda el nuevo par de tokens antes de liberar a las solicitudes en espera.
5. Cada solicitud original se reintenta **una sola vez** con el nuevo `accessToken`. Si el token almacenado ya cambió cuando llega otro 401 antiguo, se reutiliza sin iniciar otra renovación.

## 4. Refresh fallido con logout
1. El refresh responde 401 (`invalid_grant`) o falla.
2. La app elimina ambos tokens de `SecureStore` con `deleteSessionTokens()`.
3. Las solicitudes en espera terminan con error controlado, sin reintentos.
4. El ciclo de sesión publica el estado `expired`; `App` vuelve a la vista de inicio de sesión con un mensaje genérico, sin datos técnicos.

## 5. Reflexión
Ejecutar un refresh por cada respuesta 401 genera varias solicitudes simultáneas al mismo endpoint cuando hay muchas peticiones en vuelo. Si el servidor rota el `refreshToken`, el primer refresh invalida el token que usan los demás. Los refreshes siguientes fallan y pueden cerrar la sesión de un usuario válido. Además hay carreras al guardar los tokens, se desperdicia red y batería y se dificulta probar el comportamiento. Compartir un único refresh en curso evita todo esto y deja un solo punto donde decidir entre reintentar o cerrar sesión.