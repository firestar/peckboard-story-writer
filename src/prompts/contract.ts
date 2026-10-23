// The "use story_* tools to pull context and push results" contract text
// embedded in every pipeline card. The six MCP tools are fixed (SW-1/SW-2);
// this just names them consistently per stage so a worker never has to guess
// which tool to call.

export const TOOLS = {
  brief: "story_get_brief",
  records: "story_get_records",
  submitRecords: "story_submit_records",
  submitChapter: "story_submit_chapter",
  updateState: "story_update_state",
  report: "story_report_review",
} as const;

export function chapterPath(n: number): string {
  return `story/chapters/chapter-${String(n).padStart(2, "0")}.md`;
}

/// The pipeline-state `data` key a generate card pushes its draft under.
/// story_update_state shallow-merges `data`, so each element gets its own
/// top-level key — a nested `drafts` object would be overwritten wholesale
/// by whichever generate card reports last.
export function draftKey(element: string): string {
  return `draft_${element}`;
}

export type StageKind = "records" | "pilot" | "chapter" | "review" | "revision" | "generate";

export interface ContractInput {
  chapter?: number;
  pass?: string;
  element?: string;
}

export function contract(kind: StageKind, x: ContractInput = {}): string {
  const lines: string[] = [
    "## Tools contract",
    "",
    `Pull context first: ${TOOLS.brief}, then ${TOOLS.records}.`,
    `Push results only through story_* tools — the plugin stores them and writes the story/ files. Never write story/ files directly.`,
  ];

  switch (kind) {
    case "records":
      lines.push(
        `Submit everything with ${TOOLS.submitRecords} {records:{characters, relationships, knowledge, setups, glossary, choices, chapter_state, scene_sheets}} — one call per section is fine, or all at once.`,
        `Report progress with ${TOOLS.updateState} {stage:"records", note}.`,
      );
      break;
    case "pilot":
    case "chapter": {
      const n = x.chapter ?? 1;
      lines.push(
        `Read prior chapters' recaps and ${TOOLS.records} {chapter:${n}} before writing.`,
        `Submit the finished chapter with ${TOOLS.submitChapter} {chapter:${n}, markdown, recap, records:{chapter_state, knowledge, setups, glossary, choices, scene_sheets}}.`,
        `Report progress with ${TOOLS.updateState} {stage:"${kind === "pilot" ? "pilot" : "chapters"}", note}.`,
      );
      break;
    }
    case "review": {
      const where = x.chapter != null ? `chapter ${x.chapter} (${chapterPath(x.chapter)})` : "every chapter (story/chapters/)";
      const reportOn = x.chapter != null ? `{chapter:${x.chapter}, ` : "once per chapter reviewed, {chapter, ";
      lines.push(
        `Read the current text of ${where} from the repo.`,
        `Fix problems in place, then resubmit the full fixed text with ${TOOLS.submitChapter} {chapter, markdown, recap, records}.`,
        `Report the verdict with ${TOOLS.report} ${reportOn}pass:"${x.pass}", verdict, notes, rule?}. "pass" once your fixes land cleanly; "changes_requested" only when the fix needs a rewrite beyond this pass. Put a reusable instruction in "rule" when it should apply to every later chapter.`,
      );
      break;
    }
    case "revision": {
      const n = x.chapter ?? 1;
      lines.push(
        `Read the current chapter ${n} text (${chapterPath(n)}) and the feedback above.`,
        `Resubmit the revised chapter with ${TOOLS.submitChapter} {chapter:${n}, markdown, recap, records}.`,
        `Report progress with ${TOOLS.updateState} {note:"chapter ${n} revised: <what changed>"}.`,
      );
      break;
    }
    case "generate":
      lines.push(
        `Push the draft with ${TOOLS.updateState} {stage:"setup", data:{"${draftKey(x.element ?? "")}": <value>}} — the owner reviews it in the wizard.`,
        `Don't call ${TOOLS.submitRecords} or ${TOOLS.submitChapter} for this card.`,
      );
      break;
  }

  lines.push("Don't create, move or unblock pipeline cards — the plugin advances the pipeline when this card reaches done.");
  return lines.join("\n");
}
