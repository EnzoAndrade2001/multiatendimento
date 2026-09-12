import React, { useEffect, useId, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function ModalShell({
  kicker,
  title,
  children,
  onClose,
  maxWidth = '34rem',
  closeLabel = 'Fechar janela',
  closeOnBackdrop = false,
  style,
  contentStyle,
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector(focusableSelector);
    (firstFocusable || dialog)?.focus({ preventScroll: true });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      style={s.overlay}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ ...s.modal, maxWidth, ...style }}
      >
        <div style={s.header}>
          <div style={s.headingGroup}>
            {kicker ? <p style={s.kicker}>{kicker}</p> : null}
            <h3 id={titleId} style={s.title}>{title}</h3>
          </div>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div style={{ ...s.content, ...contentStyle }}>{children}</div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(3, 5, 9, 0.76)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 3000,
    backdropFilter: 'blur(8px)',
    padding: 'clamp(0.75rem, 2vw, 1.5rem)',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  modal: {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-lg)',
    width: '100%',
    maxHeight: 'calc(100dvh - clamp(1.5rem, 4vw, 3rem))',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    margin: 'auto 0',
    outline: 'none',
  },
  header: {
    padding: 'var(--space-5) var(--space-6)',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
    flexShrink: 0,
  },
  headingGroup: { minWidth: 0 },
  kicker: {
    margin: '0 0 var(--space-1)',
    color: 'var(--accent)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  title: {
    margin: 0,
    fontSize: 'var(--text-lg)',
    lineHeight: 'var(--leading-tight)',
    fontWeight: 700,
    color: 'var(--text-main)',
  },
  closeBtn: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    width: '38px',
    height: '38px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '1.35rem',
    lineHeight: 1,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
  },
};
