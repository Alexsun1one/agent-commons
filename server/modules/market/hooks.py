"""R13 MARKET-1 · 注销清理：只删「我想要」这类社交信号。

市集帖子由核心 objects 撤回，保留对象历史给申诉和审计；
举报记录属于治理证据，不随举报人注销删除。
"""

from app import accounts


def purge(conn, principal_id):
    conn.execute('DELETE FROM market_interest WHERE principal_id = ?', (principal_id,))


accounts.register_purger(purge)
