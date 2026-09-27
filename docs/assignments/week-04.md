# Semana 4 — Proteger la sesión y evitar filtraciones de datos

**Actividad:** Controles de seguridad y privacidad. **Valor:** 8 puntos. **Equipo:** 3 integrantes.

Una app puede ocultar información en pantalla y aun así dejarla expuesta en archivos o registros de errores. En el mismo repositorio CampusOps, identifiquen dónde termina la información, protejan la sesión, saniticen registros y prueben caminos de error con datos ficticios.

## Trabajo requerido

1. Revisen almacenamiento, logs técnicos y reportes que puedan conservar sesiones, nombres, ubicación, fotografías o comentarios internos.
2. Usen almacenamiento seguro para los datos que lo requieran, eliminen secretos escritos en código y eviten exponerlos al informar errores. Justifiquen el mecanismo elegido y los riesgos residuales.
3. Conecten `redactForTelemetry` con CampusOps. Apliquen el contrato de `docs/CAMPUSOPS_API.md` a objetos anidados y listas, sin modificar la entrada. Oculten campos sensibles y conserven contexto técnico seguro.
4. Comprueben con pruebas negativas que los datos protegidos no aparezcan en logs, preferencias o reportes, incluso después de ocultarlos en la interfaz.

## Entregables

- `docs/security-controls.md`: controles, amenazas, almacenamiento elegido y riesgo residual.
- `reports/week-04/secret-scan.json`: búsqueda reproducible de secretos.
- `reports/week-04/negative-tests.json`: sanitización y exposición, anidamiento y caminos de error.
- `evidence/week-04/engineering.json` y `individual.json`: decisión justificada y aportación verificable de cada uno de los tres integrantes.

Los JSON deben seguir `docs/EVIDENCE_CONTRACT.md`. No usen información real ni reporten resultados que no hayan observado.

## Comprobación y entrega

Ejecuten `make feedback`, `make verify-week-04` y `make public-test-week-04`. Guarden después un commit exclusivo de `reports/` y `evidence/`, creen la etiqueta `week-04-final`, ejecuten `make evidence-week-04` y suban la versión y la etiqueta. En Classroom entreguen el enlace del repositorio, el tag y el SHA completo.

La actividad vale 8 puntos. Los criterios son reproducción (2.5), controles de almacenamiento/logs/errores (2), pruebas de exposición (1.5), decisión técnica (1.5) y evidencia individual (0.5). El quiz semanal es individual y se califica por separado.
