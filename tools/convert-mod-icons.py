#!/usr/bin/env python3
"""Copies the ideology graphics of the mod into the wiki (needs Pillow and numpy: pip install pillow numpy).

    python3 tools/convert-mod-icons.py ../2025-Dragon-Vs.-Eagle

- Icons: every sprite named GFX_ideology_<key> in the mod's interface/*.gfx is converted
  from .dds/.tga to images/ideologies/<key>.png (existing wiki icons are kept).
- Illustrations: gfx/texticons/ideologies/*.jpg (shown in game in the ideology
  descriptions) are copied to images/ideologies/art/<key>.jpg.
- Illustrations built from the icon: the mod's picture for some sub-ideologies is not in the
  style of the others (the icon, centred on a dark background tinted with the colour of its
  ideology). For the keys of ICON_ART the wiki builds that standard illustration from the
  sub-ideology icon, on the background of a sibling illustration (same ideology).
Run it before tools/sync-from-mod.mjs, which links the files it finds.
"""
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', '2025-Dragon-Vs.-Eagle'))
ICONS = os.path.join(ROOT, 'images', 'ideologies')
ART = os.path.join(ICONS, 'art')
SPRITE = re.compile(r'name\s*=\s*"?GFX_ideology_([A-Za-z0-9_]+?)(?:_icon)?"?\s+texturefile\s*=\s*"([^"]+)"', re.S)


# sub-ideology -> sibling illustration whose background is reused
# marxism: the mod's picture is a full-size portrait of Marx and Engels; communism_vanguard: new icon
ICON_ART = {'marxism': 'scientific_socialism', 'communism_vanguard': 'scientific_socialism'}
ICON_SCALE = 2.0       # the icon is shown twice its size in the standard illustrations
ICON_OFFSET = (-1, 0)  # measured on the existing illustrations


def background_of(template):
    """Rebuilds the plain background of a standard illustration (without its icon): the
    brightness depends on the distance from the centre, plus the faint horizontal lines."""
    a = np.asarray(template.convert('RGB')).astype(float)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xs - w / 2) / w) ** 2 + ((ys - h / 2) / h) ** 2)
    mask = np.ones((h, w), bool)
    mask[36:196, 92:238] = False                      # where the icon is
    mask[0, :] = mask[-1, :] = mask[:, 0] = mask[:, -1] = False   # frame
    bins = np.linspace(0, r.max() + 1e-6, 41)
    idx = np.digitize(r, bins) - 1
    prof = np.zeros((41, 3))
    have = np.zeros(41, bool)
    for b in range(41):
        m = mask & (idx == b)
        if m.sum() > 30:
            prof[b] = np.median(a[m], axis=0)
            have[b] = True
    first = int(np.argmax(have))
    for b in range(41):
        if b < first:
            prof[b] = prof[first]
        elif not have[b]:
            prof[b] = prof[b - 1]
    bg = prof[idx]
    res = a - bg
    for k in range(3):                                # lines repeat every 3 rows
        rows = (np.arange(h) % 3 == k)[:, None] & mask
        bg[np.arange(h) % 3 == k] += res[rows].mean(axis=0)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = a[0, :], a[-1, :], a[:, 0], a[:, -1]
    return bg


def icon_art(key, template_key):
    template = Image.open(os.path.join(ART, template_key + '.jpg'))
    icon = Image.open(os.path.join(ICONS, key + '.png')).convert('RGBA')
    base = Image.fromarray(np.clip(background_of(template), 0, 255).astype('uint8')).convert('RGBA')
    big = icon.resize((round(icon.width * ICON_SCALE), round(icon.height * ICON_SCALE)), Image.LANCZOS)
    x = round((base.width - big.width) / 2 + ICON_OFFSET[0])
    y = round((base.height - big.height) / 2 + ICON_OFFSET[1])
    base.alpha_composite(big, (x, y))
    base.convert('RGB').save(os.path.join(ART, key + '.jpg'), quality=88, optimize=True)


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
    built = 0
    for key, template_key in ICON_ART.items():
        if os.path.exists(os.path.join(ICONS, key + '.png')) and os.path.exists(os.path.join(ART, template_key + '.jpg')):
            icon_art(key, template_key)
            built += 1
    print(f'Icons added: {added} · illustrations copied: {copied} · built from the icon: {built}')


if __name__ == '__main__':
    main()
