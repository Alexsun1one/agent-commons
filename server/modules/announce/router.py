"""公告读接口与 /api/admin/announce 管理接口。"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import idempotency, security
from app.context import Ctx, ok, user_ctx, write_ctx

from . import hooks, service  # noqa: F401


router = APIRouter(prefix='/api/announce')
admin_router = APIRouter(prefix='/api/admin/announce')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PrefIn(Strict):
    marquee_on: Optional[bool] = None
    ads_on: Optional[bool] = None


class EventIn(Strict):
    placement: str = Field(max_length=32)
    route: str = Field(default='', max_length=200)


class ItemIn(Strict):
    level: str
    title: str
    body: str
    audience: str
    min_level: Optional[int] = None
    group_id: Optional[str] = None
    starts_at: str
    ends_at: Optional[str] = None
    dismissible: bool
    status: str = 'active'


class ItemPatch(Strict):
    level: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    audience: Optional[str] = None
    min_level: Optional[int] = None
    group_id: Optional[str] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    dismissible: Optional[bool] = None
    status: Optional[str] = None


class TickerIn(Strict):
    body: str
    kind: str = 'manual'
    public: bool = True
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None


class TickerPatch(Strict):
    body: Optional[str] = None
    enabled: Optional[bool] = None
    public: Optional[bool] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None


class CampaignIn(Strict):
    name: str
    placement: str
    image_url: str
    line: str
    link_url: str
    why: str
    starts_at: str
    ends_at: str
    freq_cap: int = 3
    status: str = 'active'


class CampaignPatch(Strict):
    name: Optional[str] = None
    placement: Optional[str] = None
    image_url: Optional[str] = None
    line: Optional[str] = None
    link_url: Optional[str] = None
    why: Optional[str] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    freq_cap: Optional[int] = None
    status: Optional[str] = None


def admin_ctx(ctx: Ctx = Depends(user_ctx)) -> Ctx:
    security.limit(ctx.request, 'admin', ctx.actor.id)
    return ctx


@router.get('/active')
def get_active(route: str = Query(default='', max_length=200), ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.active(ctx.db.conn(), ctx.actor, route))


@router.get('/history')
def get_history(ctx: Ctx = Depends(user_ctx)):
    return ok(ctx, service.history(ctx.db.conn(), ctx.actor))


@router.post('/items/{item_id}/dismiss')
def dismiss_item(item_id: str, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.dismiss(conn, ctx.actor, item_id))
    return idempotency.run(ctx, {}, work)


@router.post('/prefs')
def put_prefs(body: PrefIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.save_pref(conn, ctx.actor, body.marquee_on, body.ads_on))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/campaigns/{campaign_id}/impression')
def post_impression(campaign_id: str, body: EventIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.record_impression(conn, ctx.actor, campaign_id, body.placement, body.route))
    return idempotency.run(ctx, body.model_dump(), work)


@router.post('/campaigns/{campaign_id}/click')
def post_click(campaign_id: str, body: EventIn, ctx: Ctx = Depends(write_ctx)):
    def work(conn):
        return 200, ok(ctx, service.record_click(conn, ctx.actor, campaign_id, body.placement, body.route))
    return idempotency.run(ctx, body.model_dump(), work)


@admin_router.get('/items')
def admin_items(ctx: Ctx = Depends(admin_ctx)):
    return ok(ctx, service.list_items(ctx.db.conn(), ctx.actor))


@admin_router.post('/items', status_code=201)
def admin_create_item(body: ItemIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 201, ok(ctx, service.create_item(conn, ctx.actor, body.model_dump(), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@admin_router.patch('/items/{item_id}')
def admin_update_item(item_id: str, body: ItemPatch, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 200, ok(ctx, service.update_item(
            conn, ctx.actor, item_id, body.model_dump(exclude_unset=True), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(exclude_unset=True), work)


@admin_router.get('/ticker')
def admin_ticker(ctx: Ctx = Depends(admin_ctx)):
    return ok(ctx, service.list_ticker(ctx.db.conn(), ctx.actor))


@admin_router.post('/ticker', status_code=201)
def admin_create_ticker(body: TickerIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 201, ok(ctx, service.create_ticker(conn, ctx.actor, body.model_dump(), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@admin_router.patch('/ticker/{ticker_id}')
def admin_update_ticker(ticker_id: str, body: TickerPatch, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 200, ok(ctx, service.update_ticker(
            conn, ctx.actor, ticker_id, body.model_dump(exclude_unset=True), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(exclude_unset=True), work)


@admin_router.get('/campaigns')
def admin_campaigns(ctx: Ctx = Depends(admin_ctx)):
    return ok(ctx, service.list_campaigns(ctx.db.conn(), ctx.actor))


@admin_router.post('/campaigns', status_code=201)
def admin_create_campaign(body: CampaignIn, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 201, ok(ctx, service.create_campaign(conn, ctx.actor, body.model_dump(), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(), work)


@admin_router.patch('/campaigns/{campaign_id}')
def admin_update_campaign(campaign_id: str, body: CampaignPatch, ctx: Ctx = Depends(admin_ctx)):
    def work(conn):
        return 200, ok(ctx, service.update_campaign(
            conn, ctx.actor, campaign_id, body.model_dump(exclude_unset=True), ctx.request_id))
    return idempotency.run(ctx, body.model_dump(exclude_unset=True), work)


@admin_router.get('/calendar')
def admin_calendar(start: str = Query(min_length=10, max_length=32), end: str = Query(min_length=10, max_length=32),
                   ctx: Ctx = Depends(admin_ctx)):
    return ok(ctx, service.calendar(ctx.db.conn(), ctx.actor, start, end))


@admin_router.get('/stats')
def admin_stats(ctx: Ctx = Depends(admin_ctx)):
    return ok(ctx, service.stats(ctx.db.conn(), ctx.actor))
