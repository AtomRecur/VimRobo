import { crosscheckScenario } from "./crosscheck";

export type Vec3 = [number, number, number];
export type FrameKind =
  | "approach"
  | "walkway"
  | "hallway"
  | "outside"
  | "inside"
  | "woods"
  | "bicycle"
  | "lab";
export type Provenance =
  | "brief-transcription"
  | "illustrative"
  | "paper-verified";
export interface Observation {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  position: Vec3;
  routeT: number;
  image: string;
  kind: FrameKind;
  provenance: Provenance;
  coordinateProvenance: "illustrative" | "recorded";
  sourceRef?: string;
  imageProvenance?: "paper-frame" | "illustration";
  sourcePosition?: [number, number];
  video?: { src: string; time: number };
}
export interface GraphNode {
  id: string;
  label: string;
  detail: string;
  type: "question" | "retrieval" | "observation" | "integration" | "answer";
  at: number;
  x: number;
  y: number;
  width: number;
  height?: number;
  observationId?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  at: number;
  kind?: "crosscheck";
  fromPort?: "top" | "bottom" | "left" | "right";
  toPort?: "top" | "bottom" | "left" | "right";
  via?: [number, number][];
}
export type EvidenceAssessment = {
  status: "candidate" | "accepted" | "rejected" | "revisited";
  reason: string;
};
export interface ReasoningEvent {
  at: number;
  label: string;
  title: string;
  caption: string;
  action: string;
  observations: string[];
  highlighted: string[];
  focus: Vec3;
  robotT: number;
  retrievalMode: "none" | "semantic" | "temporal" | "spatial" | "integration";
  hop?: number;
  activeNodes?: string[];
  revisitedNodes?: string[];
  assessments?: Record<string, EvidenceAssessment>;
  checks?: Record<string, "pending" | "checking" | "verified">;
  sequence?: {
    observationId: string;
    label: string;
    status?: "revisit" | "selected";
  }[];
  trajectoryRange?: [number, number];
}
export interface Scenario {
  id: string;
  category: string;
  question: string;
  shortTitle: string;
  description: string;
  provenance: Provenance;
  sourceLabel: string;
  sourceNote: string;
  skills: string[];
  observations: Observation[];
  events: ReasoningEvent[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  answer: string;
  answerDetail: string;
  graphProvenance: "reconstructed" | "paper-verified";
  hopCount?: number;
  checkLabels?: Record<string, string>;
  graphLayout?: { width: number; height: number };
  previewImage?: string;
}

export const ROUTE: Vec3[] = [
  [-5.5, 0.18, 4.2],
  [-4.6, 0.18, 4.2],
  [-3.3, 0.18, 4.2],
  [-2, 0.18, 4.2],
  [-0.6, 0.18, 4.2],
  [0.8, 0.18, 4.2],
  [1.6, 0.18, 3.8],
  [1.6, 0.18, 2.4],
  [1.6, 0.18, 0.8],
  [1.6, 0.18, -0.6],
  [1.6, 0.18, -1.5],
  [1.6, 0.18, -2.5],
  [2.7, 0.18, -2.5],
];
const image = (kind: FrameKind) => `observations/${kind}.svg`;
const buildingObs: Observation[] = [
  {
    id: "approach",
    timestamp: "15:33:54",
    title: "Approaching the building",
    description:
      "A building-related observation returned by semantic retrieval.",
    position: [-2, 0.25, 4.2],
    routeT: 0.28,
    kind: "approach",
    image: image("approach"),
    sourcePosition: [-92.22, 365.28],
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
    sourceRef: "Figure 8, page 13",
  },
  {
    id: "walkway",
    timestamp: "15:34:09",
    title: "Outdoor walkway",
    description:
      "An outdoor candidate. Visual relevance alone does not establish the entry time.",
    position: [1.6, 0.25, 2.4],
    routeT: 0.59,
    kind: "walkway",
    image: "observations/paper-walkway.png",
    imageProvenance: "paper-frame",
    sourcePosition: [-105.26, 365.0],
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
  {
    id: "hallway",
    timestamp: "15:34:59",
    title: "Indoor hallway",
    description:
      "An indoor semantic candidate, later than the suspected building entry.",
    position: [2.7, 0.25, -2.5],
    routeT: 1,
    kind: "hallway",
    image: "observations/paper-hallway.png",
    imageProvenance: "paper-frame",
    sourcePosition: [-139.99, 349.22],
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
  {
    id: "outside",
    timestamp: "15:34:02",
    title: "Still outside",
    description:
      "The robot is outdoors in this observation. This supports the earlier side of the entry interval.",
    position: [0.4, 0.25, 4.2],
    routeT: 0.45,
    kind: "outside",
    image: image("outside"),
    sourcePosition: [-99.17, 365.59],
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
  {
    id: "inside",
    timestamp: "15:34:30",
    title: "Inside the building lobby",
    description:
      "The robot is inside by this observation. The exact physical crossing is not directly measured.",
    position: [1.6, 0.25, -0.6],
    routeT: 0.78,
    kind: "inside",
    image: "observations/paper-inside.png",
    imageProvenance: "paper-frame",
    sourcePosition: [-117.82, 355.28],
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
  {
    id: "confirmation",
    timestamp: "15:34:33",
    title: "Inside near the hallway",
    description:
      "A subsequent observation supports continued presence inside the building.",
    position: [1.6, 0.25, -1.5],
    routeT: 0.87,
    kind: "hallway",
    image: image("hallway"),
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
  {
    id: "continuation",
    timestamp: "15:34:37",
    title: "Continuing indoors",
    description: "A later indoor observation corroborates the transition.",
    position: [1.6, 0.25, -2.5],
    routeT: 0.94,
    kind: "hallway",
    image: image("hallway"),
    provenance: "paper-verified",
    coordinateProvenance: "illustrative",
  },
];
const nodes: GraphNode[] = [
  {
    id: "root",
    label: "When did the robot enter?",
    detail: "QUESTION · TEMPORAL",
    type: "question",
    at: 0,
    x: 79,
    y: 14,
    width: 222,
  },
  {
    id: "building",
    label: "Building search",
    detail: "SEMANTIC RETRIEVAL",
    type: "retrieval",
    at: 0.2,
    x: 12,
    y: 130,
    width: 165,
    observationId: "walkway",
  },
  {
    id: "entry_time_probe",
    label: "Entry time probe",
    detail: "TEMPORAL VERIFICATION",
    type: "retrieval",
    at: 0.6,
    x: 203,
    y: 130,
    width: 165,
    observationId: "inside",
  },
  {
    id: "answer",
    label: "Around 15:34:30",
    detail: "EVIDENCE-BASED ANSWER",
    type: "answer",
    at: 1,
    x: 79,
    y: 365,
    width: 222,
  },
];
// Exact parent dependencies transcribed from the case-study tool calls (Figure 8, p. 13).
const edges: GraphEdge[] = [
  { from: "root", to: "building", at: 0.2 },
  { from: "root", to: "entry_time_probe", at: 0.6 },
  { from: "building", to: "answer", at: 1 },
  { from: "entry_time_probe", to: "answer", at: 1 },
];
const entry: Scenario = {
  id: "entry",
  category: "When",
  question: "When did the robot enter the building?",
  shortTitle: "A moment of transition.",
  description:
    "Find the boundary between an outdoor memory and an indoor observation.",
  provenance: "paper-verified",
  sourceLabel: "FIG. 8 · BUILDING-ENTRY CASE STUDY",
  graphProvenance: "paper-verified",
  sourceNote:
    "Evidence and graph dependencies are verified against Figure 8, page 13 of the supplied manuscript (Figure 7 in the original brief). Three observation images are extracted paper frames; remaining frames are labeled illustrations. The miniature, route, and marker positions are conceptual, not reconstructed geometry.",
  skills: ["Target retrieval", "Temporal boundary verification"],
  observations: buildingObs,
  nodes,
  edges,
  answer: "The robot entered the building around 15:34:30.",
  answerDetail:
    "Outside at 15:34:02. Inside by 15:34:30. These observations bound the transition; they do not measure the exact crossing instant.",
  events: [
    {
      at: 0,
      label: "Question",
      title: "Understanding the question",
      caption:
        "Identify the building as the target and entry time as the relation to verify.",
      action: "SELECT SKILLS",
      observations: [],
      highlighted: [],
      focus: [0, 0, 0],
      robotT: 0.08,
      retrievalMode: "none",
    },
    {
      at: 0.2,
      label: "Search",
      title: "Finding relevant memories",
      caption:
        "Retrieve building-related observations from the robot’s visual memory.",
      action: "SEMANTIC RETRIEVAL",
      observations: ["approach"],
      highlighted: ["approach", "walkway", "hallway"],
      focus: [0.8, 0, 0],
      robotT: 0.28,
      retrievalMode: "semantic",
    },
    {
      at: 0.4,
      label: "Evidence",
      title: "Comparing candidate observations",
      caption:
        "Candidate memories provide context, but the entry boundary still needs verification.",
      action: "COMPARE CANDIDATES",
      observations: ["approach", "walkway", "hallway"],
      highlighted: ["approach", "walkway", "hallway"],
      focus: [1, 0, 0.3],
      robotT: 1,
      retrievalMode: "semantic",
    },
    {
      at: 0.6,
      label: "Verify",
      title: "Verifying the temporal boundary",
      caption:
        "Outside at 15:34:02. Inside by 15:34:30. Focus the search around the transition.",
      action: "TEMPORAL VERIFICATION",
      observations: ["outside", "inside", "confirmation", "continuation"],
      highlighted: ["outside", "inside", "confirmation", "continuation"],
      focus: [1.6, 0, 1],
      robotT: 0.78,
      retrievalMode: "temporal",
    },
    {
      at: 0.8,
      label: "Connect",
      title: "Connecting the evidence",
      caption:
        "Semantic context and temporal observations connect into a supported entry interval.",
      action: "INTEGRATE EVIDENCE",
      observations: ["outside", "inside"],
      highlighted: ["outside", "inside"],
      focus: [0.8, 0, 0.4],
      robotT: 0.78,
      retrievalMode: "integration",
    },
    {
      at: 1,
      label: "Answer",
      title: "An answer grounded in experience",
      caption:
        "The evidence supports an approximate entry time around 15:34:30.",
      action: "ANSWER READY",
      observations: ["outside", "inside"],
      highlighted: ["outside", "inside"],
      focus: [0, 0, 0],
      robotT: 0.78,
      retrievalMode: "integration",
    },
  ],
};
function illustrativeScenario(id: "bicycle" | "lab"): Scenario {
  const bike = id === "bicycle";
  const obs: Observation[] = bike
    ? [
        {
          id: "anchor",
          timestamp: "Frame 042",
          title: "Passing the woods",
          description:
            "An illustrative route anchor establishes the “after the woods” constraint.",
          position: [-3.3, 0.25, 4.2],
          routeT: 0.2,
          kind: "woods",
          image: image("woods"),
          provenance: "illustrative",
          coordinateProvenance: "illustrative",
        },
        {
          id: "target",
          timestamp: "Frame 068",
          title: "Bicycle beside the east entrance",
          description:
            "A simulated target observation after the woodland segment. This is not an experimental result.",
          position: [1.6, 0.25, 2.4],
          routeT: 0.62,
          kind: "bicycle",
          image: image("bicycle"),
          provenance: "illustrative",
          coordinateProvenance: "illustrative",
        },
      ]
    : [
        {
          id: "anchor",
          timestamp: "Room 01 → 03",
          title: "Following the corridor",
          description:
            "Illustrative room order grounds the ordinal reference “third lab”.",
          position: [1.6, 0.25, -0.6],
          routeT: 0.78,
          kind: "hallway",
          image: image("hallway"),
          provenance: "illustrative",
          coordinateProvenance: "illustrative",
        },
        {
          id: "target",
          timestamp: "Room 03",
          title: "The third lab",
          description:
            "A simulated lab illustration containing a workbench and a robotic arm. It is not a ground-truth paper observation.",
          position: [2.7, 0.25, -2.5],
          routeT: 1,
          kind: "lab",
          image: image("lab"),
          provenance: "illustrative",
          coordinateProvenance: "illustrative",
        },
      ];
  if (bike)
    obs.push({
      id: "alternate",
      timestamp: "Frame 012",
      title: "Another bicycle, before the woods",
      description:
        "An illustrative distractor is visually relevant but fails the route-order constraint.",
      position: [-5.5, 0.25, 4.2],
      routeT: 0.03,
      kind: "bicycle",
      image: image("bicycle"),
      provenance: "illustrative",
      coordinateProvenance: "illustrative",
    });
  else
    obs.push(
      {
        id: "room1",
        timestamp: "Room 01",
        title: "First lab along the corridor",
        description:
          "An illustrative earlier room candidate. The requested ordinal is third.",
        position: [1.6, 0.25, -0.6],
        routeT: 0.78,
        kind: "hallway",
        image: image("hallway"),
        provenance: "illustrative",
        coordinateProvenance: "illustrative",
      },
      {
        id: "room2",
        timestamp: "Room 02",
        title: "Second lab along the corridor",
        description:
          "An illustrative room candidate excluded by the requested route order.",
        position: [1.6, 0.25, -1.5],
        routeT: 0.87,
        kind: "hallway",
        image: image("hallway"),
        provenance: "illustrative",
        coordinateProvenance: "illustrative",
      },
    );
  const query = bike
    ? "Where is the red bicycle after passing the woods?"
    : "What was in the third lab along the corridor?";
  return {
    id,
    category: bike ? "Where" : "What",
    question: query,
    shortTitle: bike ? "A place in context." : "More than a familiar room.",
    description: bike
      ? "Locate a target using a landmark and the order of the route."
      : "Resolve a room by its sequence, then inspect its visual contents.",
    provenance: "illustrative",
    sourceLabel: "FIG. 1 · ILLUSTRATIVE WALKTHROUGH",
    graphProvenance: "reconstructed",
    sourceNote:
      "This scenario uses simulated observations, positions, and a walkthrough to demonstrate the interface. The question and schematic answer follow Figure 1; the intermediate retrieval trace is illustrative, not a recorded experiment.",
    skills: bike
      ? ["Target retrieval", "Spatial anchor verification"]
      : ["Room retrieval", "Sequential context"],
    observations: obs,
    answer: bike
      ? "The red bicycle is at [33.2, 37.1], after passing the woods."
      : "A robotic arm.",
    answerDetail:
      "Schematic answer from Figure 1. The scene and retrieval sequence are illustrative; they do not represent a recorded inference trace.",
    nodes: nodes.map((n) => ({
      ...n,
      observationId:
        n.id === "building"
          ? bike
            ? "target"
            : "room1"
          : n.id === "entry_time_probe"
            ? bike
              ? "anchor"
              : "target"
            : undefined,
      label: (
        {
          root: bike
            ? "Where is the red bicycle?"
            : "What was in the third lab?",
          building: bike ? "Bicycle search" : "Lab search",
          entry_time_probe: bike ? "Route anchor probe" : "Room order probe",
          candidates: bike ? "Woodland anchor" : "Corridor sequence",
          boundary: bike ? "After the woods" : "Third-room observation",
          evidence: bike
            ? "Grounded target position"
            : "Grounded room contents",
          answer: bike ? "Position [33.2, 37.1]" : "A robotic arm",
        } as Record<string, string>
      )[n.id],
      detail:
        n.type === "observation"
          ? "ILLUSTRATIVE OBSERVATION"
          : n.id === "answer"
            ? "ILLUSTRATIVE ANSWER"
            : n.detail.replace("TEMPORAL", "SPATIAL"),
    })),
    edges,
    events: entry.events.map((e, i) => ({
      ...e,
      focus: i > 1 ? obs[1].position : [0, 0, 0],
      robotT:
        i === 0
          ? 0
          : bike
            ? obs[1].routeT
            : i < 3
              ? obs[0].routeT
              : obs[1].routeT,
      observations:
        i === 0
          ? []
          : i === 1
            ? bike
              ? ["target"]
              : ["room1"]
            : i === 2
              ? bike
                ? ["alternate", "target"]
                : ["room1", "room2", "target"]
              : ["anchor", "target"],
      highlighted:
        i === 0
          ? []
          : i === 1
            ? bike
              ? ["target"]
              : ["room1"]
            : i === 2
              ? bike
                ? ["alternate", "target"]
                : ["room1", "room2", "target"]
              : ["anchor", "target"],
      retrievalMode: i === 3 ? "spatial" : e.retrievalMode,
      title:
        i === 3
          ? bike
            ? "Verifying the spatial relation"
            : "Verifying the room sequence"
          : e.title,
      caption: [
        `Resolve the ${bike ? "target and its landmark constraint" : "room and its ordinal constraint"}.`,
        `Find ${bike ? "bicycle-related" : "lab-related"} memories in the illustrated experience.`,
        `Compare ${bike ? "candidate locations along the route" : "similar rooms with their route context"}.`,
        bike
          ? "Ground the bicycle observation after the woodland anchor."
          : "Use route order to select the third lab, then inspect its contents.",
        "Combine the target observation with its contextual evidence.",
        "Reveal the illustrative answer, supported by the simulated observations.",
      ][i],
    })),
  };
}
export const scenarios: Scenario[] = [
  entry,
  illustrativeScenario("bicycle"),
  illustrativeScenario("lab"),
  crosscheckScenario,
];
