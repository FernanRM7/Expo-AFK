# Semana 4 — Preparar el repositorio y entregar la versión final

Continúen en el mismo repositorio y equipo. Integren los cambios previos en la rama principal registrada, copien el ZIP combinando carpetas e incluyendo `.github`, y no reinicien el proyecto ni borren trabajo anterior. Usen Node.js 22.22.0, npm, Git, GNU Make y Python 3.

## Evidencias

Todos los reportes incluyen `schemaVersion: 1`, `week: 4`, SHA completo, fecha ISO 8601 y `checks` con `id`, `status`, `scenarioType`, `command` y `evidence`. Incluyan por lo menos un escenario `boundary` o `failure` y resultados realmente observados.

`evidence/week-04/engineering.json` incluye la decisión, dos alternativas distintas, trade-off, AC-01 a AC-05 y verificaciones reproducibles. `individual.json` incluye `teamId` y exactamente tres registros con identificador institucional, SHA propio, archivo técnico, prueba o revisión, predicción, comando, resultado y explicación.

## Orden de entrega

1. Guarden el código/configuración/documentos y anoten `git rev-parse HEAD`.
2. Completen evidencias y ejecuten:

   ```bash
   make feedback
   make verify-week-04
   make public-test-week-04
   ```

3. Guarden reportes y evidencias en un commit que sólo modifique `reports/` y `evidence/`. Si cambió código, vuelvan a comprobar y actualizar los reportes.
4. Creen el tag y validen la evidencia:

   ```bash
   git tag -a week-04-final -m "DMI week 04 final"
   make evidence-week-04
   ```

5. Publiquen la rama y etiqueta, y consulten el SHA fijado:

   ```bash
   git push origin HEAD
   git push origin week-04-final
   git rev-list -n 1 week-04-final
   ```

Entreguen enlace del repositorio, `week-04-final` y SHA completo. No sobrescriban una etiqueta ya entregada sin autorización. Usen datos ficticios; no alteren pruebas/workflows para ocultar errores. Declaren la ayuda de IA material y cómo la verificaron.
