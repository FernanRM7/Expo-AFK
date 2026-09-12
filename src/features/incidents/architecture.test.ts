import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ_CARACTERISTICA = join(__dirname);

function importsEn(rutaArchivo: string): readonly string[] {
    const contenido = readFileSync(rutaArchivo, 'utf8');
    const coincidencias = [...contenido.matchAll(/from\s+['"]([^'"]+)['"]/g)];
    return coincidencias
        .map((coincidencia) => coincidencia[1])
        .filter((valor): valor is string => valor !== undefined);
}

function archivosEn(capa: string): readonly string[] {
    const directorio = join(RAIZ_CARACTERISTICA, capa);
    return readdirSync(directorio)
        .filter((nombre) => (nombre.endsWith('.ts') || nombre.endsWith('.tsx')) && !nombre.includes('.test.'))
        .map((nombre) => join(directorio, nombre));
}

describe('incidencias — límites de arquitectura', () => {
    test('domain no importa application, infrastructure, ui, ni react', () => {
        for (const archivo of archivosEn('domain')) {
            const prohibidos = importsEn(archivo).filter((ruta) =>
                /(^|\/)(application|infrastructure|ui)(\/|$)/.test(ruta) ||
                ruta === 'react' ||
                ruta.startsWith('react-native'),
            );
            expect({ archivo, prohibidos }).toEqual({ archivo, prohibidos: [] });
        }
    });

    test('application no importa infrastructure ni ui directamente', () => {
        for (const archivo of archivosEn('application')) {
            const prohibidos = importsEn(archivo).filter((ruta) =>
                /(^|\/)(infrastructure|ui)(\/|$)/.test(ruta),
            );
            expect({ archivo, prohibidos }).toEqual({ archivo, prohibidos: [] });
        }
    });

    test('ui no importa infrastructure directamente', () => {
        for (const archivo of archivosEn('ui')) {
            const prohibidos = importsEn(archivo).filter((ruta) =>
                /(^|\/)infrastructure(\/|$)/.test(ruta),
            );
            expect({ archivo, prohibidos }).toEqual({ archivo, prohibidos: [] });
        }
    });
});