const DEFAULT_PROJECT_ID = "ponto-ppf";
const DEFAULT_API_KEY = "AIzaSyDwC527eWp7Ubwdc0WvBLnSJkvPjfHKZrs";
const UNIQUE_COLLECTION = "_cadastroUnicos";
const PEOPLE_COLLECTIONS = ["pessoas", "usuarios", "pedidosInclusao"];
const ALLOWED_LOTACOES = ["PFBRA", "PFCAT", "PFCG", "PFMOS", "PFPV", "SEDE"];
const ALLOWED_CARGOS = ["ESPECIALISTA", "PPF", "TECNICO"];

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export async function onRequest(context) {
  if (context.request.method === "PUT") return handleProfileUpdate(context);
  if (context.request.method !== "POST") {
    return json({ errors: ["Método não permitido."] }, 405, { Allow: "POST" });
  }

  const requestUrl = new URL(context.request.url);
  const origin = context.request.headers.get("Origin");
  if (origin !== requestUrl.origin) {
    return json({ errors: ["Solicitação de origem não autorizada."] }, 403);
  }

  let input;
  try {
    input = await context.request.json();
  } catch {
    return json({ errors: ["Dados de cadastro inválidos."] }, 400);
  }

  const profile = normalizeProfile(input);
  const validationErrors = validateInput(profile, input?.senha, input?.confirmaSenha);
  if (validationErrors.length) return json({ errors: validationErrors }, 400);

  const config = {
    projectId: context.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apiKey: context.env.FIREBASE_API_KEY || DEFAULT_API_KEY,
    clientEmail: context.env.FIREBASE_CLIENT_EMAIL,
    privateKey: context.env.FIREBASE_PRIVATE_KEY
  };

  if (!config.clientEmail || !config.privateKey) {
    console.error("Cadastro indisponível: credenciais administrativas ausentes.");
    return json({ errors: ["Serviço de cadastro ainda não foi configurado."] }, 503);
  }

  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(config);
  } catch (error) {
    console.error("Falha ao autenticar o backend do cadastro.", safeError(error));
    return json({ errors: ["Não foi possível acessar o serviço de cadastro."] }, 503);
  }

  try {
    const duplicateErrors = await findDuplicateErrors(config.projectId, accessToken, profile);
    if (duplicateErrors.length) return json({ errors: duplicateErrors }, 409);
  } catch (error) {
    console.error("Falha na verificação de duplicidade.", safeError(error));
    return json({ errors: ["Não foi possível verificar o cadastro. Tente novamente."] }, 503);
  }

  let authUser;
  try {
    authUser = await createFirebaseAuthUser(config.apiKey, profile.email, input.senha);
  } catch (error) {
    const authError = String(error?.message || "");
    if (authError.includes("EMAIL_EXISTS")) {
      return json({ errors: ["E-MAIL: já existe no sistema"] }, 409);
    }
    if (authError.includes("WEAK_PASSWORD")) {
      return json({ errors: ["SENHA: precisa ter 6 ou mais caracteres"] }, 400);
    }
    console.error("Falha ao criar usuário no Firebase Auth.", safeError(error));
    return json({ errors: ["Não foi possível criar a conta. Tente novamente."] }, 503);
  }

  try {
    await commitRegistration(config.projectId, accessToken, authUser.localId, profile);
  } catch (error) {
    await deleteFirebaseAuthUser(config.apiKey, authUser.idToken).catch((cleanupError) => {
      console.error("Falha ao desfazer usuário incompleto.", safeError(cleanupError));
    });

    if (isFirestoreConflict(error)) {
      return json({ errors: ["Um dos dados informados já existe no sistema."] }, 409);
    }

    console.error("Falha ao gravar solicitação de cadastro.", safeError(error));
    return json({ errors: ["Não foi possível concluir o cadastro. Tente novamente."] }, 503);
  }

  return json({ ok: true }, 201);
}

async function handleProfileUpdate(context) {
  const requestUrl = new URL(context.request.url);
  if (context.request.headers.get("Origin") !== requestUrl.origin) return json({ errors: ["Origem não autorizada."] }, 403);
  const authorization = context.request.headers.get("Authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!idToken) return json({ errors: ["Sessão inválida."] }, 401);

  const input = await context.request.json().catch(() => null);
  const profile = normalizeProfile({ ...input, email: "placeholder@ponto.local" });
  const errors = [];
  if (!profile.nome || profile.nome.replace(/[^A-Z]/g, "").length < 5) errors.push("NOME COMPLETO: informe pelo menos 5 letras");
  if (!isValidCpf(profile.cpf)) errors.push("CPF: número inválido");
  if (onlyDigits(profile.matricula).length < 7) errors.push("MATRICULA: precisa ter 7 ou mais dígitos");
  if (!ALLOWED_CARGOS.includes(profile.cargo)) errors.push("CARGO: valor inválido");
  if (!ALLOWED_LOTACOES.includes(profile.lotacao)) errors.push("LOTACAO: valor inválido");
  if (errors.length) return json({ errors }, 400);

  const config = {
    projectId: context.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    apiKey: context.env.FIREBASE_API_KEY || DEFAULT_API_KEY,
    clientEmail: context.env.FIREBASE_CLIENT_EMAIL,
    privateKey: context.env.FIREBASE_PRIVATE_KEY
  };
  if (!config.clientEmail || !config.privateKey) return json({ errors: ["Serviço de perfil não configurado."] }, 503);

  try {
    const uid = await lookupAuthUid(config.apiKey, idToken);
    const accessToken = await getGoogleAccessToken(config);
    const existing = await findOwnProfile(config.projectId, accessToken, uid);
    if (!existing) return json({ errors: ["Perfil não encontrado."] }, 404);

    const duplicateErrors = await findDuplicateErrors(config.projectId, accessToken, profile, uid, ["nome", "cpf", "matricula"]);
    if (duplicateErrors.length) return json({ errors: duplicateErrors }, 409);

    await commitProfileUpdate(config.projectId, accessToken, uid, existing, profile);
    return json({ ok: true, profile: { nome: profile.nome, cpf: profile.cpf, matricula: profile.matricula, cargo: profile.cargo, lotacao: profile.lotacao } });
  } catch (error) {
    console.error("Falha ao atualizar perfil.", safeError(error));
    if (isFirestoreConflict(error)) return json({ errors: ["Um dos dados informados já existe no sistema."] }, 409);
    return json({ errors: ["Não foi possível atualizar o perfil."] }, error?.status === 401 ? 401 : 503);
  }
}

function normalizeProfile(input) {
  return {
    nome: normalizeName(input?.nome),
    cpf: formatCpf(input?.cpf),
    matricula: String(input?.matricula || "").trim(),
    email: String(input?.email || "").trim().toLowerCase(),
    cargo: String(input?.cargo || "").trim().toUpperCase(),
    lotacao: String(input?.lotacao || "").trim().toUpperCase()
  };
}

function validateInput(profile, senha, confirmaSenha) {
  const errors = [];
  const required = {
    nome: "NOME COMPLETO",
    cpf: "CPF",
    matricula: "MATRICULA",
    email: "E-MAIL",
    cargo: "CARGO",
    lotacao: "LOTACAO"
  };
  for (const [field, label] of Object.entries(required)) {
    if (!profile[field]) errors.push(`${label}: está vazio`);
  }
  if (onlyDigits(profile.cpf).length !== 11) errors.push("CPF: precisa de 11 dígitos");
  else if (!isValidCpf(profile.cpf)) errors.push("CPF: número inválido");
  if (profile.nome.replace(/[^A-Z]/g, "").length < 5) errors.push("NOME COMPLETO: precisa ter 5 ou mais letras");
  if (onlyDigits(profile.matricula).length < 7) errors.push("MATRICULA: precisa ter 7 ou mais dígitos");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) errors.push("E-MAIL: informe um e-mail válido");
  if (!ALLOWED_CARGOS.includes(profile.cargo)) errors.push("CARGO: valor inválido");
  if (!ALLOWED_LOTACOES.includes(profile.lotacao)) errors.push("LOTACAO: valor inválido");
  if (String(senha || "").length < 6) errors.push("SENHA: precisa ter 6 ou mais caracteres");
  if (senha !== confirmaSenha) errors.push("SENHA E CONFIRMAR SENHA: estão diferentes");
  return [...new Set(errors)];
}

async function findDuplicateErrors(projectId, accessToken, profile, excludeUid = "", onlyFields = null) {
  const checks = [
    { field: "nome", label: "NOME COMPLETO", values: [profile.nome] },
    { field: "cpf", label: "CPF", values: [profile.cpf, onlyDigits(profile.cpf)] },
    { field: "matricula", label: "MATRICULA", values: [profile.matricula] },
    { field: "email", label: "E-MAIL", values: [profile.email], alternateFields: ["emailAuth"] }
  ];

  const selectedChecks = onlyFields ? checks.filter((check) => onlyFields.includes(check.field)) : checks;
  const results = await Promise.all(selectedChecks.map(async (check) => {
    const fields = [check.field, ...(check.alternateFields || [])];
    const attempts = [...new Set(check.values.filter(Boolean))];
    for (const collectionName of PEOPLE_COLLECTIONS) {
      for (const field of fields) {
        for (const value of attempts) {
          if (await firestoreValueExists(projectId, accessToken, collectionName, field, value, excludeUid)) {
            return `${check.label}: já existe no sistema`;
          }
        }
      }
    }
    return null;
  }));

  return results.filter(Boolean);
}

async function firestoreValueExists(projectId, accessToken, collectionName, field, value, excludeUid = "") {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: value }
          }
        },
        limit: 1
      }
    })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);
  return Array.isArray(data) && data.some((item) => {
    const document = item.document;
    if (!document) return false;
    const documentId = document.name?.split("/").pop() || "";
    const uid = document.fields?.uid?.stringValue || document.fields?.id?.stringValue || documentId;
    return !excludeUid || uid !== excludeUid;
  });
}

async function lookupAuthUid(apiKey, idToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const data = await readJsonResponse(response);
  const uid = data?.users?.[0]?.localId;
  if (!response.ok || !uid) {
    const error = new Error("Sessão inválida.");
    error.status = 401;
    throw error;
  }
  return uid;
}

async function findOwnProfile(projectId, accessToken, uid) {
  for (const collectionName of ["pessoas", "usuarios"]) {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${collectionName}/${encodeURIComponent(uid)}`;
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.ok) return { collectionName, document: await readJsonResponse(response) };
    if (response.status !== 404) throw httpError(response.status, await readJsonResponse(response));
  }
  for (const collectionName of ["pessoas", "usuarios"]) {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } },
        limit: 1
      } })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw httpError(response.status, data);
    const document = Array.isArray(data) ? data.find((item) => item.document)?.document : null;
    if (document) return { collectionName, document };
  }
  return null;
}

async function commitProfileUpdate(projectId, accessToken, uid, existing, profile) {
  const oldFields = existing.document.fields || {};
  const oldValues = {
    nome: normalizeName(oldFields.nome?.stringValue || ""),
    cpf: onlyDigits(oldFields.cpf?.stringValue || ""),
    matricula: String(oldFields.matricula?.stringValue || "").trim().toLowerCase()
  };
  const newValues = {
    nome: normalizeName(profile.nome),
    cpf: onlyDigits(profile.cpf),
    matricula: profile.matricula.toLowerCase()
  };
  const writes = [];
  for (const field of ["nome", "cpf", "matricula"]) {
    if (oldValues[field] === newValues[field]) continue;
    if (oldValues[field]) {
      const oldUniqueId = `${field}_${await sha256(oldValues[field])}`;
      if (await uniqueDocumentOwner(projectId, accessToken, oldUniqueId) === uid) {
        writes.push({ delete: documentName(projectId, UNIQUE_COLLECTION, oldUniqueId) });
      }
    }
    const uniqueId = `${field}_${await sha256(newValues[field])}`;
    const owner = await uniqueDocumentOwner(projectId, accessToken, uniqueId);
    if (owner && owner !== uid) throw Object.assign(new Error("ALREADY_EXISTS"), { status: 409 });
    if (!owner) writes.push({
      update: { name: documentName(projectId, UNIQUE_COLLECTION, uniqueId), fields: {
        field: { stringValue: field }, valueHash: { stringValue: uniqueId.slice(field.length + 1) }, ownerUid: { stringValue: uid }, createdAt: { timestampValue: new Date().toISOString() }
      } },
      currentDocument: { exists: false }
    });
  }
  const updatedAt = new Date().toISOString();
  const profileDocumentId = existing.document.name?.split("/").pop() || uid;
  writes.push({
    update: { name: documentName(projectId, existing.collectionName, profileDocumentId), fields: toFirestoreFields({
      nome: profile.nome, cpf: profile.cpf, matricula: profile.matricula, cargo: profile.cargo, lotacao: profile.lotacao, updatedAt
    }, ["updatedAt"]) },
    updateMask: { fieldPaths: ["nome", "cpf", "matricula", "cargo", "lotacao", "updatedAt"] }
  });
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);
}

async function uniqueDocumentOwner(projectId, accessToken, uniqueId) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${UNIQUE_COLLECTION}/${encodeURIComponent(uniqueId)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return "";
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);
  return data?.fields?.ownerUid?.stringValue || "";
}

async function createFirebaseAuthUser(apiKey, email, password) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);
  return data;
}

async function deleteFirebaseAuthUser(apiKey, idToken) {
  if (!idToken) return;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!response.ok) throw httpError(response.status, await readJsonResponse(response));
}

async function commitRegistration(projectId, accessToken, uid, profile) {
  const now = new Date().toISOString();
  const uniqueEntries = await Promise.all([
    ["nome", normalizeName(profile.nome)],
    ["cpf", onlyDigits(profile.cpf)],
    ["matricula", profile.matricula.toLowerCase()],
    ["email", profile.email]
  ].map(async ([field, value]) => ({ field, value, id: `${field}_${await sha256(value)}` })));

  const writes = uniqueEntries.map(({ field, value, id }) => ({
    update: {
      name: documentName(projectId, UNIQUE_COLLECTION, id),
      fields: {
        field: { stringValue: field },
        valueHash: { stringValue: id.slice(field.length + 1) },
        ownerUid: { stringValue: uid },
        createdAt: { timestampValue: now }
      }
    },
    currentDocument: { exists: false }
  }));

  writes.push({
    update: {
      name: documentName(projectId, "pessoas", uid),
      fields: toFirestoreFields({
        uid,
        id: uid,
        ...profile,
        emailAuth: profile.email,
        perfil: "usuario",
        statusAprovacao: "pendente",
        statusUsuario: "",
        status: "pendente",
        createdAt: now,
        updatedAt: now
      }, ["createdAt", "updatedAt"])
    },
    currentDocument: { exists: false }
  });

  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ writes })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);
}

function toFirestoreFields(values, timestampFields = []) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    timestampFields.includes(key) ? { timestampValue: value } : { stringValue: String(value ?? "") }
  ]));
}

function documentName(projectId, collectionName, documentId) {
  return `projects/${projectId}/databases/(default)/documents/${collectionName}/${documentId}`;
}

async function getGoogleAccessToken(config) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) return cachedAccessToken;

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    alg: "RS256",
    typ: "JWT"
  }, {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }, config.privateKey);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw httpError(response.status, data);

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function signJwt(header, payload, privateKeyPem) {
  const encodedHeader = base64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedToken));
  return `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem).replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCpf(value) {
  const digits = onlyDigits(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return (remainder === 10 ? 0 : remainder) === Number(digits[length]);
  };
  return check(9) && check(10);
}

function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isFirestoreConflict(error) {
  const message = String(error?.message || "");
  return error?.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(message);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

function httpError(status, data) {
  const message = data?.error?.message || data?.error?.status || `HTTP ${status}`;
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeError(error) {
  return { status: error?.status, message: String(error?.message || "Erro desconhecido").slice(0, 500) };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
