// Events listed on /events. Add a row to either list to show it there.
// Safe for client components (types and data only).

export type EventItem = {
  name: string;
  /** One short line under the name. */
  note?: string;
  href: string;
  /** Opens in a new tab. */
  external?: boolean;
};

export const conferences: EventItem[] = [
  {
    name: "SDDS 2026",
    note: "Stanford Drug Discovery Symposium",
    href: "https://wiki.smartdrugdiscovery.org/sdds-2026",
    external: true,
  },
  {
    name: "CFDE Fall 2026 meeting",
    href: "https://portal.cfdeconnect.org/meetings/fall-2026",
    external: true,
  },
];

export const contests: EventItem[] = [
  {
    name: "CollaboFest 2026",
    note: "SPARC's drug discovery challenge",
    href: "/communities/colabofest-2026",
  },
];
