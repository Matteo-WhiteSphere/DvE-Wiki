#!/usr/bin/env python3
"""Copies the ideology graphics of the mod into the wiki (needs Pillow: pip install pillow).

    python3 tools/convert-mod-icons.py ../2025-Dragon-Vs.-Eagle

- Icons: every sprite named GFX_ideology_<key> in the mod's interface/*.gfx is converted
  from .dds/.tga to images/ideologies/<key>.png (existing wiki icons are kept).
- Illustrations: gfx/texticons/ideologies/*.jpg (shown in game in the ideology
  descriptions) are copied to images/ideologies/art/<key>.jpg.
Run it before tools/sync-from-mod.mjs, which links the files it finds.
"""
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', '2025-Dragon-Vs.-Eagle'))
ICONS = os.path.join(ROOT, 'images', 'ideologies')
ART = os.path.join(ICONS, 'art')
SPRITE = re.compile(r'name\s*=\s*"?GFX_ideology_([A-Za-z0-9_]+?)(?:_icon)?"?\s+texturefile\s*=\s*"([^"]+)"', re.S)


def find(path):
    """Mod paths use forward slashes and are case-insensitive in game."""
    full = os.path.join(MOD, path.replace('\\', '/'))
    if os.path.exists(full):
        return full
    folder, name = os.path.split(full)
    if os.path.isdir(folder):
        for f in os.listdir(folder):
            if f.lower() == name.lower():
                return os.path.join(folder, f)
    return None


def main():
    if not os.path.exists(os.path.join(MOD, 'descriptor.mod')):
        sys.exit(f'Mod not found in {MOD}')
    os.makedirs(ART, exist_ok=True)
    added = 0
    for dirpath, _, files in os.walk(os.path.join(MOD, 'interface')):
        for f in files:
            if not f.endswith('.gfx'):
                continue
            text = open(os.path.join(dirpath, f), encoding='utf-8', errors='replace').read()
            for key, texture in SPRITE.findall(re.sub(r'#[^\n]*', '', text)):
                target = os.path.join(ICONS, key + '.png')
                source = find(texture)
                if os.path.exists(target) or not source:
                    continue
                try:
                    Image.open(source).convert('RGBA').save(target, optimize=True)
                    added += 1
                except Exception as e:  # unreadable texture: skip it
                    print(f'skip {source}: {e}')
    copied = 0
    art_dir = os.path.join(MOD, 'gfx', 'texticons', 'ideologies')
    if os.path.isdir(art_dir):
        for f in sorted(os.listdir(art_dir)):
            name, ext = os.path.splitext(f)
            if ext.lower() not in ('.jpg', '.jpeg', '.png', '.dds', '.tga'):
                continue
            img = Image.open(os.path.join(art_dir, f)).convert('RGB')
            img.save(os.path.join(ART, name + '.jpg'), quality=82, optimize=True)
            copied += 1
    print(f'Icons added: {added} · illustrations copied: {copied}')


if __name__ == '__main__':
    main()
