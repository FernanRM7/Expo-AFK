export type MotivoNoDisponible = 'timeout' | 'rate-limited' | 'sin-conexion' | 'respuesta-invalida';

export type ResultadoProveedor =
    | Readonly<{ disponible: true; valor: unknown }>
    | Readonly<{ disponible: false; motivo: MotivoNoDisponible }>;


    export interface LocationProvider {
    resolve(consulta: string): Promise<ResultadoProveedor>;
}