# Política de resiliencia — ubicación

## Proveedor y restricciones

- **Proveedor:** usamos el doble determinista del curso, `GET /v1/geocoding?q=...` (backend didáctico, `http://127.0.0.1:4310`). No consulta lugares reales ni usa credenciales, cuotas ni pagos.
- **Contrato:** `{ label, latitude, longitude }`. El adaptador lo consulta con `fetchJson` y, por defecto, espera máximo 5 segundos.
- **Rutas con sesión:** el doble pide `Authorization` y `X-Course-Actor`, y el adaptador los recibe como `headers`. Son fixtures de prueba, no autenticación de producción.
- Las pruebas no dependen de Internet ni de cuotas de terceros: usan un `fetch` y un proveedor simulados.

## Arquitectura

| Capa | Archivo |
|---|---|
| Dominio | `src/features/location/domain/locationProvider.ts` (puerto) y `selectIncidentLocation.ts` (reglas) |
| Infraestructura | `src/features/location/infrastructure/httpLocationProvider.ts` |
| Aplicación | `src/features/location/application/resolveIncidentLocation.ts` |

`selectIncidentLocation` en `src/course-evaluation/index.ts` pasa la tarea a la lógica real del dominio. `App.tsx` conecta el proveedor con sesión al formulario de reporte y reutiliza el resolutor durante la sesión.

## Fallos y reintentos del proveedor

El adaptador convierte los fallos en "no disponible" con el motivo `timeout`, `rate-limited` (HTTP 429), `sin-conexion` o `respuesta-invalida`. Para timeout, HTTP 429 y HTTP 5xx usa `fetchJsonWithRetry`: hasta cuatro intentos y un máximo acumulado de 15 segundos. Un `Retry-After` válido determina la espera. Si supera el límite configurado de cinco segundos, se detienen los reintentos en vez de volver a consultar antes de tiempo. Sin esa cabecera usa backoff de 250, 500 y 1,000 ms. Si se agotan los reintentos, la aplicación ofrece la ubicación manual. No reintenta errores de contrato ni otros errores HTTP.

## Alternativa manual

Si el proveedor no está disponible, o devuelve datos nulos, incompletos o con coordenadas inválidas, la ubicación queda como `{ source: 'manual', label }`, con el edificio, la zona o la referencia que escriba la persona Nunca inventamos coordenadas Si la búsqueda viene vacía, ni siquiera se consulta al proveedor.

## Caché

- Es en memoria y se guarda por búsqueda normalizada (sin espacios en los extremos y en minúsculas).
- Dura 10 minutos, y el reloj se puede inyectar para las pruebas.
- Solo guardamos resultados válidos del proveedor. Los fallos y las ubicaciones manuales no se cachean, para que el siguiente intento vuelva a consultar.
- La caché se pierde al cerrar la app; no es persistente.

## Ejecución con datos ficticios

```bash
npx jest src/features/location --verbose
npx jest course-tests/public/week-09.test.ts -t "valid geocoding" --verbose
```

Para probar contra el doble real: `make run-backend` y usar el proveedor HTTP con `X-Course-Scenario` en `success`, `incomplete`, `invalid_coordinates`, `rate_limited` o `slow`.

## Flujo de reporte

El formulario de reporte permite buscar una ubicación y escribir una etiqueta manual. Si el proveedor responde, muestra la etiqueta recibida. Ante fallo o datos inválidos, conserva la ubicación manual y no agrega coordenadas. La operación de creación mantiene su clave y contenido al reintentarse desde el mismo formulario.
