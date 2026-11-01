import { createLocationResolver } from './resolveIncidentLocation';
import type { LocationProvider, ResultadoProveedor } from '../domain/locationProvider';

function proveedorFalso(resultados: ResultadoProveedor[]) {
    const llamadas: string[] = [];
    const proveedor: LocationProvider = {
        async resolve(consulta) {
            llamadas.push(consulta);
            return resultados.shift() ?? { disponible: false, motivo: 'sin-conexion' };
        },
    };
    return { proveedor, llamadas };
}

const valido: ResultadoProveedor = {
    disponible: true,
    valor: { label: 'Edificio de prueba A', latitude: 0, longitude: 0 },
};

test('usa la ubicación del proveedor cuando es válida', async () => {
    const { proveedor } = proveedorFalso([valido]);
    const resultado = await createLocationResolver({ proveedor }).resolve('edificio a', 'Edificio manual');
    expect(resultado).toEqual({ source: 'provider', label: 'Edificio de prueba A', latitude: 0, longitude: 0 });
});

test('usa la alternativa manual con datos incompletos, sin inventar coordenadas', async () => {
    const { proveedor } = proveedorFalso([{ disponible: true, valor: { label: 'Zona ficticia' } }]);
    const resultado = await createLocationResolver({ proveedor }).resolve('zona', 'Edificio manual');
    expect(resultado).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect('latitude' in resultado).toBe(false);
    expect('longitude' in resultado).toBe(false);
});

test('usa la alternativa manual con coordenadas inválidas', async () => {
    const { proveedor } = proveedorFalso([
        { disponible: true, valor: { label: 'Inválida', latitude: 999, longitude: null } },
    ]);
    const resultado = await createLocationResolver({ proveedor }).resolve('zona', 'Edificio manual');
    expect(resultado).toEqual({ source: 'manual', label: 'Edificio manual' });
});

test.each(['timeout', 'rate-limited', 'sin-conexion', 'respuesta-invalida'] as const)(
    'usa la alternativa manual cuando el proveedor no está disponible (%s)',
    async (motivo) => {
        const { proveedor } = proveedorFalso([{ disponible: false, motivo }]);
        const resultado = await createLocationResolver({ proveedor }).resolve('zona', 'Edificio manual');
        expect(resultado).toEqual({ source: 'manual', label: 'Edificio manual' });
    },
);

test('usa la alternativa manual si el proveedor lanza una excepción', async () => {
    const proveedor: LocationProvider = {
        async resolve() {
            throw new Error('fallo sintético');
        },
    };
    const resultado = await createLocationResolver({ proveedor }).resolve('zona', 'Edificio manual');
    expect(resultado).toEqual({ source: 'manual', label: 'Edificio manual' });
});

test('la caché evita una segunda consulta con la misma búsqueda', async () => {
    const { proveedor, llamadas } = proveedorFalso([valido]);
    const resolutor = createLocationResolver({ proveedor });
    const primera = await resolutor.resolve('Edificio A', 'Edificio manual');
    const segunda = await resolutor.resolve('  edificio a ', 'Edificio manual');
    expect(segunda).toEqual(primera);
    expect(llamadas).toHaveLength(1);
});

test('la caché vence con el reloj controlado y vuelve a consultar', async () => {
    let reloj = 1000;
    const { proveedor, llamadas } = proveedorFalso([valido, valido]);
    const resolutor = createLocationResolver({ proveedor, ahora: () => reloj, ttlMs: 500 });
    await resolutor.resolve('edificio a', 'Edificio manual');
    reloj += 499;
    await resolutor.resolve('edificio a', 'Edificio manual');
    expect(llamadas).toHaveLength(1);
    reloj += 2;
    await resolutor.resolve('edificio a', 'Edificio manual');
    expect(llamadas).toHaveLength(2);
});

test('un fallo no se guarda en caché el siguiente intento vuelve a consultar', async () => {
    const { proveedor, llamadas } = proveedorFalso([{ disponible: false, motivo: 'timeout' }, valido]);
    const resolutor = createLocationResolver({ proveedor });
    expect((await resolutor.resolve('edificio a', 'Edificio manual')).source).toBe('manual');
    expect((await resolutor.resolve('edificio a', 'Edificio manual')).source).toBe('provider');
    expect(llamadas).toHaveLength(2);
});

test('una búsqueda vacía no consulta al proveedor', async () => {
    const { proveedor, llamadas } = proveedorFalso([valido]);
    const resultado = await createLocationResolver({ proveedor }).resolve('   ', 'Edificio manual');
    expect(resultado).toEqual({ source: 'manual', label: 'Edificio manual' });
    expect(llamadas).toHaveLength(0);
});