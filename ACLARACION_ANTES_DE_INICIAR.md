# Aclaración previa — Semana 2: arquitectura de CampusOps

Esta aclaración forma parte de las instrucciones de la actividad. **No cambia el cierre (14 de septiembre, 23:59), los 8 puntos, la rúbrica ni agrega entregables.** Su objetivo es precisar qué se espera para que puedan iniciar sin adivinar.

## El producto mínimo de esta semana

Al finalizar, su repositorio debe contener una app que abra una **lista** de incidencias sintéticas y permita abrir el **detalle** de una de ellas. La información puede vivir en memoria; no se requiere conectar el backend, iniciar sesión, persistir datos, pedir permisos ni implementar geolocalización todavía. Esos comportamientos pertenecen a hitos posteriores.

La lista/detalle sólo es el soporte para comprobar que el diseño no es un diagrama aislado. La decisión central es separar responsabilidades para que la UI no conozca los detalles de un proveedor, almacenamiento o transporte.

## Qué deben decidir y mostrar

Pueden elegir nombres de carpetas y patrones distintos; no se califica un árbol de archivos predeterminado. Su solución sí debe permitir identificar estos límites:

| Límite | Responsabilidad mínima esta semana | No corresponde todavía |
|---|---|---|
| UI | Pantallas de lista/detalle y presentación de datos | HTTP, DTO, almacenamiento o SDK externo directo |
| Aplicación | Caso de uso que pide la lista/detalle y coordina una abstracción | Reglas de pantalla o acceso directo a un proveedor |
| Dominio | Modelo/reglas de una incidencia y el contrato que necesita la aplicación | Importar UI, Expo, HTTP, almacenamiento o un SDK |
| Infraestructura | Fake determinista en memoria que satisface el contrato | Una integración real de red, base de datos o mapa |

La UI puede depender de aplicación; aplicación puede depender del contrato del dominio; infraestructura implementa ese contrato. Si su alternativa usa otro nombre, el ADR y el diagrama deben explicar la equivalencia. Los tres perfiles, incidencias, sesión, persistencia y ubicación se representan como responsabilidades o límites previstos; **no** deben programar sesión, permisos, cola offline ni el proveedor de ubicación en Semana 2.

## Secuencia de trabajo sugerida

1. Lean `docs/CAMPUSOPS.md` y escriban el ADR antes de reorganizar el código. El ADR debe tener, como mínimo: contexto, dos alternativas distintas, decisión, consecuencias y trade-off entre testabilidad, complejidad y cambio de proveedor. No comparen React Native, Expo o TypeScript: esos elementos ya están fijados.
2. Dibujen `docs/architecture.mmd`. Debe nombrar UI, application, domain e infrastructure, mostrar las dependencias permitidas y localizar incidencias, sesión, persistencia y ubicación. Incluyan una breve leyenda si usan nombres distintos.
3. Implementen el esqueleto de lista/detalle con datos sintéticos y una interfaz/puerto que permita sustituir el fake de infraestructura. Mantengan las pruebas y controles de Semana 1.
4. Comprueben imports y dependencias reales. Ejecuten las pruebas públicas y documenten en `reports/week-02/dependencies.json` al menos: una comprobación nominal del estado final y una comprobación de límite o falla. Cada una debe incluir comando, resultado observado y evidencia.
5. Registren la decisión del equipo en `evidence/week-02/engineering.json` y los tres aportes individuales en `evidence/week-02/individual.json`. Los campos obligatorios están enumerados en `docs/assignments/week-02-repository.md`, incluido en el ZIP semanal.

## La contradicción que pide AC-03

No deben entregar una app que conserve una dependencia prohibida. Realicen una comprobación controlada durante el desarrollo: por ejemplo, observen una importación directa UI → infraestructura, expliquen por qué contradice su ADR, sustitúyanla por el límite acordado y vuelvan a ejecutar el check. En `dependencies.json` conserven el **antes** (falla detectada) y el **después** (estado final correcto). La etiqueta `week-02-final` debe apuntar únicamente al estado corregido.

## Comprobación y entrega, sin ambigüedad

Antes de etiquetar, confirmen que los cinco archivos obligatorios no están vacíos y ejecuten:

```bash
make feedback
make verify-week-02
make public-test-week-02
```

Después guarden código, ADR, diagrama y evidencias en Git. Creen `week-02-final`, ejecuten `make evidence-week-02` y comprueben que la etiqueta apunta al mismo SHA que entregarán. Si el comando genera un reporte local después de etiquetar, no agreguen un nuevo commit de código ni muevan una etiqueta ya entregada. En Classroom entreguen sólo el enlace del repositorio, `week-02-final` y el SHA completo.

Una captura puede ayudar a explicar, pero no sustituye los archivos, reportes y comandos de esta actividad.
