// Helper centralizado para Socket.IO
// Em produção conecta diretamente ao backend
// Em desenvolvimento usa o proxy do Vite

const DEFAULT_PRODUCTION_SOCKET_URL = 'https://lcddigitalweb-multiatendimento-nova-backend.kna79u.easypanel.host';
const isProductionCrm = typeof window !== 'undefined' && window.location.hostname === 'crm.lcddigital.com.br';

export const SOCKET_URL = import.meta.env.VITE_API_URL
  || (isProductionCrm ? DEFAULT_PRODUCTION_SOCKET_URL : undefined);
// undefined = conecta no mesmo host (proxy do Vite funciona no dev)
