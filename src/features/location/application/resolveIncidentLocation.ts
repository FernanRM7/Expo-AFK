import type { IncidentLocation } from '../../../campusops/contracts';
import type { LocationProvider } from '../domain/locationProvider';
import { selectIncidentLocation } from '../domain/selectIncidentLocation';

const TTL_POR_DEFECTO_MS = 10 * 60 * 1000;

type EntradaCache = Readonly<{ ubicacion: IncidentLocation; venceEn: number }>;

export type DependenciasResolutor = Readonly<{
    proveedor: LocationProvider;
    ahora?: () => number;
    ttlMs?: number;
}>;

export function createLocationResolver(dependencias: DependenciasResolutor) {
    const ahora = dependencias.ahora ?? (() => Date.now());
    const ttlMs = dependencias.ttlMs ?? TTL_POR_DEFECTO_MS;
    const cache = new Map<string, EntradaCache>();

    return {
        async resolve(consulta: string, etiquetaManual: string): Promise<IncidentLocation> {
            const clave = consulta.trim().toLowerCase();
            if (clave.length === 0) return { source: 'manual', label: etiquetaManual };

            const guardada = cache.get(clave);
            if (guardada && guardada.venceEn > ahora()) return guardada.ubicacion;
            cache.delete(clave);

            let ubicacion: IncidentLocation;
            try {
                const resultado = await dependencias.proveedor.resolve(consulta.trim());
                ubicacion = resultado.disponible
                    ? selectIncidentLocation(resultado.valor, etiquetaManual)
                    : { source: 'manual', label: etiquetaManual };
            } catch {
                ubicacion = { source: 'manual', label: etiquetaManual };
            }

            if (ubicacion.source === 'provider') {
                cache.set(clave, { ubicacion, venceEn: ahora() + ttlMs });
            }
            return ubicacion;
        },
    };
}