"""Account-deletion cleanup for private messages."""

from app import accounts

from .service import purge

accounts.register_purger(purge)
