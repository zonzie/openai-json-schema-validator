"use client";

import { track } from "@vercel/analytics";

export type ValidationOutcome =
  | "pass"
  | "pass_with_warnings"
  | "error"
  | "input_too_large";

function trackPublicEvent(
  name: "schema_validation" | "strict_patch_applied" | "patched_json_copied",
  properties?: Record<string, string>,
): void {
  try {
    if (properties) {
      track(name, properties);
    } else {
      track(name);
    }
  } catch {
    // Measurement must never interrupt the local validation workflow.
  }
}

export function trackValidation(outcome: ValidationOutcome): void {
  trackPublicEvent("schema_validation", { outcome });
}

export function trackPatchApplied(): void {
  trackPublicEvent("strict_patch_applied");
}

export function trackPatchedJsonCopied(): void {
  trackPublicEvent("patched_json_copied");
}
