# Definición del Problema — CampusOps

Este documento complementa la especificación en `CAMPUSOPS.md` detallando los actores, sus responsabilidades y el recorrido central de una incidencia.

## Actores y responsabilidades

### Reportante
- Crear una incidencia seleccionando categoría, redactando descripción, adjuntando fotografías e indicando ubicación.
- Consultar el listado y el detalle de sus propios reportes.
- Agregar información posterior (notas, fotos) a una incidencia propia mientras esté en estado `open` o `assigned`.
- Recibir notificación de cambios de estado relevantes (asignación, resolución, cierre).

### Técnico
- Consultar las incidencias que tiene asignadas (estado `assigned` o `in_progress`).
- Iniciar la atención de una incidencia asignada, cambiando su estado a `in_progress`.
- Registrar diagnóstico, notas de trabajo y evidencias fotográficas durante la atención.
- Marcar la incidencia como `resolved` al completar la intervención, adjuntando evidencia de resolución.
- Trabajar sin conexión: consultar incidencias locales, cambiar estado y agregar notas/evidencias; los cambios se encolan para sincronizar al recuperar conectividad.
- No modificar una incidencia que haya sido reasignada a otra persona.

### Coordinador
- Consultar el conjunto completo de incidencias con filtros por estado, categoría, prioridad y técnico.
- Priorizar incidencias y asignar o reasignar técnicos (cambio a `assigned`).
- Revisar historial, evidencias y diagnóstico registrado por el técnico.
- Cerrar una incidencia resuelta (`resolved` → `closed`) validando la resolución.
- Reabrir un caso `resolved` o `closed` devolviéndolo a `assigned` cuando exista técnico asignado.
- Cada cambio de estado conserva historial y trazabilidad.

## Recorrido de una incidencia

```mermaid
flowchart LR
    A[Reportar] --> B[Asignar]
    B --> C[Atender]
    C --> D[Cerrar]
```

1. **Reportar** — El reportante crea la incidencia. Estado: `open`.
2. **Asignar** — El coordinador asigna un técnico. Estado: `assigned`.
3. **Atender** — El técnico inicia el trabajo, registra diagnóstico/evidencias y marca resuelto. Estados: `in_progress` → `resolved`.
4. **Cerrar** — El coordinador valida y cierra la incidencia. Estado: `closed`.
   - Opcional: el coordinador puede **reabrir** (`closed`/`resolved` → `assigned`) si procede.

## Relación con los estados (CAMPUSOPS.md)

| Paso del recorrido | Estado en CAMPUSOPS.md | Responsable | Acción |
|---|---|---|---|
| Reportar | `open` | Reportante | Crear incidencia |
| Asignar | `assigned` | Coordinador | Asignar técnico |
| Atender (inicio) | `in_progress` | Técnico | Iniciar atención |
| Atender (fin) | `resolved` | Técnico | Marcar resuelto con evidencia |
| Cerrar | `closed` | Coordinador | Validar y cerrar |
| Reabrir (opcional) | `assigned` | Coordinador | Reasignar técnico |

La **resolución del técnico** (`resolved`) y el **cierre del coordinador** (`closed`) son operaciones distintas. El flujo garantiza trazabilidad: cada transición queda registrada en el historial de la incidencia.

## Coherencia con CAMPUSOPS.md

- Los perfiles (Reportante, Técnico, Coordinador) y sus funciones coinciden con la tabla de **Perfiles** en `CAMPUSOPS.md`.
- El flujo de estados `open → assigned → in_progress → resolved → closed` es idéntico al definido en **Flujo de estados**.
- La reapertura por coordinación hacia `assigned` está contemplada en ambos documentos.
- La distinción entre resolución técnica y cierre coordinado se respeta en el recorrido y en la tabla de estados.
- El trabajo sin conexión del técnico y la cola de sincronización con detección de conflictos (caso de reasignación concurrente) son consistentes con la sección **Sin conexión, conflicto e idempotencia**.
- La idempotencia de reintentos y claves de operación estable se refleja en que «repetir la misma operación no debe duplicar eventos, evidencias ni notificaciones».