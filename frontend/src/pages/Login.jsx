import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Eye, EyeOff, MessageSquare, Receipt, ShieldCheck } from 'lucide-react';
import { getMediaUrl, getTenantBySlug, login } from '../services/api';

function getMonogram(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'M';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const FEATURES = [
  { icon: MessageSquare, label: 'Atendimento e WhatsApp no mesmo painel' },
  { icon: Receipt, label: 'Cobrança, boletos e demonstrativos automáticos' },
  { icon: Activity, label: 'Indicadores e relatórios em tempo real' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [tenantError, setTenantError] = useState(false);
  const navigate = useNavigate();
  const { slug } = useParams();
  const firstPath = window.location.pathname.split('/').filter(Boolean)[0] || '';
  const routeSlug = slug || (firstPath !== 'login' ? firstPath : '') || '';

  useEffect(() => {
    if (!routeSlug) return;

    let active = true;
    setTenantError(false);
    async function loadTenant() {
      try {
        const { data } = await getTenantBySlug(routeSlug);
        const resolvedTenant = data?.tenant || data || null;
        if (active && resolvedTenant) {
          setTenantInfo({
            ...resolvedTenant,
            name: resolvedTenant.name || routeSlug || 'LCD Digital',
            slug: resolvedTenant.slug || routeSlug,
          });
        }
      } catch {
        console.error('Tenant not found');
        if (active) setTenantError(true);
      }
    }

    loadTenant();
    return () => { active = false; };
  }, [routeSlug]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await login(email, password, routeSlug);
      localStorage.setItem('token', data.token);
      localStorage.setItem('tenantId', data.tenant?.id || '');
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('role', data.user.role);
      navigate(data.user.role === 'superadmin' ? '/superadmin' : (data.user.homePage || '/dashboard'));
    } catch (err) {
      if (!err?.response) {
        setError('Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.');
      } else if (err.response.status >= 500) {
        setError('O servidor está indisponível no momento. Tente novamente em instantes.');
      } else {
        setError(err.response.data?.error || 'E-mail ou senha inválidos. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  // Login sempre usa o acento do sistema (laranja PrintGuard = --accent).
  // O primaryColor de tenant nao tematiza mais nada no app; para reativar um
  // login white-label no futuro, voltar a: tenantInfo?.primaryColor || '#FF6A00'.
  const primaryColor = '#FF6A00';
  const displayName = tenantInfo?.name || (routeSlug ? routeSlug.toUpperCase() : 'Multiatendimento');
  const hasTenant = Boolean(tenantInfo?.name);
  const year = new Date().getFullYear();

  const brandMark = tenantInfo?.logoUrl ? (
    // Logos de cliente costumam ser feitos para fundo claro -- numa placa
    // clara qualquer logo (escuro, claro ou colorido) fica legivel.
    <span style={s.brandLogoPlaque}>
      <img src={getMediaUrl(tenantInfo.logoUrl)} alt={`Logo ${tenantInfo.name}`} style={s.brandLogoImg} />
    </span>
  ) : (
    <span style={{ ...s.monogram, borderColor: `${primaryColor}59` }} aria-hidden="true">
      <span style={{ ...s.monogramAccent, background: primaryColor }} />
      <span>{getMonogram(displayName)}</span>
    </span>
  );

  return (
    <main style={{ ...s.shell, '--login-accent': primaryColor }}>
      <style>{`
        @keyframes login-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes login-drift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(3%, -4%, 0) scale(1.06); }
        }
        .login-panel-anim { animation: login-in .4s cubic-bezier(.16,1,.3,1) both; }
        .login-input:focus-visible {
          border-color: var(--login-accent) !important;
          outline: 2px solid color-mix(in srgb, var(--login-accent) 55%, transparent) !important;
          outline-offset: 1px;
        }
        .login-input::placeholder { color: #5C6879; }
        /* Autofill do Chrome pinta o fundo de branco -- forca o fundo escuro.
           Usa so box-shadow (o foco usa outline) para nao haver conflito. */
        .login-input:-webkit-autofill,
        .login-input:-webkit-autofill:hover,
        .login-input:-webkit-autofill:focus,
        .login-input:-webkit-autofill:focus-visible {
          -webkit-text-fill-color: #F4F6FA !important;
          -webkit-box-shadow: 0 0 0 1000px #161B24 inset !important;
          caret-color: #F4F6FA;
          border-color: #2A3546;
          transition: background-color 9999s ease-out 0s;
        }
        .login-submit:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
        .login-submit:active:not(:disabled) { transform: translateY(0); }
        .login-eye:hover { color: #E7ECF4 !important; }
        .login-eye:focus-visible { outline: 2px solid var(--login-accent); outline-offset: 2px; color: #E7ECF4 !important; }
        .login-brand { display: none; }
        @media (min-width: 940px) {
          .login-brand { display: flex; }
          .login-form-side { flex: 0 0 clamp(400px, 38vw, 512px) !important; border-left: 1px solid #1B2230; }
          .login-form-identity-sub { display: none; }
        }
        @media (max-width: 480px) {
          .login-form-inner { padding: 1.75rem 1.4rem !important; }
        }
      `}</style>

      {/* Painel de marca (desktop) */}
      <aside className="login-brand login-panel-anim" style={s.brand}>
        <div
          style={{
            ...s.brandGlow,
            background: `radial-gradient(circle at 30% 30%, ${primaryColor}3d 0%, transparent 62%)`,
          }}
          aria-hidden="true"
        />
        <div style={s.brandGrid} aria-hidden="true" />

        <div style={s.brandTop}>
          {brandMark}
          <span style={s.brandWordmark}>Multiatendimento <b style={{ color: primaryColor }}>PRO</b></span>
        </div>

        <div style={s.brandBody}>
          <p style={{ ...s.brandEyebrow, color: primaryColor }}>
            {hasTenant ? `Ambiente de ${tenantInfo.name}` : 'Plataforma de atendimento'}
          </p>
          <p style={s.brandHeadline}>
            Sua operação de atendimento, cobrança e relatórios num só lugar.
          </p>

          <ul style={s.brandFeatures}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} style={s.brandFeature}>
                <span style={{ ...s.brandFeatureIcon, background: `${primaryColor}1f`, color: primaryColor }}>
                  <Icon size={17} strokeWidth={2.1} />
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p style={s.brandFooter}>© {year} Multiatendimento PRO</p>
      </aside>

      {/* Painel do formulário */}
      <div className="login-form-side login-panel-anim" style={s.formSide}>
        <section className="login-form-inner" style={s.formInner} aria-labelledby="login-title">
          <div style={s.formIdentity}>
            <span style={{ ...s.monogram, borderColor: `${primaryColor}59` }} aria-hidden="true">
              <span style={{ ...s.monogramAccent, background: primaryColor }} />
              <span>{getMonogram(displayName)}</span>
            </span>
            <p style={{ ...s.eyebrow, color: primaryColor }}>Multiatendimento PRO</p>
            <h1 id="login-title" style={s.title}>{hasTenant ? displayName : 'Entrar na sua conta'}</h1>
            <p className="login-form-identity-sub" style={s.subtitle}>
              {hasTenant ? `Acesse o ambiente de ${tenantInfo.name}.` : 'Sua operação de atendimento em um só lugar.'}
            </p>
          </div>

          {tenantError ? (
            <p style={s.tenantNotice} role="alert">
              Não foi possível carregar os dados desta empresa pelo link acessado. Você ainda pode entrar abaixo.
            </p>
          ) : null}

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.inputGroup}>
              <label htmlFor="login-email" style={s.label}>E-mail corporativo</label>
              <input
                id="login-email"
                className="login-input"
                style={s.input}
                type="email"
                placeholder="nome@empresa.com.br"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div style={s.inputGroup}>
              <label htmlFor="login-password" style={s.label}>Senha</label>
              <div style={s.passwordWrapper}>
                <input
                  id="login-password"
                  className="login-input"
                  style={{ ...s.input, paddingRight: '3rem' }}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="login-eye"
                  style={s.eye}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error ? <div role="alert" style={s.error}>{error}</div> : null}

            <button
              className="login-submit"
              style={{ ...s.submit, background: primaryColor }}
              type="submit"
              disabled={loading}
              aria-busy={loading || undefined}
            >
              {loading ? <span className="ui-spinner" aria-hidden="true" /> : null}
              {loading ? 'Validando acesso…' : 'Entrar'}
            </button>
          </form>

          <p style={s.formFooter}>
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Ambiente seguro · © {year} Multiatendimento PRO</span>
          </p>
        </section>
      </div>
    </main>
  );
}

// A tela de login roda ANTES de qualquer classe de tema ser aplicada, entao
// NAO usa tokens (--bg-*, --text-*) -- eles cairiam no tema claro do SO do
// visitante. E um design escuro fixo (grafite + laranja), pintado na mao.
const INK = '#0B0D12';
const INK_2 = '#0E121A';
const PANEL = '#161B24';
const LINE = '#232C3A';
const TEXT = '#F4F6FA';

const s = {
  shell: {
    display: 'flex',
    minHeight: '100dvh',
    background: INK,
    fontFamily: 'var(--font-main)',
    color: TEXT,
    overflow: 'hidden',
  },

  /* ---- Brand panel ---- */
  brand: {
    flex: 1,
    position: 'relative',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: '2rem',
    padding: 'clamp(2.5rem, 5vw, 4.5rem)',
    overflow: 'hidden',
    background:
      'radial-gradient(90% 75% at 0% 0%, rgba(255,106,0,0.16) 0%, transparent 55%), '
      + 'radial-gradient(120% 120% at 100% 100%, rgba(255,255,255,0.035) 0%, transparent 55%), '
      + `linear-gradient(160deg, ${INK_2} 0%, ${INK} 62%)`,
    borderRight: `1px solid ${LINE}`,
  },
  brandGlow: {
    position: 'absolute',
    width: 'min(680px, 60vw)',
    aspectRatio: '1',
    top: '-14%',
    left: '-10%',
    pointerEvents: 'none',
    filter: 'blur(8px)',
    animation: 'login-drift 22s ease-in-out infinite',
  },
  brandGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)',
    backgroundSize: '52px 52px',
    maskImage: 'radial-gradient(120% 90% at 20% 10%, #000 0%, transparent 75%)',
    WebkitMaskImage: 'radial-gradient(120% 90% at 20% 10%, #000 0%, transparent 75%)',
    pointerEvents: 'none',
  },
  brandTop: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
  },
  brandWordmark: {
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#E7ECF4',
  },
  brandLogoPlaque: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 20px',
    background: '#FFFFFF',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.32)',
  },
  brandLogoImg: { height: '44px', maxWidth: '210px', objectFit: 'contain', display: 'block' },
  brandBody: { position: 'relative', maxWidth: '30rem' },
  brandEyebrow: {
    margin: '0 0 1rem',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
  brandHeadline: {
    margin: 0,
    fontSize: 'clamp(1.9rem, 3vw, 2.7rem)',
    lineHeight: 1.12,
    fontWeight: 700,
    letterSpacing: '-0.035em',
    color: '#F7F9FC',
    textWrap: 'balance',
  },
  brandFeatures: {
    listStyle: 'none',
    margin: '2.25rem 0 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  brandFeature: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    fontSize: '0.95rem',
    color: '#C6CFDD',
  },
  brandFeatureIcon: {
    flexShrink: 0,
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandFooter: {
    position: 'relative',
    margin: 0,
    fontSize: '0.75rem',
    color: '#69768B',
  },

  /* ---- Form panel ---- */
  formSide: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(1.25rem, 4vw, 3rem)',
    background: '#0C0F16',
  },
  formInner: {
    width: '100%',
    maxWidth: '384px',
    padding: '0.5rem',
  },
  formIdentity: { textAlign: 'left', marginBottom: '1.9rem' },
  monogram: {
    width: '48px',
    height: '48px',
    marginBottom: '1.1rem',
    borderRadius: '13px',
    background: PANEL,
    border: '1px solid',
    color: TEXT,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    fontSize: '1.05rem',
    fontWeight: 700,
    letterSpacing: '-0.04em',
  },
  monogramAccent: { position: 'absolute', inset: '0 auto 0 0', width: '3px' },
  eyebrow: {
    margin: '0 0 0.5rem',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: '1.6rem',
    lineHeight: 1.15,
    fontWeight: 700,
    color: '#F7F9FC',
    letterSpacing: '-0.035em',
    margin: 0,
  },
  subtitle: {
    color: '#9BA6B7',
    fontSize: '0.9rem',
    lineHeight: 1.5,
    margin: '0.55rem 0 0',
  },
  tenantNotice: {
    color: '#F0C574',
    background: 'rgba(230, 170, 60, 0.10)',
    border: '1px solid rgba(230, 170, 60, 0.28)',
    borderRadius: '10px',
    fontSize: '0.78rem',
    lineHeight: 1.45,
    margin: '0 0 1.25rem',
    padding: '0.6rem 0.8rem',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1.15rem' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.76rem', fontWeight: 600, color: '#9BA6B7', letterSpacing: '0.01em' },
  input: {
    minHeight: '48px',
    padding: '0.75rem 0.95rem',
    background: PANEL,
    border: `1px solid ${LINE}`,
    borderRadius: '11px',
    fontSize: '0.95rem',
    color: TEXT,
    outline: 'none',
    transition: 'border-color 0.16s ease, box-shadow 0.16s ease',
    width: '100%',
    boxSizing: 'border-box',
  },
  passwordWrapper: { position: 'relative', display: 'flex' },
  eye: {
    position: 'absolute',
    top: '50%',
    right: '0.4rem',
    transform: 'translateY(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: '#7C899E',
    cursor: 'pointer',
    transition: 'color 0.16s ease',
  },
  submit: {
    minHeight: '50px',
    marginTop: '0.35rem',
    padding: '0.75rem 1rem',
    color: '#241200',
    border: 'none',
    borderRadius: '11px',
    fontSize: '0.92rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'transform 0.16s ease, filter 0.16s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    boxShadow: '0 12px 30px rgba(255, 106, 0, 0.28)',
  },
  error: {
    color: '#FF9B9B',
    fontSize: '0.86rem',
    lineHeight: 1.45,
    background: 'rgba(224, 78, 78, 0.12)',
    padding: '0.7rem 0.85rem',
    borderRadius: '10px',
    border: '1px solid rgba(224, 78, 78, 0.32)',
  },
  formFooter: {
    marginTop: '1.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.75rem',
    color: '#69768B',
  },
};
