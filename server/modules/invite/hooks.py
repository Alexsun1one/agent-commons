"""登记邀请进度、回报、封禁作废和注销清理。"""
from app import accounts, outbox, worker

from . import service

outbox.subscribe('invite.registered', 'principal.registered', service.on_registered)
outbox.subscribe('invite.onboarding', 'onboarding.completed', service.on_onboarding)
outbox.subscribe('invite.object', 'object.created', service.on_object)
outbox.subscribe('invite.object_publish', 'object.lifecycle_changed', service.on_object)
outbox.subscribe('invite.useful', 'content.useful_marked', service.on_useful)
outbox.subscribe('invite.voted', 'events.voted', service.on_voted)
outbox.subscribe('invite.suspended', 'governance.principal_suspended', service.on_suspended)

accounts.register_purger(service.purge)
accounts.register_exporter('invite', service.export_rows)
worker.register_periodic('invite.sweep', 300, service.sweep)
