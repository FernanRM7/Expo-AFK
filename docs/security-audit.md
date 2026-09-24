# Auditoría de seguridad — Semana 4

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Se registraba en consola el objeto completo de una incidencia, incluyendo datos del reportante | Los logs podían exponer información asociada a un usuario (ID de reportante, ubicación, descripción) | Se reemplazó el log completo por un mensaje con solo el ID y el estado de la incidencia | docs/evidence/log-sanitizado.png |
| 2 | El repositorio en memoria lanzaba un error con detalles internos al no encontrar una incidencia | Un mensaje de error detallado podría revelar estructura interna del sistema a quien lo vea | Se reemplazó por un mensaje genérico para el usuario final | docs/evidence/error-generico.png |
| 3 | La URL del backend tenía un valor por defecto escrito directamente en el código | Si se cambia de entorno (producción, otro servidor) sin configurar la variable, el valor hardcodeado podría usarse por error | Se eliminó el valor por defecto hardcodeado y se documentó en `.env.example` | docs/evidence/env-config.png |

## Hallazgo 1 — Log con datos completos de una incidencia

### Problema encontrado

En `src/features/incidents/application/getIncidentDetail.ts`, el caso de uso registraba en consola el objeto completo de la incidencia obtenida, incluyendo campos sensibles como `reporterId`, `location` y `description`.

### Riesgo

Cualquier persona con acceso a los logs de la aplicación (por ejemplo, en herramientas de monitoreo o durante depuración) podría ver el identificador del reportante, la ubicación exacta y la descripción del incidente, información que no es necesaria para fines de diagnóstico técnico.

### Solución

Se reemplazó el log del objeto completo por un registro que solo incluye información técnica no sensible: el ID de la incidencia consultada, si fue encontrada y su estado actual.

### Antes

```ts
const incident = await repository.getById(incidentId);
console.log(incident);
return incident;
```

### Después

```ts
const incident = await repository.getById(incidentId);
console.log({
  incidentId,
  found: incident !== null,
  status: incident?.status ?? null,
});
return incident;
```

### Evidencia

- `docs/evidence/log-antes.png`: salida de consola mostrando el objeto completo (reporterId, location, description expuestos).
- `docs/evidence/log-despues.png`: salida de consola mostrando solo `incidentId`, `found` y `status`.

## Hallazgo 2 — Mensaje de error con detalle interno

### Problema encontrado

En `src/features/incidents/infrastructure/inMemoryIncidentRepository.ts`, el método `getById` lanzaba un error que incluía la ruta del archivo fuente y el tamaño interno de los datos cuando no encontraba una incidencia.

### Riesgo

Si ese mensaje llegara a mostrarse al usuario o quedara registrado sin control, revelaría detalles de la implementación interna (nombre de la clase, ruta del código, estructura de datos), información útil para alguien que intente atacar el sistema.

### Solución

Se eliminó el lanzamiento de error y se volvió al comportamiento original: devolver `null` cuando no se encuentra la incidencia, dejando que la capa de presentación (`IncidentDetailScreen.tsx`) decida el mensaje genérico para el usuario ("Incidencia no encontrada").

### Antes

```ts
async getById(id: string): Promise<Incident | null> {
  const found = this.incidents.find((incident) => incident.id === id);
  if (!found) {
    throw new Error(
      `Incident ${id} not found in InMemoryIncidentRepository (seed size: ${this.incidents.length}, source: src/features/incidents/infrastructure/inMemoryIncidentRepository.ts)`,
    );
  }
  return found;
}
```

### Después

```ts
async getById(id: string): Promise<Incident | null> {
  return this.incidents.find((incident) => incident.id === id) ?? null;
}
```

### Evidencia

- `docs/evidence/error-antes.png`: mensaje de error exponiendo la ruta del archivo y el tamaño interno de datos.
- `docs/evidence/error-solucionado.png`: resultado `null`, sin detalles internos expuestos.

## Hallazgo 3 — URL del backend hardcodeada como valor por defecto

### Problema encontrado

En `src/api/courseBackend.ts`, la función `getBackendHealth` usaba un valor por defecto hardcodeado (`http://127.0.0.1:4310`) cuando la variable de entorno `EXPO_PUBLIC_COURSE_BACKEND_URL` no estaba configurada, en vez de depender exclusivamente de esa variable.

### Riesgo

Si la variable de entorno no se configura correctamente (por ejemplo, al desplegar en otro entorno o servidor), la aplicación seguiría funcionando silenciosamente apuntando a `localhost`, sin ninguna advertencia — lo que podría ocultar un error de configuración en vez de detectarlo a tiempo.

### Solución

Se eliminó el valor por defecto hardcodeado. Ahora, si la variable de entorno no está definida, la aplicación lanza un error explícito indicando que debe configurarse (consultando `.env.example`), en vez de usar un valor silencioso.

### Antes

```ts
const DEFAULT_URL = 'http://127.0.0.1:4310';

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
```

### Después

```ts
function resolveBackendUrl(): string {
  const url = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL;
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_COURSE_BACKEND_URL no está configurada. Define esta variable en tu archivo .env (ver .env.example).',
    );
  }
  return url;
}

export async function getBackendHealth(
  baseUrl = resolveBackendUrl(),
): Promise<BackendHealth> {
```

### Evidencia

- `docs/evidence/env-antes.png`: confirma que sin variable de entorno, la app usa `127.0.0.1:4310` silenciosamente.
- `docs/evidence/env-solucionado.png`: confirma que sin la variable, la aplicación lanza un error explícito en vez de usar un valor oculto.