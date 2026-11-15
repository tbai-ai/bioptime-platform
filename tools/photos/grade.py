"""bioptime-grade v1: the one photo grade every bundled app photo shares (PREMIUM.md section 2.3). Pillow only.

    python -I tools/photos/grade.py OUT.webp MASTER.jpg WIDTH dark|day edge|none [--aspect 1.5] [--focal 0.5,0.5]

The steps, in order: crop to the role's aspect around the focal point, Lanczos resize, desaturate with Rec. 709 luma
(the weights of CSS grayscale(1)), normalise levels (2nd percentile to 0, 98.5th to 1, then a gamma that puts the
median at .16 for the dark class or .40 for the day class), tone curve (black point #0A0A0A, shoulder at 214, so
blacks merge into the app's panels and nothing reaches white), warm-red split tone peaking in the mid-shadows,
vignette (corners -26 %), floor at 10, edge fade for headers and backdrops (bottom 30 % to #0A0A0A, top 10 % to
45 %), then monochrome grain (sigma 4 levels at 1080 px) so the fade does not band on OLED, floor at 8.

The grain comes from a seeded tile, so grading the same master twice gives the same bytes.
"""
import math
import random
import sys

from PIL import Image, ImageChops

GRADE = 'bioptime-grade v1'
TARGET_MEDIAN = {'dark': 0.16, 'day': 0.40}
# tone curve control points: input 0..1 -> output 0..255
CURVE = [(0.0, 10), (0.10, 16), (0.25, 42), (0.50, 112), (0.75, 176), (0.90, 202), (1.0, 214)]
FLOOR = 10
GRAIN_FLOOR = 8
GRAIN_SIGMA = 4.0
GRAIN_TILE = 512


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def curve(x):
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0)
            t = t * t * (3 - 2 * t) * 0.35 + t * 0.65  # a gentle S inside each segment
            return y0 + (y1 - y0) * t
    return CURVE[-1][1]


def percentile(hist, q):
    total = sum(hist)
    acc = 0
    for value, count in enumerate(hist):
        acc += count
        if acc >= q * total:
            return value
    return 255


def crop_to(im, aspect, focal):
    """The largest window of `aspect` (width / height) inside `im`, as close to centred on `focal` as the edges allow."""
    w, h = im.size
    if w / h > aspect:
        cw, ch = round(h * aspect), h
    else:
        cw, ch = w, round(w / aspect)
    left = min(max(round(focal[0] * w - cw / 2), 0), w - cw)
    top = min(max(round(focal[1] * h - ch / 2), 0), h - ch)
    return im.crop((left, top, left + cw, top + ch))


def tone_luts(luma, cls):
    """Three 256-entry LUTs (R, G, B) that take Rec. 709 luma to the graded, split-toned colour."""
    hist = luma.histogram()
    lo, hi = percentile(hist, 0.02), percentile(hist, 0.985)
    hi = max(hi, lo + 1)
    median = min(max((percentile(hist, 0.5) - lo) / (hi - lo), 0.02), 0.98)
    gamma = math.log(TARGET_MEDIAN[cls]) / math.log(median)
    reds, greens, blues = [], [], []
    for v in range(256):
        y = curve(min(max((v - lo) / (hi - lo), 0.0), 1.0) ** gamma)
        n = (y - 10) / 204.0
        shadow = math.exp(-((n - 0.28) / 0.22) ** 2)  # bell over shadows and lower mids
        highlight = smoothstep(0.6, 1.0, n)
        reds.append(min(255, round(y * (1 + 0.16 * shadow + 0.03 * highlight))))
        greens.append(min(255, round(y * (1 - 0.035 * shadow))))
        blues.append(min(255, round(y * (1 - 0.06 * shadow - 0.03 * highlight))))
    return reds, greens, blues


def vignette(size):
    mask = Image.new('L', (64, 64))
    px = mask.load()
    for j in range(64):
        for i in range(64):
            dx, dy = (i + 0.5) / 32 - 1, (j + 0.5) / 32 - 1
            r = math.sqrt(dx * dx + dy * dy) / math.sqrt(2)
            px[i, j] = round(255 * (1 - 0.26 * smoothstep(0.55, 1.0, r)))
    mask = mask.resize(size, Image.BICUBIC)
    return Image.merge('RGB', (mask, mask, mask))


def edge_fade(size):
    """Alpha of #0A0A0A over the photo: bottom 30 % eased to 100 %, top 10 % eased from 45 %."""
    ramp = Image.new('L', (1, 256))
    for j in range(256):
        y = j / 255
        ramp.putpixel((0, j), round(255 * max(smoothstep(0.70, 1.0, y), 0.45 * (1 - smoothstep(0.0, 0.10, y)))))
    return ramp.resize(size, Image.BICUBIC)


def grain(size, sigma, seed):
    """Gaussian noise centred on 128, tiled from one seeded square."""
    rng = random.Random(seed)
    tile = bytes(min(255, max(0, round(128 + rng.gauss(0, sigma)))) for _ in range(GRAIN_TILE * GRAIN_TILE))
    tile = Image.frombytes('L', (GRAIN_TILE, GRAIN_TILE), tile)
    noise = Image.new('L', size)
    for y in range(0, size[1], GRAIN_TILE):
        for x in range(0, size[0], GRAIN_TILE):
            noise.paste(tile, (x, y))
    return noise


def grade(master, width, cls, fade, aspect, focal, seed='bioptime'):
    """Grade a master (PIL image) into a `width`-wide RGB image of `aspect`, around `focal` (fractions 0..1)."""
    im = crop_to(master.convert('RGB'), aspect, focal)
    im = im.resize((width, round(width / aspect)), Image.LANCZOS)
    luma = im.convert('L', matrix=(0.2126, 0.7152, 0.0722, 0))
    reds, greens, blues = tone_luts(luma, cls)
    out = Image.merge('RGB', (luma.point(reds), luma.point(greens), luma.point(blues)))
    out = ImageChops.multiply(out, vignette(out.size))
    out = out.point(lambda v: max(v, FLOOR))
    if fade == 'edge':
        out = Image.composite(Image.new('RGB', out.size, (FLOOR, FLOOR, FLOOR)), out, edge_fade(out.size))
    noise = grain(out.size, GRAIN_SIGMA * math.sqrt(width / 1080), f'{seed}:{width}')
    out = ImageChops.add(out, Image.merge('RGB', (noise, noise, noise)), scale=1.0, offset=-128)
    return out.point(lambda v: max(v, GRAIN_FLOOR))


def save_webp(im, path, quality=72):
    # Pillow writes no EXIF or ICC unless asked, so the file is plain sRGB without metadata
    im.save(path, 'WEBP', quality=quality, method=6)


if __name__ == '__main__':
    args = sys.argv[1:]
    opts = {'--aspect': '1.5', '--focal': '0.5,0.5'}
    for key in list(opts):
        if key in args:
            i = args.index(key)
            opts[key] = args[i + 1]
            del args[i:i + 2]
    if len(args) != 5:
        sys.exit(__doc__)
    out, master, width, cls, fade = args
    fx, fy = (float(v) for v in opts['--focal'].split(','))
    with Image.open(master) as src:
        save_webp(grade(src, int(width), cls, fade, float(opts['--aspect']), (fx, fy)), out)
    print(out)
