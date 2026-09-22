/**
 * Sandbox test scenarios. A merchant sends `test_scenario` on a test-mode request and the
 * orchestrator expands it into per-attempt primitive hints for the mock adapters.
 * Live mode ignores the field entirely.
 */
export const TEST_SCENARIOS = {
  success: "Payment is approved by the first provider.",
  authorize: "Payment is authorised only; capture it with POST /v1/payments/{id}/capture.",
  requires_action: "Provider requests customer action (hosted page / redirect). Complete it via the sandbox hosted page.",
  soft_decline: "First provider soft-declines (insufficient funds); NATIO cascades to the next provider.",
  hard_decline: "Provider hard-declines (stolen card). No retry; payment fails.",
  technical_error: "First provider returns a technical error; NATIO fails over to the next provider.",
  failover: "Alias of technical_error: Provider A fails technically, Provider B succeeds.",
  timeout: "First provider times out, NATIO confirms no charge exists and fails over.",
  timeout_recovered: "Provider times out but had processed the payment; NATIO recovers it via status lookup — no double charge.",
  unavailable: "First provider is unavailable (HTTP 503); NATIO fails over.",
  all_fail: "Every eligible provider fails technically; payment ends as failed.",
  review: "Risk engine returns REVIEW; payment waits for manual approval in admin.",
  block: "Risk engine returns BLOCK; payment fails immediately.",
} as const;

export type TestScenario = keyof typeof TEST_SCENARIOS;

export function isTestScenario(v: unknown): v is TestScenario {
  return typeof v === "string" && v in TEST_SCENARIOS;
}

/** Primitive hint for attempt number `attemptIndex` (0-based, across the whole payment). */
export function primitiveForAttempt(scenario: string | null | undefined, attemptIndex: number): string | undefined {
  if (!scenario) return undefined;
  switch (scenario) {
    case "success":
      return "success";
    case "authorize":
      return "authorize";
    case "requires_action":
      return "requires_action";
    case "soft_decline":
      return attemptIndex === 0 ? "soft_decline" : "success";
    case "hard_decline":
      return "hard_decline";
    case "technical_error":
    case "failover":
      return attemptIndex === 0 ? "technical_error" : "success";
    case "timeout":
      return attemptIndex === 0 ? "timeout" : "success";
    case "timeout_recovered":
      return attemptIndex === 0 ? "timeout_created" : "success";
    case "unavailable":
      return attemptIndex === 0 ? "provider_unavailable" : "success";
    case "all_fail":
      return "technical_error";
    default:
      return undefined;
  }
}
