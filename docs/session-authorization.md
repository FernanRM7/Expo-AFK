# Autorización de operaciones por perfil

La autorización se valida en la lógica de operaciones (`src/features/incidents/application/authorizeOperation.ts`), no ocultando controles de la interfaz.

| Perfil | Operaciones permitidas |
|---|---|
| Reportante | Consultar sus propias incidencias. |
| Técnico | `start` y `resolve` solo sobre incidencias asignadas a él. |
| Coordinador | Consultar todo, `assign`, `prioritize`, `close` y `reopen`. |

Cualquier otra combinación se rechaza con el código genérico `forbidden`, sin datos de la incidencia.

## Aviso sobre el selector de actor

El selector de actor del backend didáctico (`X-Course-Actor` y `POST /v1/session/login` con un `actorId`) es **una ayuda de prueba**. No es autenticación de producción. Una app real nunca debe confiar en un rol enviado por el cliente.