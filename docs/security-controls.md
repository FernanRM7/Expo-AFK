# Controles de seguridad y privacidad — Semana 4

## Información revisada

CampusOps maneja sesiones, identidad de actor, incidencias, ubicaciones, fotografías, asignaciones e historial. La app de esta semana sigue siendo una base académica con fixtures sintéticos; el token publicado por el backend didáctico es explícitamente una fixture, no una credencial de producción. No se deben usar datos reales ni desplegar el backend en Internet.

## Controles y amenazas

| Amenaza | Control implementado | Comprobación | Riesgo residual |
|---|---|---|---|
| T-03: secretos o datos sensibles quedan en logs/artefactos | El cliente informa categorías de error y contexto técnico filtrado; el sanitizador redacta secretos, identidad, ubicación, fotos, evidencia, comentarios e historial. Se mantiene el escaneo reproducible del repositorio. | `npm test -- --ci --runInBand course-tests/public/week-04.test.ts`; `python3 tools/course_public_evaluator.py --week 4 --mode verify`; resultado en reportes Week 04. | Los patrones de escaneo no detectan todo secreto nuevo y las claves sensibles nuevas requieren actualizar la lista. No se debe incluir información sensible en texto libre. |
| T-05: fixtures o evidencias contienen datos reales | Sólo se usan valores sintéticos; los reportes registran comandos/resultados, no payloads completos. | `python3 tools/course_public_evaluator.py --week 4 --mode verify` y revisión de `reports/`/`evidence/`. | Una persona aún podría pegar datos reales fuera de los patrones conocidos; revisión antes del push sigue siendo necesaria. |
| T-08: datos sensibles de incidencias llegan a telemetría | `redactForTelemetry` recorre mapas/listas, normaliza mayúsculas y separadores `_`/`-`, crea copias y reemplaza valores sensibles completos con `[REDACTED]`. `reportCampusOpsError` filtra el contexto antes de invocar el transporte. | `npm test -- --ci --runInBand course-tests/public/week-04.test.ts`; los casos incluyen estructuras profundas, datos sensibles y contexto técnico. | Un campo sensible nuevo o texto libre dentro de una clave aparentemente técnica puede escapar la política; toda telemetría requiere revisión de esquema. |
| T-09: credenciales de sesión se guardan sin protección | El token de sesión se persiste únicamente con Expo SecureStore, que usa almacenamiento nativo cifrado (Keychain en iOS y preferencias cifradas respaldadas por Android Keystore). No se persisten identidad, incidencias ni ubicación en este adaptador. | Prueba de ciclo guardar/leer/eliminar y rechazo nativo con mensaje genérico; suite de telemetría verifica que el sink sólo recibe contexto filtrado. | Un dispositivo comprometido puede exponer una sesión activa; hay límites de tamaño/ disponibilidad de plataforma y el ciclo de vida de backup/restauración debe configurarse. SecureStore no reemplaza expiración, revocación ni autorización del servidor. |

## Decisión de almacenamiento

Se eligió `expo-secure-store` para el token pequeño de sesión: ofrece una interfaz asíncrona común y delega cifrado/almacenamiento a mecanismos del sistema operativo. `AsyncStorage` y archivos JSON son más simples para datos recuperables, pero no protegen secretos frente a lectura del almacenamiento de la app. La sesión no debe incluirse en logs, analíticas, preferencias comunes ni reportes. Las operaciones de almacenamiento devuelven errores genéricos sin propagar mensajes nativos que pudieran contener valores.

La selección no convierte el token sintético del backend didáctico en autenticación de producción. Una integración real requiere vida corta/rotación de tokens, revocación en servidor, TLS, controles de backup por plataforma y pruebas en dispositivos reales. La capa de telemetría comienza sin transporte configurado; cualquier transporte futuro debe instalarse mediante `configureTelemetrySink` y se alimentará sólo con eventos que pasaron por `redactForTelemetry`.
