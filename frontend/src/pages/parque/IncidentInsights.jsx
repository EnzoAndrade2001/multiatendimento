import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Box, CheckCircle2, ChevronDown, CircleHelp, Clock3, History, MapPin, Route, Truck, Wrench } from 'lucide-react';
import { getParkDecisionHistory } from '../../services/api';

const fmtDate = (value) => value ? new Date(value).toLocaleString('pt-BR') : 'Não informado';

function Empty({ children }) {
  return <div className="park-insight-empty">{children}</div>;
}

/**
 * Detalhes gerenciais progressivos para um card da fila.
 * Não busca dados: aceita o incidente enriquecido pelo backend e tolera campos ausentes.
 */
export default function IncidentInsights({ incident, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState('execution');
  const [remoteAudit, setRemoteAudit] = useState(null);
  const os = incident?.serviceOrder || incident?.openServiceOrder || incident?.os || null;
  const logistics = incident?.logistics || incident?.fulfillment || incident?.openServiceOrder?.logistics || incident?.supply || {};
  const explanation = incident?.explainability || incident?.explanation || incident?.decisionExplanation || {};
  const audit = remoteAudit || incident?.auditTrail || incident?.decisionHistory || incident?.activities || [];
  const reasons = useMemo(() => explanation.reasons || incident?.recommendationReasons || incident?.evidence || [], [explanation, incident]);

  useEffect(() => {
    if (open && tab === 'audit' && remoteAudit == null && incident?.id) {
      getParkDecisionHistory(incident.id).then(({ data }) => setRemoteAudit(data?.history || []))
        .catch(() => setRemoteAudit([]));
    }
  }, [open, tab, remoteAudit, incident?.id]);

  return (
    <section className={`park-insights ${open ? 'open' : ''}`}>
      <button className="park-insights-toggle" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span><CircleHelp size={14} /> Acompanhamento da ocorrência</span>
        <ChevronDown size={15} />
      </button>
      {open && <div className="park-insights-body">
        <div className="park-insights-tabs" role="tablist" aria-label="Contexto da ocorrência">
          <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>Pós-O.S.</TabButton>
          <TabButton active={tab === 'logistics'} onClick={() => setTab('logistics')}>Logística</TabButton>
          <TabButton active={tab === 'why'} onClick={() => setTab('why')}>Por que?</TabButton>
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>Decisões da ocorrência</TabButton>
        </div>

        {tab === 'execution' && (os ? <div className="park-execution-grid">
          <Insight icon={<Wrench size={15} />} label="Ordem de serviço" value={os.number || os.externalId || os.id} />
          <Insight icon={<Clock3 size={15} />} label="Status / atualização" value={`${os.status || 'Aberta'} · ${fmtDate(os.dueAt || os.promisedAt || os.updatedAt)}`} warning={os.overdue} />
          <Insight icon={<Truck size={15} />} label="Atendimento" value={os.technicianName || os.assigneeName || 'Sem técnico atribuído'} warning={!os.technicianName && !os.assigneeName} />
          <Insight icon={<CheckCircle2 size={15} />} label="Próximo marco" value={os.nextMilestone || os.nextStep || os.technicalNotes || 'Definir próxima etapa'} warning={!os.nextMilestone && !os.nextStep && !os.technicalNotes} />
        </div> : <Empty>Nenhuma O.S. vinculada. Ao abrir uma ordem, status, técnico, prazo e próximo marco aparecerão aqui.</Empty>)}

        {tab === 'logistics' && <div className="park-execution-grid">
          <Insight icon={<Box size={15} />} label="Estoque" value={logistics.stockStatus || logistics.inventoryStatus || (logistics.stockAvailable != null ? `${logistics.stockAvailable} disponível(is)` : 'Não integrado')} warning={!logistics.stockStatus && !logistics.inventoryStatus && logistics.stockAvailable == null} />
          <Insight icon={<Truck size={15} />} label="Entrega / visita" value={logistics.deliveryStatus || (logistics.estimatedDeliveryAt ? fmtDate(logistics.estimatedDeliveryAt) : logistics.deliveryEta ? fmtDate(logistics.deliveryEta) : logistics.visitAt ? fmtDate(logistics.visitAt) : 'Sem previsão')} warning={!logistics.deliveryStatus && !logistics.estimatedDeliveryAt && !logistics.deliveryEta && !logistics.visitAt} />
          <Insight icon={<Route size={15} />} label="Rota" value={logistics.route || logistics.routeName || logistics.routeStatus || 'Não planejada'} warning={!logistics.route && !logistics.routeName && !logistics.routeStatus} />
          <Insight icon={<MapPin size={15} />} label="Responsável" value={logistics.technician || logistics.ownerName || logistics.carrierName || 'Não atribuído'} warning={!logistics.technician && !logistics.ownerName && !logistics.carrierName} />
        </div>}

        {tab === 'why' && <div className="park-explanation">
          <div className="park-confidence"><span>Confiança da recomendação</span><b>{explanation.confidenceLabel || explanation.confidence || incident?.recommendation?.confidence || incident?.confidenceLabel || incident?.confidence || 'Não calculada'}</b></div>
          <p>{explanation.summary || incident?.recommendation?.explanation || incident?.recommendationExplanation || 'A recomendação foi produzida pelas regras operacionais disponíveis.'}</p>
          {Array.isArray(reasons) && reasons.length > 0 && <ul>{reasons.slice(0, 5).map((r, i) => <li key={i}>{typeof r === 'string' ? r : r.label || r.description || r.value}</li>)}</ul>}
          <div className="park-data-quality"><AlertTriangle size={14} /><span>{(explanation.missingData || explanation.missing)?.length ? `Dados ausentes: ${(explanation.missingData || explanation.missing).join(', ')}` : 'Nenhuma limitação adicional informada.'}</span></div>
        </div>}

        {tab === 'audit' && (audit.length ? <ol className="park-context-audit">{audit.slice(0, 12).map((item, i) => <li key={item.id || i}>
          <History size={14} /><div><b>{item.title || item.action || item.type}</b><span>{item.actorName || item.userName || 'Sistema'} · {fmtDate(item.createdAt || item.at)}</span>{(item.note || item.reason) && <p>{item.note || item.reason}</p>}</div>
        </li>)}</ol> : <Empty>A ocorrência ainda não possui decisões registradas no contexto.</Empty>)}
      </div>}
    </section>
  );
}

function Insight({ icon, label, value, warning }) {
  return <div className={warning ? 'park-insight warning' : 'park-insight'}><i>{icon}</i><div><span>{label}</span><b>{value}</b></div></div>;
}

function TabButton({ active, onClick, children }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}
