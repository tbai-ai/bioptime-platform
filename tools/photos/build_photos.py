"""Builds the app's bundled photos from their masters (run with the P4 venv's Pillow, isolated):

    python -I tools/photos/build_photos.py --masters DIR [DIR ...] [--only ID[,ID...]] [--sheet OUT.jpg]

tools/photos/photos.json lists every photo: its id (the master is <id>.jpg in one of the --masters folders), class
(dark or day: the median the grade aims for), fade (edge for headers, backdrops and card tops; none otherwise), focal
point, alt text, whether it shows people, and its credit. For each photo this writes, into apps/mobile/assets/photos:

    <id>-1080.webp and <id>-1600.webp   graded with bioptime-grade v1 (grade.py), WebP q72; landscape 3:2, the
                                        sign-in backdrop portrait 2:3
    <id>-64.webp                        the graded 1080 file scaled to 64 px wide (blur-up and entrance layers)

then CREDITS.json (one record per photo with its three files) and src/fx/media/photos.generated.ts (manifest.py).
WebP files in the folder that the table no longer lists are removed. --only grades just those ids but still rewrites
the credits and the manifest from the whole table. --sheet also writes a contact sheet of the graded 1080 files.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script's folder off the path
import grade  # noqa: E402
import manifest  # noqa: E402

ASPECT = {'landscape': 3 / 2, 'portrait': 2 / 3}
EDITS = f'{grade.GRADE} (greyscale, tone curve, warm split tone, vignette, grain); crop; resize'


def find_master(dirs, pid):
    for d in dirs:
        path = os.path.join(d, f'{pid}.jpg')
        if os.path.isfile(path):
            return path
    sys.exit(f'no master for {pid} in {", ".join(dirs)}')


def files_for(pid):
    return [f'{pid}-{w}.webp' for w in manifest.WIDTHS]


def build_one(photo, master_path):
    pid = photo['id']
    aspect = ASPECT[photo['orientation']]
    focal = tuple(photo['focal'])
    with Image.open(master_path) as master:
        master.load()
        graded = {}
        for width in (1080, 1600):
            graded[width] = grade.grade(master, width, photo['class'], photo['fade'], aspect, focal, seed=pid)
            grade.save_webp(graded[width], os.path.join(manifest.ASSETS, f'{pid}-{width}.webp'))
    small = graded[1080].resize((64, round(64 / aspect)), Image.LANCZOS)
    grade.save_webp(small, os.path.join(manifest.ASSETS, f'{pid}-64.webp'), quality=60)
    sizes = [os.path.getsize(os.path.join(manifest.ASSETS, f)) for f in files_for(pid)]
    print(f'{pid:24} ' + '  '.join(f'{s // 1024:4d} KB' for s in sizes))


def write_credits(table):
    records = []
    for p in table['photos']:
        c = p['credit']
        records.append({
            'id': p['id'],
            'files': files_for(p['id']),
            'source': c['source'],
            'photoId': c['photoId'],
            'url': c['url'],
            'author': c['author'],
            'authorUrl': c['authorUrl'],
            'licence': c['licence'],
            'downloaded': table['downloaded'],
            'edits': EDITS,
            'alt': p['alt'],
        })
    with open(os.path.join(manifest.ASSETS, 'CREDITS.json'), 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        f.write('\n')


def remove_stale(table):
    keep = {name for p in table['photos'] for name in files_for(p['id'])}
    for name in sorted(os.listdir(manifest.ASSETS)):
        if name.endswith('.webp') and name not in keep:
            os.remove(os.path.join(manifest.ASSETS, name))
            print('removed', name)


def contact_sheet(table, out, cols=5, tile=(360, 240)):
    photos = table['photos']
    rows = (len(photos) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tile[0], rows * (tile[1] + 18)), (0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    for i, p in enumerate(photos):
        with Image.open(os.path.join(manifest.ASSETS, f'{p["id"]}-1080.webp')) as im:
            im = im.convert('RGB')
            im.thumbnail((tile[0] - 6, tile[1] - 6))
            x, y = (i % cols) * tile[0], (i // cols) * (tile[1] + 18)
            sheet.paste(im, (x + 3, y + 3))
        draw.text((x + 4, y + tile[1] + 2), f'{p["id"]}  {p["class"]}/{p["fade"]}', fill=(200, 200, 200))
    sheet.save(out, quality=88)
    print('sheet', out)


def main(argv):
    masters, only, sheet = [], None, None
    i = 0
    while i < len(argv):
        if argv[i] == '--masters':
            i += 1
            while i < len(argv) and not argv[i].startswith('--'):
                masters.append(argv[i])
                i += 1
            continue
        if argv[i] == '--only' and i + 1 < len(argv):
            only = set(argv[i + 1].split(','))
        elif argv[i] == '--sheet' and i + 1 < len(argv):
            sheet = argv[i + 1]
        else:
            sys.exit(__doc__)
        i += 2
    if not masters:
        sys.exit(__doc__)
    table = manifest.load_table()
    ids = [p['id'] for p in table['photos']]
    if len(set(ids)) != len(ids):
        sys.exit('duplicate ids in photos.json')
    if only and not only <= set(ids):
        sys.exit(f'unknown ids: {", ".join(sorted(only - set(ids)))}')
    os.makedirs(manifest.ASSETS, exist_ok=True)
    for photo in table['photos']:
        if only is None or photo['id'] in only:
            build_one(photo, find_master(masters, photo['id']))
    if only is None:
        remove_stale(table)
    write_credits(table)
    print(manifest.write(table))
    total = sum(os.path.getsize(os.path.join(manifest.ASSETS, n)) for n in os.listdir(manifest.ASSETS) if n.endswith('.webp'))
    print(f'{len(ids)} photos, {total / 1024 / 1024:.2f} MB of WebP')
    if sheet:
        contact_sheet(table, sheet)


if __name__ == '__main__':
    main(sys.argv[1:])
