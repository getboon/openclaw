import { extractSkillMarkdownBody } from "./frontmatter.js";

const TLDR_HEADING = "tldr";
const JOURNEY_MARKER = "When you run this, the agent will:";
const MIN_JOURNEY_STEPS = 3;
const MAX_JOURNEY_STEPS = 6;
const OUTPUT_PATTERN = /^\*\*Output:\*\*\s+\S/u;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/u;
const TOP_LEVEL_BULLET_PATTERN = /^[-*]\s+\S/u;
const FENCE_PATTERN = /^(?:```|~~~)/u;

const TLDR_FORMAT_ERROR = `Skill proposal must start with a complete ## TLDR section.

Expected format:

## TLDR

<One plain-English sentence explaining what this skill is for.>

When you run this, the agent will:

- <First journey step>
- <Second journey step>
- <Third journey step>

**Output:** <The deliverable the user receives>`;

export function assertValidSkillTldr(content: string): void {
  const lines = extractSkillMarkdownBody(content).split("\n");
  const firstSection = findFirstSection(lines);
  if (
    !firstSection ||
    firstSection.title !== TLDR_HEADING ||
    !hasValidPrelude(lines, firstSection.index)
  ) {
    throw new Error(TLDR_FORMAT_ERROR);
  }

  const sectionLines = readSectionLines(lines, firstSection.index + 1);
  const meaningful = sectionLines.map((line) => line.trim()).filter(Boolean);
  const summary = meaningful[0];
  const marker = meaningful[1];
  if (
    !summary ||
    HEADING_PATTERN.test(summary) ||
    TOP_LEVEL_BULLET_PATTERN.test(summary) ||
    summary === JOURNEY_MARKER ||
    OUTPUT_PATTERN.test(summary) ||
    marker !== JOURNEY_MARKER
  ) {
    throw new Error(TLDR_FORMAT_ERROR);
  }

  const outputIndex = meaningful.findIndex(
    (line, index) => index >= 2 && OUTPUT_PATTERN.test(line),
  );
  if (outputIndex === -1 || outputIndex !== meaningful.length - 1) {
    throw new Error(TLDR_FORMAT_ERROR);
  }

  const journeySteps = meaningful.slice(2, outputIndex);
  if (
    journeySteps.length < MIN_JOURNEY_STEPS ||
    journeySteps.length > MAX_JOURNEY_STEPS ||
    journeySteps.some((line) => !TOP_LEVEL_BULLET_PATTERN.test(line))
  ) {
    throw new Error(TLDR_FORMAT_ERROR);
  }
}

function findFirstSection(lines: readonly string[]): { index: number; title: string } | null {
  let inFence = false;
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    if (heading?.[1] === "##") {
      return { index, title: normalizeHeading(heading[2]) };
    }
  }
  return null;
}

function hasValidPrelude(lines: readonly string[], sectionIndex: number): boolean {
  const meaningful = lines
    .slice(0, sectionIndex)
    .map((line) => line.trim())
    .filter(Boolean);
  return meaningful.length === 0 || (meaningful.length === 1 && /^#\s+[^#]/u.test(meaningful[0]));
}

function readSectionLines(lines: readonly string[], startIndex: number): string[] {
  const section: string[] = [];
  let inFence = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      section.push(rawLine);
      continue;
    }
    if (!inFence && HEADING_PATTERN.test(line)) {
      break;
    }
    section.push(rawLine);
  }
  return section;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase();
}
