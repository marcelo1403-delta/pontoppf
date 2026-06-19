const DEFAULT_PROJECT_ID = "ponto-ppf";
const DEFAULT_API_KEY = "AIzaSyDwC527eWp7Ubwdc0WvBLnSJkvPjfHKZrs";
let cachedToken = null;
let cachedTokenExpiresAt = 0;

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const url = new URL(context.request.url);
  if (context.request.headers.get("Origin") !== url.origin) return json({ error: "Origem não autorizada." }, 403);
  const input = await context.request.json().catch(() => null);
  const targetUid = String(input?.targetUid || "").trim();
  const date = String(input?.date || "");
  const gecc = String(input?.gecc || "").trim();
  const geccMinutes = parseMinutes(gecc) ?? (gecc ? null : 0);
  if (!targetUid || !/^\d{4}-\d{2}-\d{2}$/.test(date) || geccMinutes === null) return json({ error: "Dados de GECC inválidos." }, 400);
  if (geccMinutes > 180) return json({ error: "As horas de GECC não podem ultrapassar 03 horas." }, 400);

  const config = {
    projectId: context.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apiKey: context.env.FIREBASE_API_KEY || DEFAULT_API_KEY,
    clientEmail: context.env.FIREBASE_CLIENT_EMAIL,
    privateKey: context.env.FIREBASE_PRIVATE_KEY
  };
  if (!config.clientEmail || !config.privateKey) return json({ error: "Backend administrativo não configurado." }, 503);

  try {
    const idToken = (context.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const actorUid = await lookupUid(config.apiKey, idToken);
    const accessToken = await getAccessToken(config);
    const role = await profileRole(config.projectId, accessToken, actorUid);
    if (!["admin", "gestor"].includes(role)) return json({ error: "Acesso negado." }, 403);

    const competencia = date.slice(0, 7);
    const dayKey = date.slice(8, 10);
    const recordId = `${targetUid}_${competencia}`;
    const record = await getDocument(config.projectId, accessToken, "registrosPonto", recordId);
    if (!record) return json({ error: "O usuário ainda não possui horários registrados nesta competência." }, 409);
    const day = record.fields?.dias?.mapValue?.fields?.[dayKey]?.mapValue?.fields;
    if (!day) return json({ error: "O usuário ainda não possui horários registrados nesta data." }, 409);
    const worked = Number(day.minutosTrabalhados?.integerValue || computeWorkedMinutes(day));
    if (geccMinutes > worked) return json({ error: "As horas de GECC não podem ultrapassar as horas trabalhadas." }, 400);

    await writeGecc(config.projectId, accessToken, recordId, dayKey, gecc, geccMinutes, actorUid);
    return json({ ok: true, horasGecc: gecc, minutosGecc: geccMinutes });
  } catch (error) {
    console.error("Falha ao gravar GECC.", { status: error?.status, message: String(error?.message || "").slice(0, 300) });
    return json({ error: error?.status && error.status < 500 ? error.message : "Não foi possível gravar GECC." }, error?.status || 500);
  }
}

async function lookupUid(apiKey, idToken) {
  if (!idToken) throw statusError(401, "Sessão inválida.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken })
  });
  const data = await readJson(response);
  if (!response.ok || !data?.users?.[0]?.localId) throw statusError(401, "Sessão inválida.");
  return data.users[0].localId;
}

async function profileRole(projectId, accessToken, uid) {
  for (const collectionId of ["pessoas", "usuarios"]) {
    const document = await getDocument(projectId, accessToken, collectionId, uid);
    const role = document?.fields?.perfil?.stringValue;
    if (role) return String(role).toLowerCase();
  }
  for (const collectionId of ["pessoas", "usuarios"]) {
    const response = await fetch(`${documentsBase(projectId)}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } },
        limit: 1
      } })
    });
    const data = await readJson(response);
    if (!response.ok) throw statusError(response.status, "Falha ao validar o perfil.");
    const role = (Array.isArray(data) ? data : []).find((item) => item.document)?.document?.fields?.perfil?.stringValue;
    if (role) return String(role).toLowerCase();
  }
  return "";
}

async function getDocument(projectId, accessToken, collectionId, documentId) {
  const response = await fetch(`${documentsBase(projectId)}/${collectionId}/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) return null;
  const data = await readJson(response);
  if (!response.ok) throw statusError(response.status, "Falha ao consultar o Firestore.");
  return data;
}

async function writeGecc(projectId, accessToken, recordId, dayKey, gecc, minutes, actorUid) {
  const now = new Date().toISOString();
  const values = {
    horasGecc: { stringValue: gecc },
    minutosGecc: { integerValue: String(minutes) },
    geccRegistradoPorUid: { stringValue: actorUid },
    geccAtualizadoEm: { timestampValue: now }
  };
  const prefix = `dias.\`${dayKey}\``;
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{
      update: {
        name: `projects/${projectId}/databases/(default)/documents/registrosPonto/${recordId}`,
        fields: { dias: { mapValue: { fields: { [dayKey]: { mapValue: { fields: values } } } } } }
      },
      updateMask: { fieldPaths: Object.keys(values).map((field) => `${prefix}.${field}`) },
      currentDocument: { exists: true }
    }] })
  });
  const data = await readJson(response);
  if (!response.ok) throw statusError(response.status, data?.error?.message || "Falha ao gravar GECC.");
}

function computeWorkedMinutes(day) {
  const value = (name) => day[name]?.stringValue || "";
  const shift = value("turno");
  const regular = interval(value("entrada1"), value("saida1"), shift === "noturno") + interval(value("entrada2"), value("saida2"), false);
  const night = interval(value("entradaNoturna"), value("saidaNoturna"), true);
  if (shift === "noturno") return night || regular;
  if (shift === "misto") return regular + night;
  return regular + night;
}

function interval(start, end, overnight) {
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);
  if (startMinutes === null || endMinutes === null) return 0;
  if (endMinutes <= startMinutes) return overnight ? 1440 - startMinutes + endMinutes : 0;
  return endMinutes - startMinutes;
}

function parseMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

async function getAccessToken(config) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: "RS256", typ: "JWT" }, { iss: config.clientEmail, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }, config.privateKey);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const data = await readJson(response);
  if (!response.ok) throw statusError(503, "Backend indisponível.");
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

async function signJwt(header, payload, pem) {
  const unsigned = `${base64Url(new TextEncoder().encode(JSON.stringify(header)))}.${base64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBuffer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function pemBuffer(pem) {
  const base64 = String(pem).replace(/\\n/g, "\n").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function documentsBase(projectId) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`; }
async function readJson(response) { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return null; } }
function statusError(status, message) { const error = new Error(message); error.status = status; return error; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
