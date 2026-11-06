export interface Identity {
  /** Short id used in reports, labelled by property, never nationality. */
  id: string;
  /** What this case tests, in plain words. */
  tests: string;
  fullName: string;
  familyName: string | null;
  givenName: string | null;
  /** Katakana reading, split like the name. */
  kanaFamily: string | null;
  kanaGiven: string | null;
  /** Full katakana reading as one string. */
  kanaFull: string;
  email: string;
  phone: string;
  postal: string;
  address: string;
  /** Which Tokyo guidance bullet this case exercises (page 27 unless noted). */
  guidance: string;
}

export interface ElementInfo {
  ref: string;
  tag: string;
  type: string | null;
  name: string | null;
  id: string | null;
  label: string | null;
  placeholder: string | null;
  text: string | null;
  required: boolean;
  maxlength: number | null;
  pattern: string | null;
  value: string;
  options?: string[];
}

export interface FieldObservation {
  ref: string;
  label: string | null;
  name: string | null;
  requested: string;
  retained: string;
  maxlength: number | null;
  pattern: string | null;
  required: boolean;
  validationMessage: string;
  ariaInvalid: boolean;
  visibleErrors: string[];
}

export type ActionType = "click" | "fill" | "select" | "done" | "stuck";

export interface Action {
  action: ActionType;
  ref?: string;
  value?: string;
  reason: string;
}

export interface Step {
  index: number;
  url: string;
  title: string;
  action: Action;
  ok: boolean;
  error?: string;
  screenshot: string;
  observations: FieldObservation[];
  pageErrors: string[];
}

export type Outcome = "reached_checkpoint" | "reached_with_workaround" | "stopped_before_checkpoint" | "not_determined";

export interface RunResult {
  identity: Identity;
  outcome: Outcome;
  stopReason: string;
  steps: Step[];
  startedAt: string;
  endedAt: string;
  model: string;
}

export type FindingClass = "site_defect" | "agent_limit" | "no_issue" | "inconclusive";
export type GuidanceRelation = "applicable" | "analogy" | "none";

export interface Finding {
  id: string;
  identity: string;
  stepIndex: number;
  field: string;
  kind: string;
  requested: string;
  retained: string;
  errorText: string;
  classification: FindingClass;
  guidance: GuidanceRelation;
  guidanceRef: string;
  observation: string;
  relevance: string;
  basis: string;
  cause: string;
  fix: string;
  reviewState: "proposed" | "reviewed";
  screenshot: string;
}

export interface RunBundle {
  id: string;
  url: string;
  goal: string;
  createdAt: string;
  target: "public" | "local_reproduction";
  baseline: RunResult;
  cases: RunResult[];
  findings: Finding[];
  summary: string;
}
