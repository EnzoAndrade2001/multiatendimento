import React, { useEffect, useMemo, useState } from 'react';
import { Check, Minus, Package, Plus, Search, Trash2, X } from 'lucide-react';

export default function ProductPickerModal({
  open,
  products = [],
  selectedProducts = [],
  onSelectProduct,
  onUpdateQuantidade,
  onRemoveProduct,
  onClose,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (open) {
      setSearch('');
      setCategory('ALL');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    return products.filter((p) => {
      const nome = String(p.nome || p.descricao || '').toLowerCase();
      const codigo = String(p.codigo || '').toLowerCase();
      const tipo = String(p.tipo || '').toLowerCase();

      // Filtro de categoria
      if (category === 'TONER') {
        const isToner = nome.includes('toner') || nome.includes('cartucho') || nome.includes('tinta') || nome.includes('refil');
        if (!isToner) return false;
      } else if (category === 'PECA') {
        const isPeca = tipo.includes('peca') || nome.includes('peca') || nome.includes('peça') || nome.includes('rolete') || nome.includes('belt') || nome.includes('fusor') || nome.includes('placa');
        if (!isPeca) return false;
      } else if (category === 'CILINDRO') {
        const isCilindro = nome.includes('cilindro') || nome.includes('drum') || nome.includes('fotocondutor');
        if (!isCilindro) return false;
      }

      // Filtro de texto
      if (!term) return true;
      const searchable = `${nome} ${codigo} ${tipo}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return searchable.includes(term);
    });
  }, [products, search, category]);

  const getLocalQtd = (id) => quantities[id] || 1;
  const setLocalQtd = (id, delta) => {
    setQuantities((prev) => {
      const current = prev[id] || 1;
      return { ...prev, [id]: Math.max(1, current + delta) };
    });
  };

  if (!open) return null;

  const s = {
    overlay: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0, 0, 0, 0.82)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
    modal: { width: '780px', maxWidth: '100%', height: 'min(760px, 92vh)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '16px', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', padding: '20px 22px 14px', borderBottom: '1px solid var(--border-color)' },
    title: { margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '8px' },
    subtitle: { margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
    close: { width: '36px', height: '36px', borderRadius: '9px', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 },
    searchWrap: { position: 'relative', margin: '16px 22px 10px' },
    searchIcon: { position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' },
    search: { width: '100%', height: '44px', padding: '0 14px 0 42px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-main)', fontSize: 'var(--text-sm)', outline: 'none' },
    categories: { display: 'flex', gap: '8px', padding: '0 22px 12px', overflowX: 'auto' },
    catBtn: (active) => ({
      padding: '5px 12px',
      borderRadius: '20px',
      fontSize: 'var(--text-xs)',
      fontWeight: active ? 700 : 500,
      background: active ? 'var(--accent)' : 'var(--bg-base)',
      color: active ? 'var(--text-inverse)' : 'var(--text-muted)',
      border: active ? '1px solid var(--accent)' : '1px solid var(--border-color)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }),
    count: { padding: '0 22px 10px', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    list: { flex: 1, overflowY: 'auto', padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: '9px' },
    empty: { padding: '48px 20px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' },
    footer: { padding: '14px 22px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)' },
  };

  return (
    <div style={s.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-labelledby="product-picker-title">
        <div style={s.header}>
          <div>
            <h3 id="product-picker-title" style={s.title}>
              <Package size={20} color="var(--accent)" /> Localizar Peça, Toner ou Suprimento
            </h3>
            <p style={s.subtitle}>Selecione os suprimentos que serão utilizados ou enviados para esta Ordem de Serviço.</p>
          </div>
          <button type="button" style={s.close} onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>

        <div style={s.searchWrap}>
          <Search size={18} style={s.searchIcon} />
          <input
            autoFocus
            style={s.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquise por ex: Brother, TN450, D203, Ricoh, Película, Rolo, Papel..."
          />
        </div>

        <div style={s.categories}>
          {[
            { id: 'ALL', label: 'Todos os Itens' },
            { id: 'TONER', label: 'Toners & Tintas' },
            { id: 'PECA', label: 'Peças & Componentes' },
            { id: 'CILINDRO', label: 'Cilindros & Fotocondutores' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              style={s.catBtn(category === cat.id)}
              onClick={() => setCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div style={s.count}>
          <span>{filteredProducts.length} produto(s) encontrado(s)</span>
          {selectedProducts.length > 0 && (
            <span style={{ color: 'var(--accent)', fontWeight: 800 }}>
              {selectedProducts.reduce((acc, p) => acc + (p.quantidade || 1), 0)} un selecionada(s)
            </span>
          )}
        </div>

        <div style={s.list}>
          {filteredProducts.length === 0 ? (
            <div style={s.empty}>
              <div>Nenhum produto ou suprimento encontrado para "{search}".</div>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    marginTop: '10px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--accent)',
                    borderRadius: '8px',
                    padding: '6px 14px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Limpar busca
                </button>
              )}
            </div>
          ) : null}

          {filteredProducts.map((prod) => {
            const added = selectedProducts.find(
              (p) => (prod.id && p.produtoId === prod.id) || p.nome.toLowerCase() === (prod.nome || '').toLowerCase()
            );
            const currentQtd = added ? (added.quantidade || 1) : (getLocalQtd(prod.id));

            return (
              <div
                key={prod.id}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '11px',
                  border: added ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                  background: added ? 'rgba(227, 30, 36, 0.12)' : 'var(--bg-base)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                    {prod.codigo && (
                      <span
                        style={{
                          color: 'var(--accent)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 800,
                          border: '1px solid var(--accent)',
                          borderRadius: '6px',
                          padding: '1px 6px',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        Cód: {prod.codigo}
                      </span>
                    )}
                    {prod.tipo && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-panel)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        {prod.tipo}
                      </span>
                    )}
                  </div>

                  <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)', display: 'block', wordBreak: 'break-word' }}>
                    {prod.nome || prod.descricao}
                  </strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {added ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--bg-panel)',
                        padding: '4px 8px',
                        borderRadius: '8px',
                        border: '1px solid var(--accent)',
                      }}
                    >
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--accent)', marginRight: '4px' }}>
                        ✓ {added.quantidade} un
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantidade(prod.id, -1)}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'var(--text-main)',
                        }}
                        title="Diminuir"
                      >
                        <Minus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantidade(prod.id, 1)}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'var(--text-main)',
                        }}
                        title="Aumentar"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveProduct(prod.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                        title="Remover produto da O.S."
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          background: 'var(--bg-panel)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setLocalQtd(prod.id, -1)}
                          style={{
                            width: '26px',
                            height: '28px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <Minus size={12} />
                        </button>
                        <span
                          style={{
                            width: '26px',
                            textAlign: 'center',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 700,
                            color: 'var(--text-main)',
                          }}
                        >
                          {currentQtd}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLocalQtd(prod.id, 1)}
                          style={{
                            width: '26px',
                            height: '28px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectProduct(prod, currentQtd);
                          setQuantities((prev) => ({ ...prev, [prod.id]: 1 }));
                        }}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'var(--accent)',
                          color: 'var(--text-inverse)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Plus size={14} /> Adicionar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={s.footer}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-main)' }}>
            {selectedProducts.length === 0
              ? 'Nenhum suprimento selecionado'
              : `${selectedProducts.reduce((acc, p) => acc + (p.quantidade || 1), 0)} item(ns) vinculados`}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--text-inverse)',
              fontWeight: 800,
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
