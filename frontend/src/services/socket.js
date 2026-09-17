import { BACKEND_URL } from './api';

// Nunca deixar undefined: socket.io(undefined) conecta no origin da página (frontend), causando erro 400.
export const SOCKET_URL = BACKEND_URL;
