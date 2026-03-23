import { describe, it, expect } from "vitest";
import { getNextAction } from "../getNextAction";
import { getRequestCloseLoopState } from "../getRequestCloseLoopState";
import { PRICING_CRITICAL_KEYS } from "../../constants";

const pricingKey = [...PRICING_CRITICAL_KEYS][0];

describe("EQ1 cross-function coherence", () => {
  it("response_analyzed with no proposed facts: both functions agree on 'done'", () => {
    const validatedFacts = [{ fact_key: pricingKey, validation_status: "validated" }];

    const action = getNextAction({
      status: "response_analyzed",
      responsesCount: 1,
      proposedFactsCount: 0,
      lastUpdateAt: new Date().toISOString(),
    });

    const closeLoop = getRequestCloseLoopState("response_analyzed", validatedFacts, false);

    // getNextAction says no blocking action
    expect(action).toBe("ready");
    // getRequestCloseLoopState says closable
    expect(closeLoop.state).toBe("ready_to_close");
  });
});
