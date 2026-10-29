"""测试用的合成图片：全部在内存里生成，不读任何外部文件。"""
import io
import random

from PIL import Image, ImageDraw

GPS_IFD = 0x8825
ORIENTATION = 0x0112


def picture(w, h, seed=1, mode='RGB'):
    rng = random.Random(seed)
    img = Image.new(mode, (w, h), (240, 240, 235) if mode == 'RGB' else (240, 240, 235, 0))
    draw = ImageDraw.Draw(img)
    for _ in range(30):
        x, y = rng.randrange(w), rng.randrange(h)
        color = (rng.randrange(40, 120), rng.randrange(80, 160), rng.randrange(150, 230))
        draw.ellipse([x, y, x + rng.randrange(10, max(11, w // 3)), y + rng.randrange(10, max(11, h // 3))],
                     fill=color if mode == 'RGB' else color + (255,))
    return img


def encode(img, fmt, **kw):
    out = io.BytesIO()
    img.save(out, fmt, **kw)
    return out.getvalue()


def jpeg_with_gps(w=1200, h=800, orientation=6):
    """存储方向是横的，EXIF Orientation=6 表示要顺时针转 90° 才是正的；另带一段 GPS 定位和相机信息。"""
    img = picture(w, h)
    exif = Image.Exif()
    exif[ORIENTATION] = orientation
    exif[0x010F] = 'SyntheticCam'
    exif[0x0110] = 'Model-X'
    exif.get_ifd(GPS_IFD).update({1: 'N', 2: (31.0, 13.0, 30.0), 3: 'E', 4: (121.0, 28.0, 10.0)})
    return encode(img, 'JPEG', quality=90, exif=exif.tobytes())


def png(w=600, h=400, alpha=False):
    return encode(picture(w, h, mode='RGBA' if alpha else 'RGB'), 'PNG')


def noisy_png(w, h, seed=7):
    rng = random.Random(seed)
    img = Image.frombytes('RGB', (w, h), bytes(rng.getrandbits(8) for _ in range(w * h * 3)))
    return encode(img, 'PNG', compress_level=1)


def webp(w=500, h=300):
    return encode(picture(w, h), 'WEBP', quality=80)


def gif(w=120, h=80):
    return encode(picture(w, h).convert('P'), 'GIF')


def bomb_png(side=10000):
    """1 位黑白、一亿像素，压缩后只有几十 KB。"""
    return encode(Image.new('1', (side, side)), 'PNG')


SVG = (b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
       b'<script>alert(1)</script><rect width="10" height="10"/></svg>')
HTML = '<!doctype html><html><head><title>示例作品</title></head><body><h1>合成示例</h1><iframe src="x.html"></iframe>' \
       '<script>console.log(1)</script></body></html>'.encode()
EXE = b'MZ\x90\x00\x03\x00\x00\x00' + bytes(200)
