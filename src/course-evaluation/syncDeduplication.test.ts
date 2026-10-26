import { deduplicateOperations } from './index';

test('conserva la primera operación de cada identidad sin mutar la entrada', () => {
    const operaciones = Object.freeze([
        Object.freeze({ operationId: 'op-1', value: 'primera' }),
        Object.freeze({ operationId: 'op-1', value: 'repetida' }),
        Object.freeze({ operationId: 'op-2', value: 'otra' }),
    ]);
    const antes = JSON.stringify(operaciones);

    const resultado = deduplicateOperations(operaciones);

    expect(resultado).toEqual([operaciones[0], operaciones[2]]);
    expect(resultado[0]).toBe(operaciones[0]);
    expect(operaciones).toHaveLength(3);
    expect(JSON.stringify(operaciones)).toBe(antes);
});