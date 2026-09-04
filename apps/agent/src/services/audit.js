/**
 * Registro de quién entró, qué lanzó y qué tocó. En VPN es opcional; publicado
 * en internet es indispensable, y sale barato tenerlo desde el principio.
 */
export function createAudit(db) {
  const insert = db.prepare('INSERT INTO audit (at, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT ?');
  return {
    log(userId, action, detail, ip) {
      try {
        insert.run(Date.now(), userId ?? null, action,
          detail ? JSON.stringify(detail) : null, ip ?? null);
      } catch {
        // Auditar no debe poder tumbar la operación auditada.
      }
    },
    recent(limit = 200) {
      return recent.all(limit).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
    },
  };
}
