# Definición del problema — CampusOps

## Problema que se quiere resolver

En el campus universitario, las fallas de mantenimiento —como problemas eléctricos, daños en laboratorios, fugas de agua, conectividad o equipos descompuestos— pueden tardar en atenderse porque los reportes no siempre llegan al responsable adecuado, no tienen una prioridad clara y su avance no es visible para todas las personas involucradas.

CampusOps propone centralizar el registro y seguimiento de incidencias para reducir ese retraso: cada reporte debe poder asignarse, atenderse y cerrarse con un estado, una persona responsable y evidencia del trabajo realizado.

El problema principal es el **mantenimiento tardío** causado por la falta de un flujo trazable de atención. La aplicación no reemplaza el criterio del personal responsable; proporciona información organizada para que pueda actuar y dejar constancia de cada etapa.

## Alcance del proyecto

### Incluye

- Registro de incidencias con categoría, descripción y ubicación.
- Consulta de incidencias y de su estado actual.
- Priorización y asignación de incidencias a personal técnico.
- Registro del diagnóstico, notas y evidencias de la atención.
- Seguimiento del flujo de una incidencia mediante estados:
  `open` → `assigned` → `in_progress` → `resolved` → `closed`.
- Historial de cambios para conservar la trazabilidad.
- Funciones diferenciadas para reportante, técnico y coordinador.
- Manejo progresivo de información local, trabajo sin conexión, sincronización y conflictos según los hitos posteriores del proyecto.

### Fuera de alcance

- Atención de emergencias o coordinación institucional real.
- Uso de datos personales, credenciales, ubicaciones sensibles o fotografías reales.
- Integración con sistemas institucionales reales.
- Pagos, chat en tiempo real, inteligencia artificial o reconocimiento de imágenes.
- Panel web administrativo completo.
- Publicación obligatoria en tiendas.

El proyecto utiliza un campus ficticio, cuentas sintéticas, ubicaciones de prueba y datos preparados para el ejercicio.

## Responsabilidades por perfil

| Perfil | Responsabilidades principales |
|---|---|
| **Reportante** | Crear una incidencia, elegir su categoría, describir el problema, indicar la ubicación, adjuntar evidencia cuando corresponda, consultar sus reportes y agregar información posterior. |
| **Técnico** | Consultar incidencias asignadas, iniciar la atención, registrar diagnóstico, notas y evidencias, y marcar la incidencia como resuelta. |
| **Coordinador** | Consultar las incidencias, priorizarlas, asignarlas o reasignarlas, revisar el historial y las evidencias, cerrar una resolución o reabrir un caso cuando sea necesario. |

Las acciones disponibles deben depender del perfil y de las reglas de autorización del servicio. Ocultar una opción en la interfaz no sustituye la comprobación de permisos.

## Flujo principal de una incidencia

El recorrido documentado es:

1. **Reportar:** el reportante registra la falla con información suficiente para identificarla.
2. **Asignar:** el coordinador revisa y prioriza el reporte, y lo asigna a un técnico.
3. **Atender:** el técnico inicia el trabajo, registra el diagnóstico y agrega notas o evidencias.
4. **Cerrar:** el técnico marca la atención como resuelta y el coordinador revisa y cierra la incidencia.

Este flujo se representa con los estados `open`, `assigned`, `in_progress`, `resolved` y `closed`. En Semana 1 sólo se documenta el flujo; no se implementa todo el recorrido en la aplicación.

## Criterios verificables de aceptación

- El documento identifica el mantenimiento tardío como problema central y explica cómo la falta de prioridad, asignación y seguimiento contribuye a él.
- El documento distingue claramente qué incluye y qué excluye CampusOps.
- Cada uno de los tres perfiles tiene responsabilidades específicas y no intercambiables.
- El flujo `reportar → asignar → atender → cerrar` identifica el actor responsable y el estado asociado a cada etapa.
- Los estados documentados coinciden con `open → assigned → in_progress → resolved → closed`.
- Se puede revisar el documento y comprobar que Semana 1 entrega documentación, no la implementación completa del flujo.
- El alcance y los criterios se mantienen dentro del caso ficticio de CampusOps y no requieren datos reales para ser evaluados.
