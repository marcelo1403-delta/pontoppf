import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwC527eWp7Ubwdc0WvBLnSJkvPjfHKZrs",
  authDomain: "ponto-ppf.firebaseapp.com",
  projectId: "ponto-ppf",
  storageBucket: "ponto-ppf.firebasestorage.app",
  messagingSenderId: "1058173979864",
  appId: "1:1058173979864:web:6867b874b3a1dd7cf9b8d4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let currentUser = null;
let people = [];
let users = [];
let requests = [];
let currentFilter = "todos";
let currentPeopleView = "usuarios";
let currentRequestFilter = "pendente";
let currentPage = "Registrar";
let editingUserId = null;
let editingRequestId = null;
let pendingDelete = null;
let saveBannerTimer = null;
let saveSuccessTimer = null;
let validationClearTargets = [];
let savedTimeValues = {};
let pendingTimeChanges = new Set();
let calendarMonthValue = localDateValue().slice(0, 7);
let activeMonthYear = new Date().getFullYear();
let selectedHolidayDate = "";
let selectedMonthlyCompetencia = localDateValue().slice(0, 7);
let activeMonths = {};
let holidays = {};
let currentMonthPointDays = {};
let monthlyPointDays = {};
let monthlyLoadingCompetencia = "";
let selectedDailyShift = "diurno";
let savedDailyShift = "diurno";
let pendingDailyShiftChange = false;
let dailyNormalValues = { e1: "", s1: "", e2: "", s2: "" };
let dailyGeccValues = { e1: "", s1: "" };
let selectedDailyPerson = null;
let selectedMonthlyPerson = null;

const PAGE_META = {
  Registrar: ["Registrar", "Registro de ponto"],
  Relatorios: ["Relatórios", "Selecione por Mês e Ano"],
  Gestao: ["Gestão", "Pessoas e Calendário"],
  Perfil: ["Minha Conta", "meus dados de cadastro"]
};

const LOTACOES = ["PFBRA", "PFCAT", "PFCG", "PFMOS", "PFPV", "SEDE"];
const REQUIRED_USER_FIELDS = ["nome", "cpf", "matricula", "cargo", "lotacao"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_MOCK = URL_PARAMS.get("mock") === "1";
const MOCK_KEY = "pontoPpfMockDb";

if (URL_PARAMS.get("resetMock") === "1") {
  localStorage.removeItem(MOCK_KEY);
}

function byId(id) {
  return document.getElementById(id);
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeLogin(value) {
  const login = value.trim().toLowerCase();
  if (login === "admin") return "admin@ponto-ppf.local";
  if (login === "gestor") return "gestor@ponto-ppf.local";
  return login;
}

function authEmailFromMatricula(matricula) {
  const clean = String(matricula || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${clean}@ponto-ppf.local`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeNameTyping(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function nameLetterCount(value) {
  return normalizeName(value).replace(/[^A-Z]/g, "").length;
}

function mockNow() {
  return new Date().toISOString();
}

function initialMockDb() {
  return {
    users: [
      {
        docId: "mock-admin",
        uid: "mock-admin",
        nome: "Administrador",
        cpf: "000.000.000-00",
        matricula: "admin",
        cargo: "PPF",
        lotacao: "SEDE",
        emailAuth: "admin@ponto-ppf.local",
        perfil: "admin",
        status: "ativo",
        senha: "admin123"
      },
      {
        docId: "mock-gestor",
        uid: "mock-gestor",
        nome: "Gestor",
        cpf: "111.111.111-11",
        matricula: "gestor",
        cargo: "PPF",
        lotacao: "SEDE",
        emailAuth: "gestor@ponto-ppf.local",
        perfil: "gestor",
        status: "ativo",
        senha: "gestor123"
      },
      {
        docId: "mock-usuario",
        uid: "mock-usuario",
        nome: "Usuário de Teste",
        cpf: "222.222.222-22",
        matricula: "2222222",
        cargo: "PPF",
        lotacao: "PFCG",
        emailAuth: "usuario@ponto-ppf.local",
        perfil: "usuario",
        status: "ativo",
        senha: "usuario123"
      }
    ],
    requests: [],
    registrosPonto: {},
    activeMonths: {},
    holidays: {}
  };
}

function readMockDb() {
  try {
    return { ...initialMockDb(), ...(JSON.parse(localStorage.getItem(MOCK_KEY)) || {}) };
  } catch (error) {
    return initialMockDb();
  }
}

function writeMockDb(data) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(data));
}

function mockId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mockFindPerson(loginInput) {
  const dbData = readMockDb();
  const login = normalizeLogin(loginInput);
  const digits = onlyDigits(login);
  const formattedCpf = formatCpf(digits);
  const emailAuth = login.includes("@") ? login : authEmailFromMatricula(login);
  const match = (item) => {
    const cpf = String(item.cpf || "");
    const matricula = String(item.matricula || "").toLowerCase();
    return String(item.emailAuth || item.email || "").toLowerCase() === emailAuth
      || matricula === login
      || cpf === formattedCpf
      || onlyDigits(cpf) === digits;
  };
  return {
    user: dbData.users.find(match),
    request: dbData.requests.find(match)
  };
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCpf(value) {
  const digits = onlyDigits(value);
  const limited = digits.slice(0, 11);
  if (limited.length <= 3) return limited;
  if (limited.length <= 6) return `${limited.slice(0, 3)}.${limited.slice(3)}`;
  if (limited.length <= 9) return `${limited.slice(0, 3)}.${limited.slice(3, 6)}.${limited.slice(6)}`;
  return `${limited.slice(0, 3)}.${limited.slice(3, 6)}.${limited.slice(6, 9)}-${limited.slice(9)}`;
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

function formatTime(value) {
  const digits = onlyDigits(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseTimeMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(total) {
  const minutes = Math.max(0, Number(total) || 0);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function formatSignedMinutes(total) {
  const value = Number(total) || 0;
  const sign = value < 0 ? "-" : "";
  const minutes = Math.abs(value);
  return `${sign}${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function attachMaskedInput(input, formatter) {
  if (!input || input.dataset.maskBound === "1") return;
  input.dataset.maskBound = "1";
  input.addEventListener("input", () => {
    input.value = formatter(input.value);
  });
  input.addEventListener("blur", () => {
    input.value = formatter(input.value);
  });
}

function missingRequiredUserFields(user) {
  return REQUIRED_USER_FIELDS.filter((field) => !String(user?.[field] || "").trim());
}

function hasValidRequiredUserFields(user) {
  return missingRequiredUserFields(user).length === 0
    && onlyDigits(user.cpf).length === 11
    && nameLetterCount(user.nome) >= 5
    && onlyDigits(user.matricula).length >= 7;
}

function validateRequiredUserData(user) {
  const missing = missingRequiredUserFields(user);
  if (missing.length) {
    toast("Preencha nome, CPF, matrícula, cargo e lotação.");
    return false;
  }
  if (onlyDigits(user.cpf).length !== 11) {
    toast("Informe um CPF completo.");
    return false;
  }
  if (!isValidCpf(user.cpf)) {
    toast("Informe um CPF válido.");
    return false;
  }
  if (nameLetterCount(user.nome) < 5) {
    toast("Informe um nome com pelo menos 5 letras.");
    return false;
  }
  if (onlyDigits(user.matricula).length < 7) {
    toast("Informe uma matrícula com pelo menos 7 dígitos.");
    return false;
  }
  if (!LOTACOES.includes(user.lotacao)) {
    toast("Selecione uma lotação válida.");
    return false;
  }
  return true;
}

function personMatchesAnyId(person, ids) {
  return ids.some((id) => id && [person?.docId, person?.id, person?.uid].includes(id));
}

async function valueExistsInPeople(field, value, options = {}) {
  const excludeIds = [...new Set((options.excludeIds || []).filter(Boolean))];

  if (USE_MOCK) {
    const dbData = readMockDb();
    const target = field === "cpf" ? onlyDigits(value) : field === "nome" ? normalizeName(value) : String(value || "").trim().toLowerCase();
    return [...dbData.users, ...dbData.requests].some((item) => {
      if (personMatchesAnyId(item, excludeIds)) return false;
      if (field === "cpf") return onlyDigits(item.cpf) === target;
      if (field === "nome") return normalizeName(item.nome) === target;
      if (field === "email") return [item.email, item.emailAuth].some((email) => normalizeEmail(email) === target);
      return String(item[field] || "").trim().toLowerCase() === target;
    });
  }

  const normalized = field === "cpf" ? formatCpf(value) : String(value || "").trim();
  const raw = String(value || "").trim();
  const attempts = [...new Set([normalized, raw].filter(Boolean))];
  const fields = field === "email" ? ["email", "emailAuth"] : [field];
  for (const collectionName of ["pessoas", "usuarios", "pedidosInclusao"]) {
    for (const queryField of fields) {
      for (const attempt of attempts) {
        const snap = await getDocs(query(collection(db, collectionName), where(queryField, "==", attempt), limit(1)));
      if (snap.docs.some((item) => !personMatchesAnyId({ docId: item.id, id: item.id, uid: item.data().uid, ...item.data() }, excludeIds))) {
        return true;
      }
      }
    }
  }
  return false;
}

function clearRegisterBanner() {
  const banner = byId("registerBanner");
  if (!banner) return;
  banner.classList.remove("show");
  banner.innerHTML = "";
}

function showRegisterBanner(errors) {
  const banner = byId("registerBanner");
  if (!banner) return;
  banner.innerHTML = `<b>PREENCHIMENTO INCORRETO:</b>${errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("")}`;
  banner.classList.add("show");
}

function clearAuthForms() {
  $$("#authLogin input, #authRegister input, #authRecover input").forEach((input) => {
    if (input.type === "checkbox") input.checked = false;
    else input.value = "";
  });
  $$("#authRegister select").forEach((select, index) => {
    select.selectedIndex = index === 0 ? 0 : 0;
  });
  clearRegisterBanner();
}

function showRegisterSuccess() {
  byId("registerSuccessModal")?.classList.add("show");
}

function closeRegisterSuccess() {
  closeModal("registerSuccessModal");
  clearAuthForms();
  showAuth("login");
}

function collectRegisterErrors(profileData, senha, confirmaSenha) {
  const errors = [];
  const labels = {
    nome: "NOME COMPLETO",
    cpf: "CPF",
    matricula: "MATRICULA",
    email: "E-MAIL",
    cargo: "CARGO",
    lotacao: "LOTACAO",
    senha: "SENHA",
    confirmaSenha: "CONFIRMAR SENHA"
  };

  Object.entries({
    nome: profileData.nome,
    cpf: profileData.cpf,
    matricula: profileData.matricula,
    email: profileData.email,
    cargo: profileData.cargo,
    lotacao: profileData.lotacao,
    senha,
    confirmaSenha
  }).forEach(([field, value]) => {
    if (!String(value || "").trim()) errors.push(`${labels[field]}: está vazio`);
  });

  if (profileData.cpf && onlyDigits(profileData.cpf).length !== 11) {
    errors.push("CPF: precisa de 11 dígitos");
  } else if (profileData.cpf && !isValidCpf(profileData.cpf)) {
    errors.push("CPF: número inválido");
  }

  if (profileData.nome && nameLetterCount(profileData.nome) < 5) {
    errors.push("NOME COMPLETO: precisa ter 5 ou mais letras");
  }

  if (profileData.matricula && onlyDigits(profileData.matricula).length < 7) {
    errors.push("MATRICULA: precisa ter 7 ou mais dígitos");
  }

  if (profileData.email && !isValidEmail(profileData.email)) {
    errors.push("E-MAIL: informe um e-mail válido");
  }

  if (senha && senha.length < 6) {
    errors.push("SENHA: precisa ter 6 ou mais dígitos");
  }

  if (senha && confirmaSenha && senha !== confirmaSenha) {
    errors.push("SENHA E CONFIRMAR SENHA: estão diferentes");
  }

  return errors;
}

async function resolveLoginEmail(value, password = "") {
  const login = normalizeLogin(value);
  if (login.includes("@")) return login;
  const response = await fetch("/api/auth/resolve-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: login, password, purpose: "login" })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.email) throw new Error("login-not-found");
  return result.email;
}

async function loadRequest(authUser) {
  const person = await findFirebasePerson(authUser, ["pendente", "rejeitado", "aprovado"]);
  if (person && ["pendente", "rejeitado", "aprovado"].includes(approvalStatus(person))) return person;

  const ref = doc(db, "pedidosInclusao", authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { _collection: "pedidosInclusao", docId: snap.id, id: snap.id, uid: authUser.uid, ...snap.data() };
  }

  const byEmail = query(collection(db, "pedidosInclusao"), where("emailAuth", "==", authUser.email || ""), limit(1));
  const emailSnap = await getDocs(byEmail);
  if (!emailSnap.empty) {
    const requestDoc = emailSnap.docs[0];
    return { _collection: "pedidosInclusao", docId: requestDoc.id, id: requestDoc.id, uid: requestDoc.data().uid || authUser.uid, ...requestDoc.data() };
  }

  return null;
}

function requestAccessMessage(request) {
  const status = approvalStatus(request) || String(request?.status || "").toLowerCase();
  const contact = "suporte@ponto-ppf.local";
  if (status === "pendente") return `Seu cadastro ainda está em análise, qualquer dúvida entre em contato pelo e-mail=${contact}`;
  if (status === "rejeitado") return `Sentimos muito, mas seu cadastro não foi aprovado. Qualquer dúvida entre em contato pelo e-mail=${contact}`;
  if (status === "aceito" || status === "aprovado") return `Parabéns ${request?.nome || ""}, seu cadastro foi aprovado.`;
  return "Cadastro encontrado, mas ainda não liberado.";
}

async function loadProfile(authUser) {
  const person = await findFirebasePerson(authUser, ["aprovado"]);
  if (person) return person;

  const ref = doc(db, "usuarios", authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { _collection: "usuarios", docId: snap.id, id: snap.id, uid: authUser.uid, statusAprovacao: "aprovado", statusUsuario: snap.data().status || "ativo", ...snap.data() };
  }

  for (const field of ["email", "emailAuth"]) {
    const byEmail = query(collection(db, "usuarios"), where(field, "==", authUser.email || ""), limit(1));
    const emailSnap = await getDocs(byEmail);
    if (!emailSnap.empty) {
      const emailDoc = emailSnap.docs[0];
      const data = emailDoc.data();
      return {
        _collection: "usuarios",
        docId: emailDoc.id,
        id: emailDoc.id,
        uid: data.uid || authUser.uid,
        statusAprovacao: "aprovado",
        statusUsuario: data.status || "ativo",
        ...data
      };
    }
  }

  throw new Error("profile-not-found");
}

function canManageUsers() {
  return ["admin", "gestor"].includes(String(currentUser?.perfil || "").toLowerCase());
}

function dailyPointPerson() {
  return canManageUsers() ? selectedDailyPerson : currentUser;
}

function personPointId(person) {
  return person?.uid || person?.docId || person?.id || "";
}

function dailyPersonId() {
  return personPointId(dailyPointPerson());
}

function isManagingAnotherDailyPerson() {
  return canManageUsers() && Boolean(dailyPersonId()) && dailyPersonId() !== currentPersonId();
}

function monthlyPointPerson() {
  return canManageUsers() ? selectedMonthlyPerson : currentUser;
}

function monthlyPersonId() {
  return personPointId(monthlyPointPerson());
}

function isManagingAnotherMonthlyPerson() {
  return canManageUsers() && Boolean(monthlyPersonId()) && monthlyPersonId() !== currentPersonId();
}

function canEditProfileField() {
  return String(currentUser?.perfil || "").toLowerCase() === "admin";
}

function isAdmin() {
  return String(currentUser?.perfil || "").toLowerCase() === "admin";
}

function approvalStatus(item) {
  return String(item?.statusAprovacao || item?.status || "").toLowerCase().replace("aceito", "aprovado");
}

function userAccessStatus(item) {
  return String(item?.statusUsuario || item?.status || "").toLowerCase() || "ativo";
}

function personDocId(item) {
  return item?.docId || item?.id || item?.uid;
}

function personCollection(item) {
  return item?._collection || "pessoas";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function updateWorkDateLabel() {
  const input = byId("workDate");
  const label = byId("weekday");
  const display = byId("workDateDisplay");
  if (!input || !label) return;
  if (!input.value) input.value = localDateValue();
  const date = dateFromInput(input.value);
  if (display) display.textContent = date.toLocaleDateString("pt-BR");
  label.textContent = date.toLocaleDateString("pt-BR", { weekday: "long" });
  updateHolidayBanner();
}

function enhanceDailyRegisterLayout() {
  const dailyView = byId("registro-diario");
  const dateLine = $(".dateLine", dailyView);
  const dateSide = $(".dateSide", dateLine);
  const personSide = $(".daySide", dateLine);
  const saveButton = byId("savePointBtn");
  const pointCard = $(".card.registerPointPanel", dailyView);
  const firstCard = $(".expCard.first", pointCard);
  const secondCard = $(".expCard.second", pointCard);
  if (!dailyView || !dateLine || !dateSide || !personSide || !saveButton || !pointCard || !firstCard || !secondCard) return;

  dateLine.classList.add("dailyMetaGrid");
  dateSide.classList.add("dailyMiniBanner");
  personSide.classList.add("dailyMiniBanner", "dailyPersonBanner");

  const saveRow = document.createElement("div");
  saveRow.className = "dailySaveRow registerPointPanel";
  dateLine.insertAdjacentElement("afterend", saveRow);
  saveRow.appendChild(saveButton);

  personSide.innerHTML = `
    <span class="dailyPersonContent">
      <small>REGISTRO DE</small>
      <span id="dailyPersonName" class="dailyPersonName"></span>
      <select id="dailyPersonSelect" class="dailyPersonSelect" aria-label="Usuário do registro diário"></select>
    </span>`;

  const shiftTabs = document.createElement("section");
  shiftTabs.className = "dailyShiftTabs registerPointPanel";
  shiftTabs.setAttribute("aria-label", "Turno do registro diário");
  shiftTabs.innerHTML = `
    <button class="dailyShiftTab active" type="button" data-daily-shift="diurno">FOLHA NORMAL</button>
    <button class="dailyShiftTab" type="button" data-daily-shift="noturno">GECC</button>`;
  shiftTabs.appendChild(saveButton);
  pointCard.insertAdjacentElement("beforebegin", shiftTabs);
  $(".geccRow", dailyView)?.remove();

  firstCard.id = "dailyFirstCard";
  secondCard.id = "dailySecondCard";
  $(".expHead strong", firstCard).id = "dailyFirstCardTitle";

  $$(".dailyShiftTab", shiftTabs).forEach((button) => {
    button.addEventListener("click", () => selectDailyShift(button.dataset.dailyShift));
  });
  byId("dailyPersonSelect")?.addEventListener("change", handleDailyPersonChange);
  window.addEventListener("resize", fitDailyPersonName);
}

function initializeDailyPersonControl() {
  const select = byId("dailyPersonSelect");
  const name = byId("dailyPersonName");
  if (!select || !name) return;
  const manager = canManageUsers();
  const fullName = currentUser?.nome || "Usuário";
  select.hidden = !manager;
  name.hidden = manager;
  name.textContent = fullName;
  name.title = fullName;
  select.disabled = false;
  if (manager) {
    selectedDailyPerson = currentUser;
    populateDailyPersonSelect();
  } else {
    selectedDailyPerson = currentUser;
    const id = personPointId(currentUser);
    select.innerHTML = `<option value="${escapeHtml(id)}">${escapeHtml(fullName)}</option>`;
    select.value = id;
  }
  applyDailyPermissions();
  requestAnimationFrame(fitDailyPersonName);
}

function fitDailyPersonName() {
  const element = byId("dailyPersonName");
  if (!element || element.hidden) return;
  fitPersonNameToWidth(element, currentUser?.nome || "Usuário");
}

function fitPersonNameToWidth(element, value) {
  const fullName = String(value || "Usuário").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  element.title = fullName;
  element.textContent = fullName;
  if (element.scrollWidth <= element.clientWidth || parts.length < 2) return;

  let fitted = "";
  for (let index = 1; index <= parts.length; index += 1) {
    const candidate = `${parts.slice(0, index).join(" ")}...`;
    element.textContent = candidate;
    if (element.scrollWidth > element.clientWidth) break;
    fitted = candidate;
  }
  element.textContent = fitted || `${parts[0]}...`;
}

function selectableDailyUsers() {
  const unique = new Map();
  people
    .filter((person) => {
      const role = String(person?.perfil || "usuario").toLowerCase();
      const approved = approvalStatus(person) === "aprovado" || ["admin", "gestor"].includes(role);
      return approved && userAccessStatus(person) === "ativo";
    })
    .forEach((person) => {
      const id = personPointId(person);
      if (id && !unique.has(id)) unique.set(id, person);
    });
  return [...unique.values()].sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
}

function dailyPersonOptions() {
  const options = selectableDailyUsers();
  if (!canManageUsers() || !currentUser) return options;
  return [currentUser, ...options.filter((person) => personPointId(person) !== personPointId(currentUser))];
}

function populateDailyPersonSelect() {
  const select = byId("dailyPersonSelect");
  if (!select || !canManageUsers()) return;
  const currentId = dailyPersonId();
  const options = dailyPersonOptions();
  select.innerHTML = options.map((person) => (
    `<option value="${escapeHtml(personPointId(person))}" title="${escapeHtml(person.nome || "")}">${escapeHtml(person.nome || person.matricula || "Usuário")}</option>`
  )).join("");
  if (currentId && options.some((person) => personPointId(person) === currentId)) select.value = currentId;
}

async function handleDailyPersonChange(event) {
  const id = event.target.value;
  selectedDailyPerson = dailyPersonOptions().find((person) => personPointId(person) === id) || currentUser;
  selectedMonthlyPerson = selectedDailyPerson;
  monthlyPointDays = {};
  syncPointPersonSelects();
  currentMonthPointDays = {};
  applyPointRecord({});
  applyDailyPermissions();
  if (selectedDailyPerson) await loadPointRecord();
}

function selectDailyShift(shift, options = {}) {
  const nextShift = shift === "noturno" ? "noturno" : "diurno";
  if (!options.fromRecord) captureActiveDailyValues();
  selectedDailyShift = nextShift;
  $$(".dailyShiftTab").forEach((button) => {
    button.classList.toggle("active", button.dataset.dailyShift === nextShift);
  });
  const firstCard = byId("dailyFirstCard");
  const secondCard = byId("dailySecondCard");
  const title = byId("dailyFirstCardTitle");
  firstCard?.classList.toggle("night", nextShift === "noturno");
  secondCard?.classList.toggle("hidden", nextShift === "noturno");
  if (title) title.textContent = nextShift === "noturno" ? "HORÁRIO" : "1º EXPEDIENTE";
  renderActiveDailyValues();
  updateSaveButtonState();
  syncTimeAvailability();
  updateDaySummary();
}

function applyDailyPermissions() {
  const manager = canManageUsers();
  const personSelect = byId("dailyPersonSelect");
  if (personSelect) personSelect.disabled = !manager;
  syncTimeAvailability();
}

function captureActiveDailyValues() {
  if (selectedDailyShift === "noturno") {
    dailyGeccValues = { e1: timeText("entrada1View"), s1: timeText("saida1View") };
    return;
  }
  dailyNormalValues = {
    e1: timeText("entrada1View"), s1: timeText("saida1View"),
    e2: timeText("entrada2View"), s2: timeText("saida2View")
  };
}

function renderActiveDailyValues() {
  const values = selectedDailyShift === "noturno"
    ? { entrada1View: dailyGeccValues.e1, saida1View: dailyGeccValues.s1, entrada2View: "", saida2View: "" }
    : { entrada1View: dailyNormalValues.e1, saida1View: dailyNormalValues.s1, entrada2View: dailyNormalValues.e2, saida2View: dailyNormalValues.s2 };
  Object.entries(values).forEach(([id, value]) => {
    const input = byId(id);
    if (input) input.value = value || "";
  });
}

function enhanceMonthlyRegisterLayout() {
  const top = $("#registro-mensal .monthlyTop");
  const monthBox = $(".monthlySelectBox", top);
  const holidayButton = byId("monthlyHolidayToggle");
  if (!top || !monthBox || !holidayButton || byId("monthlyPersonSelect")) return;

  holidayButton.classList.add("monthlyHolidayMiniButton");
  monthBox.appendChild(holidayButton);

  const personBox = document.createElement("div");
  personBox.className = "monthlyPersonBox";
  personBox.innerHTML = `
    <span class="monthlyPersonContent">
      <small>REGISTRO DE</small>
      <span id="monthlyPersonName" class="monthlyPersonName"></span>
      <select id="monthlyPersonSelect" class="monthlyPersonSelect" aria-label="Usuário do registro mensal"></select>
    </span>`;
  top.appendChild(personBox);
  configureMonthlyTableStructure();
  byId("monthlyPersonSelect")?.addEventListener("change", handleMonthlyPersonChange);
  window.addEventListener("resize", fitMonthlyPersonName);
}

function configureMonthlyTableStructure() {
  const table = $("#registro-mensal .monthlyTable");
  const head = $("thead", table);
  const foot = $("tfoot", table);
  if (!table || !head || !foot) return;
  head.innerHTML = `
    <tr><th class="cDay hNeutral" rowspan="2">DIA</th><th class="cEdit hNeutral" rowspan="2">EDT</th><th class="hExp1" colspan="2">1º EXP</th><th class="hExp2" colspan="2">2º EXP</th><th class="hNight" colspan="2">NOTURNO</th><th class="hTotals" colspan="3">TOTAIS HORAS</th></tr>
    <tr><th class="cTime hExp1">E1</th><th class="cTime hExp1">S1</th><th class="cTime hExp2">E2</th><th class="cTime hExp2">S2</th><th class="cTime hNight">E3</th><th class="cTime hNight">S3</th><th class="cTotal hTotals">GEC</th><th class="cTotal hTotals">EXT</th><th class="cTotal hTotals">SLD</th></tr>`;
  foot.innerHTML = `<tr><td colspan="8" class="monthlyTotalLabel">TOTAIS</td><td><span class="monthlyValue">00:00</span></td><td><span class="monthlyValue">00:00</span></td><td><span class="monthlyValue">00:00</span></td></tr>`;
}

function initializeMonthlyPersonControl() {
  const select = byId("monthlyPersonSelect");
  const name = byId("monthlyPersonName");
  if (!select || !name) return;
  const manager = canManageUsers();
  selectedMonthlyPerson = currentUser;
  select.hidden = !manager;
  name.hidden = false;
  name.textContent = currentUser?.nome || "Usuário";
  name.title = currentUser?.nome || "Usuário";
  select.disabled = !manager;
  $(".monthlyPersonBox")?.classList.toggle("selectable", manager);
  populateMonthlyPersonSelect();
  requestAnimationFrame(fitMonthlyPersonName);
}

function fitMonthlyPersonName() {
  const element = byId("monthlyPersonName");
  if (!element || element.hidden) return;
  fitPersonNameToWidth(element, selectedMonthlyPerson?.nome || currentUser?.nome || "Usuário");
}

function populateMonthlyPersonSelect() {
  const select = byId("monthlyPersonSelect");
  if (!select || !currentUser) return;
  const options = canManageUsers() ? dailyPersonOptions() : [currentUser];
  const currentId = monthlyPersonId() || currentPersonId();
  select.innerHTML = options.map((person) => (
    `<option value="${escapeHtml(personPointId(person))}">${escapeHtml(person.nome || person.matricula || "Usuário")}</option>`
  )).join("");
  select.value = options.some((person) => personPointId(person) === currentId) ? currentId : personPointId(currentUser);
  select.disabled = !canManageUsers();
  selectedMonthlyPerson = options.find((person) => personPointId(person) === select.value) || currentUser;
  requestAnimationFrame(fitMonthlyPersonName);
}

async function handleMonthlyPersonChange(event) {
  const id = event.target.value;
  selectedMonthlyPerson = dailyPersonOptions().find((person) => personPointId(person) === id) || currentUser;
  selectedDailyPerson = selectedMonthlyPerson;
  requestAnimationFrame(fitMonthlyPersonName);
  currentMonthPointDays = {};
  syncPointPersonSelects();
  monthlyPointDays = {};
  renderMonthlyTableRows();
  await loadMonthlyPointRecords(selectedMonthlyCompetencia);
}

function syncPointPersonSelects() {
  const id = personPointId(selectedDailyPerson || selectedMonthlyPerson || currentUser);
  const dailySelect = byId("dailyPersonSelect");
  const monthlySelect = byId("monthlyPersonSelect");
  if (dailySelect && [...dailySelect.options].some((option) => option.value === id)) dailySelect.value = id;
  if (monthlySelect && [...monthlySelect.options].some((option) => option.value === id)) monthlySelect.value = id;
  requestAnimationFrame(fitMonthlyPersonName);
}

function normalizeValidationItems(messages) {
  const rawItems = Array.isArray(messages) ? messages : [messages];
  const items = rawItems.filter(Boolean).map((item) => (
    typeof item === "string" ? { message: item, targets: [] } : { message: item.message || "", targets: item.targets || [] }
  ));
  const grouped = new Map();
  items.forEach((item) => {
    if (!item.message) return;
    const existing = grouped.get(item.message) || { message: item.message, targets: [] };
    existing.targets.push(...(item.targets || []));
    grouped.set(item.message, existing);
  });
  return [...grouped.values()];
}

function validationTargetElement(target) {
  if (!target) return null;
  if (typeof target === "string") return byId(target);
  return target;
}

function showValidationPopover(messages) {
  const popover = byId("validationPopover");
  const list = byId("validationList");
  const errors = normalizeValidationItems(messages);
  if (!popover || !list || !errors.length) return;
  validationClearTargets = errors.flatMap((item) => item.targets || []).map(validationTargetElement).filter(Boolean);
  list.innerHTML = errors.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("");
  popover.classList.remove("hidden");
}

function closeValidationPopover() {
  byId("validationPopover")?.classList.add("hidden");
  const targets = [...new Set(validationClearTargets)];
  validationClearTargets = [];
  targets.forEach((input) => {
    if (!input) return;
    input.value = "";
    if (input.classList.contains("timeTrack")) {
      setSaveFlag(input, null);
      syncPendingTimeChange(input);
    }
    if (input.classList.contains("monthlyTimeInput")) {
      input.classList.remove("monthlySaved");
      const row = input.closest("tr");
      monthlyUpdateRowState(row);
      updateMonthlyTotals();
    }
  });
  if (targets.some((input) => input?.classList.contains("timeTrack"))) {
    syncTimeAvailability();
    updateDaySummary();
    updateFillStatusBanner(fillStatusFromCurrentTimes(), selectedWorkDate());
  }
}

function showSaveError(message) {
  showValidationPopover(message);
}

function showSaveSuccess() {
  const note = byId("saveSuccessNote");
  if (!note) return;
  if (saveSuccessTimer) clearTimeout(saveSuccessTimer);
  note.textContent = "Gravação feita com sucesso!";
  note.classList.add("show");
  saveSuccessTimer = setTimeout(() => note.classList.remove("show"), 5000);
}

function flagFor(input) {
  return input?.id ? $(`[data-save-flag="${input.id}"]`) : null;
}

function setSaveFlag(input, status) {
  const flag = flagFor(input);
  if (!flag) return;
  flag.classList.remove("saved", "unsaved");
  flag.textContent = "";
  if (!status) return;
  flag.classList.add(status);
  flag.textContent = status === "saved" ? "✓" : "!";
}

function currentTimeValues() {
  return {
    entrada1View: timeText("entrada1View"),
    saida1View: timeText("saida1View"),
    entrada2View: timeText("entrada2View"),
    saida2View: timeText("saida2View")
  };
}

function allDailyTimeValues() {
  return {
    "diurno:entrada1View": dailyNormalValues.e1,
    "diurno:saida1View": dailyNormalValues.s1,
    "diurno:entrada2View": dailyNormalValues.e2,
    "diurno:saida2View": dailyNormalValues.s2,
    "noturno:entrada1View": dailyGeccValues.e1,
    "noturno:saida1View": dailyGeccValues.s1
  };
}

function updateSaveButtonState() {
  const button = byId("savePointBtn");
  if (!button) return;
  const readOnlyGecc = selectedDailyShift === "noturno" && !canManageUsers();
  const readOnlyNormal = selectedDailyShift === "diurno" && isManagingAnotherDailyPerson();
  button.disabled = !dailyPersonId() || readOnlyGecc || readOnlyNormal;
}

function setSaveButtonText(text = "Gravar") {
  const button = byId("savePointBtn");
  if (button) button.innerHTML = `<span class="saveIcon">&#128190;</span><span>${escapeHtml(text)}</span>`;
}

function fillStatusFromCurrentTimes() {
  captureActiveDailyValues();
  const firstEmpty = !dailyNormalValues.e1 && !dailyNormalValues.s1;
  const secondEmpty = !dailyNormalValues.e2 && !dailyNormalValues.s2;
  const firstComplete = parseTimeMinutes(dailyNormalValues.e1) !== null && parseTimeMinutes(dailyNormalValues.s1) !== null;
  const secondComplete = parseTimeMinutes(dailyNormalValues.e2) !== null && parseTimeMinutes(dailyNormalValues.s2) !== null;
  const hasAnyTurnoTime = Object.values(dailyNormalValues).some(Boolean);

  if (!hasAnyTurnoTime) return "";
  if ((firstComplete && secondEmpty) || (firstEmpty && secondComplete) || (firstComplete && secondComplete)) return "completo";
  return "incompleto";
}

function fillStatusMessage(date, status) {
  const label = status === "completo" ? "Completo" : "Incompleto";
  return `${brDate(date)}: Preenchimento ${label}`;
}

function updateFillStatusBanner(status = "", date = selectedWorkDate()) {
  const banner = byId("fillStatusBanner");
  if (!banner) return;
  const rows = [];
  const currentDate = selectedWorkDate();
  Object.values(currentMonthPointDays || {}).forEach((record) => {
    if (record?.data && record.data !== currentDate && record.statusPreenchimento === "incompleto") {
      rows.push({ date: record.data, status: "incompleto" });
    }
  });
  if (status) rows.push({ date, status });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  banner.classList.toggle("show", rows.length > 0);
  banner.innerHTML = rows.map((row) => {
    const statusClass = row.status === "completo" ? "complete" : "incomplete";
    return `<div class="fillStatusItem ${statusClass}">${escapeHtml(fillStatusMessage(row.date, row.status))}</div>`;
  }).join("");
}

function syncPendingTimeChange(input) {
  if (!input?.id) return;
  const trackingKey = `${selectedDailyShift}:${input.id}`;
  const current = String(input.value || "").trim();
  const saved = String(savedTimeValues[trackingKey] || "").trim();

  if (current === saved) {
    pendingTimeChanges.delete(trackingKey);
    if (current) markSaved(input);
    else setSaveFlag(input, null);
    updateSaveButtonState();
    return;
  }

  pendingTimeChanges.add(trackingKey);
  if (current) markUnsaved(input);
  else setSaveFlag(input, saved ? "unsaved" : null);
  updateFillStatusBanner("incompleto");
  updateSaveButtonState();
}

function clearPendingTimeChanges() {
  captureActiveDailyValues();
  savedTimeValues = allDailyTimeValues();
  savedDailyShift = selectedDailyShift;
  pendingDailyShiftChange = false;
  pendingTimeChanges.clear();
  $$(".timeTrack").forEach(markSaved);
  updateSaveButtonState();
}

function setTimeDisabled(input, disabled) {
  if (!input) return;
  input.disabled = disabled;
  input.closest(".timeEdit")?.classList.toggle("disabled", disabled);
}

function timeInput(id) {
  return byId(id);
}

function timeText(id) {
  return String(timeInput(id)?.value || "").trim();
}

function hasTime(id) {
  return timeText(id).length > 0;
}

function validTime(id) {
  return parseTimeMinutes(timeText(id)) !== null;
}

function completeInterval(startId, endId) {
  return validTime(startId) && validTime(endId);
}

function emptyInterval(startId, endId) {
  return !hasTime(startId) && !hasTime(endId);
}

function partialInterval(startId, endId) {
  return !emptyInterval(startId, endId) && !completeInterval(startId, endId);
}

function validateTimeInput(input, notify = true) {
  if (!input) return true;
  const value = String(input.value || "").trim();
  if (!value) return true;

  const formatted = formatTime(value);
  const [hoursRaw = "", minutesRaw = ""] = formatted.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (hoursRaw.length === 2 && hours > 23) {
    if (notify) showSaveError("Horas somente valores de 00 a 23");
    input.value = "";
    setSaveFlag(input, null);
    return false;
  }

  if (minutesRaw.length === 2 && minutes > 59) {
    if (notify) showSaveError("Minutos somente valores de 00 a 59");
    input.value = "";
    setSaveFlag(input, null);
    return false;
  }

  if (formatted.length < 5) return true;
  return parseTimeMinutes(formatted) !== null;
}

function validateTimeLimits() {
  return $$(".timeTrack").every((input) => {
    if (!validateTimeInput(input)) return false;
    if (String(input.value || "").trim() && parseTimeMinutes(input.value) === null) {
      showSaveError("Preencha o horário no formato 00:00.");
      return false;
    }
    return true;
  });
}

function markUnsaved(input) {
  if (!String(input?.value || "").trim()) {
    setSaveFlag(input, null);
    return;
  }
  setSaveFlag(input, "unsaved");
}

function markSaved(input) {
  if (!String(input?.value || "").trim()) {
    setSaveFlag(input, null);
    return;
  }
  setSaveFlag(input, "saved");
}

function intervalMinutes(startId, endId) {
  const start = parseTimeMinutes(byId(startId)?.value);
  const end = parseTimeMinutes(byId(endId)?.value);
  if (start === null || end === null) return 0;
  if (end <= start) {
    const overnight = selectedDailyShift === "noturno" && startId === "entrada1View" && endId === "saida1View";
    return overnight ? (24 * 60 - start) + end : 0;
  }
  return end - start;
}

function workedDayMinutes() {
  captureActiveDailyValues();
  return minutesBetween(dailyNormalValues.e1, dailyNormalValues.s1) + minutesBetween(dailyNormalValues.e2, dailyNormalValues.s2);
}

function geccDayMinutes() {
  captureActiveDailyValues();
  const start = parseTimeMinutes(dailyGeccValues.e1);
  const end = parseTimeMinutes(dailyGeccValues.s1);
  if (start === null || end === null) return 0;
  return end <= start ? (24 * 60 - start) + end : end - start;
}

function normalDayMinutes() {
  if (isMonthlySpecialDate(selectedWorkDate())) return 0;
  return Math.min(workedDayMinutes(), 8 * 60);
}

function extraDayMinutes() {
  if (isMonthlySpecialDate(selectedWorkDate())) return workedDayMinutes();
  return Math.max(0, workedDayMinutes() - normalDayMinutes());
}

function updateDaySummary() {
  const workedMinutes = workedDayMinutes();
  const normalMinutes = normalDayMinutes();
  const extraMinutes = extraDayMinutes();
  if (byId("worked")) byId("worked").textContent = formatMinutes(workedMinutes);
  if (byId("normal")) byId("normal").textContent = formatMinutes(normalMinutes);
  if (byId("extra")) byId("extra").textContent = formatMinutes(extraMinutes);
}

function syncTimeAvailability() {
  const firstPartial = partialInterval("entrada1View", "saida1View");
  const geccView = selectedDailyShift === "noturno";
  const canEditCurrentView = geccView ? canManageUsers() : !isManagingAnotherDailyPerson();

  setTimeDisabled(timeInput("entrada1View"), !canEditCurrentView);
  setTimeDisabled(timeInput("saida1View"), !canEditCurrentView || !hasTime("entrada1View"));
  setTimeDisabled(timeInput("entrada2View"), !canEditCurrentView || geccView || firstPartial);
  setTimeDisabled(timeInput("saida2View"), !canEditCurrentView || geccView || firstPartial || !hasTime("entrada2View"));
}

function validateTimeFlow() {
  const entrada1 = parseTimeMinutes(timeText("entrada1View"));
  const saida1 = parseTimeMinutes(timeText("saida1View"));
  const entrada2 = parseTimeMinutes(timeText("entrada2View"));
  const saida2 = parseTimeMinutes(timeText("saida2View"));

  if (hasTime("saida1View") && !hasTime("entrada1View")) {
    showSaveError("no 1º turno a saída está preenchida mas a entrada está vazia, conserte.");
    return false;
  }

  if (hasTime("saida2View") && !hasTime("entrada2View")) {
    showSaveError("no 2º turno a saída está preenchida mas a entrada está vazia, conserte.");
    return false;
  }

  if (partialInterval("entrada1View", "saida1View") && (hasTime("entrada2View") || hasTime("saida2View"))) {
    showSaveError("Preencha completamente ou limpe o 1º turno antes de registrar o 2º turno.");
    return false;
  }

  if (selectedDailyShift !== "noturno" && entrada1 !== null && saida1 !== null && saida1 <= entrada1) {
    showSaveError("1º expediente o horário da saída tem que ser maior que o da entrada");
    return false;
  }

  if (entrada2 !== null && saida2 !== null && saida2 <= entrada2) {
    showSaveError("2º expediente o horário da saída tem que ser maior que o da entrada");
    return false;
  }

  const firstTimes = [entrada1, saida1].filter((value) => value !== null);
  const secondTimes = [entrada2, saida2].filter((value) => value !== null);
  if (firstTimes.length && secondTimes.length && Math.min(...secondTimes) <= Math.max(...firstTimes)) {
    showSaveError("os horários do 2º turno tem que ser maior que dos 1º turno");
    return false;
  }

  return true;
}

function pointDataWorkedMinutes(data, options = {}) {
  const firstStart = parseTimeMinutes(data.e1);
  const firstEnd = parseTimeMinutes(data.s1);
  const firstMinutes = options.shift === "noturno" && firstStart !== null && firstEnd !== null && firstEnd <= firstStart
    ? (24 * 60 - firstStart) + firstEnd
    : minutesBetween(data.e1, data.s1);
  const nightStart = parseTimeMinutes(data.e3);
  const nightEnd = parseTimeMinutes(data.s3);
  const nightMinutes = nightStart !== null && nightEnd !== null
    ? (nightEnd <= nightStart ? (24 * 60 - nightStart) + nightEnd : nightEnd - nightStart)
    : 0;
  return firstMinutes + minutesBetween(data.e2, data.s2) + (options.excludeThirdFromWorked ? 0 : nightMinutes);
}

function pointDataExtraMinutes(data, options = {}) {
  const worked = pointDataWorkedMinutes(data, options);
  if (options.specialDate) return worked;
  return Math.max(0, worked - Math.min(worked, 8 * 60));
}

function pointValidationItem(message, fields = [], fieldTargets = {}) {
  return {
    message,
    targets: fields.map((field) => fieldTargets[field]).filter(Boolean)
  };
}

function validatePointTimes(data, options = {}) {
  const fieldTargets = options.fieldTargets || {};
  const errors = [];
  const add = (message, fields = []) => errors.push(pointValidationItem(message, fields, fieldTargets));

  ["e1", "s1", "e2", "s2", "e3", "s3", "gecc"].forEach((field) => {
    if (data[field] && parseTimeMinutes(data[field]) === null) add("Preencha o horário no formato 00:00.", [field]);
  });

  const e1 = parseTimeMinutes(data.e1);
  const s1 = parseTimeMinutes(data.s1);
  const e2 = parseTimeMinutes(data.e2);
  const s2 = parseTimeMinutes(data.s2);
  const e3 = parseTimeMinutes(data.e3);
  const s3 = parseTimeMinutes(data.s3);

  if (data.s1 && !data.e1) add("No 1º expediente a saída está preenchida mas a entrada está vazia.", ["s1"]);
  if (data.e1 && !data.s1) add("No 1º expediente a entrada está preenchida mas a saída está vazia.", ["e1"]);
  if (data.s2 && !data.e2) add("No 2º expediente a saída está preenchida mas a entrada está vazia.", ["s2"]);
  if (data.e2 && !data.s2) add("No 2º expediente a entrada está preenchida mas a saída está vazia.", ["e2"]);
  if (data.s3 && !data.e3) add("Na GECC o horário final está preenchido, mas o inicial está vazio.", ["s3"]);
  if (data.e3 && !data.s3) add("Na GECC o horário inicial está preenchido, mas o final está vazio.", ["e3"]);
  if (options.shift !== "noturno" && e1 !== null && s1 !== null && s1 <= e1) add("1º expediente: a saída deve ser maior que a entrada.", ["s1"]);
  if (e2 !== null && s2 !== null && s2 <= e2) add("2º expediente: a saída deve ser maior que a entrada.", ["s2"]);

  const firstTimes = [e1, s1].filter((value) => value !== null);
  const secondTimes = [e2, s2].filter((value) => value !== null);
  const thirdTimes = [e3, s3].filter((value) => value !== null);
  const firstPartial = firstTimes.length === 1;
  const secondPartial = secondTimes.length === 1;
  if (secondTimes.length && firstPartial) {
    add("Conclua ou limpe o 1º expediente antes de iniciar o 2º.", ["e1", "s1", "e2", "s2"].filter((field) => data[field]));
  }
  if (thirdTimes.length && (firstPartial || secondPartial)) {
    add("Conclua ou limpe os expedientes da folha normal antes de registrar a GECC.", ["e1", "s1", "e2", "s2", "e3", "s3"].filter((field) => data[field]));
  }
  if (firstTimes.length && secondTimes.length && Math.min(...secondTimes) <= Math.max(...firstTimes)) {
    const secondFields = ["e2", "s2"].filter((field) => data[field]);
    add("Os horários do 2º turno devem ser maiores que os do 1º turno.", secondFields);
  }
  const daytimeTimes = [...firstTimes, ...secondTimes];
  if (e3 !== null && daytimeTimes.length && e3 <= Math.max(...daytimeTimes)) {
    add("O horário inicial da GECC deve ser posterior ao término da folha normal.", ["e3"]);
  }

  const worked = pointDataWorkedMinutes(data, options);
  const extra = pointDataExtraMinutes(data, options);
  const gecc = parseTimeMinutes(data.gecc) || 0;
  const extraFields = options.excludeThirdFromWorked ? ["e1", "s1", "e2", "s2"] : ["e1", "s1", "e2", "s2", "e3", "s3"];
  if (extra > 2 * 60) add("As horas extras não podem ultrapassar 02 horas.", extraFields.filter((field) => data[field]));
  if (gecc > worked) add("As horas de GECC não podem ultrapassar o número de horas trabalhadas.", ["gecc"]);
  if (gecc > 3 * 60) add("As horas de GECC não podem ultrapassar 03 horas.", ["gecc"]);

  const seen = new Set();
  return errors.filter((item) => {
    const key = `${item.message}:${item.targets.map((target) => target?.id || target?.dataset?.monthlyField || "").join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pointValidationErrors() {
  captureActiveDailyValues();
  const geccMinutes = geccDayMinutes();
  return validatePointTimes({
    e1: dailyNormalValues.e1,
    s1: dailyNormalValues.s1,
    e2: dailyNormalValues.e2,
    s2: dailyNormalValues.s2,
    e3: dailyGeccValues.e1,
    s3: dailyGeccValues.s1,
    gecc: geccMinutes ? formatMinutes(geccMinutes) : ""
  }, {
    specialDate: isMonthlySpecialDate(selectedWorkDate()),
    excludeThirdFromWorked: true,
    fieldTargets: {
      e1: byId("entrada1View"),
      s1: byId("saida1View"),
      e2: byId("entrada2View"),
      s2: byId("saida2View"),
      e3: byId("entrada1View"),
      s3: byId("saida1View"),
      gecc: byId("entrada1View")
    }
  });
}

function selectedWorkDate() {
  const input = byId("workDate");
  if (!input?.value) updateWorkDateLabel();
  return input?.value || localDateValue();
}

function selectedCompetencia() {
  return selectedWorkDate().slice(0, 7);
}

function selectedDayKey(date = selectedWorkDate()) {
  return String(date || "").slice(8, 10);
}

function currentPersonId() {
  return currentUser?.uid || currentUser?.docId || currentUser?.id || auth.currentUser?.uid || "";
}

function pointRecordId(date = selectedWorkDate()) {
  return `${dailyPersonId()}_${String(date || "").slice(0, 7)}`;
}

function timeDayPayload() {
  captureActiveDailyValues();
  const workedMinutes = workedDayMinutes();
  const normalMinutes = normalDayMinutes();
  const extraMinutes = extraDayMinutes();
  const geccMinutes = geccDayMinutes();
  const data = selectedWorkDate();
  const hasNormal = Object.values(dailyNormalValues).some(Boolean);
  const hasGecc = Object.values(dailyGeccValues).some(Boolean);
  const payload = {
    data,
    turno: hasGecc ? (hasNormal ? "misto" : "noturno") : "diurno",
    entrada1: dailyNormalValues.e1,
    saida1: dailyNormalValues.s1,
    entrada2: dailyNormalValues.e2,
    saida2: dailyNormalValues.s2,
    entradaNoturna: dailyGeccValues.e1,
    saidaNoturna: dailyGeccValues.s1,
    horasGecc: geccMinutes ? formatMinutes(geccMinutes) : "",
    minutosTrabalhados: workedMinutes,
    minutosNormais: normalMinutes,
    minutosExtras: extraMinutes,
    minutosGecc: geccMinutes,
    statusPreenchimento: fillStatusFromCurrentTimes()
  };
  if (canManageUsers()) {
    payload.geccRegistradoPorUid = currentPersonId();
    payload.geccRegistradoPorNome = currentUser?.nome || "";
    payload.geccAtualizadoEm = new Date().toISOString();
  }
  return payload;
}

function timeRecordPayload() {
  const data = selectedWorkDate();
  const competencia = data.slice(0, 7);
  const dayKey = selectedDayKey(data);
  const person = dailyPointPerson();
  const perfilSnapshot = {
    nome: person?.nome || "",
    cpf: person?.cpf || "",
    matricula: person?.matricula || "",
    cargo: person?.cargo || "",
    lotacao: person?.lotacao || ""
  };

  return {
    uid: dailyPersonId(),
    pessoaId: personDocId(person) || dailyPersonId(),
    competencia,
    ...perfilSnapshot,
    perfilSnapshot,
    dias: {
      [dayKey]: timeDayPayload()
    }
  };
}

function applyPointRecord(record) {
  const legacyGeccOnly = record?.turno === "noturno";
  dailyNormalValues = {
    e1: legacyGeccOnly ? "" : (record?.entrada1 || ""),
    s1: legacyGeccOnly ? "" : (record?.saida1 || ""),
    e2: record?.entrada2 || "",
    s2: record?.saida2 || ""
  };
  dailyGeccValues = {
    e1: record?.entradaNoturna || (legacyGeccOnly ? record?.entrada1 : "") || "",
    s1: record?.saidaNoturna || (legacyGeccOnly ? record?.saida1 : "") || ""
  };
  savedDailyShift = legacyGeccOnly ? "noturno" : "diurno";
  pendingDailyShiftChange = false;
  selectDailyShift(savedDailyShift, { fromRecord: true });
  const fields = currentTimeValues();

  Object.entries(fields).forEach(([id, value]) => {
    const input = byId(id);
    if (!input) return;
    input.value = value;
    setSaveFlag(input, value ? "saved" : null);
  });

  savedTimeValues = allDailyTimeValues();
  pendingTimeChanges.clear();
  syncTimeAvailability();
  updateSaveButtonState();
  updateDaySummary();
  updateFillStatusBanner(record?.statusPreenchimento || fillStatusFromCurrentTimes());
  if (selectedCompetencia() === selectedMonthlyCompetencia) {
    const dayKey = selectedDayKey();
    monthlyPointDays = { ...(monthlyPointDays || {}), [dayKey]: record || {} };
    renderMonthlyTableRows();
  }
}

async function competenciaAberta(competencia = selectedCompetencia()) {
  if (USE_MOCK) {
    const dbData = readMockDb();
    const overrides = dbData.activeMonths || {};
    return effectiveMonthOpen(competencia, overrides);
  }

  for (const collectionName of ["mesesAtivos", "competencias"]) {
    try {
      const snap = await getDoc(doc(db, collectionName, competencia));
      if (!snap.exists()) continue;
      const data = snap.data();
      const status = String(data.status || "").toLowerCase();
      return data.ativo === true || data.active === true || status === "ativo" || status === "aberto";
    } catch (error) {
      return isDefaultMonthOpen(competencia);
    }
  }

  return isDefaultMonthOpen(competencia);
}

async function loadPointRecord() {
  if (!dailyPersonId()) {
    currentMonthPointDays = {};
    applyPointRecord({});
    return;
  }

  const recordId = pointRecordId();
  const dayKey = selectedDayKey();

  if (USE_MOCK) {
    const dbData = readMockDb();
    currentMonthPointDays = dbData.registrosPonto?.[recordId]?.dias || {};
    applyPointRecord(currentMonthPointDays?.[dayKey] || {});
    await syncRegisterCompetenciaVisibility();
    return;
  }

  try {
    const snap = await getDoc(doc(db, "registrosPonto", recordId));
    currentMonthPointDays = snap.exists() ? snap.data()?.dias || {} : {};
    applyPointRecord(currentMonthPointDays?.[dayKey] || {});
  } catch (error) {
    showSaveError("Não foi possível carregar o registro desta data.");
  }
  await syncRegisterCompetenciaVisibility();
}

async function syncRegisterCompetenciaVisibility() {
  const open = await competenciaAberta();
  $$(".registerPointPanel").forEach((panel) => {
    panel.classList.toggle("hidden", !open);
  });
  const closedMessage = byId("registerClosedMessage");
  if (closedMessage) closedMessage.hidden = open;
}

function bindTimeTracking() {
  $$(".timeTrack").forEach((input) => {
    input.addEventListener("input", () => {
      if (String(input.value || "").length === 5 && !validateTimeInput(input)) {
        captureActiveDailyValues();
        syncPendingTimeChange(input);
        updateFillStatusBanner("incompleto");
        syncTimeAvailability();
        updateDaySummary();
        return;
      }
      captureActiveDailyValues();
      syncPendingTimeChange(input);
      updateFillStatusBanner(fillStatusFromCurrentTimes(), selectedWorkDate());
      syncTimeAvailability();
      updateDaySummary();
    });
    input.addEventListener("blur", async () => {
      input.value = formatTime(input.value);
      captureActiveDailyValues();
      validateTimeInput(input);
      syncPendingTimeChange(input);
      syncTimeAvailability();
      updateDaySummary();
      if (pendingTimeChanges.size > 0 && pointValidationErrors().length === 0) {
        await savePointDraft({ automatic: true });
      }
    });
  });
  syncTimeAvailability();
  updateSaveButtonState();
}

function changedTimeSuccessLines() {
  const labels = {
    entrada1View: "1º expediente: entrada",
    saida1View: "1º expediente: saída",
    entrada2View: "2º expediente: entrada",
    saida2View: "2º expediente: saída"
  };
  return [...pendingTimeChanges].map((key) => {
    const id = key.split(":").pop();
    const gecc = key.startsWith("noturno:");
    const label = gecc
      ? (id === "entrada1View" ? "GECC: horário inicial" : "GECC: horário final")
      : labels[id];
    return `${label || id} gravada com sucesso!`;
  });
}

async function saveManagedGecc(targetUid, date, entrada, saida) {
  if (!auth.currentUser) throw new Error("Sessão administrativa inválida.");
  const idToken = await auth.currentUser.getIdToken(true);
  const response = await fetch("/api/admin/gecc", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(saida === undefined
      ? { targetUid, date, gecc: entrada }
      : { targetUid, date, entrada, saida })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível gravar GECC.");
  return result;
}

async function savePointDraft(options = {}) {
  const saveButton = byId("savePointBtn");
  if (pendingTimeChanges.size === 0 && !pendingDailyShiftChange) {
    updateSaveButtonState();
    return;
  }

  if (isManagingAnotherDailyPerson() && selectedDailyShift !== "noturno") {
    showSaveError("Gestor e administrador podem alterar somente os horários de GECC de outro usuário.");
    return;
  }
  if (!canManageUsers() && selectedDailyShift === "noturno") {
    showSaveError("GECC é registrada somente por Gestor ou Administrador.");
    return;
  }

  const validationErrors = pointValidationErrors();
  if (validationErrors.length) {
    showValidationPopover(validationErrors);
    syncTimeAvailability();
    updateDaySummary();
    return;
  }

  if (!dailyPersonId()) {
    showSaveError("Usuário não identificado para gravar o ponto.");
    return;
  }

  if (!await competenciaAberta()) {
    showSaveError("A competência selecionada não está aberta para edição.");
    return;
  }

  try {
    const successLines = changedTimeSuccessLines();
    if (saveButton) {
      saveButton.disabled = true;
      setSaveButtonText("Gravando");
    }

    const payload = timeRecordPayload();
    const recordId = pointRecordId(selectedWorkDate());
    const dayKey = selectedDayKey();
    const dayPayload = payload.dias[dayKey];

    if (USE_MOCK) {
      const dbData = readMockDb();
      dbData.registrosPonto = dbData.registrosPonto || {};
      const existing = dbData.registrosPonto[recordId] || {};
      dbData.registrosPonto[recordId] = {
        ...existing,
        id: recordId,
        uid: payload.uid,
        pessoaId: payload.pessoaId,
        competencia: payload.competencia,
        nome: payload.nome,
        cpf: payload.cpf,
        matricula: payload.matricula,
        cargo: payload.cargo,
        lotacao: payload.lotacao,
        perfilSnapshot: payload.perfilSnapshot,
        dias: {
          ...(existing.dias || {}),
          [dayKey]: dayPayload
        },
        createdAt: existing.createdAt || mockNow(),
        updatedAt: mockNow()
      };
      writeMockDb(dbData);
    } else if (isManagingAnotherDailyPerson()) {
      await saveManagedGecc(dailyPersonId(), selectedWorkDate(), dayPayload.entradaNoturna, dayPayload.saidaNoturna);
    } else {
      const ref = doc(db, "registrosPonto", recordId);
      const snap = await getDoc(ref).catch(() => null);
      await setDoc(ref, {
        id: recordId,
        uid: payload.uid,
        pessoaId: payload.pessoaId,
        competencia: payload.competencia,
        nome: payload.nome,
        cpf: payload.cpf,
        matricula: payload.matricula,
        cargo: payload.cargo,
        lotacao: payload.lotacao,
        perfilSnapshot: payload.perfilSnapshot,
        dias: {
          [dayKey]: dayPayload
        },
        createdAt: snap?.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    clearPendingTimeChanges();
    currentMonthPointDays = { ...(currentMonthPointDays || {}), [dayKey]: dayPayload };
    if (dailyPersonId() === currentPersonId() && payload.competencia === selectedMonthlyCompetencia) {
      monthlyPointDays = { ...(monthlyPointDays || {}), [dayKey]: dayPayload };
      renderMonthlyTableRows();
    }
    syncTimeAvailability();
    updateDaySummary();
    updateFillStatusBanner(dayPayload.statusPreenchimento, dayPayload.data);
    showSaveSuccess();
  } catch (error) {
    showSaveError("Não foi possível gravar os horários no banco de dados.");
  } finally {
    if (saveButton) {
      setSaveButtonText("Gravar");
      updateSaveButtonState();
    }
  }
}

function normalizedHaystack(item) {
  return [item?.nome, item?.cpf, item?.matricula, item?.cargo, item?.lotacao, item?.perfil, approvalStatus(item), userAccessStatus(item)]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function searchIncludes(item, inputId) {
  const terms = String(byId(inputId)?.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = normalizedHaystack(item);
  return terms.every((term) => haystack.includes(term));
}

function cadastroResumo(item) {
  return `Nome: ${item?.nome || ""}\nCPF: ${item?.cpf || ""}\nMatricula: ${item?.matricula || ""}\nCargo: ${item?.cargo || ""}\nLotacao: ${item?.lotacao || ""}`;
}

async function findFirebasePerson(authUser, allowedStatuses = []) {
  const ref = doc(db, "pessoas", authUser.uid);
  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists()) {
    const data = { _collection: "pessoas", docId: snap.id, id: snap.id, uid: authUser.uid, ...snap.data() };
    if (!allowedStatuses.length || allowedStatuses.includes(approvalStatus(data))) return data;
  }

  for (const field of ["email", "emailAuth"]) {
    const emailSnap = await getDocs(query(collection(db, "pessoas"), where(field, "==", authUser.email || ""), limit(1))).catch(() => null);
    if (emailSnap && !emailSnap.empty) {
      const emailDoc = emailSnap.docs[0];
      const data = { _collection: "pessoas", docId: emailDoc.id, id: emailDoc.id, uid: emailDoc.data().uid || authUser.uid, ...emailDoc.data() };
      if (!allowedStatuses.length || allowedStatuses.includes(approvalStatus(data))) return data;
    }
  }

  return null;
}

function showOnlyLogin() {
  document.body.classList.add("auth-locked");
  document.body.classList.remove("app-unlocked");
  byId("authLogin")?.classList.remove("hidden");
  byId("authRegister")?.classList.add("hidden");
  byId("authRecover")?.classList.add("hidden");
  byId("app")?.classList.add("hidden");
}

function showAuth(screen) {
  document.body.classList.add("auth-locked");
  document.body.classList.remove("app-unlocked");
  clearRegisterBanner();
  byId("authLogin")?.classList.toggle("hidden", screen !== "login");
  byId("authRegister")?.classList.toggle("hidden", screen !== "register");
  byId("authRecover")?.classList.toggle("hidden", screen !== "recover");
  byId("app")?.classList.add("hidden");
}

function showApp() {
  document.body.classList.remove("auth-locked");
  document.body.classList.add("app-unlocked");
  byId("authLogin")?.classList.add("hidden");
  byId("authRegister")?.classList.add("hidden");
  byId("authRecover")?.classList.add("hidden");
  byId("app")?.classList.remove("hidden");
  initializeDailyPersonControl();
  initializeMonthlyPersonControl();
  updateAppTop("Registrar");
  byId("navGestao")?.classList.toggle("disabled", !canManageUsers());
  showPage("Registrar");
  loadCalendarAdmin();
  if (canManageUsers()) loadUsers();
}

async function handleLogout() {
  currentUser = null;
  if (!USE_MOCK) {
    await signOut(auth);
  }
  clearAuthForms();
  showOnlyLogin();
}

function showPage(pageName) {
  if (pageName === "Gestao" && !canManageUsers()) {
    toast("Acesso restrito a Admin ou Gestor.");
    return;
  }

  currentPage = pageName;
  $$(".page").forEach((page) => page.classList.remove("active"));
  byId(`page${pageName}`)?.classList.add("active");

  $$(".bottom .navItem").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("href") === `#page${pageName}`);
  });

  updateAppTop(pageName);
  if (pageName === "Registrar") {
    showRegistroTab("diario");
    updateWorkDateLabel();
  }
  if (pageName === "Relatorios") initReportControls();
  if (pageName === "Gestao") loadUsers();
  if (pageName === "Perfil") showProfileTab("dados");
}

async function handleLogin() {
  const loginButton = $(".authCard .primary");
  const loginInput = byId("loginId")?.value || "";
  const password = byId("loginPass")?.value || "";

  if (!loginInput.trim() || !password) {
    toast("Informe login e senha.");
    return;
  }

  if (loginButton) {
    loginButton.disabled = true;
    loginButton.textContent = "Entrando...";
  }
  toast("Verificando login...");

  if (USE_MOCK) {
    const { user, request } = mockFindPerson(loginInput);
    if (request) {
      if (request.senha !== password) {
        if (loginButton) {
          loginButton.disabled = false;
          loginButton.textContent = "Entrar";
        }
        toast("Login ou senha inválidos.");
        return;
      }
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Entrar";
      }
      toast(requestAccessMessage(request));
      return;
    }
    if (!user || user.senha !== password) {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Entrar";
      }
      toast("Login ou senha inválidos.");
      return;
    }
    if (String(user.status || "").toLowerCase() !== "ativo") {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Entrar";
      }
      toast("Usuário sem acesso ativo.");
      return;
    }
    currentUser = { ...user };
    showApp();
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Entrar";
    }
    return;
  }

  try {
    const login = await resolveLoginEmail(loginInput, password);
    const credential = await signInWithEmailAndPassword(auth, login, password);
    const profile = await loadProfile(credential.user).catch(async (error) => {
      if (error.message !== "profile-not-found") throw error;
      const request = await loadRequest(credential.user);
      if (request) throw new Error(`request-${String(request.status || "pendente").toLowerCase()}`);
      throw error;
    });

    if (["inativo", "bloqueado"].includes(userAccessStatus(profile))) {
      await signOut(auth);
      toast("Usuário sem acesso ativo.");
      return;
    }

    if (approvalStatus(profile) === "pendente") {
      await signOut(auth);
      toast("Cadastro pendente de aprovação.");
      return;
    }

    currentUser = profile;
    await setDoc(doc(db, personCollection(profile), personDocId(profile)), {
      lastAccessAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
    showApp();
    const approvedRequest = await loadRequest(credential.user).catch(() => null);
    if (approvedRequest && approvalStatus(approvedRequest) === "aprovado" && !approvedRequest.approvalSeenAt) {
      toast(requestAccessMessage(approvedRequest));
      await setDoc(doc(db, personCollection(approvedRequest), personDocId(approvedRequest)), {
        approvalSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true }).catch(() => {});
    }
  } catch (error) {
    toast(firebaseMessage(error));
    if (auth.currentUser && String(error?.message || "").startsWith("request-")) {
      await signOut(auth).catch(() => {});
      showOnlyLogin();
    }
  } finally {
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Entrar";
    }
  }
}

async function handleRegister() {
  const form = byId("authRegister");
  const registerButton = $(".primary", form);
  const inputs = $$("input", form);
  const selects = $$("select", form);
  const [nomeRaw, cpf, matricula, emailRaw, senha, confirmaSenha] = inputs.map((input) => input.value.trim());
  const nome = normalizeName(nomeRaw);
  const email = normalizeEmail(emailRaw);
  if (inputs[0]) inputs[0].value = nome;
  if (inputs[3]) inputs[3].value = email;
  const cargo = selects[0]?.value || "PPF";
  const lotacao = selects[1]?.value || "";
  const profileData = {
    nome,
    cpf: formatCpf(cpf),
    email,
    matricula,
    cargo,
    lotacao
  };

  clearRegisterBanner();
  const errors = collectRegisterErrors(profileData, senha, confirmaSenha);
  if (errors.length) {
    showRegisterBanner(errors);
    return;
  }

  if (USE_MOCK) {
    const dbData = readMockDb();
    const id = mockId("pedido");
    dbData.requests.push({
      docId: id,
      uid: id,
      id,
      ...profileData,
      emailAuth: email,
      senha,
      perfil: "usuario",
      statusAprovacao: "pendente",
      statusUsuario: "",
      status: "pendente",
      createdAt: mockNow(),
      updatedAt: mockNow()
    });
    writeMockDb(dbData);
    showRegisterSuccess();
    return;
  }

  try {
    if (registerButton) {
      registerButton.disabled = true;
      registerButton.textContent = "Cadastrando...";
    }
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profileData, senha, confirmaSenha })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showRegisterBanner(Array.isArray(result.errors) && result.errors.length
        ? result.errors
        : ["SISTEMA: não foi possível concluir o cadastro"]);
      return;
    }
    showRegisterSuccess();
  } catch (error) {
    showRegisterBanner(["SISTEMA: falha de comunicação com o serviço de cadastro"]);
  } finally {
    if (registerButton) {
      registerButton.disabled = false;
      registerButton.textContent = "Cadastrar";
    }
  }
}
async function handleRecover() {
  const input = $("#authRecover input");
  const loginInput = input?.value || "";
  if (!loginInput.trim()) {
    toast("Informe CPF, matricula ou e-mail cadastrado.");
    return;
  }

  try {
    if (normalizeLogin(loginInput).includes("@")) {
      await sendPasswordResetEmail(auth, normalizeLogin(loginInput));
    } else {
      const response = await fetch("/api/auth/resolve-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: loginInput, purpose: "recover" })
      });
      if (!response.ok) throw new Error("recover-unavailable");
    }
    showAuth("login");
    toast("Link de redefinicao enviado para o e-mail cadastrado.");
  } catch (error) {
    toast(firebaseMessage(error));
  }
}

async function loadUsers() {
  if (!canManageUsers()) return;

  if (USE_MOCK) {
    const dbData = readMockDb();
    people = [
      ...dbData.users.map((item) => ({ _collection: "mock-users", statusAprovacao: "aprovado", statusUsuario: item.status || "ativo", ...item })),
      ...dbData.requests.map((item) => ({ _collection: "mock-requests", perfil: item.perfil || "usuario", statusAprovacao: approvalStatus(item) || "pendente", statusUsuario: item.statusUsuario || "", ...item }))
    ];
    users = people.filter((item) => approvalStatus(item) === "aprovado");
    requests = people.filter((item) => !["admin", "gestor"].includes(String(item.perfil || "").toLowerCase()));
    renderPeople();
    populateDailyPersonSelect();
    populateMonthlyPersonSelect();
    return;
  }

  try {
    const [peopleSnap, usersSnap, requestsSnap] = await Promise.all([
      getDocs(collection(db, "pessoas")).catch(() => ({ docs: [] })),
      getDocs(collection(db, "usuarios")).catch(() => ({ docs: [] })),
      getDocs(collection(db, "pedidosInclusao")).catch(() => ({ docs: [] }))
    ]);
    const primary = peopleSnap.docs.map((item) => ({ _collection: "pessoas", docId: item.id, id: item.id, uid: item.data().uid || item.id, ...item.data() }));
    const primaryIds = new Set(primary.flatMap((item) => [item.uid, item.docId, item.id].filter(Boolean)));
    const legacyUsers = usersSnap.docs
      .map((item) => ({ _collection: "usuarios", docId: item.id, id: item.id, uid: item.data().uid || item.id, statusAprovacao: "aprovado", statusUsuario: item.data().status || "ativo", ...item.data() }))
      .filter((item) => !primaryIds.has(item.uid) && !primaryIds.has(item.docId));
    const legacyRequests = requestsSnap.docs
      .map((item) => ({ _collection: "pedidosInclusao", docId: item.id, id: item.id, uid: item.data().uid || item.id, perfil: item.data().perfil || "usuario", statusAprovacao: approvalStatus(item.data()) || "pendente", statusUsuario: item.data().statusUsuario || "", ...item.data() }))
      .filter((item) => !primaryIds.has(item.uid) && !primaryIds.has(item.docId));

    people = [...primary, ...legacyUsers, ...legacyRequests];
    users = people.filter((item) => approvalStatus(item) === "aprovado");
    requests = people.filter((item) => !["admin", "gestor"].includes(String(item.perfil || "").toLowerCase()) && ["pendente", "rejeitado", "aprovado"].includes(approvalStatus(item)));
    renderPeople();
    populateDailyPersonSelect();
    populateMonthlyPersonSelect();
  } catch (error) {
    toast("Não foi possível carregar pessoas.");
  }
}

function renderPeople() {
  $$(".adminOnly").forEach((item) => {
    item.hidden = !isAdmin();
  });
  renderUsers();
  renderRequests();
  renderPermissions();
  updatePendingApprovalsBanner();
}

function userMatchesFilter(user) {
  if (currentFilter === "todos") return true;
  return userAccessStatus(user) === currentFilter;
}

function userMatchesSearch(user) {
  return searchIncludes(user, "searchInput");
}

function renderUsers() {
  const list = byId("usersList");
  if (!list) return;
  const approved = users.filter((user) => approvalStatus(user) === "aprovado");
  const visible = approved.filter(userMatchesFilter).filter(userMatchesSearch);

  byId("countTodos").textContent = pad2(approved.length);
  byId("countAtivos").textContent = pad2(approved.filter((user) => userAccessStatus(user) === "ativo").length);
  byId("countInativos").textContent = pad2(approved.filter((user) => ["inativo", "bloqueado"].includes(userAccessStatus(user))).length);

  list.innerHTML = visible.map((user) => {
    const status = userAccessStatus(user);
    return `
      <article class="personCard" data-id="${escapeHtml(personDocId(user))}">
        <button class="gestaoAvatar editable ${status === "inativo" ? "inactive" : ""}" title="Editar acesso" type="button">${escapeHtml(initials(user.nome || user.emailAuth))}</button>
        <div>
          <h3>${escapeHtml(user.nome || "")}</h3>
          <div class="meta">CPF: ${escapeHtml(user.cpf || "")}<br>Matricula: ${escapeHtml(user.matricula || "")}<br>Cargo: ${escapeHtml(user.cargo || "")} - Lotacao: ${escapeHtml(user.lotacao || "")}</div>
        </div>
        <div class="rightCol"><span class="pill ${status === "inativo" ? "gray" : ""}">${escapeHtml(statusLabel(status))}</span><br>${escapeHtml(roleLabel(user.perfil))}</div>
      </article>
    `;
  }).join("") || `<div class="note">Nenhum usuario encontrado.</div>`;
}

function requestMatchesFilter(request) {
  return approvalStatus(request) === currentRequestFilter;
}

function requestMatchesSearch(request) {
  return searchIncludes(request, "requestSearchInput");
}

function renderRequests() {
  const list = byId("requestsList");
  if (!list) return;

  const visible = requests.filter(requestMatchesFilter).filter(requestMatchesSearch);

  byId("countReqPendentes").textContent = pad2(requests.filter((request) => approvalStatus(request) === "pendente").length);
  byId("countReqRejeitados").textContent = pad2(requests.filter((request) => approvalStatus(request) === "rejeitado").length);
  byId("countReqAceitos").textContent = pad2(requests.filter((request) => approvalStatus(request) === "aprovado").length);

  list.innerHTML = visible.map((request) => {
    const status = approvalStatus(request);
    const actions = status === "pendente"
      ? `<div class="gestaoActions"><button class="accept" type="button" data-request-action="accept" data-id="${escapeHtml(personDocId(request))}">Aprovar</button><button class="reject" type="button" data-request-action="reject" data-id="${escapeHtml(personDocId(request))}">Rejeitar</button></div>`
      : `<div class="rightCol"><span class="pill ${status === "rejeitado" ? "red" : ""}">${escapeHtml(statusLabel(status))}</span></div>`;
    return `
      <article class="requestCard" data-id="${escapeHtml(personDocId(request))}">
        <button class="gestaoAvatar editable ${status === "rejeitado" ? "rejected" : ""}" title="${status === "rejeitado" ? "Editar acesso" : "Edicao disponivel apenas para rejeitados"}" type="button">${escapeHtml(initials(request.nome || request.emailAuth))}</button>
        <div>
          ${status === "pendente" ? `<span class="requestStatus">Pendente</span>` : ""}
          <h3>${escapeHtml(request.nome || "")}</h3>
          <div class="meta">CPF: ${escapeHtml(request.cpf || "")}<br>Matricula: ${escapeHtml(request.matricula || "")}<br>Cargo: ${escapeHtml(request.cargo || "")} - Lotacao: ${escapeHtml(request.lotacao || "")}</div>
        </div>
        ${actions}
      </article>
    `;
  }).join("") || `<div class="note">Nenhum pedido encontrado.</div>`;
}

function statusLabel(status) {
  const labels = {
    ativo: "Ativo",
    inativo: "Inativo",
    bloqueado: "Bloqueado",
    pendente: "Pendente",
    rejeitado: "Rejeitado",
    aceito: "Aprovado",
    aprovado: "Aprovado"
  };
  return labels[String(status || "").toLowerCase()] || status || "";
}

function roleLabel(role) {
  const labels = { admin: "Admin", gestor: "Gestor", usuario: "Usuario" };
  return labels[String(role || "").toLowerCase()] || role || "";
}

function renderPermissions() {
  const body = byId("permissionsBody");
  if (!body) return;
  const icon = (value) => value
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"></path></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>`;
  const matrix = [
    ["Registrar ponto", true, true, true],
    ["Relatorios proprios", true, true, true],
    ["Gestao > Usuarios", true, true, false],
    ["Gestao > Pedidos", true, true, false],
    ["Gestao > Backup", true, true, false],
    ["Gestao > Permissoes", true, false, false],
    ["Excluir definitivamente", true, false, false]
  ];
  const head = body.closest("table")?.querySelector("thead tr");
  if (head) {
    head.innerHTML = "<th>Rota / acao</th><th>Adm</th><th>Gest</th><th>Usu</th>";
  }
  body.innerHTML = matrix.map(([label, admin, gestor, usuario]) => `
    <tr><td>${escapeHtml(label)}</td>${[admin, gestor, usuario].map((value) => `<td><button class="permToggle ${value ? "on" : ""} locked" type="button" aria-label="${value ? "Permitido" : "Bloqueado"}">${icon(value)}</button></td>`).join("")}</tr>
  `).join("");
}

function brDate(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function monthLabel(competencia) {
  const [year, month] = String(competencia || "").split("-");
  return month && year ? `${month}/${year}` : competencia;
}

function holidayFor(date) {
  return holidays[date] || "";
}

function updateHolidayBanner() {
  const banner = byId("holidayBanner");
  const text = byId("holidayBannerText");
  if (!banner || !text) return;
  const date = selectedWorkDate();
  const name = holidayFor(date);
  banner.classList.toggle("show", Boolean(name));
  text.textContent = name ? `${brDate(date).slice(0, 5)}: Feriado de ${name}` : "";
}

function monthlyCompetenciasOpen() {
  const current = localDateValue().slice(0, 7);
  const open = Object.keys(activeMonths || {}).filter((key) => activeMonths[key] === true);
  if (effectiveMonthOpen(current) && !open.includes(current)) open.push(current);
  if (USE_MOCK && !open.length) open.push(current);
  return [...new Set(open)].sort().reverse();
}

function monthlyHolidays(competencia = selectedMonthlyCompetencia) {
  return Object.entries(holidays || {})
    .filter(([date]) => String(date).slice(0, 7) === competencia)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function renderMonthlyHolidayList() {
  const list = byId("monthlyHolidayList");
  if (!list) return;
  const items = monthlyHolidays();
  list.innerHTML = items.length ? items.map(([date, name]) => (
    `<div class="monthlyHolidayRow">${escapeHtml(brDate(date).slice(0, 5))}: ${escapeHtml(name)}</div>`
  )).join("") : `<div class="monthlyHolidayEmpty">Nenhum feriado cadastrado para este m&ecirc;s.</div>`;
}

function renderMonthlyRegisterControls() {
  const select = byId("monthlyCompetenciaSelect");
  if (!select) return;
  const current = localDateValue().slice(0, 7);
  const options = monthlyCompetenciasOpen();
  if (!options.length) {
    selectedMonthlyCompetencia = "";
    select.innerHTML = `<option value="">Nenhuma competência aberta</option>`;
    select.disabled = true;
    monthlyPointDays = {};
    renderMonthlyTableRows();
    renderMonthlyHolidayList();
    return;
  }
  select.disabled = false;
  if (!options.includes(selectedMonthlyCompetencia)) {
    selectedMonthlyCompetencia = options.includes(current) ? current : options[0];
  }
  select.innerHTML = options.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(monthLabel(key))}</option>`).join("");
  select.value = selectedMonthlyCompetencia;
  populateMonthlyPersonSelect();
  renderMonthlyHolidayList();
  renderMonthlyTableRows();
}

function toggleMonthlyHolidayPanel(forceOpen) {
  const panel = byId("monthlyHolidayPanel");
  if (!panel) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  if (shouldOpen) renderMonthlyHolidayList();
}

function monthlyDate(day, competencia = selectedMonthlyCompetencia) {
  return `${competencia}-${pad2(day)}`;
}

function monthlyDaysInCompetencia(competencia = selectedMonthlyCompetencia) {
  const [year, month] = String(competencia || "").split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(year, month, 0).getDate();
}

function isWeekendDate(date) {
  const weekday = dateFromInput(date).getDay();
  return weekday === 0 || weekday === 6;
}

function isMonthlySpecialDate(date) {
  return isWeekendDate(date) || Boolean(holidayFor(date));
}

function minutesBetween(start, end) {
  const startMinutes = parseTimeMinutes(start);
  const endMinutes = parseTimeMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return 0;
  return endMinutes - startMinutes;
}

function monthlyRowData(row) {
  const value = (field) => String(row.querySelector(`[data-monthly-field="${field}"]`)?.value || "").trim();
  return {
    e1: value("e1"),
    s1: value("s1"),
    e2: value("e2"),
    s2: value("s2"),
    e3: value("e3"),
    s3: value("s3"),
    gecc: value("gecc")
  };
}

function monthlyHasAnyTime(data) {
  return ["e1", "s1", "e2", "s2", "e3", "s3"].some((field) => Boolean(data[field]));
}

function monthlyTurnEmpty(data, start, end) {
  return !data[start] && !data[end];
}

function monthlyTurnComplete(data, start, end) {
  return parseTimeMinutes(data[start]) !== null && parseTimeMinutes(data[end]) !== null;
}

function monthlyFillStatus(data) {
  if (!monthlyHasAnyTime(data)) return "";
  const turns = [["e1", "s1"], ["e2", "s2"], ["e3", "s3"]];
  return turns.every(([start, end]) => monthlyTurnEmpty(data, start, end) || monthlyTurnComplete(data, start, end))
    ? "completo"
    : "incompleto";
}

function monthlyWorkedMinutes(data) {
  return pointDataWorkedMinutes(data);
}

function monthlyExtraMinutes(date, data) {
  return pointDataExtraMinutes(data, { specialDate: isMonthlySpecialDate(date) });
}

function monthlyValidationErrors(date, data, row = null) {
  const target = (field) => row?.querySelector(`[data-monthly-field="${field}"]`);
  return validatePointTimes(data, {
    specialDate: isMonthlySpecialDate(date),
    fieldTargets: {
      e1: target("e1"),
      s1: target("s1"),
      e2: target("e2"),
      s2: target("s2"),
      e3: target("e3"),
      s3: target("s3"),
      gecc: target("gecc")
    }
  });
}

function monthlyDayPayload(date, data) {
  const worked = monthlyWorkedMinutes(data);
  const normal = isMonthlySpecialDate(date) ? 0 : Math.min(worked, 8 * 60);
  const extra = monthlyExtraMinutes(date, data);
  const gecc = parseTimeMinutes(data.gecc) || 0;
  const hasDaytime = Boolean(data.e1 || data.s1 || data.e2 || data.s2);
  const hasNight = Boolean(data.e3 || data.s3);
  const nightOnly = hasNight && !hasDaytime;
  return {
    data: date,
    turno: nightOnly ? "noturno" : hasNight ? "misto" : "diurno",
    entrada1: nightOnly ? data.e3 : data.e1,
    saida1: nightOnly ? data.s3 : data.s1,
    entrada2: data.e2,
    saida2: data.s2,
    entradaNoturna: data.e3,
    saidaNoturna: data.s3,
    horasGecc: data.gecc,
    minutosTrabalhados: worked,
    minutosNormais: normal,
    minutosExtras: extra,
    minutosGecc: gecc,
    statusPreenchimento: monthlyFillStatus(data)
  };
}

function monthlyRecordData(record = {}) {
  const nightRecord = record.turno === "noturno";
  return {
    e1: nightRecord ? "" : (record.entrada1 || ""),
    s1: nightRecord ? "" : (record.saida1 || ""),
    e2: record.entrada2 || "",
    s2: record.saida2 || "",
    e3: record.entradaNoturna || (nightRecord ? record.entrada1 : "") || "",
    s3: record.saidaNoturna || (nightRecord ? record.saida1 : "") || "",
    gecc: record.horasGecc || ""
  };
}

function monthlySetRowEditing(row, editing) {
  if (!row) return;
  row.classList.toggle("monthlyEditing", editing);
  row.querySelectorAll(".monthlyTimeInput").forEach((input) => {
    const field = input.dataset.monthlyField;
    const allowed = field === "gecc" ? canManageUsers() : !isManagingAnotherMonthlyPerson();
    input.disabled = !editing || !allowed;
  });
  const button = row.querySelector(".monthlyEditBtn");
  if (button) {
    button.classList.toggle("editing", editing);
    button.innerHTML = editing ? "&#128190;" : "&#9998;";
    button.setAttribute("aria-label", editing ? "Gravar linha" : `Editar dia ${row.dataset.day}`);
  }
}

function monthlyUpdateRowState(row) {
  if (!row) return;
  const date = row.dataset.date;
  const data = monthlyRowData(row);
  const status = monthlyFillStatus(data);
  const errors = monthlyValidationErrors(date, data, row);
  const incomplete = Boolean(status) && (status !== "completo" || errors.length > 0);
  const complete = status === "completo" && errors.length === 0;

  row.classList.toggle("monthlyRowIncomplete", incomplete);
  row.classList.toggle("monthlyRowComplete", complete);
  row.querySelectorAll(".monthlyTimeInput").forEach((input) => input.classList.remove("monthlySaved"));

  if (complete) {
    if (monthlyTurnComplete(data, "e1", "s1")) {
      row.querySelector('[data-monthly-field="e1"]')?.classList.add("monthlySaved");
      row.querySelector('[data-monthly-field="s1"]')?.classList.add("monthlySaved");
    }
    if (monthlyTurnComplete(data, "e2", "s2")) {
      row.querySelector('[data-monthly-field="e2"]')?.classList.add("monthlySaved");
      row.querySelector('[data-monthly-field="s2"]')?.classList.add("monthlySaved");
    }
    if (monthlyTurnComplete(data, "e3", "s3")) {
      row.querySelector('[data-monthly-field="e3"]')?.classList.add("monthlySaved");
      row.querySelector('[data-monthly-field="s3"]')?.classList.add("monthlySaved");
    }
    if (data.gecc && parseTimeMinutes(data.gecc) !== null) row.querySelector('[data-monthly-field="gecc"]')?.classList.add("monthlySaved");
  }

  const extra = monthlyExtraMinutes(date, data);
  const gecc = parseTimeMinutes(data.gecc) || 0;
  const saldo = extra - gecc;
  const extraEl = row.querySelector("[data-monthly-total='extra']");
  const saldoEl = row.querySelector("[data-monthly-total='saldo']");
  if (extraEl) extraEl.textContent = formatMinutes(extra);
  if (saldoEl) {
    saldoEl.textContent = formatSignedMinutes(saldo);
    saldoEl.classList.toggle("negative", saldo < 0);
  }
}

function monthlyRowHtml(day, record = {}) {
  const date = monthlyDate(day);
  const weekday = dateFromInput(date).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
  const data = monthlyRecordData(record);
  const weekendClass = isWeekendDate(date) ? " monthlyWeekend" : "";
  const holidayFlag = holidayFor(date) ? `<span class="monthlyFlag">F</span>` : "";
  const value = (field) => escapeHtml(data[field] || "");
  return `
    <tr class="${weekendClass}" data-day="${pad2(day)}" data-date="${escapeHtml(date)}">
      <td class="cDay"><span class="monthlyDay">${pad2(day)}</span><span class="monthlyWeekday">${escapeHtml(weekday)}${holidayFlag}</span></td>
      <td class="cEdit"><button class="monthlyEditBtn" type="button" aria-label="Editar dia ${pad2(day)}">&#9998;</button></td>
      <td class="cTime"><input class="monthlyTimeInput" data-monthly-field="e1" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("e1")}" disabled></td>
      <td class="cTime"><input class="monthlyTimeInput" data-monthly-field="s1" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("s1")}" disabled></td>
      <td class="cTime"><input class="monthlyTimeInput" data-monthly-field="e2" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("e2")}" disabled></td>
      <td class="cTime"><input class="monthlyTimeInput" data-monthly-field="s2" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("s2")}" disabled></td>
      <td class="cTime cNight"><input class="monthlyTimeInput" data-monthly-field="e3" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("e3")}" disabled></td>
      <td class="cTime cNight"><input class="monthlyTimeInput" data-monthly-field="s3" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("s3")}" disabled></td>
      <td class="cTotal"><input class="monthlyTimeInput" data-monthly-field="gecc" placeholder="--:--" inputmode="numeric" maxlength="5" value="${value("gecc")}" disabled></td>
      <td class="cTotal"><span class="monthlyValue" data-monthly-total="extra">00:00</span></td>
      <td class="cTotal"><span class="monthlyValue" data-monthly-total="saldo">00:00</span></td>
    </tr>
  `;
}

function renderMonthlyTableRows() {
  const body = $(".monthlyTable tbody");
  if (!body) return;
  if (!selectedMonthlyCompetencia) {
    body.innerHTML = `<tr><td colspan="11" class="monthlyEmptyCompetencia">Nenhuma competência aberta.</td></tr>`;
    updateMonthlyTotals();
    return;
  }
  const days = monthlyDaysInCompetencia();
  body.innerHTML = Array.from({ length: days }, (_, index) => {
    const day = pad2(index + 1);
    return monthlyRowHtml(index + 1, monthlyPointDays?.[day] || {});
  }).join("");
  $$(".monthlyTable tbody tr").forEach(monthlyUpdateRowState);
  updateMonthlyTotals();
}

function updateMonthlyTotals() {
  let totalGecc = 0;
  let totalExtra = 0;
  $$(".monthlyTable tbody tr").forEach((row) => {
    const data = monthlyRowData(row);
    totalGecc += parseTimeMinutes(data.gecc) || 0;
    totalExtra += monthlyExtraMinutes(row.dataset.date, data);
  });
  const totalSaldo = totalExtra - totalGecc;
  const totals = $$(".monthlyTable tfoot .monthlyValue");
  if (totals[0]) totals[0].textContent = formatMinutes(totalGecc);
  if (totals[1]) totals[1].textContent = formatMinutes(totalExtra);
  if (totals[2]) {
    totals[2].textContent = formatSignedMinutes(totalSaldo);
    totals[2].classList.toggle("negative", totalSaldo < 0);
  }
}

async function loadMonthlyPointRecords(competencia = selectedMonthlyCompetencia) {
  if (!monthlyPersonId()) {
    monthlyPointDays = {};
    renderMonthlyTableRows();
    return;
  }

  const loadingKey = `${monthlyPersonId()}_${competencia}`;
  monthlyLoadingCompetencia = loadingKey;
  if (USE_MOCK) {
    const dbData = readMockDb();
    monthlyPointDays = dbData.registrosPonto?.[`${monthlyPersonId()}_${competencia}`]?.dias || {};
    renderMonthlyTableRows();
    return;
  }

  const snap = await getDoc(doc(db, "registrosPonto", `${monthlyPersonId()}_${competencia}`)).catch(() => null);
  if (monthlyLoadingCompetencia !== loadingKey) return;
  monthlyPointDays = snap?.exists() ? snap.data()?.dias || {} : {};
  renderMonthlyTableRows();
}

async function saveMonthlyRow(row, options = {}) {
  if (!row) return false;
  row.querySelectorAll(".monthlyTimeInput").forEach((input) => {
    input.value = formatTime(input.value);
  });

  const date = row.dataset.date;
  const competencia = date.slice(0, 7);
  const dayKey = date.slice(8, 10);
  const rawData = monthlyRowData(row);
  const existingData = monthlyRecordData(monthlyPointDays?.[dayKey] || {});
  const data = isManagingAnotherMonthlyPerson()
    ? { ...existingData, gecc: rawData.gecc }
    : !canManageUsers()
      ? { ...rawData, gecc: existingData.gecc }
      : rawData;
  Object.entries(data).forEach(([field, value]) => {
    const input = row.querySelector(`[data-monthly-field="${field}"]`);
    if (input) input.value = value;
  });
  monthlyUpdateRowState(row);
  updateMonthlyTotals();

  const errors = monthlyValidationErrors(date, data, row);
  if (errors.length) {
    if (!options.silent) showValidationPopover(errors);
    return false;
  }

  if (!monthlyPersonId()) {
    showSaveError("Usuário não identificado para gravar o ponto.");
    return false;
  }

  if (!await competenciaAberta(competencia)) {
    showSaveError("A competência selecionada não está aberta para edição.");
    return false;
  }

  const person = monthlyPointPerson();
  const perfilSnapshot = {
    nome: person?.nome || "",
    cpf: person?.cpf || "",
    matricula: person?.matricula || "",
    cargo: person?.cargo || "",
    lotacao: person?.lotacao || ""
  };
  const dayPayload = monthlyDayPayload(date, data);
  if (canManageUsers()) {
    dayPayload.geccRegistradoPorUid = currentPersonId();
    dayPayload.geccRegistradoPorNome = currentUser?.nome || "";
    dayPayload.geccAtualizadoEm = new Date().toISOString();
  }
  const recordId = `${monthlyPersonId()}_${competencia}`;

  try {
    if (USE_MOCK) {
      const dbData = readMockDb();
      dbData.registrosPonto = dbData.registrosPonto || {};
      const existing = dbData.registrosPonto[recordId] || {};
      dbData.registrosPonto[recordId] = {
        ...existing,
        id: recordId,
        uid: monthlyPersonId(),
        pessoaId: personDocId(person) || monthlyPersonId(),
        competencia,
        ...perfilSnapshot,
        perfilSnapshot,
        dias: {
          ...(existing.dias || {}),
          [dayKey]: dayPayload
        },
        createdAt: existing.createdAt || mockNow(),
        updatedAt: mockNow()
      };
      writeMockDb(dbData);
    } else if (isManagingAnotherMonthlyPerson()) {
      await saveManagedGecc(monthlyPersonId(), date, dayPayload.horasGecc);
    } else {
      const ref = doc(db, "registrosPonto", recordId);
      const snap = await getDoc(ref).catch(() => null);
      await setDoc(ref, {
        id: recordId,
        uid: monthlyPersonId(),
        pessoaId: personDocId(person) || monthlyPersonId(),
        competencia,
        ...perfilSnapshot,
        perfilSnapshot,
        dias: {
          [dayKey]: dayPayload
        },
        createdAt: snap?.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    monthlyPointDays = { ...(monthlyPointDays || {}), [dayKey]: dayPayload };
    if (monthlyPersonId() === dailyPersonId() && competencia === selectedCompetencia()) {
      currentMonthPointDays = { ...(currentMonthPointDays || {}), [dayKey]: dayPayload };
      if (date === selectedWorkDate()) applyPointRecord(dayPayload);
      else updateFillStatusBanner(fillStatusFromCurrentTimes(), selectedWorkDate());
    }
    monthlyUpdateRowState(row);
    updateMonthlyTotals();
    if (!options.silent) showSaveSuccess();
    return true;
  } catch (error) {
    showSaveError("Não foi possível gravar os horários no banco de dados.");
    return false;
  }
}

function updatePendingApprovalsBanner() {
  const total = canManageUsers() ? requests.filter((request) => approvalStatus(request) === "pendente").length : 0;
  const banner = byId("pendingApprovalsBanner");
  const text = byId("pendingApprovalsText");
  if (!banner || !text) return;
  banner.classList.toggle("show", total > 0);
  text.innerHTML = total > 0 ? `Há ${pad2(total)} cadastros pendentes! <a href="#" class="pendingApprovalsLink">Ver Pendências <span aria-hidden="true">&#8250;</span></a>` : "";
}

async function openPendingApprovals() {
  showPage("Gestao");
  await loadUsers();
  const peopleTab = $('[data-gestao-main="people"]');
  peopleTab?.click();
  const requestsItem = $('[data-gestao-view="requests"]');
  if (requestsItem) selectGestaoMenuItem(requestsItem);
  currentRequestFilter = "pendente";
  $$(".gestaoFilter[data-scope='requests']").forEach((item) => {
    item.classList.toggle("selected", item.dataset.requestFilter === "pendente");
  });
  renderRequests();
}

async function loadCalendarAdmin() {
  if (USE_MOCK) {
    const dbData = readMockDb();
    activeMonths = dbData.activeMonths || {};
    holidays = dbData.holidays || {};
    initCalendarControls();
    renderMonths();
    renderCalendarAdminBody();
    updateHolidayBanner();
    renderMonthlyRegisterControls();
    return;
  }

  try {
    const [competenciasSnap, mesesSnap, feriadosSnap] = await Promise.all([
      getDocs(collection(db, "competencias")).catch(() => ({ docs: [] })),
      getDocs(collection(db, "mesesAtivos")).catch(() => ({ docs: [] })),
      getDocs(collection(db, "feriados")).catch(() => ({ docs: [] }))
    ]);

    activeMonths = {};
    [...competenciasSnap.docs, ...mesesSnap.docs].forEach((item) => {
      const data = item.data();
      const status = String(data.status || "").toLowerCase();
      activeMonths[item.id] = data.ativo === true || data.active === true || status === "ativo" || status === "aberto";
    });

    holidays = {};
    feriadosSnap.docs.forEach((item) => {
      const data = item.data();
      const date = data.date || data.data || item.id;
      holidays[date] = data.name || data.nome || "Feriado";
    });

    initCalendarControls();
    renderMonths();
    renderCalendarAdminBody();
    updateHolidayBanner();
    renderMonthlyRegisterControls();
  } catch (error) {
    toast("Não foi possível carregar calendário.");
  }
}

function initCalendarControls() {
  const monthSel = byId("monthSel");
  const yearSel = byId("yearSel");
  const activeYearSelect = byId("activeYearSelect");
  const addMonthSel = byId("addMonthSel");
  const addYearSel = byId("addYearSel");
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, index) => currentYear - 2 + index);
  const activeYears = [currentYear - 1, currentYear, currentYear + 1];

  if (monthSel) {
    monthSel.innerHTML = MONTH_NAMES.map((month, index) => `<option value="${pad2(index + 1)}">${month}</option>`).join("");
    monthSel.value = calendarMonthValue.slice(5, 7);
  }
  if (yearSel) {
    yearSel.innerHTML = years.map((year) => `<option>${year}</option>`).join("");
    yearSel.value = calendarMonthValue.slice(0, 4);
  }
  if (activeYearSelect) {
    activeYearSelect.innerHTML = activeYears.map((year) => `<option value="${year}">${year}</option>`).join("");
    activeYearSelect.value = String(activeMonthYear || currentYear);
  }
  if (addMonthSel) addMonthSel.innerHTML = MONTH_NAMES.map((month, index) => `<option value="${pad2(index + 1)}">${month}</option>`).join("");
  if (addYearSel) addYearSel.innerHTML = years.map((year) => `<option>${year}</option>`).join("");
}

function isDefaultMonthOpen(competencia, now = new Date()) {
  const [year, month] = String(competencia || "").split("-").map(Number);
  if (!year || !month) return false;
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 10, 23, 59, 59, 999);
  return now >= start && now <= end;
}

function effectiveMonthOpen(competencia, overrides = activeMonths) {
  if (Object.prototype.hasOwnProperty.call(overrides || {}, competencia)) {
    return !!overrides[competencia];
  }
  return isDefaultMonthOpen(competencia);
}

function renderMonths() {
  const list = byId("monthList");
  if (!list) return;
  const year = Number(byId("activeYearSelect")?.value || activeMonthYear || new Date().getFullYear());
  activeMonthYear = year;
  const currentMonthIndex = new Date().getMonth();
  const monthIndexes = Array.from({ length: 12 }, (_, index) => (currentMonthIndex + index) % 12);
  const rows = monthIndexes.map((index) => `${year}-${pad2(index + 1)}`);
  list.innerHTML = `
    <div class="activeMonthRow head"><span>Mês/Ano</span><span>Status</span><span></span></div>
    ${rows.map((key) => {
      const active = effectiveMonthOpen(key);
      const selectClass = active ? "is-open" : "is-closed";
      return `
        <div class="activeMonthRow" data-month-row="${escapeHtml(key)}">
          <b>${escapeHtml(monthLabel(key))}</b>
          <select class="${selectClass}" data-active-month-status="${escapeHtml(key)}" disabled>
            <option value="aberto" ${active ? "selected" : ""}>Aberto</option>
            <option value="fechado" ${!active ? "selected" : ""}>Fechado</option>
          </select>
          <button class="activeMonthEdit" type="button" data-active-month-edit="${escapeHtml(key)}" aria-label="Editar status">✎</button>
        </div>
      `;
    }).join("")}
  `;
}

async function saveActiveMonthStatus(key) {
  const select = $(`[data-active-month-status="${CSS.escape(key)}"]`);
  if (!select) return;
  const active = select.value === "aberto";
  activeMonths[key] = active;
  select.disabled = true;
  select.classList.toggle("is-open", active);
  select.classList.toggle("is-closed", !active);
  const editButton = $(`[data-active-month-edit="${CSS.escape(key)}"]`);
  if (editButton) editButton.textContent = "✎";

  if (USE_MOCK) {
    persistMockCalendar();
  } else {
    await setDoc(doc(db, "competencias", key), {
      ativo: active,
      status: active ? "aberto" : "fechado",
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  renderMonthlyRegisterControls();
}

function editActiveMonthStatus(key) {
  const select = $(`[data-active-month-status="${CSS.escape(key)}"]`);
  const editButton = $(`[data-active-month-edit="${CSS.escape(key)}"]`);
  if (!select) return;
  if (select.disabled) {
    select.disabled = false;
    select.focus();
    if (editButton) editButton.textContent = "✓";
    return;
  }
  saveActiveMonthStatus(key);
}

function reportUserKey(user) {
  return String(user?.nome || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "usuario";
}

function legacyReportDay(record) {
  return {
    e1: record.entrada1 || "",
    s1: record.saida1 || "",
    e2: record.entrada2 || "",
    s2: record.saida2 || "",
    gecc: record.horasGecc || ""
  };
}

async function syncReportLocalData(ym) {
  const perfilSnapshot = {
    nome: currentUser?.nome || "",
    matricula: currentUser?.matricula || "",
    cpf: currentUser?.cpf || "",
    cargo: currentUser?.cargo || "PPF",
    lotacao: currentUser?.lotacao || ""
  };
  const key = `${reportUserKey(perfilSnapshot)}_${ym}`;
  const docData = { perfilSnapshot, dias: {} };

  if (USE_MOCK) {
    const dbData = readMockDb();
    const monthly = dbData.registrosPonto?.[`${currentPersonId()}_${ym}`] || {};
    Object.entries(monthly.dias || {}).forEach(([day, record]) => {
      docData.dias[pad2(day)] = legacyReportDay(record);
    });
  } else {
    const snap = await getDoc(doc(db, "registrosPonto", `${currentPersonId()}_${ym}`)).catch(() => null);
    const monthly = snap?.exists() ? snap.data() : {};
    Object.entries(monthly.dias || {}).forEach(([day, record]) => {
      docData.dias[pad2(day)] = legacyReportDay(record);
    });
  }

  localStorage.setItem("ppf_current_user_v2", JSON.stringify(perfilSnapshot));
  localStorage.setItem("ppf_records_monthly_v2", JSON.stringify({ [key]: docData }));
  localStorage.setItem("ppf_holidays_v2", JSON.stringify(
    Object.entries(holidays || {}).map(([date, name]) => ({ date, name }))
  ));
}

async function openReportTemplate(template) {
  const month = byId("reportMonth")?.value || pad2(new Date().getMonth() + 1);
  const year = byId("reportYear")?.value || String(new Date().getFullYear());
  const ym = `${year}-${month}`;
  const file = template === "sheet" ? "folha_frequencia_layout.html" : "relatorio_horas_layout.html";
  const reportWindow = window.open("about:blank", "_blank");
  await syncReportLocalData(ym);
  if (reportWindow) reportWindow.location.href = `${file}?ym=${encodeURIComponent(ym)}`;
  else window.location.href = `${file}?ym=${encodeURIComponent(ym)}`;
}

function renderMonthsLegacy() {
  const list = byId("monthList");
  if (!list) return;
  const keys = Object.keys(activeMonths).sort().reverse();
  list.innerHTML = keys.length ? keys.map((key) => {
    const active = !!activeMonths[key];
    return `
      <div class="competencia-row">
        <b>${escapeHtml(monthLabel(key))}</b>
        <span class="pill ${active ? "ativo" : "inativo"}">${active ? "Aberto" : "Fechado"}</span>
        <button class="mini-btn ${active ? "close" : "open"}" type="button" data-competencia-toggle="${escapeHtml(key)}">${active ? "Fechar" : "Abrir"}</button>
      </div>
    `;
  }).join("") : `<div class="empty">Nenhuma competência cadastrada.</div>`;
}

function renderCalendarAdminBody() {
  const box = byId("calendarBox");
  const list = byId("holidayList");
  if (!box || !list) return;
  const year = Number(calendarMonthValue.slice(0, 4));
  const month = Number(calendarMonthValue.slice(5, 7)) - 1;
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    let day = index - first + 1;
    let muted = false;
    let date;
    if (day < 1) {
      day = prevDays + day;
      muted = true;
      const prev = new Date(year, month - 1, day);
      date = localDateValue(prev);
    } else if (day > days) {
      day -= days;
      muted = true;
      const next = new Date(year, month + 1, day);
      date = localDateValue(next);
    } else {
      date = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    }
    const weekday = index % 7;
    cells.push(`<button class="cal-day ${muted ? "muted" : ""} ${weekday === 0 ? "weekend" : ""} ${weekday === 6 ? "sat" : ""} ${holidayFor(date) ? "holiday" : ""}" type="button" data-holiday-date="${escapeHtml(date)}">${day}</button>`);
  }

  box.innerHTML = `<div class="cal-head"><div>DOM</div><div>SEG</div><div>TER</div><div>QUA</div><div>QUI</div><div>SEX</div><div>SÁB</div></div><div class="cal-grid">${cells.join("")}</div>`;

  const items = Object.entries(holidays).sort((a, b) => b[0].localeCompare(a[0]));
  list.innerHTML = items.length ? items.map(([date, name]) => `
    <div class="feriado-card">
      <span class="dot"></span>
      <div><b>${escapeHtml(brDate(date))}</b><br>${escapeHtml(name)}</div>
      <button class="edit-btn" type="button" data-holiday-date="${escapeHtml(date)}">✎</button>
      <button class="edit-btn danger" type="button" data-holiday-delete="${escapeHtml(date)}">×</button>
    </div>
  `).join("") : `<div class="empty">Nenhum feriado cadastrado.</div>`;
}

function initReportControls() {
  const monthSelect = byId("reportMonth");
  const yearSelect = byId("reportYear");
  const now = new Date();
  const currentMonth = pad2(now.getMonth() + 1);
  const currentYear = String(now.getFullYear());
  const years = Array.from({ length: 7 }, (_, index) => now.getFullYear() - 2 + index);

  if (monthSelect && !monthSelect.options.length) {
    monthSelect.innerHTML = MONTH_NAMES.map((month, index) => `<option value="${pad2(index + 1)}">${month}</option>`).join("");
  }
  if (yearSelect && !yearSelect.options.length) {
    yearSelect.innerHTML = years.map((year) => `<option>${year}</option>`).join("");
  }
  if (monthSelect) monthSelect.value = currentMonth;
  if (yearSelect) yearSelect.value = currentYear;
}

function persistMockCalendar() {
  const dbData = readMockDb();
  dbData.activeMonths = activeMonths;
  dbData.holidays = holidays;
  writeMockDb(dbData);
}

async function toggleCompetencia(key) {
  activeMonths[key] = !activeMonths[key];
  if (USE_MOCK) {
    persistMockCalendar();
  } else {
    await setDoc(doc(db, "competencias", key), { ativo: activeMonths[key], status: activeMonths[key] ? "aberto" : "fechado", updatedAt: serverTimestamp() }, { merge: true });
  }
  renderMonths();
  renderMonthlyRegisterControls();
}

function openCompetenciaModal() {
  initCalendarControls();
  const addMonthSel = byId("addMonthSel");
  const addYearSel = byId("addYearSel");
  if (addMonthSel) addMonthSel.value = localDateValue().slice(5, 7);
  if (addYearSel) addYearSel.value = localDateValue().slice(0, 4);
  byId("monthModal")?.classList.add("show");
}

async function saveCompetenciaModal() {
  const key = `${byId("addYearSel")?.value}-${byId("addMonthSel")?.value}`;
  if (!key.includes("undefined")) {
    activeMonths[key] = true;
    if (USE_MOCK) persistMockCalendar();
    else await setDoc(doc(db, "competencias", key), { ativo: true, status: "aberto", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }
  closeModal("monthModal");
  renderMonths();
  renderMonthlyRegisterControls();
}

function openHoliday(date) {
  selectedHolidayDate = date;
  byId("holidayDate").value = brDate(date);
  byId("holidayName").value = holidays[date] || "";
  byId("holidayModalTitle").textContent = holidays[date] ? "Editar feriado" : "Cadastrar feriado";
  byId("deleteHoliday").style.visibility = holidays[date] ? "visible" : "hidden";
  byId("holidayModal")?.classList.add("show");
}

async function saveHolidayModal() {
  const name = byId("holidayName")?.value.trim() || "Feriado";
  holidays[selectedHolidayDate] = name;
  if (USE_MOCK) {
    persistMockCalendar();
  } else {
    await setDoc(doc(db, "feriados", selectedHolidayDate), { date: selectedHolidayDate, name, type: "feriado", updatedAt: serverTimestamp() }, { merge: true });
  }
  closeModal("holidayModal");
  renderCalendarAdminBody();
  updateHolidayBanner();
  renderMonthlyHolidayList();
  renderMonthlyTableRows();
}

async function deleteHolidayByDate(date = selectedHolidayDate) {
  delete holidays[date];
  if (USE_MOCK) {
    persistMockCalendar();
  } else {
    await deleteDoc(doc(db, "feriados", date)).catch(() => {});
  }
  closeModal("holidayModal");
  renderCalendarAdminBody();
  updateHolidayBanner();
  renderMonthlyHolidayList();
  renderMonthlyTableRows();
}

function openUserEdit(docId) {
  const user = users.find((item) => personDocId(item) === docId);
  if (!user) return;

  editingUserId = docId;
  byId("editCadastro").value = cadastroResumo(user);
  byId("editUserStatus").value = userAccessStatus(user) || "ativo";
  byId("roleSelect").value = String(user.perfil || "usuario").toLowerCase();
  byId("roleSelect").disabled = !canEditProfileField();
  byId("deleteUserBtn").disabled = !isAdmin();
  byId("userModal").classList.add("show");
}

function openRequestEdit(docId) {
  const request = requests.find((item) => personDocId(item) === docId);
  if (!request) return;
  if (approvalStatus(request) !== "rejeitado") {
    toast("O popover de pedidos abre apenas para rejeitados.");
    return;
  }

  editingRequestId = docId;
  byId("requestCadastro").value = cadastroResumo(request);
  byId("requestModal").classList.add("show");
}

async function acceptRequest(docId) {
  const request = requests.find((item) => personDocId(item) === docId);
  if (!request) return;

  if (USE_MOCK) {
    const dbData = readMockDb();
    const target = dbData.requests.find((item) => personDocId(item) === docId) || dbData.users.find((item) => personDocId(item) === docId);
    if (!target) return;
    target.status = "aprovado";
    target.statusAprovacao = "aprovado";
    target.statusUsuario = "ativo";
    target.perfil = target.perfil || "usuario";
    target.approvedAt = mockNow();
    target.updatedAt = mockNow();
    writeMockDb(dbData);
    closeModal("requestModal");
    toast("Pedido fake aprovado e usuario ativado.");
    await loadUsers();
    return;
  }

  const payload = {
    status: "aprovado",
    statusAprovacao: "aprovado",
    statusUsuario: "ativo",
    perfil: request.perfil || "usuario",
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, personCollection(request), personDocId(request)), payload, { merge: true });
    closeModal("requestModal");
    toast("Pedido aprovado e usuario ativado.");
    await loadUsers();
  } catch (error) {
    toast("Não foi possível aprovar o pedido.");
  }
}

async function rejectRequest(docId) {
  const request = requests.find((item) => personDocId(item) === docId);
  if (!request) return;

  if (USE_MOCK) {
    const dbData = readMockDb();
    const target = dbData.requests.find((item) => personDocId(item) === docId);
    if (target) {
      target.status = "rejeitado";
      target.statusAprovacao = "rejeitado";
      target.statusUsuario = "";
      target.rejectedAt = mockNow();
      target.updatedAt = mockNow();
      writeMockDb(dbData);
    }
    toast("Pedido fake rejeitado.");
    await loadUsers();
    return;
  }

  try {
    await setDoc(doc(db, personCollection(request), personDocId(request)), {
      status: "rejeitado",
      statusAprovacao: "rejeitado",
      statusUsuario: "",
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast("Pedido rejeitado.");
    await loadUsers();
  } catch (error) {
    toast("Não foi possível rejeitar o pedido.");
  }
}

async function deleteRequest() {
  if (!editingRequestId) return;
  const request = requests.find((item) => personDocId(item) === editingRequestId);
  if (request) openDeleteFlow(request, "requestModal");
}

async function saveUserEdit() {
  if (!editingUserId) return;
  const editedUser = users.find((item) => personDocId(item) === editingUserId);
  const nextPerfil = canEditProfileField() ? byId("roleSelect").value : editedUser?.perfil;

  const payload = {
    status: byId("editUserStatus").value,
    statusUsuario: byId("editUserStatus").value,
    updatedAt: serverTimestamp()
  };

  if (canEditProfileField()) {
    payload.perfil = nextPerfil;
  }

  if (USE_MOCK) {
    const dbData = readMockDb();
    const target = dbData.users.find((item) => personDocId(item) === editingUserId) || dbData.requests.find((item) => personDocId(item) === editingUserId);
    if (target) {
      Object.assign(target, payload, { updatedAt: mockNow() });
      writeMockDb(dbData);
      if ((currentUser?.docId || currentUser?.id) === editingUserId) currentUser = { ...target };
    }
    closeModal("userModal");
    toast("Usuário fake atualizado.");
    await loadUsers();
    return;
  }

  try {
    await setDoc(doc(db, personCollection(editedUser), personDocId(editedUser)), payload, { merge: true });
    closeModal("userModal");
    toast("Usuário atualizado.");
    await loadUsers();
  } catch (error) {
    toast("Não foi possível salvar o usuário.");
  }
}

async function deleteUserEdit() {
  if (!editingUserId) return;
  const user = users.find((item) => personDocId(item) === editingUserId);
  if (user) openDeleteFlow(user, "userModal");
}

function openDeleteFlow(person, sourceModal) {
  if (!isAdmin()) {
    toast("Somente admin pode excluir definitivamente.");
    return;
  }
  pendingDelete = { person, sourceModal };
  byId("deleteConfirmText").textContent = `Deseja remover definitavamente o registro ${person.nome || ""} do banco de dados ?`;
  closeModal(sourceModal);
  byId("deleteConfirmModal").classList.add("show");
}

async function deletePointRecordsForPerson(person) {
  const ids = [...new Set([personDocId(person), person?.uid, person?.id, person?.docId].filter(Boolean))];
  if (!ids.length) return;

  if (USE_MOCK) {
    const dbData = readMockDb();
    const records = dbData.registrosPonto || {};
    Object.keys(records).forEach((key) => {
      const record = records[key] || {};
      if (ids.some((id) => key.startsWith(`${id}_`) || record.uid === id || record.pessoaId === id)) {
        delete records[key];
      }
    });
    dbData.registrosPonto = records;
    writeMockDb(dbData);
    return;
  }

  const refs = new Map();
  for (const id of ids) {
    for (const field of ["uid", "pessoaId"]) {
      const snap = await getDocs(query(collection(db, "registrosPonto"), where(field, "==", id))).catch(() => ({ docs: [] }));
      snap.docs.forEach((item) => refs.set(item.id, item.ref));
    }
  }

  await Promise.all([...refs.values()].map((ref) => deleteDoc(ref)));
}

async function confirmCredentialDelete() {
  if (!pendingDelete?.person) return;
  const password = byId("adminPassword")?.value || "";
  if (!password) {
    toast("Informe a senha do admin.");
    return;
  }

  if (USE_MOCK) {
    if (password !== "admin123") {
      toast("Senha do admin inválida.");
      return;
    }
    const dbData = readMockDb();
    const id = personDocId(pendingDelete.person);
    dbData.users = dbData.users.filter((item) => personDocId(item) !== id);
    dbData.requests = dbData.requests.filter((item) => personDocId(item) !== id);
    writeMockDb(dbData);
    await deletePointRecordsForPerson(pendingDelete.person);
    finishDeleteFlow("Registro fake excluído.");
    return;
  }

  try {
    const authUser = auth.currentUser;
    const credential = EmailAuthProvider.credential(authUser.email, password);
    await reauthenticateWithCredential(authUser, credential);
    const person = pendingDelete.person;
    await deletePointRecordsForPerson(person);
    await deleteDoc(doc(db, personCollection(person), personDocId(person)));
    if (personCollection(person) === "pessoas") {
      await deleteDoc(doc(db, "usuarios", personDocId(person))).catch(() => {});
      await deleteDoc(doc(db, "pedidosInclusao", personDocId(person))).catch(() => {});
    }
    finishDeleteFlow("Registro excluído definitivamente.");
  } catch (error) {
    toast(firebaseMessage(error));
  }
}

function finishDeleteFlow(message) {
  closeModal("credentialModal");
  byId("adminPassword").value = "";
  pendingDelete = null;
  toast(message);
  loadUsers();
}

function renderProfile() {
  if (!currentUser) return;

  updateAppTop("Perfil");
  const statusValue = userAccessStatus(currentUser);
  const statusClass = statusValue === "ativo" ? "" : " inactive";

  const rows = [
    ["Nome", currentUser.nome],
    ["E-mail", currentUser.email || currentUser.emailAuth],
    ["CPF", currentUser.cpf],
    ["Matrícula", currentUser.matricula],
    ["Cargo", currentUser.cargo],
    ["Lotação", currentUser.lotacao],
    ["Papel", `<span class="infoPill role">${escapeHtml(roleLabel(currentUser.perfil))}</span>`],
    ["Status", `<span class="infoPill${statusClass}">${escapeHtml(statusLabel(statusValue))}</span>`]
  ];

  byId("profileFields").innerHTML = rows.map(([label, value]) => `
    <div class="infoRow"><b>${escapeHtml(label)}</b><span>${label === "Papel" || label === "Status" ? value : escapeHtml(value || "")}</span></div>
  `).join("");
}

function initials(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function updateAppTop(pageName = "Registrar") {
  const [title, subtitle] = PAGE_META[pageName] || PAGE_META.Registrar;
  if (byId("appSectionTitle")) byId("appSectionTitle").textContent = title;
  if (byId("appSectionSubtitle")) byId("appSectionSubtitle").textContent = subtitle;

  const displayName = currentUser?.nome || currentUser?.email || "";
  const initialsText = initials(displayName) || "PP";
  if (byId("accountInitials")) byId("accountInitials").textContent = initialsText.slice(0, 2);
  if (byId("accountMenuName")) byId("accountMenuName").textContent = displayName;

  $$("[data-account-page]").forEach((button) => {
    const target = button.dataset.accountPage;
    const disabled = target === "Gestao" && !canManageUsers();
    button.classList.toggle("current", target === pageName);
    button.classList.toggle("disabled", disabled);
    button.disabled = disabled;
    const note = $("small", button);
    if (note) note.textContent = target === pageName ? "atual" : disabled ? "sem acesso" : "";
  });
}

function renderProfileEdit() {
  const fields = [
    ["nome", "Nome *", currentUser.nome || "", "input"],
    ["email", "E-mail", currentUser.email || currentUser.emailAuth || "", "readonly"],
    ["cpf", "CPF *", formatCpf(currentUser.cpf || ""), "input"],
    ["matricula", "Matrícula *", currentUser.matricula || "", "input"],
    ["cargo", "Cargo *", currentUser.cargo || "PPF", "cargo"],
    ["lotacao", "Lotação *", currentUser.lotacao || "", "lotacao"]
  ];

  byId("profileFields").innerHTML = `
    <div class="grid2">
      ${fields.map(([name, label, value, type]) => `
        <div class="field ${name === "nome" ? "full" : ""}">
          <label>${escapeHtml(label)}</label>
          ${profileFieldControl(name, value, type)}
        </div>
      `).join("")}
    </div>
  `;

  attachMaskedInput($('[data-profile-field="cpf"]'), formatCpf);

  const actions = $("#profileDados .formActions");
  actions.innerHTML = `
    <button class="secondary" type="button" data-profile-cancel>Cancelar</button>
    <button class="primary" type="button" data-profile-save>Salvar</button>
  `;

  $("[data-profile-cancel]")?.addEventListener("click", () => {
    renderProfile();
    restoreProfileEditButton();
  });
  $("[data-profile-save]")?.addEventListener("click", saveProfile);
}

function profileFieldControl(name, value, type) {
  if (type === "readonly") {
    return `<input value="${escapeHtml(value)}" disabled>`;
  }
  if (type === "cargo") {
    return `<select data-profile-field="cargo"><option ${value === "PPF" ? "selected" : ""}>PPF</option></select>`;
  }
  if (type === "lotacao") {
    return `<select data-profile-field="lotacao"><option value="">Selecione</option>${LOTACOES.map((lotacao) => `<option ${value === lotacao ? "selected" : ""}>${lotacao}</option>`).join("")}</select>`;
  }
  return `<input data-profile-field="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function restoreProfileEditButton() {
  const actions = $("#profileDados .formActions");
  actions.innerHTML = `<button class="secondary" type="button">Editar Dados</button>`;
  $("#profileDados .formActions .secondary")?.addEventListener("click", renderProfileEdit);
}

async function saveProfile() {
  const payload = {};
  $$("[data-profile-field]").forEach((field) => {
    payload[field.dataset.profileField] = field.value.trim();
  });
  payload.cpf = formatCpf(payload.cpf || "");

  if (!payload.nome) {
    toast("Informe o nome.");
    return;
  }

  if (String(currentUser.perfil || "").toLowerCase() === "usuario" && !validateRequiredUserData(payload)) {
    return;
  }

  try {
    if (USE_MOCK) {
      const dbData = readMockDb();
      const target = dbData.users.find((item) => personDocId(item) === personDocId(currentUser));
      if (target) Object.assign(target, payload, { updatedAt: mockNow() });
      writeMockDb(dbData);
    } else {
      const idToken = await auth.currentUser.getIdToken(true);
      const response = await fetch("/api/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.errors) ? result.errors.join(" ") : "Não foi possível salvar o perfil.");
      Object.assign(payload, result.profile || {});
    }
    currentUser = { ...currentUser, ...payload, updatedAt: new Date().toISOString() };
    renderProfile();
    restoreProfileEditButton();
    updateAppTop("Perfil");
    toast("Perfil atualizado.");
  } catch (error) {
    toast(error.message || "Não foi possível salvar o perfil.");
  }
}

function showProfileTab(tabName) {
  $$(".profileTab").forEach((tab) => tab.classList.remove("active"));
  $$(".profileTab")[tabName === "senha" ? 1 : 0]?.classList.add("active");
  byId("profileDados")?.classList.toggle("hidden", tabName !== "dados");
  byId("profileSenha")?.classList.toggle("hidden", tabName !== "senha");

  if (tabName === "dados") {
    renderProfile();
    restoreProfileEditButton();
  }
}

async function changePassword() {
  const inputs = $$("#profileSenha input");
  const [currentPassword, newPassword, confirmPassword] = inputs.map((input) => input.value);

  if (!currentPassword || !newPassword || !confirmPassword) {
    toast("Preencha todos os campos de senha.");
    return;
  }

  if (newPassword.length < 6) {
    toast("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  if (newPassword !== confirmPassword) {
    toast("A confirmação não confere.");
    return;
  }

  try {
    const authUser = auth.currentUser;
    const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
    await reauthenticateWithCredential(authUser, credential);
    await updatePassword(authUser, newPassword);
    inputs.forEach((input) => {
      input.value = "";
    });
    toast("Senha alterada.");
  } catch (error) {
    toast(firebaseMessage(error));
  }
}

function closeModal(id) {
  byId(id)?.classList.remove("show");
}

function firebaseMessage(error) {
  const code = error?.code || "";
  const messages = {
    "profile-not-found": "Perfil não encontrado em usuários.",
    "login-not-found": "Login não encontrado em usuários.",
    "cpf-login-unavailable": "No momento, entre pela matrícula. O login por CPF precisa de permissão de consulta no Firestore.",
    "request-pendente": "Seu cadastro ainda está em análise, qualquer dúvida entre em contato pelo e-mail=suporte@ponto-ppf.local",
    "request-rejeitado": "Sentimos muito, mas seu cadastro não foi aprovado. Qualquer dúvida entre em contato pelo e-mail=suporte@ponto-ppf.local",
    "request-aceito": "Seu cadastro foi aprovado. Tente fazer login novamente.",
    "request-aprovado": "Seu cadastro foi aprovado. Tente fazer login novamente.",
    "auth/invalid-credential": "Login ou senha inválidos.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha inválida.",
    "auth/invalid-login-credentials": "Senha atual inválida.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/network-request-failed": "Falha de rede ao falar com o Firebase.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
    "auth/requires-recent-login": "Faça login novamente para alterar a senha.",
    "permission-denied": "Sem permissão no Firebase."
  };
  return messages[code] || messages[error?.message] || "Não foi possível concluir a operação.";
}

function bindAuthButtons() {
  $(".authCard .primary")?.addEventListener("click", handleLogin);
  $('[data-auth-link="register"]')?.addEventListener("click", () => showAuth("register"));
  $('[data-auth-link="recover"]')?.addEventListener("click", () => showAuth("recover"));
  enhanceRegisterPasswordInputs();
  bindPasswordPeek();
  $("#authRegister .authTop .back")?.addEventListener("click", () => showAuth("login"));
  $("#authRecover .authTop .back")?.addEventListener("click", () => showAuth("login"));
  $("#authRegister .primary")?.addEventListener("click", handleRegister);
  $("#authRegister p .linkBtn")?.addEventListener("click", () => showAuth("login"));
  $("#authRecover .primary")?.addEventListener("click", handleRecover);
  $("#authRecover .linkBtn")?.addEventListener("click", () => showAuth("login"));
  bindAccountMenu();

  [byId("loginId"), byId("loginPass")].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleLogin();
    });
  });
}

function enhanceRegisterPasswordInputs() {
  $$("#authRegister input[type='password']").forEach((input) => {
    if (input.closest(".passwordField")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "passwordField";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement("button");
    button.className = "passwordPeek";
    button.type = "button";
    button.setAttribute("aria-label", "Mostrar senha");
    button.title = "Mostrar senha";
    button.innerHTML = `
      <svg class="eyeOff" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.2 3.3"></path><path d="M6.1 6.1C3.4 7.9 2 12 2 12s3.5 8 10 8c1.6 0 3-.4 4.2-1"></path></svg>
      <svg class="eyeOn" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    wrapper.appendChild(button);
  });
}

function bindAccountMenu() {
  const box = $(".accountBox");
  const button = byId("accountAvatarBtn");
  const menu = byId("accountMenu");
  if (!box || !button || !menu || button.dataset.bound === "1") return;
  button.dataset.bound = "1";

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.classList.toggle("show");
    if (menu.classList.contains("show")) {
      const firstItem = $("[data-account-page]", menu);
      firstItem?.focus({ preventScroll: true });
    }
  });

  $$("[data-account-page]", menu).forEach((item) => {
    item.addEventListener("click", () => {
      if (item.disabled) return;
      menu.classList.remove("show");
      showPage(item.dataset.accountPage);
    });
  });

  byId("accountMenuLogout")?.addEventListener("click", () => {
    menu.classList.remove("show");
    handleLogout();
  });

  document.addEventListener("click", (event) => {
    if (!box.contains(event.target)) menu.classList.remove("show");
  });

  menu.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!box.contains(document.activeElement)) menu.classList.remove("show");
    }, 0);
  });
}

function bindPasswordPeek() {
  // O clique do olho e a troca dos SVGs ficam no script inline do HTML.
}

function bindNavigation() {
  $$(".bottom .navItem").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const pageName = item.getAttribute("href").replace("#page", "");
      showPage(pageName);
    });
  });

  $$(".gestaoTab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const main = tab.dataset.gestaoMain;
      $$(".gestaoTab").forEach((item) => item.classList.toggle("active", item === tab));
      $$(".gestaoChooser").forEach((chooser) => {
        chooser.hidden = chooser.dataset.menu !== main;
        chooser.classList.remove("open");
      });
      if (main === "calendar") {
        const chooser = $('.gestaoChooser[data-menu="calendar"]');
        chooser?.querySelectorAll(".gestaoMenuItem").forEach((item) => {
          item.classList.toggle("active", item.dataset.gestaoView === "months");
        });
        const icon = chooser?.querySelector("[data-choice-icon]");
        const label = chooser?.querySelector("[data-choice-label]");
        if (icon) icon.textContent = "📅";
        if (label) label.textContent = "Meses Ativos";
        showGestaoView("months");
        return;
      }
      const active = $(`.gestaoChooser[data-menu="${main}"] .gestaoMenuItem.active`);
      showGestaoView(active?.dataset.gestaoView || "users");
    });
  });

  byId("activeYearSelect")?.addEventListener("change", (event) => {
    activeMonthYear = Number(event.target.value);
    renderMonths();
  });
  byId("openHoursReport")?.addEventListener("click", () => openReportTemplate("hours"));
  byId("openFrequencySheet")?.addEventListener("click", () => openReportTemplate("sheet"));
  byId("addCompetenciaBtn")?.addEventListener("click", openCompetenciaModal);
  byId("toggleHolidayCalendar")?.addEventListener("click", () => {
    const panel = byId("holidayCalendarPanel");
    const button = byId("toggleHolidayCalendar");
    if (!panel || !button) return;
    panel.hidden = !panel.hidden;
    const arrow = button.querySelector("[data-calendar-arrow]");
    if (arrow) arrow.textContent = panel.hidden ? "▾" : "▴";
    button.setAttribute("aria-label", panel.hidden ? "Exibir calendário" : "Recolher calendário");
  });
  byId("monthSel")?.addEventListener("change", (event) => {
    calendarMonthValue = `${calendarMonthValue.slice(0, 4)}-${event.target.value}`;
    renderCalendarAdminBody();
  });
  byId("yearSel")?.addEventListener("change", (event) => {
    calendarMonthValue = `${event.target.value}-${calendarMonthValue.slice(5, 7)}`;
    renderCalendarAdminBody();
  });
  byId("prevCalendarMonth")?.addEventListener("click", () => {
    const date = dateFromInput(`${calendarMonthValue}-01`);
    date.setMonth(date.getMonth() - 1);
    calendarMonthValue = localDateValue(date).slice(0, 7);
    initCalendarControls();
    renderCalendarAdminBody();
  });
  byId("nextCalendarMonth")?.addEventListener("click", () => {
    const date = dateFromInput(`${calendarMonthValue}-01`);
    date.setMonth(date.getMonth() + 1);
    calendarMonthValue = localDateValue(date).slice(0, 7);
    initCalendarControls();
    renderCalendarAdminBody();
  });
  byId("monthList")?.addEventListener("click", (event) => {
    const editMonthButton = event.target.closest("[data-active-month-edit]");
    if (editMonthButton) {
      editActiveMonthStatus(editMonthButton.dataset.activeMonthEdit);
      return;
    }
    const button = event.target.closest("[data-competencia-toggle]");
    if (button) toggleCompetencia(button.dataset.competenciaToggle);
  });
  byId("monthList")?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-active-month-status]");
    if (!select) return;
    select.classList.toggle("is-open", select.value === "aberto");
    select.classList.toggle("is-closed", select.value !== "aberto");
  });
  byId("calendarBox")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-holiday-date]");
    if (button) openHoliday(button.dataset.holidayDate);
  });
  byId("holidayList")?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-holiday-delete]");
    if (deleteButton) {
      deleteHolidayByDate(deleteButton.dataset.holidayDelete);
      return;
    }
    const editButton = event.target.closest("[data-holiday-date]");
    if (editButton) openHoliday(editButton.dataset.holidayDate);
  });

  $$(".gestaoChooserToggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const chooser = button.closest(".gestaoChooser");
      $$(".gestaoChooser").forEach((item) => {
        if (item !== chooser) item.classList.remove("open");
      });
      chooser?.classList.toggle("open");
    });
  });

  byId("pageGestao")?.addEventListener("click", (event) => {
    const button = event.target.closest(".gestaoMenuItem");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    selectGestaoMenuItem(button);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".gestaoChooser")) {
      $$(".gestaoChooser").forEach((chooser) => chooser.classList.remove("open"));
    }
  });

  $$(".gestaoFilter[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      $$(".gestaoFilter[data-scope='users']").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      renderUsers();
    });
  });

  $$(".gestaoFilter[data-request-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentRequestFilter = button.dataset.requestFilter;
      $$(".gestaoFilter[data-scope='requests']").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      renderRequests();
    });
  });

  byId("searchInput")?.addEventListener("input", renderUsers);
  byId("requestSearchInput")?.addEventListener("input", renderRequests);
  byId("workDate")?.addEventListener("change", () => {
    updateWorkDateLabel();
    loadPointRecord();
  });
  byId("datePickerBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const input = byId("workDate");
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.focus();
  });
  $(".dateSide")?.addEventListener("click", () => {
    const input = byId("workDate");
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.focus();
  });
  byId("savePointBtn")?.addEventListener("click", savePointDraft);
  byId("pageRegistrar")?.addEventListener("click", (event) => {
    if (!event.target.closest(".pendingApprovalsLink")) return;
    event.preventDefault();
    openPendingApprovals();
  });
  byId("closeValidationPopover")?.addEventListener("click", closeValidationPopover);
  $$("#pageRegistrar .registroTab").forEach((button) => {
    button.addEventListener("click", () => showRegistroTab(button.dataset.registroTab || "diario"));
  });
  byId("monthlyCompetenciaSelect")?.addEventListener("change", (event) => {
    selectedMonthlyCompetencia = event.target.value;
    renderMonthlyHolidayList();
    loadMonthlyPointRecords(selectedMonthlyCompetencia);
  });
  byId("monthlyHolidayToggle")?.addEventListener("click", () => toggleMonthlyHolidayPanel());
  byId("monthlyHolidayClose")?.addEventListener("click", () => toggleMonthlyHolidayPanel(false));
  byId("registro-mensal")?.addEventListener("click", async (event) => {
    const button = event.target.closest(".monthlyEditBtn");
    if (!button) return;
    const row = button.closest("tr");
    if (!row) return;
    if (!row.classList.contains("monthlyEditing")) {
      monthlySetRowEditing(row, true);
      row.querySelector(".monthlyTimeInput:not(:disabled)")?.focus();
      return;
    }
    const saved = await saveMonthlyRow(row);
    if (saved) monthlySetRowEditing(row, false);
  });
  byId("registro-mensal")?.addEventListener("input", (event) => {
    const input = event.target.closest(".monthlyTimeInput");
    if (!input) return;
    input.value = formatTime(input.value);
    const row = input.closest("tr");
    monthlyUpdateRowState(row);
    updateMonthlyTotals();
  });
  byId("registro-mensal")?.addEventListener("blur", async (event) => {
    const input = event.target.closest(".monthlyTimeInput");
    if (!input) return;
    input.value = formatTime(input.value);
    const row = input.closest("tr");
    monthlyUpdateRowState(row);
    const data = monthlyRowData(row);
    if (monthlyValidationErrors(row.dataset.date, data, row).length === 0) {
      await saveMonthlyRow(row, { silent: true });
    }
  }, true);
  updateWorkDateLabel();
  updateDaySummary();

  byId("usersList")?.addEventListener("click", (event) => {
    const card = event.target.closest(".personCard");
    if (card) openUserEdit(card.dataset.id);
  });

  byId("requestsList")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-request-action]");
    if (action?.dataset.requestAction === "accept") acceptRequest(action.dataset.id);
    if (action?.dataset.requestAction === "reject") rejectRequest(action.dataset.id);
    if (action) return;
    const card = event.target.closest(".requestCard");
    if (card) openRequestEdit(card.dataset.id);
  });

}

function selectGestaoMenuItem(button) {
  const chooser = button.closest(".gestaoChooser");
  if (!chooser) return;
  if (button.classList.contains("adminOnly") && !isAdmin()) return;

  chooser.querySelectorAll(".gestaoMenuItem").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");

  const icon = chooser.querySelector("[data-choice-icon]");
  const label = chooser.querySelector("[data-choice-label]");
  if (icon) icon.textContent = button.dataset.icon || "";
  if (label) label.textContent = button.dataset.label || "";

  chooser.classList.remove("open");
  showGestaoView(button.dataset.gestaoView);
}

function showGestaoView(viewName) {
  $$("#pageGestao .gestaoView").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  if (["months", "holidays"].includes(viewName)) loadCalendarAdmin();
  if (viewName === "backup") renderBackupView();
}

function renderBackupView() {
  const box = $("#view-backup .backupBlank");
  if (!box) return;
  box.classList.add("backupWorkspace");
  box.innerHTML = `
    <section class="backupIntro"><span class="backupMainIcon">&#128190;</span><div><strong>Cópia do Firestore</strong><p>Usuários, registros de ponto, calendário e demais coleções do sistema.</p></div></section>
    <div class="backupActions">
      <button class="primary" type="button" data-backup-action="download">&#8681; Baixar backup agora</button>
      <button class="secondary" type="button" data-backup-action="restore" ${isAdmin() ? "" : "hidden"}>&#8679; Restaurar arquivo</button>
      <input id="backupRestoreFile" type="file" accept="application/json,.json" hidden>
    </div>
    <div class="backupStatus" id="backupStatus">Nenhuma operação iniciada.</div>
    <section class="backupStored"><div class="backupStoredHead"><strong>Backups automáticos</strong><button type="button" data-backup-action="refresh">Atualizar</button></div><div id="backupStoredList" class="backupStoredList"><span>Consultando configuração...</span></div></section>
    <div class="backupWarning"><b>Importante</b><br>O arquivo cobre o banco Firestore. Contas e senhas do Firebase Authentication exigem rotina própria do Firebase e não fazem parte deste JSON.</div>`;

  if (box.dataset.bound !== "1") {
    box.dataset.bound = "1";
    box.addEventListener("click", handleBackupAction);
    box.addEventListener("change", (event) => {
      if (event.target.id === "backupRestoreFile" && event.target.files?.[0]) restoreBackupFile(event.target.files[0]);
    });
  }
  loadStoredBackups();
}

async function backupRequest(path = "", options = {}) {
  if (!auth.currentUser) throw new Error("Faça login novamente para executar o backup.");
  const idToken = await auth.currentUser.getIdToken(true);
  return fetch(`/api/admin/backup${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
  });
}

async function handleBackupAction(event) {
  const button = event.target.closest("[data-backup-action]");
  if (!button) return;
  const action = button.dataset.backupAction;
  if (action === "download") await downloadBackupNow(button);
  if (action === "restore") byId("backupRestoreFile")?.click();
  if (action === "refresh") await loadStoredBackups();
  if (action === "stored-download") await downloadStoredBackup(button.dataset.backupKey, button);
}

function setBackupStatus(message, type = "") {
  const status = byId("backupStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `backupStatus ${type}`.trim();
}

async function downloadBackupNow(button) {
  if (USE_MOCK) {
    const backup = { format: "ponto-ppf-mock-backup", version: 1, createdAt: new Date().toISOString(), data: readMockDb() };
    downloadBackupBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), `ponto-ppf-mock-${localDateValue()}.json`);
    setBackupStatus("Backup local de teste baixado.", "success");
    return;
  }
  try {
    button.disabled = true;
    setBackupStatus("Gerando backup completo...", "working");
    const response = await backupRequest();
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Falha ao gerar backup.");
    const disposition = response.headers.get("Content-Disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `ponto-ppf-backup-${localDateValue()}.json`;
    downloadBackupBlob(await response.blob(), filename);
    setBackupStatus("Backup gerado e baixado com sucesso.", "success");
  } catch (error) {
    setBackupStatus(error.message || "Não foi possível gerar o backup.", "error");
  } finally {
    button.disabled = false;
  }
}

function downloadBackupBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreBackupFile(file) {
  const input = byId("backupRestoreFile");
  try {
    if (!isAdmin()) throw new Error("Somente administrador pode restaurar backups.");
    if (!window.confirm(`Restaurar ${file.name}? Os documentos do arquivo serão mesclados ao banco atual.`)) return;
    const text = await file.text();
    if (USE_MOCK) {
      const backup = JSON.parse(text);
      if (backup.format !== "ponto-ppf-mock-backup" || !backup.data) throw new Error("Backup local inválido.");
      writeMockDb(backup.data);
      setBackupStatus("Backup local restaurado. Atualize a página.", "success");
      return;
    }
    setBackupStatus("Restaurando documentos... Não feche esta tela.", "working");
    const response = await backupRequest("", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Falha ao restaurar backup.");
    setBackupStatus(`Restauração concluída: ${result.documents} documentos em ${result.collections} coleções.`, "success");
    await Promise.all([loadUsers(), loadCalendarAdmin()]);
  } catch (error) {
    setBackupStatus(error.message || "Não foi possível restaurar o backup.", "error");
  } finally {
    if (input) input.value = "";
  }
}

async function loadStoredBackups() {
  const list = byId("backupStoredList");
  if (!list) return;
  if (USE_MOCK) {
    list.innerHTML = `<span>R2 não é usado no modo de teste local.</span>`;
    return;
  }
  try {
    list.innerHTML = `<span>Consultando...</span>`;
    const response = await backupRequest("?list=1");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Falha ao consultar backups automáticos.");
    if (!result.configured) {
      list.innerHTML = `<span>Bucket R2 ainda não configurado.</span>`;
      return;
    }
    list.innerHTML = result.backups.length ? result.backups.slice(0, 10).map((item) => `
      <div class="backupStoredRow"><span><b>${escapeHtml(new Date(item.uploaded).toLocaleString("pt-BR"))}</b><small>${escapeHtml((item.size / 1024).toFixed(1))} KB</small></span><button type="button" data-backup-action="stored-download" data-backup-key="${escapeHtml(item.key)}">Baixar</button></div>`).join("")
      : `<span>Nenhum backup automático armazenado.</span>`;
  } catch (error) {
    list.innerHTML = `<span>${escapeHtml(error.message || "Falha ao consultar backups.")}</span>`;
  }
}

async function downloadStoredBackup(key, button) {
  try {
    button.disabled = true;
    const response = await backupRequest(`?key=${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Falha ao baixar backup.");
    downloadBackupBlob(await response.blob(), key.split("/").pop());
  } catch (error) {
    setBackupStatus(error.message || "Não foi possível baixar o backup armazenado.", "error");
  } finally {
    button.disabled = false;
  }
}

function showRegistroTab(tabName = "diario") {
  $$("#pageRegistrar .registroTab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.registroTab === tabName);
  });
  $$("#pageRegistrar .registroView").forEach((view) => {
    view.classList.toggle("active", view.id === `registro-${tabName}`);
  });
  syncPointPersonSelects();
  if (tabName === "mensal") {
    renderMonthlyRegisterControls();
    loadMonthlyPointRecords(selectedMonthlyCompetencia);
  } else {
    loadPointRecord();
  }
}

function bindModals() {
  $$("#userModal .close, #userModal .closeAny").forEach((button) => {
    button.addEventListener("click", () => closeModal("userModal"));
  });
  byId("saveUserBtn")?.addEventListener("click", saveUserEdit);
  byId("deleteUserBtn")?.addEventListener("click", deleteUserEdit);

  $$("#requestModal .close").forEach((button) => {
    button.addEventListener("click", () => closeModal("requestModal"));
  });
  byId("acceptRejectedRequestBtn")?.addEventListener("click", () => acceptRequest(editingRequestId));
  byId("deleteRequestBtn")?.addEventListener("click", deleteRequest);

  $$("#deleteConfirmModal .close, #deleteConfirmModal .closeAny").forEach((button) => {
    button.addEventListener("click", () => closeModal("deleteConfirmModal"));
  });
  byId("confirmDeleteBtn")?.addEventListener("click", () => {
    closeModal("deleteConfirmModal");
    byId("adminLogin").value = currentUser?.emailAuth || currentUser?.email || currentUser?.matricula || "admin";
    byId("adminPassword").value = "";
    byId("credentialModal").classList.add("show");
  });
  $$("#credentialModal .close, #credentialModal .closeAny").forEach((button) => {
    button.addEventListener("click", () => closeModal("credentialModal"));
  });
  byId("credentialConfirmBtn")?.addEventListener("click", confirmCredentialDelete);
  byId("closeRegisterSuccess")?.addEventListener("click", closeRegisterSuccess);

  $$("#monthModal .close, #monthModal .secondary").forEach((button) => {
    button.addEventListener("click", () => closeModal("monthModal"));
  });
  $("#monthModal .primary")?.addEventListener("click", saveCompetenciaModal);

  $$("#holidayModal .close, #holidayModal .secondary").forEach((button) => {
    button.addEventListener("click", () => closeModal("holidayModal"));
  });
  $("#holidayModal .primary")?.addEventListener("click", saveHolidayModal);
  byId("deleteHoliday")?.addEventListener("click", () => deleteHolidayByDate());
}

function bindProfile() {
  const tabs = $$(".profileTab");
  tabs[0]?.addEventListener("click", () => showProfileTab("dados"));
  tabs[1]?.addEventListener("click", () => showProfileTab("senha"));
  $("#profileDados .formActions .secondary")?.addEventListener("click", renderProfileEdit);
  $("#profileSenha .primary")?.addEventListener("click", changePassword);
}

function bindMasks() {
  const registerInputs = $$("#authRegister input");
  registerInputs[0]?.addEventListener("input", () => {
    const cursor = registerInputs[0].selectionStart;
    registerInputs[0].value = normalizeNameTyping(registerInputs[0].value);
    registerInputs[0].setSelectionRange(cursor, cursor);
  });
  attachMaskedInput(registerInputs[1], formatCpf);
  attachMaskedInput(byId("geccInput"), formatTime);
  ["entrada1View", "saida1View", "entrada2View", "saida2View"].forEach((id) => {
    attachMaskedInput(byId(id), formatTime);
  });
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

document.body.classList.add("firebase-app", "compact-ui");
enhanceDailyRegisterLayout();
enhanceMonthlyRegisterLayout();
bindAuthButtons();
bindNavigation();
bindModals();
bindProfile();
bindMasks();
bindTimeTracking();
showOnlyLogin();

if (USE_MOCK) {
  toast("Modo teste local ativo.");
} else {
  onAuthStateChanged(auth, async (authUser) => {
    if (!authUser) {
      currentUser = null;
      showOnlyLogin();
      return;
    }

    try {
      currentUser = await loadProfile(authUser);
      if (userAccessStatus(currentUser) !== "ativo") {
        await signOut(auth);
        showOnlyLogin();
        return;
      }
      showApp();
    } catch (error) {
      const request = await loadRequest(authUser).catch(() => null);
      if (request) toast(requestAccessMessage(request));
      else toast("Falha ao carregar perfil.");
      await signOut(auth);
    }
  });
}


