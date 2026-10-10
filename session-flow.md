# Flujo de sesión autenticada — CampusOps

## 1. Estados de sesión

La máquina usa `unauthenticated`, `authenticating`, `authenticated`, `expired` y `refreshing`. `sessionLifecycle.ts` acepta sólo transiciones definidas: un login fallido y un refresh fallido regresan a `unauthenticated`; logout elimina el par seguro antes de publicar ese estado. El diagrama ejecutable está en `docs/session-state-machine.mmd`.

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

### Operaciones de sesión
Archivo: `src/features/session/application/sessionService.ts`
- `login(actorId)` llama `POST /v1/session/login`, valida el DTO y persiste access/refresh en SecureStore.
- `refresh()` comparte una sola promesa, llama directamente `POST /v1/session/refresh` y reemplaza el par antes de retornar.
- `logout()` elimina ambas claves seguras antes de devolver éxito.
- `App.tsx` ofrece los controles de inicio y cierre de sesión y observa la máquina de estados.

### Cliente HTTP y rutas
| Archivo | Uso | Ruta |
|---|---|---|
| `src/api/courseBackend.ts` | Salud del backend | `GET /health` |
| `src/features/session/application/sessionService.ts` | Login, refresh compartido y logout | `/v1/session/login`, `/v1/session/refresh` |

Rutas del backend didáctico relevantes para sesión: `POST /v1/session/login` y `POST /v1/session/refresh`. `sessionService.ts` valida la respuesta de login, persiste sólo los tokens en SecureStore y devuelve identidad sin secretos.

## 2. Flujo normal
1. El usuario inicia sesión como un actor sintético con `POST /v1/session/login` y recibe `accessToken`, `refreshToken` y `expiresIn`.
2. La capa de sesión guarda ambos tokens en `SecureStore` con `saveSessionTokens` y devuelve sólo identidad/rol/expiración a la UI.
3. La app muestra el estado autenticado. El control de cerrar sesión elimina access y refresh tokens.

## 3. Expiración con refresh compartido (flujo objetivo)
1. Una solicitud autenticada detecta 401 y el flujo solicita `sessionService.refresh()`.
2. La primera llamada inicia **un solo** `POST /v1/session/refresh` con el `refreshToken`; es una llamada directa fuera de login y no se incluye Authorization.
3. Las demás llamadas a refresh **esperan la misma promesa** y no inician otra.
4. Con el refresh exitoso, se guarda el nuevo par y la máquina vuelve a `authenticated`.
5. El adaptador que detectó el 401 reintenta la solicitud una vez con el nuevo `accessToken`.

## 4. Refresh fallido con logout
1. El refresh responde 401 (`invalid_grant`), su DTO es inválido o la red falla.
2. El servicio elimina ambos tokens de `SecureStore` con `deleteSessionTokens()`.
3. Las llamadas compartidas terminan con error controlado, no se repite el refresh y la máquina publica `unauthenticated`.
4. `App` vuelve al login con un mensaje genérico, sin datos técnicos.

## 5. Reflexión
Ejecutar un refresh por cada respuesta 401 genera varias solicitudes simultáneas al mismo endpoint cuando hay muchas peticiones en vuelo. Si el servidor rota el `refreshToken`, el primer refresh invalida el token que usan los demás. Los refreshes siguientes fallan y pueden cerrar la sesión de un usuario válido. Además hay carreras al guardar los tokens, se desperdicia red y batería y se dificulta probar el comportamiento. Compartir un único refresh en curso evita todo esto y deja un solo punto donde decidir entre reintentar o cerrar sesión.