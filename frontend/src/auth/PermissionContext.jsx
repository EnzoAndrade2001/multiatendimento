import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentEntitlements, getMe } from '../services/api';
import { ACCESS_PROFILES, permissionsForUser } from './permissions';
import { normalizeEntitlements } from './features';

const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [entitlements, setEntitlements] = useState(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await getMe();
        if (!active) return;
        setUser(data);
        if (data?.entitlements) setEntitlements(normalizeEntitlements(data.entitlements));
        else {
          try {
            const result = await getCurrentEntitlements();
            if (active) setEntitlements(normalizeEntitlements(result.data));
          } catch { if (active) setEntitlements(null); }
        }
      } catch { /* interceptor trata sessao expirada */ }
      finally { if (active) setLoading(false); }
    };
    refresh();
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const value = useMemo(() => {
    const permissions = permissionsForUser(user || {});
    const role = String(user?.role || localStorage.getItem('role') || 'agent').toLowerCase();
    const profile = user?.accessProfile || user?.profile || role;
    const roleCan = (permission) => role === 'superadmin' || permissions.has(permission);
    const hasFeature = (feature) => role === 'superadmin' || !feature || entitlements == null || entitlements.features.has(feature);
    return {
      user,
      loading,
      profile,
      permissions,
      entitlements,
      hasFeature,
      can: roleCan,
      homePage: user?.homePage || ACCESS_PROFILES[profile]?.homePage || '/inbox',
    };
  }, [user, loading]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) throw new Error('usePermissions deve ser usado dentro de PermissionProvider');
  return context;
}
