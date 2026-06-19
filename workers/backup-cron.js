export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  }
};

async function runBackup(env) {
  if (!env.BACKUP_URL || !env.BACKUP_CRON_SECRET) {
    return new Response("BACKUP_URL ou BACKUP_CRON_SECRET ausente.", { status: 503 });
  }
  const endpoint = new URL("/api/admin/backup", env.BACKUP_URL);
  endpoint.searchParams.set("store", "1");
  const response = await fetch(endpoint, {
    headers: { "X-Backup-Cron": env.BACKUP_CRON_SECRET }
  });
  if (!response.ok) throw new Error(`Backup automático falhou: HTTP ${response.status}`);
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
