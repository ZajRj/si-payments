-- CreateTable
CREATE TABLE "AccrualBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccrualBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccrualBatch_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccrualBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Accrual" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "assignmentAmountCents" INTEGER NOT NULL,
    "activeDays" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "annulledAt" DATETIME,
    "annulledById" INTEGER,
    "annulmentReason" TEXT,
    CONSTRAINT "Accrual_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AccrualBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Accrual_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Accrual_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Accrual_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Accrual_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Accrual_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "decidedById" INTEGER,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "closedById" INTEGER,
    "closedAt" DATETIME,
    "closingNote" TEXT,
    "cancelledAt" DATETIME,
    CONSTRAINT "PaymentRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRequest_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentRequestItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestId" INTEGER NOT NULL,
    "accrualId" INTEGER NOT NULL,
    "requestedCents" INTEGER NOT NULL,
    CONSTRAINT "PaymentRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRequestItem_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "Accrual" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATETIME NOT NULL,
    "reference" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "annulledAt" DATETIME,
    "annulledById" INTEGER,
    "annulmentReason" TEXT,
    CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "accrualId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "Accrual" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PettyCashFund" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PettyCashFund_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PettyCashPeriod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fundId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingBalanceCents" INTEGER NOT NULL,
    "replenishmentCents" INTEGER NOT NULL,
    "closingBalanceCents" INTEGER,
    "openedById" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" INTEGER,
    "closedAt" DATETIME,
    CONSTRAINT "PettyCashPeriod_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashPeriod_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PettyCashVoucher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fundId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "concept" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" INTEGER,
    "decidedAt" DATETIME,
    "rejectionReason" TEXT,
    "disbursedById" INTEGER,
    "disbursedAt" DATETIME,
    "settledById" INTEGER,
    "settledAt" DATETIME,
    "spentCents" INTEGER,
    "receiptReference" TEXT,
    "receiptDate" DATETIME,
    "cancelledAt" DATETIME,
    CONSTRAINT "PettyCashVoucher_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashVoucher_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PettyCashPeriod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashVoucher_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashVoucher_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashVoucher_disbursedById_fkey" FOREIGN KEY ("disbursedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PettyCashVoucher_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccrualBatch_projectId_idx" ON "AccrualBatch"("projectId");

-- CreateIndex
CREATE INDEX "AccrualBatch_periodId_idx" ON "AccrualBatch"("periodId");

-- CreateIndex
CREATE INDEX "Accrual_batchId_idx" ON "Accrual"("batchId");

-- CreateIndex
CREATE INDEX "Accrual_assignmentId_periodId_idx" ON "Accrual"("assignmentId", "periodId");

-- CreateIndex
CREATE INDEX "Accrual_personId_idx" ON "Accrual"("personId");

-- CreateIndex
CREATE INDEX "Accrual_projectId_idx" ON "Accrual"("projectId");

-- CreateIndex
CREATE INDEX "Accrual_periodId_idx" ON "Accrual"("periodId");

-- CreateIndex
CREATE INDEX "PaymentRequest_projectId_idx" ON "PaymentRequest"("projectId");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE INDEX "PaymentRequestItem_accrualId_idx" ON "PaymentRequestItem"("accrualId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequestItem_requestId_accrualId_key" ON "PaymentRequestItem"("requestId", "accrualId");

-- CreateIndex
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");

-- CreateIndex
CREATE INDEX "Payment_personId_idx" ON "Payment"("personId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_accrualId_idx" ON "PaymentAllocation"("accrualId");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashFund_name_key" ON "PettyCashFund"("name");

-- CreateIndex
CREATE INDEX "PettyCashFund_projectId_idx" ON "PettyCashFund"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashPeriod_fundId_year_month_key" ON "PettyCashPeriod"("fundId", "year", "month");

-- CreateIndex
CREATE INDEX "PettyCashVoucher_fundId_idx" ON "PettyCashVoucher"("fundId");

-- CreateIndex
CREATE INDEX "PettyCashVoucher_periodId_idx" ON "PettyCashVoucher"("periodId");

-- Inmutabilidad de los registros financieros. Los errores se corrigen con anulaciones
-- justificadas: el único cambio permitido es anular una vez, con usuario y motivo.

CREATE TRIGGER "accrual_batch_no_update" BEFORE UPDATE ON "AccrualBatch"
BEGIN
    SELECT RAISE(ABORT, 'Los lotes de causación son inmutables');
END;

CREATE TRIGGER "accrual_batch_no_delete" BEFORE DELETE ON "AccrualBatch"
BEGIN
    SELECT RAISE(ABORT, 'Los lotes de causación son inmutables');
END;

CREATE TRIGGER "accrual_no_delete" BEFORE DELETE ON "Accrual"
BEGIN
    SELECT RAISE(ABORT, 'Las causaciones son inmutables; se anulan');
END;

CREATE TRIGGER "accrual_only_annul" BEFORE UPDATE ON "Accrual"
WHEN OLD."annulledAt" IS NOT NULL
    OR NEW."annulledAt" IS NULL
    OR NEW."annulledById" IS NULL
    OR NEW."annulmentReason" IS NULL
    OR NEW."id" IS NOT OLD."id"
    OR NEW."batchId" IS NOT OLD."batchId"
    OR NEW."assignmentId" IS NOT OLD."assignmentId"
    OR NEW."personId" IS NOT OLD."personId"
    OR NEW."projectId" IS NOT OLD."projectId"
    OR NEW."periodId" IS NOT OLD."periodId"
    OR NEW."assignmentAmountCents" IS NOT OLD."assignmentAmountCents"
    OR NEW."activeDays" IS NOT OLD."activeDays"
    OR NEW."periodDays" IS NOT OLD."periodDays"
    OR NEW."amountCents" IS NOT OLD."amountCents"
    OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
    SELECT RAISE(ABORT, 'Las causaciones son inmutables; solo se pueden anular una vez');
END;

-- Una asignación no se causa dos veces en el mismo período.
CREATE TRIGGER "accrual_unique_active" BEFORE INSERT ON "Accrual"
WHEN EXISTS (
    SELECT 1 FROM "Accrual"
    WHERE "assignmentId" = NEW."assignmentId" AND "periodId" = NEW."periodId" AND "annulledAt" IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'La asignación ya tiene una causación vigente en ese período');
END;

CREATE TRIGGER "payment_request_no_delete" BEFORE DELETE ON "PaymentRequest"
BEGIN
    SELECT RAISE(ABORT, 'Las solicitudes de pago no se borran');
END;

CREATE TRIGGER "payment_request_final_states" BEFORE UPDATE ON "PaymentRequest"
WHEN OLD."status" IN ('REJECTED', 'CLOSED', 'CANCELLED')
BEGIN
    SELECT RAISE(ABORT, 'La solicitud de pago ya está finalizada');
END;

CREATE TRIGGER "payment_request_item_no_update" BEFORE UPDATE ON "PaymentRequestItem"
BEGIN
    SELECT RAISE(ABORT, 'Los renglones de una solicitud son inmutables');
END;

CREATE TRIGGER "payment_request_item_no_delete" BEFORE DELETE ON "PaymentRequestItem"
BEGIN
    SELECT RAISE(ABORT, 'Los renglones de una solicitud son inmutables');
END;

CREATE TRIGGER "payment_no_delete" BEFORE DELETE ON "Payment"
BEGIN
    SELECT RAISE(ABORT, 'Los pagos son inmutables; se anulan');
END;

CREATE TRIGGER "payment_only_annul" BEFORE UPDATE ON "Payment"
WHEN OLD."annulledAt" IS NOT NULL
    OR NEW."annulledAt" IS NULL
    OR NEW."annulledById" IS NULL
    OR NEW."annulmentReason" IS NULL
    OR NEW."id" IS NOT OLD."id"
    OR NEW."requestId" IS NOT OLD."requestId"
    OR NEW."personId" IS NOT OLD."personId"
    OR NEW."amountCents" IS NOT OLD."amountCents"
    OR NEW."paidOn" IS NOT OLD."paidOn"
    OR NEW."reference" IS NOT OLD."reference"
    OR NEW."createdById" IS NOT OLD."createdById"
    OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
    SELECT RAISE(ABORT, 'Los pagos son inmutables; solo se pueden anular una vez');
END;

CREATE TRIGGER "payment_allocation_no_update" BEFORE UPDATE ON "PaymentAllocation"
BEGIN
    SELECT RAISE(ABORT, 'La aplicación de un pago es inmutable');
END;

CREATE TRIGGER "payment_allocation_no_delete" BEFORE DELETE ON "PaymentAllocation"
BEGIN
    SELECT RAISE(ABORT, 'La aplicación de un pago es inmutable');
END;

-- Cajas chicas: nada se borra, y los meses cerrados y los vales finalizados no cambian.

CREATE TRIGGER "petty_cash_fund_no_delete" BEFORE DELETE ON "PettyCashFund"
BEGIN
    SELECT RAISE(ABORT, 'Las cajas chicas no se borran; se desactivan');
END;

CREATE TRIGGER "petty_cash_period_no_delete" BEFORE DELETE ON "PettyCashPeriod"
BEGIN
    SELECT RAISE(ABORT, 'Los meses de caja chica no se borran');
END;

CREATE TRIGGER "petty_cash_period_closed" BEFORE UPDATE ON "PettyCashPeriod"
WHEN OLD."status" = 'CLOSED'
BEGIN
    SELECT RAISE(ABORT, 'El mes de caja chica ya está cerrado');
END;

CREATE TRIGGER "petty_cash_voucher_no_delete" BEFORE DELETE ON "PettyCashVoucher"
BEGIN
    SELECT RAISE(ABORT, 'Los vales de caja chica no se borran');
END;

CREATE TRIGGER "petty_cash_voucher_final_states" BEFORE UPDATE ON "PettyCashVoucher"
WHEN OLD."status" IN ('SETTLED', 'REJECTED', 'CANCELLED')
BEGIN
    SELECT RAISE(ABORT, 'El vale de caja chica ya está finalizado');
END;
