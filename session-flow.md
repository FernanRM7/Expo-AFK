# Flujo de sesión autenticada — CampusOps

## 1. Inventario (estado actual del código)

### Almacenamiento de tokens
Archivo: `src/features/session/infrastructure/secureSessionStorage.ts` (usa `expo-secure-store`).

| Operación | Función | Llamada | Línea |
|---|---|---|---|
| Guardar | `saveSessionToken(token)` | `SecureStore.setItemAsync(SESSION_TOKEN_KEY, token)` | 8 |
| Leer | `readSessionToken()` | `SecureStore.getItemAsync(SESSION_TOKEN_KEY)` | 16 |
| Eliminar | `deleteSessionToken()` | `SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)` | 24 |

- Los tres métodos capturan cualquier fallo de `SecureStore` y lanzan un error genérico ("Unable to save/read/clear the session securely."), sin exponer el token.
- Clave usada: `campusops.session.access-token`.
- **Solo se almacena el `accessToken`.** El `refreshToken` no se lee, guarda ni elimina en ningún archivo de la app (solo aparece en el backend didáctico).

### Uso del token en solicitudes
Archivo: `src/features/incidents/infrastructure/remoteIncidentRepository.ts`
- Recibe `accessToken` como opción (línea 26) y lo envía como `Authorization: Bearer ${options.accessToken}` (línea 113).

### Cliente HTTP y rutas
| Archivo | Uso | Ruta |
|---|---|---|
| `src/features/incidents/infrastructure/remoteIncidentRepository.ts` | Cliente de incidencias | `GET /v1/incidents`, `GET /v1/incidents/:id`, `POST /v1/incidents` |
| `src/api/courseBackend.ts` | Salud del backend | `GET /health` |
| `src/api/cloudClient.ts` | `fetchJson` con errores tipados (contract-invalid, timeout, server-error) | URL recibida por parámetro |

Rutas del backend didáctico relevantes para sesión (aún sin cliente en la app):
`POST /v1/session/login` y `POST /v1/session/refresh`.

## 2. Flujo normal
1. El usuario inicia sesión con `POST /v1/session/login` y recibe `accessToken`, `refreshToken` y `expiresIn`.
2. La app guarda los tokens en `SecureStore`.
3. Cada solicitud a `/v1/incidents` envía `Authorization: Bearer <accessToken>`.
4. El backend responde 200 y la app muestra los datos.

## 3. Expiración con refresh compartido (flujo objetivo)
1. Una solicitud recibe 401 porque el `accessToken` expiró.
2. La app inicia **un solo** `POST /v1/session/refresh` con el `refreshToken`.
3. Las demás solicitudes que reciban 401 mientras tanto **esperan ese mismo refresh** y no inician otro.
4. Con el refresh exitoso, se guarda el nuevo par de tokens.
5. Cada solicitud pendiente se reintenta **una sola vez** con el nuevo `accessToken`.

## 4. Refresh fallido con logout
1. El refresh responde 401 (`invalid_grant`) o falla.
2. La app elimina los tokens de `SecureStore` con `deleteSessionToken()`.
3. Las solicitudes en espera terminan con error controlado, sin reintentos.
4. El usuario vuelve a la pantalla de inicio de sesión con un mensaje genérico, sin datos técnicos.

## 5. Reflexión
Ejecutar un refresh por cada respuesta 401 genera varias solicitudes simultáneas al mismo endpoint cuando hay muchas peticiones en vuelo. Si el servidor rota el `refreshToken`, el primer refresh invalida el token que usan los demás. Los refreshes siguientes fallan y pueden cerrar la sesión de un usuario válido. Además hay carreras al guardar los tokens, se desperdicia red y batería y se dificulta probar el comportamiento. Compartir un único refresh en curso evita todo esto y deja un solo punto donde decidir entre reintentar o cerrar sesión.