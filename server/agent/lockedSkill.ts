/** The skill-page lock is consumed once, before parsing slash commands. */
export async function enforceFirstTurnLockedSkill(
  text: string,
  lockedSkill: string | undefined,
  firstUserTurn: boolean,
  canAccess: (id: string) => Promise<boolean>,
) {
  if (!lockedSkill || !firstUserTurn)
    return text
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(lockedSkill) || !(await canAccess(lockedSkill)))
    throw new Error('Locked skill is unavailable')
  const prompt = text.replace(/(?:^|\s)\/[a-z][a-z0-9-]{0,63}(?=\s|$)/g, ' ').trim()
  return `/${lockedSkill}${prompt ? ` ${prompt}` : ''}`
}
