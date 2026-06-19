const DEFAULT_PROJECT_ID = "ponto-ppf";
const DEFAULT_API_KEY = "AIzaSyDwC527eWp7Ubwdc0WvBLnSJkvPjfHKZrs";
const BACKUP_FORMAT = "ponto-ppf-firestore-backup";
const BACKUP_VERSION = 1;
const MAX_BATCH_WRITES = 400;

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const origin = context.request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "Origem não autorizada." }, 403);

  const config = firebaseConfig(context.env);
  if (!config.clientEmail || !config.privateKey) return json({ error: "Backend administrativo não configurado." }, 503);

  try {
    const accessToken = await getGoogleAccessToken(config);
    const cronAuthorized = context.env.BACKUP_CRON_SECRET
      && context.request.headers.get("X-Backup-Cron") === context.env.BACKUP_CRON_SECRET;
    const actor = cronAuthorized ? { uid: "cron", role: "admin", nome: "Backup automático" }
      : await authorizeUser(context.request, config, accessToken);

    if (context.request.method === "GET") {
      if (!cronAuthorized && !["admin", "gestor"].includes(actor.role)) return json({ error: "Acesso negado." }, 403);
      if (url.searchParams.get("list") === "1") return listStoredBackups(context.env, actor);
      if (url.searchParams.get("key")) return downloadStoredBackup(context.env, url.searchParams.get("key"));

      const backup = await createFirestoreBackup(config.projectId, accessToken, actor);
      const filename = backupFilename(backup.createdAt);
      if (url.searchParams.get("store") === "1") {
        if (!context.env.BACKUPS) return json({ error: "Bucket R2 BACKUPS não configurado." }, 503);
        const key = `firestore/${filename}`;
        await context.env.BACKUPS.put(key, JSON.stringify(backup), {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: { projectId: config.projectId, createdAt: backup.createdAt, createdBy: actor.uid }
        });
        await trimStoredBackups(context.env.BACKUPS, 30);
        return json({ ok: true, key, filename, summary: backup.summary }, 201);
      }
      return backupResponse(backup, filename);
    }

    if (context.request.method === "POST") {
      if (actor.role !== "admin") return json({ error: "Somente administrador pode restaurar backups." }, 403);
      const backup = await context.request.json().catch(() => null);
      validateBackup(backup, config.projectId);
      const result = await restoreFirestoreBackup(config.projectId, accessToken, backup);
      return json({ ok: true, ...result });
    }

    return json({ error: "Método não permitido." }, 405, { Allow: "GET, POST" });
  } catch (error) {
    console.error("Falha na rotina de backup.", safeError(error));
    return json({ error: publicError(error) }, error.status || 500);
  }
}

function firebaseConfig(env) {
  return {
    projectId: env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apiKey: env.FIREBASE_API_KEY || DEFAULT_API_KEY,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  };
}

async function authorizeUser(request, config, accessToken) {
  const authorization = request.headers.get("Authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!idToken) throw statusError(401, "Sessão administrativa ausente.");

  const lookupResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const lookup = await readJsonResponse(lookupResponse);
  if (!lookupResponse.ok || !lookup?.users?.[0]?.localId) throw statusError(401, "Sessão inválida ou expirada.");
  const uid = lookup.users[0].localId;
  const profile = await findProfile(config.projectId, accessToken, uid);
  const role = firestoreString(profile?.fields?.perfil).toLowerCase();
  if (!role) throw statusError(403, "Perfil administrativo não encontrado.");
  return { uid, role, nome: firestoreString(profile.fields.nome) || lookup.users[0].email || uid };
}

async function findProfile(projectId, accessToken, uid) {
  for (const collectionId of ["pessoas", "usuarios"]) {
    const endpoint = `${documentsBase(projectId)}/${encodeURIComponent(collectionId)}/${encodeURIComponent(uid)}`;
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.ok) return readJsonResponse(response);
    if (response.status !== 404) throw statusError(response.status, "Não foi possível validar o perfil.");
  }
  for (const collectionId of ["pessoas", "usuarios"]) {
    const documents = await runUidQuery(projectId, accessToken, collectionId, uid);
    if (documents[0]) return documents[0];
  }
  return null;
}

async function runUidQuery(projectId, accessToken, collectionId, uid) {
  const response = await fetch(`${documentsBase(projectId)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } },
      limit: 1
    } })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw statusError(response.status, "Não foi possível consultar o perfil.");
  return (Array.isArray(data) ? data : []).map((item) => item.document).filter(Boolean);
}

async function createFirestoreBackup(projectId, accessToken, actor) {
  const collectionIds = await listRootCollectionIds(projectId, accessToken);
  const collections = {};
  let documentCount = 0;
  for (const collectionId of collectionIds.sort()) {
    const documents = await listCollectionDocuments(projectId, accessToken, collectionId);
    collections[collectionId] = documents.map((document) => ({
      id: document.name.split("/").pop(),
      fields: document.fields || {},
      createTime: document.createTime || null,
      updateTime: document.updateTime || null
    }));
    documentCount += documents.length;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    projectId,
    createdAt: new Date().toISOString(),
    createdBy: { uid: actor.uid, nome: actor.nome, role: actor.role },
    scope: "root-collections",
    summary: { collections: collectionIds.length, documents: documentCount },
    collections
  };
}

async function listRootCollectionIds(projectId, accessToken) {
  const ids = [];
  let pageToken = "";
  do {
    const response = await fetch(`${documentsBase(projectId)}:listCollectionIds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw statusError(response.status, "Não foi possível listar as coleções.");
    ids.push(...(data?.collectionIds || []));
    pageToken = data?.nextPageToken || "";
  } while (pageToken);
  return [...new Set(ids)];
}

async function listCollectionDocuments(projectId, accessToken, collectionId) {
  const documents = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "300", showMissing: "false" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`${documentsBase(projectId)}/${encodeURIComponent(collectionId)}?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw statusError(response.status, `Não foi possível exportar ${collectionId}.`);
    documents.push(...(data?.documents || []));
    pageToken = data?.nextPageToken || "";
  } while (pageToken);
  return documents;
}

function validateBackup(backup, projectId) {
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw statusError(400, "Arquivo de backup inválido ou incompatível.");
  }
  if (backup.projectId !== projectId) throw statusError(400, "O backup pertence a outro projeto Firebase.");
  if (!backup.collections || typeof backup.collections !== "object" || Array.isArray(backup.collections)) {
    throw statusError(400, "O backup não contém coleções válidas.");
  }
}

async function restoreFirestoreBackup(projectId, accessToken, backup) {
  const writes = [];
  for (const [collectionId, documents] of Object.entries(backup.collections)) {
    if (!Array.isArray(documents) || !collectionId || collectionId.includes("/")) throw statusError(400, "Coleção inválida no backup.");
    for (const document of documents) {
      if (!document?.id || String(document.id).includes("/")) throw statusError(400, "Documento inválido no backup.");
      writes.push({ update: {
        name: `projects/${projectId}/databases/(default)/documents/${collectionId}/${document.id}`,
        fields: document.fields || {}
      } });
    }
  }

  for (let index = 0; index < writes.length; index += MAX_BATCH_WRITES) {
    const batch = writes.slice(index, index + MAX_BATCH_WRITES);
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes: batch })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw statusError(response.status, data?.error?.message || "Falha ao restaurar documentos.");
  }
  return { collections: Object.keys(backup.collections).length, documents: writes.length, mode: "merge" };
}

async function listStoredBackups(env, actor) {
  if (!env.BACKUPS) return json({ configured: false, backups: [] });
  const listed = await env.BACKUPS.list({ prefix: "firestore/", limit: 100 });
  const backups = listed.objects.sort((a, b) => b.uploaded - a.uploaded).map((item) => ({
    key: item.key,
    size: item.size,
    uploaded: item.uploaded,
    download: `/api/admin/backup?key=${encodeURIComponent(item.key)}`
  }));
  return json({ configured: true, actor: actor.uid, backups });
}

async function downloadStoredBackup(env, key) {
  if (!env.BACKUPS || !String(key).startsWith("firestore/")) return json({ error: "Backup armazenado não encontrado." }, 404);
  const object = await env.BACKUPS.get(key);
  if (!object) return json({ error: "Backup armazenado não encontrado." }, 404);
  return new Response(object.body, { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  } });
}

async function trimStoredBackups(bucket, keep) {
  const listed = await bucket.list({ prefix: "firestore/", limit: 1000 });
  const excess = listed.objects.sort((a, b) => b.uploaded - a.uploaded).slice(keep);
  if (excess.length) await bucket.delete(excess.map((item) => item.key));
}

function backupFilename(createdAt) {
  return `ponto-ppf-backup-${createdAt.replace(/[:.]/g, "-")}.json`;
}

function backupResponse(backup, filename) {
  return new Response(JSON.stringify(backup), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  } });
}

function documentsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function firestoreString(value) {
  return String(value?.stringValue || "");
}

async function getGoogleAccessToken(config) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: "RS256", typ: "JWT" }, {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }, config.privateKey);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw statusError(response.status, data?.error_description || "Falha na autenticação administrativa.");
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function signJwt(header, payload, privateKeyPem) {
  const encodedHeader = base64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedToken));
  return `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem).replace(/\\n/g, "\n").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 500) } }; }
}

function publicError(error) {
  if (error.status && error.status < 500) return error.message;
  return "Não foi possível concluir a rotina de backup.";
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeError(error) {
  return { status: error?.status, message: String(error?.message || "Erro desconhecido").slice(0, 500) };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  } });
}
