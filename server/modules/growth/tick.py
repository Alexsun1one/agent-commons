"""定时重算：python -m modules.growth.tick（在 server/ 下运行；systemd timer 或 worker 调用 engine.recompute_all）。"""
import argparse
import os

from app import discovery
from app.db import Database
from app.settings import Settings

from . import engine


def main(argv=None):
    argparse.ArgumentParser(prog='python -m modules.growth.tick').parse_args(argv)
    settings = Settings.from_env(os.environ)
    discovery.discover(settings.module_package)
    db = Database(settings.db_path)
    print(engine.recompute_all(db))
    db.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
