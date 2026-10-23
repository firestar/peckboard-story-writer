// Renders story documents into the project's `story/` folder via
// `project_files_write` (src/host.ts `writeFile`). Core only allows writes
// during a tool invocation, so every function here is called from a
// src/tools.ts handler — never from an http route.

import { writeFile } from "./host";
import { Brief, ChapterDoc, CharacterSheet, ColdReadDoc, PipelineState, Recap, Records, ReviewDoc } from "./types";

function storyPath(rel: string): string {
  return `story/${rel}`;
}

export function chapterFileName(chapter: number): string {
  return `chapter-${String(chapter).padStart(2, "0")}.md`;
}

export function writeBrief(brief: Brief): void {
  const lines: string[] = [`# ${brief.basics.title || "Untitled"}`, ""];
  lines.push(
    `Genre: ${brief.basics.genre} · Format: ${brief.basics.format} · Chapters: ${brief.basics.chapter_count}`,
  );
  lines.push(`POV: ${brief.basics.pov} · Tense: ${brief.basics.tense} · Tone: ${brief.basics.tone}`);
  lines.push(`Audience: ${brief.basics.audience} · Rating: ${brief.basics.rating}`, "");
  lines.push("## About", "", brief.about || "", "");
  lines.push("## Premise", "", brief.elements.premise || "", "");
  lines.push("## Plot outline", "", brief.elements.plot_outline || "", "");
  lines.push("## Setting / world", "", brief.elements.setting || "", "");
  if (brief.elements.themes.length > 0) {
    lines.push("## Themes", "", ...brief.elements.themes.map((t) => `- ${t}`), "");
  }
  if (brief.elements.style_rules.length > 0) {
    lines.push("## Style rules", "", ...brief.elements.style_rules.map((r) => `- ${r}`), "");
  }
  if (brief.elements.banned_words.length > 0) {
    lines.push("## Banned words", "", brief.elements.banned_words.join(", "), "");
  }
  writeFile(storyPath("brief.md"), lines.join("\n"));
}

function characterMarkdown(characters: CharacterSheet[]): string {
  if (characters.length === 0) return "# Characters\n";
  const lines = ["# Characters", ""];
  for (const c of characters) {
    lines.push(`## ${c.name ?? ""} (${c.role ?? ""})`, "");
    lines.push(`- Want: ${c.want ?? ""}`);
    lines.push(`- Need: ${c.need ?? ""}`);
    lines.push(`- Lie: ${c.lie ?? ""}`);
    lines.push(`- Wound: ${c.wound ?? ""}`);
    lines.push(`- Ghost: ${c.ghost ?? ""}`);
    lines.push(`- Speech habit: ${c.speech_habit ?? ""}`);
    lines.push(`- Initial emotion: ${c.initial_emotion ?? ""}`);
    const attitudes = c.attitudes ?? [];
    if (attitudes.length > 0) {
      lines.push("- Attitudes:");
      for (const a of attitudes) lines.push(`  - toward ${a.toward}: ${a.attitude} (${a.reason})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/// Mirror one record section to `story/records/<section>.json`; `characters`
/// additionally gets a human-readable `story/records/characters.md`.
export function writeRecordSection(section: keyof Records, items: unknown[]): void {
  writeFile(storyPath(`records/${section}.json`), JSON.stringify(items, null, 2));
  if (section === "characters") {
    writeFile(storyPath("records/characters.md"), characterMarkdown(items as CharacterSheet[]));
  }
}

export function writeChapter(doc: ChapterDoc): void {
  writeFile(storyPath(`chapters/${chapterFileName(doc.chapter)}`), doc.markdown);
}

export function writeRecaps(recaps: Recap[]): void {
  const sorted = recaps.slice().sort((a, b) => a.chapter - b.chapter);
  const lines = sorted.flatMap((r) => [`## Chapter ${r.chapter}`, "", r.recap, ""]);
  writeFile(storyPath("recaps.md"), ["# Recaps", "", ...lines].join("\n"));
}

export function writeReview(doc: ReviewDoc): void {
  const lines = [`# Chapter ${doc.chapter} — ${doc.pass} review`, ""];
  doc.rounds.forEach((round, i) => {
    lines.push(`## Round ${i + 1} — ${round.verdict} (${round.at})`, "", round.notes, "");
  });
  writeFile(storyPath(`reviews/chapter-${String(doc.chapter).padStart(2, "0")}-${doc.pass}.md`), lines.join("\n"));
}

export function writeState(state: PipelineState): void {
  writeFile(storyPath("state.json"), JSON.stringify(state, null, 2));
}

export function writeColdRead(doc: ColdReadDoc): void {
  const lines = [`# Chapter ${doc.chapter} — cold read`, ""];
  const unresolved = doc.items.filter((i) => i.fix === null).length;
  lines.push(`Attempt ${doc.attempt} · against chapter revision ${doc.chapter_revision} · ${doc.items.length} item(s), ${unresolved} unfixed.`, "");
  if (doc.first_three_lines) {
    const f = doc.first_three_lines;
    lines.push(
      "## First three lines",
      "",
      `- Narrator clear: ${f.narrator ? "yes" : "no"}`,
      `- Want clear: ${f.want ? "yes" : "no"}`,
      `- Tension clear: ${f.tension ? "yes" : "no"}`,
      `- Overall clear: ${f.clear ? "yes" : "no"}`,
      "",
    );
  }
  lines.push("## Items", "");
  if (doc.items.length === 0) {
    lines.push("(none)", "");
  } else {
    for (const item of doc.items) {
      lines.push(`### ${item.id}`, "", item.text, "");
      if (item.quote) lines.push(`> ${item.quote}`, "");
      lines.push(item.fix ? `Fix: ${item.fix}` : "Fix: _not yet fixed_", "");
    }
  }
  lines.push("## Characters, in order of first appearance", "");
  if (doc.characters.length === 0) {
    lines.push("(none)");
  } else {
    for (const c of doc.characters) lines.push(`- ${c.name}: ${c.said}`);
  }
  writeFile(storyPath(`cold-reads/ch-${String(doc.chapter).padStart(2, "0")}.md`), lines.join("\n"));
}
