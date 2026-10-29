from fastapi import APIRouter, Depends

from .. import flags
from ..context import Ctx, get_ctx, ok

router = APIRouter(prefix='/api/flags')


@router.get('')
def list_flags(ctx: Ctx = Depends(get_ctx)):
    return ok(ctx, flags.all_flags(ctx.db.conn()))
