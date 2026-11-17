// lib/server/communityVisibility.ts — which communities a viewer is shown in
// lists: /communities, /collaborate, /api/communities-summary and
// /api/communities/match all use this one rule.
//
// Signed out, only communities with at least SIGNED_OUT_MIN_MEMBERS active
// members are listed; signed in, all of them. No runtime imports, so `npm test`
// covers it. It decides what to LIST; a community's own page and RLS still
// decide what it shows.

export const SIGNED_OUT_MIN_MEMBERS = 3;

export function listedForSignedOut(community: { member_count?: number }): boolean {
  return (community.member_count ?? 0) >= SIGNED_OUT_MIN_MEMBERS;
}

export function visibleCommunities<T extends { member_count?: number }>(communities: T[], signedIn: boolean): T[] {
  return signedIn ? communities : communities.filter(listedForSignedOut);
}
