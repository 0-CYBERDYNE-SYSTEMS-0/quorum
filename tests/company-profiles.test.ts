import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

process.env.DATABASE_URL = "";
process.env.SESSION_SECRET = "company-profile-test-secret";
process.env.NODE_ENV = "test";
process.env.LOGIN_RATELIMIT_MAX = "1000";

import { registerRoutes } from "../server/routes";

async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(app);
  return app;
}

async function registerUser(agent: ReturnType<typeof request.agent>, suffix: string) {
  const response = await agent.post("/api/register").send({
    username: `company_profile_${suffix}_${Date.now()}`,
    password: "testpass123",
    email: `company_profile_${suffix}_${Date.now()}@example.com`,
  });
  expect(response.status).toBe(201);
}

describe("company profile API", () => {
  let app: Express;
  beforeAll(async () => { app = await createTestApp(); });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/protected/company-profile");
    expect(response.status).toBe(401);
  });

  it("returns only a null profile when none has been saved", async () => {
    const agent = request.agent(app);
    await registerUser(agent, "empty");

    const response = await agent.get("/api/protected/company-profile");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ profile: null });
  });

  it("creates and partially updates the business profile", async () => {
    const agent = request.agent(app);
    await registerUser(agent, "upsert");

    const created = await agent.put("/api/protected/company-profile").send({
      companyName: "Northstar Systems",
      industry: "Software",
      stage: "Series A",
      headcount: "11-50",
      revenueBand: "$5M-$10M ARR",
      businessModel: "B2B SaaS",
      markets: ["United States", "Canada"],
      constraints: "18 months of runway",
      riskAppetite: "balanced",
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      companyName: "Northstar Systems",
      industry: "Software",
      stage: "Series A",
      headcount: "11-50",
      revenueBand: "$5M-$10M ARR",
      businessModel: "B2B SaaS",
      markets: ["United States", "Canada"],
      constraints: "18 months of runway",
      riskAppetite: "balanced",
    });

    const partial = await agent.put("/api/protected/company-profile").send({ stage: "Profitable" });
    expect(partial.status).toBe(200);
    expect(partial.body.stage).toBe("Profitable");
    expect(partial.body.companyName).toBe("Northstar Systems");

    const fetched = await agent.get("/api/protected/company-profile");
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual({ profile: partial.body });
  });

  it("rejects invalid values and fields outside the company profile", async () => {
    const agent = request.agent(app);
    await registerUser(agent, "invalid");

    const invalidHeadcount = await agent.put("/api/protected/company-profile").send({ headcount: 42 });
    expect(invalidHeadcount.status).toBe(400);

    const legacyField = await agent.put("/api/protected/company-profile").send({ acres: 100 });
    expect(legacyField.status).toBe(400);
  });
});
