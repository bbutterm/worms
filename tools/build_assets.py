#!/usr/bin/env python3
"""Сборка игровых ассетов из рипов Worms Armageddon.

Вход:  assets/raw/general/  и  assets/raw/terrain/Terrain/  (распакованные архивы)
Выход: assets/*.png, assets/terrain/<тема>/*.png и src/core/sprite-meta.js

Что делает:
  • переводит палитровые PNG в RGBA (индекс 0 палитры = прозрачность);
  • режет вертикальные ленты кадров и собирает их в горизонтальные
    спрайтшиты, которые умеет грузить Phaser;
  • кропает все анимации червяка ОДНИМ общим боксом, иначе спрайт
    прыгал бы при смене анимации;
  • выписывает размеры кадров и точку привязки ног в sprite-meta.js,
    чтобы игра не хранила эти числа руками.

Запуск:  python3 tools/build_assets.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image
from wa import frames, strip, to_rgba, union_box

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_GEN = os.path.join(ROOT, 'assets', 'raw', 'general')
RAW_TER = os.path.join(ROOT, 'assets', 'raw', 'terrain', 'Terrain')
OUT = os.path.join(ROOT, 'assets')
META_JS = os.path.join(ROOT, 'src', 'core', 'sprite-meta.js')

# Темы ландшафта, которые едут в игру. Ключ -> папка в рипе.
THEMES = {
    'jungle': 'Jungle',
    'desert': 'Desert',
    'snow': 'Snow',
    'hell': 'Hell',
    'forest': 'Forest',
    'urban': 'Manhattan',
}

# Анимации червяка: имя -> (файл, кадров)
WORM_ANIMS = {
    'idle': ('wbrth1.png', 20),
    'walk': ('wwalk.png', 15),
    'fall': ('wfall.png', 2),
}

# Снаряды: ключ -> (файл, размер кадра, сколько кадров, до скольких px ужать)
PROJECTILES = {
    'proj_bazooka': ('missile.png', 60, 32, None),
    'proj_grenade': ('grenade.png', 60, 32, None),
    'proj_cluster': ('cluster.png', 60, 32, None),
    'proj_bomblet': ('clustlet.png', 60, 6, None),
    'proj_mole': ('mbbomb.png', 100, 10, 30),   # крот-бомба нарисована крупно
    'proj_banana': ('banana.png', 60, 32, None),
    'proj_holy': ('hgrenade.png', 60, 32, None),
    # Динамит нарисован длинной лентой горения — берём начало, дальше
    # кадры повторяются и на экране разницы не видно
    'proj_dynamite': ('dynamite.png', 60, 20, None),
    'proj_mine': ('mineoff.png', 60, 12, None),
    'proj_mine_on': ('mineon.png', 60, 12, None),
    'proj_airmissile': ('airmisl.png', 60, 32, None),
    'proj_mortar': ('mortar.png', 60, 32, None),
}

ICONS = {
    'icon_bazooka': 'bazooka.1.png',
    'icon_grenade': 'grenade.1.png',
    'icon_cluster': 'cluster.1.png',
    'icon_mole': 'mole.1.png',
    'icon_banana': 'banana.1.png',
    'icon_holy': 'hgrenade.1.png',
    'icon_dynamite': 'dynamite.1.png',
    'icon_mine': 'mine.1.png',
    'icon_airstrike': 'airstrke.1.png',
    'icon_shotgun': 'shotgun.1.png',
    'icon_bat': 'baseball.1.png',
    'icon_teleport': 'teleport.1.png',
    'icon_mortar': 'mortar.1.png',
}

meta = {}


def gen(*parts):
    return os.path.join(RAW_GEN, *parts)


def save(img, name):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def build_worm():
    """Все анимации червяка одним общим боксом + смещение ног."""
    per_anim = {name: frames(gen('Worms', f), 60, 60)[:n]
                for name, (f, n) in WORM_ANIMS.items()}

    # Общий бокс по всем анимациям — иначе спрайт скачет при смене анимации
    box = union_box([f for fr in per_anim.values() for f in fr])
    # Линия ног = низ бокса анимаций стояния (в падении червяк вытянут ниже)
    stand_box = union_box(per_anim['idle'] + per_anim['walk'])
    feet_y = stand_box[3] - box[1]

    fw = box[2] - box[0]
    fh = box[3] - box[1]
    for name, fr in per_anim.items():
        save(strip(fr, box), f'worm_{name}.png')
        meta[f'worm_{name}'] = {'frameWidth': fw, 'frameHeight': fh, 'frames': len(fr)}

    meta['worm'] = {'frameWidth': fw, 'frameHeight': fh, 'feetY': feet_y,
                    'originY': round(feet_y / fh, 5)}
    print(f'  червяк: кадр {fw}x{fh}, ноги на y={feet_y} (origin {feet_y / fh:.3f})')


def build_markers():
    """Маркер активного бойца и надгробие."""
    # arrowdn* — пульсирующая стрелка над активным бойцом из оригинала
    for key, src in [('marker_0', 'arrowdnr.png'), ('marker_1', 'arrowdnb.png')]:
        fr = frames(gen('Misc', src), 60, 60)
        box = union_box(fr)
        save(strip(fr, box), f'{key}.png')
        meta[key] = {'frameWidth': box[2] - box[0], 'frameHeight': box[3] - box[1],
                     'frames': len(fr)}
    grave = frames(gen('Misc', 'grave1.png'), 60, 60)
    box = union_box(grave[:1])
    save(grave[0].crop(box), 'grave.png')

    # Ящики: оружейный, аптечка и «утилита». Кадр один — они не анимированы,
    # но в ленте лежат вместе с вариантами, поэтому берём первый.
    for key, src in [('crate_weapon', 'wcrate0.png'), ('crate_health', 'mcrate0.png'),
                     ('crate_util', 'ucrate0.png')]:
        fr = frames(gen('Misc', src), 60, 60)
        save(fr[0].crop(union_box(fr[:1])), f'{key}.png')

    # Парашют — он же кадр «ящик спускается»
    chute = frames(gen('Misc', 'wcratev.png'), 60, 60)
    save(chute[0].crop(union_box(chute[:1])), 'crate_chute.png')

    # Червяк на парашюте (десант в начале боя). Один кадр: покачивание
    # делает игра поворотом, а не лентой из 17 кадров
    para = frames(gen('Worms', 'wparacht.png'), 90, 90)
    save(para[0].crop(union_box(para)), 'worm_chute.png')

    # Прицел: берём один кадр, вращать его не нужно
    for key, src in [('crosshair_0', 'crshairr.png'), ('crosshair_1', 'crshairb.png')]:
        fr = frames(gen('Misc', src), 60, 60)
        save(fr[0].crop(union_box(fr[:1])), f'{key}.png')

    print('  маркеры, надгробие и прицел готовы')


def build_projectiles():
    for key, (src, size, count, target) in PROJECTILES.items():
        fr = frames(gen('Weapons', src), size, size)[:count]
        box = union_box(fr)
        # Бокс симметричен относительно центра кадра: снаряд вращается
        # вокруг своего центра, и обрезка не должна его смещать
        c = size / 2
        r = max(c - box[0], box[2] - c, c - box[1], box[3] - c)
        box = (int(c - r), int(c - r), int(c + r), int(c + r))
        fr = [f.crop(box) for f in fr]
        if target and fr[0].width > target:
            fr = [f.resize((target, target), Image.LANCZOS) for f in fr]
        save(strip(fr), f'{key}.png')
        meta[key] = {'frameWidth': fr[0].width, 'frameHeight': fr[0].height,
                     'frames': len(fr)}
        print(f'  {key}: {len(fr)} кадров {fr[0].width}x{fr[0].height}')


def build_effects():
    flash = frames(gen('Effects', 'circl100.png'), 200, 200)
    box = union_box(flash)
    save(strip(flash, box), 'fx_flash.png')
    meta['fx_flash'] = {'frameWidth': box[2] - box[0], 'frameHeight': box[3] - box[1],
                        'frames': len(flash)}

    smoke = frames(gen('Effects', 'smklt100.png'), 134, 134)
    box = union_box(smoke)
    c = 67
    r = max(c - box[0], box[2] - c, c - box[1], box[3] - c)
    box = (int(c - r), int(c - r), int(c + r), int(c + r))
    save(strip(smoke, box), 'fx_smoke.png')
    meta['fx_smoke'] = {'frameWidth': box[2] - box[0], 'frameHeight': box[3] - box[1],
                        'frames': len(smoke)}
    print(f'  эффекты: вспышка {len(flash)} кадров, дым {len(smoke)} кадров')


def build_icons():
    for key, src in ICONS.items():
        path = gen('Weapon Icons', src)
        if not os.path.exists(path):
            print(f'  ! нет иконки {src}, пропускаю {key}')
            continue
        save(to_rgba(path), f'{key}.png')
    print('  иконки оружия готовы')


# Тайлящаяся ширина текстур в формате WA: всё, что правее, — служебные
# блоки для вертикальных кромок, и в бесшовный повтор они не годятся.
TILE_W = 128


def crop_grass(im):
    """Полоса верхнего слоя: 128 px по ширине + только непустые строки.

    В исходнике полоса вертикально «плавает» внутри кадра (у джунглей,
    например, занята лишь середина 64-пиксельной картинки).
    """
    im = im.crop((0, 0, TILE_W, im.height))
    px = im.load()
    rows = [sum(1 for x in range(TILE_W) if px[x, y][3] > 0) for y in range(im.height)]
    thresh = TILE_W * 0.2
    top = next((y for y, n in enumerate(rows) if n >= thresh), 0)
    bottom = next((y for y in range(im.height - 1, -1, -1) if rows[y] >= thresh), im.height - 1)
    return im.crop((0, top, TILE_W, bottom + 1))


def build_terrain():
    for key, folder in THEMES.items():
        src = os.path.join(RAW_TER, folder)
        if not os.path.isdir(src):
            print(f'  ! нет темы {folder}')
            continue

        soil = to_rgba(os.path.join(src, 'soil.png'))
        save(soil, f'terrain/{key}/soil.png')

        grass = crop_grass(to_rgba(os.path.join(src, 'grass.png')))
        save(grass, f'terrain/{key}/grass.png')

        back = to_rgba(os.path.join(src, 'back.png'))
        save(back, f'terrain/{key}/back.png')

        # Градиент неба 8x~900: в игре растягивается на весь экран
        sky = to_rgba(os.path.join(src, 'gradient.png'))
        save(sky, f'terrain/{key}/sky.png')

        meta[f'terrain_{key}'] = {
            'grassW': grass.width, 'grassH': grass.height,
            'soilW': soil.width, 'soilH': soil.height,
            'backW': back.width, 'backH': back.height,
            'skyH': sky.height,
        }
        print(f'  тема {key:8} трава {grass.width}x{grass.height}  '
              f'фон {back.width}x{back.height}')


def write_meta():
    body = json.dumps(meta, indent=2, ensure_ascii=False)
    with open(META_JS, 'w', encoding='utf-8') as f:
        f.write('// СГЕНЕРИРОВАНО tools/build_assets.py — руками не править.\n')
        f.write('// Размеры кадров спрайтшитов и точка привязки ног червяка.\n')
        f.write(f'export const SPRITE_META = {body};\n')
    print(f'\nsrc/core/sprite-meta.js обновлён ({len(meta)} записей)')


if __name__ == '__main__':
    if not os.path.isdir(RAW_GEN) or not os.path.isdir(RAW_TER):
        sys.exit('Нет распакованных рипов в assets/raw/ — распакуйте архивы.')
    print('Червяк:');       build_worm()
    print('Маркеры:');      build_markers()
    print('Снаряды:');      build_projectiles()
    print('Эффекты:');      build_effects()
    print('Иконки:');       build_icons()
    print('Ландшафт:');     build_terrain()
    write_meta()
