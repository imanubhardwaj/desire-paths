// Everything in the meadow. `at` is a position in world units (the world is
// 2400 × 2400, origin top-left). Moving a place doesn't erase existing paths —
// they'll just lead to where it used to be, and slowly grow over.

export type PlaceKind = "gate" | "stone" | "cabin" | "sign" | "well";

export interface Place {
  id: string;
  kind: PlaceKind;
  at: [number, number];
  label: string;
  title: string;
  meta?: string;
  body: string[];
  tags?: string[];
  links?: { label: string; href: string }[];
  placeholder?: boolean;
}

export const places: Place[] = [
  {
    id: "gate",
    kind: "gate",
    at: [1200, 2235],
    label: "the gate",
    title: "Everyone starts here",
    body: [
      "Every visitor arrives at this gate. Nobody laid the paths you can see: they're grass worn down by the people who walked here before you.",
      "Click or tap anywhere to walk. Wherever you go, you'll leave a little wear for the next person.",
    ],
  },
  {
    id: "about",
    kind: "stone",
    at: [820, 1840],
    label: "about",
    title: "Manu",
    meta: "Full-stack engineer · 9 years",
    body: [
      "I build polished products, workflow tools and interfaces that are harder than they look, mostly in TypeScript, React and Next.js, with regular detours into WebGL, AI integrations and Web3.",
      "I like problems where the engineering and the experience are the same problem. This meadow is one of them.",
    ],
  },
  {
    id: "how",
    kind: "sign",
    at: [1580, 1965],
    label: "how it works",
    title: "How the ground remembers",
    body: [
      "The meadow is a 200 × 200 grid. Each visit adds one footstep to every square you cross, at most once per square, so no single person can carve a road.",
      "Footsteps are stored per week. When the ground is drawn, older weeks count for less, so paths nobody walks anymore slowly grow back.",
      "A shader turns the wear into grass, trampled grass and bare soil, with noise so the edges look like something feet made.",
      "Only grid squares and a coarse walk are recorded, never who you are. Tick “walk without leaving tracks” and nothing is sent.",
    ],
  },
  {
    id: "work-desire-paths",
    kind: "cabin",
    at: [1720, 1560],
    label: "desire paths",
    title: "Desire Paths",
    meta: "2026",
    body: [
      "This site. A portfolio worn down by the people who visit it: a wear grid with time decay, a WebGL ground shader, and replayed walks from recent visitors.",
    ],
    tags: ["Next.js", "WebGL2", "Redis"],
  },
  {
    id: "work-project-two",
    kind: "cabin",
    at: [560, 1280],
    label: "project two",
    title: "Project title",
    meta: "20XX",
    body: ["Placeholder. One or two sentences on what you built, who it was for, and what made it hard."],
    tags: ["Tag", "Tag"],
    placeholder: true,
  },
  {
    id: "work-project-three",
    kind: "cabin",
    at: [1840, 900],
    label: "project three",
    title: "Project title",
    meta: "20XX",
    body: ["Placeholder. Lead with the outcome, then the interesting constraint."],
    tags: ["Tag", "Tag"],
    placeholder: true,
  },
  {
    id: "work-project-four",
    kind: "cabin",
    at: [1000, 640],
    label: "project four",
    title: "Project title",
    meta: "20XX",
    body: ["Placeholder. Link to a write-up, demo or repo if there is one."],
    tags: ["Tag"],
    placeholder: true,
  },
  {
    id: "contact",
    kind: "well",
    at: [520, 520],
    label: "say hello",
    title: "Say hello",
    body: ["You walked a long way to get here. That's worth a message."],
    // TODO: replace with real links.
    links: [
      { label: "Email", href: "mailto:you@example.com" },
      { label: "GitHub", href: "https://github.com/" },
      { label: "LinkedIn", href: "https://www.linkedin.com/" },
    ],
  },
];
