CREATE TABLE "AttendanceTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'task',
  "status" TEXT NOT NULL DEFAULT 'open',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "assigneeId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "teamId" TEXT,
  "contactId" TEXT,
  "ticketId" TEXT,
  "serviceOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTask_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AttendanceTask_tenantId_assigneeId_status_dueAt_idx" ON "AttendanceTask"("tenantId", "assigneeId", "status", "dueAt");
CREATE INDEX "AttendanceTask_tenantId_teamId_status_dueAt_idx" ON "AttendanceTask"("tenantId", "teamId", "status", "dueAt");
