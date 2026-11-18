-- Anulación de asignaciones: no se borran, se anulan con usuario y motivo.
-- SQLite no agrega una llave foránea con ALTER TABLE: se redefine la tabla conservando los datos.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "personId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "paymentGroupId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "annulledAt" DATETIME,
    "annulledById" INTEGER,
    "annulmentReason" TEXT,
    CONSTRAINT "Assignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_paymentGroupId_fkey" FOREIGN KEY ("paymentGroupId") REFERENCES "PaymentGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_annulledById_fkey" FOREIGN KEY ("annulledById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("amountCents", "createdAt", "endDate", "id", "paymentGroupId", "personId", "projectId", "startDate", "updatedAt") SELECT "amountCents", "createdAt", "endDate", "id", "paymentGroupId", "personId", "projectId", "startDate", "updatedAt" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE INDEX "Assignment_personId_idx" ON "Assignment"("personId");
CREATE INDEX "Assignment_projectId_idx" ON "Assignment"("projectId");
CREATE INDEX "Assignment_paymentGroupId_idx" ON "Assignment"("paymentGroupId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Las asignaciones no se borran, ni con SQL directo: quedan para la auditoría.
CREATE TRIGGER "assignment_no_delete" BEFORE DELETE ON "Assignment"
BEGIN
    SELECT RAISE(ABORT, 'Las asignaciones no se borran: se anulan');
END;

-- Una asignación anulada ya no cambia: ni se modifica ni se des-anula.
CREATE TRIGGER "assignment_annulled_is_final" BEFORE UPDATE ON "Assignment"
WHEN OLD."annulledAt" IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'Una asignación anulada no se modifica');
END;

-- La anulación siempre lleva quién y por qué.
CREATE TRIGGER "assignment_annulment_complete" BEFORE UPDATE OF "annulledAt" ON "Assignment"
WHEN NEW."annulledAt" IS NOT NULL AND (NEW."annulledById" IS NULL OR NEW."annulmentReason" IS NULL OR trim(NEW."annulmentReason") = '')
BEGIN
    SELECT RAISE(ABORT, 'La anulación de una asignación requiere usuario y motivo');
END;
