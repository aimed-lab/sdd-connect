// Events listed on /events. Add a row to either list to show it there.
// date, location and format are optional: fill them in only from a confirmed
// source (the organisers), and leave them out until then.
// Safe for client components (types and data only).

export type EventFormat = "In person" | "Online" | "Hybrid";

export type EventItem = {
  name: string;
  /** One short line under the name. */
  note?: string;
  /** When, as people should read it, e.g. "12–14 May 2026". */
  date?: string;
  /** Where, e.g. "Birmingham, AL" or "Online". */
  location?: string;
  /** How it runs. */
  format?: EventFormat;
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

/** The date, location and format that are filled in, in that order. */
export function eventDetails(e: EventItem): { label: "Date" | "Location" | "Format"; value: string }[] {
  const rows: { label: "Date" | "Location" | "Format"; value: string | undefined }[] = [
    { label: "Date", value: e.date },
    { label: "Location", value: e.location },
    { label: "Format", value: e.format },
  ];
  return rows.flatMap((r) => (r.value?.trim() ? [{ label: r.label, value: r.value.trim() }] : []));
}
