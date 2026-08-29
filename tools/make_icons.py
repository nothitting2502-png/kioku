#!/usr/bin/env python3
"""アプリアイコンを生成する（外部ライブラリ不要）。

    python3 tools/make_icons.py

icons/ に icon-192.png / icon-512.png / icon-maskable-512.png を作り直す。
"""
import struct
import zlib
from pathlib import Path

BG = (27, 42, 54)        # 藍墨 #1b2a36
FG = (246, 244, 239)     # 胡粉 #f6f4ef
ACCENT = (155, 182, 200)  # 淡藍 #9bb6c8

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"


def write_png(path, pixels, size):
    """pixels は (R, G, B, A) のタプルの二次元配列"""
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def blend(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, maskable=False):
    """濃紺の地に、静かな波形（細い線）を置いたアイコン"""
    radius = 0 if maskable else size * 0.22
    pad = size * (0.30 if maskable else 0.22)   # マスカブルは安全領域(中央80%)に収める
    heights = [0.30, 0.52, 0.78, 1.00, 0.66, 0.86, 0.44, 0.24]
    n = len(heights)
    span = size - pad * 2
    bar_w = span / (n * 3 - 2)      # 線を細く、間を広く取る
    cap = bar_w / 2
    cy = size / 2
    accent_index = 3

    grid = []
    for y in range(size):
        row = []
        for x in range(size):
            color = BG
            alpha = 255

            # 角丸（マスカブルは全面塗り）
            if radius:
                dx = min(x, size - 1 - x)
                dy = min(y, size - 1 - y)
                if dx < radius and dy < radius:
                    d = ((radius - dx) ** 2 + (radius - dy) ** 2) ** 0.5
                    if d > radius + 1:
                        row.append((0, 0, 0, 0))
                        continue
                    if d > radius:
                        alpha = round(255 * (radius + 1 - d))

            # 波形（両端を丸めた細い線）
            for i, h in enumerate(heights):
                bx = pad + i * bar_w * 3
                if not (bx <= x < bx + bar_w):
                    continue
                half = max(cap, span * h * 0.30)
                cx = bx + cap
                inside = False
                if cy - half + cap <= y <= cy + half - cap:
                    inside = True
                else:
                    ey = cy - half + cap if y < cy else cy + half - cap
                    inside = ((x + .5 - cx) ** 2 + (y + .5 - ey) ** 2) ** 0.5 <= cap
                if inside:
                    color = ACCENT if i == accent_index else FG
                break

            row.append(color + (alpha,))
        grid.append(row)
    return grid


def main():
    OUT.mkdir(exist_ok=True)
    for size, name, maskable in [
        (192, "icon-192.png", False),
        (512, "icon-512.png", False),
        (512, "icon-maskable-512.png", True),
    ]:
        write_png(OUT / name, make(size, maskable), size)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
