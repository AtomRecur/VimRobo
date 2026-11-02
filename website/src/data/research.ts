export type MetricKey =
  | "descriptive"
  | "spatialStrict"
  | "spatialRelaxed"
  | "temporalStrict"
  | "temporalRelaxed";
export interface ResultRow {
  name: string;
  descriptive: number;
  spatialStrict: number;
  spatialRelaxed: number;
  temporalStrict: number | null;
  temporalRelaxed: number | null;
}
export const benchmarkResults: Record<"4B" | "9B", ResultRow[]> = {
  "4B": [
    {
      name: "Vanilla RAG",
      descriptive: 58,
      spatialStrict: 4.2,
      spatialRelaxed: 7,
      temporalStrict: 23.1,
      temporalRelaxed: 41,
    },
    {
      name: "ReAct",
      descriptive: 60,
      spatialStrict: 2.8,
      spatialRelaxed: 15.5,
      temporalStrict: 17.9,
      temporalRelaxed: 30.8,
    },
    {
      name: "MemAgent",
      descriptive: 12,
      spatialStrict: 0,
      spatialRelaxed: 1.4,
      temporalStrict: 5.1,
      temporalRelaxed: 15.4,
    },
    {
      name: "Mem1",
      descriptive: 42,
      spatialStrict: 8.5,
      spatialRelaxed: 16.9,
      temporalStrict: 17.9,
      temporalRelaxed: 28.2,
    },
    {
      name: "ReMEmbR",
      descriptive: 46,
      spatialStrict: 11.3,
      spatialRelaxed: 23.9,
      temporalStrict: 33.3,
      temporalRelaxed: 51.3,
    },
    {
      name: "ConceptGraphs",
      descriptive: 47,
      spatialStrict: 4.2,
      spatialRelaxed: 18.3,
      temporalStrict: null,
      temporalRelaxed: null,
    },
    {
      name: "DAAAM",
      descriptive: 42,
      spatialStrict: 9.9,
      spatialRelaxed: 29.6,
      temporalStrict: 33.3,
      temporalRelaxed: 43.6,
    },
    {
      name: "VimRobo",
      descriptive: 68,
      spatialStrict: 15.5,
      spatialRelaxed: 49.3,
      temporalStrict: 46.2,
      temporalRelaxed: 61.5,
    },
  ],
  "9B": [
    {
      name: "Vanilla RAG",
      descriptive: 60,
      spatialStrict: 5.6,
      spatialRelaxed: 11.3,
      temporalStrict: 33.3,
      temporalRelaxed: 59,
    },
    {
      name: "ReAct",
      descriptive: 67,
      spatialStrict: 4.2,
      spatialRelaxed: 22.5,
      temporalStrict: 25.6,
      temporalRelaxed: 38.5,
    },
    {
      name: "MemAgent",
      descriptive: 15,
      spatialStrict: 2.8,
      spatialRelaxed: 2.8,
      temporalStrict: 10.3,
      temporalRelaxed: 17.9,
    },
    {
      name: "Mem1",
      descriptive: 48,
      spatialStrict: 5.6,
      spatialRelaxed: 19.7,
      temporalStrict: 23.1,
      temporalRelaxed: 38.5,
    },
    {
      name: "ReMEmbR",
      descriptive: 49,
      spatialStrict: 15.5,
      spatialRelaxed: 42.3,
      temporalStrict: 41,
      temporalRelaxed: 59,
    },
    {
      name: "ConceptGraphs",
      descriptive: 50,
      spatialStrict: 8.5,
      spatialRelaxed: 29.6,
      temporalStrict: null,
      temporalRelaxed: null,
    },
    {
      name: "DAAAM",
      descriptive: 48,
      spatialStrict: 12.7,
      spatialRelaxed: 33.8,
      temporalStrict: 38.5,
      temporalRelaxed: 61.5,
    },
    {
      name: "VimRobo",
      descriptive: 72,
      spatialStrict: 21.1,
      spatialRelaxed: 54.9,
      temporalStrict: 53.8,
      temporalRelaxed: 74.4,
    },
  ],
};
export const research = {
  title:
    "VimRobo: Unifying Spatio-Temporal Reasoning over Embodied Experience via In-Context Evidence Integration",
  abstract:
    "Retrieving and reasoning over long-horizon embodied experience is essential for robots. Existing approaches often separate visual observations from trajectory context, overlook spatio-temporal constraints, and lack task-aware memory organization. We introduce VimRobo for online, in-context reconstruction of task-relevant scene relations. Visual and Motion Memory Construction pairs indexed visual observations with global trajectory context, while Multi-Perspective Memory Retrieval selects evidence under semantic, spatial, and temporal constraints. Task-Specific Graph Initialization selects embodied skills to guide retrieval and visual verification. In-Context Graph Reasoning and Evolution organizes observations and perceptual summaries into a trajectory-grounded evidence graph to recover scene relations and guide further retrieval. We train retrieval and reasoning through reinforcement learning with answer-type-specific rewards. We also develop a RoboMem Question-Answer Synthesis pipeline using cross-segment instance links and relation constraints, and construct RoboMemBench for multi-instance reasoning. Experiments on NaVQA and RoboMemBench demonstrate gains over baselines in both descriptive and spatio-temporal reasoning.",
  bibtex: null as string | null,
  links: {
    paper: null as string | null,
    huggingface: null as string | null,
    code: "https://github.com/AtomRecur/VimRobo" as string | null,
  },
};
