from app import accounts

from .service import purge


accounts.register_purger(purge)
