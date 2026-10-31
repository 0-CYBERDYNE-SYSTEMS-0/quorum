/** Positions that record agreement, support, or deference without a director's own conclusion. */
export function isDeferentialStancePosition(position: string): boolean {
  const normalized = position.trim();
  const deferral = /^(?:(?:i|we)\s+)?(?:(?:would|should|could|might|may|will|can|must|shall)\s+)?defer\b/i.test(normalized);
  if (deferral) return true;

  const hasSubstantiveClause = /\b(?:because|since|as|if|only if|provided(?: that)?|unless|subject to|contingent on|so long as|given|based on|due to)\b|[:,;—–]/i.test(normalized);
  return !hasSubstantiveClause && /^(?:(?:i|we)\s+)?(?:agree(?:\s+with\b.*)?|support(?:\s+.*)?|nothing to add|no additional point)(?:[.!?])?$/i.test(normalized);
}
