"""生成 Lynel Desktop 方案 B 的 appicon.png"""
from PIL import Image, ImageDraw
import math
import struct
from io import BytesIO

SIZE = 1024
RADIUS = 225


def radial_gradient(w, h):
    img = Image.new('RGBA', (w, h))
    cx, cy = w * 0.35, h * 0.30
    max_dist = max(w, h) * 0.85
    for y in range(h):
        for x in range(w):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / max_dist
            t = min(1.0, dist)
            val = int(26 + (9 - 26) * t)
            img.putpixel((x, y), (val, val, val + 2, 255))
    return img


def linear_gradient(w, h, stops, angle=45):
    """stops: [(offset, (r,g,b,a)), ...]"""
    img = Image.new('RGBA', (w, h))
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    max_dist = max(w, h) * 1.414
    for y in range(h):
        for x in range(w):
            t = (x * dx + y * dy) / max_dist
            t = max(0.0, min(1.0, t))
            for i in range(len(stops) - 1):
                s1, c1 = stops[i]
                s2, c2 = stops[i + 1]
                if s1 <= t <= s2:
                    k = (t - s1) / (s2 - s1)
                    r = int(c1[0] + (c2[0] - c1[0]) * k)
                    g = int(c1[1] + (c2[1] - c1[1]) * k)
                    b = int(c1[2] + (c2[2] - c1[2]) * k)
                    a = int(c1[3] + (c2[3] - c1[3]) * k)
                    img.putpixel((x, y), (r, g, b, a))
                    break
    return img


def apply_gradient(mask, grad):
    result = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    result.paste(grad, (0, 0), mask)
    return result


def rounded_l_mask(size):
    """用两个圆角矩形拼出圆角 L"""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # 竖条
    draw.rounded_rectangle((280, 220, 440, 700), radius=40, fill=255)
    # 横条
    draw.rounded_rectangle((280, 620, 580, 740), radius=40, fill=255)
    return mask


def bubble_outline_mask(size, cx, cy, w, h, tail_dir, stroke):
    """生成会话气泡描边蒙版"""
    outer = Image.new('L', (size, size), 0)
    inner = Image.new('L', (size, size), 0)
    o_draw = ImageDraw.Draw(outer)
    i_draw = ImageDraw.Draw(inner)

    x1, y1 = cx - w // 2, cy - h // 2
    x2, y2 = cx + w // 2, cy + h // 2

    o_draw.rounded_rectangle((x1, y1, x2, y2), radius=40, fill=255)
    i_draw.rounded_rectangle((x1 + stroke, y1 + stroke, x2 - stroke, y2 - stroke), radius=32, fill=255)

    if tail_dir == 'left-down':
        # 尾巴指向左下
        o_draw.polygon([
            (x1 + 50, y2 - 30),
            (x1 - 30, y2 + 50),
            (x1 + 110, y2)
        ], fill=255)
        i_draw.polygon([
            (x1 + 50 + stroke, y2 - 30 - stroke // 2),
            (x1 + 10, y2 + 20),
            (x1 + 110 - stroke, y2 - stroke)
        ], fill=255)
    else:
        # 尾巴指向左上
        o_draw.polygon([
            (x1 + 50, y1 + 30),
            (x1 - 30, y1 - 50),
            (x1 + 110, y1)
        ], fill=255)
        i_draw.polygon([
            (x1 + 50 + stroke, y1 + 30 + stroke // 2),
            (x1 + 10, y1 - 20),
            (x1 + 110 - stroke, y1 + stroke)
        ], fill=255)

    outline = Image.new('L', (size, size), 0)
    for y in range(size):
        for x in range(size):
            v = outer.getpixel((x, y)) - inner.getpixel((x, y))
            outline.putpixel((x, y), max(0, min(255, v)))
    return outline


# 主画布
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

# 品牌渐变背景
brand_grad = linear_gradient(SIZE, SIZE, [
    (0.0, (124, 58, 237, 255)),
    (0.55, (59, 130, 246, 255)),
    (1.0, (6, 182, 212, 255))
], angle=45)
bg_mask = Image.new('L', (SIZE, SIZE), 0)
ImageDraw.Draw(bg_mask).rounded_rectangle((0, 0, SIZE, SIZE), radius=RADIUS, fill=255)
img.paste(brand_grad, (0, 0), bg_mask)

# 顶部高光
hl = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(hl).rounded_rectangle((180, 130, 844, 166), radius=18, fill=(255, 255, 255, 28))
img = Image.alpha_composite(img, hl)

# 白色 L
white = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 255))
l_img = apply_gradient(rounded_l_mask(SIZE), white)
img = Image.alpha_composite(img, l_img)

# 白色会话气泡
bubble1_mask = bubble_outline_mask(SIZE, 710, 360, 220, 160, 'left-down', 28)
bubble1 = apply_gradient(bubble1_mask, white)
img = Image.alpha_composite(img, bubble1)

white_fade = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 160))
bubble2_mask = bubble_outline_mask(SIZE, 710, 620, 220, 160, 'left-up', 28)
bubble2 = apply_gradient(bubble2_mask, white_fade)
img = Image.alpha_composite(img, bubble2)

import os

BUILD_DIR = os.path.dirname(os.path.abspath(__file__))

# 保存主 PNG
img.save(os.path.join(BUILD_DIR, 'appicon.png'))
print('build/appicon.png generated (1024x1024)')

def write_ico(path, images):
    """手动写入多尺寸 ICO（Pillow 的 append_images 对 ICO 无效）"""
    png_datas = []
    for im in images:
        buf = BytesIO()
        im.save(buf, format='PNG')
        png_datas.append(buf.getvalue())

    count = len(images)
    header = struct.pack('<HHH', 0, 1, count)
    entries = b''
    data = b''
    offset = 6 + 16 * count
    for im, png in zip(images, png_datas):
        w, h = im.size
        bw = 0 if w >= 256 else w
        bh = 0 if h >= 256 else h
        size = len(png)
        entries += struct.pack('<BBBBHHII', bw, bh, 0, 0, 1, 32, size, offset)
        data += png
        offset += size

    with open(path, 'wb') as f:
        f.write(header + entries + data)


# 生成 Windows icon.ico（多尺寸）
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_images = [img.resize((s, s), Image.Resampling.LANCZOS) for s in ico_sizes]
write_ico(os.path.join(BUILD_DIR, 'windows', 'icon.ico'), ico_images)
print('build/windows/icon.ico generated with sizes:', ico_sizes)


def generate_tray_icon():
    """生成高对比度托盘图标：紫色渐变圆角底 + 白色简化 L / 气泡，
    在 Windows 暗色/亮色任务栏都能看清。"""
    size = 64
    radius = 14
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # 背景：品牌渐变圆角矩形
    bg_grad = linear_gradient(size, size, [
        (0.0, (124, 58, 237, 255)),
        (0.55, (59, 130, 246, 255)),
        (1.0, (6, 182, 212, 255)),
    ], angle=45)
    bg_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    img.paste(bg_grad, (0, 0), bg_mask)

    # 白色 L（简化版）
    draw = ImageDraw.Draw(img)
    # 竖条
    draw.rounded_rectangle((16, 14, 26, 44), radius=4, fill=(255, 255, 255, 255))
    # 横条
    draw.rounded_rectangle((16, 34, 36, 44), radius=4, fill=(255, 255, 255, 255))

    # 右上角小气泡（暗示对话）
    draw.rounded_rectangle((38, 16, 50, 28), radius=5, fill=(255, 255, 255, 255))
    draw.polygon([(38, 26), (34, 32), (42, 28)], fill=(255, 255, 255, 255))

    img.save(os.path.join(BUILD_DIR, 'trayicon.png'))
    tray_sizes = [16, 24, 32, 48, 64]
    tray_ico_images = [img.resize((s, s), Image.Resampling.LANCZOS) for s in tray_sizes]
    write_ico(os.path.join(BUILD_DIR, 'windows', 'trayicon.ico'), tray_ico_images)
    print('build/trayicon.png and build/windows/trayicon.ico generated')


generate_tray_icon()
