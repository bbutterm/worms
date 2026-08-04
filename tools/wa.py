"""Утилиты для спрайтов Worms Armageddon.

В рипах нет альфа-канала: прозрачность закодирована индексом 0 палитры
(обычно RGB 128,128,192). Здесь — конвертация в честный RGBA.
"""
from PIL import Image


TRANSPARENT_INDEX = 0


def to_rgba(path, key_index=TRANSPARENT_INDEX):
    """PNG с палитрой -> RGBA, где пиксели key_index становятся прозрачными."""
    im = Image.open(path)
    if im.mode != 'P':
        return im.convert('RGBA')
    mask = im.point(lambda i: 0 if i == key_index else 255, mode='L')
    rgba = im.convert('RGBA')
    rgba.putalpha(mask)
    return rgba


def frames(path, fw=None, fh=None):
    """Вертикальная лента кадров -> список RGBA-кадров."""
    im = to_rgba(path)
    fw = fw or im.width
    fh = fh or fw
    return [im.crop((0, i * fh, fw, (i + 1) * fh)) for i in range(im.height // fh)]


def union_box(images):
    """Общий непустой прямоугольник по всем кадрам.

    Кропать все анимации одним боксом обязательно: иначе при смене
    анимации спрайт скакал бы относительно точки привязки.
    """
    box = None
    for im in images:
        b = im.getbbox()
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def strip(images, box=None):
    """Собрать кадры обратно в горизонтальную ленту (формат спрайтшита Phaser)."""
    if box:
        images = [im.crop(box) for im in images]
    w, h = images[0].size
    out = Image.new('RGBA', (w * len(images), h), (0, 0, 0, 0))
    for i, im in enumerate(images):
        out.paste(im, (i * w, 0))
    return out
