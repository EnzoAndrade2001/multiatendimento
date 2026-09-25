import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import SupportLayout from './components/SupportLayout';
import api from './services/api';
import AuthSpecPage from './pages/AuthSpecPage';
import Forbidden from './components/Forbidden';
import { PermissionProvider, usePermissions } from './auth/PermissionContext';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inbox = lazy(() => import('./pages/Inbox'));
const MockInbox = lazy(() => import('./pages/MockInbox'));
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
// Interceptor global para tratar erros de autenticacao (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error.config?.url || '');
    const isAuthenticationAttempt = /\/auth\/(login|support-login)(?:\?|$)/.test(requestUrl);
    if (error.response?.status === 401 && !isAuthenticationAttempt) {
      localStorage.clear();
      window.location.href = window.location.pathname.startsWith('/suporte') ? '/suporte/login' : '/login';
    }
    return Promise.reject(error);
  }
);

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  if (localStorage.getItem('role') === 'superadmin' && !localStorage.getItem('supportMasterToken')) return <Navigate to="/suporte" replace />;
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

function SupportPrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (!token) return <Navigate to="/suporte/login" replace />;
  return role === 'superadmin' ? children : <Navigate to="/login" replace />;
}

function RequireFeature({ feature, children }) {
  const { hasFeature, loading } = usePermissions();
  if (loading) return <RouteFallback />;
  return hasFeature(feature) ? children : <Forbidden />;
}

function RequireAccess({ permission, feature, children }) {
  return <RequirePermission permission={permission}><RequireFeature feature={feature}>{children}</RequireFeature></RequirePermission>;
}

function HiddenModuleRoute() {
  return <Navigate to="/dashboard" replace />;
}

function LocalMockRoute() {
  const enabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_UI === 'true';
  return enabled ? <MockInbox /> : <Navigate to="/login" replace />;
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
          <Route path="/suporte/login" element={<Login supportPortal />} />
          <Route path="/:slug/login" element={<Login />} />
          <Route path="/validation/auth-spec" element={<AuthSpecPage />} />
          <Route path="/__mock/inbox" element={<LocalMockRoute />} />

          <Route
            element={(
              <PrivateRoute>
                <PermissionProvider><Layout /></PermissionProvider>
              </PrivateRoute>
            )}
          >
            <Route path="/dashboard" element={<RequireAccess permission="dashboard.view" feature="dashboard"><Dashboard /></RequireAccess>} />
            <Route index element={<RequireAccess permission="dashboard.view" feature="dashboard"><Dashboard /></RequireAccess>} />
            <Route path="/inbox" element={<RequireAccess permission="inbox.view" feature="inbox"><Inbox /></RequireAccess>} />
            <Route path="/tasks" element={<HiddenModuleRoute />} />
            <Route path="/contacts" element={<RequireAccess permission="crm.view" feature="contacts"><Contacts /></RequireAccess>} />
            <Route path="/crm" element={<RequireAccess permission="crm.view" feature="crm"><CRM /></RequireAccess>} />
            <Route path="/assistente-ilux" element={<HiddenModuleRoute />} />
            <Route path="/users" element={<RequirePermission permission="users.manage"><Users /></RequirePermission>} />
            <Route path="/teams" element={<RequirePermission permission="teams.manage"><Teams /></RequirePermission>} />
              <Route path="/settings" element={<RequireFeature feature="settings"><Settings /></RequireFeature>} />
              <Route path="/connections" element={<RequireAccess permission="connections.manage" feature="connections"><Connections /></RequireAccess>} />
            <Route path="/knowledge" element={<RequireAccess permission="settings.bot.manage" feature="ai_knowledge"><KnowledgeBase /></RequireAccess>} />
            <Route path="/campaigns" element={<RequireAccess permission="campaigns.manage" feature="campaigns"><Campaigns /></RequireAccess>} />
            <Route path="/os" element={<Navigate to="/inbox" replace />} />
              <Route path="/quick-responses" element={<RequireAccess permission="quick_responses.manage" feature="quick_responses"><QuickResponses /></RequireAccess>} />
            <Route path="/superadmin" element={<Navigate to="/suporte" replace />} />
            <Route path="/leads" element={<HiddenModuleRoute />} />
            <Route path="/revenue" element={<HiddenModuleRoute />} />
            <Route path="/billing-reports" element={<HiddenModuleRoute />} />
            <Route path="/privacy" element={<HiddenModuleRoute />} />
            <Route path="/audit" element={<HiddenModuleRoute />} />
            <Route path="/telemetry" element={<HiddenModuleRoute />} />
          </Route>

          <Route element={<SupportPrivateRoute><SupportLayout /></SupportPrivateRoute>}>
            <Route path="/suporte" element={<SuperAdmin />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  </BrowserRouter>
);
