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
- `getAccessToken()` compara la expiración calculada con el reloj del servicio; si expiró, inicia o comparte una renovación antes de devolver el token.
- `refreshAfterUnauthorized(observedAccessToken)` comparte el refresh para 401 concurrentes y evita refrescar si otra solicitud ya guardó un access token más nuevo.
- `refresh()` también comparte la misma operación; el servicio reemplaza el par en SecureStore antes de devolver éxito.
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

## 3. Expiración con refresh compartido
1. `RemoteIncidentRepository` usa `fetchJsonWithSession` y solicita a `sessionService` un token vigente antes de enviar una operación.
2. La primera llamada inicia **un solo** `POST /v1/session/refresh` con el `refreshToken`; es una llamada directa fuera de login y no se incluye Authorization.
3. Las demás llamadas a refresh **esperan la misma promesa** y no inician otra.
4. Con el refresh exitoso, se guarda el nuevo par y la máquina vuelve a `authenticated`.
5. El adaptador que detectó el 401 reintenta la solicitud una vez con el nuevo `accessToken`; un segundo 401 se devuelve como error y no reinicia la renovación.
6. La generación de sesión invalida respuestas de refresh que llegan después de logout; logout espera una renovación en vuelo y elimina el par al terminar.

La expiración se calcula con un reloj inyectable en `createSessionService`, por lo que las pruebas avanzan el tiempo sin esperas reales. El instante de expiración vive en memoria; después de reiniciar la app, la primera petición puede detectar el vencimiento mediante 401 y renovar.

Las operaciones mutables pasan además por `authorizeOperation` antes de enviar `POST /v1/incidents/:id/actions`. Es un control local de defensa en profundidad; el backend sigue siendo autoridad final y valida rol, asignación y versión.

## 4. Refresh fallido con logout
1. El refresh responde 401 (`invalid_grant`), su DTO es inválido o la red falla.
2. El servicio elimina ambos tokens de `SecureStore` con `deleteSessionTokens()`.
3. Las llamadas compartidas terminan con error controlado, no se repite el refresh y la máquina publica `unauthenticated`.
4. `App` vuelve al login con un mensaje genérico, sin datos técnicos.

## 5. Reflexión
Ejecutar un refresh por cada respuesta 401 genera varias solicitudes simultáneas al mismo endpoint cuando hay muchas peticiones en vuelo. Si el servidor rota el `refreshToken`, el primer refresh invalida el token que usan los demás. Los refreshes siguientes fallan y pueden cerrar la sesión de un usuario válido. Además hay carreras al guardar los tokens, se desperdicia red y batería y se dificulta probar el comportamiento. Compartir un único refresh en curso evita todo esto y deja un solo punto donde decidir entre reintentar o cerrar sesión.
