# ADR-001: Arquitectura feature-first híbrida para CampusOps

- **Estado:** Aceptada
- **Fecha:** 2026-09-09
- **Decisores:** Equipo CampusOps

## Contexto

CampusOps es una aplicación móvil para gestionar incidencias universitarias. El sistema debe crecer para cubrir reportes, asignaciones, operación sin conexión, sincronización, sesión, persistencia y ubicación. También debe conservar límites claros entre la interfaz, los casos de uso, las reglas de negocio y los proveedores externos.

La arquitectura debe permitir que el equipo pruebe las reglas sin depender de React Native, Expo, almacenamiento concreto, red o un proveedor de mapas. Además, debe facilitar cambios posteriores, como sustituir el proveedor de geocodificación o modificar la persistencia, sin rehacer las pantallas ni las reglas de incidencias.

Esta decisión no elige nuevamente React Native, Expo ni TypeScript. Esos elementos forman parte del stack establecido del proyecto.

## Alternativas consideradas

### Alternativa A: arquitectura global por capas

Toda la aplicación se organiza en capas comunes:

```text
src/
├── ui/
├── application/
├── domain/
└── infrastructure/
```

Las funcionalidades de incidencias, asignaciones, sincronización y ubicación se distribuyen dentro de esas capas.

**Ventajas:**

- Hace explícita la dirección general de dependencias.
- Es fácil explicar los límites UI → application → domain → infrastructure.
- Puede funcionar bien en una aplicación pequeña.

**Costos y riesgos:**

- Las piezas de una misma funcionalidad quedan dispersas en varios directorios.
- Es más fácil que una modificación mezcle responsabilidades de distintas funcionalidades.
- El crecimiento puede convertir las capas en directorios globales difíciles de mantener.
- Las pruebas y cambios de una funcionalidad requieren localizar archivos en varias capas.

### Alternativa B: organización feature-first con capas internas

La aplicación se organiza primero por capacidad del dominio. Cada capacidad mantiene las mismas capas internas:

```text
src/
├── features/
│   ├── incidents/
│   │   ├── ui/
│   │   ├── application/
│   │   ├── domain/
│   │   └── infrastructure/
│   ├── assignments/
│   │   ├── ui/
│   │   ├── application/
│   │   ├── domain/
│   │   └── infrastructure/
│   ├── sync/
│   │   ├── ui/
│   │   ├── application/
│   │   ├── domain/
│   │   └── infrastructure/
│   └── location/
│       ├── ui/
│       ├── application/
│       ├── domain/
│       └── infrastructure/
└── shared/
    ├── session/
    └── persistence/
```

**Ventajas:**

- Mantiene juntas las piezas de cada capacidad.
- Reduce el acoplamiento accidental entre funcionalidades.
- Permite probar una capacidad mediante sus casos de uso y dobles de sus puertos.
- Hace más localizado el cambio de un proveedor o una implementación.
- Conserva límites explícitos y repetibles dentro de cada funcionalidad.

**Costos y riesgos:**

- Requiere disciplina para no importar directamente infraestructura desde la UI.
- Puede producir duplicación si se crean utilidades compartidas sin una necesidad clara.
- Las dependencias entre funcionalidades deben pasar por contratos o servicios de aplicación bien definidos.
- La estructura inicial es más detallada que una carpeta global por capas.

## Decisión

Adoptamos una **arquitectura feature-first híbrida**. Las capacidades principales serán:

- `incidents`: creación, consulta, detalle y reglas del ciclo de vida de una incidencia.
- `assignments`: prioridad, asignación y reasignación de técnicos, respetando permisos y trazabilidad.
- `sync`: cola local, reintentos, idempotencia y tratamiento de conflictos de sincronización.
- `location`: captura manual de ubicación y futura integración con un servicio de mapas o geocodificación.

Cada capacidad tendrá internamente las capas `ui`, `application`, `domain` e `infrastructure`. La sesión y la persistencia serán **servicios compartidos**, porque varias funcionalidades necesitan autenticación, autorización, almacenamiento local y recuperación de datos.

La estructura compartida no elimina los límites de capas. Un servicio compartido debe exponer contratos estables y no permitir que las funcionalidades dependan directamente de detalles concretos del proveedor.

## Reglas de dependencia

Las dependencias deben apuntar hacia reglas y contratos más estables:

```text
ui → application → domain
                         ↑
                  infrastructure
```

En términos prácticos:

1. `ui` puede invocar casos de uso de `application` y transformar sus resultados en estados de pantalla.
2. `application` coordina casos de uso y depende de puertos definidos por `domain` o por la propia aplicación.
3. `domain` contiene reglas, entidades, valores y contratos; no importa React Native, Expo, almacenamiento ni clientes HTTP.
4. `infrastructure` implementa puertos para persistencia, red, ubicación y otros proveedores.
5. `ui` no importa directamente `infrastructure`.
6. Una funcionalidad no accede a los detalles internos de otra; la comunicación ocurre mediante contratos o casos de uso públicos.
7. `session` y `persistence` compartidos exponen interfaces y adaptadores, no clientes concretos a toda la aplicación.

## Cambio de proveedor de ubicación

En esta semana no se implementa una integración real con mapas o geocodificación. El diseño sólo establece un puerto que permita sustituir el proveedor más adelante:

```ts
export interface LocationProvider {
  resolve(query: string): Promise<LocationResult>;
}
```

`location/application` dependerá de ese contrato. Una implementación futura podrá usar un proveedor externo, mientras que las pruebas usarán un doble determinista con resultados de éxito, datos incompletos, timeout o error. Cambiar el proveedor no debe requerir modificar las pantallas ni las reglas de `incidents`.

La ubicación manual seguirá siendo una alternativa válida cuando el proveedor no esté disponible. Las credenciales, cuotas y decisiones concretas del proveedor se documentarán en el hito correspondiente, no se inventan como parte de este ADR.

## Estrategia de prueba y sustitución

La arquitectura se verificará sustituyendo adaptadores reales por dobles en los casos de uso. Por ejemplo, un caso de uso de ubicación puede recibir un `LocationProvider` determinista y comprobar que:

- una respuesta válida produce una ubicación utilizable;
- una respuesta incompleta permite continuar con captura manual;
- un timeout produce un error recuperable;
- la UI no necesita conocer qué proveedor respondió.

La misma estrategia se aplicará progresivamente a persistencia y sincronización: los casos de uso se probarán con repositorios o colas en memoria antes de conectarlos a una implementación concreta.

Esta sustitución demuestra testabilidad y también verifica que la dependencia está invertida correctamente. Si una pantalla necesita importar directamente un SDK de mapas o almacenamiento, la arquitectura se considera inconsistente y debe corregirse.

## Consecuencias

### Beneficios

- Las reglas de incidencias y asignaciones pueden probarse sin montar la UI.
- La sincronización puede evolucionar sin acoplar sus reglas a una librería de almacenamiento.
- La ubicación puede cambiar de proveedor mediante un adaptador.
- Las funcionalidades permanecen localizadas y son más fáciles de revisar por separado.
- La estructura refleja tanto los límites del dominio como los límites técnicos requeridos.

### Costos

- Hay más directorios y contratos que en una aplicación organizada únicamente por pantallas.
- El equipo debe decidir cuidadosamente qué pertenece a `shared` para evitar un módulo común excesivo.
- Se necesita mantener interfaces y dobles de prueba además de las implementaciones concretas.
- La sincronización y los conflictos siguen siendo complejos; la arquitectura los aísla, pero no elimina esa complejidad.

### Riesgos aceptados

Aceptamos la disciplina adicional y el costo inicial de los contratos porque el proyecto tendrá que soportar operación offline, cambio de proveedor, pruebas reproducibles y trazabilidad. Es preferible asumir esa estructura desde el inicio que permitir dependencias directas difíciles de retirar después.

## Relación con los requisitos de CampusOps

| Requisito | Decisión relacionada |
|---|---|
| Tres perfiles y permisos | `incidents`, `assignments` y el servicio compartido de `session` aíslan reglas de acceso de la UI. |
| Operación sin conexión | `sync` encapsula cola, reintentos, idempotencia y conflictos. |
| Persistencia recuperable | `persistence` compartido expone contratos para almacenamiento sustituible. |
| Ubicación con alternativa manual | `location` separa el puerto del proveedor y conserva captura manual. |
| Pruebas reproducibles | Casos de uso probados con dobles deterministas. |
| Cambio de proveedor | Adaptadores en `infrastructure` implementan contratos estables. |

## Estado y revisión

Esta decisión guía el diagrama, el esqueleto ejecutable y la prueba de dependencias de la semana 2. Podrá revisarse si la implementación demuestra que algún límite impide cumplir los requisitos, pero cualquier cambio deberá actualizar este ADR, el diagrama, el código y la evidencia relacionada de forma conjunta.
