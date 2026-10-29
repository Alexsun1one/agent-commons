"""SOCIAL-1 HTTP 接口：关系、动态、反应、转发、投票、小组。"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app import accounts, idempotency, objects, pagination, security
from app.context import Ctx, ok, user_ctx, write_ctx

from . import extras, service

router = APIRouter(prefix='/api/social')
admin_router = APIRouter(prefix='/api/admin/social')

objects.register_type(service.TYPE, service.validate_post, service.post_text)
accounts.register_purger(service.purge)
accounts.register_exporter('social', service.export_rows)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class LinkIn(Strict):
    url: str = Field(max_length=500)
    title: Optional[str] = Field(default=None, max_length=120)


class PollIn(Strict):
    options: list[str] = Field(min_length=2, max_length=4)
    days: Literal[1, 3, 7] = 3


class QuoteIn(Strict):
    id: str = Field(min_length=36, max_length=36)


class PostIn(Strict):
    body: Optional[str] = Field(default=None, max_length=service.BODY_MAX)
    images: list[str] = Field(default_factory=list, max_length=service.IMAGES_MAX)
    link: Optional[LinkIn] = None
    poll: Optional[PollIn] = None
    quote: Optional[QuoteIn] = None
    scope: Optional[Literal['members', 'friends', 'group', 'private']] = None
    group: Optional[str] = Field(default=None, max_length=40)


class ShareIn(Strict):
    note: Optional[str] = Field(default=None, max_length=service.NOTE_MAX)
    scope: Optional[Literal['members', 'friends', 'group', 'private']] = None
    group: Optional[str] = Field(default=None, max_length=40)


class ReactionIn(Strict):
    kind: Literal['up', 'learned', 'reproduced', 'smile', 'cheer', 'question']


class VoteIn(Strict):
    option: int = Field(ge=0, le=3)


class PrefsIn(Strict):
    default_scope: Optional[Literal['members', 'friends', 'private']] = None
    suggestions: Optional[bool] = None
    buddy_open: Optional[bool] = None


class Trim(Strict):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


BuddyKind = Literal['project', 'learn', 'review']


class BuddyIn(Trim):
    kind: BuddyKind
    title: str = Field(min_length=1, max_length=100)
    outcome: str = Field(min_length=1, max_length=600)
    schedule: str = Field(min_length=1, max_length=120)
    contribution: str = Field(min_length=1, max_length=240)
    partner: str = Field(min_length=1, max_length=240)
    note: str = Field(default='', max_length=1000)


class BuddyPatch(Trim):
    kind: Optional[BuddyKind] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    outcome: Optional[str] = Field(default=None, min_length=1, max_length=600)
    schedule: Optional[str] = Field(default=None, min_length=1, max_length=120)
    contribution: Optional[str] = Field(default=None, min_length=1, max_length=240)
    partner: Optional[str] = Field(default=None, min_length=1, max_length=240)
    note: Optional[str] = Field(default=None, max_length=1000)
    state: Optional[Literal['open', 'paused']] = None


class InviteIn(Trim):
    post_id: Optional[str] = Field(default=None, max_length=64)
    kind: BuddyKind
    title: str = Field(min_length=1, max_length=100)
    outcome: str = Field(min_length=1, max_length=600)
    schedule: str = Field(min_length=1, max_length=120)
    contribution: str = Field(min_length=1, max_length=240)
    note: str = Field(default='', max_length=1000)


class InvitePatch(Trim):
    kind: Optional[BuddyKind] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    outcome: Optional[str] = Field(default=None, min_length=1, max_length=600)
    schedule: Optional[str] = Field(default=None, min_length=1, max_length=120)
    contribution: Optional[str] = Field(default=None, min_length=1, max_length=240)
    note: Optional[str] = Field(default=None, max_length=1000)


class AnswerIn(Strict):
    accept: bool


class ReportIn(Trim):
    reason: str = Field(min_length=2, max_length=200)


class SponsorIn(Trim):
    brand: str = Field(min_length=1, max_length=40)
    types: list[Literal['title', 'jobs', 'prize', 'slot']] = Field(min_length=1, max_length=4)
    budget: str = Field(default='', max_length=40)
    time: str = Field(default='', max_length=20)
    note: str = Field(default='', max_length=300)


class LecturerIn(Trim):
    title: str = Field(min_length=1, max_length=40)
    form: Literal['workshop', 'one']
    length: str = Field(default='', max_length=40)
    price: str = Field(default='', max_length=40)
    note: str = Field(default='', max_length=200)


class DecisionIn(Trim):
    decision: Literal['approved', 'rejected']
    note: Optional[str] = Field(default=None, max_length=300)


class GroupIn(Strict):
    slug: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=24)
    category: Literal['tech', 'career', 'industry', 'community'] = 'community'
    intro: Optional[str] = Field(default=None, max_length=80)
    rules: Optional[list[str]] = Field(default=None, max_length=8)
    cover: Optional[str] = Field(default=None, max_length=140)
    join_policy: Literal['open', 'apply'] = 'open'


class JoinIn(Strict):
    note: Optional[str] = Field(default=None, max_length=140)


def _limit_writes(ctx, bucket, *windows):
    for limit, window in windows:
        security.hit(ctx.db, f'social.{bucket}:{window}:{ctx.actor.id}', limit, window)


def _page(ctx, kind, cursor, limit, *parts):
    size = pagination.page_size(limit)
    qhash = pagination.query_hash('social', kind, *parts)
    return size, qhash, pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)


def _paged(ctx, items, next_key, qhash):
    cursor = pagination.encode(ctx.settings, ctx.actor.id, qhash, next_key) if next_key else None
    return ok(ctx, {'items': items}, cursor=cursor)


def _pid(conn, handle):
    return service.principal_id(conn, handle)


# ---------- 我和关系 ----------

@router.get('/me')
def me(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        service.gate(conn)
        return ok(ctx, {'prefs': service.prefs(conn, ctx.actor.id), 'counts': service.counts(conn, ctx.actor.id)})


@router.put('/me/prefs')
def put_prefs(body: PrefsIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.set_prefs(conn, ctx.actor, body.default_scope, body.suggestions, ctx.request_id,
                                         body.buddy_open))


@router.get('/profiles')
def profiles(cursor: Optional[str] = None, limit: Optional[int] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'profiles', cursor, limit)
    with ctx.db.read() as conn:
        items, next_key = service.profiles(conn, ctx.actor, after, size)
        return _paged(ctx, items, next_key, qhash)


@router.get('/profiles/{handle}')
def public_profile(handle: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.public_profile(conn, ctx.actor, handle))


@router.get('/people/{handle}')
def person(handle: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.profile_relation(conn, ctx.actor, _pid(conn, handle)))


def _toggle(ctx, handle, fn, on, bucket=None):
    if bucket and on:
        _limit_writes(ctx, bucket, service.FOLLOW_DAY)
    with ctx.db.write() as conn:
        return ok(ctx, fn(conn, ctx.actor, _pid(conn, handle), on, ctx.request_id))


@router.put('/follows/{handle}')
def follow(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.follow, True, 'follow')


@router.delete('/follows/{handle}')
def unfollow(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.follow, False)


@router.put('/stars/{handle}')
def star(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.star, True)


@router.delete('/stars/{handle}')
def unstar(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.star, False)


@router.put('/mutes/{handle}')
def mute(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.mute, True)


@router.delete('/mutes/{handle}')
def unmute(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.mute, False)


@router.put('/blocks/{handle}')
def block(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.block, True)


@router.delete('/blocks/{handle}')
def unblock(handle: str, ctx: Ctx = Depends(write_ctx)):
    return _toggle(ctx, handle, service.block, False)


@router.post('/pokes/{handle}')
def poke(handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.poke(conn, ctx.actor, _pid(conn, handle), ctx.request_id))


@router.get('/relations')
def relations(kind: Literal['following', 'followers', 'friends', 'starred', 'muted', 'blocked'] = 'friends',
              limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'relations', cursor, limit, kind)
    with ctx.db.read() as conn:
        items, next_key = service.relations(conn, ctx.actor, kind, after, size)
    return _paged(ctx, items, next_key, qhash)


@router.get('/suggestions/dismissed')
def dismissed_suggestions(cursor: Optional[str] = None, limit: Optional[int] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'suggestions-dismissed', cursor, limit)
    with ctx.db.read() as conn:
        items, next_key = service.dismissed_suggestions(conn, ctx.actor, after, size)
    return _paged(ctx, items, next_key, qhash)


@router.get('/suggestions')
def suggestions(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': service.suggestions(conn, ctx.actor)})


# ---------- 动态 ----------

@router.post('/posts', status_code=201)
def create_post(body: PostIn, ctx: Ctx = Depends(write_ctx)):
    data = body.model_dump(exclude_none=True)

    def work(conn):
        post_id = service.create_post(conn, ctx.actor, data, ctx.request_id)
        return 201, ok(ctx, service.post_detail(conn, ctx.actor, post_id, ctx.settings.content_origin))
    _limit_writes(ctx, 'post', service.POST_BURST, service.POST_DAY)
    return idempotency.run(ctx, data, work)


@router.get('/feed')
def feed(tab: Literal['all', 'friends', 'groups'] = 'all', limit: Optional[int] = None,
         cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'feed', cursor, limit, tab)
    with ctx.db.read() as conn:
        items, next_key = service.feed(conn, ctx.actor, tab, after, size, ctx.settings.content_origin)
    return _paged(ctx, items, next_key, qhash)


@router.get('/feed/new-count')
def new_count(since: str, tab: Literal['all', 'friends', 'groups'] = 'all', ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'count': service.new_count(conn, ctx.actor, since, tab)})


@router.get('/posts/{post_id}')
def post(post_id: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.post_detail(conn, ctx.actor, post_id, ctx.settings.content_origin))


@router.delete('/posts/{post_id}')
def delete_post(post_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.delete_post(conn, ctx.settings, ctx.actor, post_id, ctx.request_id))


@router.put('/posts/{post_id}/reaction')
def react(post_id: str, body: ReactionIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.react(conn, ctx.actor, post_id, body.kind, ctx.request_id))


@router.delete('/posts/{post_id}/reaction')
def unreact(post_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.react(conn, ctx.actor, post_id, None, ctx.request_id))


@router.get('/posts/{post_id}/reactions')
def reactions(post_id: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': service.reactors(conn, ctx.actor, post_id),
                        'summary': service.reaction_summary(conn, ctx.actor, post_id)})


@router.post('/posts/{post_id}/shares', status_code=201)
def share(post_id: str, body: ShareIn, ctx: Ctx = Depends(write_ctx)):
    data = body.model_dump(exclude_none=True)

    def work(conn):
        new_id = service.share(conn, ctx.actor, post_id, data.get('note'), data.get('scope'), data.get('group'),
                               ctx.request_id)
        return 201, ok(ctx, service.post_detail(conn, ctx.actor, new_id, ctx.settings.content_origin))
    _limit_writes(ctx, 'post', service.POST_BURST, service.POST_DAY)
    return idempotency.run(ctx, {'post_id': post_id, **data}, work)


@router.put('/posts/{post_id}/vote')
def vote(post_id: str, body: VoteIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.vote(conn, ctx.actor, post_id, body.option, ctx.request_id))


@router.get('/walls/{handle}')
def wall(handle: str, limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        owner = _pid(conn, handle)
        size, qhash, after = _page(ctx, 'wall', cursor, limit, owner)
        items, next_key = service.wall(conn, ctx.actor, owner, after, size, ctx.settings.content_origin)
    return _paged(ctx, items, next_key, qhash)


# ---------- 小组 ----------

@router.get('/groups')
def groups(category: Optional[Literal['tech', 'career', 'industry', 'community']] = None,
           ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': service.list_groups(conn, ctx.actor, category), 'categories': service.CATEGORIES})


@router.post('/groups', status_code=201)
def create_group(body: GroupIn, ctx: Ctx = Depends(write_ctx)):
    data = body.model_dump(exclude_none=True)

    def work(conn):
        slug = service.create_group(conn, ctx.actor, data, ctx.request_id)
        return 201, ok(ctx, service.group_detail(conn, ctx.actor, slug, ctx.settings.content_origin))
    return idempotency.run(ctx, data, work)


@router.get('/groups/{slug}')
def group(slug: str, ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, service.group_detail(conn, ctx.actor, slug, ctx.settings.content_origin))


@router.get('/groups/{slug}/feed')
def group_feed(slug: str, view: Literal['all', 'featured'] = 'all', limit: Optional[int] = None,
               cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'group', cursor, limit, slug, view)
    with ctx.db.read() as conn:
        items, next_key = service.group_feed(conn, ctx.actor, slug, view, after, size, ctx.settings.content_origin)
    return _paged(ctx, items, next_key, qhash)


@router.post('/groups/{slug}/join')
def join(slug: str, body: Optional[JoinIn] = None, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.join_group(conn, ctx.actor, slug, body.note if body else None, ctx.request_id))


@router.post('/groups/{slug}/leave')
def leave(slug: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.leave_group(conn, ctx.actor, slug, ctx.request_id))


@router.get('/groups/{slug}/members')
def members(slug: str, state: Literal['active', 'pending'] = 'active', limit: Optional[int] = None,
            cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'members', cursor, limit, slug, state)
    with ctx.db.read() as conn:
        items, next_key = service.group_members(conn, ctx.actor, slug, state, after, size)
    return _paged(ctx, items, next_key, qhash)


@router.post('/groups/{slug}/requests/{handle}/approve')
def approve(slug: str, handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.review(conn, ctx.actor, slug, _pid(conn, handle), True, ctx.request_id))


@router.post('/groups/{slug}/requests/{handle}/reject')
def reject(slug: str, handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.review(conn, ctx.actor, slug, _pid(conn, handle), False, ctx.request_id))


@router.delete('/groups/{slug}/members/{handle}')
def remove_member(slug: str, handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.remove_member(conn, ctx.actor, slug, _pid(conn, handle), ctx.request_id))


@router.put('/groups/{slug}/admins/{handle}')
def add_admin(slug: str, handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.set_admin(conn, ctx.actor, slug, _pid(conn, handle), True, ctx.request_id))


@router.delete('/groups/{slug}/admins/{handle}')
def drop_admin(slug: str, handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.set_admin(conn, ctx.actor, slug, _pid(conn, handle), False, ctx.request_id))


@router.put('/groups/{slug}/pins/{post_id}')
def add_pin(slug: str, post_id: str, kind: Literal['pin', 'featured'] = 'pin', ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.pin(conn, ctx.actor, slug, post_id, kind, True, ctx.request_id))


@router.delete('/groups/{slug}/pins/{post_id}')
def drop_pin(slug: str, post_id: str, kind: Literal['pin', 'featured'] = 'pin', ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, service.pin(conn, ctx.actor, slug, post_id, kind, False, ctx.request_id))


# ---------- 祝福、关掉推荐人、阅读入口 ----------

@router.get('/anniversaries')
def anniversaries(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': extras.anniversaries(conn, ctx.actor)})


@router.post('/blessings/{handle}')
def bless(handle: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, extras.bless(conn, ctx.actor, _pid(conn, handle), ctx.request_id))
    return idempotency.run(ctx, {'handle': handle}, work)


@router.post('/suggestions/{handle}/dismiss')
def dismiss_suggestion(handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.dismiss_suggestion(conn, ctx.actor, _pid(conn, handle), True, ctx.request_id))


@router.delete('/suggestions/{handle}/dismiss')
def restore_suggestion(handle: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.dismiss_suggestion(conn, ctx.actor, _pid(conn, handle), False, ctx.request_id))


@router.get('/signals')
def signals(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': extras.signals(conn, ctx.actor)})


@router.put('/signals/{key}')
def save_signal(key: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.save_signal(conn, ctx.actor, key, True))


@router.delete('/signals/{key}')
def drop_signal(key: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.save_signal(conn, ctx.actor, key, False))


# ---------- 找搭子 ----------

@router.get('/buddies')
def buddies(kind: Optional[Literal['project', 'learn', 'review']] = None, mine: bool = False,
            limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'buddies', cursor, limit, kind or '', 'mine' if mine else 'all')
    with ctx.db.read() as conn:
        items, next_key = extras.buddy_posts(conn, ctx.actor, kind, mine, after, size)
    return _paged(ctx, items, next_key, qhash)


@router.post('/buddies', status_code=201)
def create_buddy(body: BuddyIn, ctx: Ctx = Depends(write_ctx)):
    data = body.model_dump()
    _limit_writes(ctx, 'buddy', (extras.BUDDY_DAY, 86400))
    return idempotency.run(ctx, data, lambda conn: (201, ok(ctx, extras.create_buddy_post(conn, ctx.actor, data, ctx.request_id))))


@router.patch('/buddies/{post_id}')
def update_buddy(post_id: str, body: BuddyPatch, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.update_buddy_post(conn, ctx.actor, post_id, body.model_dump(exclude_none=True), ctx.request_id))


@router.get('/buddy-invites')
def buddy_invites(box: Literal['sent', 'received'] = 'sent', limit: Optional[int] = None,
                  cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'buddy-invites', cursor, limit, box)
    with ctx.db.read() as conn:
        items, next_key = extras.buddy_invites(conn, ctx.actor, box, after, size)
    return _paged(ctx, items, next_key, qhash)


@router.post('/buddy-invites/{handle}', status_code=201)
def send_invite(handle: str, body: InviteIn, ctx: Ctx = Depends(write_ctx)):
    data = body.model_dump()
    _limit_writes(ctx, 'invite', (extras.INVITE_DAY * 3, 86400))

    def work(conn):
        return 201, ok(ctx, extras.send_invite(conn, ctx.actor, _pid(conn, handle), data, ctx.request_id))
    return idempotency.run(ctx, {'handle': handle, **data}, work)


@router.patch('/buddy-invites/{invite_id}')
def update_invite(invite_id: str, body: InvitePatch, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.update_invite(conn, ctx.actor, invite_id, body.model_dump(exclude_none=True), ctx.request_id))


@router.delete('/buddy-invites/{invite_id}')
def withdraw_invite(invite_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.withdraw_invite(conn, ctx.actor, invite_id, ctx.request_id))


@router.post('/buddy-invites/{invite_id}/answer')
def answer_invite(invite_id: str, body: AnswerIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.answer_invite(conn, ctx.actor, invite_id, body.accept, ctx.request_id))


@router.post('/buddies/{post_id}/report', status_code=201)
def report_buddy_post(post_id: str, body: ReportIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 201, ok(ctx, extras.report_buddy_post(conn, ctx.actor, post_id, body.reason, ctx.request_id))
    return idempotency.run(ctx, {'post': post_id, 'reason': body.reason}, work)


@router.post('/buddy-invites/{invite_id}/report', status_code=201)
def report_buddy_invite(invite_id: str, body: ReportIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 201, ok(ctx, extras.report_buddy_invite(conn, ctx.actor, invite_id, body.reason, ctx.request_id))
    return idempotency.run(ctx, {'invite': invite_id, 'reason': body.reason}, work)


# ---------- 赞助与讲师申请（只是申请表，不涉及钱） ----------

@router.get('/applications')
def my_applications(ctx: Ctx = Depends(user_ctx)):
    with ctx.db.read() as conn:
        return ok(ctx, {'items': extras.my_applications(conn, ctx.actor)})


@router.put('/applications/sponsor')
def apply_sponsor(body: SponsorIn, ctx: Ctx = Depends(write_ctx)):
    _limit_writes(ctx, 'apply', (extras.APPLY_DAY, 86400))
    fields = body.model_dump()
    fields['types'] = list(dict.fromkeys(fields['types']))
    with ctx.db.write() as conn:
        return ok(ctx, extras.save_application(conn, ctx.actor, 'sponsor', fields, ctx.request_id))


@router.put('/applications/lecturer')
def apply_lecturer(body: LecturerIn, ctx: Ctx = Depends(write_ctx)):
    _limit_writes(ctx, 'apply', (extras.APPLY_DAY, 86400))
    with ctx.db.write() as conn:
        return ok(ctx, extras.save_application(conn, ctx.actor, 'lecturer', body.model_dump(), ctx.request_id))


@router.delete('/applications/{kind}')
def withdraw_application(kind: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.withdraw_application(conn, ctx.actor, kind, ctx.request_id))


# ---------- 管理 ----------

@admin_router.post('/boards')
def seed_boards(ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, {'created': service.seed_boards(conn, ctx.actor, ctx.request_id)})


@admin_router.get('/applications')
def review_applications(kind: Optional[Literal['sponsor', 'lecturer']] = None,
                        state: Literal['submitted', 'approved', 'rejected'] = 'submitted',
                        limit: Optional[int] = None, cursor: Optional[str] = None, ctx: Ctx = Depends(user_ctx)):
    size, qhash, after = _page(ctx, 'applications', cursor, limit, kind or '', state)
    with ctx.db.read() as conn:
        items, next_key = extras.review_list(conn, ctx.actor, kind, state, after, size)
    return _paged(ctx, items, next_key, qhash)


@admin_router.post('/applications/{app_id}/decision')
def decide_application(app_id: str, body: DecisionIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        return ok(ctx, extras.review_decide(conn, ctx.actor, app_id, body.decision, body.note, ctx.request_id))
