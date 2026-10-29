"""图片和 HTML 文件的纯处理函数：按文件头判类型、防解压炸弹、转正、去元数据重编码、衍生图、主色、模糊小图。
不碰数据库和存储，方便单测和压测。"""
import base64
import io
import warnings
from dataclasses import dataclass, field

from PIL import Image, ImageOps, features

MAX_PIXELS = 40_000_000
MAX_SIDE = 20000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
WIDTHS = (320, 640, 1280, 2048)
AVATAR_SIZES = (64, 128, 256)
BLUR_WIDTH = 16
ICC_MAX = 64 * 1024
AVIF = features.check('avif')
FORMATS = (('webp', 'WEBP', {'quality': 80, 'method': 4}),
           ('jpg', 'JPEG', {'quality': 82, 'optimize': True, 'progressive': True}))
if AVIF:
    FORMATS += (('avif', 'AVIF', {'quality': 60, 'speed': 8}),)
MIME = {'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'avif': 'image/avif',
        'html': 'text/html', 'jpg': 'image/jpeg'}
EXTENSIONS = {'jpg': 'jpeg', 'jpeg': 'jpeg', 'jpe': 'jpeg', 'jfif': 'jpeg', 'png': 'png', 'gif': 'gif',
              'webp': 'webp', 'avif': 'avif', 'svg': 'svg', 'svgz': 'svg', 'htm': 'html', 'html': 'html'}
PIL_FORMAT = {'jpeg': 'JPEG', 'png': 'PNG', 'gif': 'GIF', 'webp': 'WEBP', 'avif': 'AVIF'}


class Rejected(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Variant:
    name: str
    ext: str
    width: int
    height: int
    data: bytes = field(repr=False)


@dataclass
class Processed:
    width: int
    height: int
    color: str
    blur: str
    variants: list


def sniff(data):
    head = data[:64]
    if head.startswith(b'\xff\xd8\xff'):
        return 'jpeg'
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if head[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    if head[4:8] == b'ftyp':
        brands = {head[i:i + 4] for i in range(8, min(len(head), 32), 4)}
        if brands & {b'avif', b'avis'}:
            return 'avif' if AVIF else 'unsupported'
        return 'unsupported'
    text = head.lstrip(b'\xef\xbb\xbf \t\r\n').lower()
    if text.startswith(b'<') or b'<svg' in data[:4096].lower():
        return 'svg' if b'<svg' in data[:4096].lower() else 'markup'
    return 'unknown'


def extension(filename):
    name = (filename or '').rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
    return name.rsplit('.', 1)[-1].lower() if '.' in name else ''


def check_image_type(data, filename, allowed=('jpeg', 'png', 'gif', 'webp', 'avif')):
    kind = sniff(data)
    ext = extension(filename)
    if kind == 'svg' or EXTENSIONS.get(ext) == 'svg':
        raise Rejected('svg_not_allowed')
    if kind not in allowed:
        raise Rejected('type_not_allowed')
    if ext and EXTENSIONS.get(ext) != kind:
        raise Rejected('extension_mismatch')
    return kind


def check_html(data, filename):
    ext = extension(filename)
    if ext and EXTENSIONS.get(ext) != 'html':
        raise Rejected('extension_mismatch')
    if b'\x00' in data:
        raise Rejected('type_not_allowed')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise Rejected('not_utf8') from None
    if '<' not in text:
        raise Rejected('type_not_allowed')
    return text


def open_image(data, kind):
    """只读文件头拿尺寸，超限直接拒绝，不解码像素。"""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=[PIL_FORMAT[kind]])
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise Rejected('too_many_pixels') from None
    except Exception:
        raise Rejected('corrupt') from None
    w, h = img.size
    if w * h > MAX_PIXELS or max(w, h) > MAX_SIDE:
        raise Rejected('too_many_pixels')
    if w < 1 or h < 1:
        raise Rejected('corrupt')
    return img


def oriented_size(img):
    orientation = img.getexif().get(0x0112, 1)
    w, h = img.size
    return (h, w) if orientation in (5, 6, 7, 8) else (w, h)


def _load(data, kind, draft_to=None):
    img = open_image(data, kind)
    full = oriented_size(img)
    icc = img.info.get('icc_profile')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            if draft_to and kind == 'jpeg':
                img.draft('RGB', (draft_to, draft_to))
            img.seek(0)
            img.load()
            img = ImageOps.exif_transpose(img)
            alpha = img.mode in ('RGBA', 'LA', 'PA') or (img.mode == 'P' and 'transparency' in img.info)
            if img.mode not in ('RGB', 'RGBA', 'P', 'PA'):
                icc = None
            img = img.convert('RGBA' if alpha else 'RGB')
    except Exception:
        raise Rejected('corrupt') from None
    img.info = {}
    if icc and len(icc) > ICC_MAX:
        icc = None
    return img, full, icc


def _flatten(img):
    if img.mode != 'RGBA':
        return img
    base = Image.new('RGB', img.size, (255, 255, 255))
    base.paste(img, mask=img.getchannel('A'))
    return base


def _encode(img, fmt, icc):
    name, pil, options = fmt
    out = io.BytesIO()
    source = _flatten(img) if name == 'jpg' else img
    kwargs = dict(options)
    if icc:
        kwargs['icc_profile'] = icc
    source.save(out, pil, **kwargs)
    return out.getvalue()


def dominant_color(img):
    small = _flatten(img).copy()
    small.thumbnail((64, 64))
    pal = small.quantize(colors=5, method=Image.Quantize.MEDIANCUT)
    counts = sorted(pal.getcolors() or [], reverse=True)
    palette = pal.getpalette()
    index = counts[0][1] if counts else 0
    r, g, b = palette[index * 3:index * 3 + 3]
    return f'#{r:02x}{g:02x}{b:02x}'


def blur_placeholder(img):
    h = max(1, round(img.height * BLUR_WIDTH / img.width))
    tiny = img.resize((BLUR_WIDTH, h), Image.LANCZOS)
    out = io.BytesIO()
    tiny.save(out, 'WEBP', quality=50)
    return 'data:image/webp;base64,' + base64.b64encode(out.getvalue()).decode()


def target_widths(width):
    widths = [w for w in WIDTHS if w < width]
    widths.append(min(width, WIDTHS[-1]))
    return sorted(set(widths))


def process_image(data, kind):
    img, (full_w, full_h), icc = _load(data, kind, draft_to=WIDTHS[-1])
    variants = []
    current = img
    for width in reversed(target_widths(img.width)):
        height = max(1, round(img.height * width / img.width))
        if current.size != (width, height):
            current = current.resize((width, height), Image.LANCZOS, reducing_gap=2.0)
        for fmt in FORMATS:
            variants.append(Variant(f'w{width}.{fmt[0]}', fmt[0], width, height, _encode(current, fmt, icc)))
    return Processed(full_w, full_h, dominant_color(img), blur_placeholder(img), variants)


def crop_box(size, crop):
    w, h = size
    if not crop:
        side = min(w, h)
        return ((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side)
    x, y, side = crop['x'], crop['y'], crop['size']
    if x < 0 or y < 0 or side < 1 or x + side > w or y + side > h:
        raise Rejected('crop_out_of_bounds')
    return (x, y, x + side, y + side)


def process_avatar(data, kind, crop=None):
    img, (full_w, full_h), icc = _load(data, kind)
    square = img.crop(crop_box(img.size, crop))
    variants = []
    current = square
    for size in reversed(AVATAR_SIZES):
        if current.size != (size, size):
            current = current.resize((size, size), Image.LANCZOS)
        for fmt in FORMATS:
            variants.append(Variant(f's{size}.{fmt[0]}', fmt[0], size, size, _encode(current, fmt, icc)))
    return Processed(square.width, square.height, dominant_color(square), blur_placeholder(square), variants)
