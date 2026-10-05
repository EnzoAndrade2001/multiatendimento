import { BACKEND_URL } from './api';

// Helper centralizado para Socket.IO
// Em produção conecta diretamente ao backend
// Em desenvolvimento usa o proxy do Vite
export const SOCKET_URL = BACKEND_URL || undefined;
