#!/usr/bin/env python3
"""Generates the tenant app's home-screen icons into apps/web/public/.

Run: python3 scripts/make-icons.py

Hand-rolled PNG writing rather than Pillow, which is not a dependency of this
repo and would be one more thing to install on a machine that only needs to
regenerate three small squares. The mark is drawn from rectangles: a white
block of flats on Style A's --primary (#2563EB), full-bleed so iOS (which
renders transparency as black) and Android's maskable crop both behave.

Sizes: 192 and 512 for the web manifest, 180 for apple-touch-icon.
"""
import struct
import zlib
from pathlib import Path

BG = (0x25, 0x63, 0xEB)
FG = (0xFF, 0xFF, 0xFF)
OUT = Path(__file__).resolve().parent.parent / 'apps' / 'web' / 'public'


def draw(size: int) -> bytearray:
    px = bytearray()
    u = size / 100.0  # work in percent of the icon, so every size is identical

    def rect(x0, y0, x1, y1):
        return (x0 * u, y0 * u, x1 * u, y1 * u)

    # The mark sits inside the central 60%: Android crops a maskable icon to a
    # circle inscribed in the middle 80%, and a building touching the edge
    # would lose its roof on some launchers.
    body = rect(26, 28, 74, 76)
    windows = [
        rect(33 + col * 13, 36 + row * 13, 41 + col * 13, 44 + row * 13)
        for row in range(2)
        for col in range(3)
    ]
    door = rect(45, 62, 55, 76)

    def inside(x, y, r):
        return r[0] <= x < r[2] and r[1] <= y < r[3]

    for y in range(size):
        px.append(0)  # PNG filter byte: none
        for x in range(size):
            colour = BG
            if inside(x, y, body):
                colour = FG
                if any(inside(x, y, w) for w in windows) or inside(x, y, door):
                    colour = BG
            px.extend(colour)
    return px


def png(size: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(draw(size)), 9))
            + chunk(b'IEND', b''))


for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    (OUT / name).write_bytes(png(size))
    print(f'{name}  {size}x{size}')
