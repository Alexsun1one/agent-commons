"""提示词模板：每个功能一个 TOML 文件（<功能名>.toml），里面每个 task 一段。

task 字段：inputs（必填输入）、optional（可选输入）、system、user（含 ${inputs}）、schema（JSON Schema 字符串）、
expected_output_tokens（预算预估用）、images（哪个输入是图片列表）、binary（哪些输入是二进制，如音频）。
只把模板里声明过的输入发出去；多给的字段直接报错，避免调用方把不需要的内容顺手带出去。
"""
import json
import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from string import Template

from .. import schema as schema_mod

DIR = Path(__file__).resolve().parent
IMAGE_TYPES = frozenset({'image/jpeg', 'image/png', 'image/gif', 'image/webp'})
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 4


@dataclass(frozen=True)
class Task:
    feature: str
    name: str
    version: str
    inputs: tuple
    optional: tuple
    schema: dict
    system: str = ''
    user: str = ''
    expected_output_tokens: int = 0
    images: str = None
    binary: tuple = ()

    def check(self, inputs):
        if not isinstance(inputs, dict):
            raise ValueError('inputs must be a dict')
        allowed = set(self.inputs) | set(self.optional)
        unknown = set(inputs) - allowed
        if unknown:
            raise ValueError(f'{self.feature}/{self.name}: undeclared inputs {sorted(unknown)}')
        missing = [k for k in self.inputs if inputs.get(k) in (None, '', [], b'')]
        if missing:
            raise ValueError(f'{self.feature}/{self.name}: missing inputs {missing}')
        for key, value in inputs.items():
            if key == self.images:
                _check_images(value)
            elif key in self.binary:
                if not isinstance(value, (bytes, bytearray)):
                    raise ValueError(f'{key} must be bytes')
            else:
                json.dumps(value, ensure_ascii=False)
        return {k: v for k, v in inputs.items() if v is not None}

    def text_inputs(self, inputs):
        return {k: v for k, v in inputs.items() if k != self.images and k not in self.binary}

    def render(self, inputs):
        payload = json.dumps(self.text_inputs(inputs), ensure_ascii=False, indent=1, sort_keys=True)
        return Template(self.user).substitute(inputs=payload)


def _check_images(value):
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_IMAGES:
        raise ValueError(f'images must be a list of 1..{MAX_IMAGES}')
    for img in value:
        if not isinstance(img, dict) or set(img) != {'media_type', 'data'}:
            raise ValueError('each image needs exactly media_type and data')
        if img['media_type'] not in IMAGE_TYPES:
            raise ValueError(f'unsupported image type {img["media_type"]!r}')
        if not isinstance(img['data'], (bytes, bytearray)) or not img['data']:
            raise ValueError('image data must be non-empty bytes')


@lru_cache(maxsize=None)
def load(feature):
    path = DIR / f'{feature}.toml'
    if not path.is_file():
        raise ValueError(f'no prompt template for {feature!r}')
    doc = tomllib.loads(path.read_text(encoding='utf-8'))
    if doc.get('feature') != feature:
        raise ValueError(f'{path.name}: feature field mismatch')
    tasks = {}
    for name, raw in doc.get('tasks', {}).items():
        schema = json.loads(raw['schema'])
        schema_mod.check_api_subset(schema)
        tasks[name] = Task(feature=feature, name=name, version=str(doc['version']), inputs=tuple(raw['inputs']),
                           optional=tuple(raw.get('optional', ())), schema=schema, system=raw.get('system', ''),
                           user=raw.get('user', ''), expected_output_tokens=int(raw.get('expected_output_tokens', 0)),
                           images=raw.get('images'), binary=tuple(raw.get('binary', ())))
    if not tasks:
        raise ValueError(f'{path.name}: no tasks')
    return tasks


def task(feature, name):
    tasks = load(feature)
    if name not in tasks:
        raise ValueError(f'{feature}: unknown task {name!r} (have {sorted(tasks)})')
    return tasks[name]
