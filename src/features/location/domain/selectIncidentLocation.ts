import type { IncidentLocation } from '../../../campusops/contracts';

function esNumeroEnRango(valor: unknown, minimo: number, maximo: number): valor is number {
    return typeof valor === 'number' && Number.isFinite(valor) && valor >= minimo && valor <= maximo;
}

export function selectIncidentLocation(proveedor: unknown, etiquetaManual: string): IncidentLocation {
    if (typeof proveedor === 'object' && proveedor !== null && !Array.isArray(proveedor)) {
        const { label, latitude, longitude } = proveedor as Record<string, unknown>;
        if (
            typeof label === 'string' && label.trim().length > 0 &&
            esNumeroEnRango(latitude, -90, 90) &&
            esNumeroEnRango(longitude, -180, 180)
        ) {
            return { source: 'provider', label, latitude, longitude };
        }
    }
    return { source: 'manual', label: etiquetaManual };
}