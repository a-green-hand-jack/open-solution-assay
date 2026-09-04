import { z } from "zod";
import { PHASES, RESOLUTION_LABELS, type Phase } from "./phases.js";

export const PhaseStateSchema = z.object({
  status: z.enum(["pending", "running", "failed", "interrupted", "completed"]),
  kind: z.enum(["deterministic", "judgment"]),
  attempts: z.number().int().nonnegative().default(0),
  started_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  notes: z.string().default(""),
  error: z.string().nullable().default(null),
});

/**
 * The recovery tier is frozen at the `problem` phase and caps the run's
 * verdict for the rest of its life. A later phase may not raise it.
 */
export const TierCapSchema = z.object({
  tier: z.enum(["T0", "T1", "T2", "T3", "T4"]),
  resolution_ceiling: z.enum(RESOLUTION_LABELS),
  scope_coverage_ceiling: z.number().int().min(0).max(5),
  rationale: z.string().min(1),
});

export const RunStateSchema = z.object({
  schema_version: z.literal("osa-run-v1"),
  run_id: z.string().min(1),
  status: z.enum(["preparing", "prepared", "running", "failed", "interrupted", "completed"]),
  task: z.string().min(1),
  source_digest: z.string().length(64),
  phases: z.record(PhaseStateSchema),
  current_phase: z.string().nullable().default(null),
  tier_cap: TierCapSchema.nullable().default(null),
  paper: z.object({
    located: z.string().nullable(),
    candidates: z.array(z.string()).default([]),
    osp_status: z.enum(["off", "running", "completed", "failed", "unavailable"]).default("off"),
    osp_output: z.string().nullable().default(null),
  }).default({ located: null, candidates: [], osp_status: "off", osp_output: null }),
  coverage: z.object({ closed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).nullable().default(null),
  provenance: z.record(z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable().default(null),
  report: z.string().nullable().default(null),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type TierCap = z.infer<typeof TierCapSchema>;

export function initialPhases(): Record<Phase, z.infer<typeof PhaseStateSchema>> {
  const out = {} as Record<Phase, z.infer<typeof PhaseStateSchema>>;
  for (const phase of PHASES) {
    out[phase] = {
      status: "pending",
      kind: (["intake", "problem", "graph", "execute", "shortfall"] as readonly string[]).includes(phase) ? "deterministic" : "judgment",
      attempts: 0, started_at: null, completed_at: null, notes: "", error: null,
    };
  }
  return out;
}
