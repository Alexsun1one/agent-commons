"""Build offline reading pack and prototype from project-owned sources."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import argparse, base64, hashlib, html, json, mimetypes, re, shutil, subprocess, sys
import markdown


class BuildError(RuntimeError):
    """A delivery input is missing or cannot be shipped safely."""


class IndexAssets(HTMLParser):
    """Collect stylesheet and script tags without changing their source order."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.items = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        raw = self.get_starttag_text()
        if tag.lower() == 'link' and 'stylesheet' in values.get('rel', '').lower().split():
            if values.get('href'):
                self.items.append(('style', values['href'], raw))
        elif tag.lower() == 'script' and values.get('src'):
            self.items.append(('script', values['src'], raw))


class LiveHTMLPolicy(HTMLParser):
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and not values.get('src'):
            raise BuildError('线上入口不得包含内联脚本')
        if any(name.lower().startswith('on') or name.lower() == 'srcdoc' for name, _ in attrs):
            raise BuildError('线上入口不得包含内联事件或 srcdoc')


EXTRA_GLOBS = (
    'assets/mascot/*.webp',
    'assets/illus/*',
    'assets/brand/*',
    'assets/app-icons/*',
    'assets/media-samples/*',
)
EXTRA_REQUIRED = (
    'vendor/tiptap.min.js',
    'assets/fictional-members.png',
    'assets/learning-atelier.png',
    'sw.js',
)
IMAGE_SUFFIXES = {'.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'}
LARGE_IMAGE_BYTES = 200_000


def _relative(path, root):
    return path.resolve().relative_to(root.resolve()).as_posix()


def _resolve_local(preview, url, owner):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or parsed.path.startswith('/'):
        raise BuildError(f'{owner} 引用了非本地静态资源：{url}')
    path = (preview / parsed.path).resolve()
    try:
        path.relative_to(preview.resolve())
    except ValueError as exc:
        raise BuildError(f'{owner} 引用了 preview/ 之外的路径：{url}') from exc
    if not path.is_file():
        raise BuildError(f'{owner} 引用的文件不存在：{url}')
    name = path.name.lower()
    parts = {part.lower() for part in path.relative_to(preview.resolve()).parts}
    if path.suffix.lower() == '.js' and not name.endswith('-sample.js') and (
        'private' in parts or name.endswith('-private.js') or '.private.' in name
    ):
        raise BuildError(f'{owner} 引用了不应进入交付包的私有数据文件：{url}')
    return path


def _scan_docs_reference(path, text):
    match = re.search(r'\.\./docs/', text)
    if match:
        line = text.count('\n', 0, match.start()) + 1
        raise BuildError(f'{path}:{line} 含 ../docs/，部署后不可用')


def _collect_extras(preview):
    extras = []
    for rel in EXTRA_REQUIRED:
        path = preview / rel
        if not path.is_file():
            raise BuildError(f'显式额外清单缺少：preview/{rel}')
        extras.append(path)
    for pattern in EXTRA_GLOBS:
        matches = sorted(path for path in preview.glob(pattern) if path.is_file())
        if not matches:
            raise BuildError(f'显式额外清单没有匹配文件：preview/{pattern}')
        extras.extend(matches)
    manifest = preview / 'manifest.webmanifest'
    if manifest.is_file():
        extras.append(manifest)
    # New R13 modules also use badges, stickers, groups and dynamically selected
    # images. Embed the asset registry once, including runtime-selected files.
    for path in sorted((preview / 'assets').rglob('*')):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES | {'.mp3', '.mp4', '.webm', '.ogg', '.wav', '.woff', '.woff2'}:
            extras.append(path)
    for path in sorted((preview / 'vendor').glob('*')):
        if path.is_file() and path.suffix.lower() in {'.js', '.css'}:
            extras.append(path)
    return list(dict.fromkeys(extras))


def data_uri(path):
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    if path.suffix == '.webmanifest':
        mime = 'application/manifest+json'
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()


def _index_assets(preview):
    index = preview / 'index.html'
    if not index.is_file():
        raise BuildError('缺少 preview/index.html')
    source = index.read_text(encoding='utf-8')
    _scan_docs_reference('preview/index.html', source)
    parser = IndexAssets()
    parser.feed(source)
    items = []
    for kind, url, raw in parser.items:
        path = _resolve_local(preview, url, 'preview/index.html')
        text = path.read_text(encoding='utf-8')
        _scan_docs_reference('preview/' + _relative(path, preview), text)
        items.append({'kind': kind, 'url': url, 'raw': raw, 'path': path, 'text': text,
                      'source_sha256': hashlib.sha256(text.encode()).hexdigest()})
    return index, source, items


def _transform_assets(root, items, live=False):
    """Run esbuild transform once for all inputs and fall back per failed file."""
    module = Path(__file__).resolve().parent / 'vendor/node_modules/esbuild'
    payload = [
        {
            'name': _relative(item['path'], root),
            'loader': 'css' if item['kind'] == 'style' else 'js',
            'text': item['text'],
            'live': live,
        }
        for item in items
    ]
    script = r"""
const esbuild = require(process.argv[1]);
const fs = require('fs');
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = inputs.map((item) => {
  try {
    const result = esbuild.transformSync(item.text, {
      loader: item.loader,
      minify: true,
      charset: 'utf8',
      legalComments: 'none',
      define: item.live && item.loader === 'js' ? { 'window.COMMONS_BUILD_LIVE': 'true' } : {},
      sourcefile: item.name
    });
    return { ok: true, code: result.code };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
});
process.stdout.write(JSON.stringify(results));
"""
    try:
        result = subprocess.run(
            ['node', '-e', script, str(module)],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            reason = (result.stderr or result.stdout or f'node 退出码 {result.returncode}').strip()
            transformed = [{'ok': False, 'error': reason} for _ in items]
        else:
            transformed = json.loads(result.stdout)
            if len(transformed) != len(items):
                raise ValueError('esbuild 返回数量与输入不一致')
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        transformed = [{'ok': False, 'error': str(exc)} for _ in items]

    failures = []
    for item, outcome in zip(items, transformed):
        if outcome.get('ok'):
            item['built_text'] = outcome['code']
        else:
            item['built_text'] = item['text']
            failures.append({
                'path': _relative(item['path'], root),
                'error': outcome.get('error', '未知 transform 错误'),
            })
    return failures


def _replace_index_assets(source, items, css_name, js_name):
    first = {'style': True, 'script': True}
    for item in items:
        if item['kind'] == 'style':
            replacement = f'<link rel="stylesheet" href="{html.escape(css_name, quote=True)}">' if first['style'] else ''
            if item['raw'] not in source:
                raise BuildError(f'无法替换样式标签：{item["url"]}')
            source = source.replace(item['raw'], replacement, 1)
            first['style'] = False
            continue
        replacement = f'<script src="{html.escape(js_name, quote=True)}"></script>' if first['script'] else ''
        tag = re.compile(re.escape(item['raw']) + r'\s*</script\s*>', re.IGNORECASE)
        source, count = tag.subn(lambda _: replacement, source, count=1)
        if count != 1:
            raise BuildError(f'无法替换脚本标签：{item["url"]}')
        first['script'] = False
    return source


def _copy_runtime_files(preview, output, referenced):
    referenced = {path.resolve() for path in referenced}
    copied = []
    for source in sorted(path for path in preview.rglob('*') if path.is_file()):
        relative = source.relative_to(preview)
        if not relative.parts or not (relative.parts[0] in {'assets', 'vendor'} or relative.as_posix() in {'manifest.webmanifest', 'offline.html', 'sw.js'}):
            continue
        if source.resolve() in referenced:
            continue
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.append((source, target))
    return copied


def _recompress_large_webp(copied, preview):
    report = []
    for source, target in copied:
        relative = source.relative_to(preview)
        if not relative.parts or relative.parts[0] != 'assets':
            continue
        if source.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        before = source.stat().st_size
        if before <= LARGE_IMAGE_BYTES:
            continue
        item = {'path': relative.as_posix(), 'before_bytes': before, 'after_bytes': before, 'recompressed': False}
        if source.suffix.lower() == '.webp':
            try:
                from PIL import Image
                with Image.open(target) as image:
                    options = {'format': 'WEBP', 'quality': 82, 'method': 6}
                    for key in ('icc_profile', 'exif'):
                        if image.info.get(key):
                            options[key] = image.info[key]
                    image.save(target, **options)
                item['after_bytes'] = target.stat().st_size
                item['recompressed'] = True
            except (OSError, ValueError) as exc:
                item['error'] = str(exc)
        report.append(item)
    return report


def build_minified_prototype(root, output):
    preview = root / 'preview'
    index, source, items = _index_assets(preview)
    if output.resolve() == preview.resolve() or preview.resolve() in output.resolve().parents:
        raise BuildError('--minify 的 --output 不能放在 preview/ 内')
    if output.exists() and not output.is_dir():
        raise BuildError(f'--minify 的 --output 必须是目录：{output}')
    if output.exists() and any(output.iterdir()):
        raise BuildError(f'--minify 的 --output 必须为空目录：{output}')
    output.mkdir(parents=True, exist_ok=True)

    failures = _transform_assets(root, items)
    style_items = [item for item in items if item['kind'] == 'style']
    script_items = [item for item in items if item['kind'] == 'script']
    css = '\n'.join(item['built_text'].rstrip() for item in style_items) + '\n'
    js = '\n;'.join(item['built_text'].rstrip() for item in script_items) + '\n'
    css_name = f'app.{hashlib.sha256(css.encode()).hexdigest()[:12]}.css'
    js_name = f'app.{hashlib.sha256(js.encode()).hexdigest()[:12]}.js'
    (output / css_name).write_text(css, encoding='utf-8')
    (output / js_name).write_text(js, encoding='utf-8')

    built_index = _replace_index_assets(source, items, css_name, js_name)
    _scan_docs_reference('交付包/index.html', built_index)
    (output / 'index.html').write_text(
        '<!-- Generated by tools/build-delivery.py --minify. Edit preview sources. -->\n' + built_index,
        encoding='utf-8',
    )
    copied = _copy_runtime_files(preview, output, [item['path'] for item in items])
    images = _recompress_large_webp(copied, preview)
    for failure in failures:
        print(f'build-delivery: transform 失败，原样保留 {failure["path"]}: {failure["error"]}', file=sys.stderr)

    source_preview_bytes = sum(path.stat().st_size for path in preview.rglob('*') if path.is_file())
    referenced_paths = {item['path'].resolve() for item in items}
    package_source_bytes = index.stat().st_size + sum(path.stat().st_size for path in referenced_paths) + sum(source.stat().st_size for source, _ in copied)
    output_bytes = sum(path.stat().st_size for path in output.rglob('*') if path.is_file())
    return {
        'mode': 'minify',
        'output_dir': str(output),
        'source_preview_bytes': source_preview_bytes,
        'package_source_bytes': package_source_bytes,
        'output_bytes': output_bytes,
        'source_js_bytes': sum(len(item['text'].encode()) for item in script_items),
        'bundle_js_bytes': (output / js_name).stat().st_size,
        'source_css_bytes': sum(len(item['text'].encode()) for item in style_items),
        'bundle_css_bytes': (output / css_name).stat().st_size,
        'js_sources': len(script_items),
        'css_sources': len(style_items),
        'js_bundle': js_name,
        'css_bundle': css_name,
        'transform_failures': failures,
        'large_images': images,
    }


# Legacy screens with embedded fictional records are not live dependencies. Their
# owners must split the records before these modules can join the live package.
LIVE_DEMO_MODULES = {
    'data.js', 'archive-data.js', 'archive-view.js', 'fieldwork-data.js', 'fieldwork.js',
    'knowledge-sample-data.js', 'level-demo.js', 'insights-data.js',
}
LIVE_RUNTIME_SCRIPTS = set('''api.js motion.js hubs.js navigation.js contributions.js
member.js state-icons.js knowledge-net.js command.js rings.js level.js links.js
vendor/html-to-image.src.js growth.js perf.js logos.js hot.js onboard.js account.js auth.js
kb.js gravity-line.js insights-drift.js insights.js drift.js talks.js notify.js admin.js
reader.js qr.js share.js digest.js calendar.js rooms.js connect.js changelog-data.js
changelog.js achievements.js economy.js parking.js events.js games.js announce.js
bounty.js farm.js market.js dm.js govern.js pet.js tools.js orgs.js invite.js social.js
search.js pwa.js business.js app.js
extensions.js constellation.js showcase.js work-stage.js work-hub.js avatar.js
agentchat.js board.js board-templates.js landing.js thread.js buddies.js html-render.js
editor.js media.js image.js people.js ui-kit.js library.js'''.split())
LIVE_ASSET_DIRS = {
    'app-icons', 'brand', 'mascot', 'illus', 'badges', 'levels', 'levelup',
    'stickers', 'game', 'pet', 'hub', 'invite', 'logos', 'tools', 'business',
}
LEGAL_DOCUMENTS = {
    'privacy': '隐私政策', 'terms': '用户协议', 'community-rules': '社区规则',
    'age-18': '十八岁以上声明', 'retention': '数据保留期限表',
}
LEGAL_OUTPUT_STEMS = {'community-rules': 'rules'}
LIVE_FORBIDDEN_ASSETS = re.compile(
    r"assets/(?:fictional-members\.png|(?:samples|media-samples|html-samples|avatars|groups|orgs|thumbs)/[^\s'\"<>)]*\.[a-zA-Z0-9]+)"
)
LIVE_FIXTURES = (
    '林杉', '顾澄', '叶知', '闻溪', '温溪', '程野', '陆遥',
    '为小团队搭建带出处的知识助手', '失败的版本，值得放进作品集吗',
    '长任务断了也能接着跑：给编程 Agent 加检查点', '把知识库做成可复现的小样',
    '周迭代看板', '轨道草稿', '陈墨', '林栖',
    'lin-shan', 'gu-cheng', 'ye-zhi', 'wen-xi', 'cheng-ye', 'lu-yao',
)


def _demo_file(relative):
    name = Path(relative).name.lower()
    return name in LIVE_DEMO_MODULES or bool(re.search(r'(?:^|[-.])(?:sample|samples|demo)(?:[-.]|$)', name))


def _assert_live_text(name, text):
    _scan_docs_reference(name, text)
    # Check code points too: escaping a fixture must not bypass the assertion.
    decoded = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m[1], 16)), text)
    for value in LIVE_FIXTURES:
        if value in decoded:
            raise BuildError(f'{name} 含合成记录指纹：{value}')
    if re.search(r'COMMONS_[A-Z_]*(?:SAMPLE|DEMO)[A-Z_]*\s*=(?!=)', decoded):
        raise BuildError(f'{name} 含示例数据定义')
    if re.search(r"[\"'][\w./-]+-sample(?:-data)?\.js[\"']", decoded):
        raise BuildError(f'{name} 引用了示例脚本')
    if LIVE_FORBIDDEN_ASSETS.search(decoded):
        raise BuildError(f'{name} 引用了演示专用资源')


def _set_mode(source, mode):
    source = re.sub(r'<meta\b[^>]*name=[\"\']commons-mode[\"\'][^>]*>', '', source, flags=re.I)
    return source.replace('<head>', '<head>\n<meta name="commons-mode" content="' + mode + '">', 1)


def _legal_pages(root, css_name):
    """Render the five authoritative drafts verbatim, without inventing policy."""
    pages, sources = {}, []
    for stem, title in LEGAL_DOCUMENTS.items():
        source = root / 'docs' / 'legal' / (stem + '.md')
        if not source.is_file():
            raise BuildError(f'法律正文缺失：docs/legal/{stem}.md')
        text = source.read_text(encoding='utf-8')
        if not text.strip():
            raise BuildError(f'法律正文为空：{source.name}')
        body = markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists'])

        def rewrite_link(match):
            href = html.unescape(match[1])
            parsed = urlsplit(href)
            if parsed.scheme and parsed.scheme.lower() not in {'http', 'https', 'mailto'}:
                raise BuildError(f'{source.name} 含不安全链接协议')
            if parsed.scheme or parsed.netloc or not parsed.path:
                return match[0]
            path = Path(parsed.path)
            if path.suffix == '.md':
                if path.stem not in LEGAL_DOCUMENTS or path.as_posix() not in {path.name, './' + path.name}:
                    raise BuildError(f'{source.name} 含未打包的文档链接：{href}')
                href = LEGAL_OUTPUT_STEMS.get(path.stem, path.stem) + '.html' + ('#' + parsed.fragment if parsed.fragment else '')
            return 'href="' + html.escape(href, quote=True) + '"'

        body = re.sub(r'href="([^"]*)"', rewrite_link, body)
        nav = ' · '.join(f'<a href="{LEGAL_OUTPUT_STEMS.get(name, name)}.html">{label}</a>' for name, label in LEGAL_DOCUMENTS.items())
        rendered = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
                    '<meta name="viewport" content="width=device-width,initial-scale=1">'
                    f'<title>{title} · 智能体先锋队</title>'
                    f'<link rel="stylesheet" href="../{html.escape(css_name, quote=True)}">'
                    '</head><body><main class="page"><article class="article">'
                    '<nav aria-label="法律文件">' + nav + '</nav>' + body +
                    '<footer><a href="../index.html#/home">返回社区</a> · '
                    '<a href="../index.html#/govern">第三方投诉</a></footer>'
                    '</article></main></body></html>')
        LiveHTMLPolicy().feed(rendered)
        output_name = 'legal/' + LEGAL_OUTPUT_STEMS.get(stem, stem) + '.html'
        _assert_live_text(output_name, rendered)
        pages[output_name] = rendered
        sources.append({'path': _relative(source, root), 'sha256': hashlib.sha256(text.encode()).hexdigest()})
    if len(pages) != 5:
        raise BuildError('线上法律正文必须恰好五页')
    return pages, sources


def build_live(root, output):
    """Build a fail-closed, external-script-only static directory for the server."""
    preview = root / 'preview'
    if output.resolve() == root.resolve() or output.resolve() == preview.resolve() or preview.resolve() in output.resolve().parents:
        raise BuildError('--live 的输出必须是 preview/ 外的独立空目录')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise BuildError('--live 的输出必须为空目录，拒绝混入旧包文件')
    _, source, items = _index_assets(preview)
    source = _set_mode(source, 'live')
    LiveHTMLPolicy().feed(source)
    kept, excluded = [], []
    for item in items:
        relative = _relative(item['path'], preview)
        if item['kind'] == 'script' and _demo_file(relative):
            source = re.sub(re.escape(item['raw']) + r'\s*</script\s*>', '', source, count=1, flags=re.I)
            excluded.append(relative)
        else:
            if item['kind'] == 'script' and relative not in LIVE_RUNTIME_SCRIPTS:
                raise BuildError(f'未审核的线上脚本：{relative}；先隔离示例数据再加入清单')
            # A decorative demo portrait/background is not a live asset. Preserve
            # the rest of the stylesheet, including layout, tokens and gradients.
            if item['kind'] == 'style':
                item['text'] = re.sub(r'url\([^)]+\)', lambda m: 'none' if LIVE_FORBIDDEN_ASSETS.search(m[0]) else m[0], item['text'])
            kept.append(item)
    failures = _transform_assets(root, kept, live=True)
    if failures:
        raise BuildError('线上构建拒绝 transform 失败：' + json.dumps(failures, ensure_ascii=False))
    for item in kept:
        _assert_live_text(_relative(item['path'], preview), item['built_text'])
        if hashlib.sha256(item['path'].read_text(encoding='utf-8').encode()).hexdigest() != item['source_sha256']:
            raise BuildError(f'构建中源文件发生变化：{item["path"].name}；请重新构建')
    # No inline scripts: compatible with the main site's script-src self policy.
    css = '\n'.join(i['built_text'] for i in kept if i['kind'] == 'style')
    js = '\n;'.join(i['built_text'] for i in kept if i['kind'] == 'script')
    css_name = 'app.' + hashlib.sha256(css.encode()).hexdigest()[:12] + '.css'
    js_name = 'app.' + hashlib.sha256(js.encode()).hexdigest()[:12] + '.js'
    legal_pages, legal_sources = _legal_pages(root, css_name)
    source = _replace_index_assets(source, kept, css_name, js_name)
    _assert_live_text('index.html', source)
    runtime = []
    for directory in sorted(LIVE_ASSET_DIRS):
        folder = preview / 'assets' / directory
        for path in sorted(folder.rglob('*')):
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
                runtime.append(path)
    # Components load these libraries lazily. Keep their dependencies alongside
    # the bundle, including player styles, without copying vendor source trees.
    vendor_names = {'tiptap.min.js', 'livekit-client.min.js', 'html-to-image.src.js',
                    'hls.min.js', 'wavesurfer.min.js', 'rrweb-player.min.js',
                    'rrweb-player.css', 'asciinema-player.min.js', 'asciinema-player.css'}
    referenced_vendors = set(re.findall(r'vendor/([\w.-]+\.(?:js|css))', js))
    for name in sorted(referenced_vendors):
        if name not in vendor_names or not (preview / 'vendor' / name).is_file():
            raise BuildError(f'线上组件依赖未审核或缺失：vendor/{name}')
    dependencies = ['vendor/' + name for name in sorted(referenced_vendors)]
    for rel in dependencies + ['manifest.webmanifest', 'offline.html']:
        path = preview / rel
        if path.is_file():
            _assert_live_text(rel, path.read_text(encoding='utf-8'))
            runtime.append(path)
    output.mkdir(parents=True, exist_ok=True)
    for name, body in (('index.html', source), (css_name, css), (js_name, js)):
        (output / name).write_text(body, encoding='utf-8')
    for name, body in legal_pages.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding='utf-8')
    if len(list((output / 'legal').glob('*.html'))) != 5:
        raise BuildError('线上法律目录缺页')
    for path in runtime:
        relative = _relative(path, preview)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    sw = preview / 'sw.js'
    if sw.is_file():
        static = [css_name, js_name] + [_relative(p, preview) for p in runtime
                  if p.name in {'offline.html', 'manifest.webmanifest'} or 'app-icons' in p.parts]
        worker, count = re.subn(r'var PRECACHE_STATIC = \[.*?\];',
                               'var PRECACHE_STATIC = ' + json.dumps(static) + ';',
                               sw.read_text(encoding='utf-8'), count=1, flags=re.S)
        if count != 1:
            raise BuildError('sw.js 缺少唯一 PRECACHE_STATIC 清单，拒绝带入演示缓存')
        # Isolate live caches from any previous demo worker at the same origin.
        worker = worker.replace("var PREFIX = 'commons-';", "var PREFIX = 'commons-live-';")
        _assert_live_text('sw.js', worker)
        (output / 'sw.js').write_text(worker, encoding='utf-8')
    # Verify the actual output, not just the list of selected sources.
    inventory = []
    for path in sorted(output.rglob('*')):
        if not path.is_file():
            continue
        rel = _relative(path, output)
        if _demo_file(rel) or LIVE_FORBIDDEN_ASSETS.search(rel):
            raise BuildError(f'线上目录含示例文件：{rel}')
        if path.suffix.lower() in {'.js', '.css', '.html', '.json', '.webmanifest', '.svg'}:
            _assert_live_text(rel, path.read_text(encoding='utf-8'))
        inventory.append({'path': rel, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return {'mode': 'live', 'output_dir': str(output), 'js_bundle': js_name, 'css_bundle': css_name,
            'excluded_demo_sources': excluded,
            'sources': [{'path': _relative(i['path'], root), 'sha256': i['source_sha256']} for i in kept],
            'legal_sources': legal_sources,
            'files': inventory, 'output_bytes': sum(i['bytes'] for i in inventory)}


def build_prototype(root, output):
    preview = root / 'preview'
    index = preview / 'index.html'
    if not index.is_file():
        raise BuildError('缺少 preview/index.html')

    source = _set_mode(index.read_text(encoding='utf-8'), 'demo')
    _scan_docs_reference('preview/index.html', source)
    parser = IndexAssets()
    parser.feed(source)
    refs = []
    for kind, url, raw in parser.items:
        path = _resolve_local(preview, url, 'preview/index.html')
        rel = _relative(path, preview)
        text = path.read_text(encoding='utf-8')
        _scan_docs_reference('preview/' + rel, text)
        refs.append(path)
        if kind == 'style':
            replacement = '<style data-delivery-source="' + html.escape(rel, quote=True) + '">\n' + text.replace('</style', '<\\/style') + '\n</style>'
            if raw not in source:
                raise BuildError(f'无法替换样式标签：{url}')
            source = source.replace(raw, replacement, 1)
        else:
            replacement = '<script data-delivery-source="' + html.escape(rel, quote=True) + '">\n' + text.replace('</script', '<\\/script') + '\n</script>'
            tag = re.compile(re.escape(raw) + r'\s*</script\s*>', re.IGNORECASE)
            source, count = tag.subn(lambda _: replacement, source, count=1)
            if count != 1:
                raise BuildError(f'无法替换脚本标签：{url}')

    extras = _collect_extras(preview)
    registry = {}
    for path in extras:
        rel = _relative(path, preview)
        registry[rel] = data_uri(path)
        if rel.startswith(('assets/', 'vendor/')) or rel == 'manifest.webmanifest':
            source = source.replace(rel, registry[rel])

    _scan_docs_reference('交付包', source)
    registry_json = json.dumps(registry, ensure_ascii=True, separators=(',', ':')).replace('</', '<\\/')
    inventory = []
    seen = set()
    for path in [index, *refs, *extras]:
        rel = _relative(path, root)
        if rel in seen:
            continue
        seen.add(rel)
        body = path.read_bytes()
        inventory.append({'path': rel, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    manifest_json = json.dumps(inventory, ensure_ascii=False, separators=(',', ':')).replace('--', '\\u002d\\u002d')
    embedded = ('<script type="application/json" id="delivery-static-assets">' + registry_json + '</script>\n'
                '<!-- delivery-inventory ' + manifest_json + ' -->')
    # innerHTML/template URLs are resolved after insertion as well as on initial
    # load; this covers paths assembled from an id rather than a full literal.
    resolver = r'''<script data-delivery-source="asset-resolver">
(() => {
  const assets = JSON.parse(document.getElementById('delivery-static-assets').textContent);
  const resolve = value => assets[String(value || '').replace(/^\.\//, '')] || value;
  function rewrite(node) {
    for (const attr of ['src', 'poster', 'href']) {
      const old = node.getAttribute(attr), next = resolve(old);
      if (old && next !== old) node.setAttribute(attr, next);
    }
  }
  function update(node) {
    if (!node || node.nodeType !== 1) return;
    rewrite(node);
    node.querySelectorAll('[src],[poster],[href]').forEach(rewrite);
  }
  new MutationObserver(records => records.forEach(record => {
    if (record.type === 'attributes') update(record.target);
    else record.addedNodes.forEach(update);
  })).observe(document.documentElement, { subtree: true, childList: true,
    attributes: true, attributeFilter: ['src', 'poster', 'href'] });
  update(document.documentElement);
})();
</script>'''
    first_script = source.find('<script')
    if first_script < 0:
        source += embedded + resolver
    else:
        source = source[:first_script] + embedded + resolver + source[first_script:]
    _scan_docs_reference('交付包', source)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('<!-- Generated by tools/build-delivery.py. Edit preview sources. -->\n' + source, encoding='utf-8')
    ranked = sorted(inventory, key=lambda item: (-item['bytes'], item['path']))
    first_screen = len(index.read_bytes()) + sum(path.stat().st_size for path in dict.fromkeys(refs))
    prototype_bytes = output.stat().st_size
    return {
        'prototype_bytes': prototype_bytes,
        'first_screen_download_bytes': prototype_bytes,
        'package_source_bytes': sum(item['bytes'] for item in inventory),
        'package_files': len(inventory),
        'first_screen_source_bytes': first_screen,
        'top_10': ranked[:10],
    }


parser = argparse.ArgumentParser(description='构建离线单文件原型与阅读包。')
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
parser.add_argument('--output', type=Path, help='默认是单文件路径；--live / --minify 时是独立空目录。')
parser.add_argument('--prototype-only', action='store_true', help='只构建原型，供隔离测试使用。')
parser.add_argument('--live', action='store_true', help='构建不含示例记录的线上静态目录。')
parser.add_argument('--minify', action='store_true', help='逐文件 transform 后合并为哈希 JS/CSS 静态交付目录。')
ARGS = parser.parse_args()
if ARGS.live and ARGS.minify:
    parser.error('--live 与 --minify 不可同时使用')
R = ARGS.root.resolve()
prototype_output = ARGS.output.resolve() if ARGS.output else (R / 'delivery-live' if ARGS.live else R / 'delivery-minified' if ARGS.minify else R / '先锋社区-交互原型.html')
try:
    BUILD_STATS = build_live(R, prototype_output) if ARGS.live else build_minified_prototype(R, prototype_output) if ARGS.minify else build_prototype(R, prototype_output)
except (BuildError, OSError, UnicodeError) as exc:
    print('build-delivery: ' + str(exc), file=sys.stderr)
    raise SystemExit(1)

if ARGS.prototype_only or ARGS.minify or ARGS.live:
    print(json.dumps(BUILD_STATS, ensure_ascii=False))
    raise SystemExit(0)


print(json.dumps(BUILD_STATS, ensure_ascii=False))
