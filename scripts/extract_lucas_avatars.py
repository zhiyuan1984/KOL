"""Extract the nine Lucas avatars from the supplied vertical sprite strip.

Creates a lossless transparent PNG and a gently animated WebP for each avatar.
"""

from __future__ import annotations

import argparse
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops


AVATAR_COUNT = 9
CANVAS_SIZE = 96


def components(mask: Image.Image) -> list[list[tuple[int, int]]]:
    width, height = mask.size
    pixels = mask.load()
    seen: set[tuple[int, int]] = set()
    found: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            if not pixels[x, y] or (x, y) in seen:
                continue
            queue = deque([(x, y)])
            seen.add((x, y))
            component: list[tuple[int, int]] = []
            while queue:
                cx, cy = queue.popleft()
                component.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and pixels[nx, ny] and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            found.append(component)
    return found


def extract_avatar(strip: Image.Image, index: int) -> Image.Image:
    band_top = round(index * strip.height / AVATAR_COUNT)
    band_bottom = round((index + 1) * strip.height / AVATAR_COUNT)
    band = strip.crop((0, band_top, strip.width, band_bottom)).convert("RGBA")

    # The strip background is near-black. The sixth cell also contains a dark
    # rounded panel, so border-touching components are deliberately ignored.
    rgb = band.convert("RGB")
    foreground = Image.new("1", band.size)
    src = rgb.load()
    dst = foreground.load()
    for y in range(band.height):
        for x in range(band.width):
            r, g, b = src[x, y]
            dst[x, y] = max(r, g, b) >= 70

    candidates = []
    for component in components(foreground):
        xs = [point[0] for point in component]
        ys = [point[1] for point in component]
        touches_edge = min(xs) == 0 or max(xs) == band.width - 1 or min(ys) == 0 or max(ys) == band.height - 1
        if not touches_edge:
            candidates.append(component)
    if not candidates:
        raise RuntimeError(f"No avatar body found in band {index + 1}")

    body = max(candidates, key=len)
    xs = [point[0] for point in body]
    ys = [point[1] for point in body]
    bounds = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)

    # Fill holes in the body silhouette so the original black eyes remain.
    body_mask = Image.new("1", band.size)
    body_pixels = body_mask.load()
    for x, y in body:
        body_pixels[x, y] = 1
    local = body_mask.crop(bounds)
    outside = Image.new("1", local.size)
    local_pixels = local.load()
    outside_pixels = outside.load()
    queue: deque[tuple[int, int]] = deque()
    for x in range(local.width):
        queue.extend(((x, 0), (x, local.height - 1)))
    for y in range(local.height):
        queue.extend(((0, y), (local.width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < local.width and 0 <= y < local.height):
            continue
        if local_pixels[x, y] or outside_pixels[x, y]:
            continue
        outside_pixels[x, y] = 1
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    filled = ImageChops.invert(outside.convert("L"))

    avatar = band.crop(bounds)
    avatar.putalpha(filled)
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE))
    x = (CANVAS_SIZE - avatar.width) // 2
    y = (CANVAS_SIZE - avatar.height) // 2
    canvas.alpha_composite(avatar, (x, y))
    return canvas


def animated_frames(avatar: Image.Image, frame_count: int = 18) -> list[Image.Image]:
    bounds = avatar.getbbox()
    if bounds is None:
        return [avatar]
    subject = avatar.crop(bounds)
    frames: list[Image.Image] = []
    for frame_index in range(frame_count):
        phase = 2 * math.pi * frame_index / frame_count
        lift = round(-3 * math.sin(phase))
        squash = 1 - 0.025 * math.cos(phase)
        width = max(1, round(subject.width / squash))
        height = max(1, round(subject.height * squash))
        posed = subject.resize((width, height), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", avatar.size)
        x = (avatar.width - width) // 2
        y = (avatar.height - height) // 2 + lift
        frame.alpha_composite(posed, (x, y))
        frames.append(frame)
    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    strip = Image.open(args.source).convert("RGBA")
    args.output.mkdir(parents=True, exist_ok=True)
    for index in range(AVATAR_COUNT):
        avatar = extract_avatar(strip, index)
        name = f"Lucas{index + 1}"
        avatar.save(args.output / f"{name}.png", optimize=True)
        frames = animated_frames(avatar)
        frames[0].save(
            args.output / f"{name}.webp",
            save_all=True,
            append_images=frames[1:],
            duration=70,
            loop=0,
            lossless=True,
            method=6,
        )


if __name__ == "__main__":
    main()
