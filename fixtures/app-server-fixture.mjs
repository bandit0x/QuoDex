import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.env.CODEX_CREDITS_FIXTURE_SCENARIO ?? "healthy";
const delayMs = Number(process.env.CODEX_CREDITS_FIXTURE_DELAY_MS ?? "0");

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function healthyResult() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    rateLimits: {
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 24,
        windowDurationMins: 300,
        resetsAt: nowSeconds + 3 * 60 * 60 + 24 * 60,
      },
      secondary: {
        usedPercent: 58,
        windowDurationMins: 10080,
        resetsAt: nowSeconds + 2 * 24 * 60 * 60 + 4 * 60 * 60,
      },
      planType: "plus",
      rateLimitReachedType: null,
    },
    rateLimitResetCredits: {
      availableCount: 2,
      credits: [
        {
          id: "RateLimitResetCredit_fixture_1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: nowSeconds - 24 * 60 * 60,
          expiresAt: nowSeconds + 5 * 24 * 60 * 60,
          title: "Full reset (Weekly + 5 hr)",
          description: "Fixture only",
        },
      ],
    },
  };
}

// 按真实协议形状构造 Pro 档（prolite）响应：唯一窗口是 10080 分钟的周窗口，
// 位于 primary 槽位，secondary 为空，planType 直接随响应披露。
function proWeeklyResult() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    rateLimits: {
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 89,
        windowDurationMins: 10080,
        resetsAt: nowSeconds + 4 * 24 * 60 * 60,
      },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      individualLimit: null,
      spendControlReached: false,
      planType: "pro",
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: {},
    rateLimitResetCredits: null,
  };
}

function respondToRateLimitRead(request) {
  if (scenario === "early-exit") process.exit(17);
  if (scenario === "timeout") return;
  if (scenario === "malformed") {
    process.stdout.write("{definitely-not-json}\n");
    return;
  }
  if (scenario === "logged-out") {
    write({
      id: request.id,
      error: { code: -32001, message: "not logged in" },
    });
    return;
  }
  if (scenario === "null-fields") {
    write({
      id: request.id,
      result: {
        rateLimits: { primary: null, secondary: null },
        rateLimitResetCredits: null,
      },
    });
    return;
  }
  if (scenario === "pro-weekly" || scenario === "plan-unknown") {
    const result = proWeeklyResult();
    if (scenario === "plan-unknown") {
      // 协议未披露 planType 的响应：窗口照常解析，套餐保持未知。
      delete result.rateLimits.planType;
    }
    write({ id: request.id, result });
    return;
  }

  const result = healthyResult();
  write({ id: request.id, result });
  if (scenario === "sparse-update") {
    write({
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          primary: { ...result.rateLimits.primary, usedPercent: 31 },
        },
      },
    });
  }
}

input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  if (request.method === "initialize") {
    write({
      id: request.id,
      result: {
        userAgent: "codex-capacity-fixture/0.1.0",
        codexHome: null,
        platformFamily: "windows",
        platformOs: "windows",
      },
    });
    return;
  }

  if (request.method === "account/rateLimits/read") {
    if (delayMs > 0) {
      setTimeout(() => respondToRateLimitRead(request), delayMs);
    } else {
      respondToRateLimitRead(request);
    }
  }
});
