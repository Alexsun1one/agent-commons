"""Member-owned data export. Queries deliberately exclude other members' private state."""

from app import accounts


def export(conn, actor):
    queries = {
        'lot': 'SELECT * FROM parking_lot WHERE owner_id = :pid',
        'spaces': 'SELECT * FROM parking_space WHERE owner_id = :pid',
        'vehicles': 'SELECT * FROM parking_vehicle WHERE owner_id = :pid',
        'stays': 'SELECT s.* FROM parking_stay s JOIN parking_vehicle v ON v.id = s.vehicle_id WHERE v.owner_id = :pid',
    }
    return {key: [dict(row) for row in conn.execute(sql, {'pid': actor.id})]
            for key, sql in queries.items()}


accounts.register_exporter('parking', export)
