import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ElementType, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  ChevronDown,
  ChevronRight,
  Download,
  FileCheck2,
  FileClock,
  FileText,
  HelpCircle,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  SlidersHorizontal,
  Stethoscope,
  UploadCloud,
  UserRound,
  UserPlus,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Toaster, toast } from "sonner";
import {
  api,
  ApiError,
  clearSession,
  hasSession,
  setSessionExpiredHandler,
  type AdminSummary,
  type AIResult,
  type ApiUser,
  type AuditLog,
  type Dashboard as DashboardData,
  type Exam,
  type Page,
  type Patient,
  type Preferences,
  type Projection,
  type Report,
  type ReportListItem,
  type ReportStatus,
  type Role,
  type SystemStatus,
} from "./api";

type View = "dashboard" | "patients" | "exams" | "analysis" | "reports" | "admin" | "settings";
type AuthMode = "login" | "register" | "forgot";

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const pad = (n: number) => String(n).padStart(2, "0");
const initialsOf = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const fmtWhen = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const dayKey = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return `Hoje, ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `Ontem, ${time}`;
  const day = d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
  return d.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day} ${d.getFullYear()}, ${time}`;
};
const pctFraction = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtConfidence = (v?: number | null) => (v == null ? "—" : pctFraction.format(v));
const fmtPercent = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const fmtInt = (v: number) => v.toLocaleString("pt-BR");

/** Máscara progressiva de telefone BR: (84)98123-6789 ou (84)3123-4567. */
const maskPhone = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)})${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)})${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)})${d.slice(2, 7)}-${d.slice(7)}`;
};

const labelCls = "text-[10px] font-semibold text-slate-600";
const inputCls = "mt-1.5 h-10 w-full border border-border px-3 text-[12px] outline-none focus:border-blue-500";
const authInputCls = "mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function useDebounced<T>(value: T, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Carrega dados da API e ignora respostas atrasadas (corrida entre requisições). */
function useApi<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loaderRef
      .current()
      .then((data) => {
        if (id === seq.current) setState({ data, loading: false, error: null });
      })
      .catch((e) => {
        if (id === seq.current) setState((s) => ({ data: s.data, loading: false, error: errMsg(e) }));
      });
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T | null) => setState((s) => ({ ...s, data })), []);
  return { ...state, reload, setData };
}

/** Imagens da API exigem o header Authorization: baixa como Blob e devolve um object URL. */
function useBlobUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let alive = true;
    let created: string | null = null;
    setFailed(false);
    api
      .blob(path)
      .then((blob) => {
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [path]);
  return { url, failed };
}

// ---------------------------------------------------------------------------
// Componentes de base
// ---------------------------------------------------------------------------
function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "orange" | "red" | "blue" }) {
  const styles = {
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    orange: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.05em] ${styles[tone]}`}>{children}</span>;
}

function Spinner({ light = true }: { light?: boolean }) {
  return <span className={`h-4 w-4 animate-spin rounded-full border-2 ${light ? "border-white/30 border-t-white" : "border-slate-300 border-t-blue-600"}`} />;
}

function Loading({ text = "Carregando..." }: { text?: string }) {
  return <div className="flex items-center justify-center gap-2 p-8 text-[11px] text-slate-500"><Spinner light={false} /> {text}</div>;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex items-start gap-3 border border-red-200 bg-red-50 p-4 text-[11px] text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="font-semibold underline">Tentar novamente</button>}
    </div>
  );
}

function FieldError({ errors, name }: { errors: Record<string, string>; name: string }) {
  return errors[name] ? <span className="mt-1 block text-[10px] font-normal text-red-600">{errors[name]}</span> : null;
}

function StatCard({ label, value, meta, icon: Icon, tone }: { label: string; value: string; meta: string; icon: ElementType; tone: string }) {
  return (
    <div className="group rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_rgba(15,23,42,0.045)] transition duration-300 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex items-start justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17} strokeWidth={1.8} /></div>
        <MoreHorizontal size={17} className="text-slate-300" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[28px] font-semibold leading-none text-slate-900">{value}</span>
        <span className="text-[11px] text-slate-500">{meta}</span>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, icon: Icon = LogOut, tone = "danger", busy = false, disabled = false, children }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; icon?: ElementType; tone?: "danger" | "primary"; busy?: boolean; disabled?: boolean; children?: ReactNode }) {
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-2xl">
        <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${danger ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}><Icon size={18} /></div>
        <h2 className="font-display text-xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{message}</p>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="border border-border px-4 py-2 text-[11px] text-slate-700">Cancelar</button>
          <button onClick={onConfirm} disabled={busy || disabled} className={`flex items-center gap-2 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{busy && <Spinner />}{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`max-h-[92vh] w-full overflow-y-auto bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-xl"}`}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div><h2 className="font-display text-lg font-semibold text-slate-900">{title}</h2>{subtitle && <p className="text-[10px] text-slate-500">{subtitle}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Pager({ page, count, onPage }: { page: number; count: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(count, page * PAGE_SIZE);
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-slate-500">
      <span>Exibindo {from}–{to} de {fmtInt(count)}</span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="border border-border px-2 py-1 disabled:opacity-40">Anterior</button>
        {numbers.map((n) => <button key={n} onClick={() => onPage(n)} className={`${page === n ? "bg-[#142D4E] text-white" : "border border-border"} px-2.5 py-1`}>{n}</button>)}
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="border border-border px-2 py-1 disabled:opacity-40">Próxima</button>
      </div>
    </div>
  );
}

function Avatar({ user, className }: { user: Pick<ApiUser, "name" | "avatar_url">; className: string }) {
  const { url } = useBlobUrl(user.avatar_url);
  return url
    ? <img src={url} alt={`Foto de ${user.name}`} className={`${className} object-cover`} />
    : <span className={`${className} flex items-center justify-center bg-[#142D4E] font-bold text-white`}>{initialsOf(user.name)}</span>;
}

function AuthImage({ path, alt, className, style }: { path?: string | null; alt: string; className?: string; style?: CSSProperties }) {
  const { url, failed } = useBlobUrl(path);
  if (failed) return <span className="p-4 text-[10px] text-slate-400">Imagem indisponível.</span>;
  if (!url) return <Spinner light={false} />;
  return <img src={url} alt={alt} className={className} style={style} />;
}

const reportTone = (s: ReportStatus) => (s === "finalized" ? "bg-emerald-500" : s === "draft" ? "bg-blue-500" : "bg-amber-500");
const reportLabel: Record<ReportStatus, string> = { pending: "Aguardando revisão", draft: "Em elaboração", finalized: "Finalizado" };

function ResultBadge({ ai }: { ai: AIResult }) {
  if (ai.status === "completed" && ai.label) return <Badge tone={ai.label === "NORMAL" ? "green" : "red"}>{ai.label} · {fmtConfidence(ai.confidence)}</Badge>;
  if (ai.status === "failed") return <Badge tone="orange">FALHA NA IA</Badge>;
  return <Badge>PENDENTE</Badge>;
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
function AuthLayout({ eyebrow, title, subtitle, children, footer }: { eyebrow: string; title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d2239] p-4 sm:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1180px] overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-[0_32px_100px_rgba(2,12,27,0.42)] lg:grid-cols-[0.92fr_1.08fr]">
        <section className="relative hidden overflow-hidden bg-[#102844] p-12 text-white lg:flex lg:flex-col">
          <div className="absolute right-[-110px] top-[-80px] h-80 w-80 rounded-full border border-blue-400/20" />
          <div className="absolute right-[-50px] top-[-20px] h-52 w-52 rounded-full border border-blue-400/20" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-950/20"><Stethoscope size={22} /></span>
            <div><strong className="font-display text-xl">Pneumo<span className="text-blue-400">AI</span></strong><span className="block text-[9px] uppercase tracking-[0.2em] text-slate-400">Clinical intelligence</span></div>
          </div>
          <div className="relative my-auto max-w-md">
            <span className="mb-5 inline-flex rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-blue-300">Apoio à decisão clínica</span>
            <h1 className="font-display text-4xl font-semibold leading-[1.12] tracking-[-0.03em]">Precisão operacional para análises radiográficas.</h1>
            <p className="mt-5 text-[13px] leading-6 text-slate-400">Gestão segura de pacientes, exames e laudos com rastreabilidade integral e classificação assistida por CNN.</p>
            <div className="mt-10 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><ShieldCheck className="mb-3 text-emerald-400" size={19} /><strong className="block text-xs">Dados protegidos</strong><span className="text-[9px] text-slate-500">Controle de acesso e auditoria</span></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><Activity className="mb-3 text-blue-400" size={19} /><strong className="block text-xs">Fluxo rastreável</strong><span className="text-[9px] text-slate-500">Da imagem à conclusão médica</span></div>
            </div>
          </div>
          <p className="relative text-[9px] text-slate-500">Ferramenta de apoio • A decisão clínica é do médico • LGPD</p>
        </section>
        <section className="flex items-center justify-center bg-[#f8fafc] p-6 sm:p-12">
          <div className="w-full max-w-[410px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="flex h-10 w-10 items-center justify-center bg-blue-600 text-white"><Stethoscope size={20} /></span><strong className="font-display text-xl text-slate-900">PneumoAI</strong></div>
            <div className="mb-7">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
              <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
              <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
            </div>
            {children}
            {footer && <div className="mt-6 border-t border-slate-200 pt-5 text-center text-[10px] text-slate-500">{footer}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function AuthScreen({ onAuthenticate }: { onAuthenticate: (user: ApiUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", registration: "", specialty: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const enter = async (user: ApiUser) => {
    // O login não devolve as preferências: busca o perfil completo.
    const full = await api.auth.me().catch(() => user);
    onAuthenticate(full);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      if (mode === "forgot") {
        const res = await api.auth.forgot(form.email.trim());
        toast.success(res.detail);
        setMode("login");
      } else if (mode === "register") {
        const res = await api.auth.register({ name: form.name.trim(), email: form.email.trim(), password: form.password, registration: form.registration.trim(), specialty: form.specialty.trim() });
        if (res.requires_approval) {
          toast.success(res.detail);
          setForm((f) => ({ ...f, password: "" }));
          setMode("login");
        } else {
          toast.success("Conta profissional criada.");
          await enter(res.user);
        }
      } else {
        const user = await api.auth.login(form.email.trim(), form.password, remember);
        toast.success("Acesso autorizado.");
        await enter(user);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setErrors(e.fieldErrors());
      if (e instanceof ApiError && e.status === 401) toast.error(e.code === "inactive_account" ? e.message : "E-mail ou senha incorretos.");
      else toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const eyebrow = mode === "register" ? "Credenciamento" : mode === "forgot" ? "Segurança da conta" : "Acesso profissional";
  const title = mode === "register" ? "Crie sua conta médica" : mode === "forgot" ? "Recuperar acesso" : "Bem-vindo à plataforma";
  const subtitle = mode === "forgot" ? "Enviaremos instruções para seu e-mail profissional." : "Use suas credenciais institucionais para continuar.";
  const footer = mode === "register"
    ? <>Já possui cadastro? <button onClick={() => setMode("login")} className="font-semibold text-blue-600">Acessar conta</button></>
    : mode === "forgot"
      ? <button onClick={() => setMode("login")} className="font-semibold text-blue-600">Voltar ao login</button>
      : <>Primeiro acesso? <button onClick={() => setMode("register")} className="font-semibold text-blue-600">Solicitar cadastro médico</button></>;

  return (
    <AuthLayout eyebrow={eyebrow} title={title} subtitle={subtitle} footer={footer}>
      <form onSubmit={submit} className="space-y-4">
        {mode === "register" && <>
          <label className="block text-[10px] font-semibold text-slate-700">Nome completo<input required value={form.name} onChange={set("name")} placeholder="Nome do profissional" className={authInputCls} /><FieldError errors={errors} name="name" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] font-semibold text-slate-700">Registro profissional<input required value={form.registration} onChange={set("registration")} placeholder="CRM 000000" className={authInputCls} /><FieldError errors={errors} name="registration" /></label>
            <label className="text-[10px] font-semibold text-slate-700">Especialidade<input required value={form.specialty} onChange={set("specialty")} placeholder="Pneumologia" className={authInputCls} /><FieldError errors={errors} name="specialty" /></label>
          </div>
        </>}
        <label className="block text-[10px] font-semibold text-slate-700">E-mail profissional
          <div className="relative mt-1.5"><Mail size={15} className="absolute left-3 top-3.5 text-slate-400" /><input required type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="nome@instituicao.com.br" className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></div>
          <FieldError errors={errors} name="email" />
        </label>
        {mode !== "forgot" && <label className="block text-[10px] font-semibold text-slate-700">Senha
          <div className="relative mt-1.5"><LockKeyhole size={15} className="absolute left-3 top-3.5 text-slate-400" /><input required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} type={showPassword ? "text" : "password"} value={form.password} onChange={set("password")} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-9 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-[10px] font-semibold text-blue-600">{showPassword ? "Ocultar" : "Exibir"}</button></div>
          {mode === "register" && <span className="mt-1 block text-[9px] font-normal text-slate-400">Mínimo de 8 caracteres, sem ser apenas números nem uma senha comum.</span>}
          <FieldError errors={errors} name="password" />
        </label>}
        {mode === "login" && <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-[10px] text-slate-600"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-blue-600" /> Manter sessão</label><button type="button" onClick={() => setMode("forgot")} className="text-[10px] font-semibold text-blue-600 hover:underline">Esqueci minha senha</button></div>}
        <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[11px] font-bold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60">{loading ? <Spinner /> : mode === "forgot" ? "ENVIAR INSTRUÇÕES" : mode === "register" ? "CRIAR CONTA PROFISSIONAL" : "ENTRAR COM SEGURANÇA"}</button>
      </form>
    </AuthLayout>
  );
}

/** Tela aberta pelo link do e-mail (/reset-password?uid=...&token=...[&invite=1]). */
function ResetPasswordScreen({ uid, token, invite, onDone }: { uid: string; token: string; invite: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirm) return toast.error("As senhas não coincidem.");
    setLoading(true);
    try {
      await api.auth.reset(uid, token, password);
      toast.success(invite ? "Senha definida. Você já pode entrar." : "Senha redefinida. Você já pode entrar.");
      window.history.replaceState(null, "", "/");
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout eyebrow="Segurança da conta" title={invite ? "Defina sua senha" : "Criar nova senha"} subtitle="Escolha uma senha forte com ao menos 8 caracteres." footer={<button onClick={() => { window.history.replaceState(null, "", "/"); onDone(); }} className="font-semibold text-blue-600">Voltar ao login</button>}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-[10px] font-semibold text-slate-700">Nova senha<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputCls} /></label>
        <label className="block text-[10px] font-semibold text-slate-700">Confirmar nova senha<input required minLength={8} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInputCls} /></label>
        <button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-60">{loading ? <Spinner /> : "SALVAR NOVA SENHA"}</button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Estrutura (cabeçalho e menu)
// ---------------------------------------------------------------------------
type ServiceState = { tone: "green" | "amber" | "red" | "slate"; label: string };

function Header({ title, subtitle, onMenu, user, dark, onTheme, onProfile, service, pending, onPending }: { title: string; subtitle: string; onMenu: () => void; user: ApiUser; dark: boolean; onTheme: () => void; onProfile: () => void; service: ServiceState; pending: number; onPending: () => void }) {
  const serviceCls = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  }[service.tone];
  const dotCls = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", slate: "bg-slate-400" }[service.tone];
  return (
    <header className="flex h-[74px] shrink-0 items-center justify-between border-b border-border bg-white px-5 lg:px-7">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="text-slate-600 lg:hidden"><Menu size={22} /></button>
        <div>
          <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">{title}</h1>
          <p className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`mr-2 hidden items-center gap-2 border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.06em] md:flex ${serviceCls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} /> {service.label}
        </div>
        <button onClick={onTheme} title={dark ? "Usar tema claro" : "Usar tema escuro"} className="flex h-9 w-9 items-center justify-center border border-border text-slate-600 hover:bg-slate-50">
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button onClick={onPending} title="Laudos pendentes" className="relative flex h-9 w-9 items-center justify-center border border-border text-slate-600 hover:bg-slate-50">
          <Bell size={17} />{pending > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full border border-white bg-blue-600" />}
        </button>
        <button onClick={onProfile} className="hidden h-9 items-center gap-2 border border-border px-2.5 text-left hover:bg-slate-50 sm:flex">
          <Avatar user={user} className="h-6 w-6 text-[9px]" />
          <span><span className="block text-[11px] font-semibold text-slate-800">{user.role === "doctor" ? "Dr(a). " : ""}{user.name}</span><span className="block text-[9px] text-slate-500">{user.registration || "Sem registro"} • {user.role === "admin" ? "Administrador" : "Médico"}</span></span>
          <ChevronDown size={13} className="text-slate-400" />
        </button>
      </div>
    </header>
  );
}

function Sidebar({ view, setView, open, setOpen, user, pending, onLogout }: { view: View; setView: (v: View) => void; open: boolean; setOpen: (v: boolean) => void; user: ApiUser; pending: number; onLogout: () => void }) {
  const navItems: { id: View; label: string; icon: ElementType; count?: number }[] = [
    { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
    { id: "patients", label: "Pacientes", icon: Users },
    { id: "exams", label: "Exames", icon: ScanLine },
    { id: "analysis", label: "Nova análise", icon: Activity },
    { id: "reports", label: "Laudos", icon: FileText, count: pending },
  ];
  return (
    <>
      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-[#102844] text-white transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[74px] items-center justify-between border-b border-white/10 px-5">
          <button onClick={() => setView("dashboard")} className="flex items-center gap-3 text-left">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-950/30"><Stethoscope size={19} /><span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#102844] bg-emerald-400" /></span>
            <span><span className="font-display block text-[17px] font-semibold tracking-[-0.02em]">Pneumo<span className="text-blue-400">AI</span></span><span className="block text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">Clinical intelligence</span></span>
          </button>
          <button onClick={() => setOpen(false)} className="lg:hidden"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Área clínica</p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button key={item.id} onClick={() => { setView(item.id); setOpen(false); }} className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-medium transition ${active ? "bg-white/10 text-white shadow-inner" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
                  {active && <span className="absolute -left-3 h-6 w-0.5 bg-blue-400" />}
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.7} /><span className="flex-1 text-left">{item.label}</span>
                  {!!item.count && <span className="bg-white/10 px-1.5 py-0.5 text-[9px] text-slate-300">{item.count}</span>}
                </button>
              );
            })}
          </nav>
          {user.role === "admin" && <><p className="mb-2 mt-7 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Administração</p><button onClick={() => { setView("admin"); setOpen(false); }} className={`flex w-full items-center gap-3 px-3 py-2.5 text-[12px] ${view === "admin" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}><ShieldCheck size={17} /> Usuários e auditoria</button></>}
          <p className="mb-2 mt-7 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Sistema</p>
          <nav className="space-y-1">
            <button onClick={() => { setView("settings"); setOpen(false); }} className={`flex w-full items-center gap-3 px-3 py-2.5 text-[12px] ${view === "settings" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}><Settings size={17} /> Configurações</button>
            <button onClick={() => toast.info("Central de suporte", { description: "suporte@pneumoai.com.br • Atendimento das 8h às 18h" })} className="flex w-full items-center gap-3 px-3 py-2.5 text-[12px] text-slate-400 hover:text-white"><HelpCircle size={17} /> Suporte e ajuda</button>
          </nav>
        </div>
        <div className="m-3 border border-white/10 bg-white/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-400" /><span className="text-[10px] font-semibold">Ambiente protegido</span></div>
          <p className="text-[9px] leading-relaxed text-slate-500">Sessão segura • LGPD<br />Último acesso: {fmtWhen(user.last_login).toLowerCase()}</p>
        </div>
        <button onClick={onLogout} className="flex items-center gap-3 border-t border-white/10 px-6 py-4 text-[11px] text-slate-400 hover:text-white"><LogOut size={15} /> Encerrar sessão</button>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tabela de exames (painel e tela de exames)
// ---------------------------------------------------------------------------
function ExamsTable({ exams, onOpen, emptyText = "Nenhum exame encontrado." }: { exams: Exam[]; onOpen: (exam: Exam) => void; emptyText?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead className="bg-slate-50/80 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-5 py-2.5">Paciente / exame</th><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Resultado IA</th><th className="px-3 py-2.5">Médico responsável</th><th className="px-3 py-2.5">Situação do laudo</th><th /></tr></thead>
        <tbody className="divide-y divide-border">
          {exams.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[11px] text-slate-400">{emptyText}</td></tr>}
          {exams.map((exam) => {
            const status = exam.report?.status ?? "pending";
            return (
              <tr key={exam.id} onClick={() => onOpen(exam)} className="group cursor-pointer hover:bg-slate-50/60">
                <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center bg-slate-100 text-[9px] font-bold text-slate-600">{exam.patient.initials}</span><span><span className="block text-[11px] font-semibold text-slate-800">{exam.patient.full_name}</span><span className="font-mono text-[9px] text-slate-400">{exam.code}</span></span></div></td>
                <td className="px-3 py-3 text-[10px] text-slate-600">{fmtWhen(exam.created_at)}</td>
                <td className="px-3 py-3"><ResultBadge ai={exam.ai} /></td>
                <td className="px-3 py-3 text-[10px] text-slate-600">{exam.physician.name}</td>
                <td className="px-3 py-3"><span className="flex items-center gap-1.5 text-[10px] text-slate-600"><span className={`h-1.5 w-1.5 rounded-full ${reportTone(status)}`} />{reportLabel[status]}</span></td>
                <td className="px-4"><span className="text-slate-400 group-hover:text-blue-600"><ChevronRight size={15} /></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------
function Dashboard({ setView, onOpenExam, version }: { setView: (v: View) => void; onOpenExam: (id: number) => void; version: number }) {
  const { data, loading, error, reload } = useApi<DashboardData>(() => api.dashboard(12), [version]);
  const c = data?.cards;
  const dist = data?.ai_distribution;
  const pieData = dist && dist.total > 0
    ? [{ name: "Normal", value: dist.normal.count }, { name: "Pneumonia", value: dist.pneumonia.count }]
    : [{ name: "Sem dados", value: 1 }];
  const pieColors = dist && dist.total > 0 ? ["#2D7D73", "#E4794B"] : ["#E2E8F0"];
  const growth = c?.exams_growth_percent;
  return (
    <div className="p-5 lg:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[12px] text-slate-500">Acompanhamento da operação clínica em tempo real.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setView("patients")} className="flex h-9 items-center gap-2 border border-border bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"><UserRound size={15} /> Novo paciente</button>
          <button onClick={() => setView("analysis")} className="flex h-9 items-center gap-2 bg-blue-600 px-3.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"><Plus size={15} /> Novo exame</button>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && c && dist && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Pacientes cadastrados" value={fmtInt(c.patients_total)} meta={`+${fmtInt(c.patients_new_this_month)} este mês`} icon={Users} tone="bg-blue-50 text-blue-700" />
          <StatCard label="Exames realizados" value={fmtInt(c.exams_total)} meta={growth == null ? `${fmtInt(c.exams_this_month)} este mês` : `${growth > 0 ? "+" : ""}${growth.toLocaleString("pt-BR")}% vs. mês anterior`} icon={ScanLine} tone="bg-slate-100 text-slate-700" />
          <StatCard label="Aguardando revisão" value={pad(c.awaiting_review)} meta={`${c.awaiting_review_priority} prioritários`} icon={FileClock} tone="bg-amber-50 text-amber-700" />
          <StatCard label="Laudos finalizados" value={fmtInt(c.reports_finalized)} meta={`${fmtPercent(c.reports_finalized_percent)} do total`} icon={FileCheck2} tone="bg-emerald-50 text-emerald-700" />
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[1.65fr_0.85fr]">
          <section className="border border-border bg-white p-5">
            <div className="mb-4 flex items-start justify-between">
              <div><h2 className="font-display text-[16px] font-semibold text-slate-900">Volume de exames</h2><p className="text-[10px] text-slate-500">Exames registrados nos últimos {data.period_months} meses</p></div>
            </div>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.exams_by_month} margin={{ left: -24, right: 4, top: 10, bottom: 0 }}>
                  <defs><linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563EB" stopOpacity={0.18} /><stop offset="100%" stopColor="#2563EB" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#E8EDF3" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#7C8A9D", fontSize: 9 }} dy={8} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#7C8A9D", fontSize: 9 }} />
                  <Tooltip cursor={{ stroke: "#94A3B8", strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 0, border: "1px solid #E2E8F0", fontSize: 11 }} />
                  <Area type="monotone" dataKey="exams" name="Exames" stroke="#2563EB" strokeWidth={2} fill="url(#areaBlue)" dot={false} activeDot={{ r: 4, fill: "#2563EB", stroke: "#fff", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="border border-border bg-white p-5">
            <div><h2 className="font-display text-[16px] font-semibold text-slate-900">Classificações da IA</h2><p className="text-[10px] text-slate-500">Distribuição nos últimos {data.period_months} meses</p></div>
            <div className="relative mx-auto h-[150px] max-w-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={pieData} innerRadius={47} outerRadius={64} paddingAngle={dist.total > 0 ? 3 : 0} dataKey="value" stroke="none">{pieColors.map((color) => <Cell key={color} fill={color} />)}</Pie></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-2xl font-semibold text-slate-900">{fmtInt(dist.total)}</span><span className="text-[8px] uppercase tracking-[0.12em] text-slate-500">análises</span></div>
            </div>
            <div className="grid grid-cols-2 border-t border-border pt-3">
              <div className="border-r border-border pr-3"><div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="h-2 w-2 bg-[#2D7D73]" /> Normal</div><p className="mt-1 text-lg font-semibold text-slate-800">{fmtPercent(dist.normal.percent)} <span className="text-[9px] font-normal text-slate-400">{fmtInt(dist.normal.count)}</span></p></div>
              <div className="pl-3"><div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="h-2 w-2 bg-[#E4794B]" /> Pneumonia</div><p className="mt-1 text-lg font-semibold text-slate-800">{fmtPercent(dist.pneumonia.percent)} <span className="text-[9px] font-normal text-slate-400">{fmtInt(dist.pneumonia.count)}</span></p></div>
            </div>
          </section>
        </div>
        <section className="mt-3 border border-border bg-white">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div><h2 className="font-display text-[16px] font-semibold text-slate-900">Atividade recente</h2><p className="text-[10px] text-slate-500">Últimos exames registrados na plataforma</p></div>
            <button onClick={() => setView("exams")} className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline">Ver todos <ChevronRight size={13} /></button>
          </div>
          <ExamsTable exams={data.recent_exams} onOpen={(e) => onOpenExam(e.id)} emptyText="Nenhum exame registrado ainda." />
        </section>
      </>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------
function PatientModal({ onClose, onCreated, patient }: { onClose: () => void; onCreated: (p: Patient) => void; patient?: Patient }) {
  const editing = !!patient;
  const [form, setForm] = useState({ full_name: patient?.full_name ?? "", birth_date: patient?.birth_date ?? "", code: patient?.code ?? "", phone: patient?.phone ?? "", email: patient?.email ?? "", notes: patient?.notes ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = {
        full_name: form.full_name.trim(),
        birth_date: form.birth_date,
        code: form.code.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim(),
        notes: form.notes.trim(),
      };
      const saved = patient ? await api.patients.update(patient.id, body) : await api.patients.create(body);
      toast.success(patient ? "Dados do paciente atualizados." : "Paciente cadastrado com sucesso.");
      onCreated(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrors(err.fieldErrors());
        toast.error("Revise os campos destacados.");
      } else toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={editing ? "Editar paciente" : "Novo paciente"} subtitle={editing ? `${patient!.code} • altere apenas o necessário` : "Insira apenas os dados necessários para a assistência."} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <label className={`sm:col-span-2 ${labelCls}`}>Nome completo *<input required value={form.full_name} onChange={set("full_name")} className={inputCls} /><FieldError errors={errors} name="full_name" /></label>
          <label className={labelCls}>Data de nascimento *<input required type="date" max={todayISO()} value={form.birth_date} onChange={set("birth_date")} className={inputCls} /><FieldError errors={errors} name="birth_date" /></label>
          <label className={labelCls}>Identificação interna<input placeholder="PAC-00000 (vazio = gerar)" value={form.code} onChange={set("code")} className={inputCls} /><FieldError errors={errors} name="code" /></label>
          <label className={labelCls}>Telefone<input inputMode="tel" placeholder="(84)98123-6789" maxLength={14} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))} className={inputCls} /><FieldError errors={errors} name="phone" /></label>
          <label className={labelCls}>E-mail<input type="email" value={form.email} onChange={set("email")} className={inputCls} /><FieldError errors={errors} name="email" /></label>
          <label className={`sm:col-span-2 ${labelCls}`}>Observações clínicas<textarea value={form.notes} onChange={set("notes")} className="mt-1.5 h-20 w-full resize-none border border-border p-3 text-[12px]" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-slate-50 px-6 py-4"><button type="button" onClick={onClose} className="border border-border bg-white px-4 py-2 text-[11px]">Cancelar</button><button disabled={saving} className="flex items-center gap-2 bg-blue-600 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60">{saving && <Spinner />}{editing ? "Salvar alterações" : "Salvar paciente"}</button></div>
      </form>
    </Modal>
  );
}

function PatientExamsModal({ patient, onClose, onOpenExam }: { patient: Patient; onClose: () => void; onOpenExam: (id: number) => void }) {
  const { data, loading, error, reload } = useApi<Page<Exam>>(() => api.patients.exams(patient.id, { page_size: 50 }), [patient.id]);
  return (
    <Modal wide title={patient.full_name} subtitle={`${patient.code} • ${fmtDate(patient.birth_date)} • ${patient.age} anos`} onClose={onClose}>
      <div className="grid gap-3 border-b border-border p-5 text-[10px] sm:grid-cols-3">
        <div><span className="block text-slate-400">Telefone</span><strong>{patient.phone || "—"}</strong></div>
        <div><span className="block text-slate-400">E-mail</span><strong>{patient.email || "—"}</strong></div>
        <div><span className="block text-slate-400">Observações</span><strong className="font-medium">{patient.notes || "—"}</strong></div>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <ExamsTable exams={data.results} onOpen={(e) => onOpenExam(e.id)} emptyText="Este paciente ainda não possui exames." />}
    </Modal>
  );
}

function Patients({ onOpenExam, version }: { onOpenExam: (id: number) => void; version: number }) {
  const [query, setQuery] = useState("");
  const dq = useDebounced(query);
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState({ age_group: "", last_exam: "" });
  const [filters, setFilters] = useState({ age_group: "", last_exam: "" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const { data, loading, error, reload } = useApi<Page<Patient>>(
    () => api.patients.list({ search: dq, age_group: filters.age_group, last_exam: filters.last_exam, page, page_size: PAGE_SIZE }),
    [dq, filters.age_group, filters.last_exam, page, version],
  );
  return (
    <div className="p-5 lg:p-7">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[12px] text-slate-500">Cadastros clínicos e histórico longitudinal.</p>
        <button onClick={() => setShowForm(true)} className="flex h-9 items-center gap-2 bg-blue-600 px-3.5 text-[11px] font-semibold text-white hover:bg-blue-700"><Plus size={15} /> Cadastrar paciente</button>
      </div>
      <section className="border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="relative min-w-[260px] flex-1 sm:max-w-sm"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Pesquisar por nome ou identificação" className="h-9 w-full border border-border bg-slate-50 pl-9 pr-3 text-[11px] outline-none focus:border-blue-500" /></div>
          <button onClick={() => setShowFilters(!showFilters)} className="flex h-9 items-center gap-2 border border-border px-3 text-[10px] text-slate-600"><SlidersHorizontal size={14} /> Filtros</button>
        </div>
        {showFilters && <div className="grid gap-3 border-b border-border bg-slate-50 p-4 sm:grid-cols-3">
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Faixa etária<select value={draft.age_group} onChange={(e) => setDraft({ ...draft, age_group: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]"><option value="">Todas</option><option value="minor">Até 18 anos</option><option value="adult">19–59 anos</option><option value="senior">60 anos ou mais</option></select></label>
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Último exame<select value={draft.last_exam} onChange={(e) => setDraft({ ...draft, last_exam: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]"><option value="">Qualquer período</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option></select></label>
          <div className="flex items-end gap-2"><button onClick={() => { setFilters(draft); setPage(1); setShowFilters(false); toast.success("Filtros aplicados."); }} className="h-9 bg-[#142D4E] px-4 text-[10px] font-semibold text-white">Aplicar filtros</button><button onClick={() => { const empty = { age_group: "", last_exam: "" }; setDraft(empty); setFilters(empty); setPage(1); }} className="h-9 border border-border bg-white px-3 text-[10px]">Limpar</button></div>
        </div>}
        {error && <ErrorBox message={error} onRetry={reload} />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Paciente</th><th>Identificação</th><th>Nascimento / idade</th><th>Último exame</th><th>Exames</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {loading && !data && <tr><td colSpan={6}><Loading /></td></tr>}
              {data && data.results.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[11px] text-slate-400">Nenhum paciente encontrado.</td></tr>}
              {data?.results.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center bg-blue-50 text-[10px] font-bold text-blue-700">{p.initials}</span><span className="text-[11px] font-semibold text-slate-800">{p.full_name}</span></div></td>
                  <td className="font-mono text-[10px] text-slate-500">{p.code}</td>
                  <td className="text-[10px] text-slate-600">{fmtDate(p.birth_date)} <span className="text-slate-400">· {p.age} anos</span></td>
                  <td className="text-[10px] text-slate-600">{p.last_exam_at ? fmtWhen(p.last_exam_at) : "—"}</td>
                  <td className="text-[10px] font-semibold text-slate-700">{p.exams_count}</td>
                  <td className="whitespace-nowrap"><button onClick={() => setEditing(p)} title="Editar paciente" className="p-2 text-slate-400 hover:text-blue-600"><Pencil size={15} /></button><button onClick={() => setSelected(p)} title="Ver histórico" className="p-2 text-slate-400 hover:text-blue-600"><MoreHorizontal size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} count={data?.count ?? 0} onPage={setPage} />
      </section>
      {showForm && <PatientModal onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); setPage(1); reload(); }} />}
      {editing && <PatientModal patient={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); reload(); }} />}
      {selected && <PatientExamsModal patient={selected} onClose={() => setSelected(null)} onOpenExam={(id) => { setSelected(null); onOpenExam(id); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova análise
// ---------------------------------------------------------------------------
function PatientPicker({ value, onChange, onCreateNew }: { value: Patient | null; onChange: (p: Patient | null) => void; onCreateNew: () => void }) {
  const [query, setQuery] = useState("");
  const dq = useDebounced(query, 300);
  const { data, error } = useApi<Page<Patient>>(() => api.patients.list({ search: dq, page_size: 30, ordering: "full_name" }), [dq]);
  const options = useMemo(() => {
    const list = data?.results ?? [];
    return value && !list.some((p) => p.id === value.id) ? [value, ...list] : list;
  }, [data, value]);
  return (
    <div>
      <div className="flex items-center justify-between"><span className={labelCls}>Paciente *</span><button type="button" onClick={onCreateNew} className="text-[10px] font-semibold text-blue-600 hover:underline">+ Novo paciente</button></div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou identificação" className="mt-1.5 h-9 w-full border border-border px-3 text-[11px] outline-none focus:border-blue-500" />
      <select value={value?.id ?? ""} onChange={(e) => onChange(options.find((p) => p.id === Number(e.target.value)) ?? null)} className="mt-1.5 h-10 w-full border border-border bg-white px-3 text-[11px]">
        <option value="">{error ? "Não foi possível carregar pacientes" : options.length ? "Selecione o paciente" : "Nenhum paciente encontrado"}</option>
        {options.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.code}</option>)}
      </select>
    </div>
  );
}

function AIResultCard({ exam, onOpenReport, onReset, onRetry, retrying }: { exam: Exam; onOpenReport: () => void; onReset: () => void; onRetry: () => void; retrying: boolean }) {
  const ai = exam.ai;
  if (ai.status !== "completed" || !ai.label) {
    return (
      <section className="mt-3 border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center bg-white text-amber-600 shadow-sm"><AlertTriangle size={17} /></span>
          <div className="flex-1"><h3 className="text-[11px] font-semibold text-amber-800">A análise por IA não foi concluída</h3><p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-amber-800/80">{ai.error || "Serviço de IA indisponível."} O exame {exam.code} foi registrado e a radiografia está preservada.</p>
            <div className="mt-3 flex gap-2"><button onClick={onRetry} disabled={retrying} className="flex items-center gap-2 bg-amber-600 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60">{retrying && <Spinner />}Tentar novamente</button><button onClick={onOpenReport} className="border border-amber-300 bg-white px-3 py-2 text-[10px] font-semibold text-amber-800">Abrir laudo</button></div></div></div>
      </section>
    );
  }
  const pneumonia = ai.label === "PNEUMONIA";
  return (
    <section className="mt-3 border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center ${pneumonia ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}><Activity size={17} /></span>
          <div><h3 className="text-[11px] font-semibold text-slate-700">Resultado da inteligência artificial • {exam.code}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={pneumonia ? "red" : "green"}>{ai.label}</Badge><span className="font-display text-2xl font-semibold text-slate-900">{fmtConfidence(ai.confidence)}</span><span className="text-[10px] text-slate-500">de confiança na classe prevista</span></div></div></div>
        <div className="flex gap-2"><button onClick={onReset} className="border border-border px-3 py-2 text-[10px] font-semibold text-slate-700">Nova análise</button><button onClick={onOpenReport} className="bg-[#142D4E] px-3 py-2 text-[10px] font-semibold text-white">Abrir laudo</button></div>
      </div>
      <div className="mt-4 grid gap-3 text-[10px] sm:grid-cols-4">
        <div className="border border-border bg-slate-50 p-3"><span className="block text-slate-400">Probabilidade de pneumonia</span><strong className="mt-1 block">{fmtConfidence(ai.probability_pneumonia)}</strong></div>
        <div className="border border-border bg-slate-50 p-3"><span className="block text-slate-400">Limiar de decisão</span><strong className="mt-1 block">{ai.threshold != null ? ai.threshold.toLocaleString("pt-BR") : "—"}</strong></div>
        <div className="border border-border bg-slate-50 p-3"><span className="block text-slate-400">Modelo</span><strong className="mt-1 block break-all">{ai.model_version ?? "—"}</strong></div>
        <div className="border border-border bg-slate-50 p-3"><span className="block text-slate-400">Tempo de inferência</span><strong className="mt-1 block">{ai.inference_ms != null ? `${fmtInt(ai.inference_ms)} ms` : "—"}</strong></div>
      </div>
      {ai.low_confidence && <p className="mt-3 flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800"><AlertTriangle size={14} className="shrink-0" /> Confiança baixa: revise a imagem com atenção especial antes de qualquer conclusão.</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Este resultado é apoio à decisão e não constitui diagnóstico. A conclusão clínica e o laudo são de responsabilidade do médico.</p>
    </section>
  );
}

function Analysis({ system, onDone, openReport }: { system: SystemStatus | null; onDone: () => void; openReport: (reportId: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [processing, setProcessing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [examDate, setExamDate] = useState(todayISO());
  const [projection, setProjection] = useState<Projection>("unspecified");
  const [notes, setNotes] = useState("");
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [result, setResult] = useState<Exam | null>(null);
  const maxMb = system?.limits.max_xray_upload_mb ?? 15;
  const modelReady = system ? system.model.configured : true; // sem status ainda: o back-end decide
  const status = !system ? { tone: "slate" as const, text: "VERIFICANDO MODELO" } : system.model.configured ? { tone: "green" as const, text: `MODELO ATIVO${system.model.model_version ? ` • ${system.model.model_version}` : ""}` } : { tone: "orange" as const, text: "MODELO NÃO CONFIGURADO" };

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const chooseFile = (f?: File) => {
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) { toast.error("Formato não suportado. Use PNG ou JPEG."); return; }
    if (f.size > maxMb * 1024 * 1024) { toast.error(`A imagem deve ter no máximo ${maxMb} MB.`); return; }
    setResult(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setZoom(1);
  };
  const reset = () => { setFile(null); setPreview(""); setResult(null); setNotes(""); setProjection("unspecified"); setZoom(1); };

  const analyze = async () => {
    if (!file) return toast.error("Selecione uma radiografia antes de analisar.");
    if (!patient) return toast.error("Selecione o paciente do exame.");
    if (!modelReady) return toast.error("Serviço de IA não configurado. Defina MODEL_PATH no backend.");
    const form = new FormData();
    form.append("patient", String(patient.id));
    form.append("exam_date", examDate);
    form.append("projection", projection);
    form.append("notes", notes.trim());
    form.append("image", file);
    setProcessing(true);
    try {
      const exam = await api.exams.create(form);
      setResult(exam);
      onDone();
      if (exam.ai.status === "completed") toast.success(`Análise concluída: ${exam.ai.label}.`);
      else toast.error(exam.ai.error || "A análise por IA falhou. O exame foi registrado.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setProcessing(false);
    }
  };

  const retry = async () => {
    if (!result) return;
    setRetrying(true);
    try {
      const exam = await api.exams.analyze(result.id);
      setResult(exam);
      onDone();
      toast.success(`Análise concluída: ${exam.ai.label}.`);
    } catch (e) {
      if (e instanceof ApiError && e.data && typeof e.data === "object" && "exam" in e.data) setResult((e.data as { exam: Exam }).exam);
      toast.error(errMsg(e));
    } finally {
      setRetrying(false);
    }
  };

  const goToReport = () => {
    if (result?.report) openReport(result.report.id);
    else toast.error("Laudo não encontrado para este exame.");
  };

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-display text-[16px] font-semibold text-slate-900">Nova análise de radiografia</h2><p className="text-[10px] text-slate-500">Associe o exame, valide a imagem e solicite a inferência.</p></div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.4fr_0.8fr]">
        <section className="border border-border bg-white">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-700"><ScanLine size={15} /> Visualizador clínico</span>
            <div className="flex border border-border">
              <button onClick={() => setZoom(Math.max(.5, zoom - .1))} className="p-2 text-slate-500 hover:bg-slate-50"><ZoomOut size={15} /></button>
              <span className="border-x border-border px-2 py-2 font-mono text-[9px] text-slate-500">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(Math.min(2, zoom + .1))} className="p-2 text-slate-500 hover:bg-slate-50"><ZoomIn size={15} /></button>
              <button onClick={() => setZoom(1)} className="border-l border-border p-2 text-slate-500 hover:bg-slate-50"><RotateCcw size={15} /></button>
            </div>
          </div>
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); chooseFile(e.dataTransfer.files[0]); }} className="relative flex h-[430px] items-center justify-center overflow-hidden bg-[#07111d]">
            {preview ? <img src={preview} alt="Pré-visualização da radiografia selecionada" className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `scale(${zoom})` }} /> : <button onClick={() => inputRef.current?.click()} className="flex h-[84%] w-[82%] flex-col items-center justify-center border border-dashed border-slate-600 text-center hover:border-blue-400"><span className="mb-4 flex h-12 w-12 items-center justify-center border border-slate-600 bg-slate-800 text-blue-400"><UploadCloud size={22} /></span><span className="text-[13px] font-semibold text-slate-200">Arraste a radiografia para esta área</span><span className="mt-1 text-[10px] text-slate-500">ou clique para selecionar • PNG ou JPEG • até {maxMb} MB</span></button>}
            <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
            {file && <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-slate-950/85 px-3 py-2 text-[10px] text-slate-300"><ImagePlus size={14} className="text-blue-400" /><span>{file.name}</span><span className="text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span><button onClick={reset} className="text-slate-400 hover:text-white"><X size={13} /></button></div>}
          </div>
        </section>
        <section className="border border-border bg-white p-5">
          <h3 className="font-display text-[15px] font-semibold text-slate-900">Dados do exame</h3>
          <div className="mt-4 space-y-4">
            <PatientPicker value={patient} onChange={setPatient} onCreateNew={() => setShowNewPatient(true)} />
            <label className={`block ${labelCls}`}>Data do exame *<input type="date" max={todayISO()} value={examDate} onChange={(e) => setExamDate(e.target.value)} className="mt-1.5 h-10 w-full border border-border px-3 text-[11px]" /></label>
            <label className={`block ${labelCls}`}>Projeção<select value={projection} onChange={(e) => setProjection(e.target.value as Projection)} className="mt-1.5 h-10 w-full border border-border bg-white px-3 text-[11px]"><option value="unspecified">Não informada</option><option value="PA">PA</option><option value="AP">AP</option><option value="LATERAL">Perfil</option></select></label>
            <label className={`block ${labelCls}`}>Observações<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações técnicas opcionais" className="mt-1.5 h-20 w-full resize-none border border-border p-3 text-[11px]" /></label>
          </div>
          <div className="mt-5 border border-blue-100 bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-800"><div className="mb-1 flex items-center gap-2 font-semibold"><LockKeyhole size={13} /> Processamento seguro</div>A imagem original será preservada. Ajustes no visualizador não alteram o arquivo enviado ao modelo.</div>
          <button onClick={analyze} disabled={processing || !!result} className="mt-4 flex h-11 w-full items-center justify-center gap-2 bg-blue-600 text-[11px] font-bold tracking-[0.04em] text-white hover:bg-blue-700 disabled:opacity-70">{processing ? <><Spinner /> ANALISANDO IMAGEM...</> : <><Activity size={16} /> ANALISAR RADIOGRAFIA</>}</button>
          <p className="mt-2 text-center text-[9px] text-slate-400">{result ? "Exame registrado. Use “Nova análise” para enviar outra imagem." : "O exame é registrado e a CNN classifica a imagem em segundos."}</p>
        </section>
      </div>
      {result
        ? <AIResultCard exam={result} onOpenReport={goToReport} onReset={reset} onRetry={retry} retrying={retrying} />
        : <section className="mt-3 border border-dashed border-slate-300 bg-slate-50 p-5">
          <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center bg-white text-slate-400 shadow-sm"><Activity size={17} /></span><div><h3 className="text-[11px] font-semibold text-slate-700">Resultado da inteligência artificial</h3><p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-slate-500">{processing ? "Processando a radiografia..." : "Aguardando uma análise. Selecione o paciente e a radiografia e clique em “Analisar radiografia”. Nenhuma classificação é simulada."}</p></div></div>
        </section>}
      {showNewPatient && <PatientModal onClose={() => setShowNewPatient(false)} onCreated={(p) => { setPatient(p); setShowNewPatient(false); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exames
// ---------------------------------------------------------------------------
function ExamModal({ examId, onClose, onOpenReport, onChanged }: { examId: number; onClose: () => void; onOpenReport: (reportId: number) => void; onChanged: () => void }) {
  const { data: exam, loading, error, reload, setData } = useApi<Exam>(() => api.exams.get(examId), [examId]);
  const [busy, setBusy] = useState(false);
  const finalized = exam?.report?.status === "finalized";
  const reanalyze = async () => {
    setBusy(true);
    try {
      const updated = await api.exams.analyze(examId);
      setData(updated);
      onChanged();
      toast.success("Análise refeita.");
    } catch (e) {
      if (e instanceof ApiError && e.data && typeof e.data === "object" && "exam" in e.data) setData((e.data as { exam: Exam }).exam);
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal wide title={exam ? `Exame ${exam.code}` : "Exame"} subtitle={exam ? `${exam.patient.full_name} • ${exam.patient.code}` : undefined} onClose={onClose}>
      {loading && !exam && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {exam && <div className="grid gap-0 md:grid-cols-[1.2fr_1fr]">
        <div className="flex min-h-[320px] items-center justify-center bg-[#07111d]"><AuthImage path={exam.image_url} alt={`Radiografia do exame ${exam.code}`} className="max-h-[420px] max-w-full object-contain" /></div>
        <div className="space-y-4 p-5 text-[10px]">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="block text-slate-400">Data do exame</span><strong>{fmtDate(exam.exam_date)}</strong></div>
            <div><span className="block text-slate-400">Projeção</span><strong>{exam.projection_display}</strong></div>
            <div><span className="block text-slate-400">Médico responsável</span><strong>{exam.physician.name}</strong></div>
            <div><span className="block text-slate-400">Registrado em</span><strong>{fmtWhen(exam.created_at)}</strong></div>
          </div>
          {exam.notes && <div><span className="block text-slate-400">Observações</span><p className="mt-0.5 text-[11px] text-slate-700">{exam.notes}</p></div>}
          <div className="border border-border bg-slate-50 p-3">
            <span className="mb-2 block font-semibold text-slate-700">Resultado da IA</span>
            <ResultBadge ai={exam.ai} />
            {exam.ai.status === "completed" && <p className="mt-2 text-slate-500">Probabilidade de pneumonia {fmtConfidence(exam.ai.probability_pneumonia)} • modelo {exam.ai.model_version ?? "—"}</p>}
            {exam.ai.low_confidence && <p className="mt-2 text-amber-700">Confiança baixa: revisar com atenção.</p>}
            {exam.ai.status === "failed" && <p className="mt-2 text-red-600">{exam.ai.error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {exam.report && <button onClick={() => onOpenReport(exam.report!.id)} className="bg-[#142D4E] px-3 py-2 text-[10px] font-semibold text-white">Abrir laudo</button>}
            {finalized && <p className="w-full border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-500">Laudo finalizado: o exame e a análise ficam bloqueados. Para refazer a análise, um administrador precisa reabrir o laudo.</p>}
            {!finalized && <button onClick={reanalyze} disabled={busy} className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] font-semibold text-slate-700 disabled:opacity-60">{busy && <Spinner light={false} />}Refazer análise</button>}
          </div>
          <p className="text-[9px] leading-relaxed text-slate-400">Apoio à decisão: não substitui a avaliação médica.</p>
        </div>
      </div>}
    </Modal>
  );
}

function Exams({ setView, onOpenExam, version }: { setView: (v: View) => void; onOpenExam: (id: number) => void; version: number }) {
  const [query, setQuery] = useState("");
  const dq = useDebounced(query);
  const [showFilters, setShowFilters] = useState(false);
  const empty = { result: "", report_status: "", date_from: "", date_to: "" };
  const [draft, setDraft] = useState(empty);
  const [filters, setFilters] = useState(empty);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<Page<Exam>>(
    () => api.exams.list({ search: dq, ...filters, page, page_size: PAGE_SIZE }),
    [dq, filters.result, filters.report_status, filters.date_from, filters.date_to, page, version],
  );
  return (
    <div className="p-5 lg:p-7">
      <div className="mb-5 flex items-center justify-between"><p className="text-[12px] text-slate-500">Rastreabilidade integral das análises e revisões.</p><button onClick={() => setView("analysis")} className="flex h-9 items-center gap-2 bg-blue-600 px-4 text-[11px] font-semibold text-white"><Plus size={15} /> Novo exame</button></div>
      <div className="mb-3 flex gap-2">
        <div className="relative max-w-sm flex-1"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Paciente, código ou médico" className="h-10 w-full border border-border bg-white pl-9 text-[11px]" /></div>
        <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 border border-border bg-white px-3 text-[10px]"><SlidersHorizontal size={14} /> Filtros avançados</button>
      </div>
      {showFilters && <div className="mb-3 grid gap-3 border border-border bg-slate-50 p-4 sm:grid-cols-5">
        <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Classificação<select value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]"><option value="">Todas</option><option value="NORMAL">Normal</option><option value="PNEUMONIA">Pneumonia</option></select></label>
        <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Situação do laudo<select value={draft.report_status} onChange={(e) => setDraft({ ...draft, report_status: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]"><option value="">Todas</option><option value="pending">Aguardando revisão</option><option value="draft">Em elaboração</option><option value="finalized">Finalizado</option></select></label>
        <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">De<input type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]" /></label>
        <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Até<input type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className="mt-1 block h-9 w-full border border-border bg-white px-2 text-[10px]" /></label>
        <div className="flex items-end gap-2"><button onClick={() => { setFilters(draft); setPage(1); }} className="h-9 bg-[#142D4E] px-4 text-[10px] font-semibold text-white">Aplicar</button><button onClick={() => { setDraft(empty); setFilters(empty); setPage(1); }} className="h-9 border border-border bg-white px-3 text-[10px]">Limpar</button></div>
      </div>}
      <section className="border border-border bg-white">
        <div className="border-b border-border px-5 py-4"><h2 className="font-display text-[16px] font-semibold text-slate-900">Histórico de exames</h2><p className="text-[10px] text-slate-500">Clique em uma linha para ver a imagem, o resultado da IA e o laudo.</p></div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : <ExamsTable exams={data?.results ?? []} onOpen={(e) => onOpenExam(e.id)} />}
        <Pager page={page} count={data?.count ?? 0} onPage={setPage} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Laudos
// ---------------------------------------------------------------------------
function Reports({ user, target, clearTarget, version, onChanged }: { user: ApiUser; target: number | null; clearTarget: () => void; version: number; onChanged: () => void }) {
  const [tab, setTab] = useState<"" | ReportStatus>("");
  const [query, setQuery] = useState("");
  const dq = useDebounced(query);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(target);
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useApi<Page<ReportListItem>>(() => api.reports.list({ status: tab, search: dq, page, page_size: 8 }), [tab, dq, page, version]);
  const detail = useApi<Report | null>(() => (selectedId ? api.reports.get(selectedId) : Promise.resolve(null)), [selectedId]);
  const history = useApi<{ at: string; label: string; user: { name: string } | null }[]>(
    () => (selectedId ? api.reports.history(selectedId) : Promise.resolve([])),
    [selectedId, detail.data?.updated_at],
  );
  const report = detail.data;
  const dirty = !!report && (findings !== report.findings || conclusion !== report.conclusion);
  const editable = !!report?.can_edit;

  useEffect(() => {
    if (target != null) {
      setSelectedId(target);
      clearTarget();
    }
  }, [target, clearTarget]);

  useEffect(() => {
    if (report) {
      setFindings(report.findings);
      setConclusion(report.conclusion);
    } else {
      setFindings("");
      setConclusion("");
    }
  }, [report]);

  const select = (id: number) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Há alterações não salvas neste laudo. Descartar e abrir outro?")) return;
    setSelectedId(id);
  };

  const saveDraft = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const updated = await api.reports.saveDraft(report.id, { findings, conclusion });
      detail.setData(updated);
      onChanged();
      toast.success("Rascunho salvo.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const updated = await api.reports.finalize(report.id, { findings, conclusion });
      detail.setData(updated);
      setConfirmFinalize(false);
      onChanged();
      toast.success("Laudo finalizado e registrado na auditoria.");
    } catch (e) {
      setConfirmFinalize(false);
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const updated = await api.reports.reopen(report.id, reason.trim());
      detail.setData(updated);
      setReopening(false);
      setReason("");
      onChanged();
      toast.success("Laudo reaberto. A justificativa foi registrada na auditoria.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!report) return;
    const win = window.open("", "_blank"); // abre antes do await para não ser bloqueado
    try {
      const blob = await api.reports.pdf(report.id);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else toast.info("Permita pop-ups para visualizar o PDF.");
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      win?.close();
      toast.error(errMsg(e));
    }
  };

  const download = async () => {
    if (!report) return;
    try {
      const blob = await api.reports.pdf(report.id, true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `laudo-${report.exam.code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const tabs: { id: "" | ReportStatus; label: string }[] = [{ id: "", label: "Todos" }, { id: "pending", label: "Aguardando" }, { id: "draft", label: "Em elaboração" }, { id: "finalized", label: "Finalizados" }];
  const statusTone = (s: ReportStatus) => (s === "finalized" ? "green" : s === "draft" ? "blue" : "orange");
  const ai = report?.exam.ai;

  return (
    <div className="p-5 lg:p-7">
      <section className="mb-3 border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="font-display text-[16px] font-semibold">Fila de laudos</h2><p className="text-[10px] text-slate-500">Selecione um laudo para elaborar ou revisar.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-border">{tabs.map((t) => <button key={t.id} onClick={() => { setTab(t.id); setPage(1); }} className={`px-3 py-2 text-[10px] ${tab === t.id ? "bg-[#142D4E] font-semibold text-white" : "text-slate-600 hover:bg-slate-50"}`}>{t.label}</button>)}</div>
            <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Paciente ou código" className="h-8 w-44 border border-border pl-8 text-[10px]" /></div>
          </div>
        </div>
        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
        {list.loading && !list.data ? <Loading /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
            <thead className="bg-slate-50/80 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-5 py-2.5">Exame</th><th className="px-3">Paciente</th><th className="px-3">IA</th><th className="px-3">Médico</th><th className="px-3">Situação</th></tr></thead>
            <tbody className="divide-y divide-border">
              {list.data?.results.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-[11px] text-slate-400">Nenhum laudo nesta visão.</td></tr>}
              {list.data?.results.map((r) => (
                <tr key={r.id} onClick={() => select(r.id)} className={`cursor-pointer hover:bg-slate-50/60 ${r.id === selectedId ? "bg-blue-50/60" : ""}`}>
                  <td className="px-5 py-2.5 font-mono text-[10px] text-slate-600">{r.exam.code}</td>
                  <td className="px-3 text-[11px] font-semibold text-slate-800">{r.exam.patient.full_name}</td>
                  <td className="px-3"><ResultBadge ai={r.exam.ai} /></td>
                  <td className="px-3 text-[10px] text-slate-600">{r.exam.physician.name}</td>
                  <td className="px-3"><span className="flex items-center gap-1.5 text-[10px] text-slate-600"><span className={`h-1.5 w-1.5 rounded-full ${reportTone(r.status)}`} />{r.status_display}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <Pager page={page} count={list.data?.count ?? 0} onPage={setPage} />
      </section>

      {!selectedId && <div className="border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-[11px] text-slate-500">Nenhum laudo selecionado.</div>}
      {selectedId && detail.loading && !report && <Loading />}
      {selectedId && detail.error && <ErrorBox message={detail.error} onRetry={detail.reload} />}
      {report && (
        <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
          <section className="border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-[16px] font-semibold">Editor de laudo</h2><p className="text-[10px] text-slate-500">{report.exam.code} • {report.exam.patient.full_name}</p></div><Badge tone={statusTone(report.status)}>{report.status === "pending" ? "AGUARDANDO REVISÃO" : report.status === "draft" ? "RASCUNHO" : "FINALIZADO"}</Badge></div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="border border-border bg-slate-50 p-3 text-[10px]"><span className="block text-slate-400">Modalidade</span><strong className="mt-1 block">Radiografia de tórax • {report.exam.projection_display}</strong></div>
              <div className="border border-border bg-slate-50 p-3 text-[10px]"><span className="block text-slate-400">Médico responsável</span><strong className="mt-1 block">{report.exam.physician.name}{report.exam.physician.registration ? ` • ${report.exam.physician.registration}` : ""}</strong></div>
              {report.status === "finalized" && <div className="border border-emerald-200 bg-emerald-50 p-3 text-[10px] text-emerald-800 sm:col-span-2">Finalizado por <strong>{report.signature_name}</strong> • {report.signature_registration} em {fmtWhen(report.finalized_at)}. Laudo bloqueado para edição.</div>}
              {!editable && report.status !== "finalized" && <div className="border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 sm:col-span-2">Somente o médico responsável (ou um administrador) pode editar este laudo.</div>}
              <label className={`sm:col-span-2 ${labelCls}`}>Descrição dos achados<textarea value={findings} disabled={!editable} onChange={(e) => setFindings(e.target.value)} maxLength={10000} placeholder="Registre os achados observados na imagem..." className="mt-1.5 h-32 w-full resize-none border border-border p-3 text-[12px] font-normal outline-none focus:border-blue-500 disabled:bg-slate-50" /></label>
              <label className={`sm:col-span-2 ${labelCls}`}>Impressão diagnóstica<textarea value={conclusion} disabled={!editable} onChange={(e) => setConclusion(e.target.value)} maxLength={10000} placeholder="Informe sua interpretação clínica..." className="mt-1.5 h-24 w-full resize-none border border-border p-3 text-[12px] font-normal outline-none focus:border-blue-500 disabled:bg-slate-50" /></label>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-4">
              {user.role === "admin" && report.status === "finalized" && <button onClick={() => setReopening(true)} className="mr-auto border border-border bg-white px-4 py-2 text-[11px]">Reabrir laudo</button>}
              {editable && <button onClick={saveDraft} disabled={saving || !dirty} className="flex items-center gap-2 border border-border bg-white px-4 py-2 text-[11px] disabled:opacity-50">{saving && <Spinner light={false} />}Salvar rascunho</button>}
              <button onClick={preview} className="flex items-center gap-2 border border-border bg-white px-4 py-2 text-[11px]"><FileText size={14} /> Pré-visualizar</button>
              <button onClick={download} className="flex items-center gap-2 border border-border bg-white px-4 py-2 text-[11px]"><Download size={14} /> Baixar PDF</button>
              {editable && <button onClick={() => conclusion.trim() ? setConfirmFinalize(true) : toast.error("Preencha a impressão diagnóstica antes de finalizar.")} className="flex items-center gap-2 bg-[#142D4E] px-4 py-2 text-[11px] font-semibold text-white"><FileCheck2 size={14} /> Revisar e finalizar</button>}
            </div>
          </section>
          <aside className="space-y-3">
            <div className="border border-border bg-white p-4"><h3 className="text-[11px] font-semibold">Informação da IA</h3>
              {ai?.status === "completed" && ai.label ? (
                <div className="mt-3 space-y-2 text-[10px]"><ResultBadge ai={ai} /><p className="text-slate-500">Probabilidade de pneumonia: <strong>{fmtConfidence(ai.probability_pneumonia)}</strong></p><p className="text-slate-500">Modelo: {ai.model_version ?? "—"}</p>{ai.low_confidence && <p className="text-amber-700">Confiança baixa: revisar com atenção.</p>}</div>
              ) : <div className="mt-3 border border-dashed border-slate-300 bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500">{ai?.status === "failed" ? `Análise indisponível: ${ai.error ?? "falha no serviço de IA"}.` : "Análise ainda não realizada."}</div>}
              <div className="mt-3 flex min-h-[120px] items-center justify-center bg-[#07111d]"><AuthImage path={`exams/${report.exam.id}/image/`} alt="Radiografia do exame" className="max-h-48 max-w-full object-contain" /></div>
            </div>
            <div className="border border-amber-200 bg-amber-50 p-4"><h3 className="flex items-center gap-2 text-[11px] font-semibold text-amber-800"><ShieldCheck size={15} /> Responsabilidade clínica</h3><p className="mt-2 text-[10px] leading-relaxed text-amber-800/80">A conclusão deve refletir exclusivamente a avaliação do profissional. A IA não preenche ou finaliza laudos.</p></div>
            <div className="border border-border bg-white p-4"><h3 className="text-[11px] font-semibold">Histórico</h3>
              <div className="mt-3 space-y-3 border-l border-slate-200 pl-3">
                {history.data?.length === 0 && <p className="text-[10px] text-slate-400">Sem eventos.</p>}
                {history.data?.map((h, i) => <div key={i}><p className="text-[10px] font-medium">{h.label}</p><p className="text-[9px] text-slate-400">{fmtWhen(h.at)}{h.user ? ` • ${h.user.name}` : ""}</p></div>)}
              </div>
            </div>
          </aside>
        </div>
      )}
      {confirmFinalize && <ConfirmDialog tone="primary" icon={FileCheck2} title="Finalizar laudo?" message="Após finalizado, o laudo será assinado com seu nome e registro profissional e não poderá mais ser editado." confirmLabel="Sim, finalizar" busy={busy} onCancel={() => setConfirmFinalize(false)} onConfirm={finalize} />}
      {reopening && <ConfirmDialog tone="primary" icon={RotateCcw} title="Reabrir laudo" message="Informe a justificativa. Ela ficará registrada na auditoria." confirmLabel="Reabrir" busy={busy} disabled={!reason.trim()} onCancel={() => { setReopening(false); setReason(""); }} onConfirm={reopen}><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-3 h-20 w-full resize-none border border-border p-3 text-[11px]" placeholder="Motivo da reabertura" /></ConfirmDialog>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auditoria (usada na administração e nas configurações)
// ---------------------------------------------------------------------------
function AuditPanel() {
  const [query, setQuery] = useState("");
  const dq = useDebounced(query);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<Page<AuditLog>>(() => api.admin.auditLogs({ search: dq, page, page_size: PAGE_SIZE }), [dq, page]);
  return (
    <section className="mt-3 border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div><h2 className="font-display text-[16px] font-semibold text-slate-900">Trilha de auditoria</h2><p className="text-[10px] text-slate-500">Registro imutável de acessos e ações.</p></div>
        <div className="relative w-full max-w-xs"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Usuário, ação ou objeto" className="h-10 w-full border border-border pl-9 text-[11px]" /></div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left">
          <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Quando</th><th>Usuário</th><th>Ação</th><th>Objeto</th><th>IP</th></tr></thead>
          <tbody className="divide-y divide-border">
            {data?.results.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-[11px] text-slate-400">Nenhum registro.</td></tr>}
            {data?.results.map((l) => <tr key={l.id}><td className="px-5 py-3 text-[10px] text-slate-600">{fmtWhen(l.created_at)}</td><td className="text-[10px] text-slate-700">{l.user?.name ?? l.user_email ?? "—"}</td><td className="text-[10px] font-medium text-slate-800">{l.action_label}</td><td className="text-[10px] text-slate-500">{l.object_repr || "—"}</td><td className="font-mono text-[9px] text-slate-400">{l.ip_address ?? "—"}</td></tr>)}
          </tbody>
        </table></div>
      )}
      <Pager page={page} count={data?.count ?? 0} onPage={setPage} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
const PREFERENCE_LABELS: { key: keyof Preferences; label: string }[] = [
  { key: "notify_analysis_done", label: "Notificar quando análise for concluída" },
  { key: "notify_pending_reports", label: "Avisar sobre laudos pendentes" },
  { key: "weekly_summary", label: "Receber resumo semanal" },
];

function SettingsView({ user, setUser, system, setView }: { user: ApiUser; setUser: (user: ApiUser) => void; system: SystemStatus | null; setView: (v: View) => void }) {
  const [tab, setTab] = useState("Perfil profissional");
  const uploadRef = useRef<HTMLInputElement>(null);
  const tabs = ["Perfil profissional", "Segurança e senha", "Preferências", ...(user.role === "admin" ? ["Usuários e permissões", "Auditoria"] : []), "Sistema e modelo"];
  const [profile, setProfile] = useState({ name: user.name, email: user.email, registration: user.registration, specialty: user.specialty });
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [savingPwd, setSavingPwd] = useState(false);
  const prefs: Preferences = { notify_analysis_done: true, notify_pending_reports: true, weekly_summary: true, ...(user.preferences ?? {}) };

  const photo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem válida.");
    if (file.size > 5 * 1024 * 1024) return toast.error("A foto deve ter no máximo 5 MB.");
    try {
      setUser(await api.auth.uploadAvatar(file));
      toast.success("Foto profissional atualizada.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const removePhoto = async () => {
    try {
      await api.auth.removeAvatar();
      setUser(await api.auth.me());
      toast.success("Foto removida.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileErrors({});
    try {
      setUser(await api.auth.updateMe({ name: profile.name.trim(), email: profile.email.trim(), registration: profile.registration.trim(), specialty: profile.specialty.trim() }));
      toast.success("Perfil atualizado.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setProfileErrors(e.fieldErrors());
      toast.error(errMsg(e));
    } finally {
      setSavingProfile(false);
    }
  };
  const changePassword = async () => {
    if (pwd.next !== pwd.confirm) return toast.error("A confirmação não coincide com a nova senha.");
    setSavingPwd(true);
    try {
      const res = await api.auth.changePassword(pwd.current, pwd.next);
      setPwd({ current: "", next: "", confirm: "" });
      toast.success(res.detail);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingPwd(false);
    }
  };
  const togglePref = async (key: keyof Preferences, value: boolean) => {
    const previous = user;
    setUser({ ...user, preferences: { ...prefs, [key]: value } });
    try {
      setUser(await api.auth.updateMe({ preferences: { [key]: value } as unknown as Preferences }));
    } catch (e) {
      setUser(previous);
      toast.error(errMsg(e));
    }
  };

  return <div className="p-5 lg:p-7"><div className="grid gap-3 lg:grid-cols-[280px_1fr]"><aside className="h-fit border border-border bg-white p-2">{tabs.map((x) => <button key={x} onClick={() => setTab(x)} className={`block w-full px-3 py-3 text-left text-[11px] ${tab === x ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-500 hover:bg-slate-50"}`}>{x}</button>)}</aside>
    <div>
      <section className="border border-border bg-white p-6">
        {tab === "Perfil profissional" && <><h2 className="font-display text-lg font-semibold">Perfil profissional</h2><p className="text-[10px] text-slate-500">Informações exibidas nos registros e laudos.</p>
          <div className="mt-5 flex items-center gap-4 border-b border-border pb-5"><Avatar user={user} className="h-20 w-20 text-xl" />
            <div><input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ""; }} /><div className="flex gap-2"><button onClick={() => uploadRef.current?.click()} className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] font-semibold"><Camera size={14} /> Alterar foto</button>{user.avatar_url && <button onClick={removePhoto} className="border border-border px-3 py-2 text-[10px] text-slate-600">Remover</button>}</div><p className="mt-1 text-[9px] text-slate-400">PNG, JPEG ou WebP • máximo 5 MB</p></div></div>
          <div className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
            <label className={labelCls}>Nome completo<input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /><FieldError errors={profileErrors} name="name" /></label>
            <label className={labelCls}>E-mail<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /><FieldError errors={profileErrors} name="email" /></label>
            <label className={labelCls}>Registro profissional<input value={profile.registration} onChange={(e) => setProfile({ ...profile, registration: e.target.value })} placeholder="CRM 000000" className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /><FieldError errors={profileErrors} name="registration" /></label>
            <label className={labelCls}>Especialidade<input value={profile.specialty} onChange={(e) => setProfile({ ...profile, specialty: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /><FieldError errors={profileErrors} name="specialty" /></label>
          </div>
          <button onClick={saveProfile} disabled={savingProfile} className="mt-6 flex items-center gap-2 bg-blue-600 px-4 py-2.5 text-[11px] font-semibold text-white disabled:opacity-60">{savingProfile && <Spinner />}Salvar alterações</button></>}
        {tab === "Segurança e senha" && <><h2 className="font-display text-lg font-semibold">Segurança e senha</h2><p className="text-[10px] text-slate-500">Ao trocar a senha, as outras sessões são encerradas.</p>
          <div className="mt-6 max-w-md space-y-4">
            <label className={`block ${labelCls}`}>Senha atual<input type="password" autoComplete="current-password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /></label>
            <label className={`block ${labelCls}`}>Nova senha<input type="password" autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /></label>
            <label className={`block ${labelCls}`}>Confirmar nova senha<input type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /></label>
            <button onClick={changePassword} disabled={savingPwd || !pwd.current || pwd.next.length < 8} className="flex items-center gap-2 bg-blue-600 px-4 py-2.5 text-[11px] font-semibold text-white disabled:opacity-60">{savingPwd && <Spinner />}Atualizar senha</button>
          </div></>}
        {tab === "Preferências" && <><h2 className="font-display text-lg font-semibold">Preferências</h2><div className="mt-6 space-y-3">{PREFERENCE_LABELS.map(({ key, label }) => <label key={key} className="flex items-center justify-between border border-border p-4 text-[11px] text-slate-700">{label}<input type="checkbox" checked={prefs[key]} onChange={(e) => togglePref(key, e.target.checked)} className="h-4 w-4 accent-blue-600" /></label>)}</div></>}
        {tab === "Sistema e modelo" && <><h2 className="font-display text-lg font-semibold">Sistema e modelo</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="border border-border p-4 text-[10px]"><span className="text-slate-400">Versão da plataforma</span><strong className="mt-1 block">PneumoAI {system?.platform_version ?? "—"}</strong></div>
            <div className={`border p-4 text-[10px] ${system?.model.configured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><span className={system?.model.configured ? "text-emerald-700" : "text-amber-700"}>Modelo CNN</span><strong className={`mt-1 block ${system?.model.configured ? "text-emerald-800" : "text-amber-800"}`}>{!system ? "Verificando..." : system.model.configured ? (system.model.loaded ? "Carregado" : "Configurado (carrega na 1ª análise)") : "Não configurado"}</strong></div>
            {system && <>
              <div className="border border-border p-4 text-[10px]"><span className="text-slate-400">Arquivo / versão</span><strong className="mt-1 block break-all">{system.model.model_file} • {system.model.model_version ?? "—"}</strong></div>
              <div className="border border-border p-4 text-[10px]"><span className="text-slate-400">Entrada • classes • limiar</span><strong className="mt-1 block">{system.model.input_size.join("×")} • {system.model.class_names.join(" / ")} • {system.model.threshold.toLocaleString("pt-BR")}</strong></div>
              <div className="border border-border p-4 text-[10px]"><span className="text-slate-400">Limite de upload</span><strong className="mt-1 block">{system.limits.max_xray_upload_mb} MB • PNG ou JPEG</strong></div>
            </>}
          </div></>}
        {tab === "Usuários e permissões" && <div><h2 className="font-display text-lg font-semibold">Usuários e permissões</h2><p className="mt-2 text-[11px] text-slate-500">Use o módulo administrativo para gerenciar estes registros.</p><button onClick={() => setView("admin")} className="mt-4 bg-blue-600 px-4 py-2.5 text-[11px] font-semibold text-white">Abrir módulo administrativo</button></div>}
        {tab === "Auditoria" && <div><h2 className="font-display text-lg font-semibold">Auditoria</h2><p className="mt-2 text-[11px] text-slate-500">Eventos de segurança e de manipulação de dados clínicos.</p></div>}
      </section>
      {tab === "Auditoria" && <AuditPanel />}
    </div></div></div>;
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------
function AdminView() {
  const [query, setQuery] = useState("");
  const dq = useDebounced(query);
  const [page, setPage] = useState(1);
  const [invite, setInvite] = useState(false);
  const [managing, setManaging] = useState<ApiUser | null>(null);
  const [inviteForm, setInviteForm] = useState<{ email: string; name: string; role: Role }>({ email: "", name: "", role: "doctor" });
  const [saving, setSaving] = useState(false);
  const [manageForm, setManageForm] = useState<{ role: Role; is_active: boolean }>({ role: "doctor", is_active: true });
  const summary = useApi<AdminSummary>(() => api.admin.summary(), []);
  const users = useApi<Page<ApiUser>>(() => api.admin.users({ search: dq, page, page_size: PAGE_SIZE }), [dq, page]);

  const openManage = (u: ApiUser) => { setManaging(u); setManageForm({ role: u.role, is_active: u.is_active }); };

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.admin.invite({ email: inviteForm.email.trim(), role: inviteForm.role, name: inviteForm.name.trim() || undefined });
      if (res.email_sent) toast.success("Convite enviado com sucesso.");
      else toast.warning("Usuário criado, mas o e-mail do convite não pôde ser enviado.");
      setInvite(false);
      setInviteForm({ email: "", name: "", role: "doctor" });
      users.reload();
      summary.reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const saveManage = async (e: FormEvent) => {
    e.preventDefault();
    if (!managing) return;
    setSaving(true);
    try {
      await api.admin.updateUser(managing.id, manageForm);
      toast.success(`Permissões de ${managing.name} atualizadas.`);
      setManaging(null);
      users.reload();
      summary.reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const approve = async (u: ApiUser) => {
    try {
      await api.admin.updateUser(u.id, { is_active: true });
      toast.success(`${u.name} aprovado(a).`);
      users.reload();
      summary.reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const s = summary.data;
  return <div className="p-5 lg:p-7">
    <div className="mb-5 flex items-center justify-between"><p className="text-[12px] text-slate-500">Controle de usuários, permissões e eventos de segurança.</p><button onClick={() => setInvite(true)} className="flex h-9 items-center gap-2 bg-blue-600 px-4 text-[11px] font-semibold text-white"><UserPlus size={15} /> Convidar usuário</button></div>
    {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Usuários ativos" value={s ? fmtInt(s.active_users) : "—"} meta={s ? `${s.active_doctors} médicos` : ""} icon={Users} tone="bg-blue-50 text-blue-700" />
      <StatCard label="Acessos hoje" value={s ? fmtInt(s.accesses_today) : "—"} meta={s ? (s.failed_logins_today ? `${s.failed_logins_today} recusados` : "sem incidentes") : ""} icon={ShieldCheck} tone="bg-emerald-50 text-emerald-700" />
      <StatCard label="Perfis admin" value={s ? pad(s.admins) : "—"} meta="acesso elevado" icon={LockKeyhole} tone="bg-amber-50 text-amber-700" />
      <StatCard label="Logs de auditoria" value={s ? fmtInt(s.audit_logs_30d) : "—"} meta="últimos 30 dias" icon={FileText} tone="bg-slate-100 text-slate-700" />
    </div>
    <section className="mt-3 border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border p-4"><div className="relative w-full max-w-sm"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Pesquisar usuários" className="h-10 w-full border border-border pl-9 text-[11px]" /></div></div>
      {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
      {users.loading && !users.data ? <Loading /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
          <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Profissional</th><th>Perfil</th><th>Status</th><th>Permissões</th></tr></thead>
          <tbody className="divide-y divide-border">
            {users.data?.results.map((u) => {
              const pending = !u.is_active && !u.last_login;
              return <tr key={u.id}>
                <td className="px-5 py-4"><strong className="block text-[11px]">{u.name}</strong><span className="text-[9px] text-slate-400">{u.email}{u.registration ? ` • ${u.registration}` : ""}</span></td>
                <td className="text-[10px]">{u.role === "admin" ? "Administrador" : "Médico"}</td>
                <td><Badge tone={u.is_active ? "green" : pending ? "orange" : "slate"}>{u.is_active ? "Ativo" : pending ? "Aguardando aprovação" : "Inativo"}</Badge></td>
                <td className="space-x-3">{pending && <button onClick={() => approve(u)} className="text-[10px] font-semibold text-emerald-700">Aprovar</button>}<button onClick={() => openManage(u)} className="text-[10px] font-semibold text-blue-600">Gerenciar</button></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      )}
      <Pager page={page} count={users.data?.count ?? 0} onPage={setPage} />
    </section>
    <AuditPanel />
    {invite && <Modal title="Convidar profissional" subtitle="O convidado define a própria senha por e-mail." onClose={() => setInvite(false)}>
      <form onSubmit={sendInvite} className="space-y-4 p-6">
        <label className={`block ${labelCls}`}>E-mail profissional<input required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /></label>
        <label className={`block ${labelCls}`}>Nome (opcional)<input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]" /></label>
        <label className={`block ${labelCls}`}>Perfil<select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as Role })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]"><option value="doctor">Médico</option><option value="admin">Administrador</option></select></label>
        <button disabled={saving} className="flex w-full items-center justify-center gap-2 bg-blue-600 py-3 text-[11px] font-semibold text-white disabled:opacity-60">{saving && <Spinner />}Enviar convite</button>
      </form>
    </Modal>}
    {managing && <Modal title={`Permissões de ${managing.name}`} subtitle={managing.email} onClose={() => setManaging(null)}>
      <form onSubmit={saveManage} className="space-y-4 p-6">
        <label className={`block ${labelCls}`}>Perfil<select value={manageForm.role} onChange={(e) => setManageForm({ ...manageForm, role: e.target.value as Role })} className="mt-1 h-10 w-full border border-border px-3 text-[11px]"><option value="doctor">Médico</option><option value="admin">Administrador</option></select></label>
        <label className="flex items-center justify-between border border-border p-4 text-[11px] text-slate-700">Conta ativa<input type="checkbox" checked={manageForm.is_active} onChange={(e) => setManageForm({ ...manageForm, is_active: e.target.checked })} className="h-4 w-4 accent-blue-600" /></label>
        <p className="text-[9px] text-slate-400">Alterar perfil ou desativar encerra as sessões do usuário. Você não pode alterar a própria conta nem remover o último administrador.</p>
        <button disabled={saving} className="flex w-full items-center justify-center gap-2 bg-blue-600 py-3 text-[11px] font-semibold text-white disabled:opacity-60">{saving && <Spinner />}Salvar permissões</button>
      </form>
    </Modal>}
  </div>;
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------
function parseResetLink() {
  if (window.location.pathname.replace(/\/+$/, "") !== "/reset-password") return null;
  const q = new URLSearchParams(window.location.search);
  const uid = q.get("uid");
  const token = q.get("token");
  return uid && token ? { uid, token, invite: q.get("invite") === "1" } : null;
}

export default function App() {
  const [resetLink, setResetLink] = useState(parseResetLink);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [booting, setBooting] = useState(() => hasSession() && !parseResetLink());
  const [view, setView] = useState<View>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("pneumoai.theme") === "dark");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [version, setVersion] = useState(0); // incrementa quando dados mudam, para recarregar listas
  const [examModal, setExamModal] = useState<number | null>(null);
  const [reportTarget, setReportTarget] = useState<number | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const clearReportTarget = useCallback(() => setReportTarget(null), []);

  // Sessão expirada (refresh recusado): volta ao login.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setView("dashboard");
      toast.error("Sua sessão expirou. Entre novamente.");
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  // Restaura a sessão a partir dos tokens guardados.
  useEffect(() => {
    if (!booting) return;
    api.auth.me()
      .then((me) => { setUser(me); setView(me.role === "admin" ? "admin" : "dashboard"); })
      .catch((e) => { if (e instanceof ApiError && e.status === 0) toast.error(e.message); })
      .finally(() => setBooting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const system = useApi<SystemStatus | null>(() => (user ? api.system() : Promise.resolve(null)), [user?.id]);
  const counts = useApi<DashboardData | null>(() => (user ? api.dashboard(1) : Promise.resolve(null)), [user?.id, version]);
  const pending = counts.data?.cards.awaiting_review ?? 0;

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(system.reload, 60_000);
    return () => window.clearInterval(timer);
  }, [user, system.reload]);

  const service: ServiceState = system.data
    ? system.data.model.configured ? { tone: "green", label: "Serviços operacionais" } : { tone: "amber", label: "IA não configurada" }
    : system.error ? { tone: "red", label: "Servidor indisponível" } : { tone: "slate", label: "Verificando..." };

  const openReport = useCallback((reportId: number) => {
    setExamModal(null);
    setReportTarget(reportId);
    setView("reports");
  }, []);

  const logout = async () => {
    setConfirmLogout(false);
    await api.auth.logout();
    clearSession();
    setUser(null);
    setView("dashboard");
    setExamModal(null);
    setReportTarget(null);
    toast.success("Sessão encerrada com segurança.");
  };

  const pageMeta: Record<View, [string, string]> = useMemo(() => {
    const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return {
      dashboard: ["Visão geral", today.charAt(0).toUpperCase() + today.slice(1)],
      patients: ["Pacientes", "Gerencie os cadastros e históricos clínicos"],
      exams: ["Histórico de exames", "Consulte análises, imagens e rastreabilidade"],
      analysis: ["Nova análise", "Envio e processamento de radiografia de tórax"],
      reports: ["Laudos médicos", "Elaboração, revisão e assinatura clínica"],
      admin: ["Administração", "Usuários, permissões e auditoria de segurança"],
      settings: ["Configurações", "Perfil, segurança e parâmetros da plataforma"],
    };
  }, []);

  const content = (() => {
    if (!user) return null;
    if (view === "dashboard") return <Dashboard setView={setView} onOpenExam={setExamModal} version={version} />;
    if (view === "patients") return <Patients onOpenExam={setExamModal} version={version} />;
    if (view === "exams") return <Exams setView={setView} onOpenExam={setExamModal} version={version} />;
    if (view === "analysis") return <Analysis system={system.data} onDone={bump} openReport={openReport} />;
    if (view === "reports") return <Reports user={user} target={reportTarget} clearTarget={clearReportTarget} version={version} onChanged={bump} />;
    if (view === "admin") return user.role === "admin" ? <AdminView /> : <Dashboard setView={setView} onOpenExam={setExamModal} version={version} />;
    return <SettingsView user={user} setUser={setUser} system={system.data} setView={setView} />;
  })();

  if (resetLink) return <><Toaster position="top-right" richColors /><ResetPasswordScreen {...resetLink} onDone={() => setResetLink(null)} /></>;
  if (booting) return <div className="flex min-h-screen items-center justify-center bg-[#0d2239]"><Toaster position="top-right" richColors /><Spinner /></div>;
  if (!user) return <><Toaster position="top-right" richColors /><AuthScreen onAuthenticate={(authenticatedUser) => { setUser(authenticatedUser); setView(authenticatedUser.role === "admin" ? "admin" : "dashboard"); }} /></>;

  return (
    <div className={`${dark ? "dark" : ""} medical-app flex min-h-screen bg-background font-sans text-foreground`}>
      <style>{`
        .medical-app { background:
          radial-gradient(circle at 78% 0%, rgba(37,99,235,.055), transparent 32%),
          #f5f7fa; }
        .medical-app button, .medical-app input, .medical-app textarea, .medical-app select {
          border-radius: 10px;
        }
        .medical-app button { transition: transform .2s ease, background-color .2s ease, border-color .2s ease, box-shadow .2s ease; }
        .medical-app button:active { transform: scale(.975); }
        .medical-app main section {
          border-radius: 16px;
          box-shadow: 0 8px 28px rgba(15, 39, 67, .045);
        }
        .medical-app main section section { box-shadow: none; }
        .medical-app main input:focus, .medical-app main textarea:focus, .medical-app main select:focus {
          outline: none;
          border-color: #60a5fa;
          box-shadow: 0 0 0 4px rgba(59,130,246,.1);
        }
        .medical-app table tbody tr { transition: background-color .18s ease; }
        .medical-app header { box-shadow: 0 1px 0 rgba(15,23,42,.04); }
        .medical-app.dark { color-scheme: dark; background:#081525; color:#dce7f4; }
        .medical-app.dark .bg-white { background-color:#102033 !important; }
        .medical-app.dark .bg-slate-50, .medical-app.dark .bg-slate-50\\/80, .medical-app.dark .bg-slate-100 { background-color:#16293e !important; }
        .medical-app.dark .text-slate-900, .medical-app.dark .text-slate-800, .medical-app.dark .text-slate-700 { color:#e5edf7 !important; }
        .medical-app.dark .text-slate-600, .medical-app.dark .text-slate-500 { color:#9aabc0 !important; }
        .medical-app.dark input, .medical-app.dark textarea, .medical-app.dark select { background:#0d1d2f !important; color:#e5edf7; border-color:#2a4059; }
        .medical-app.dark .border-border { border-color:#263b52 !important; }
        .medical-app.dark header { background:#102033 !important; }
        /* Hover e estados selecionados: sem isto o fundo claro do hover fica sob texto claro */
        .medical-app.dark .hover\\:bg-slate-50:hover,
        .medical-app.dark .hover\\:bg-slate-50\\/60:hover { background-color:#1b3149 !important; }
        .medical-app.dark .hover\\:bg-slate-100:hover { background-color:#1b3149 !important; }
        .medical-app.dark .bg-blue-50\\/60 { background-color:#173452 !important; }
        .medical-app.dark .hover\\:text-blue-600:hover { color:#7db3ff !important; }
        .medical-app.dark .text-slate-400 { color:#8195ad !important; }
        .medical-app.dark .border-slate-200, .medical-app.dark .border-slate-300 { border-color:#2a4059 !important; }
        .medical-app.dark .divide-border > :not([hidden]) ~ :not([hidden]) { border-color:#263b52 !important; }
        .medical-app.dark button:disabled { opacity:.55; }
      `}</style>
      <Toaster position="top-right" richColors />
      <Sidebar view={view} setView={setView} open={menuOpen} setOpen={setMenuOpen} user={user} pending={pending} onLogout={() => setConfirmLogout(true)} />
      <main className="min-w-0 flex-1">
        <Header
          title={pageMeta[view][0]}
          subtitle={pageMeta[view][1]}
          onMenu={() => setMenuOpen(true)}
          user={user}
          dark={dark}
          service={service}
          pending={pending}
          onPending={() => (pending > 0 ? toast.info(`Você tem ${pending} laudo(s) aguardando revisão.`, { action: { label: "Ver", onClick: () => setView("reports") } }) : toast.info("Nenhum laudo pendente."))}
          onTheme={() => { const next = !dark; setDark(next); localStorage.setItem("pneumoai.theme", next ? "dark" : "light"); toast.success(`Tema ${next ? "escuro" : "claro"} ativado.`); }}
          onProfile={() => setView("settings")}
        />
        <div className="max-h-[calc(100vh-74px)] overflow-y-auto">{content}</div>
      </main>
      {examModal != null && <ExamModal examId={examModal} onClose={() => setExamModal(null)} onOpenReport={openReport} onChanged={bump} />}
      {confirmLogout && <ConfirmDialog title="Encerrar sessão?" message="Você precisará informar suas credenciais novamente para acessar pacientes, exames e laudos." confirmLabel="Sim, sair" onCancel={() => setConfirmLogout(false)} onConfirm={logout} />}
    </div>
  );
}
