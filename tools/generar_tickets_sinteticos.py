"""Genera tickets.csv sintético para tools/train_ticket_classifier.py.

Todo es ficticio: campus, edificios y reportes inventados. Sin datos reales.
Uso: python tools/generar_tickets_sinteticos.py [--por-categoria 60] [--salida tickets.csv]
"""

import argparse
import csv
import random
from pathlib import Path

CATEGORIAS = [
    "electrical", "laboratory", "water", "connectivity",
    "equipment", "safety", "maintenance",
]

LUGARES = [
    "el edificio A", "el edificio B", "el edificio C", "la biblioteca",
    "la cafetería", "el laboratorio 2", "el aula 204", "el aula 108",
    "el pasillo del segundo piso", "el estacionamiento norte", "la sala de maestros",
    "el taller de cómputo", "el auditorio", "la entrada principal",
]

TIEMPOS = [
    "desde ayer", "desde esta mañana", "desde hace dos días", "hoy en la tarde",
    "desde el lunes", "desde hace una hora", "esta semana", "otra vez hoy",
]

PLANTILLAS = {
    "electrical": [
        "No hay luz en {lugar}",
        "Se fue la corriente eléctrica en {lugar}",
        "Los contactos de {lugar} no funcionan",
        "Parpadean las lámparas en {lugar}",
        "Saltó el apagador principal en {lugar}",
        "Hay un cable suelto con chispas en {lugar}",
        "El regulador de voltaje de {lugar} huele a quemado",
        "Los focos de {lugar} están fundidos",
    ],
    "laboratory": [
        "La campana de extracción de {lugar} no enciende",
        "Faltan reactivos en el almacén de {lugar}",
        "El microscopio de {lugar} tiene el lente rayado",
        "La balanza analítica de {lugar} marca valores erráticos",
        "Se rompió material de vidrio en {lugar}",
        "El gabinete de reactivos de {lugar} no cierra bien",
        "La mesa de trabajo de {lugar} tiene la superficie dañada",
        "El autoclave de {lugar} no alcanza la temperatura",
    ],
    "water": [
        "Hay una fuga de agua en {lugar}",
        "No sale agua de las llaves en {lugar}",
        "Se tapó el drenaje en {lugar}",
        "El baño de {lugar} está inundado",
        "El bebedero de {lugar} gotea sin parar",
        "La presión del agua en {lugar} es muy baja",
        "Se rompió una tubería cerca de {lugar}",
        "El sanitario de {lugar} no descarga",
    ],
    "connectivity": [
        "No hay señal de wifi en {lugar}",
        "El internet de {lugar} está muy lento",
        "Se cae la conexión de red en {lugar}",
        "El punto de acceso de {lugar} no aparece",
        "No puedo conectarme a la red del campus en {lugar}",
        "El cable de red de {lugar} está desconectado",
        "El switch de {lugar} tiene las luces apagadas",
        "La red cableada de {lugar} no asigna dirección",
    ],
    "equipment": [
        "El proyector de {lugar} no enciende",
        "La computadora de {lugar} se queda congelada",
        "La impresora de {lugar} atasca el papel",
        "El pizarrón electrónico de {lugar} no responde al tacto",
        "El aire acondicionado de {lugar} no enfría",
        "El ventilador de {lugar} hace mucho ruido",
        "La bocina del equipo de audio de {lugar} está distorsionada",
        "El monitor de {lugar} muestra rayas",
    ],
    "safety": [
        "El extintor de {lugar} está vencido",
        "Hay un escalón roto que puede causar caídas en {lugar}",
        "La salida de emergencia de {lugar} está bloqueada",
        "Falta señalización de seguridad en {lugar}",
        "La alarma contra incendios de {lugar} no suena",
        "Hay vidrio roto en el piso de {lugar}",
        "La luz de emergencia de {lugar} no funciona",
        "Está resbaloso el piso de {lugar} y no hay aviso",
    ],
    "maintenance": [
        "Hay que pintar las paredes de {lugar}",
        "La puerta de {lugar} no cierra bien",
        "Las bancas de {lugar} están rotas",
        "El pasto de {lugar} necesita poda",
        "La ventana de {lugar} tiene el seguro roto",
        "Hay que reparar el techo de {lugar}",
        "Las sillas de {lugar} están flojas",
        "Se necesita limpieza profunda en {lugar}",
    ],
}

CIERRES = [
    "", "", "",
    ". Por favor revisen pronto",
    ". Es urgente",
    ". Ya se avisó antes",
    ". Gracias por la atención",
    ". Afecta a varios compañeros",
]


def generar(por_categoria: int, semilla: int) -> list[tuple[str, str]]:
    rng = random.Random(semilla)
    filas: list[tuple[str, str]] = []
    for categoria in CATEGORIAS:
        vistos: set[str] = set()
        intentos = 0
        while len(vistos) < por_categoria:
            intentos += 1
            if intentos > por_categoria * 200:
                raise RuntimeError(f"No hay combinaciones suficientes para {categoria}")
            base = rng.choice(PLANTILLAS[categoria]).format(lugar=rng.choice(LUGARES))
            mensaje = f"{base} {rng.choice(TIEMPOS)}{rng.choice(CIERRES)}".replace(" de el ", " del ")
            vistos.add(mensaje)
        filas.extend((mensaje, categoria) for mensaje in sorted(vistos))
    rng.shuffle(filas)
    return filas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--por-categoria", type=int, default=60)
    parser.add_argument("--semilla", type=int, default=42)
    parser.add_argument("--salida", type=Path, default=Path("tickets.csv"))
    args = parser.parse_args()

    filas = generar(args.por_categoria, args.semilla)
    with args.salida.open("w", newline="", encoding="utf-8") as archivo:
        escritor = csv.writer(archivo)
        escritor.writerow(["message", "category"])
        escritor.writerows(filas)
    print(f"Generado {args.salida} con {len(filas)} filas ({len(CATEGORIAS)} categorías).")


if __name__ == "__main__":
    main()