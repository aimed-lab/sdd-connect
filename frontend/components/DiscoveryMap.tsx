"use client";

// The homepage "Explore the hub" map: five colored lines drawn like a metro map,
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

const isExternal = (href: string) => /^https?:\/\//.test(href);

// Label gets a ↗ and the stop opens in a new tab when the link leaves the site.
function st(label: string, x: number, y: number, side: Side, href: string): Station {
  const external = isExternal(href);
  return { label: [external ? `${label} ↗` : label], x, y, side, href, external };
}

// Every stop is a TYPE of asset, one level, never one of our own activities.
const LINES: MapLine[] = [
  {
    id: "papers",
    name: "Literature",
    color: "#2563eb",
    path: "M100 296 H300 L380 376 H820 L900 296 H1140",
    stations: [
      st("Papers", 100, 296, "above", "/explore?category=paper"),
      st("Preprints", 260, 296, "above", "/explore?category=preprint"),
      st("News", 960, 296, "above", "/explore?category=news"),
      st("Podcasts", 1140, 296, "above", "/explore/podcast"),
    ],
  },
  {
    id: "data",
    name: "Funding & regulatory",
    color: "#CA8A04",
    path: "M465 110 V180 L545 260 V540 L465 620 V690",
    stations: [
      st("Grants", 465, 110, "left", "/explore?category=grant"),
      st("Clinical trials", 545, 300, "left", "/explore?category=trial"),
      st("FDA approvals", 545, 500, "left", "/explore?category=approval"),
      st("Patents", 465, 690, "left", "/sparc#patents"),
    ],
  },
  {
    id: "tools",
    name: "Tools & data",
    color: "#1A5632",
    path: "M735 110 V180 L655 260 V540 L735 620 V690",
    stations: [
      st("Tools", 735, 110, "right", "/explore?category=tool"),
      st("Datasets", 655, 300, "right", "/explore?category=dataset"),
      st("Lab resources", 655, 500, "right", "/collaborate#resources"),
      st("Wiki pages", 735, 690, "right", "/pages"),
    ],
  },
  {
    id: "projects",
    name: "Events",
    color: "#9333ea",
    path: "M100 400 H1140",
    stations: [
      st("Conferences", 100, 400, "above", "/events#conferences"),
      st("Contests", 260, 400, "above", "/events#contests"),
      st("Talks & slides", 960, 400, "above", "/promote?type=talk"),
      st("Achievements", 1140, 400, "above", "/promote?type=achievement"),
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
      st("Collaboration posts", 960, 504, "below", "/collaborate"),
      st("Researchers", 1140, 504, "below", "https://bridge2ai.labs-app.com/"),
    ],
  },
];

const ALL_LINES: MapLine[] = LINES;

const VIEW_X = -20;
const VIEW_W = 1300;
const VIEW_Y = 0;
const VIEW_H = 740;
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

// Rough text width (16px semibold) so the hit box can cover the label.
function hitArea(s: Station, p: { x: number; y: number; anchor: "start" | "middle" | "end" }) {
  const w = Math.max(...s.label.map((l) => l.length)) * 9.5 + 12;
  const PAD = 30; // half of a 60-unit-tall target (about 46px on a phone)
  if (s.side === "above") return { x: s.x - w / 2, y: p.y - 22, w, h: s.y + PAD - (p.y - 22) };
  if (s.side === "below") return { x: s.x - w / 2, y: s.y - PAD, w, h: p.y + 8 - (s.y - PAD) };
  const x0 = s.side === "left" ? s.x - LABEL_GAP - w : s.x - 24;
  return { x: x0, y: s.y - PAD, w: w + LABEL_GAP + 24, h: PAD * 2 };
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
  const hit = hitArea(station, p);
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
      {/* The whole stop (circle + label) is one generous hit area, at least 44px tall
          on a phone, so tapping the label works as well as tapping the circle. */}
      <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} rx={10} fill="transparent" />
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
          aria-label="Map of the hub: five lines, Literature, Funding and regulatory, Tools and data, Events and People, all meeting at SmartDrugDiscovery"
          className="block w-full min-w-[1000px] h-auto md:max-h-[calc(100vh-165px)]"
        >
          {/* Lines */}
          {ALL_LINES.map((line) => {
          
            const on = hover === line.id;
            return (
              <path
                key={line.id}
                d={line.path}
                fill="none"
                stroke={line.color}
                strokeWidth={10 + (on ? 4 : 0)}
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

      <p className="mt-3 text-center">
        <Link href="/sparc" className="text-sm text-secondary hover:text-primary hover:underline underline-offset-4">
          SPARC Center resources →
        </Link>
      </p>
    </div>
  );
}
