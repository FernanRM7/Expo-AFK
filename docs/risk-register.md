# Registro de riesgos — CampusOps

## Riesgo 1 (Prioridad Alta): Conflictos de sincronización offline-first
- **Probabilidad:** Alta — el proyecto necesita operación offline con cola persistente y sincronización posterior, escenario propenso a datos duplicados o desincronizados.
- **Impacto:** Alto — corrompería el historial de incidencias y la trazabilidad, que es un requisito núcleo del proyecto .
- **Mitigación:** Diseñar operaciones idempotentes desde el inicio, usar IDs únicos por transición y probar escenarios de reconexión con datos en conflicto antes de construir features sobre esa base.

## Riesgo 2 (Prioridad Media): Fallas en control de permisos por rol
- **Probabilidad:** Media — el encuadre ya avisa que "el permiso real se valida en el servicio; ocultar un botón no es suficiente", así que es fácil hacerlo mal (solo en UI).
- **Impacto:** Alto — un reportante actuando como coordinador rompería el flujo de estados y la evaluación de seguridad.
- **Mitigación:** Centralizar la validación de permisos en una sola capa de servicio, cubrirla con pruebas automatizadas y no depender de condicionales en la UI.

## Riesgo 3 (Prioridad Baja): Retrasos por subestimar la complejidad del núcleo offline-first
- **Probabilidad:** Alta — sincronización, conflictos e idempotencia son de los requisitos técnicamente más difíciles del proyecto y aparecen desde temprano en el roadmap.
- **Impacto:** Medio — un atraso es recuperable si se detecta a tiempo, aunque se arrastraría a las unidades siguientes (persistencia, resiliencia, permisos) si no se planifica bien.
- **Mitigación:** Empezar un diseño simple y funcional cuanto antes, dejar mejoras incrementales para después, y validar continuamente contra los criterios de aceptación en vez de dejarlo para el final.

## Justificación de prioridad
Se atendería primero el **Riesgo 1** porque su impacto compromete directamente un requisito obligatorio del núcleo del proyecto (idempotencia), y una base mal diseñada en la semana 1 sería costosa de corregir después. El **Riesgo 2** depende de la arquitectura de permisos, pero se puede aislar y probar una vez resuelta la base de sincronización, por lo que se atiende en segundo lugar. El **Riesgo 3** comparte causa raíz con el Riesgo 1 (la complejidad del núcleo offline-first), pero su impacto es más manejable con planeación temprana —por eso queda en tercer lugar, tratado como una consecuencia de gestión de tiempo más que como una falla técnica directa.