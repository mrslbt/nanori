import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding, RunResult, FieldObservation } from "./types.js";
import { checkField, patternRejects, describeStringShape } from "./checks/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadSkill(): string {
  const p = path.resolve(here, "..", ".claude/skills/jp-form-checks/SKILL.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Measured facts for one case, before any model sees them. */
export function measure(run: RunResult) {
  const facts: Array<{ stepIndex: number; obs: FieldObservation; check: ReturnType<typeof checkField>; patternRejects: boolean | null; shape: string[]; screenshot: string }> = [];
  const seen = new Set<string>();
  for (const s of run.steps) {
    for (const o of s.observations) {
      const c = checkField(o);
      const key = `${o.ref}|${c.kind}|${c.detail}`;
      if (c.kind === "accepted" || seen.has(key)) continue;
      seen.add(key);
      facts.push({ stepIndex: s.index, obs: o, check: c, patternRejects: patternRejects(o.pattern, o.requested), shape: describeStringShape(o.requested), screenshot: s.screenshot });
    }
  }
  return facts;
}

/**
 * Claude writes the finding text (observation, relevance, basis, cause, fix) from measured facts.
 * It classifies, but only from what the checks recorded, and the result is marked "proposed" until a human reviews it.
 */
export async function diagnose(baseline: RunResult, cases: RunResult[], url: string, goal: string): Promise<Finding[]> {
  const client = new Anthropic();
  const model = process.env.NANORI_DIAG_MODEL ?? "claude-opus-5-5";
  const skill = loadSkill();
  const baselineFacts = measure(baseline);
  const payload = cases.map((r) => ({
    identity: r.identity,
    outcome: r.outcome,
    stopReason: r.stopReason,
    stepsTaken: r.steps.length,
    facts: measure(r),
    agentErrors: r.steps.filter((s) => !s.ok).map((s) => ({ step: s.index, error: s.error })),
  }));

  const prompt = `You are writing findings for a nanori run.

Site: ${url}
Goal: ${goal}

Baseline (Japanese name) outcome: ${baseline.outcome}, stop reason: ${baseline.stopReason}, steps: ${baseline.steps.length}.
Baseline measured facts (should be empty if the baseline passed cleanly): ${JSON.stringify(baselineFacts)}

Name-format cases, with measured facts (produced by code, not by you):
${JSON.stringify(payload, null, 1)}

Write one finding per measured fact that is a rejection, truncation or alteration, and one finding per case that stopped before the checkpoint without a measured fact (classify those as agent_limit or inconclusive).

Rules for classification:
- site_defect: a rejection, truncation or alteration of this person's name that the baseline did not suffer, where the retained value or error text shows the site's rule acted on the name itself. If the pattern attribute in the source rejects the string, say so as the cause (observed in source). If no pattern is visible, say the cause is reproduced from behaviour, not confirmed in source.
- agent_limit: the agent typed the wrong thing, used the wrong field, or failed to navigate. Never blame the site for these.
- inconclusive: rejected, but the page documents an accepted way to enter this name (instructions, example, alternative field) that the agent did not try, or the baseline also failed, or the evidence is ambiguous. A required furigana field is NOT a defect by itself; it is a defect only if the person's katakana reading was rejected.
- no_issue: nothing happened.
Guidance relation: "applicable" only when the guidance text you quote directly covers the behaviour; "analogy" when it is close but scoped differently; "none" otherwise. Say "inconsistent with the guidance", never "violates" or "required by law".
Keep the original Japanese error text verbatim in errorText. Write observation, relevance, basis, cause and fix in plain English, two sentences max each. The fix is a concrete code change (pattern, maxlength, optional field), and must keep genuinely invalid input rejected.

Return JSON only: an array of findings with keys: identity, stepIndex, field, kind, requested, retained, errorText, classification, guidance, guidanceRef, observation, relevance, basis, cause, fix, screenshot.`;

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: `You write precise, honest test findings. Reference material follows.\n\n${skill}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  identity: { type: "string" }, stepIndex: { type: "integer" }, field: { type: "string" }, kind: { type: "string" },
                  requested: { type: "string" }, retained: { type: "string" }, errorText: { type: "string" },
                  classification: { type: "string", enum: ["site_defect", "agent_limit", "no_issue", "inconclusive"] },
                  guidance: { type: "string", enum: ["applicable", "analogy", "none"] }, guidanceRef: { type: "string" },
                  observation: { type: "string" }, relevance: { type: "string" }, basis: { type: "string" }, cause: { type: "string" }, fix: { type: "string" }, screenshot: { type: "string" },
                },
                required: ["identity", "stepIndex", "field", "kind", "requested", "retained", "errorText", "classification", "guidance", "guidanceRef", "observation", "relevance", "basis", "cause", "fix", "screenshot"],
              },
            },
          },
          required: ["findings"],
        },
      },
    },
  });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{\"findings\":[]}";
  const parsed = JSON.parse(text) as { findings: Omit<Finding, "id" | "reviewState">[] };
  return parsed.findings.map((f, i) => ({ ...f, id: `F${i + 1}`, reviewState: "proposed" as const }));
}
