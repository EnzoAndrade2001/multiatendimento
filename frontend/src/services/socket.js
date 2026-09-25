// Helper centralizado para Socket.IO
// Em produção conecta diretamente ao backend
// Em desenvolvimento usa o proxy do Vite

import { BACKEND_URL } from './api';

export const SOCKET_URL = BACKEND_URL || undefined;
// undefined = conecta no mesmo host (proxy do Vite funciona no dev)
