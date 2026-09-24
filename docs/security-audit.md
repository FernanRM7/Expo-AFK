# Auditoría de seguridad — Semana 4

## Alcance

Revisión estática del cliente Expo, `course-backend/` y su configuración. Los riesgos que siguen son condicionales: CampusOps es un simulador con actores y tokens ficticios, diseñado para pruebas y expresamente no apto para autenticación institucional ni despliegue en Internet. No encontré credenciales reales, `.env` rastreado ni llamadas `console.*` en el código de la app revisado.

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Inicio de sesión del fixture permite seleccionar un actor conocido (`course-backend/campusops.mjs`). | Si se tratara como autenticación real o se expusiera, una persona podría elegir `coordinator-1` y recibir el rol/token sintéticos de coordinador. Esto no compromete cuentas reales: el contrato lo define como fixture público. | **Riesgo residual, no se cambió el contrato de prueba.** Los documentos advierten que no es autenticación de producción; además, el servidor queda limitado a loopback salvo opt-in explícito. Una integración real necesita identidad y autorización verificadas en el servidor. | `course-backend/campusops.mjs`; `docs/CAMPUSOPS_API.md`; `docs/evidence/backend-security-self-test.txt` |
| 2 | CORS respondía `Access-Control-Allow-Origin: *` (`course-backend/server.mjs`). | Permitía que cualquier origen de navegador recibiera respuestas CORS. El comodín no equivale a autorización ni por sí solo prueba exposición de datos sensibles; sí amplía innecesariamente quién puede leer respuestas del fixture y es una mala base para agregar rutas. | **Corregido:** allowlist configurable `COURSE_BACKEND_ALLOWED_ORIGINS`, con sólo los dos orígenes locales de Expo permitidos por defecto; se declaran métodos y encabezados necesarios sólo para esos orígenes. | Self-test: origen local aceptado y origen externo sin `Access-Control-Allow-Origin`; `docs/evidence/backend-security-self-test.txt` |
| 3 | `COURSE_BACKEND_HOST` podía hacer que el servidor escuchara en una interfaz de red sin una confirmación explícita (`course-backend/server.mjs`). | Al enlazarlo accidentalmente a una interfaz accesible desde la red, otras personas podrían alcanzar el simulador, que usa identidades ficticias conocidas y no tiene autenticación de producción. | **Corregido:** se rechaza cualquier bind no loopback salvo que `COURSE_BACKEND_ALLOW_REMOTE=1` se configure deliberadamente. La guía limita esa excepción a una red de laboratorio de confianza y prohíbe exponer el simulador a Internet. | Self-test: bind a `0.0.0.0` rechazado sin opt-in; `docs/evidence/backend-security-self-test.txt` |

## Hallazgo 1 — Actor seleccionable en el login de prueba

### Problema encontrado

En `course-backend/campusops.mjs`, `POST /v1/session/login` comprueba únicamente que `actorId` esté en la lista de fixtures y devuelve el rol asociado junto con el token fijo `course-valid-token`. Las solicitudes posteriores identifican el actor mediante `X-Course-Actor`.

### Riesgo

No hay prueba de identidad de una persona. Si este fixture se usara como servicio real, cualquiera podría solicitar un actor de mayor privilegio y ejecutar acciones con ese rol. El repositorio declara que los actores y tokens son sintéticos y que el servicio no debe desplegarse a Internet; por eso se documenta como riesgo de uso/despliegue, no como una filtración real.

### Tratamiento

Se conserva intencionalmente el contrato para las pruebas académicas. No se afirma que el guard de red convierta el login en autenticación segura: cualquier sistema real debe validar identidad y permisos en el servidor con un mecanismo de producción.

### Antes

```js
if (!input || !Object.hasOwn(actors, input.actorId)) return send(response, 401, { code: 'unknown_fixture_actor' });
return send(response, 200, { actorId: input.actorId, role: actors[input.actorId], accessToken: 'course-valid-token', refreshToken: 'course-refresh-0', expiresIn: 60 });
```

**Evidencia:** código y advertencia del contrato en `docs/CAMPUSOPS_API.md`; prueba de regresión del servicio en `docs/evidence/backend-security-self-test.txt`.

## Hallazgo 2 — Política CORS demasiado amplia

### Problema encontrado

`course-backend/server.mjs` añadía `Access-Control-Allow-Origin: *` a todas las respuestas.

### Riesgo

Cualquier origen web podía leer respuestas CORS del backend cuando el navegador permitiera la solicitud. El comodín no reemplaza autenticación y el fixture sólo contiene datos sintéticos, pero la política era más amplia de lo necesario.

### Solución

Se quitó el comodín. El servidor permite por defecto `http://localhost:8081` y `http://127.0.0.1:8081`; otros orígenes de desarrollo deben declararse en `COURSE_BACKEND_ALLOWED_ORIGINS`. Métodos y encabezados CORS se envían sólo a un origen permitido.

### Antes

```js
'access-control-allow-origin': '*',
```

### Después

```js
if (typeof origin === 'string' && allowedOrigins.has(origin)) {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Authorization, Content-Type, Idempotency-Key, X-Course-Actor, X-Course-Scenario');
}
```

**Evidencia:** `npm run backend:self-test` comprueba que el origen local permitido recibe el encabezado CORS y que `https://untrusted.example` no lo recibe.

## Hallazgo 3 — Bind de red controlado sólo por una variable de entorno

### Problema encontrado

El servidor usaba directamente `COURSE_BACKEND_HOST`, por lo que una configuración como `0.0.0.0` podía exponer el fixture a otras máquinas.

### Riesgo

Quien pueda alcanzar ese servicio tendría acceso a endpoints diseñados para pruebas y a roles sintéticos conocidos. El fixture no ofrece autenticación de producción.

### Solución

El host predeterminado sigue siendo `127.0.0.1`. Ahora se rechazan hosts que no sean `127.0.0.1`, `::1` o `localhost`, salvo opt-in explícito con `COURSE_BACKEND_ALLOW_REMOTE=1`. Esa excepción es sólo para una red de laboratorio de confianza; no habilita un despliegue seguro ni autoriza exponerlo a Internet.

### Antes

```js
const host = process.env.COURSE_BACKEND_HOST ?? '127.0.0.1';
// server.listen(port, host, ...), sin comprobar si el host es público
```

### Después

```js
if (!loopbackHosts.has(host) && process.env.COURSE_BACKEND_ALLOW_REMOTE !== '1') {
  process.stderr.write('Refusing non-loopback bind; set COURSE_BACKEND_ALLOW_REMOTE=1 only on a trusted lab network.\n');
  process.exit(1);
}
```

**Evidencia:** `npm run backend:self-test` inicia un proceso con host `0.0.0.0` y comprueba que se cierre sin opt-in. La guía de integración también documenta la excepción.

## Comprobación de secretos y límites

- `.env` está en `.gitignore` y no figura entre los archivos rastreados; `.env.example` sólo contiene `EXPO_PUBLIC_COURSE_BACKEND_URL` con una URL local.
- La búsqueda del código de la app no encontró `console.*`, ni credenciales o tokens reales. Los valores `course-valid-token` y `course-refresh-0` son fixtures públicos documentados.
- El cliente y backend de este repositorio usan HTTP para el entorno local de pruebas. No se deben enviar datos reales ni usar la excepción de red de laboratorio en una red no confiable.

## Verificación

Comando ejecutado: `npm run backend:self-test` — **PASS**, código de salida 0. La salida completa y los checks de `.env` se guardan en `docs/evidence/backend-security-self-test.txt`.
