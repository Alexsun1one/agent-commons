"""注销时移除可识别的停车数据。"""
from app import accounts


def purge(conn, principal_id):
    vehicle_ids = [row[0] for row in conn.execute('SELECT id FROM parking_vehicle WHERE owner_id = ?',
                                                   (principal_id,))]
    if vehicle_ids:
        marks = ','.join('?' * len(vehicle_ids))
        conn.execute(f'DELETE FROM parking_stay WHERE vehicle_id IN ({marks})', vehicle_ids)
    conn.execute('DELETE FROM parking_stay WHERE lot_owner_id = ?', (principal_id,))
    conn.execute('DELETE FROM parking_vehicle WHERE owner_id = ?', (principal_id,))
    conn.execute('DELETE FROM parking_lot WHERE owner_id = ?', (principal_id,))


accounts.register_purger(purge)

