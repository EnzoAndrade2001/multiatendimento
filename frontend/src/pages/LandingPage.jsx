import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bot, 
  ShieldCheck, 
  Users, 
  Zap, 
  LayoutDashboard, 
  Sparkles, 
  MessageSquare, 
  HelpCircle, 
  ChevronDown, 
  Award, 
  Target, 
  Brain, 
  Cpu, 
  Send, 
  Menu, 
  X, 
  ArrowUpRight, 
  DollarSign, 
  Clock, 
  Settings,
  Phone
} from 'lucide-react';

// Custom SVGs for Athenix Labs branding
const LogoSymbol = ({ size = 42 }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 10px rgba(255, 106, 0, 0.6))' }}>
    <path d="M48 12L15 85H27L38 58H62L73 85H85L52 12H48ZM50 25.5L59.5 49H40.5L50 25.5Z" fill="url(#goldGradient)" />
    <path d="M50 39L43 49L50 59L57 49L50 39Z" fill="url(#crystalGradient)" style={{ filter: 'drop-shadow(0 0 6px #FF6A00)' }} />
    <path d="M30 65C45 59 55 59 70 65" stroke="url(#goldGradient)" strokeWidth="3" strokeLinecap="round" />
    <defs>
      <linearGradient id="goldGradient" x1="15" y1="12" x2="85" y2="85" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F2D06B" />
        <stop offset="50%" stopColor="#D4AF37" />
        <stop offset="100%" stopColor="#9A7B1C" />
      </linearGradient>
      <linearGradient id="crystalGradient" x1="43" y1="39" x2="57" y2="59" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FF9A52" />
        <stop offset="50%" stopColor="#FF6A00" />
        <stop offset="100%" stopColor="#A63D00" />
      </linearGradient>
    </defs>
  </svg>
);

const HelmetIcon = () => (
  <svg aria-hidden="true" focusable="false" width="50" height="50" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.4))' }}>
    <path d="M50 6C38 6 22 17 22 38C22 41 24 43 26 43C29 43 32 32 50 32C68 32 71 43 74 43C76 43 78 41 78 38C78 17 62 6 50 6Z" fill="url(#goldGradientIcon)" />
    <path d="M26 48C26 34 36 30 50 30C64 30 74 34 74 48V63C74 68 70 73 66 75L50 65L34 75C30 73 26 68 26 63V48Z" fill="url(#goldGradientIcon)" stroke="#D4AF37" strokeWidth="1" />
    <path d="M46 48H54V63C54 65 52 67 50 67C48 67 46 65 46 63V48Z" fill="#0D1B2A" />
    <path d="M36 48H64V53H36V48Z" fill="#0D1B2A" />
    <path d="M50 37L47 42L50 47L53 42L50 37Z" fill="#FF6A00" style={{ filter: 'drop-shadow(0 0 4px #FF6A00)' }} />
    <defs>
      <linearGradient id="goldGradientIcon" x1="22" y1="6" x2="78" y2="75" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F2D06B" />
        <stop offset="100%" stopColor="#9A7B1C" />
      </linearGradient>
    </defs>
  </svg>
);

const OwlIcon = () => (
  <svg aria-hidden="true" focusable="false" width="50" height="50" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.4))' }}>
    <path d="M50 15C35 15 25 25 25 45C25 65 35 83 50 83C65 83 75 65 75 45C75 25 65 15 50 15Z" stroke="#D4AF37" strokeWidth="2.5" fill="#0D1B2A" />
    <circle cx="40" cy="38" r="11" stroke="#D4AF37" strokeWidth="2" fill="#0A0A0A" />
    <circle cx="60" cy="38" r="11" stroke="#D4AF37" strokeWidth="2" fill="#0A0A0A" />
    <circle cx="40" cy="38" r="4.5" fill="#FF6A00" style={{ filter: 'drop-shadow(0 0 5px #FF6A00)' }} />
    <circle cx="60" cy="38" r="4.5" fill="#FF6A00" style={{ filter: 'drop-shadow(0 0 5px #FF6A00)' }} />
    <path d="M50 43L46 49H54L50 43Z" fill="#D4AF37" />
    <path d="M38 58C45 61 55 61 62 58" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" />
    <path d="M41 64C47 66 53 66 59 64" stroke="#D4AF37" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M26 23L38 18M74 23L62 18" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CrystalIcon = () => (
  <svg aria-hidden="true" focusable="false" width="50" height="50" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 10px rgba(255, 106, 0, 0.6))' }}>
    <path d="M50 8L82 40L50 92L18 40L50 8Z" stroke="#D4AF37" strokeWidth="2.5" fill="url(#crystalGradIcon)" />
    <path d="M50 8V92" stroke="rgba(212, 175, 55, 0.4)" strokeWidth="1.5" />
    <path d="M18 40H82" stroke="rgba(212, 175, 55, 0.4)" strokeWidth="1.5" />
    <path d="M50 8L34 40L50 92L66 40L50 8Z" stroke="rgba(212, 175, 55, 0.5)" strokeWidth="1.5" fill="rgba(255, 106, 0, 0.1)" />
    <defs>
      <linearGradient id="crystalGradIcon" x1="18" y1="8" x2="82" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FF9A52" />
        <stop offset="50%" stopColor="#FF6A00" />
        <stop offset="100%" stopColor="#A63D00" />
      </linearGradient>
    </defs>
  </svg>
);

const OrbitIcon = () => (
  <svg aria-hidden="true" focusable="false" width="50" height="50" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(255, 106, 0, 0.5))' }}>
    <circle cx="50" cy="50" r="11" fill="#FF6A00" style={{ filter: 'drop-shadow(0 0 8px #FF6A00)' }} />
    <circle cx="50" cy="50" r="11" stroke="#D4AF37" strokeWidth="1.5" />
    <ellipse cx="50" cy="50" rx="38" ry="13" stroke="#D4AF37" strokeWidth="1.8" style={{ transform: 'rotate(30deg)', transformOrigin: '50px 50px' }} />
    <circle cx="20" cy="33" r="4.5" fill="#FF6A00" />
    <ellipse cx="50" cy="50" rx="38" ry="13" stroke="#D4AF37" strokeWidth="1.8" style={{ transform: 'rotate(-30deg)', transformOrigin: '50px 50px' }} />
    <circle cx="80" cy="33" r="4.5" fill="#D4AF37" />
    <ellipse cx="50" cy="50" rx="38" ry="13" stroke="#FF6A00" strokeWidth="1.5" style={{ transform: 'rotate(90deg)', transformOrigin: '50px 50px' }} />
    <circle cx="50" cy="12" r="4.5" fill="#FF6A00" />
  </svg>
);

export default function LandingPage() {
  const navigate = useNavigate();
  
  // States for interactive widgets
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState(null);
  const [calcAgents, setCalcAgents] = useState(5);
  const [calcChats, setCalcChats] = useState(150);

  // CRM Live Demo Animation State
  const [demoStep, setDemoStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDemoStep((prev) => (prev + 1) % 4);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  // Carrega as fontes via <link> (preconnect + stylesheet) em vez de @import no <style>,
  // que bloqueia a renderização inicial da página. Idempotente para evitar duplicidade
  // caso o componente remonte.
  useEffect(() => {
    if (document.querySelector('link[data-athenix-fonts]')) return;

    const preconnectGoogle = document.createElement('link');
    preconnectGoogle.rel = 'preconnect';
    preconnectGoogle.href = 'https://fonts.googleapis.com';
    preconnectGoogle.setAttribute('data-athenix-fonts', 'true');

    const preconnectGstatic = document.createElement('link');
    preconnectGstatic.rel = 'preconnect';
    preconnectGstatic.href = 'https://fonts.gstatic.com';
    preconnectGstatic.crossOrigin = 'anonymous';
    preconnectGstatic.setAttribute('data-athenix-fonts', 'true');

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700;800;900&family=Cinzel:wght@600;700;800;900&family=Montserrat:wght@300;400;500;600;700;800&display=swap';
    stylesheet.setAttribute('data-athenix-fonts', 'true');

    document.head.appendChild(preconnectGoogle);
    document.head.appendChild(preconnectGstatic);
    document.head.appendChild(stylesheet);
  }, []);

  // ROI Calculations
  const hoursSaved = Math.round((calcChats * 5.5 / 60) * 22 * (calcAgents * 0.45));
  const estimatedSavings = (calcAgents * 1650 + calcChats * 1.8).toLocaleString('pt-BR', { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 0 
  });
  const efficiencyBonus = Math.min(95, 30 + calcAgents * 2.5);

  const toggleFaq = (idx) => {
    setActiveFaq(activeFaq === idx ? null : idx);
  };

  const faqData = [
    {
      q: "A Athenix Labs oferece suporte para quantos atendentes?",
      a: "Ilimitados! Nossa arquitetura multi-tenant foi projetada para que você possa cadastrar quantas equipes, departamentos e agentes precisar para utilizar um mesmo número de WhatsApp simultaneamente."
    },
    {
      q: "Preciso de um número de WhatsApp exclusivo?",
      a: "Sim, recomendamos usar um número de celular dedicado para sua operação de atendimento comercial. A conexão com o sistema Athenix é feita de forma simples e estável via leitura de QR Code, similar ao WhatsApp Web."
    },
    {
      q: "Como funciona a inteligência artificial (IA) integrada?",
      a: "Utilizamos a API avançada do Gemini (Google DeepMind). Ela realiza a transcrição automática de mensagens de áudio dos clientes em texto inteligível na tela, gera resumos automáticos dos históricos de conversas longas e sugere respostas rápidas e contextualizadas para os atendentes economizarem tempo."
    },
    {
      q: "Os planos possuem fidelidade ou multa rescisória?",
      a: "Não. Todos os planos da Athenix Labs são mensais, sem qualquer tipo de fidelidade ou taxa de cancelamento. Você pode alterar seu plano ou encerrar o serviço quando desejar."
    },
    {
      q: "É seguro contra bloqueios no WhatsApp?",
      a: "Nossa integração utiliza instâncias dedicadas via Evolution API com controle inteligente de delay e fila de disparo, minimizando exponencialmente os riscos. Fornecemos também consultoria de boas práticas para garantir a segurança do seu número."
    }
  ];

  return (
    <div style={s.container}>
      {/* Dynamic Styles Injection */}
      <style>{`
        html {
          scroll-behavior: smooth;
        }
        
        .glow-hover:hover {
          box-shadow: 0 0 25px rgba(255, 106, 0, 0.45);
          transform: translateY(-2px);
        }
        
        .gold-border-hover:hover {
          border-color: #D4AF37 !important;
          box-shadow: 0 0 15px rgba(212, 175, 55, 0.2);
        }
        
        @keyframes rotateHalo {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        
        @keyframes floatEffect {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0px); }
        }
        
        @keyframes pulseGlow {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
        
        .animated-halo {
          animation: rotateHalo 45s linear infinite;
        }
        
        .float-dashboard {
          animation: floatEffect 6s ease-in-out infinite;
        }
        
        .pulse-crystal {
          animation: pulseGlow 4s ease-in-out infinite;
        }

        /* Custom inputs and sliders styling */
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: #152232;
          height: 6px;
          border-radius: 999px;
          outline: none;
        }
        
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #D4AF37;
          cursor: pointer;
          border: 2px solid #0A0A0A;
          box-shadow: 0 0 10px #D4AF37;
          transition: transform 0.1s ease;
        }
        
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        @media (max-width: 1024px) {
          .nav-links-desktop { display: none !important; }
          .menu-toggle { display: block !important; }
          .hero-grid { grid-template-columns: 1fr !important; text-align: center; }
          .hero-text-align { display: flex; flex-direction: column; align-items: center; }
          .roi-flex { flex-direction: column !important; gap: 2rem !important; }
        }
        
        @media (max-width: 768px) {
          .pricing-grid { grid-template-columns: 1fr !important; }
          .essence-grid { grid-template-columns: 1fr !important; }
          .footer-grid { grid-template-columns: 1fr !important; gap: 3rem !important; text-align: center; }
          .footer-logo-align { display: flex; flex-direction: column; align-items: center; }
        }

        @media (max-width: 480px) {
          .hero-metrics { gap: 2rem !important; flex-wrap: wrap; justify-content: center; }
          .crm-mock-sidebar { display: none !important; }
        }
      `}</style>

      {/* 1. Header (Navbar) */}
      <nav style={s.navbar}>
        <div style={s.navContent}>
          <div style={s.brandWrapper}>
            <LogoSymbol size={44} />
            <div style={s.brandText}>
              <span style={s.brandName}>ATHENIX</span>
              <span style={s.brandSubName}>LABS</span>
            </div>
          </div>

          <div className="nav-links-desktop" style={s.navLinks}>
            <a href="#essencia" style={s.navLink}>Essência</a>
            <a href="#demo" style={s.navLink}>Demonstração</a>
            <a href="#ai-features" style={s.navLink}>Inteligência IA</a>
            <a href="#roi" style={s.navLink}>Cálculo de ROI</a>
            <a href="#precos" style={s.navLink}>Licenciamento</a>
            <a href="#faq" style={s.navLink}>Dúvidas</a>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              onClick={() => navigate('/login')} 
              className="gold-border-hover" 
              style={s.loginBtn}
            >
              Acessar Sistema
            </button>
            <button 
              className="menu-toggle" 
              onClick={() => setMobileMenuOpen(true)} 
              style={{ display: 'none', background: 'transparent', border: 'none', color: '#D4AF37', cursor: 'pointer' }}
            >
              <Menu size={28} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div style={s.mobileMenu}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid rgba(212,175,55,0.15)' }}>
            <div style={s.brandWrapper}>
              <LogoSymbol size={36} />
              <div style={s.brandText}>
                <span style={{ ...s.brandName, fontSize: '1.1rem' }}>ATHENIX</span>
                <span style={{ ...s.brandSubName, fontSize: '0.65rem' }}>LABS</span>
              </div>
            </div>
            <button onClick={() => setMobileMenuOpen(false)} style={{ background: 'transparent', border: 'none', color: '#D4AF37', cursor: 'pointer' }}>
              <X size={28} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '3rem 2rem', fontSize: '1.2rem', fontWeight: 600 }}>
            <a href="#essencia" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Essência</a>
            <a href="#demo" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Demonstração</a>
            <a href="#ai-features" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Inteligência IA</a>
            <a href="#roi" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Cálculo de ROI</a>
            <a href="#precos" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Licenciamento</a>
            <a href="#faq" onClick={() => setMobileMenuOpen(false)} style={s.mobileNavLink}>Dúvidas</a>
            <button 
              onClick={() => { setMobileMenuOpen(false); navigate('/login'); }} 
              style={{ ...s.loginBtn, width: '100%', padding: '1rem', marginTop: '2rem' }}
            >
              Acessar Sistema
            </button>
          </div>
        </div>
      )}

      {/* 2. Hero Section */}
      <section style={s.heroSection}>
        {/* Background Halos and Glows */}
        <div className="animated-halo" style={s.haloBackground} />
        <div className="pulse-crystal" style={s.blueGlowBackground} />
        
        <div className="hero-grid" style={s.heroGrid}>
          <div className="hero-text-align" style={s.heroTextSide}>
            <div style={s.badge}>
              <Sparkles size={14} color="#FF6A00" style={{ marginRight: '8px' }} />
              <span>INTELIGÊNCIA • ESTRATÉGIA • INOVAÇÃO</span>
            </div>
            
            <h1 style={s.heroTitle}>
              A Inteligência que Organiza.<br />
              <span style={s.heroTitleGold}>A Estratégia que Vende.</span>
            </h1>
            
            <p style={s.heroSubtitle}>
              O ecossistema definitivo de atendimento no WhatsApp para empresas de alta performance. 
              Centralize contatos, distribua conversas por setores estratégicos e multiplique sua produtividade 
              com a IA do Gemini.
            </p>

            <div style={s.heroCtaGroup}>
              <button 
                onClick={() => navigate('/login')} 
                className="glow-hover" 
                style={s.heroPrimaryBtn}
              >
                Testar Sistema Grátis <ArrowUpRight size={18} style={{ marginLeft: '6px' }} />
              </button>
              <a 
                href="https://wa.me/555194412679?text=Ol%C3%A1%2C%20gostaria%20de%20saber%20mais%20sobre%20a%20Athenix%20Labs" 
                target="_blank" 
                rel="noopener noreferrer"
                className="gold-border-hover" 
                style={s.heroSecondaryBtn}
              >
                Falar com Especialista
              </a>
            </div>

            <div className="hero-metrics" style={s.heroMetrics}>
              <div style={s.metricItem}>
                <span style={s.metricNumber}>+300%</span>
                <span style={s.metricLabel}>Agilidade de Resposta</span>
              </div>
              <div style={{ ...s.metricItem, borderLeft: '1px solid rgba(212,175,55,0.15)', paddingLeft: '2rem' }}>
                <span style={s.metricNumber}>24h</span>
                <span style={s.metricLabel}>Operação Ininterrupta</span>
              </div>
            </div>
          </div>

          {/* Hero Right Side - Athenix CRM Mockup */}
          <div id="demo" className="float-dashboard" style={s.heroVisualSide}>
            <div style={s.crmWrapper}>
              {/* Header do Mockup */}
              <div style={s.crmHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={s.greenDot} />
                  <span style={s.crmTitle}>Athenix Central</span>
                </div>
                <div style={s.crmHeaderBadge}>Evolution API Ativa</div>
              </div>

              {/* Corpo do Mockup */}
              <div style={s.crmBody}>
                {/* Lateral do Painel */}
                <div className="crm-mock-sidebar" style={s.crmSidebar}>
                  <div style={{ ...s.crmSideItem, background: '#12253a' }}>
                    <div style={s.avatarSmall}>D</div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <span style={s.crmSideName}>Diego (Admin)</span>
                      <span style={s.crmSideRole}>Vendas</span>
                    </div>
                  </div>
                  <div style={s.crmSideItem}>
                    <div style={s.avatarSmall}>A</div>
                    <div style={{ flex: 1 }}>
                      <span style={s.crmSideName}>Ana Costa</span>
                    </div>
                  </div>
                  <div style={s.crmSideItem}>
                    <div style={s.avatarSmall}>🤖</div>
                    <div style={{ flex: 1 }}>
                      <span style={s.crmSideName}>Athenix AI</span>
                    </div>
                  </div>
                </div>

                {/* Área do Chat */}
                <div style={s.crmChatArea}>
                  <div style={s.crmChatHeader}>
                    <span style={{ fontWeight: 700 }}>Marcos Silva</span>
                    <span style={s.crmChatTag}>Setor Comercial</span>
                  </div>

                  <div style={s.crmMessages}>
                    {/* Mensagem 1 - Cliente */}
                    <div style={s.msgContainerLeft}>
                      <div style={s.msgLeft}>
                        Gostaria de saber se a IA de vocês transcreve áudio automaticamente e resume conversas.
                      </div>
                      <span style={s.msgTime}>19:30</span>
                    </div>

                    {/* Mensagem 2 - IA Gemini (Resumo Sugestão) */}
                    {(demoStep >= 1) && (
                      <div style={{ ...s.msgContainerLeft, animation: 'fadeIn 0.5s ease-out' }}>
                        <div style={s.msgAi}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#FF6A00', fontWeight: 800, marginBottom: '6px', fontSize: '0.8rem' }}>
                            <Bot size={14} />
                            <span>ATHENIX AI (GEMINI)</span>
                          </div>
                          <strong>Resumo do Cliente:</strong> Solicita confirmação de transcrição de áudio e resumo. <br />
                          <strong>Sugestão de resposta:</strong> Confirmar que transcreve em tempo real e resume com 1 clique.
                        </div>
                      </div>
                    )}

                    {/* Mensagem 3 - Atendente Respondendo */}
                    {(demoStep >= 2) && (
                      <div style={{ ...s.msgContainerRight, animation: 'fadeIn 0.5s ease-out' }}>
                        <div style={s.msgRight}>
                          Olá Marcos! Sim, transcrevemos áudios automaticamente e você gera resumos de chats inteiros com apenas 1 clique.
                        </div>
                        <span style={s.msgTime}>19:31 - Diego</span>
                      </div>
                    )}

                    {/* Digitando indicador */}
                    {demoStep === 3 && (
                      <div style={{ display: 'flex', gap: '4px', padding: '8px 12px', background: '#0D1B2A', borderRadius: '12px', width: 'fit-content', color: '#A0A0A0', fontSize: '0.8rem' }}>
                        <span style={{ animation: 'pulse 1.5s infinite' }}>Athenix AI está refinando resposta...</span>
                      </div>
                    )}
                  </div>

                  {/* Input do chat */}
                  <div style={s.crmChatInput}>
                    <input type="text" placeholder="Escreva sua mensagem estratégica..." readOnly style={s.crmInput} />
                    <button style={s.crmSendBtn}><Send size={16} color="#0A0A0A" /></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Integration Banner */}
      <div style={s.integrationBanner}>
        <span style={s.integrationText}>INTEGRADO COM AS MELHORES TECNOLOGIAS DO MERCADO:</span>
        <div style={s.integrationGrid}>
          <div style={s.integrationBadge}>WhatsApp Business</div>
          <div style={s.integrationBadge}>Evolution API</div>
          <div style={s.integrationBadge}>Google Gemini AI</div>
          <div style={s.integrationBadge}>NodeJS / Express</div>
          <div style={s.integrationBadge}>React / Vite</div>
          <div style={s.integrationBadge}>PostgreSQL</div>
        </div>
      </div>

      {/* 4. Brand Essence (Pilares) */}
      <section id="essencia" style={s.essenceSection}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>A Essência da Marca</h2>
          <div style={s.sectionDivider} />
          <p style={s.sectionSubtitle}>
            A inteligência grega combinada com a precisão tecnológica. Conheça as diretrizes que tornam a Athenix Labs única.
          </p>
        </div>

        <div className="essence-grid" style={s.essenceGrid}>
          <div style={s.essenceCard}>
            <div style={s.essenceIconWrapper}><HelmetIcon /></div>
            <h3 style={s.essenceCardTitle}>Estratégia</h3>
            <p style={s.essenceCardText}>
              Organização militar de filas de atendimento, painéis inteligentes para os gerentes e distribuição de demandas por competência técnica das equipes.
            </p>
          </div>

          <div style={s.essenceCard}>
            <div style={s.essenceIconWrapper}><OwlIcon /></div>
            <h3 style={s.essenceCardTitle}>Sabedoria</h3>
            <p style={s.essenceCardText}>
              Decisões baseadas em dados consolidados. Relatórios analíticos automatizados, dashboards interativos de performance e insights valiosos em tempo real.
            </p>
          </div>

          <div style={s.essenceCard}>
            <div style={s.essenceIconWrapper}><CrystalIcon /></div>
            <h3 style={s.essenceCardTitle}>Tecnologia</h3>
            <p style={s.essenceCardText}>
              Conexões robustas de alta latência via Evolution API e processamento cognitivo profundo de áudios e mensagens utilizando o motor do Gemini.
            </p>
          </div>

          <div style={s.essenceCard}>
            <div style={s.essenceIconWrapper}><OrbitIcon /></div>
            <h3 style={s.essenceCardTitle}>Inovação</h3>
            <p style={s.essenceCardText}>
              Campanhas ativas de atração automatizadas, disparos recorrentes customizados e fluxos de URA inteligente para autoatendimento.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Gemini AI Highlights */}
      <section id="ai-features" style={s.aiSection}>
        <div style={s.aiSectionContent}>
          <div className="pulse-crystal" style={s.aiGlowBall} />
          <div style={s.aiVisualBlock}>
            <div style={s.crystalBigWrapper}>
              <CrystalIcon />
            </div>
            <div style={{ marginTop: '2rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 900, color: '#FF6A00', letterSpacing: '0.15em' }}>MÓDULO GEMINI ACTIVATED</span>
              <h3 style={{ fontSize: '1.5rem', marginTop: '0.5rem', color: '#D4AF37', fontFamily: "'Cinzel', serif" }}>Athenix Cognitive AI</h3>
            </div>
          </div>

          <div style={s.aiTextBlock}>
            <h2 style={s.aiTitle}>Inteligência Cognitiva Avançada</h2>
            <p style={s.aiDesc}>
              A Athenix Labs integra o modelo neural Gemini para transformar conversas passivas em inteligência operacional ativa. 
              Dê superpoderes aos seus atendentes e nunca mais perca o fio da meada em atendimentos complexos.
            </p>
            
            <div style={s.aiFeaturesList}>
              <div style={s.aiFeatureItem}>
                <div style={s.aiFeatureDot} />
                <div>
                  <h3 style={s.aiFeatureName}>Transcrição de Áudio em Tempo Real</h3>
                  <p style={s.aiFeatureDesc}>Seus agentes não precisam ouvir áudios longos. A IA transcreve a mensagem diretamente no chat de atendimento.</p>
                </div>
              </div>
              
              <div style={s.aiFeatureItem}>
                <div style={s.aiFeatureDot} />
                <div>
                  <h3 style={s.aiFeatureName}>Resumos Estratégicos com 1 Clique</h3>
                  <p style={s.aiFeatureDesc}>Ao receber atendimentos herdados de outros turnos, gere um resumo instantâneo de toda a conversa anterior em segundos.</p>
                </div>
              </div>

              <div style={s.aiFeatureItem}>
                <div style={s.aiFeatureDot} />
                <div>
                  <h3 style={s.aiFeatureName}>Sugestão Inteligente de Respostas</h3>
                  <p style={s.aiFeatureDesc}>A IA sugere automaticamente a melhor resposta para o cliente com base nas perguntas frequentes e no histórico do chat.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Interactive ROI Calculator */}
      <section id="roi" style={s.roiSection}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Simulador de Retorno (ROI)</h2>
          <div style={s.sectionDivider} />
          <p style={s.sectionSubtitle}>
            Calcule o impacto da inteligência da Athenix Labs diretamente nas contas da sua empresa. Mova os controles abaixo.
          </p>
        </div>

        <div className="roi-flex" style={s.roiFlexWrapper}>
          {/* Sliders Side */}
          <div style={s.roiSlidersSide}>
            <h3 style={{ fontSize: '1.25rem', color: '#FFF', marginBottom: '2rem', fontFamily: "'Exo 2', sans-serif" }}>Configurações de Atendimento</h3>
            
            <div style={s.sliderBlock}>
              <div style={s.sliderLabels}>
                <span style={s.sliderName}>Atendentes Ativos</span>
                <span style={s.sliderVal}>{calcAgents} agentes</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={calcAgents} 
                onChange={(e) => setCalcAgents(Number(e.target.value))} 
              />
            </div>

            <div style={{ ...s.sliderBlock, marginTop: '2.5rem' }}>
              <div style={s.sliderLabels}>
                <span style={s.sliderName}>Conversas Diárias</span>
                <span style={s.sliderVal}>{calcChats} chats / dia</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="1000" 
                value={calcChats} 
                onChange={(e) => setCalcChats(Number(e.target.value))} 
              />
            </div>
          </div>

          {/* Results Side */}
          <div style={s.roiResultsSide}>
            <div style={s.roiCardResult}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <Clock size={24} color="#D4AF37" />
                <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em', color: '#A0A0A0' }}>TEMPO POUPADO POR MÊS</span>
              </div>
              <span style={s.roiOutputVal}>{hoursSaved} Horas</span>
              <p style={{ fontSize: '0.85rem', color: '#A0A0A0', marginTop: '0.5rem' }}>Tempo liberado em automações e transcrições de áudio.</p>
            </div>

            <div style={{ ...s.roiCardResult, borderLeft: '1px solid rgba(212,175,55,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <DollarSign size={24} color="#FF6A00" />
                <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em', color: '#A0A0A0' }}>ECONOMIA ESTIMADA</span>
              </div>
              <span style={{ ...s.roiOutputVal, color: '#FF6A00' }}>R$ {estimatedSavings}</span>
              <p style={{ fontSize: '0.85rem', color: '#A0A0A0', marginTop: '0.5rem' }}>Redução de custos com base em eficiência operacional.</p>
            </div>

            <div style={{ ...s.roiCardResult, borderLeft: '1px solid rgba(212,175,55,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <Award size={24} color="#D4AF37" />
                <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em', color: '#A0A0A0' }}>ÍNDICE DE PRODUTIVIDADE</span>
              </div>
              <span style={s.roiOutputVal}>+{efficiencyBonus}%</span>
              <p style={{ fontSize: '0.85rem', color: '#A0A0A0', marginTop: '0.5rem' }}>Aceleração de respostas simultâneas no WhatsApp.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Pricing Section */}
      <section id="precos" style={s.pricingSection}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Licenciamento Premium</h2>
          <div style={s.sectionDivider} />
          <p style={s.sectionSubtitle}>
            Escolha o plano ideal para a escala de atendimento do seu negócio. Sem fidelidade, sem taxas de setup.
          </p>
        </div>

        <div className="pricing-grid" style={s.pricingGrid}>
          {/* Plano 1 */}
          <div style={s.planCard}>
            <span style={s.planType}>START</span>
            <div style={s.planPriceBlock}>
              <span style={s.planPriceSymbol}>R$</span>
              <span style={s.planPriceNumber}>149</span>
              <span style={s.planPricePeriod}>/mês</span>
            </div>
            <div style={s.planDivider} />
            <ul style={s.planFeatures}>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Até 3 Atendentes</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> 1 Conexão WhatsApp</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Integração Evolution API</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> IA Gemini (Básico)</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Suporte via Chat</li>
            </ul>
            <button onClick={() => navigate('/login')} className="gold-border-hover" style={s.planBtn}>Assinar Start</button>
          </div>

          {/* Plano 2 - Destacado (Recomendado) */}
          <div style={{ ...s.planCard, border: '2px solid #D4AF37', background: '#0e1d2e', transform: 'scale(1.03)', boxShadow: '0 15px 35px rgba(212,175,55,0.15)' }}>
            <div style={s.recommendedBadge}>MAIS ASSINADO</div>
            <span style={{ ...s.planType, color: '#D4AF37' }}>PRO ESTRATÉGICO</span>
            <div style={s.planPriceBlock}>
              <span style={s.planPriceSymbol}>R$</span>
              <span style={{ ...s.planPriceNumber, color: '#FFF' }}>299</span>
              <span style={s.planPricePeriod}>/mês</span>
            </div>
            <div style={{ ...s.planDivider, background: 'rgba(212,175,55,0.3)' }} />
            <ul style={s.planFeatures}>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> Atendentes Ilimitados</li>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> Até 3 Conexões WhatsApp</li>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> IA Gemini Completa (Transcrição + Resumos)</li>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> Módulo de Ordens de Serviço / CRM</li>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> Disparador de Campanhas</li>
              <li style={s.planFeature}><span style={{ ...s.planCheck, color: '#D4AF37' }}>✔</span> Suporte Prioritário</li>
            </ul>
            <button onClick={() => navigate('/login')} className="glow-hover" style={{ ...s.planBtn, background: '#D4AF37', color: '#0A0A0A', fontWeight: 800 }}>Assinar Pro</button>
          </div>

          {/* Plano 3 */}
          <div style={s.planCard}>
            <span style={s.planType}>ENTERPRISE</span>
            <div style={s.planPriceBlock}>
              <span style={s.planPriceSymbol}>R$</span>
              <span style={s.planPriceNumber}>599</span>
              <span style={s.planPricePeriod}>/mês</span>
            </div>
            <div style={s.planDivider} />
            <ul style={s.planFeatures}>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Conexões WhatsApp Ilimitadas</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Atendentes e Equipes Ilimitados</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> API de Integração Externa</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Banco de Dados Dedicado</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Gerente de Conta Dedicado</li>
              <li style={s.planFeature}><span style={s.planCheck}>✔</span> Onboarding Completo</li>
            </ul>
            <button onClick={() => navigate('/login')} className="gold-border-hover" style={s.planBtn}>Falar com Consultor</button>
          </div>
        </div>
      </section>

      {/* 8. FAQ Section */}
      <section id="faq" style={s.faqSection}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Perguntas Frequentes</h2>
          <div style={s.sectionDivider} />
          <p style={s.sectionSubtitle}>
            Esclareça suas principais dúvidas sobre o ecossistema de multiatendimento da Athenix Labs.
          </p>
        </div>

        <div style={s.faqWrapper}>
          {faqData.map((faq, idx) => (
            <div
              key={idx}
              role="button"
              tabIndex={0}
              aria-expanded={activeFaq === idx}
              onClick={() => toggleFaq(idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleFaq(idx);
                }
              }}
              style={{
                ...s.faqItem,
                borderBottom: idx === faqData.length - 1 ? 'none' : '1px solid rgba(212,175,55,0.15)'
              }}
            >
              <div style={s.faqQuestionBlock}>
                <span style={s.faqQuestion}>{faq.q}</span>
                <ChevronDown
                  size={18}
                  color="#D4AF37"
                  aria-hidden="true"
                  style={{
                    transform: activeFaq === idx ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s ease'
                  }}
                />
              </div>
              <div
                style={{
                  maxHeight: activeFaq === idx ? '200px' : '0px',
                  opacity: activeFaq === idx ? 1 : 0,
                  overflow: 'hidden',
                  transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
              >
                <p style={s.faqAnswer}>{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. Final CTA */}
      <section style={s.ctaSection}>
        <div style={s.ctaContent}>
          <h2 style={s.ctaTitle}>Domine seu Mercado com Estratégia e Inteligência</h2>
          <p style={s.ctaDesc}>
            Una-se às empresas inovadoras que utilizam a Athenix Labs para escalar o faturamento no WhatsApp. 
            Configure sua conta em menos de 10 minutos.
          </p>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '2.5rem' }}>
            <button 
              onClick={() => navigate('/login')} 
              className="glow-hover" 
              style={s.ctaPrimaryBtn}
            >
              Iniciar Teste Gratuito
            </button>
            <a 
              href="https://wa.me/555194412679?text=Ol%C3%A1%2C%20quero%20conhecer%20os%20recursos%20de%20IA%20da%20Athenix%20Labs" 
              target="_blank" 
              rel="noopener noreferrer"
              className="gold-border-hover"
              style={s.ctaSecondaryBtn}
            >
              Falar com Vendas
            </a>
          </div>
        </div>
      </section>

      {/* 10. Footer */}
      <footer style={s.footer}>
        <div className="footer-grid" style={s.footerGrid}>
          <div className="footer-logo-align" style={s.footerBrandBlock}>
            <div style={s.brandWrapper}>
              <LogoSymbol size={44} />
              <div style={s.brandText}>
                <span style={s.brandName}>ATHENIX</span>
                <span style={s.brandSubName}>LABS</span>
              </div>
            </div>
            <p style={s.footerTagline}>Inteligência • Estratégia • Inovação</p>
            <p style={s.footerText}>
              O CRM definitivo de atendimento para WhatsApp. Conecte múltiplos agentes, automatize com inteligência cognitiva e cresça exponencialmente.
            </p>
          </div>

          <div>
            <h4 style={s.footerHeader}>Acessos</h4>
            <div style={s.footerLinks}>
              <a href="#essencia" style={s.footerLink}>Essência da Marca</a>
              <a href="#demo" style={s.footerLink}>Simulador do CRM</a>
              <a href="#ai-features" style={s.footerLink}>Inteligência IA</a>
              <a href="#roi" style={s.footerLink}>Calculadora de ROI</a>
              <a href="#precos" style={s.footerLink}>Licenciamento</a>
            </div>
          </div>

          <div>
            <h4 style={s.footerHeader}>Contato & Suporte</h4>
            <div style={s.footerLinks}>
              <p style={s.footerContactItem}>E-mail: atendimento@lcddigital.com.br</p>
              <p style={s.footerContactItem}>Telefone: (51) 3028-4222</p>
              <p style={s.footerContactItem}>WhatsApp: (51) 9441-2679</p>
              <a href="https://www.google.com/maps/search/?api=1&query=Porto+Alegre%2C+RS%2C+Brasil" target="_blank" rel="noopener noreferrer" style={{ ...s.footerLink, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Porto Alegre, RS - Brasil <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </div>

        <div style={s.footerBottom}>
          <p>© {new Date().getFullYear()} ATHENIX LABS - TODOS OS DIREITOS RESERVADOS. PRODUTO DESENVOLVIDO POR LCD DIGITAL.</p>
        </div>
      </footer>

      {/* Floating WhatsApp Widget */}
      <a 
        href="https://wa.me/555194412679?text=Ol%C3%A1%2C%20gostaria%20de%20fazer%20um%20teste%20gr%C3%A1tis%20da%20Athenix%20Labs!" 
        target="_blank" 
        rel="noopener noreferrer" 
        className="glow-hover"
        style={s.whatsappWidget}
      >
        <Phone size={24} color="#0A0A0A" />
      </a>
    </div>
  );
}

// Full Premium Styles Object (CSS inline sem Tailwind)
const s = {
  container: {
    background: '#0A0A0A',
    color: '#FFFFFF',
    minHeight: '100vh',
    fontFamily: "'Montserrat', sans-serif",
    overflowX: 'hidden'
  },
  
  // Navbar Styles
  navbar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    background: 'rgba(10, 10, 10, 0.85)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid rgba(212, 175, 55, 0.15)',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 6%'
  },
  navContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  brandWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1
  },
  brandName: {
    fontFamily: "'Cinzel', serif",
    fontSize: '1.3rem',
    fontWeight: 900,
    color: '#FFF',
    letterSpacing: '0.05em'
  },
  brandSubName: {
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#D4AF37',
    letterSpacing: '0.28em',
    marginTop: '2px'
  },
  navLinks: {
    display: 'flex',
    gap: '2.2rem'
  },
  navLink: {
    textDecoration: 'none',
    color: '#A0A0A0',
    fontSize: '0.88rem',
    fontWeight: 600,
    transition: 'color 0.2s',
    letterSpacing: '0.02em',
    cursor: 'pointer'
  },
  loginBtn: {
    background: 'transparent',
    border: '1px solid rgba(212, 175, 55, 0.4)',
    color: '#D4AF37',
    padding: '0.65rem 1.4rem',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all 0.25s ease'
  },
  
  // Mobile Menu Styles
  mobileMenu: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#0A0A0A',
    zIndex: 2000,
    display: 'flex',
    flexDirection: 'column'
  },
  mobileNavLink: {
    color: '#FFF',
    textDecoration: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    paddingBottom: '0.8rem'
  },
  
  // Hero Styles
  heroSection: {
    minHeight: '100vh',
    padding: '160px 6% 80px',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderBottom: '1px solid rgba(212, 175, 55, 0.1)'
  },
  haloBackground: {
    position: 'absolute',
    top: '40%',
    left: '80%',
    width: '700px',
    height: '700px',
    border: '2px solid rgba(212, 175, 55, 0.08)',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: 0
  },
  blueGlowBackground: {
    position: 'absolute',
    top: '30%',
    left: '70%',
    width: '600px',
    height: '600px',
    background: 'radial-gradient(circle, rgba(255, 106, 0, 0.08) 0%, rgba(0,0,0,0) 70%)',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: 0
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 0.9fr',
    gap: '4rem',
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto',
    zIndex: 1,
    position: 'relative'
  },
  heroTextSide: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(255, 106, 0, 0.12)',
    border: '1px solid rgba(255, 106, 0, 0.25)',
    borderRadius: '999px',
    padding: '6px 16px',
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#FF6A00',
    width: 'fit-content',
    marginBottom: '2rem',
    letterSpacing: '0.06em'
  },
  heroTitle: {
    fontFamily: "'Cinzel', serif",
    fontSize: 'clamp(2.4rem, 5vw, 4rem)',
    lineHeight: 1.15,
    fontWeight: 900,
    letterSpacing: '-0.02em',
    color: '#FFF',
    margin: 0
  },
  heroTitleGold: {
    background: 'linear-gradient(to right, #F2D06B, #D4AF37)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    fontWeight: 900
  },
  heroSubtitle: {
    fontSize: '1.08rem',
    color: '#A0A0A0',
    lineHeight: 1.7,
    marginTop: '2rem',
    marginBottom: '3rem',
    maxWidth: '620px'
  },
  heroCtaGroup: {
    display: 'flex',
    gap: '1.2rem',
    flexWrap: 'wrap'
  },
  heroPrimaryBtn: {
    background: 'linear-gradient(135deg, #FF6A00, #A63D00)',
    color: '#FFF',
    border: 'none',
    padding: '1.1rem 2.2rem',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'all 0.25s ease'
  },
  heroSecondaryBtn: {
    background: 'transparent',
    border: '1px solid rgba(212, 175, 55, 0.5)',
    color: '#D4AF37',
    padding: '1.1rem 2.2rem',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: 800,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'center',
    transition: 'all 0.25s ease'
  },
  heroMetrics: {
    display: 'flex',
    gap: '4rem',
    marginTop: '4.5rem',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: '2.5rem'
  },
  metricItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  metricNumber: {
    fontSize: '2rem',
    fontWeight: 900,
    color: '#D4AF37',
    fontFamily: "'Exo 2', sans-serif"
  },
  metricLabel: {
    fontSize: '0.8rem',
    color: '#A0A0A0',
    marginTop: '4px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  
  // Hero Visual CRM Mockup Styles
  heroVisualSide: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  crmWrapper: {
    width: '100%',
    maxWidth: '560px',
    background: '#0D1B2A',
    border: '1px solid rgba(212, 175, 55, 0.2)',
    borderRadius: '20px',
    boxShadow: '0 25px 60px rgba(0,0,0,0.65)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '420px'
  },
  crmHeader: {
    background: '#050D16',
    padding: '12px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(212, 175, 55, 0.15)'
  },
  greenDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#2ecc71',
    boxShadow: '0 0 8px #2ecc71'
  },
  crmTitle: {
    fontSize: '0.85rem',
    fontWeight: 800,
    color: '#FFF',
    letterSpacing: '0.04em'
  },
  crmHeaderBadge: {
    fontSize: '0.7rem',
    background: 'rgba(255, 106, 0, 0.15)',
    border: '1px solid rgba(255, 106, 0, 0.3)',
    color: '#FF6A00',
    padding: '4px 10px',
    borderRadius: '6px',
    fontWeight: 700
  },
  crmBody: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  crmSidebar: {
    width: '140px',
    background: '#08111B',
    borderRight: '1px solid rgba(255,255,255,0.05)',
    display: 'flex',
    flexDirection: 'column',
    padding: '8px'
  },
  crmSideItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: '8px',
    marginBottom: '6px',
    cursor: 'pointer'
  },
  avatarSmall: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #F2D06B, #D4AF37)',
    color: '#0A0A0A',
    fontWeight: 800,
    fontSize: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  crmSideName: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#FFF',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block'
  },
  crmSideRole: {
    fontSize: '0.62rem',
    color: '#A0A0A0'
  },
  crmChatArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#0B1420'
  },
  crmChatHeader: {
    padding: '10px 15px',
    background: '#0D1B2A',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.8rem'
  },
  crmChatTag: {
    fontSize: '0.65rem',
    background: 'rgba(212, 175, 55, 0.12)',
    border: '1px solid rgba(212, 175, 55, 0.25)',
    color: '#D4AF37',
    padding: '2px 8px',
    borderRadius: '6px',
    fontWeight: 700
  },
  crmMessages: {
    flex: 1,
    padding: '15px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto'
  },
  msgContainerLeft: {
    alignSelf: 'flex-start',
    maxWidth: '85%'
  },
  msgLeft: {
    background: '#152538',
    color: '#FFF',
    padding: '10px 14px',
    borderRadius: '14px 14px 14px 2px',
    fontSize: '0.82rem',
    lineHeight: 1.4
  },
  msgAi: {
    background: '#0A1B2F',
    border: '1px solid rgba(255, 106, 0, 0.35)',
    color: '#FFF',
    padding: '12px 14px',
    borderRadius: '14px',
    fontSize: '0.8rem',
    lineHeight: 1.45,
    boxShadow: '0 0 15px rgba(255, 106, 0, 0.1)'
  },
  msgContainerRight: {
    alignSelf: 'flex-end',
    maxWidth: '85%'
  },
  msgRight: {
    background: '#D4AF37',
    color: '#0A0A0A',
    padding: '10px 14px',
    borderRadius: '14px 14px 2px 14px',
    fontSize: '0.82rem',
    lineHeight: 1.4,
    fontWeight: 600
  },
  msgTime: {
    fontSize: '0.62rem',
    color: '#A0A0A0',
    marginTop: '3px',
    display: 'block',
    textAlign: 'right'
  },
  crmChatInput: {
    padding: '10px 15px',
    background: '#08111B',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    borderTop: '1px solid rgba(255,255,255,0.03)'
  },
  crmInput: {
    flex: 1,
    background: '#122030',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '8px 12px',
    fontSize: '0.8rem',
    color: '#FFF',
    outline: 'none'
  },
  crmSendBtn: {
    background: '#D4AF37',
    border: 'none',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  
  // Integration Banner Styles
  integrationBanner: {
    background: '#0D1B2A',
    padding: '2.5rem 6%',
    borderTop: '1px solid rgba(212, 175, 55, 0.15)',
    borderBottom: '1px solid rgba(212, 175, 55, 0.15)',
    textAlign: 'center'
  },
  integrationText: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#D4AF37',
    letterSpacing: '0.15em',
    display: 'block',
    marginBottom: '1.5rem'
  },
  integrationGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: '1.5rem',
    flexWrap: 'wrap'
  },
  integrationBadge: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    padding: '8px 20px',
    borderRadius: '999px',
    fontSize: '0.85rem',
    color: '#A0A0A0',
    fontWeight: 600
  },
  
  // Section Headers
  sectionHeader: {
    textAlign: 'center',
    marginBottom: '4rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  sectionTitle: {
    fontFamily: "'Cinzel', serif",
    fontSize: 'clamp(1.75rem, 4vw, 2.4rem)',
    color: '#FFF',
    margin: 0
  },
  sectionDivider: {
    width: '60px',
    height: '3px',
    background: 'linear-gradient(to right, #D4AF37, #FF6A00)',
    margin: '1.5rem 0'
  },
  sectionSubtitle: {
    fontSize: '1rem',
    color: '#A0A0A0',
    maxWidth: '650px',
    lineHeight: 1.6,
    margin: 0
  },
  
  // Essence Section Styles
  essenceSection: {
    padding: '120px 6%',
    background: '#0A0A0A',
    borderBottom: '1px solid rgba(255,255,255,0.03)'
  },
  essenceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '2rem',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  essenceCard: {
    background: '#0D1B2A',
    border: '1px solid rgba(212, 175, 55, 0.1)',
    borderRadius: '20px',
    padding: '3rem 2rem',
    textAlign: 'center',
    transition: 'all 0.3s ease',
    cursor: 'default'
  },
  essenceIconWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '2rem',
    height: '60px',
    alignItems: 'center'
  },
  essenceCardTitle: {
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '1.35rem',
    fontWeight: 800,
    color: '#FFF',
    marginBottom: '1rem'
  },
  essenceCardText: {
    fontSize: '0.9rem',
    color: '#A0A0A0',
    lineHeight: 1.7,
    margin: 0
  },
  
  // AI Highlight Section Styles
  aiSection: {
    padding: '120px 6%',
    background: 'linear-gradient(180deg, #0A0A0A 0%, #050d16 100%)',
    position: 'relative',
    overflow: 'hidden',
    borderBottom: '1px solid rgba(212, 175, 55, 0.1)'
  },
  aiSectionContent: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '5rem',
    maxWidth: '1400px',
    margin: '0 auto',
    alignItems: 'center',
    position: 'relative',
    zIndex: 1
  },
  aiGlowBall: {
    position: 'absolute',
    top: '30%',
    left: '20%',
    width: '400px',
    height: '400px',
    background: 'radial-gradient(circle, rgba(255, 106, 0, 0.15) 0%, rgba(0,0,0,0) 75%)',
    pointerEvents: 'none',
    zIndex: 0
  },
  aiVisualBlock: {
    background: 'rgba(13, 27, 42, 0.4)',
    border: '1px solid rgba(255, 106, 0, 0.25)',
    borderRadius: '30px',
    padding: '4rem 3rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)'
  },
  crystalBigWrapper: {
    width: '100px',
    height: '100px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'floatEffect 5s ease-in-out infinite'
  },
  aiTextBlock: {
    display: 'flex',
    flexDirection: 'column'
  },
  aiTitle: {
    fontFamily: "'Cinzel', serif",
    fontSize: 'clamp(1.75rem, 4vw, 2.4rem)',
    color: '#FFF',
    margin: 0
  },
  aiDesc: {
    fontSize: '1.02rem',
    color: '#A0A0A0',
    lineHeight: 1.7,
    marginTop: '1.5rem',
    marginBottom: '2.5rem'
  },
  aiFeaturesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem'
  },
  aiFeatureItem: {
    display: 'flex',
    gap: '1.2rem',
    alignItems: 'flex-start'
  },
  aiFeatureDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#FF6A00',
    marginTop: '6px',
    boxShadow: '0 0 8px #FF6A00'
  },
  aiFeatureName: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: '#FFF',
    margin: 0,
    fontFamily: "'Exo 2', sans-serif"
  },
  aiFeatureDesc: {
    fontSize: '0.9rem',
    color: '#A0A0A0',
    lineHeight: 1.6,
    marginTop: '6px',
    margin: 0
  },
  
  // ROI Section Styles
  roiSection: {
    padding: '120px 6%',
    background: '#0A0A0A',
    borderBottom: '1px solid rgba(255,255,255,0.03)'
  },
  roiFlexWrapper: {
    display: 'flex',
    maxWidth: '1400px',
    margin: '0 auto',
    gap: '4rem',
    alignItems: 'stretch'
  },
  roiSlidersSide: {
    flex: 1,
    background: '#0D1B2A',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    borderRadius: '24px',
    padding: '3rem 2.5rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  sliderBlock: {
    display: 'flex',
    flexDirection: 'column'
  },
  sliderLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '1rem'
  },
  sliderName: {
    fontWeight: 700,
    fontSize: '0.92rem',
    color: '#A0A0A0'
  },
  sliderVal: {
    fontWeight: 800,
    color: '#D4AF37',
    fontSize: '1rem'
  },
  roiResultsSide: {
    flex: 1.1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: '1.5rem'
  },
  roiCardResult: {
    background: '#08111B',
    border: '1px solid rgba(255,255,255,0.03)',
    borderRadius: '20px',
    padding: '2rem 2.5rem'
  },
  roiOutputVal: {
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '2.5rem',
    fontWeight: 900,
    color: '#D4AF37'
  },
  
  // Pricing Section Styles
  pricingSection: {
    padding: '120px 6%',
    background: '#0A0A0A',
    borderBottom: '1px solid rgba(212, 175, 55, 0.1)'
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '2.5rem',
    maxWidth: '1400px',
    margin: '0 auto',
    alignItems: 'center'
  },
  planCard: {
    background: '#0D1B2A',
    border: '1px solid rgba(212, 175, 55, 0.1)',
    borderRadius: '24px',
    padding: '3.5rem 2.5rem',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    transition: 'all 0.3s ease'
  },
  recommendedBadge: {
    position: 'absolute',
    top: '-15px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#D4AF37',
    color: '#0A0A0A',
    fontSize: '0.7rem',
    fontWeight: 900,
    padding: '6px 16px',
    borderRadius: '999px',
    letterSpacing: '0.08em'
  },
  planType: {
    fontSize: '1rem',
    fontWeight: 900,
    color: '#FFF',
    letterSpacing: '0.12em',
    textAlign: 'center'
  },
  planPriceBlock: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginTop: '1.5rem',
    marginBottom: '2rem'
  },
  planPriceSymbol: {
    fontSize: '1.2rem',
    fontWeight: 800,
    color: '#D4AF37',
    marginRight: '4px'
  },
  planPriceNumber: {
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '3.2rem',
    fontWeight: 900,
    color: '#D4AF37'
  },
  planPricePeriod: {
    fontSize: '0.85rem',
    color: '#A0A0A0',
    marginLeft: '4px'
  },
  planDivider: {
    height: '1px',
    background: 'rgba(255,255,255,0.06)',
    width: '100%',
    marginBottom: '2.5rem'
  },
  planFeatures: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 3.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.2rem'
  },
  planFeature: {
    fontSize: '0.92rem',
    color: '#E0E0E0',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  planCheck: {
    color: '#FF6A00',
    fontWeight: 900
  },
  planBtn: {
    background: 'transparent',
    border: '1px solid rgba(212, 175, 55, 0.4)',
    color: '#D4AF37',
    padding: '1rem',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: 800,
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.25s ease'
  },
  
  // FAQ Section Styles
  faqSection: {
    padding: '120px 6%',
    background: '#0A0A0A',
    borderBottom: '1px solid rgba(255,255,255,0.03)'
  },
  faqWrapper: {
    maxWidth: '780px',
    margin: '0 auto',
    background: '#0D1B2A',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    borderRadius: '24px',
    padding: '1.5rem'
  },
  faqItem: {
    display: 'flex',
    flexDirection: 'column',
    padding: '1.8rem 1rem',
    cursor: 'pointer'
  },
  faqQuestionBlock: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem'
  },
  faqQuestion: {
    fontSize: '1.05rem',
    fontWeight: 800,
    color: '#FFF',
    fontFamily: "'Exo 2', sans-serif"
  },
  faqAnswer: {
    fontSize: '0.92rem',
    color: '#A0A0A0',
    lineHeight: 1.65,
    marginTop: '1.2rem',
    marginBottom: 0
  },
  
  // CTA Section
  ctaSection: {
    padding: '100px 6%',
    background: 'linear-gradient(135deg, #0d1b2a 0%, #0A0A0A 100%)',
    textAlign: 'center',
    borderBottom: '1px solid rgba(212, 175, 55, 0.15)'
  },
  ctaContent: {
    maxWidth: '850px',
    margin: '0 auto'
  },
  ctaTitle: {
    fontFamily: "'Cinzel', serif",
    fontSize: 'clamp(1.8rem, 4.2vw, 2.5rem)',
    color: '#FFF',
    margin: 0
  },
  ctaDesc: {
    fontSize: '1.05rem',
    color: '#A0A0A0',
    lineHeight: 1.7,
    marginTop: '1.5rem',
    maxWidth: '680px',
    marginInline: 'auto'
  },
  ctaPrimaryBtn: {
    background: '#D4AF37',
    color: '#0A0A0A',
    border: 'none',
    padding: '1.1rem 2.5rem',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: 900,
    cursor: 'pointer',
    transition: 'all 0.25s'
  },
  ctaSecondaryBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#FFF',
    padding: '1.1rem 2.5rem',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: 800,
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all 0.25s'
  },
  
  // Footer Styles
  footer: {
    background: '#050A10',
    padding: '100px 6% 40px',
    color: '#A0A0A0'
  },
  footerGrid: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr 1fr',
    gap: '5rem',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  footerBrandBlock: {
    display: 'flex',
    flexDirection: 'column'
  },
  footerTagline: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#D4AF37',
    letterSpacing: '0.15em',
    marginTop: '0.8rem',
    marginBottom: '1.5rem'
  },
  footerText: {
    fontSize: '0.88rem',
    lineHeight: 1.7,
    margin: 0
  },
  footerHeader: {
    fontSize: '1rem',
    fontWeight: 800,
    color: '#FFF',
    marginBottom: '2rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    fontFamily: "'Exo 2', sans-serif"
  },
  footerLinks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  footerLink: {
    color: '#A0A0A0',
    textDecoration: 'none',
    fontSize: '0.88rem',
    transition: 'color 0.2s'
  },
  footerContactItem: {
    fontSize: '0.88rem',
    margin: 0
  },
  footerBottom: {
    textAlign: 'center',
    marginTop: '6rem',
    paddingTop: '2.5rem',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    fontSize: '0.78rem',
    letterSpacing: '0.02em'
  },
  
  // WhatsApp Float Icon Widget
  whatsappWidget: {
    position: 'fixed',
    bottom: '30px',
    right: '30px',
    zIndex: 1000,
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    background: '#D4AF37',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 25px rgba(212, 175, 55, 0.45)',
    cursor: 'pointer',
    transition: 'transform 0.3s'
  }
};
