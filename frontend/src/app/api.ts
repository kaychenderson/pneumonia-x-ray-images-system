// Cliente da API do PneumoAI (Django + DRF + JWT).
// Configure a URL base em .env:  VITE_API_URL=http://localhost:8000/api

const BASE_URL: string = (
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL) ||
  "http://localhost:8000/api"
).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Tipos (espelham os serializers do back-end)
// ---------------------------------------------------------------------------
export type Role = "doctor" | "admin";
export type Projection = "unspecified" | "PA" | "AP" | "LATERAL";
export type AILabel = "NORMAL" | "PNEUMONIA";
export type AIStatus = "pending" | "completed" | "failed";
export type ReportStatus = "pending" | "draft" | "finalized";

export type Preferences = {
  notify_analysis_done: boolean;
  notify_pending_reports: boolean;
  weekly_summary: boolean;
};

export type ApiUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  registration: string;
  specialty: string;
  avatar_url: string | null;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  preferences?: Preferences;
};

export type UserSummary = { id: number; name: string; registration: string; specialty: string };

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type PatientSummary = { id: number; code: string; full_name: string; initials: string; birth_date: string; age: number };

export type Patient = PatientSummary & {
  phone: string;
  email: string;
  notes: string;
  exams_count: number;
  last_exam_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AIResult = {
  status: AIStatus;
  label: AILabel | null;
  probability_pneumonia: number | null;
  confidence: number | null;
  low_confidence: boolean;
  threshold: number | null;
  model_version: string | null;
  inference_ms: number | null;
  analyzed_at: string | null;
  error: string | null;
};

export type ReportBrief = { id: number; status: ReportStatus; status_display: string };

export type Exam = {
  id: number;
  code: string;
  patient: PatientSummary;
  physician: UserSummary;
  exam_date: string;
  projection: Projection;
  projection_display: string;
  ai: AIResult;
  report: ReportBrief | null;
  created_at: string;
  // somente no detalhe / criação
  notes?: string;
  image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
  image_size?: number;
  original_filename?: string;
};

export type ReportExam = {
  id: number;
  code: string;
  exam_date: string;
  projection: Projection;
  projection_display: string;
  patient: PatientSummary;
  physician: UserSummary;
  ai: AIResult;
};

export type ReportListItem = {
  id: number;
  exam: ReportExam;
  status: ReportStatus;
  status_display: string;
  finalized_at: string | null;
  updated_at: string;
};

export type Report = ReportListItem & {
  findings: string;
  conclusion: string;
  finalized_by: UserSummary | null;
  signature_name: string;
  signature_registration: string;
  can_edit: boolean;
  created_at: string;
};

export type HistoryItem = { at: string; action: string; label: string; user: { id: number; name: string } | null };

export type Dashboard = {
  generated_at: string;
  period_months: number;
  cards: {
    patients_total: number;
    patients_new_this_month: number;
    exams_total: number;
    exams_this_month: number;
    exams_growth_percent: number | null;
    awaiting_review: number;
    awaiting_review_priority: number;
    reports_finalized: number;
    reports_finalized_percent: number;
  };
  exams_by_month: { period: string; month: string; exams: number }[];
  ai_distribution: {
    total: number;
    normal: { count: number; percent: number };
    pneumonia: { count: number; percent: number };
  };
  recent_exams: Exam[];
};

export type SystemStatus = {
  platform_version: string;
  model: {
    configured: boolean;
    loaded: boolean;
    model_file: string;
    model_version: string | null;
    class_names: string[];
    threshold: number;
    input_size: number[];
  };
  analyze_on_create: boolean;
  limits: { max_xray_upload_mb: number; accepted_formats: string[] };
};

export type AdminSummary = {
  active_users: number;
  active_doctors: number;
  admins: number;
  accesses_today: number;
  failed_logins_today: number;
  audit_logs_30d: number;
};

export type AuditLog = {
  id: number;
  created_at: string;
  user: { id: number; name: string } | null;
  user_email: string;
  action: string;
  action_label: string;
  object_type: string;
  object_id: string;
  object_repr: string;
  ip_address: string | null;
  metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------
const FIELD_LABELS: Record<string, string> = {
  email: "E-mail",
  password: "Senha",
  new_password: "Nova senha",
  current_password: "Senha atual",
  name: "Nome",
  registration: "Registro profissional",
  specialty: "Especialidade",
  full_name: "Nome completo",
  birth_date: "Data de nascimento",
  code: "Identificação",
  phone: "Telefone",
  notes: "Observações",
  patient: "Paciente",
  exam_date: "Data do exame",
  projection: "Projeção",
  image: "Imagem",
  findings: "Achados",
  conclusion: "Impressão diagnóstica",
  reason: "Justificativa",
  role: "Perfil",
  avatar: "Foto",
  preferences: "Preferências",
};

export class ApiError extends Error {
  status: number;
  code?: string;
  data: unknown;

  constructor(status: number, data: unknown, fallback = "Não foi possível concluir a operação.") {
    super(extractMessage(data, status, fallback));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    if (data && typeof data === "object" && "code" in data) this.code = String((data as { code: unknown }).code);
  }

  /** Erros por campo (400 de validação): { campo: ["mensagem", ...] } */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object" && !Array.isArray(this.data)) {
      for (const [key, value] of Object.entries(this.data as Record<string, unknown>)) {
        if (key === "detail" || key === "code") continue;
        out[key] = flatten(value).join(" ");
      }
    }
    return out;
  }
}

function flatten(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flatten);
  return [String(value)];
}

function extractMessage(data: unknown, status: number, fallback: string): string {
  if (status === 0) return "Sem conexão com o servidor. Verifique a rede e a URL da API.";
  if (status === 429) return "Muitas tentativas. Aguarde um instante e tente novamente.";
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string" && record.detail) return record.detail;
    const parts = Object.entries(record)
      .filter(([key]) => key !== "code" && key !== "detail")
      .map(([key, value]) => {
        const msg = flatten(value).join(" ");
        return FIELD_LABELS[key] ? `${FIELD_LABELS[key]}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" • ");
  }
  if (Array.isArray(data)) {
    const msg = flatten(data).join(" ");
    if (msg) return msg;
  }
  if (status >= 500) return "Erro interno do servidor. Tente novamente em instantes.";
  return fallback;
}

// ---------------------------------------------------------------------------
// Sessão (tokens JWT)
// ---------------------------------------------------------------------------
type Tokens = { access: string; refresh: string };
const TOKEN_KEY = "pneumoai.tokens";

function readTokens(): Tokens | null {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(TOKEN_KEY);
      if (raw) return JSON.parse(raw) as Tokens;
    } catch {
      /* armazenamento indisponível ou JSON inválido */
    }
  }
  return null;
}

function writeTokens(tokens: Tokens, remember?: boolean) {
  // Mantém no mesmo armazenamento em que a sessão já estava (renovação de token).
  let persistent = remember;
  if (persistent === undefined) {
    try {
      persistent = localStorage.getItem(TOKEN_KEY) !== null;
    } catch {
      persistent = false;
    }
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    (persistent ? localStorage : sessionStorage).setItem(TOKEN_KEY, JSON.stringify(tokens));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export const hasSession = () => readTokens() !== null;

let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

let refreshing: Promise<boolean> | null = null;
function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  const tokens = readTokens();
  if (!tokens?.refresh) return Promise.resolve(false);
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: tokens.refresh }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as Partial<Tokens>;
      if (!data.access) return false;
      // ROTATE_REFRESH_TOKENS=True: a resposta traz um novo refresh, que substitui o anterior.
      writeTokens({ access: data.access, refresh: data.refresh ?? tokens.refresh });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------------------------------------------------------------------
// Camada HTTP
// ---------------------------------------------------------------------------
type Query = Record<string, string | number | boolean | null | undefined>;
type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  json?: unknown;
  form?: FormData;
  auth?: boolean;
};

function buildUrl(path: string, query?: Query) {
  const url = /^https?:\/\//i.test(path) ? new URL(path) : new URL(`${BASE_URL}/${path.replace(/^\/+/, "")}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function send(path: string, options: Options, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  const auth = options.auth !== false;
  if (auth) {
    const tokens = readTokens();
    if (tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  }
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form; // o navegador define o Content-Type (multipart) com o boundary
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), { method: options.method ?? "GET", headers, body });
  } catch {
    throw new ApiError(0, null);
  }
  if (res.status === 401 && auth && !retried) {
    if (await refreshTokens()) return send(path, options, true);
    clearSession();
    onSessionExpired?.();
  }
  return res;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const res = await send(path, options);
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

async function requestBlob(path: string, query?: Query): Promise<Blob> {
  const res = await send(path, { query });
  if (!res.ok) throw new ApiError(res.status, await parse(res));
  return res.blob();
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
type LoginResponse = { access: string; refresh: string; user: ApiUser };
type RegisterResponse =
  | { requires_approval: true; detail: string }
  | { requires_approval: false; detail: string; access: string; refresh: string; user: ApiUser };

export const api = {
  baseUrl: BASE_URL,

  auth: {
    async login(email: string, password: string, remember: boolean) {
      const data = await request<LoginResponse>("auth/login/", { method: "POST", auth: false, json: { email, password } });
      writeTokens({ access: data.access, refresh: data.refresh }, remember);
      return data.user;
    },
    async register(body: { name: string; email: string; password: string; registration: string; specialty: string }) {
      const data = await request<RegisterResponse>("auth/register/", { method: "POST", auth: false, json: body });
      if (!data.requires_approval) writeTokens({ access: data.access, refresh: data.refresh }, false);
      return data;
    },
    async logout() {
      const tokens = readTokens();
      clearSession();
      if (tokens?.refresh) {
        try {
          await fetch(`${BASE_URL}/auth/logout/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: tokens.refresh }),
          });
        } catch {
          /* o refresh expira sozinho */
        }
      }
    },
    forgot: (email: string) => request<{ detail: string }>("auth/password/forgot/", { method: "POST", auth: false, json: { email } }),
    reset: (uid: string, token: string, new_password: string) =>
      request<{ detail: string }>("auth/password/reset/", { method: "POST", auth: false, json: { uid, token, new_password } }),
    changePassword: (current_password: string, new_password: string) =>
      request<{ detail: string }>("auth/password/change/", {
        method: "POST",
        json: { current_password, new_password, refresh: readTokens()?.refresh },
      }),
    me: () => request<ApiUser>("auth/me/"),
    updateMe: (body: Partial<Pick<ApiUser, "name" | "email" | "registration" | "specialty" | "preferences">>) =>
      request<ApiUser>("auth/me/", { method: "PATCH", json: body }),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return request<ApiUser>("auth/me/", { method: "PATCH", form });
    },
    removeAvatar: () => request<void>("auth/me/avatar/", { method: "DELETE" }),
  },

  dashboard: (months = 12) => request<Dashboard>("dashboard/", { query: { months } }),
  system: () => request<SystemStatus>("system/status/"),

  patients: {
    list: (query: Query) => request<Page<Patient>>("patients/", { query }),
    create: (body: { full_name: string; birth_date: string; code?: string; phone?: string; email?: string; notes?: string }) =>
      request<Patient>("patients/", { method: "POST", json: body }),
    update: (id: number, body: Partial<{ full_name: string; birth_date: string; code: string; phone: string; email: string; notes: string }>) =>
      request<Patient>(`patients/${id}/`, { method: "PATCH", json: body }),
    exams: (id: number, query?: Query) => request<Page<Exam>>(`patients/${id}/exams/`, { query }),
  },

  exams: {
    list: (query: Query) => request<Page<Exam>>("exams/", { query }),
    get: (id: number) => request<Exam>(`exams/${id}/`),
    create: (form: FormData) => request<Exam>("exams/", { method: "POST", form }),
    analyze: (id: number) => request<Exam>(`exams/${id}/analyze/`, { method: "POST" }),
  },

  reports: {
    list: (query: Query) => request<Page<ReportListItem>>("reports/", { query }),
    get: (id: number) => request<Report>(`reports/${id}/`),
    saveDraft: (id: number, body: { findings: string; conclusion: string }) =>
      request<Report>(`reports/${id}/`, { method: "PATCH", json: body }),
    finalize: (id: number, body: { findings: string; conclusion: string }) =>
      request<Report>(`reports/${id}/finalize/`, { method: "POST", json: body }),
    reopen: (id: number, reason: string) => request<Report>(`reports/${id}/reopen/`, { method: "POST", json: { reason } }),
    history: (id: number) => request<HistoryItem[]>(`reports/${id}/history/`),
    pdf: (id: number, download = false) => requestBlob(`reports/${id}/pdf/`, download ? { download: 1 } : undefined),
  },

  admin: {
    summary: () => request<AdminSummary>("admin/summary/"),
    users: (query: Query) => request<Page<ApiUser>>("users/", { query }),
    updateUser: (id: number, body: Partial<Pick<ApiUser, "role" | "is_active" | "name" | "registration" | "specialty">>) =>
      request<ApiUser>(`users/${id}/`, { method: "PATCH", json: body }),
    invite: (body: { email: string; role: Role; name?: string }) =>
      request<{ user: ApiUser; email_sent: boolean }>("users/invite/", { method: "POST", json: body }),
    auditLogs: (query: Query) => request<Page<AuditLog>>("audit-logs/", { query }),
  },

  /** Imagens exigem o header Authorization: baixe como Blob e use URL.createObjectURL(). */
  blob: (urlOrPath: string) => requestBlob(urlOrPath),
};
