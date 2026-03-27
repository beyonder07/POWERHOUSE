function writeJobLog(dbManager, payload) {
  const db = dbManager.getDb();
  db.prepare(`
    INSERT INTO job_logs(job_name, status, details, error, started_at, finished_at, created_at)
    VALUES (@jobName, @status, @details, @error, @startedAt, @finishedAt, datetime('now'))
  `).run({
    jobName: payload.jobName,
    status: payload.status,
    details: payload.details ? JSON.stringify(payload.details) : null,
    error: payload.error || null,
    startedAt: payload.startedAt || null,
    finishedAt: payload.finishedAt || null
  });
}

function listRecentJobLogs(dbManager, limit = 100) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT id, job_name AS jobName, status, details, error, started_at AS startedAt, finished_at AS finishedAt, created_at AS createdAt
    FROM job_logs
    ORDER BY id DESC
    LIMIT @limit
  `).all({ limit });
}

module.exports = {
  writeJobLog,
  listRecentJobLogs
};
