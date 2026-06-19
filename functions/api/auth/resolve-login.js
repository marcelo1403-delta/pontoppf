const DEFAULT_PROJECT_ID = "ponto-ppf";
const DEFAULT_API_KEY = "AIzaSyDwC527eWp7Ubwdc0WvBLnSJkvPjfHKZrs";
const COLLECTIONS = ["pessoas", "usuarios", "pedidosInclusao"];

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const url = new URL(context.request.url);
  if (context.request.headers.get("Origin") !== url.origin) return json({ error: "Origem não autorizada." }, 403);

  const input = await context.request.json().catch(() => null);
  const identifier = String(input?.identifier || "").trim().toLowerCase();
  const purpose = input?.purpose === "recover" ? "recover" : "login";
  if (!identifier || identifier.includes("@")) return json({ error: "Identificador inválido." }, 400);

  const config = {
    projectId: context.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apiKey: context.env.FIREBASE_API_KEY || DEFAULT_API_KEY,
    clientEmail: context.env.FIREBASE_CLIENT_EMAIL,
    privateKey: context.env.FIREBASE_PRIVATE_KEY
  };
  if (!config.clientEmail || !config.privateKey) return json({ error: "Serviço de autenticação não configurado." }, 503);

  try {
    const accessToken = await getAccessToken(config);
    const email = await resolveEmail(config.projectId, accessToken, identifier);

    if (purpose === "recover") {
      if (email) await sendPasswordReset(config.apiKey, email);
      return json({ ok: true });
    }

    if (!email || !input?.password) return json({ error: "Login ou senha inválidos." }, 401);
    await verifyPassword(config.apiKey, email, String(input.password));
    return json({ ok: true, email });
  } catch (error) {
    if (purpose === "recover") {
      console.error("Falha ao solicitar redefinição.", { status: error?.status, message: String(error?.message || "").slice(0, 300) });
      return json({ error: "Não foi possível solicitar a redefinição agora." }, 503);
    }
    console.error("Falha ao resolver login.", { status: error?.status, message: String(error?.message || "").slice(0, 300) });
    return json({ error: "Login ou senha inválidos." }, error?.status === 503 ? 503 : 401);
  }
}

async function resolveEmail(projectId, accessToken, identifier) {
  const digits = identifier.replace(/\D/g, "");
  const isCpf = digits.length === 11;
  const field = isCpf ? "cpf" : "matricula";
  const values = isCpf ? [formatCpf(digits), digits] : [identifier, digits].filter(Boolean);

  for (const collectionId of COLLECTIONS) {
    for (const value of [...new Set(values)]) {
      const document = await queryOne(projectId, accessToken, collectionId, field, value);
      const email = document?.fields?.emailAuth?.stringValue || document?.fields?.email?.stringValue;
      if (email) return String(email).trim().toLowerCase();
    }
  }
  return "";
}

async function queryOne(projectId, accessToken, collectionId, field, value) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } },
      limit: 1
    } })
  });
  const data = await readJson(response);
  if (!response.ok) throw statusError(response.status, "Consulta indisponível.");
  return (Array.isArray(data) ? data : []).find((item) => item.document)?.document || null;
}

async function verifyPassword(apiKey, email, password) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  if (!response.ok) throw statusError(401, "Credencial inválida.");
}

async function sendPasswordReset(apiKey, email) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
  });
  if (!response.ok) throw statusError(response.status, "Redefinição indisponível.");
}

async function getAccessToken(config) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
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

function formatCpf(digits) {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  } });
}
