export type Debt = { accrualId: number; outstandingCents: number };

// Reparte un pago sobre las deudas en el orden recibido (la más antigua primero): cubre por completo
// cada una antes de pasar a la siguiente. Devuelve null si el monto supera la deuda total.
export function allocateFifo(debts: Debt[], amountCents: number): { accrualId: number; amountCents: number }[] | null {
  const total = debts.reduce((sum, debt) => sum + debt.outstandingCents, 0);
  if (amountCents <= 0 || amountCents > total) return null;

  const allocations: { accrualId: number; amountCents: number }[] = [];
  let remaining = amountCents;
  for (const debt of debts) {
    if (remaining === 0) break;
    if (debt.outstandingCents <= 0) continue;
    const applied = Math.min(remaining, debt.outstandingCents);
    allocations.push({ accrualId: debt.accrualId, amountCents: applied });
    remaining -= applied;
  }
  return allocations;
}
