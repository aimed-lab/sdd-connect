"use client";

// The homepage "Explore the hub" map: six colored lines drawn like a metro map,
// all passing through one central interchange (SmartDrugDiscovery). Plain inline
// SVG, no libraries. Every stop is a link; links that leave the site open in a
// new tab and show a ↗.
//
// Geometry notes (viewBox units, 1 unit ~ 1px at desktop width):
//   * Papers / Events / People run horizontally through the interchange at
//     y = 376 / 400 / 424. Funding & trials / Tools run vertically at x = 545 / 655.
//     Only the interchange pill (drawn last) overlaps them, so the lines never cross
//     anywhere else.
//   * Every bend is 45°. Stations sit on straight segments, never on a bend.
//   * Labels go on the free side of their line: above for Papers and Events,
//     below for People, left for Funding & trials, right for Tools.
//   * SPARC picks is the thicker coral line, drawn on top. It starts at the bottom
//     of the hub, drops through the free corridor between the two verticals
//     (x = 600) and runs left along y = 735, where its three stops sit (labels below).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Side = "above" | "below" | "left" | "right";

interface Station {
  label: string[]; // one or two lines
  x: number;
  y: number;
  side: Side;
  href: string;
  /** Opens in a new tab (the label then shows a ↗). */
  external?: boolean;
}

interface MapLine {
  id: string;
  name: string;
  color: string;
  path: string;
  stations: Station[];
}

const SDDS = "https://wiki.smartdrugdiscovery.org/sdds-2026";
const isExternal = (href: string) => /^https?:\/\//.test(href);

// Label gets a ↗ and the stop opens in a new tab when the link leaves the site.
function st(label: string, x: number, y: number, side: Side, href: string): Station {
  const external = isExternal(href);
  return { label: [external ? `${label} ↗` : label], x, y, side, href, external };
}

const LINES: MapLine[] = [
  {
    id: "papers",
    name: "Papers",
    color: "#2563eb",
    path: "M100 296 H300 L380 376 H820 L900 296 H1140",
    stations: [
      st("Ask AI", 100, 296, "above", "/explore"),
      st("Latest papers", 260, 296, "above", "/explore?category=paper"),
      st("Our lab's papers", 960, 296, "above", "/sparc#publications"),
      st("News", 1140, 296, "above", "/explore?category=news"),
    ],
  },
  {
    id: "data",
    name: "Funding & trials",
    color: "#CA8A04",
    path: "M465 110 V180 L545 260 V540 L465 620 V690",
    stations: [
      st("Grants", 465, 110, "left", "/explore?category=grant"),
      st("Clinical trials", 545, 300, "left", "/explore?category=trial"),
      st("FDA approvals", 545, 500, "left", "/explore?category=approval"),
      st("Preprints", 465, 690, "left", "/explore?category=preprint"),
    ],
  },
  {
    id: "tools",
    name: "Tools",
    color: "#1A5632",
    path: "M735 110 V180 L655 260 V540 L735 620 V690",
    stations: [
      st("Tools & datasets", 735, 110, "right", "/explore?category=tool"),
      st("PAGER", 655, 300, "right", "https://github.com/aimed-lab/PAGER-Web-APP"),
      st("Talent Knowledge Map", 655, 500, "right", "http://cm4aikg.vercel.app/"),
      st("CM4AI datasets", 735, 690, "right", "/sparc#datasets"),
    ],
  },
  {
    id: "projects",
    name: "Events",
    color: "#9333ea",
    path: "M100 400 H1140",
    stations: [
      st("ColaboFest 2026", 100, 400, "above", "/promote/conference-or-talk-zfnlb"),
      st("SDDS 2026", 260, 400, "above", SDDS),
      st("Promote your work", 960, 400, "above", "/promote"),
      st("CFDE Fall 2026", 1140, 400, "above", "https://portal.cfdeconnect.org/meetings/fall-2026"),
    ],
  },
  {
    id: "people",
    name: "People",
    color: "#ec4899",
    path: "M100 504 H300 L380 424 H820 L900 504 H1140",
    stations: [
      st("Communities", 100, 504, "below", "/communities"),
      st("Teams", 260, 504, "below", "https://project.smartdrugdiscovery.org"),
      st("Join SPARC Investigators", 960, 504, "below", "/communities/sparc-investigators"),
      st("OSDD-2", 1140, 504, "below", "https://www.smartdrugdiscovery.org/post/osdd2"),
    ],
  },
];

const ROUTE_ID = "sparc-picks";
const ROUTE_COLOR = "#C2410C";

// Starts at the hub and runs down to its three stops at the bottom left.
const ROUTE: MapLine = {
  id: ROUTE_ID,
  name: "SPARC picks",
  color: ROUTE_COLOR,
  path: "M600 445 V670 L535 735 H120",
  stations: [
    st("Podcast", 120, 735, "below", "/explore/podcast"),
    st("SPARC tools", 280, 735, "below", "/sparc#tools"),
    st("Patents", 440, 735, "below", "/sparc#patents"),
  ],
};

const ALL_LINES: MapLine[] = [...LINES, ROUTE];

const VIEW_X = -20;
const VIEW_W = 1300;
const VIEW_Y = 0;
const VIEW_H = 785;
const HUB_X = 600; // centre of the interchange pill
const R = 12; // station radius
const LABEL_GAP = 24;

function labelPlacement(s: Station) {
  const n = s.label.length;
  const lh = 17; // line height
  switch (s.side) {
    case "above":
      return { x: s.x, y: s.y - LABEL_GAP - (n - 1) * lh, anchor: "middle" as const };
    case "below":
      return { x: s.x, y: s.y + LABEL_GAP + 14, anchor: "middle" as const };
    case "left":
      return { x: s.x - LABEL_GAP, y: s.y + 5 - ((n - 1) * lh) / 2, anchor: "end" as const };
    case "right":
      return { x: s.x + LABEL_GAP, y: s.y + 5 - ((n - 1) * lh) / 2, anchor: "start" as const };
  }
}

// Plain anchor for stations that leave the site: new tab, no opener.
function ExternalLink(props: React.ComponentProps<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function StationNode({
  station,
  color,
  lineId,
  setHover,
}: {
  station: Station;
  color: string;
  lineId: string;
  setHover: (id: string | null) => void;
}) {
  const [grow, setGrow] = useState(false);
  const p = labelPlacement(station);
  const name = station.label.join(" ");
  const Wrapper = station.external ? ExternalLink : Link;
  return (
    <Wrapper
      href={station.href}
      aria-label={name.replace(" ↗", "")}
      onMouseEnter={() => {
        setGrow(true);
        setHover(lineId);
      }}
      onMouseLeave={() => {
        setGrow(false);
        setHover(null);
      }}
      onFocus={() => {
        setGrow(true);
        setHover(lineId);
      }}
      onBlur={() => {
        setGrow(false);
        setHover(null);
      }}
      className="outline-none cursor-pointer"
    >
      {/* Generous invisible hit area so the stop is easy to tap on a phone. */}
      <circle cx={station.x} cy={station.y} r={22} fill="transparent" />
      <g
        style={{
          transform: grow ? "scale(1.3)" : "scale(1)",
          transformOrigin: `${station.x}px ${station.y}px`,
          transition: "transform 150ms ease",
        }}
      >
        <circle cx={station.x} cy={station.y} r={R} fill="#fff" stroke={color} strokeWidth={5} />
      </g>
      <text
        textAnchor={p.anchor}
        x={p.x}
        y={p.y}
        className="font-label-md"
        fontSize={16}
        fontWeight={600}
        fill={grow ? "#033319" : "#191c1e"}
        style={{ pointerEvents: "none" }}
      >
        {station.label.map((l, i) => (
          <tspan key={l} x={p.x} dy={i === 0 ? 0 : 17} fontSize={i === 0 ? 16 : 14}>
            {l}
          </tspan>
        ))}
      </text>
    </Wrapper>
  );
}

export default function DiscoveryMap() {
  const [hover, setHover] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // When the box is narrower than the map (phones), open scrolled so the
  // central hub is centered. A no-op on desktop, where nothing scrolls.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const hubFraction = (HUB_X - VIEW_X) / VIEW_W;
    box.scrollLeft = hubFraction * box.scrollWidth - box.clientWidth / 2;
  }, []);

  return (
    <div>
      <div
        ref={boxRef}
        className="rounded-2xl border border-outline-variant/60 bg-white shadow-sm overflow-x-auto max-w-full"
      >
        <svg
          viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}
          role="group"
          aria-label="Map of the hub: six lines, Papers, Funding and trials, Tools, Events, People and SPARC picks, all meeting at SmartDrugDiscovery"
          className="block w-full min-w-[1000px] h-auto md:max-h-[calc(100vh-165px)]"
        >
          {/* Lines (the SPARC picks line last, so it sits on top) */}
          {ALL_LINES.map((line) => {
            const isRoute = line.id === ROUTE_ID;
            const on = hover === line.id;
            return (
              <path
                key={line.id}
                d={line.path}
                fill="none"
                stroke={line.color}
                strokeWidth={(isRoute ? 13 : 10) + (on ? 4 : 0)}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: "stroke-width 150ms ease" }}
              />
            );
          })}

          {/* Stations and labels: faded lines keep readable (and clickable) stops */}
          {ALL_LINES.map((line) => (
            <g key={line.id}>
              {line.stations.map((s) => (
                <StationNode
                  key={s.label[0]}
                  station={s}
                  color={line.color}
                  lineId={line.id}
                  setHover={setHover}
                />
              ))}
            </g>
          ))}

          {/* Central interchange, drawn last so it sits over every line */}
          <Link href="/explore" aria-label="SmartDrugDiscovery, explore everything">
            <rect
              x={475}
              y={355}
              width={250}
              height={90}
              rx={45}
              fill="#fff"
              stroke="#033319"
              strokeWidth={7}
            />
            <text
              x={600}
              y={407}
              textAnchor="middle"
              className="font-headline-md"
              fontSize={22}
              fontWeight={700}
              fill="#033319"
              style={{ pointerEvents: "none" }}
            >
              SmartDrugDiscovery
            </text>
          </Link>
        </svg>
      </div>

      <p className="md:hidden mt-2 text-center font-label-sm text-label-sm text-secondary">
        <span className="material-symbols-outlined align-middle text-base mr-1">swipe</span>
        Swipe to explore the map
      </p>

      {/* Legend */}
      <ul className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {ALL_LINES.map((line) => (
          <li
            key={line.id}
            className="flex items-center gap-2 font-label-md text-label-md text-on-surface"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-7 rounded-full"
              style={{ background: line.color }}
            />
            {line.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
