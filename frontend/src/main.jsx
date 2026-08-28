import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import api from './services/api';
import AuthSpecPage from './pages/AuthSpecPage';
import Forbidden from './components/Forbidden';
import { PermissionProvider, usePermissions } from './auth/PermissionContext';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Contacts = lazy(() => import('./pages/Contacts'));
const CRM = lazy(() => import('./pages/CRM'));
const Users = lazy(() => import('./pages/Users'));
const Teams = lazy(() => import('./pages/Teams'));
const Settings = lazy(() => import('./pages/Settings'));
const Connections = lazy(() => import('./pages/Connections'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const QuickResponses = lazy(() => import('./pages/QuickResponses'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const LeadScraper = lazy(() => import('./pages/LeadScraper'));
const RevGuard = lazy(() => import('./pages/RevGuard'));
const BillingReports = lazy(() => import('./pages/BillingReports'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Audit = lazy(() => import('./pages/Audit'));
// Interceptor global para tratar erros de autenticacao (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function RequirePermission({ permission, children }) {
  const { can, loading } = usePermissions();
  if (loading) return <RouteFallback />;
  return can(permission) ? children : <Forbidden />;
}

function RequireRole({ role, children }) {
  const currentRole = String(localStorage.getItem('role') || '').toLowerCase();
  return currentRole === role ? children : <Forbidden />;
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)',
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}
    >
      Carregando...
    </div>
  );
}

async function hardReloadApplication() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if (window.caches?.keys) {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    }
  } catch (error) {
    console.warn('[frontend] falha ao limpar cache de recuperacao:', error);
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.set('__reload', Date.now().toString());
    window.location.replace(url.toString());
  }
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[frontend] erro de renderizacao:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-base)',
            color: 'var(--text-main)',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: 0 }}>Nao foi possivel carregar esta tela</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: '28rem' }}>
            Atualize a pagina para carregar a versao mais recente do sistema.
          </p>
          <button
            type="button"
            onClick={hardReloadApplication}
            style={{
              background: 'var(--accent)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: '12px',
              padding: '0.85rem 1.2rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Atualizar agora
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/:slug/login" element={<Login />} />
          <Route path="/validation/auth-spec" element={<AuthSpecPage />} />

          <Route
            element={(
              <PrivateRoute>
                <PermissionProvider><Layout /></PermissionProvider>
              </PrivateRoute>
            )}
          >
            <Route path="/dashboard" element={<RequirePermission permission="dashboard.view"><Dashboard /></RequirePermission>} />
            <Route index element={<RequirePermission permission="dashboard.view"><Dashboard /></RequirePermission>} />
            <Route path="/inbox" element={<RequirePermission permission="inbox.view"><Inbox /></RequirePermission>} />
            <Route path="/contacts" element={<RequirePermission permission="crm.view"><Contacts /></RequirePermission>} />
            <Route path="/crm" element={<RequirePermission permission="crm.view"><CRM /></RequirePermission>} />
            <Route path="/users" element={<RequirePermission permission="users.manage"><Users /></RequirePermission>} />
            <Route path="/teams" element={<RequirePermission permission="teams.manage"><Teams /></RequirePermission>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/connections" element={<RequirePermission permission="connections.manage"><Connections /></RequirePermission>} />
            <Route path="/knowledge" element={<RequirePermission permission="settings.bot.manage"><KnowledgeBase /></RequirePermission>} />
            <Route path="/campaigns" element={<RequirePermission permission="campaigns.manage"><Campaigns /></RequirePermission>} />
            <Route path="/os" element={<Navigate to="/inbox" replace />} />
            <Route path="/quick-responses" element={<RequirePermission permission="quick_responses.manage"><QuickResponses /></RequirePermission>} />
            <Route path="/superadmin" element={<RequireRole role="superadmin"><SuperAdmin /></RequireRole>} />
            <Route path="/leads" element={<RequirePermission permission="leads.manage"><LeadScraper /></RequirePermission>} />
            <Route path="/revenue" element={<RequirePermission permission="revenue.view"><RevGuard /></RequirePermission>} />
            <Route path="/billing-reports" element={<RequirePermission permission="billing.view"><BillingReports /></RequirePermission>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/audit" element={<RequirePermission permission="audit.view"><Audit /></RequirePermission>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  </BrowserRouter>
);
