"""注销时清掉本人的关闭记录、频控和偏好。聚合计数没有读者，不动。"""

from app import accounts

from .service import export, purge


accounts.register_purger(purge)

accounts.register_exporter('announce', export)
