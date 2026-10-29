import importlib
import pkgutil
import re
from dataclasses import dataclass
from pathlib import Path

NAME = re.compile(r'[a-z][a-z0-9_]{1,31}\Z')


@dataclass
class Module:
    name: str
    path: Path
    router: object = None
    admin_router: object = None
    setup: object = None

    @property
    def migrations(self):
        folder = self.path / 'migrations'
        return sorted(folder.glob(f'{self.name}_*.sql')) if folder.is_dir() else []


def discover(package_name):
    package = importlib.import_module(package_name)
    found = []
    for info in sorted(pkgutil.iter_modules(package.__path__), key=lambda i: i.name):
        if not info.ispkg or info.name.startswith('_'):
            continue
        if not NAME.match(info.name):
            raise ValueError(f'module name {info.name!r} must match {NAME.pattern}')
        path = Path(package.__path__[0]) / info.name
        module = Module(info.name, path)
        if (path / 'router.py').exists():
            loaded = importlib.import_module(f'{package_name}.{info.name}.router')
            module.router = getattr(loaded, 'router', None)
            module.admin_router = getattr(loaded, 'admin_router', None)
            module.setup = getattr(loaded, 'setup', None)
        found.append(module)
    return found
