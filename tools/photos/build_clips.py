"""Builds the exercise clips the API serves from the clips that passed the review (tools/photos/clips.json):

    python -I tools/photos/build_clips.py --videos SRC_DIR --out OUT_DIR

Compiles transcode.swift and poster.swift with swiftc (into a temporary folder), then for each clip writes
OUT_DIR/<key>.mp4 (H.264 High 1280x720, about 2 Mbps, network-optimised, no audio, CIColorControls saturation .80
and contrast 1.05, cut to trimStart..trimEnd when given) and OUT_DIR/<key>.jpg (the colour frame at 50 %, or at
posterAt where the middle frame does not show the exercise; 960 px, q .72), and
OUT_DIR/manifest.json: the input of the API's `media:import-exercises --from OUT_DIR` (key, video, poster, rights,
source, width, height, durationSeconds per item), plus each clip's exercise name, suggested category, trim, sizes and
SHA-256 for review. Dropped clips are listed with their reason and are not transcoded.
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
GRADE = 'CIColorControls saturation 0.80, contrast 1.05'


def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def compile_tools(bin_dir):
    tools = {}
    for name in ('transcode', 'poster'):
        out = os.path.join(bin_dir, name)
        subprocess.run(['swiftc', '-O', '-suppress-warnings', os.path.join(HERE, f'{name}.swift'), '-o', out], check=True)
        tools[name] = out
    return tools


def clear_leftovers(path):
    # AVAssetWriter's network-optimised pass can leave its safe-save copy (<file>.sb-*) next to the output
    for extra in glob.glob(glob.escape(path) + '.sb-*'):
        os.remove(extra)


def main(argv):
    opts = dict(zip(argv[::2], argv[1::2]))
    if len(argv) % 2 or set(opts) != {'--videos', '--out'}:
        sys.exit(__doc__)
    src, out = opts['--videos'], opts['--out']
    with open(os.path.join(HERE, 'clips.json'), encoding='utf-8') as f:
        table = json.load(f)
    os.makedirs(out, exist_ok=True)
    bin_dir = tempfile.mkdtemp(prefix='bioptime-clips-')
    try:
        tools = compile_tools(bin_dir)
        items = []
        for clip in table['clips']:
            key = clip['key']
            video, poster = os.path.join(out, f'{key}.mp4'), os.path.join(out, f'{key}.jpg')
            cmd = [tools['transcode'], os.path.join(src, clip['file']), video]
            if clip.get('trimStart'):
                cmd += ['--start', str(clip['trimStart'])]
            if clip.get('trimEnd'):
                cmd += ['--end', str(clip['trimEnd'])]
            line = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.split()
            clear_leftovers(video)
            width, height = (int(v) for v in line[1].split('x'))
            seconds = round(float(line[2]), 3)
            at = str(clip.get('posterAt', 0.5))
            subprocess.run([tools['poster'], video, poster, '--at', at, '--width', '960', '--quality', '0.72'], check=True, capture_output=True)
            items.append({
                'key': key,
                'name': clip['name'],
                'category': clip['category'],
                'video': f'{key}.mp4',
                'poster': f'{key}.jpg',
                'width': width,
                'height': height,
                'durationSeconds': seconds,
                'trimStartSeconds': clip.get('trimStart', 0),
                'trimEndSeconds': clip.get('trimEnd'),
                'posterAt': clip.get('posterAt', 0.5),
                'bytes': os.path.getsize(video),
                'sha256': sha256(video),
                'posterBytes': os.path.getsize(poster),
                'posterSha256': sha256(poster),
                'rights': table['rights'],
                'source': table['source'].format(file=clip['file']),
            })
            print(f'{key:24} {seconds:5.2f} s  {items[-1]["bytes"] / 1048576:4.2f} MB  poster {items[-1]["posterBytes"] // 1024} KB')
    finally:
        shutil.rmtree(bin_dir, ignore_errors=True)
    manifest = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'rendition': f'H.264 High, 1280x720, about 2 Mbps, network-optimised, no audio; {GRADE}',
        'poster': 'colour JPEG, frame at 50 % of the clip, 960 px wide, quality 0.72',
        'items': items,
        'dropped': table['dropped'],
    }
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')
    total = sum(it['bytes'] + it['posterBytes'] for it in items)
    print(f'{len(items)} clips, {total / 1048576:.1f} MB; {len(table["dropped"])} dropped')


if __name__ == '__main__':
    main(sys.argv[1:])
