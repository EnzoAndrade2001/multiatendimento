import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api, {
  updateContact,
  getContactMedia,
  updateTicket,
  getTags,
  getMediaUrl,
  getEquipments,
  getContacts,
} from '../../services/api';
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  CheckCheck,
  ClipboardList,
  Download,
  FileText,
  Mic,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Search,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  X,
  Lock,
  User,
  Users,
  Pin,
  PinOff,
  Mail,
  Smile,
  LoaderCircle,
  Play,
} from 'lucide-react';
import { toast } from '../../utils/toast';
import { Empty, fmt, statusColor, statusLabel } from './helpers.jsx';
import ContactProfileModal from '../../components/ContactProfileModal';

function getSafeTags(rawTags) {
  if (!rawTags) return [];

  try {
    const parsed = JSON.parse(rawTags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getInstanceLabel(ticket) {
  const rawName = getSafeText(ticket?.instance?.instanceName);
  if (!rawName) return 'Sem instância';

  const parts = rawName.split('_');
  return parts[parts.length - 1] || rawName;
}

// 5551998765432 -> "+55 51 99876-5432". Tolera entrada ja formatada, DDI ausente,
// fixo de 8 digitos. Sempre exibir com var(--font-mono) + tabular-nums.
function formatPhone(raw) {
  const digits = getSafeText(raw).replace(/\D/g, '');
  if (!digits) return getSafeText(raw);

  let rest = digits;
  let ddi = '';
  if (rest.length > 11 && rest.startsWith('55')) {
    ddi = '+55 ';
    rest = rest.slice(2);
  }

  if (rest.length === 11) return `${ddi}${rest.slice(0, 2)} ${rest.slice(2, 7)}-${rest.slice(7)}`;
  if (rest.length === 10) return `${ddi}${rest.slice(0, 2)} ${rest.slice(2, 6)}-${rest.slice(6)}`;
  if (rest.length === 9) return `${ddi}${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `${ddi}${rest.slice(0, 4)}-${rest.slice(4)}`;
  return ddi ? `${ddi}${rest}` : getSafeText(raw);
}

// Nº da ficha para o "canhoto" do cavalete: usa o número real do ticket quando
// existir; senão deriva 4 dígitos estáveis do id (o backend local não numera).
function getDocketNumber(ticket) {
  const explicit = ticket?.number ?? ticket?.protocol ?? ticket?.seq;
  if (explicit != null && String(explicit).trim()) return `#${String(explicit).trim()}`;
  const id = String(ticket?.id || '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `#${String(Math.abs(hash) % 10000).padStart(4, '0')}`;
}

function getSafeText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return fallback;

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function getSafeLowerText(value) {
  return getSafeText(value).toLowerCase();
}

function getContactDisplayName(contact, fallback = 'Desconhecido') {
  return getSafeText(contact?.name) || getSafeText(contact?.phone) || fallback;
}

function getContactPhone(contact, fallback = '') {
  return getSafeText(contact?.phone, fallback);
}

function getEquipmentDisplayName(equipment) {
  const manufacturer = getSafeText(equipment?.manufacturer);
  const model = getSafeText(equipment?.model, 'Equipamento');
  return manufacturer && model.toLowerCase().startsWith(manufacturer.toLowerCase())
    ? model
    : manufacturer
      ? `${manufacturer} ${model}`
      : model;
}

function formatTicketTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();
  return isSameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function getTicketActivityAt(ticket) {
  return new Date(ticket?.lastMessageAt || ticket?.updatedAt || ticket?.createdAt || 0).getTime();
}

function formatElapsed(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60 ? `${minutes % 60}min` : ''}`.trim();
  return `${Math.floor(hours / 24)}d`;
}

function isAwaitingCustomer(ticket) {
  if (ticket?.status !== 'open' || !ticket?.lastMessageAt || !ticket?.lastCustomerMessageAt) return false;
  return new Date(ticket.lastMessageAt).getTime() > new Date(ticket.lastCustomerMessageAt).getTime() + 1000;
}

function getSlaMeta(ticket, now = Date.now()) {
  if (!ticket?.slaDueAt || ticket?.status === 'resolved') return null;
  const dueAt = new Date(ticket.slaDueAt).getTime();
  if (!Number.isFinite(dueAt)) return null;
  const remainingMinutes = Math.ceil((dueAt - now) / 60000);
  if (remainingMinutes <= 0) return { label: `SLA vencido ${formatElapsed(dueAt, now)}`, tone: 'danger', value: remainingMinutes };
  if (remainingMinutes <= 60) return { label: `SLA em ${remainingMinutes} min`, tone: 'warning', value: remainingMinutes };
  return { label: `SLA em ${formatElapsed(now - remainingMinutes * 60000, now)}`, tone: 'ok', value: remainingMinutes };
}

function getPriorityMeta(priority) {
  const priorityMap = {
    urgent: {
      label: 'Urgente',
      background: 'var(--danger-light)',
      color: 'var(--danger)',
      border: '1px solid var(--danger-light)',
    },
    high: {
      label: 'Alta',
      background: 'var(--warning-light)',
      color: 'var(--warning)',
      border: '1px solid var(--warning-light)',
    },
    medium: {
      label: 'Normal',
      background: 'var(--accent-light)',
      color: 'var(--accent)',
      border: '1px solid var(--accent-border)',
    },
    low: {
      label: 'Baixa',
      background: 'var(--info-light)',
      color: 'var(--info)',
      border: '1px solid var(--info-border)',
    },
  };

  return priorityMap[priority] || null;
}

function getStatusMeta(status) {
  const statusMap = {
    pending: {
      label: 'Aguardando equipe',
      color: 'var(--warning)',
      background: 'var(--warning-light)',
      border: '1px solid var(--warning-light)',
    },
    bot: {
      label: 'Bot em atendimento',
      color: 'var(--warning)',
      background: 'var(--warning-light)',
      border: '1px solid var(--warning-light)',
    },
    open: {
      label: 'Em atendimento',
      color: 'var(--success)',
      background: 'var(--success-light)',
      border: '1px solid var(--success-border)',
    },
    resolved: {
      label: 'Encerrado',
      color: 'var(--text-dim)',
      background: 'var(--border-light)',
      border: '1px solid var(--border-color)',
    },
  };
  return statusMap[status] || {
    label: status,
    color: 'var(--text-dim)',
    background: 'var(--border-light)',
    border: '1px solid var(--border-color)',
  };
}

async function copyText(text, successMessage = 'Copiado com sucesso') {
  const value = getSafeText(text).trim();
  if (!value) {
    toast.info('Nada para copiar');
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error('Nao foi possivel copiar');
  }
}

class MessageRenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro desconhecido',
    };
  }

  componentDidCatch(error) {
    console.error('[inbox] erro ao renderizar mensagem:', this.props.messageId, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
          <div
            style={{
              background: 'var(--warning-light)',
              color: 'var(--warning)',
              fontSize: '0.85rem',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--warning-light)',
              fontWeight: 700,
              lineHeight: 1.4,
              textAlign: 'center',
              maxWidth: 'min(92%, 640px)',
            }}
          >
            Uma mensagem deste historico nao pode ser exibida, mas a conversa continua disponivel.
            <div style={{ marginTop: '0.35rem', fontSize: '0.78rem', fontWeight: 600, opacity: 0.92 }}>
              {this.state.errorMessage}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function Avatar({ name, src, size = 40 }) {
  const safeName = getSafeText(name, '?');
  const [hasError, setHasError] = useState(false);
  const resolvedSrc = !hasError ? getMediaUrl(src) : '';

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const base = { width: size, height: size, borderRadius: '12px', flexShrink: 0, objectFit: 'cover' };
  if (resolvedSrc) {
    return <img src={resolvedSrc} alt={safeName} style={base} onError={() => setHasError(true)} />;
  }

  const initials = safeName.split(' ').map((item) => item[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div
      style={{
        ...base,
        background: 'var(--accent-light)',
        color: 'var(--accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.4,
      }}
    >
      {initials}
    </div>
  );
}

function AudioPlayer({ src, fromMe, transcription, styles }) {
  const transcriptionText = getSafeText(transcription);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <audio controls style={{ height: 32, maxWidth: 200, filter: fromMe ? 'invert(1) hue-rotate(180deg)' : 'none' }}>
        <source src={src} type="audio/ogg; codecs=opus" />
        <source src={src} type="audio/mpeg" />
      </audio>
      {transcriptionText ? (
        <div
          style={{
            ...styles.transcription,
            borderLeft: `2px solid ${fromMe ? '#000' : 'var(--accent)'}`,
            color: fromMe ? 'rgba(0,0,0,0.6)' : 'var(--text-muted)',
          }}
        >
          {transcriptionText}
        </div>
      ) : null}
    </div>
  );
}

function getFileExtensionFromMime(type) {
  const fallback = 'bin';
  if (!type) return fallback;

  const mapped = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };

  return mapped[type] || type.split('/')[1] || fallback;
}

function ensureDraftFile(file, prefix = 'anexo') {
  if (!(file instanceof File)) return null;
  if (file.name) return file;

  const extension = getFileExtensionFromMime(file.type);
  return new File([file], `${prefix}-${Date.now()}.${extension}`, {
    type: file.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

// O endpoint de mÃ­dia usa o limite padrÃ£o de 20 MB do upload. Validar aqui
// evita limpar o rascunho e sÃ³ descobrir o problema depois do request.
const MAX_DRAFT_FILE_SIZE = 20 * 1024 * 1024;
const MAX_DRAFT_FILES = 10;

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return 'sem tamanho';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getDraftFileMeta(file) {
  const name = getSafeText(file?.name, 'Arquivo');
  const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'ARQ';

  if (file?.type?.startsWith('image/')) {
    return { badge: 'IMG', label: 'Imagem' };
  }

  if (extension === 'PDF') {
    return { badge: 'PDF', label: 'Documento PDF' };
  }

  return { badge: extension.slice(0, 3) || 'ARQ', label: 'Documento' };
}

function DraftAttachmentPreview({ file, onRemove, styles }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!file?.type?.startsWith('image/')) {
      setPreviewUrl('');
      return undefined;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  const meta = getDraftFileMeta(file);

  return (
    <div style={styles.draftAttachmentCard}>
      {previewUrl ? (
        <img src={previewUrl} alt={getSafeText(file?.name, 'Imagem')} style={styles.draftAttachmentThumb} />
      ) : (
        <div style={styles.draftAttachmentBadge}>{meta.badge}</div>
      )}

      <div style={styles.draftAttachmentInfo}>
        {file?.type?.startsWith('image/') ? null : (
          <div style={styles.draftAttachmentName}>{getSafeText(file?.name, 'Arquivo')}</div>
        )}
        <div style={styles.draftAttachmentMeta}>
          {meta.label} - {formatFileSize(file?.size)}
        </div>
      </div>

      <button type="button" onClick={onRemove} style={styles.draftAttachmentRemove} title="Remover anexo">
        <X size={14} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function triggerMediaDownload(url, fileName = '') {
  if (!url) return;
  // A mesma ação funciona para arquivos locais e para URLs servidas pelo
  // backend. Em origens externas o navegador pode ignorar `download`, mas
  // ainda abre o documento em uma nova aba como fallback.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (fileName) anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// Texto longo colapsado com "Ler mais", no espírito do WhatsApp.
const READ_MORE_LIMIT = 520;
function MessageBody({ text, fromMe, styles }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > READ_MORE_LIMIT + 40;
  const shown = expanded || !long
    ? text
    : `${text.slice(0, READ_MORE_LIMIT).replace(/\s+\S*$/, '')}… `;
  return (
    <div style={{ ...styles.messageText, fontWeight: fromMe ? 500 : 400 }}>
      {shown}
      {long ? (
        <button type="button" className="inbox-readmore" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Ler menos' : 'Ler mais'}
        </button>
      ) : null}
    </div>
  );
}

// Vídeo com capa + botão de play + duração, em vez do <video controls> cru.
function VideoMessage({ src, poster, styles }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState('');
  return (
    <div style={styles.videoWrap}>
      <video
        ref={ref}
        src={src}
        poster={poster || undefined}
        preload="metadata"
        style={styles.videoEl}
        controls={playing}
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(`${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={() => { if (!playing) ref.current?.play(); }}
      />
      {!playing ? (
        <button type="button" style={styles.videoPlay} aria-label="Reproduzir vídeo" onClick={() => ref.current?.play()}>
          <Play size={22} fill="currentColor" strokeWidth={0} />
        </button>
      ) : null}
      {duration && !playing ? <span style={styles.videoDur}>{duration}</span> : null}
    </div>
  );
}

function PdfPreview({ src, fileName, styles }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBlobUrl('');
    setFailed(false);

    fetch(src, { signal: controller.signal, credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        const nextUrl = URL.createObjectURL(blob);
        blobUrlRef.current = nextUrl;
        setBlobUrl(nextUrl);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setFailed(true);
      });

    return () => {
      active = false;
      controller.abort();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    };
  }, [src]);

  if (blobUrl) {
    return (
      <iframe
        src={`${blobUrl}#page=1&view=FitH&toolbar=0&navpanes=0`}
        title={`Prévia de ${fileName}`}
        style={styles.pdfPreviewFrame}
      />
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)' }}>
      <FileText size={34} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
      <strong style={{ fontSize: '0.78rem', color: 'var(--ink)' }}>{failed ? 'Prévia indisponível' : 'Carregando prévia…'}</strong>
      {failed ? <span style={{ fontSize: '0.7rem' }}>Use o botão abaixo para abrir o PDF.</span> : null}
    </div>
  );
}

export function MediaContent({ message, onImageClick, styles }) {
  const url = getMediaUrl(message.mediaUrl);
  const fileName = getSafeText(message.fileName, 'Arquivo');

  if (!url && message.mediaStatus === 'failed' && message.mediaType && message.mediaType !== 'text') {
    return (
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--danger-light)',
          borderRadius: 'var(--radius-sm)',
          border: '1px dashed var(--danger)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.8rem',
          color: 'var(--danger)',
        }}
      >
        Mídia indisponível
      </div>
    );
  }

  if (!url && message.mediaType && message.mediaType !== 'text' && ['image', 'video', 'audio', 'document', 'sticker'].includes(message.mediaType)) {
    return (
      <div
        style={{
          padding: '1rem',
          background: 'var(--accent-light)',
          borderRadius: '8px',
          border: '1px dashed var(--accent-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.85rem',
          color: 'var(--accent)',
        }}
      >
        Baixando mídia do WhatsApp...
      </div>
    );
  }

  if (url && message.mediaType === 'image') {
    return (
      <div style={styles.attachmentCard}>
        <div style={styles.attachmentPreviewWrap}>
          <img src={url} alt="Imagem" style={styles.attachmentPreviewImage} onClick={() => onImageClick(url)} />
          {message.fileName ? (
            <button type="button" style={styles.attachmentImageDownload} onClick={() => triggerMediaDownload(url, fileName)} title="Baixar imagem" aria-label="Baixar imagem">
              <Download size={15} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (url && message.mediaType === 'video') {
    return <VideoMessage src={url} poster={getMediaUrl(message.thumbnailUrl || message.previewUrl || '')} styles={styles} />;
  }
  if (url && message.mediaType === 'audio') return <AudioPlayer src={url} fromMe={message.fromMe} transcription={message.transcription} styles={styles} />;
  if (url && message.mediaType === 'sticker') return <img src={url} alt="" style={{ maxWidth: 150, borderRadius: 8 }} />;
  if (url && message.mediaType === 'document') {
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '360px' }}>
        {isPdf ? (
          <div style={styles.pdfPreviewWrap} aria-label="Prévia do documento PDF">
            <PdfPreview src={url} fileName={fileName} styles={styles} />
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={20} strokeWidth={2.1} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{isPdf ? 'Documento PDF' : 'Arquivo'}</div>
          </div>
          <button type="button" onClick={() => triggerMediaDownload(url, fileName)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="Baixar" aria-label={`Baixar ${fileName}`}>
            <Download size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    );
  }
  return null;
}

export function ContactPanel({ ticket, onClose, onUpdate, onImageClick, isMobile, isCompactDesktop, onLinkCRM, onUnlinkCRM, onOpenCRM, styles }) {
  const contact = ticket.contact;
  const contactName = getContactDisplayName(contact);
  const contactPhone = getContactPhone(contact);
  const [notes, setNotes] = useState(contact.notes || '');
  const [city, setCity] = useState(contact.city || '');
  const [state, setState] = useState(contact.state || '');
  const [enableWhatsAppBilling, setEnableWhatsAppBilling] = useState(contact.enableWhatsAppBilling || false);
  const [priority, setPriority] = useState(ticket.priority || 'medium');
  const [tags, setTags] = useState(() => {
    try {
      return JSON.parse(contact.tags || '[]');
    } catch {
      return [];
    }
  });
  const [media, setMedia] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [linkedCrm, setLinkedCrm] = useState(null);
  const [panelTab, setPanelTab] = useState('overview');
  const [profileModal, setProfileModal] = useState(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(contact.name || '');
  const statusMeta = getStatusMeta(ticket.status);
  const priorityMeta = getPriorityMeta(priority);

  async function loadPanelContext() {
    try {
      const [mediaResponse, tagsResponse, equipmentResponse] = await Promise.all([
        getContactMedia(contact.id),
        getTags(),
        getEquipments(contact.id),
      ]);

      setMedia(mediaResponse.data || []);
      setAvailableTags(tagsResponse.data || []);
      setEquipments(equipmentResponse.data || []);
    } catch {
      // noop
    }

    setLinkedCrm(contact.crmCustomer || null);
  }

  useEffect(() => {
    loadPanelContext();
  }, [contact.id, contactPhone, contact.crmCustomer]);

  useEffect(() => {
    setPanelTab('overview');
    setIsEditingName(false);
    setNewName(contact.name || '');
    setEnableWhatsAppBilling(contact.enableWhatsAppBilling || false);
  }, [contact.id, contact.name, contact.enableWhatsAppBilling]);

  useEffect(() => {
    if (!isMobile && !isCompactDesktop) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !profileModal) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isMobile, isCompactDesktop, onClose, profileModal]);

  async function saveContact() {
    await updateContact(contact.id, { notes, tags: JSON.stringify(tags), city, state });
    onUpdate();
  }

  async function handleToggleBilling(val) {
    setEnableWhatsAppBilling(val);
    await updateContact(contact.id, { enableWhatsAppBilling: val });
    onUpdate();
  }

  async function handleSaveName() {
    if (!newName.trim()) {
      setIsEditingName(false);
      return;
    }
    await updateContact(contact.id, { name: newName });
    setIsEditingName(false);
    onUpdate();
  }

  async function handlePriorityChange(nextPriority) {
    setPriority(nextPriority);
    await updateTicket(ticket.id, { priority: nextPriority });
    onUpdate();
  }

  function addTag(tagName) {
    if (!tagName || tags.includes(tagName)) return;
    const updated = [...tags, tagName];
    setTags(updated);
    updateContact(contact.id, { tags: JSON.stringify(updated) }).then(onUpdate);
  }

  function removeTag(tagName) {
    const updated = tags.filter((item) => item !== tagName);
    setTags(updated);
    updateContact(contact.id, { tags: JSON.stringify(updated) }).then(onUpdate);
  }

  function buildContactSnapshot() {
    const location = [city, state].filter(Boolean).join(' - ');
    const equipmentsText = equipments
      .map((equipment) => {
        const manufacturer = getSafeText(equipment.manufacturer);
        const model = getSafeText(equipment.model, 'Equipamento');
        const serial = getSafeText(equipment.serialNumber, 'S/N');
        return `${manufacturer ? `${manufacturer} ` : ''}${model} | Serie: ${serial}`;
      })
      .join('\n');

    return [
      `Cliente: ${contactName}`,
      `Telefone: ${contactPhone}`,
      location ? `Localizacao: ${location}` : '',
      tags.length ? `Etiquetas: ${tags.join(', ')}` : '',
      notes ? `Notas:\n${notes}` : '',
      equipmentsText ? `Equipamentos:\n${equipmentsText}` : '',
    ].filter(Boolean).join('\n\n');
  }

  function openProfileModal(targetContact, initialTab = 'dados', initialEquipment = null) {
    if (!targetContact?.id) {
      toast.info('Nenhum cadastro vinculado para abrir');
      return;
    }

    setProfileModal({ contact: targetContact, initialTab, initialEquipment });
  }

  const equipmentOwner = contact;

  // Atendimento de cobrança (tag financeiro/boleto/fatura) ganha a seção de
  // cobrança logo no topo; os demais veem Equipamentos primeiro.
  const isBillingContext = tags.some((tag) => /financ|boleto|cobran|fatura/i.test(String(tag)));

  const billingSection = (
    <div style={styles.infoSection}>
      <h5 style={styles.infoLabel}>Cobrança</h5>
      <div style={styles.infoBilling}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={enableWhatsAppBilling}
            onChange={(e) => handleToggleBilling(e.target.checked)}
            style={{ width: '15px', height: '15px', accentColor: 'var(--rail-cyan)', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.83rem', color: 'var(--rail-ink)', fontWeight: 600 }}>
            Enviar faturas por WhatsApp
          </span>
        </label>
        <div style={{ fontSize: '0.74rem', color: 'var(--rail-dim)', marginTop: '4px', paddingLeft: '25px', lineHeight: 1.35 }}>
          Envia boletos e cobranças deste contato automaticamente.
        </div>
      </div>
    </div>
  );

  const overviewTab = (
    <>
      <div style={styles.infoSection}>
        <div style={styles.infoKvRow}>
          <span style={styles.infoKvKey}>Responsável</span>
          <span style={styles.infoKvVal}>{ticket.agent?.name || ticket.team?.name || 'Aguardando'}</span>
        </div>
        <div style={{ ...styles.infoKvRow, borderBottom: 'none' }}>
          <span style={styles.infoKvKey}>Canal</span>
          <span style={styles.infoKvVal}>{getInstanceLabel(ticket)}</span>
        </div>
      </div>

      {isBillingContext ? billingSection : null}

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Etiquetas</h5>
        <div style={styles.tagContainer}>
          {tags.map((tag) => (
            <span key={tag} style={styles.tagItem}>
              {tag} <button onClick={() => removeTag(tag)} style={styles.tagDel}>x</button>
            </span>
          ))}
          <select style={styles.tagSelect} value="" onChange={(e) => addTag(e.target.value)}>
            <option value="">+ Tag</option>
            {availableTags.filter((tag) => !tags.includes(tag.name)).map((tag) => (
              <option key={tag.id} value={tag.name}>{tag.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Localização</h5>
        <div style={{ display: 'flex', gap: '8px', flexDirection: isMobile ? 'column' : 'row' }}>
          <input style={{ ...styles.infoInput, flex: 2, minHeight: '40px' }} placeholder="Cidade" value={city} onChange={(e) => setCity(e.target.value)} onBlur={saveContact} />
          <input style={{ ...styles.infoInput, flex: 1, minHeight: '40px' }} placeholder="UF" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} onBlur={saveContact} />
        </div>
      </div>

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Prioridade do ticket</h5>
        <div style={styles.priorityGrid}>
          {[
            { id: 'urgent', label: 'Urgente', color: 'var(--critical)' },
            { id: 'high', label: 'Alta', color: 'var(--warning)' },
            { id: 'medium', label: 'Normal', color: 'var(--rail-cyan)' },
            { id: 'low', label: 'Baixa', color: 'var(--rail-dim)' }
          ].map((priorityOption) => {
            const on = priority === priorityOption.id;
            return (
              <button key={priorityOption.id} onClick={() => handlePriorityChange(priorityOption.id)} style={{ ...styles.priorityBtn, background: on ? 'var(--rail-raise)' : 'transparent', color: on ? priorityOption.color : 'var(--rail-dim)', borderColor: on ? priorityOption.color : 'var(--rail-line)' }}>
                {priorityOption.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={styles.infoSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <h5 style={{ ...styles.infoLabel, marginBottom: 0 }}>Equipamentos</h5>
          <button
            type="button"
            onClick={() => openProfileModal(equipmentOwner, 'equipamentos')}
            style={{
              ...styles.infoActionBtn,
              minHeight: '34px',
              padding: '0 0.8rem',
              fontSize: '0.7rem',
            }}
          >
            Adicionar
          </button>
        </div>
        <div style={styles.infoCardList}>
          {equipments.map((equipment) => (
            <div key={equipment.id} style={styles.infoListCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.infoListTitle}>{getEquipmentDisplayName(equipment)}</div>
                  <div style={styles.infoListMeta}>{equipment.type || 'Equipamento'}</div>
                  <div style={styles.infoListSubtle}>Serie: {equipment.serialNumber || 'S/N'}</div>
                  {equipment.sector ? <div style={styles.infoListSubtle}>Setor: {equipment.sector}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => openProfileModal(equipmentOwner, 'equipamentos', equipment)}
                  style={{
                    ...styles.infoActionBtn,
                    minHeight: '32px',
                    padding: '0 0.7rem',
                    fontSize: '0.75rem',
                    flexShrink: 0,
                  }}
                >
                  Editar
                </button>
              </div>
            </div>
          ))}
          {equipments.length === 0 ? <div style={styles.infoEmpty}>Nenhum equipamento vinculado</div> : null}
        </div>
      </div>

      {isBillingContext ? null : billingSection}

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Detalhes do ticket</h5>
        <div style={styles.techInfo}>
          <div style={styles.techRow}><span>Ficha</span> <span>{getDocketNumber(ticket)}</span></div>
          <div style={styles.techRow}><span>Criado em</span> <span>{new Date(ticket.createdAt).toLocaleDateString('pt-BR')}</span></div>
          <div style={styles.techRow}><span>Atendente</span> <span>{ticket.agent?.name || 'Aguardando'}</span></div>
        </div>
      </div>
    </>
  );

  const notesTab = (
    <>
      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Notas internas</h5>
        <textarea style={{ ...styles.notesArea, minHeight: isMobile ? '200px' : '240px' }} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveContact} placeholder="Observações sobre este cliente…" />
      </div>

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Resumo rápido</h5>
        <div style={styles.infoCardList}>
          <div style={styles.infoListCard}>
            <div style={styles.infoListTitle}>Ficha resumida</div>
            <div style={styles.infoListSubtle}>{buildContactSnapshot() || 'Nenhuma informação adicional.'}</div>
          </div>
        </div>
      </div>
    </>
  );

  const mediaTab = (
    <>
      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Fotos e Videos</h5>
        <div style={{ ...styles.mediaGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : styles.mediaGrid.gridTemplateColumns }}>
          {media.filter((item) => item.mediaType === 'image' || item.mediaType === 'video').slice(0, 12).map((item) => (
            item.mediaType === 'image' ? (
              <img key={item.id} src={getMediaUrl(item.mediaUrl)} alt="Imagem enviada pelo cliente" style={styles.mediaThumb} onClick={() => onImageClick(getMediaUrl(item.mediaUrl))} />
            ) : (
              <video key={item.id} src={getMediaUrl(item.mediaUrl)} aria-label="Vídeo enviado pelo cliente" style={{...styles.mediaThumb, background: '#000'}} controls={false} onClick={() => triggerMediaDownload(getMediaUrl(item.mediaUrl), 'video.mp4')} />
            )
          ))}
        </div>
        {media.filter((item) => item.mediaType === 'image' || item.mediaType === 'video').length === 0 ? <div style={styles.infoEmpty}>Nenhuma imagem ou video</div> : null}
      </div>

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Documentos e Arquivos</h5>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {media.filter((item) => item.mediaType === 'document' || item.mediaType === 'audio').map((item) => {
            const docName = getSafeText(item.body || item.mediaUrl.split('/').pop(), item.mediaType === 'audio' ? 'Áudio' : 'Documento');
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--rail-raise)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--rail-line)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--rail-dim)' }}>
                  {item.mediaType === 'audio' ? <Mic size={16} /> : <FileText size={16} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--rail-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{docName}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--rail-faint)' }}>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</div>
                </div>
                <button type="button" onClick={() => triggerMediaDownload(getMediaUrl(item.mediaUrl), docName)} aria-label={`Baixar ${docName}`} title={`Baixar ${docName}`} style={{ background: 'none', border: 'none', color: 'var(--rail-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <Download size={16} />
                </button>
              </div>
            );
          })}
        </div>
        {media.filter((item) => item.mediaType === 'document' || item.mediaType === 'audio').length === 0 ? <div style={styles.infoEmpty}>Nenhum documento enviado</div> : null}
      </div>

      <div style={styles.infoSection}>
        <h5 style={styles.infoLabel}>Arquivos e contexto</h5>
        <div style={styles.infoCardList}>
          <div style={styles.infoListCard}>
            <div style={styles.infoListTitle}>Contato</div>
            <div style={styles.infoListSubtle}>{contactName}</div>
          </div>
          <div style={styles.infoListCard}>
            <div style={styles.infoListTitle}>Telefone</div>
            <div style={styles.infoListSubtle}>{contactPhone || 'Nao informado'}</div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="animate-slide-in-right inbox-contact-panel"
      style={{
        ...styles.infoPanel,
        position: isMobile ? 'fixed' : isCompactDesktop ? 'absolute' : 'relative',
        inset: isMobile ? 0 : isCompactDesktop ? '0 0 0 auto' : 'auto',
        width: isMobile ? '100%' : isCompactDesktop ? 'min(420px, calc(100% - 24px))' : styles.infoPanel.width,
        zIndex: isMobile ? 2000 : isCompactDesktop ? 200 : profileModal ? 2500 : 1,
        height: '100%',
        boxShadow: isCompactDesktop ? '-18px 0 42px rgba(0,0,0,0.28)' : styles.infoPanel.boxShadow,
      }}
    >
      <div style={styles.infoPanelHeader}>
        <div style={styles.infoPanelHeaderMain}>
          <div style={styles.infoPanelEyebrow}>Cliente</div>
          <h3 style={styles.infoPanelTitle}>Ficha do contato</h3>
        </div>
        <button type="button" className="inbox-control" style={styles.infoClose} onClick={onClose} aria-label="Fechar ficha do cliente" title="Fechar ficha">
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>

      <div style={styles.infoPanelTabs} role="tablist" aria-label="Seções da ficha do cliente">
        {[
          { id: 'overview', label: 'Resumo' },
          { id: 'notes', label: 'Notas' },
          { id: 'media', label: 'Mídias' },
        ].map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setPanelTab(tabItem.id)}
            role="tab"
            aria-selected={panelTab === tabItem.id}
            aria-controls={`contact-panel-${tabItem.id}`}
            style={{
              ...styles.infoPanelTab,
              ...(panelTab === tabItem.id ? styles.infoPanelTabActive : {}),
            }}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      <div style={styles.infoScroll}>
        <div style={styles.infoProfile}>
          <div style={styles.infoIdentityRow}>
          <button
            type="button"
            className="inbox-control"
            onClick={() => contact.avatarUrl && onImageClick(getMediaUrl(contact.avatarUrl))}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: contact.avatarUrl ? 'zoom-in' : 'default',
              borderRadius: '14px',
              flexShrink: 0,
            }}
            title={contact.avatarUrl ? 'Ampliar foto do cliente' : contactName}
          >
            <Avatar name={contactName} src={contact.avatarUrl} size={52} />
          </button>
          <div style={styles.infoIdentityMain}>
          {isEditingName ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, width: '100%', padding: '0 10px' }}>
              <input
                style={{ ...styles.infoInput, flex: 1, margin: 0, fontSize: '1rem', fontWeight: 600 }}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                placeholder="Nome do cliente"
              />
              <button
                onClick={handleSaveName}
                style={{ ...styles.infoActionBtn, ...styles.infoActionBtnPrimary, padding: '8px 14px', minHeight: 0, height: 'auto' }}
              >
                Salvar
              </button>
            </div>
          ) : (
            <h4 style={{ ...styles.infoName, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }} onClick={() => { setIsEditingName(true); setNewName(contact.name || ''); }} title="Clique para editar o nome">
              <span style={{ minWidth: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{contactName}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </h4>
          )}
          </div>
          </div>
          <button
            type="button"
            className="inbox-control"
            onClick={() => copyText(contactPhone, 'Telefone copiado')}
            style={{ ...styles.infoPhone, ...styles.infoPhoneButton, marginTop: '0.3rem', marginBottom: '0.55rem' }}
            title="Copiar telefone"
            aria-label={`Copiar telefone ${formatPhone(contactPhone)}`}
          >
            {formatPhone(contactPhone) || 'Sem telefone'}
          </button>
          {linkedCrm ? (
            <button
              type="button"
              className="inbox-control"
              onClick={() => onOpenCRM?.(linkedCrm)}
              style={{ ...styles.infoActionBtn, ...styles.infoActionBtnPrimary, width: '100%', marginBottom: '0.6rem', minHeight: '38px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}
              title="Abrir visão 360 sem sair da conversa"
            >
              <ClipboardList size={15} /> Visão 360 — {linkedCrm.fantasyName || linkedCrm.name}
            </button>
          ) : contact.fantasyName ? (
            <div style={{ ...styles.infoBadge, color: 'var(--rail-cyan)', borderColor: 'var(--rail-cyan)', marginBottom: '0.6rem' }}>
              CRM · {contact.fantasyName}
            </div>
          ) : null}
          <div style={styles.infoBadgeRow}>
            <span style={styles.infoBadge}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: ticket.status === 'open' ? 'var(--rail-cyan)' : 'var(--rail-faint)' }} />
              {statusMeta.label}
            </span>
            {priorityMeta ? (
              <span style={{ ...styles.infoBadge, color: priority === 'urgent' ? 'var(--rail-magenta)' : 'var(--rail-dim)' }}>
                {priorityMeta.label}
              </span>
            ) : null}
          </div>
          <div style={styles.infoActionRow} aria-label="Ações rápidas do cliente">
            <button type="button" className="inbox-control" onClick={() => copyText(contactName, 'Nome copiado')} style={styles.infoActionBtn}>
              Copiar nome
            </button>
            <button type="button" className="inbox-control" onClick={() => copyText(buildContactSnapshot(), 'Ficha copiada')} style={styles.infoActionBtn}>
              Copiar ficha
            </button>
            {linkedCrm ? (
              <button type="button" className="inbox-control" onClick={onUnlinkCRM} style={styles.infoActionBtn} title="Desvincular este contato do CRM">
                Desvincular
              </button>
            ) : (
              <button type="button" className="inbox-control" onClick={onLinkCRM} style={{ ...styles.infoActionBtn, ...styles.infoActionBtnPrimary }}>
                Vincular CRM
              </button>
            )}
          </div>
        </div>

        {panelTab === 'overview' ? <div role="tabpanel" id="contact-panel-overview" aria-label="Resumo do cliente">{overviewTab}</div> : null}
        {panelTab === 'notes' ? <div role="tabpanel" id="contact-panel-notes" aria-label="Notas do cliente">{notesTab}</div> : null}
        {panelTab === 'media' ? <div role="tabpanel" id="contact-panel-media" aria-label="Mídias do cliente">{mediaTab}</div> : null}
      </div>

      {profileModal ? (
        <ContactProfileModal
          key={`${profileModal.contact.id}-${profileModal.initialTab}-${profileModal.initialEquipment?.id || 'new'}`}
          contact={profileModal.contact}
          initialTab={profileModal.initialTab}
          initialEquipment={profileModal.initialEquipment || null}
          onClose={() => setProfileModal(null)}
          onUpdated={() => {
            loadPanelContext();
          }}
        />
      ) : null}
    </div>
  );
}

export function TransferModal({ users, teams, onClose, onTransfer, styles }) {
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [note, setNote] = useState('');

  const handleSave = () => {
    if (!selectedTeam && !selectedAgent) {
      toast.error('Selecione um departamento ou atendente para transferir.');
      return;
    }
    // onTransfer receives (agentId, teamId, note)
    onTransfer(selectedAgent || null, selectedTeam || null, note);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, width: '480px', maxWidth: '90%', borderRadius: 'var(--radius-md)', padding: '0', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '24px 24px 16px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)', fontWeight: 600 }}>Transferir chamado</h3>
        </div>
        
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Transferir para departamento</label>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 12px' }}>
              <Users size={18} style={{ color: 'var(--text-muted)' }} />
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'transparent', padding: '12px', fontSize: '0.95rem', color: 'var(--text-main)', outline: 'none' }}
              >
                <option value="">Selecione o departamento</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Transferir para atendente (opcional)</label>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 12px' }}>
              <User size={18} style={{ color: 'var(--text-muted)' }} />
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'transparent', padding: '12px', fontSize: '0.95rem', color: 'var(--text-main)', outline: 'none' }}
              >
                <option value="">Selecione o atendente</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Adicionar comentário</label>
            <textarea
              placeholder="Digite o comentário aqui..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                color: 'var(--text-main)',
                fontSize: '0.95rem',
                outline: 'none',
                resize: 'none',
                height: '80px',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        <div style={{ padding: '16px 24px 24px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--bg-panel)',
              color: 'var(--text-muted)',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: '120px'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '10px 24px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--text-inverse)',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: '120px'
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

export function ForwardModal({ onClose, onForward, styles }) {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      getContacts(search).then((response) => {
        setContacts(response.data.contacts || response.data || []);
        setLoading(false);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>Encaminhar mensagem</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
        </div>
        <div style={{ padding: '1rem' }}>
          <input style={{ ...styles.modalInput, marginBottom: '1rem' }} placeholder="Buscar contato..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {loading ? <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Carregando...</div> : (
              contacts.map((contact) => (
                <div key={contact.id} onClick={() => onForward(contact)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }} className="hover-item">
                  <Avatar name={contact.name} src={contact.avatarUrl} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{contact.phone}</div>
                  </div>
                  <div style={{ color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 800 }}>Selecionar</div>
                </div>
              ))
            )}
            {!loading && contacts.length === 0 ? <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Nenhum contato encontrado</div> : null}
          </div>
        </div>
        <style>{`
          .hover-item:hover { background: var(--accent-light) !important; }
        `}</style>
      </div>
    </div>
  );
}

// Item de lista memoizado: evita recriar/recomparar todas as linhas do inbox
// quando so o item selecionado muda (troca de ticket) ou o texto do composer
// atualiza o componente pai. Só a linha afetada volta a renderizar.
const TicketRow = React.memo(function TicketRow({ ticket, isSelected, onSelect, onPreference, styles, now }) {
  const priorityMeta = getPriorityMeta(ticket.priority);
  const statusMeta = getStatusMeta(ticket.status);
  const phoneLabel = formatPhone(getContactPhone(ticket.contact));
  const ownerLabel = ticket.agent?.name || ticket.team?.name || 'Sem responsável';
  const tags = getSafeTags(ticket.contact?.tags).slice(0, 2);
  const contactName = getContactDisplayName(ticket.contact);
  const slaMeta = getSlaMeta(ticket, now);
  const awaitingCustomer = isAwaitingCustomer(ticket);

  const docketNum = getDocketNumber(ticket);
  const isOpen = ticket.status === 'open';
  const isWaiting = ticket.status === 'pending' || ticket.status === 'bot';
  // SLA só aparece quando aperta (esgotado ou < 60 min). Fora disso, mostra o tempo desde a última mensagem.
  const showSla = slaMeta && slaMeta.tone !== 'ok';
  const showPriority = ticket.priority === 'urgent' || ticket.priority === 'high';

  return (
    <div
      onClick={() => onSelect(ticket.id)}
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={`Abrir conversa com ${contactName}. Ficha ${docketNum}. Status: ${statusMeta.label}.${ticket.isUnread || ticket.unreadCount > 0 ? ` ${ticket.unreadCount || 1} mensagem(ns) não lida(s).` : ''}${awaitingCustomer ? ' Aguardando resposta do cliente.' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(ticket.id);
        }
      }}
      className="inbox-ticket-row"
      style={{ ...styles.row, ...(isSelected ? styles.rowActive : {}) }}
    >
      <Avatar name={contactName} src={ticket.contact?.avatarUrl} size={40} />
      <div style={styles.rowInfo}>
        <span style={styles.rowDocket}>{docketNum}</span>
        <div style={styles.rowTop}>
          <span style={styles.rowName}>{ticket.isPinned ? <Pin size={11} fill="currentColor" aria-label="Conversa fixada" /> : null}{contactName}</span>
          {showSla ? (
            <span style={{ ...styles.slaPill, ...(slaMeta.tone === 'danger' ? styles.slaDanger : styles.slaWarning) }}>
              {slaMeta.label.replace(/^SLA /, '')}
            </span>
          ) : (
            <span style={styles.rowTime} title={formatTicketTimestamp(ticket.lastMessageAt || ticket.updatedAt)}>
              {formatElapsed(ticket.lastMessageAt || ticket.updatedAt, now)}
            </span>
          )}
        </div>

        {phoneLabel ? <div style={styles.rowPhone}>{phoneLabel}</div> : null}

        <div style={styles.rowSub}>
          {isWaiting ? (
            <span style={styles.statusStamp} role="status" aria-label={`Status: ${statusMeta.label}`}>{statusMeta.label}</span>
          ) : (
            <span style={styles.rowStatusPill} role="status" aria-label={`Status: ${statusMeta.label}`}>
              <span style={{ ...styles.dot, background: isOpen ? 'var(--rail-cyan)' : 'var(--rail-faint)' }} />
              {statusMeta.label}
            </span>
          )}
          {showPriority && priorityMeta ? (
            <span style={{ ...styles.priorityPill, color: ticket.priority === 'urgent' ? 'var(--rail-magenta)' : 'var(--warning)' }}>
              {priorityMeta.label}
            </span>
          ) : null}
          {awaitingCustomer ? <span style={styles.awaitingCustomerPill}>aguardando cliente</span> : null}
          {(ticket.isUnread || ticket.unreadCount > 0) ? <div style={styles.unreadBadge} role="status" aria-label={`${ticket.unreadCount > 0 ? ticket.unreadCount : 1} mensagem(ns) não lida(s)`}>{ticket.unreadCount > 0 ? ticket.unreadCount : '•'}</div> : null}
        </div>

        <div className="inbox-ticket-meta" style={styles.rowMetaLine}>
          <span style={styles.rowOwner}>{ownerLabel}</span>
          {tags.length > 0 ? (
            <div className="inbox-ticket-tags" style={styles.rowTags}>
              {tags.map((tag, tagIndex) => {
                const safeTag = getSafeText(tag, 'Tag');
                return (
                  <span key={`${safeTag}-${tagIndex}`} style={styles.rowTag}>
                    {safeTag}
                  </span>
                );
              })}
            </div>
          ) : (
            <span style={styles.rowMetaSpacer} />
          )}
          <div className="inbox-ticket-hover" style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
            <button type="button" className="inbox-control" style={styles.ticketQuickAction} title={ticket.isPinned ? 'Desafixar conversa' : 'Fixar conversa no topo'} aria-label={ticket.isPinned ? 'Desafixar conversa' : 'Fixar conversa'} aria-pressed={Boolean(ticket.isPinned)} onClick={(event) => { event.stopPropagation(); onPreference(ticket.id, { isPinned: !ticket.isPinned }); }}>
              {ticket.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
            <button type="button" className="inbox-control" style={styles.ticketQuickAction} title="Marcar como não lida" aria-label="Marcar conversa como não lida" aria-pressed={Boolean(ticket.isUnread || ticket.unreadCount > 0)} onClick={(event) => { event.stopPropagation(); onPreference(ticket.id, { isUnread: true }); }}>
              <Mail size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export const TicketSidebar = React.memo(function TicketSidebar({
  counts,
  error,
  filters,
  isMobile,
  loading,
  onTicketPreference,
  onRefresh,
  search,
  selectedId,
  selectTicket,
  setFilters,
  setSearch,
  setTab,
  styles,
  tab,
  tickets,
  users,
  teams,
  view,
  lastUpdatedAt,
  density,
  setDensity,
  sidebarMode = 'auto',
  setSidebarMode,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('inbox:sort') || 'recent');
  const [savedFilters, setSavedFilters] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('inbox:saved-filters') || '[]');
    } catch {
      return [];
    }
  });
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('inbox:sort', sortBy);
  }, [sortBy]);

  useEffect(() => {
    setVisibleLimit(80);
  }, [tickets, search, filters, sortBy]);

  const filteredTickets = useMemo(() => tickets.filter((ticket) => {
    const query = getSafeLowerText(search);
    if (!query) return true;
    // Mesmos campos usados na busca do backend (nome, fantasia, CPF/CNPJ,
    // telefone e whatsapp) - a lista carregada aqui ja vem filtrada de la,
    // isto e so o filtro instantaneo enquanto a nova busca ainda nao voltou.
    const name = getSafeLowerText(ticket.contact?.name);
    const fantasyName = getSafeLowerText(ticket.contact?.fantasyName);
    const cpfCnpj = getSafeLowerText(ticket.contact?.cpfCnpj);
    const phone = getSafeLowerText(ticket.contact?.phone);
    const whatsapp = getSafeLowerText(ticket.contact?.whatsapp);
    return name.includes(query) || fantasyName.includes(query) || cpfCnpj.includes(query) || phone.includes(query) || whatsapp.includes(query);
  }).sort((left, right) => {
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) return left.isPinned ? -1 : 1;
    if (sortBy === 'oldest') {
      const leftNeedsResponse = !isAwaitingCustomer(left) && left.status !== 'resolved';
      const rightNeedsResponse = !isAwaitingCustomer(right) && right.status !== 'resolved';
      if (leftNeedsResponse !== rightNeedsResponse) return leftNeedsResponse ? -1 : 1;
      return new Date(left.lastCustomerMessageAt || left.lastMessageAt || left.updatedAt || 0).getTime()
        - new Date(right.lastCustomerMessageAt || right.lastMessageAt || right.updatedAt || 0).getTime();
    }
    if (sortBy === 'priority') {
      const weight = { urgent: 4, high: 3, medium: 2, low: 1 };
      return (weight[right.priority] || 0) - (weight[left.priority] || 0) || getTicketActivityAt(left) - getTicketActivityAt(right);
    }
    if (sortBy === 'sla') {
      const leftDue = new Date(left.slaDueAt || '2999-12-31').getTime();
      const rightDue = new Date(right.slaDueAt || '2999-12-31').getTime();
      return leftDue - rightDue;
    }
    if (sortBy === 'unread') {
      const leftUnread = left.isUnread ? Math.max(1, left.unreadCount || 0) : (left.unreadCount || 0);
      const rightUnread = right.isUnread ? Math.max(1, right.unreadCount || 0) : (right.unreadCount || 0);
      return rightUnread - leftUnread || getTicketActivityAt(left) - getTicketActivityAt(right);
    }
    return getTicketActivityAt(right) - getTicketActivityAt(left);
  }), [tickets, search, sortBy]);

  const activeTabLabel = {
    mine: 'Minhas conversas',
    pending: 'Fila de espera',
    all: 'Todas as conversas (uma por cliente)',
  }[tab] || 'Inbox';

  const visibleTickets = filteredTickets.slice(0, visibleLimit);

  function saveCurrentFilter() {
    const name = window.prompt('Nome para este filtro:');
    if (!name?.trim()) return;
    const next = [...savedFilters.filter((item) => item.name !== name.trim()), { name: name.trim(), filters, sortBy }].slice(-8);
    setSavedFilters(next);
    localStorage.setItem('inbox:saved-filters', JSON.stringify(next));
  }

  const activeFilterCount = [filters.priority, filters.agentId, filters.teamId].filter(Boolean).length;

  return (
    <aside
      className="inbox-sidebar"
      style={{
        ...styles.sidebar,
        display: (isMobile && view === 'chat') ? 'none' : 'flex',
        width: isMobile ? '100%' : styles.sidebar.width,
        minWidth: isMobile ? '100%' : styles.sidebar.minWidth,
        borderRight: isMobile ? 'none' : styles.sidebar.borderRight,
      }}
    >
      <div className="inbox-sidebar-header" style={styles.sidebarHeader}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.sidebarTitle}>Atendimentos</div>
          <div className="inbox-sidebar-eyebrow" style={styles.sidebarEyebrow}>{activeTabLabel}</div>
        </div>
        <div style={styles.sidebarHeaderActions}>
          <button
            type="button"
            className="inbox-control"
            style={{ ...styles.sidebarPinButton, ...(sidebarMode === 'fixed' ? styles.sidebarPinButtonActive : {}) }}
            onClick={() => setSidebarMode?.(sidebarMode === 'fixed' ? 'auto' : 'fixed')}
            aria-pressed={sidebarMode === 'fixed'}
            aria-label={sidebarMode === 'fixed' ? 'Desafixar lista de conversas' : 'Fixar lista de conversas'}
            title={sidebarMode === 'fixed' ? 'Desafixar lista (voltar ao modo automático)' : 'Fixar lista nesta tela'}
          >
            {sidebarMode === 'fixed' ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <select style={{ ...styles.sortSelect, flex: '0 0 auto', width: 96 }} value={density} onChange={(event) => setDensity(event.target.value)} aria-label="Densidade da lista" title="Densidade visual">
          <option value="auto">Auto</option>
          <option value="compact">Compacta</option>
          <option value="comfortable">Confortável</option>
          </select>
        </div>
      </div>

      <div className="inbox-tabs-wrap" style={styles.tabsWrap}>
        <div style={styles.tabs}>
          {['mine', 'pending', 'all'].map((tabId) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              style={{ ...styles.tab, ...(tab === tabId ? styles.tabActive : {}) }}
              aria-pressed={tab === tabId}
              aria-label={`${tabId === 'mine' ? 'Minhas conversas' : tabId === 'pending' ? 'Fila de espera' : 'Todas as conversas, agrupadas por cliente'}${counts[tabId] != null ? `, ${counts[tabId]} conversas` : ''}`}
              title={tabId === 'all' ? 'Uma conversa por cliente; o histórico completo fica dentro da conversa' : undefined}
            >
              {tabId === 'mine' ? 'Meus' : tabId === 'pending' ? 'Espera' : 'Todas'}
              {counts[tabId] > 0 && <span style={styles.badge}>{counts[tabId]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="inbox-search-wrap" style={styles.searchWrap}>
        <div style={styles.searchRow}>
          <div style={styles.searchShell}>
            <Search size={15} strokeWidth={2.2} style={styles.searchIcon} />
            <input
              style={styles.search}
              placeholder="Buscar cliente, telefone ou CPF/CNPJ"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar cliente, telefone ou CPF/CNPJ"
            />
            {search ? (
              <button type="button" className="inbox-control" style={styles.searchClearIcon} onClick={() => setSearch('')} aria-label="Limpar busca" title="Limpar busca">
                <X size={14} />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="inbox-control"
            onClick={() => setFiltersOpen((current) => !current)}
            style={{ ...styles.filterToggleBtn, ...(activeFilterCount ? styles.filterToggleActive : {}) }}
            aria-expanded={filtersOpen}
            aria-label="Exibir filtros da lista"
            title="Filtrar conversas"
          >
            <SlidersHorizontal size={15} />
            {activeFilterCount ? <span>{activeFilterCount}</span> : null}
          </button>
        </div>

        <div style={styles.sortBar}>
          <select style={styles.sortSelect} value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Ordenar conversas">
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigas sem resposta</option>
            <option value="priority">Maior prioridade</option>
            <option value="sla">SLA mais próximo</option>
            <option value="unread">Não lidas primeiro</option>
          </select>
          {savedFilters.length ? (
            <select
              style={styles.sortSelect}
              defaultValue=""
              aria-label="Aplicar filtro salvo"
              onChange={(event) => {
                const saved = savedFilters.find((item) => item.name === event.target.value);
                if (saved) {
                  setFilters(saved.filters || { priority: '', agentId: '', teamId: '' });
                  setSortBy(saved.sortBy || 'recent');
                }
                event.target.value = '';
              }}
            >
              <option value="">Filtros salvos</option>
              {savedFilters.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          ) : null}
          <button type="button" className="inbox-control" style={styles.saveFilterBtn} onClick={saveCurrentFilter} title="Salvar filtros e ordenação atuais">Salvar visão</button>
        </div>

        {filtersOpen ? <div style={{ ...styles.filterBar, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <select
            style={{ ...styles.filterSelect, minWidth: isMobile ? 'calc(50% - 3px)' : undefined }}
            value={filters.priority}
            onChange={(event) => setFilters({ ...filters, priority: event.target.value })}
          >
            <option value="">Prioridade</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="medium">Normal</option>
            <option value="low">Baixa</option>
          </select>

          <select
            style={{ ...styles.filterSelect, minWidth: isMobile ? 'calc(50% - 3px)' : undefined }}
            value={filters.agentId}
            onChange={(event) => setFilters({ ...filters, agentId: event.target.value })}
          >
            <option value="">Atendente</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>

          <select
            style={{ ...styles.filterSelect, minWidth: isMobile ? '100%' : undefined }}
            value={filters.teamId}
            onChange={(event) => setFilters({ ...filters, teamId: event.target.value })}
          >
            <option value="">Equipe</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          {activeFilterCount ? (
            <button
              type="button"
              className="inbox-control"
              style={styles.filtersClearBtn}
              onClick={() => setFilters({ priority: '', agentId: '', teamId: '' })}
            >
              Limpar
            </button>
          ) : null}
        </div> : null}
      </div>

      {error ? (
        <div role="alert" style={styles.inboxErrorBanner}>
          <span>Não foi possível atualizar a lista de conversas.</span>
          <button type="button" className="inbox-control" style={styles.inboxErrorAction} onClick={onRefresh} disabled={loading}>
            {loading ? 'Tentando...' : 'Tentar novamente'}
          </button>
        </div>
      ) : null}
      {loading && tickets.length === 0 ? (
        <div style={styles.sidebarLoading} role="status" aria-live="polite">Carregando conversas...</div>
      ) : null}
      {!loading && lastUpdatedAt && !error ? (
        <div className="inbox-updated-at" style={styles.sidebarUpdated} aria-live="polite">
          Atualizado às {new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      ) : null}

      <div style={styles.list}>
        {visibleTickets.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            isSelected={selectedId === ticket.id}
            onSelect={selectTicket}
            onPreference={onTicketPreference}
            styles={styles}
            now={now}
          />
        ))}
        {visibleTickets.length < filteredTickets.length ? (
          <button type="button" className="inbox-control" style={styles.loadMoreTicketsBtn} onClick={() => setVisibleLimit((current) => current + 80)}>
            Mostrar mais {Math.min(80, filteredTickets.length - visibleTickets.length)} conversas
          </button>
        ) : null}
        {filteredTickets.length === 0 ? (
          <Empty>
            {search.trim() ? (
              <>
                Nenhuma conversa encontrada para "{search.trim()}"
                <div style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>Tente outro nome ou telefone.</div>
              </>
            ) : activeFilterCount > 0 ? (
              <>
                Nenhuma conversa com os filtros atuais
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="inbox-control"
                    onClick={() => setFilters({ priority: '', agentId: '', teamId: '' })}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', padding: 0 }}
                  >
                    Limpar filtros
                  </button>
                </div>
              </>
            ) : tab === 'pending' ? (
              'Nenhuma conversa aguardando na fila'
            ) : tab === 'mine' ? (
              'Você ainda não tem conversas atribuídas'
            ) : (
              'Nenhuma conversa encontrada'
            )}
          </Empty>
        ) : null}
      </div>
    </aside>
  );
});

export const ChatHeader = React.memo(function ChatHeader({
  botName,
  canCreateOs,
  canResolve,
  canReopen,
  canTransfer,
  handleReopen,
  handleResolve,
  handleSummarize,
  isMobile,
  isCompactDesktop,
  onImageClick,
  selectedTicket,
  setShowInfo,
  setShowOsModal,
  setTransferModal,
  setView,
  showInfo,
  styles,
  summarizing,
}) {
  const contactName = getContactDisplayName(selectedTicket.contact);
  const orgName = getSafeText(selectedTicket.contact?.fantasyName) || getSafeText(selectedTicket.crmCustomer?.fantasyName);
  const [actionsOpen, setActionsOpen] = useState(false);
  const statusMeta = getStatusMeta(selectedTicket.status);
  const slaMeta = getSlaMeta(selectedTicket);
  const awaitingCustomer = isAwaitingCustomer(selectedTicket);
  const equipment = selectedTicket.equipment || selectedTicket.contact?.equipments?.[0] || null;
  const equipmentLabel = equipment ? getEquipmentDisplayName(equipment) : '';
  const subjectLabel = getSafeText(selectedTicket.subject).trim();
  const showSla = slaMeta && slaMeta.tone !== 'ok';
  useEffect(() => {
    setActionsOpen(false);
  }, [selectedTicket.id]);

  useEffect(() => {
    function handleWindowClick(event) {
      if (!event.target.closest?.('[data-header-menu-root="true"]')) {
        setActionsOpen(false);
      }
    }

    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  return (
    <header className="inbox-chat-header" style={{ ...styles.chatHeader, padding: isMobile ? '0.85rem 1rem' : '1rem 1.5rem' }}>
      {isMobile ? (
        <button style={styles.backBtn} onClick={() => setView('list')} aria-label="Voltar para lista">
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => selectedTicket.contact?.avatarUrl && onImageClick(getMediaUrl(selectedTicket.contact.avatarUrl))}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: selectedTicket.contact?.avatarUrl ? 'zoom-in' : 'default',
          borderRadius: '12px',
        }}
        title={selectedTicket.contact?.avatarUrl ? 'Ampliar foto do cliente' : contactName}
      >
        <Avatar
          name={contactName}
          src={selectedTicket.contact?.avatarUrl}
          size={isMobile ? 38 : 46}
        />
      </button>

      <div style={styles.chatIdentity}>
        <div style={styles.chatTitleRow}>
          <div
            style={{
              ...styles.chatName,
              fontSize: isMobile ? '0.95rem' : '1.05rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {contactName}
          </div>
          {orgName ? <span style={styles.chatOrg}>· {orgName}</span> : null}
        </div>

        {(equipmentLabel || subjectLabel || showSla || awaitingCustomer) ? (
          <div style={styles.chatMetaRow}>
            {equipmentLabel ? (
              <span style={styles.chatMachineChip}>
                {equipmentLabel}{equipment?.serialNumber ? ` · ${equipment.serialNumber}` : ''}
              </span>
            ) : subjectLabel ? (
              <span style={styles.chatMetaText}>{subjectLabel}</span>
            ) : null}
            {awaitingCustomer ? <span style={styles.chatAwaitingCustomer}>aguardando cliente</span> : null}
            {showSla ? (
              <span style={{ ...styles.chatSlaText, ...(slaMeta.tone === 'danger' ? styles.slaDanger : styles.slaWarning) }}>
                {slaMeta.label}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={styles.headerActions}>
        {canCreateOs && !isMobile ? (
          <button
            type="button"
            className="inbox-control"
            style={styles.headerGhostBtn}
            onClick={() => setShowOsModal(true)}
            title="Gerar ordem de serviço"
            aria-label="Gerar ordem de serviço"
          >
            <ClipboardList size={15} strokeWidth={2.2} />
            Gerar O.S.
          </button>
        ) : null}

        {selectedTicket.status !== 'resolved' && canResolve ? (
          <button className="inbox-control" style={styles.resolveBtn} onClick={handleResolve} aria-label="Encerrar atendimento" title="Encerrar atendimento">
            <CheckCheck size={16} strokeWidth={2.2} />
            {isMobile ? null : 'Encerrar'}
          </button>
        ) : selectedTicket.status === 'resolved' && canReopen ? (
          <button
            className="inbox-control"
            style={{ ...styles.resolveBtn, background: 'transparent', color: 'var(--ink-dim)', border: '1px solid var(--paper-line)', boxShadow: 'none' }}
            onClick={handleReopen}
            aria-label="Reabrir atendimento"
            title="Reabrir atendimento"
          >
            {isMobile || isCompactDesktop ? 'Abrir' : 'Reabrir'}
          </button>
        ) : null}

        <div style={styles.messageMenuRoot} data-header-menu-root="true">
          <button
            type="button"
            className="inbox-control"
            style={styles.headerGhostIconBtn}
            onClick={(event) => {
              event.stopPropagation();
              setActionsOpen((current) => !current);
            }}
            title="Mais acoes"
            aria-label="Mais acoes da conversa"
            aria-expanded={actionsOpen}
          >
            <MoreVertical size={16} strokeWidth={2.3} />
          </button>

          {actionsOpen ? (
            <div style={styles.headerMenuPanel}>
              {canCreateOs && isMobile ? (
                <button type="button" className="inbox-control" style={styles.headerMenuItem} onClick={() => { setShowOsModal(true); setActionsOpen(false); }}>
                  <ClipboardList size={15} strokeWidth={2.2} />
                  Gerar O.S.
                </button>
              ) : null}
              <button type="button" className="inbox-control" style={styles.headerMenuItem} onClick={() => { handleSummarize(); setActionsOpen(false); }} disabled={summarizing}>
                <Sparkles size={15} strokeWidth={2.2} />
                {summarizing ? 'Gerando resumo...' : 'Resumo IA'}
              </button>
              {selectedTicket.status !== 'resolved' && canTransfer ? (
                <button type="button" className="inbox-control" style={styles.headerMenuItem} onClick={() => { setTransferModal(true); setActionsOpen(false); }}>
                  <ArrowRightLeft size={15} strokeWidth={2.2} />
                  Transferir conversa
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="inbox-control"
          style={styles.headerGhostIconBtn}
          onClick={() => setShowInfo(!showInfo)}
          title={showInfo ? 'Fechar ficha do cliente' : 'Abrir ficha do cliente'}
          aria-label={showInfo ? 'Fechar ficha do cliente' : 'Abrir ficha do cliente'}
          aria-pressed={showInfo}
        >
          {showInfo ? <PanelRightClose size={16} strokeWidth={2.2} /> : <PanelRightOpen size={16} strokeWidth={2.2} />}
        </button>
      </div>
    </header>
  );
});

export const MessageList = React.memo(function MessageList({
  botName,
  canDeleteMessage,
  handleCopyMessage,
  handleDeleteMessage,
  handleLoadMoreMessages,
  hasMoreMessages,
  historySearch,
  isMobile,
  loading,
  loadingMoreMessages,
  messages,
  onImageClick,
  onHistorySearch,
  scrollRef,
  selectedTicket,
  setForwardingMessage,
  setReplyingTo,
  styles,
}) {
  const selectedContactName = getContactDisplayName(selectedTicket.contact, 'Cliente');
  const messageItems = Array.isArray(messages) ? messages : [];
  const [draftSearch, setDraftSearch] = useState(historySearch || '');
  const [historySearchOpen, setHistorySearchOpen] = useState(Boolean(historySearch));
  const [openMenu, setOpenMenu] = useState(null);
  const [flashKey, setFlashKey] = useState(null);
  const pendingQuoteRef = useRef(null);
  const quoteAttemptsRef = useRef(0);
  const trimmedHistorySearch = getSafeText(historySearch).trim();

  const cssEscape = (value) => (typeof window !== 'undefined' && window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"'));

  // Clicar numa citação leva à mensagem original: rola, pisca um destaque e,
  // se ela estiver fora da página carregada, puxa mais histórico e tenta de novo.
  const scrollToMessage = React.useCallback((externalId) => {
    const id = getSafeText(externalId).trim();
    if (!id) return;
    const node = scrollRef.current?.querySelector(`[data-msg-key="${cssEscape(id)}"]`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashKey(id);
      window.setTimeout(() => setFlashKey((current) => (current === id ? null : current)), 1600);
      pendingQuoteRef.current = null;
      quoteAttemptsRef.current = 0;
      return;
    }
    if (hasMoreMessages && quoteAttemptsRef.current < 12) {
      pendingQuoteRef.current = id;
      quoteAttemptsRef.current += 1;
      handleLoadMoreMessages();
    } else {
      pendingQuoteRef.current = null;
      quoteAttemptsRef.current = 0;
      toast.info('A mensagem citada está fora do histórico disponível.');
    }
  }, [scrollRef, hasMoreMessages, handleLoadMoreMessages]);

  useEffect(() => {
    if (pendingQuoteRef.current) scrollToMessage(pendingQuoteRef.current);
  }, [messages, scrollToMessage]);

  useEffect(() => {
    pendingQuoteRef.current = null;
    quoteAttemptsRef.current = 0;
  }, [selectedTicket.id]);

  useEffect(() => {
    setDraftSearch(historySearch || '');
    if (historySearch) setHistorySearchOpen(true);
  }, [historySearch, selectedTicket.id]);

  useEffect(() => {
    setOpenMenu(null);
  }, [selectedTicket.id, messages.length]);

  useEffect(() => {
    function handleWindowClick(event) {
      if (!event.target.closest?.('[data-message-menu-root="true"]')) {
        setOpenMenu(null);
      }
    }

    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  useEffect(() => {
    if (!openMenu) return undefined;

    // A posicao deixa de ser confiavel quando a conversa rola ou a janela muda de tamanho.
    const closeMenu = () => setOpenMenu(null);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, [openMenu]);

  function getMessageMenuPosition(trigger) {
    const rect = trigger.getBoundingClientRect();
    const viewportMargin = 8;
    const gap = 6;
    const menuWidth = Math.min(230, Math.max(0, window.innerWidth - viewportMargin * 2));
    const estimatedMenuHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
    const spaceAbove = rect.top - viewportMargin;
    const opensAbove = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, window.innerHeight - viewportMargin * 2);
    const menuHeight = Math.min(estimatedMenuHeight, availableHeight);
    const rawTop = opensAbove
      ? rect.top - gap - menuHeight
      : rect.bottom + gap;
    const top = Math.max(
      viewportMargin,
      Math.min(rawTop, window.innerHeight - viewportMargin - menuHeight),
    );
    const left = Math.max(
      viewportMargin,
      Math.min(rect.right - menuWidth, window.innerWidth - viewportMargin - menuWidth),
    );

    return { top, left, maxHeight: availableHeight };
  }

  const openMenuMessage = openMenu
    ? messageItems.find((item) => getSafeText(item?.id) === openMenu.id)
    : null;

  return (
    <div className="inbox-messages inbox-message-lane" style={{ ...styles.messages, padding: isMobile ? '0.85rem 0.85rem 1rem' : styles.messages.padding }} ref={scrollRef}>
      <div style={{ ...styles.historySearchSticky, top: isMobile ? '-0.85rem' : styles.historySearchSticky.top, paddingTop: isMobile ? '0.85rem' : styles.historySearchSticky.paddingTop }}>
        {historySearchOpen ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onHistorySearch(draftSearch.trim());
            }}
            style={{ ...styles.historySearchWrap, padding: isMobile ? '0.55rem' : styles.historySearchWrap.padding }}
          >
            <div style={styles.historySearchField}>
              <Search size={15} strokeWidth={2.2} style={styles.searchIcon} />
              <input
                autoFocus
                style={styles.historySearchInput}
                placeholder="Buscar neste historico"
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                aria-label="Buscar no historico desta conversa"
              />
            </div>
            <button type="submit" className="inbox-control" style={styles.historySearchBtn}>
              Buscar
            </button>
            <button
              type="button"
              className="inbox-control"
              style={styles.historySearchClearBtn}
              onClick={() => {
                setDraftSearch('');
                onHistorySearch('');
                setHistorySearchOpen(false);
              }}
              aria-label="Fechar busca no historico"
              title="Fechar busca"
            >
              <X size={15} />
            </button>
          </form>
        ) : (
          <div style={styles.historySearchToggleRow}>
            <button
              type="button"
              className="inbox-control"
              style={styles.historySearchToggle}
              onClick={() => setHistorySearchOpen(true)}
              aria-expanded="false"
              aria-label="Buscar no historico desta conversa"
              title="Buscar no historico"
            >
              <Search size={14} />
              {isMobile ? null : 'Buscar no histórico'}
            </button>
          </div>
        )}

        {trimmedHistorySearch ? (
          <div style={styles.historySearchMeta}>
            Resultados para "{trimmedHistorySearch}"
          </div>
        ) : null}
      </div>

      {loading ? <Empty>Carregando historico...</Empty> : (
        <>
          {hasMoreMessages && (
            <div style={styles.loadMoreWrap}>
              <button
                onClick={handleLoadMoreMessages}
                disabled={loadingMoreMessages}
                style={{ ...styles.loadMoreBtn, opacity: loadingMoreMessages ? 0.7 : 1 }}
              >
                {loadingMoreMessages ? 'Carregando...' : trimmedHistorySearch ? 'Carregar mais resultados' : 'Carregar mais'}
              </button>
            </div>
          )}
          {messageItems.map((message, index) => {
            const messageKey = getSafeText(message?.id, `msg-${index}`);

            if (!message || typeof message !== 'object') {
              console.error('[inbox] item de historico invalido:', message);
              return (
                <MessageRenderErrorBoundary key={`invalid-${index}`} messageId={`invalid-${index}`}>
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                    <div style={{ background: 'rgba(245, 158, 11, 0.08)', color: 'var(--warning)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245, 158, 11, 0.2)', fontWeight: 700 }}>
                      Uma entrada invalida do historico foi ignorada.
                    </div>
                  </div>
                </MessageRenderErrorBoundary>
              );
            }

            try {
              const quotedText = getSafeText(message.quotedMsgBody);
              const bodyText = getSafeText(message.body);
              const messageAgentName = getSafeText(message.agent?.name, 'Voce');
              const messageUserName = getSafeText(message.user?.name, 'Sistema');

              if (message._separator) {
                return (
                  <MessageRenderErrorBoundary key={`sep-${index}`} messageId={message.id || `sep-${index}`}>
                    <div style={styles.separator}>
                      <div style={styles.sepLine} />
                      <div style={styles.sepLabel}>
                        {message.isCurrent ? 'sessão atual' : `sessão anterior · ${new Date(message.date).toLocaleDateString('pt-BR')}`}
                      </div>
                      <div style={styles.sepLine} />
                    </div>
                  </MessageRenderErrorBoundary>
                );
              }

              if (message._type === 'event') {
                let payload = {};
                try {
                  if (typeof message.payload === 'string') {
                    payload = JSON.parse(message.payload || '{}');
                  } else if (typeof message.payload === 'object' && message.payload !== null) {
                    payload = message.payload;
                  }
                } catch (error) {
                  console.error('Erro ao processar payload do evento:', error);
                }

                const summaryText = getSafeText(payload?.summary);

                if (message.type === 'ia_summary' && summaryText) {
                  return (
                    <MessageRenderErrorBoundary key={messageKey} messageId={message.id}>
                      <div style={styles.summaryCard}>
                        <div style={styles.summaryHeader}>
                          <span>Resumo de contexto</span>
                          <Sparkles size={14} strokeWidth={2.2} />
                        </div>
                        <div style={styles.summaryBody}>{summaryText}</div>
                      </div>
                    </MessageRenderErrorBoundary>
                  );
                }

                if (message.type === 'note') {
                  const noteText = payload?.note || payload?.text || message.payload || '';
                  return (
                    <MessageRenderErrorBoundary key={messageKey} messageId={message.id}>
                      <div style={styles.noteWrap}>
                        <div style={styles.noteCard}>
                          <div style={styles.noteHeader}>
                            <Lock size={12} style={{ color: 'var(--accent)', marginRight: 6 }} />
                            <span>Nota Interna • {messageUserName}</span>
                          </div>
                          <div style={styles.noteBody}>{noteText}</div>
                          <div style={styles.noteTime}>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                        </div>
                      </div>
                    </MessageRenderErrorBoundary>
                  );
                }

                const eventLabel = {
                  assigned: 'Assumiu o atendimento',
                  transferred: `Transferiu para ${getSafeText(payload?.teamName, 'outra equipe')}`,
                  resolved: 'Encerrou o atendimento',
                  reopened: 'Reabriu o atendimento',
                  os_created: `Abriu a O.S. ${getSafeText(payload?.seqOs, '')} no iLux`,
                  ooo_message: 'Aviso de fora de horario enviado',
                }[message.type] || message.type;

                return (
                  <MessageRenderErrorBoundary key={messageKey} messageId={message.id}>
                    <div style={styles.eventWrap}>
                      <div style={styles.eventBadge}>
                        {messageUserName} - {eventLabel} {message.createdAt ? `em ${new Date(message.createdAt).toLocaleDateString('pt-BR')} as ${new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </div>
                    </div>
                  </MessageRenderErrorBoundary>
                );
              }

              const senderName = message.fromMe ? (message.fromBot ? `Bot ${botName}` : messageAgentName) : selectedContactName;
              const hasCardMedia = Boolean(message.mediaUrl) && ['image', 'document', 'video'].includes(message.mediaType);
              const senderColor = message.fromBot ? 'var(--text-msg-ai)' : 'var(--ink-dim)';
              const messageTime = fmt(message.createdAt);
              // Agrupa mensagens seguidas do mesmo remetente (5 min) — cara de conversa.
              let prevMsg = null;
              for (let back = index - 1; back >= 0; back -= 1) {
                const candidate = messageItems[back];
                if (candidate && typeof candidate === 'object' && !candidate._separator && candidate._type !== 'event') { prevMsg = candidate; break; }
              }
              const sameGroup = Boolean(
                prevMsg
                && Boolean(prevMsg.fromMe) === Boolean(message.fromMe)
                && Boolean(prevMsg.fromBot) === Boolean(message.fromBot)
                && Math.abs(new Date(message.createdAt).getTime() - new Date(prevMsg.createdAt).getTime()) < 5 * 60 * 1000
              );
              const bubbleBg = message.fromBot
                ? 'var(--bg-msg-ai)'
                : (message.fromMe ? 'var(--outbound)' : 'var(--inbound)');
              const bubbleBorder = message.fromBot ? '1px solid var(--border-msg-ai)' : '1px solid transparent';
              const quoteExternalId = getSafeText(message.quotedMsgId).trim();
              const quotedOriginal = quoteExternalId
                ? messageItems.find((item) => item && typeof item === 'object' && (
                  getSafeText(item.externalId).trim() === quoteExternalId
                  || getSafeText(item.id).trim() === quoteExternalId
                ))
                : null;
              const quotedSender = quotedOriginal
                ? (quotedOriginal.fromMe ? getSafeText(quotedOriginal.agent?.name, 'Você') : selectedContactName)
                : (message.fromMe ? selectedContactName : 'Você');
              return (
                <MessageRenderErrorBoundary key={messageKey} messageId={message.id}>
                  <div
                    className="inbox-msg-row"
                    data-msg-key={getSafeText(message.externalId) || messageKey}
                    data-flash={flashKey && flashKey === (getSafeText(message.externalId).trim() || messageKey) ? '1' : undefined}
                    style={{ ...styles.bubbleWrap, justifyContent: message.fromMe ? 'flex-end' : 'flex-start', marginTop: sameGroup ? '2px' : '0.7rem' }}
                  >
                    <div
                      className="inbox-bubble"
                      data-from={message.fromMe ? 'out' : 'in'}
                      data-tail={sameGroup ? '0' : '1'}
                      style={{
                        ...styles.bubble,
                        '--bubble-bg': bubbleBg,
                        maxWidth: isMobile ? '88%' : styles.bubble.maxWidth,
                        background: 'var(--bubble-bg)',
                        color: message.fromBot ? 'var(--text-msg-ai)' : 'var(--ink)',
                        opacity: message.isDeleted ? 0.6 : 1,
                        textDecoration: message.isDeleted ? 'line-through' : 'none',
                        border: bubbleBorder,
                        alignItems: 'flex-start',
                      }}
                    >
                      <div style={{ ...styles.messageHeader, marginBottom: sameGroup ? '0.15rem' : '0.3rem' }}>
                        {sameGroup ? <span /> : (
                          <div
                            style={{
                              ...styles.messageSender,
                              color: senderColor,
                              opacity: message.fromBot ? 0.88 : 1,
                            }}
                          >
                            {message.fromBot ? <Bot size={13} strokeWidth={2.2} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> : null}
                            {senderName}
                          </div>
                        )}
                        <div style={styles.messageHeaderSide}>
                          <div style={styles.messageHeaderTime}>{messageTime}</div>
                          {!message.isDeleted && (
                            <div className="inbox-msg-menu" style={styles.messageMenuRoot} data-message-menu-root="true">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const position = getMessageMenuPosition(event.currentTarget);
                                  setOpenMenu((current) => current?.id === messageKey ? null : {
                                    id: messageKey,
                                    ...position,
                                  });
                                }}
                                style={styles.messageMenuTrigger}
                                title="Mais ações"
                              >
                                <MoreVertical size={15} strokeWidth={2.3} />
                              </button>

                            </div>
                          )}
                        </div>
                      </div>

                      {quotedText ? (
                        <button
                          type="button"
                          className="inbox-quote"
                          style={styles.quotedRich}
                          onClick={() => quoteExternalId && scrollToMessage(quoteExternalId)}
                          disabled={!quoteExternalId}
                          title={quoteExternalId ? 'Ir para a mensagem original' : undefined}
                        >
                          <span style={styles.quotedSender}>{quotedSender}</span>
                          <span style={styles.quotedSnippet}>{quotedText}</span>
                        </button>
                      ) : null}

                      <MediaContent message={message} onImageClick={onImageClick} styles={styles} />
                      {bodyText ? (
                        <div style={{ marginTop: message.mediaUrl ? '10px' : 0 }}>
                          <MessageBody text={bodyText} fromMe={message.fromMe} styles={styles} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </MessageRenderErrorBoundary>
              );
            } catch (error) {
              console.error('[inbox] erro ao montar item do historico:', messageKey, error, message);
              return (
                <MessageRenderErrorBoundary key={`failed-${messageKey}`} messageId={messageKey}>
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                    <div
                      style={{
                        background: 'rgba(245, 158, 11, 0.08)',
                        color: 'var(--warning)',
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(245, 158, 11, 0.2)',
                        fontWeight: 700,
                        maxWidth: 'min(92%, 640px)',
                        textAlign: 'center',
                      }}
                    >
                      Esta mensagem nao pode ser exibida, mas o restante do historico continua disponivel.
                    </div>
                  </div>
                </MessageRenderErrorBoundary>
              );
            }
          })}
          {!messageItems.length && (
            <Empty>
              {trimmedHistorySearch ? (
                <>
                  Nenhum resultado para "{trimmedHistorySearch}" nesta conversa
                  <div style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>Tente buscar por outro termo.</div>
                </>
              ) : (
                'Nenhuma mensagem neste atendimento ainda'
              )}
            </Empty>
          )}
        </>
      )}

      {openMenu && openMenuMessage && typeof document !== 'undefined' ? createPortal(
        <div
          data-message-menu-root="true"
          style={{
            ...styles.messageMenuPanel,
            top: openMenu.top,
            left: openMenu.left,
            right: 'auto',
            maxHeight: openMenu.maxHeight,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" style={styles.messageMenuItem} onClick={() => { setReplyingTo(openMenuMessage); setOpenMenu(null); }}>
            Responder
          </button>
          <button type="button" style={styles.messageMenuItem} onClick={() => { setForwardingMessage(openMenuMessage); setOpenMenu(null); }}>
            Encaminhar mensagem
          </button>
          <button type="button" style={styles.messageMenuItem} onClick={() => { handleCopyMessage(openMenuMessage); setOpenMenu(null); }}>
            Copiar texto
          </button>
          {openMenuMessage.mediaUrl && (
            <button type="button" style={styles.messageMenuItem} onClick={() => { triggerMediaDownload(getMediaUrl(openMenuMessage.mediaUrl)); setOpenMenu(null); }}>
              Baixar
            </button>
          )}
          {openMenuMessage.fromMe && canDeleteMessage && (
            <button type="button" style={{ ...styles.messageMenuItem, ...styles.messageMenuItemDanger }} onClick={() => { handleDeleteMessage(openMenuMessage.id); setOpenMenu(null); }}>
              Apagar para o cliente
            </button>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
});

const COMPOSER_EMOJIS = ['😀', '😃', '😊', '😉', '😍', '🥰', '😂', '🤣', '😅', '🙂', '🙌', '👏', '👍', '👎', '🙏', '🤝', '💪', '👋', '👌', '✅', '⚠️', '❌', '❤️', '💛', '🎉', '📌', '📎', '📞', '📄', '🖨️', '💳', '💰', '🕐', '🚚', '🔧', '💻'];

export const MessageComposer = React.memo(function MessageComposer({
  files,
  filteredQuick,
  fmtTime,
  handleInput,
  handleSend,
  isMobile,
  isRecording,
  replyingTo,
  selectedTicket,
  setFiles,
  setFilteredQuick,
  setReplyingTo,
  setShowScheduling,
  startRecording,
  stopRecording,
  styles,
  setText,
  text,
  recordingTime,
  isNote,
  setIsNote,
  isDisconnected,
  onReconnect,
  sendingMessage,
  onQuickResponseUse,
  instances,
  outboundInstanceId,
  setOutboundInstanceId,
  outboundOptions,
  outboundOptionsLoading,
  officialTemplateKey,
  setOfficialTemplateKey,
  officialTemplateValues,
  setOfficialTemplateValues,
  onReactivateConsent,
}) {
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const wasSendingRef = useRef(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const closeOutside = (event) => {
      if (!emojiPickerRef.current?.contains(event.target)) setEmojiOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [emojiOpen]);

  useEffect(() => {
    const input = textInputRef.current;
    if (!input) return;

    const minHeight = isMobile ? 46 : 44;
    const maxHeight = isMobile ? 180 : 240;

    input.style.height = 'auto';
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [text, isMobile]);

  // O campo permanece montado durante o envio. Quando a requisição termina,
  // devolvemos o foco ao textarea para o atendente continuar digitando sem
  // precisar clicar novamente (inclusive após envio de anexo ou nota).
  useEffect(() => {
    const wasSending = wasSendingRef.current;
    wasSendingRef.current = sendingMessage;
    if (!wasSending || sendingMessage || isDisconnected || isRecording) return undefined;

    const frame = requestAnimationFrame(() => textInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [sendingMessage, isDisconnected, isRecording]);

  function appendFiles(incomingFiles, sourceLabel = 'anexos') {
    const rejectedFiles = [];
    const normalizedFiles = incomingFiles
      .map((file, index) => ensureDraftFile(file, sourceLabel === 'colagem' ? `imagem-colada-${index + 1}` : 'anexo'))
      .filter((file) => {
        if (!file) return false;
        if (file.size > MAX_DRAFT_FILE_SIZE) {
          rejectedFiles.push(`${file.name} (limite de 20 MB)`);
          return false;
        }
        return true;
      });

    if (rejectedFiles.length) {
      toast.error(`Arquivo(s) ignorado(s): ${rejectedFiles.join(', ')}`);
    }

    if (!normalizedFiles.length) return;

    setFiles((previous) => {
      const existingKeys = new Set(previous.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const availableSlots = Math.max(0, MAX_DRAFT_FILES - previous.length);
      const uniqueFiles = normalizedFiles.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });
      const acceptedFiles = uniqueFiles.slice(0, availableSlots);
      if (uniqueFiles.length > acceptedFiles.length) {
        toast.info(`O envio aceita no mÃ¡ximo ${MAX_DRAFT_FILES} anexos por vez.`);
      }
      return [...previous, ...acceptedFiles];
    });
  }

  function handleFileSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    appendFiles(selectedFiles, 'arquivo');
    event.target.value = '';
  }

  function handlePaste(event) {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (!imageFiles.length) return;

    event.preventDefault();
    appendFiles(imageFiles, 'colagem');
    toast.success(imageFiles.length === 1 ? 'Imagem colada no envio' : `${imageFiles.length} imagens coladas no envio`);
  }

  const showInstancePicker = (instances || []).filter((i) => !String(i.instanceName || '').startsWith('DELETED_')).length > 1
    || outboundOptions?.mode === 'official';
  const selectedTemplate = (outboundOptions?.templates || []).find(
    (tpl) => `${tpl.name}|${tpl.language}` === officialTemplateKey
  ) || null;
  const templatePreview = selectedTemplate
    ? String((selectedTemplate.components || []).find((c) => String(c?.type).toUpperCase() === 'BODY')?.text || '')
        .replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => (officialTemplateValues?.[Number(n) - 1] || `{{${n}}}`))
    : '';
  const outboundBannerBase = {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '5px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.74rem', fontWeight: 600,
  };
  const outboundFieldStyle = {
    padding: '4px 8px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--paper-line)',
    background: 'var(--paper)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)',
    fontSize: '0.74rem', maxWidth: '100%',
  };
  const composerTabStyle = (active) => ({
    padding: '3px 2px 6px',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--ink)' : 'var(--ink-faint)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color .15s, border-color .15s',
  });

  function insertEmoji(emoji) {
    const input = textInputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    handleInput(nextText);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      const nextCursor = start + emoji.length;
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <>
      {filteredQuick.length > 0 && (
        <div style={styles.quickList}>
          {filteredQuick.map((response) => (
            <div key={response.id} style={styles.quickItem} onClick={() => { setText(response.message); setFilteredQuick([]); onQuickResponseUse?.(response.id); }}>
              <strong>{response.shortcut}</strong>: {response.message}
            </div>
          ))}
        </div>
      )}

      <div className="inbox-composer" style={{ ...styles.inputArea, padding: isMobile ? '0.75rem' : '1rem 1.5rem' }}>
        {/* Tipo de envio à esquerda (abas), canal de saída à direita (discreto). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '4px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '16px' }}>
            <button type="button" onClick={() => setIsNote(false)} style={composerTabStyle(!isNote)}>
              Responder
            </button>
            <button type="button" onClick={() => setIsNote(true)} style={composerTabStyle(isNote)}>
              Nota interna
            </button>
          </div>
          {!isNote && showInstancePicker ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>enviar por</span>
              <select
                aria-label="Enviar mensagem pela instância"
                value={outboundInstanceId || ''}
                onChange={(event) => setOutboundInstanceId?.(event.target.value)}
                style={{ ...outboundFieldStyle, maxWidth: isMobile ? 150 : 220 }}
              >
                <option value="">Selecione a instância…</option>
                {(instances || [])
                  .filter((item) => !String(item.instanceName || '').startsWith('DELETED_'))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {(item.instanceName || item.id).replace(/^[a-z0-9]+_/i, '')}
                      {item.provider === 'evolution_official' ? ' · Oficial' : ' · QR'}
                    </option>
                  ))}
              </select>
              {outboundOptionsLoading ? <span aria-label="Validando instância" style={{ fontSize: '0.72rem', color: 'var(--ink-faint)' }}>…</span> : null}
            </label>
          ) : null}
        </div>

        {!isNote && (outboundOptions?.optedOut || outboundOptions?.mode === 'official') ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {outboundOptions?.optedOut ? (
              <div style={{ ...outboundBannerBase, background: 'var(--danger-light, #fdecec)', color: 'var(--danger, #b42318)', border: '1px solid var(--danger-border, #f3b9b3)' }}>
                <span style={{ flex: '1 1 220px', minWidth: 0 }}>⛔ Este contato pediu para não receber mensagens (opt-out).</span>
                {onReactivateConsent ? (
                  <button
                    type="button"
                    onClick={onReactivateConsent}
                    style={{ ...outboundFieldStyle, cursor: 'pointer', fontWeight: 700, borderColor: 'currentColor' }}
                  >
                    Reativar consentimento
                  </button>
                ) : null}
              </div>
            ) : outboundOptions?.mode === 'official' ? (
              outboundOptions.window?.open ? (
                <div style={{ ...outboundBannerBase, background: 'var(--success-light, #e7f6ec)', color: 'var(--success, #1a7f37)', border: '1px solid var(--success-border, #b7e0c4)' }}>
                  ● Janela de 24h aberta
                  {outboundOptions.window?.expiresAt
                    ? ` até ${new Date(outboundOptions.window.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                    : ''} — texto livre liberado.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ ...outboundBannerBase, background: 'var(--warning-light, #fef6e7)', color: 'var(--warning, #9a6700)', border: '1px solid var(--warning-border, #f3dca6)' }}>
                    ⚠ Janela de 24h encerrada. Só um template aprovado pela Meta pode ser enviado.
                  </div>
                  <select
                    value={officialTemplateKey || ''}
                    onChange={(event) => { setOfficialTemplateKey?.(event.target.value); setOfficialTemplateValues?.([]); }}
                    style={outboundFieldStyle}
                  >
                    <option value="">Selecione um template…</option>
                    {(outboundOptions.templates || []).map((tpl) => (
                      <option key={`${tpl.name}|${tpl.language}`} value={`${tpl.name}|${tpl.language}`}>
                        {tpl.name} ({tpl.language}) · {tpl.category}
                      </option>
                    ))}
                  </select>
                  {selectedTemplate && selectedTemplate.variableCount > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {Array.from({ length: selectedTemplate.variableCount }).map((_, idx) => (
                        <input
                          key={idx}
                          placeholder={`Variável {{${idx + 1}}}`}
                          value={officialTemplateValues?.[idx] || ''}
                          onChange={(event) => {
                            const next = [...(officialTemplateValues || [])];
                            next[idx] = event.target.value;
                            setOfficialTemplateValues?.(next);
                          }}
                          style={outboundFieldStyle}
                        />
                      ))}
                    </div>
                  ) : null}
                  {selectedTemplate ? (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
                      {templatePreview || '(template sem corpo de texto)'}
                    </div>
                  ) : null}
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {replyingTo ? (
          <div style={styles.replyBanner}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.replyLabel}>
                Respondendo a {replyingTo.fromMe ? 'voce' : getContactDisplayName(selectedTicket.contact, 'cliente')}
              </div>
              <div style={styles.replyPreview}>
                {getSafeText(replyingTo.body) || (replyingTo.mediaType ? `[${replyingTo.mediaType}]` : 'Mídia')}
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} style={styles.replyDismiss} aria-label="Cancelar resposta">
              <X size={14} strokeWidth={2.4} />
            </button>
          </div>
        ) : null}

        {isDisconnected && !isNote ? (
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-5)',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-color)',
            color: 'var(--text-muted)'
          }}>
            <span style={{ minWidth: 0, flex: '1 1 240px', fontSize: isMobile ? '0.85rem' : '0.95rem', textAlign: 'center', lineHeight: 'var(--leading-normal)' }}>
              Não é possível enviar mensagens pois a conexão dessa conversa foi desconectada. Inicie a conexão novamente para continuar a conversa.
            </span>
            <button
              onClick={onReconnect}
              style={{
                background: 'var(--accent)',
                color: 'var(--text-inverse)',
                border: 'none',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              Reconectar
            </button>
          </div>
        ) : isRecording ? (
          <div style={styles.recordingWrap}>
            <div style={styles.recordingDot} />
            <span style={styles.recordingTime}>{fmtTime(recordingTime)}</span>
            <button style={styles.stopBtn} onClick={stopRecording}>Parar e enviar</button>
          </div>
        ) : (
          <>
            {sendingMessage ? (
              <div
                role="status"
                aria-live="polite"
                style={styles.sendingStatus}
              >
                <LoaderCircle size={15} className="spin" />
                {isNote ? 'Salvando nota interna...' : 'Enviando mensagem...'}
                <span style={styles.sendingStatusHint}>Você pode continuar digitando.</span>
              </div>
            ) : null}
            <div className="inbox-composer-shell" style={{ ...styles.composerShell, gap: isMobile ? '0.55rem' : styles.composerShell.gap, padding: isMobile ? '0.55rem' : styles.composerShell.padding }}>
              {!isNote && (
                <button type="button" style={{ ...styles.attachBtn, width: isMobile ? '42px' : styles.attachBtn.width, height: isMobile ? '42px' : styles.attachBtn.height }} onClick={() => fileInputRef.current?.click()} title="Adicionar anexo" aria-label="Adicionar anexo">
                  <Paperclip size={18} strokeWidth={2.4} />
                </button>
              )}

              <div ref={emojiPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
                <button type="button" style={{ ...styles.attachBtn, width: isMobile ? '42px' : styles.attachBtn.width, height: isMobile ? '42px' : styles.attachBtn.height }} onClick={() => setEmojiOpen((open) => !open)} title="Inserir emoji" aria-label="Abrir seletor de emojis" aria-expanded={emojiOpen}>
                  <Smile size={18} strokeWidth={2.4} />
                </button>
                {emojiOpen ? (
                  <div style={styles.emojiPicker} role="dialog" aria-label="Selecionar emoji">
                    <div style={styles.emojiPickerTitle}>Emojis</div>
                    <div style={styles.emojiGrid}>
                      {COMPOSER_EMOJIS.map((emoji) => <button type="button" key={emoji} style={styles.emojiButton} onClick={() => insertEmoji(emoji)} aria-label={`Inserir ${emoji}`}>{emoji}</button>)}
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={styles.composerCenter}>
                {files.length > 0 && !isNote ? (
                  <div style={styles.draftAttachmentList}>
                    {files.map((file, index) => (
                      <DraftAttachmentPreview
                        key={`${getSafeText(file?.name, 'arquivo')}-${index}`}
                        file={file}
                        onRemove={() => setFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                        styles={styles}
                      />
                    ))}
                  </div>
                ) : null}

                <textarea
                  ref={textInputRef}
                  style={{
                    ...styles.textInput,
                    minHeight: isMobile ? '46px' : '44px',
                    maxHeight: isMobile ? '180px' : '240px',
                    fontSize: isMobile ? '0.88rem' : '0.97rem',
                  }}
                  rows={1}
                  value={text}
                  onChange={(event) => handleInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  onPaste={isNote ? undefined : handlePaste}
                  placeholder={isNote ? 'Escrever nota interna privada (invisível para o cliente)...' : (isMobile ? 'Mensagem...' : 'Digite sua mensagem...')}
                  spellCheck={false}
                />
              </div>

              <button
                style={{
                  ...styles.sendBtn,
                  width: isMobile ? '44px' : '48px',
                  height: isMobile ? '44px' : '48px',
                  background: (!text.trim() && files.length === 0 && !isNote) ? 'var(--bg-panel)' : 'var(--accent)',
                  border: (!text.trim() && files.length === 0 && !isNote) ? '1px solid var(--border-color)' : 'none',
                  color: (!text.trim() && files.length === 0 && !isNote) ? 'var(--text-muted)' : 'var(--text-inverse)',
                  fontSize: isMobile ? '1rem' : '1.1rem',
                }}
                onClick={(!text.trim() && files.length === 0 && !isNote) ? startRecording : handleSend}
                disabled={isNote && !text.trim()}
              >
                {(!text.trim() && files.length === 0 && !isNote) ? <Mic size={18} strokeWidth={2.4} /> : <SendHorizontal size={18} strokeWidth={2.4} />}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={handleFileSelection}
                style={{ display: 'none' }}
              />

            </div>
          </>
        )}
      </div>
    </>
  );
});
