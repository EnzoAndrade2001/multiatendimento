import React, { useEffect, useState } from 'react';
import { getMediaUrl } from '../../services/api';

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

/** Avatar de usuário com fallback acessível para a inicial do nome. */
export default function UserAvatar({ user, name, size = 32, style = {}, alt, ...props }) {
  const [imageError, setImageError] = useState(false);
  const avatarUrl = user?.avatarUrl;
  const label = name || user?.name || '';

  useEffect(() => {
    // Permite trocar/remover a foto sem precisar desmontar o componente.
    setImageError(false);
  }, [avatarUrl]);
  const baseStyle = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontWeight: 900,
    lineHeight: 1,
    ...style,
  };

  return (
    <span style={baseStyle} role="img" aria-label={alt || `Foto de ${label || 'usuário'}`} {...props}>
      {avatarUrl && !imageError ? (
        <img
          src={getMediaUrl(avatarUrl)}
          alt={alt || label || 'Usuário'}
          onError={() => setImageError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : initials(label)}
    </span>
  );
}
