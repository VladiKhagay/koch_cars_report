/**
 * The site an admin last picked on the dashboard, Jobs, export or analytics,
 * remembered per user on this browser. '' is Jobs' "all sites". Callers check
 * the id is still one of their sites before using it.
 */
const key = (userId: string) => `siteChoice:${userId}`;

export function getSiteChoice(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null; // storage blocked: fall back to the home site
  }
}

export function setSiteChoice(userId: string, siteId: string): void {
  try {
    localStorage.setItem(key(userId), siteId);
  } catch {
    /* not remembered, still applied for this visit */
  }
}
