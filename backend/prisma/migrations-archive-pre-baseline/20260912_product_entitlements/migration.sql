CREATE TABLE "Feature" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "category" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

CREATE TABLE "ProductPlan" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0, "monthlyPrice" DECIMAL(12,2) NOT NULL DEFAULT 0, "limits" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductPlan_code_key" ON "ProductPlan"("code");

CREATE TABLE "PlanFeature" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "featureId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "limits" JSONB,
  CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanFeature_planId_featureId_key" ON "PlanFeature"("planId", "featureId");
CREATE INDEX "PlanFeature_featureId_idx" ON "PlanFeature"("featureId");

CREATE TABLE "TenantFeatureOverride" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "featureId" TEXT NOT NULL,
  "enabled" BOOLEAN, "limits" JSONB, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantFeatureOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantFeatureOverride_tenantId_featureId_key" ON "TenantFeatureOverride"("tenantId", "featureId");
CREATE INDEX "TenantFeatureOverride_featureId_idx" ON "TenantFeatureOverride"("featureId");

ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catálogo comercial inicial. Os registros são editáveis pelo painel mestre.
INSERT INTO "ProductPlan" ("id", "code", "name", "description", "position", "limits", "updatedAt") VALUES
('plan-essential', 'essential', 'Essencial', 'Operação de atendimento', 10, '{"maxUsers":5,"maxConnections":1}', CURRENT_TIMESTAMP),
('plan-professional', 'professional', 'Profissional', 'Atendimento integrado ao iLux', 20, '{"maxUsers":10,"maxConnections":5}', CURRENT_TIMESTAMP),
('plan-enterprise', 'enterprise', 'Enterprise', 'Automação e gestão completa', 30, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Feature" ("id", "key", "name", "category", "updatedAt") VALUES
('feat-dashboard','dashboard','Dashboard','operacao',CURRENT_TIMESTAMP),
('feat-inbox','inbox','Atendimento WhatsApp','operacao',CURRENT_TIMESTAMP),
('feat-contacts','contacts','Clientes e contatos','operacao',CURRENT_TIMESTAMP),
('feat-internal-chat','internal_chat','Chat interno','equipe',CURRENT_TIMESTAMP),
('feat-crm','crm','CRM 360 iLux','ilux',CURRENT_TIMESTAMP),
('feat-service-orders','service_orders','Ordens de serviço iLux','ilux',CURRENT_TIMESTAMP),
('feat-campaigns','campaigns','Campanhas','automacao',CURRENT_TIMESTAMP),
('feat-ai-bot','ai_bot','Robô de IA','automacao',CURRENT_TIMESTAMP),
('feat-ai-knowledge','ai_knowledge','Base de treinamento da IA','automacao',CURRENT_TIMESTAMP),
('feat-billing','billing','Financeiro e cobrança','negocio',CURRENT_TIMESTAMP),
('feat-billing-reports','billing_reports','Relatórios de cobrança','negocio',CURRENT_TIMESTAMP),
('feat-leads','lead_generation','Prospecção','negocio',CURRENT_TIMESTAMP),
('feat-printguard','printguard','PrintGuard','monitoramento',CURRENT_TIMESTAMP),
('feat-telemetry','telemetry','Telemetria','monitoramento',CURRENT_TIMESTAMP),
('feat-park-health','park_health','Saúde do parque','monitoramento',CURRENT_TIMESTAMP),
('feat-sentinel','ilux_sentinel','iLux Sentinela','monitoramento',CURRENT_TIMESTAMP),
('feat-audit','audit','Auditoria','seguranca',CURRENT_TIMESTAMP)
,
('feat-connections','connections','Conexões WhatsApp','operacao',CURRENT_TIMESTAMP),
('feat-quick-responses','quick_responses','Respostas rápidas','operacao',CURRENT_TIMESTAMP),
('feat-privacy','privacy','Privacidade','seguranca',CURRENT_TIMESTAMP),
('feat-settings','settings','Ajustes operacionais','sistema',CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Essencial: operação base. Profissional: base + colaboração/iLux/automação.
INSERT INTO "PlanFeature" ("id", "planId", "featureId", "enabled")
SELECT 'pf-e-' || f."id", 'plan-essential', f."id", true FROM "Feature" f WHERE f."key" IN ('dashboard','inbox','contacts','audit','connections','quick_responses','privacy','settings')
ON CONFLICT ("planId", "featureId") DO NOTHING;
INSERT INTO "PlanFeature" ("id", "planId", "featureId", "enabled")
SELECT 'pf-p-' || f."id", 'plan-professional', f."id", true FROM "Feature" f WHERE f."key" IN ('dashboard','inbox','contacts','audit','connections','quick_responses','privacy','settings','internal_chat','crm','service_orders','campaigns','ai_bot','ai_knowledge')
ON CONFLICT ("planId", "featureId") DO NOTHING;
INSERT INTO "PlanFeature" ("id", "planId", "featureId", "enabled")
SELECT 'pf-x-' || f."id", 'plan-enterprise', f."id", true FROM "Feature" f
ON CONFLICT ("planId", "featureId") DO NOTHING;
