function writeAuditLog(dbManager, payload) {
  const db = dbManager.getDb();
  const insertStmt = db.prepare(`
    INSERT INTO audit_logs(action, entity, entity_id, details)
    VALUES (@action, @entity, @entityId, @details)
  `);

  insertStmt.run({
    action: payload.action,
    entity: payload.entity,
    entityId: payload.entityId ?? null,
    details: payload.details ? JSON.stringify(payload.details) : null
  });
}

function listRecentAuditLogs(dbManager, limit = 100) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT id, action, entity, entity_id AS entityId, details, created_at AS createdAt
    FROM audit_logs
    ORDER BY id DESC
    LIMIT @limit
  `).all({ limit });
}

module.exports = {
  writeAuditLog,
  listRecentAuditLogs
};
