import sqlite3
import threading
from contextlib import contextmanager


class Database:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.Lock()
        self._local = threading.local()
        self._conns = []
        self._conns_lock = threading.Lock()

    def conn(self):
        c = getattr(self._local, 'conn', None)
        if c is None:
            c = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False, timeout=5)
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA journal_mode = WAL')
            c.execute('PRAGMA busy_timeout = 5000')
            c.execute('PRAGMA foreign_keys = ON')
            c.execute('PRAGMA synchronous = NORMAL')
            self._local.conn = c
            with self._conns_lock:
                self._conns.append(c)
        return c

    @contextmanager
    def read(self):
        yield self.conn()

    @contextmanager
    def write(self):
        c = self.conn()
        if c.in_transaction:
            yield c
            return
        with self.lock:
            c.execute('BEGIN IMMEDIATE')
            try:
                yield c
            except BaseException:
                c.execute('ROLLBACK')
                raise
            c.execute('COMMIT')

    def close(self):
        with self._conns_lock:
            for c in self._conns:
                c.close()
            self._conns.clear()
        self._local = threading.local()
