import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectLoopbackHost } from "./setup-loopback";

const Test = createRequire(import.meta.url)("supertest/lib/test.js");

describe("test loopback host selection", () => {
  beforeEach(() => {
    vi.stubEnv("QUORUM_FORCE_IPV4_TEST_LOOPBACK", "0");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("falls back to IPv4 when the IPv6 probe rejects with EAFNOSUPPORT", async () => {
    const error = Object.assign(new Error("IPv6 is unavailable"), { code: "EAFNOSUPPORT" });
    const probeIPv6 = vi.fn().mockRejectedValue(error);

    await expect(selectLoopbackHost(probeIPv6)).resolves.toBe("127.0.0.1");
    expect(probeIPv6).toHaveBeenCalledOnce();
  });

  it("selects IPv6 when the IPv6 probe succeeds", async () => {
    const probeIPv6 = vi.fn().mockResolvedValue(undefined);

    await expect(selectLoopbackHost(probeIPv6)).resolves.toBe("::1");
    expect(probeIPv6).toHaveBeenCalledOnce();
  });

  it("uses the IPv4 environment override and logs its selection once", async () => {
    vi.stubEnv("QUORUM_FORCE_IPV4_TEST_LOOPBACK", "1");
    const probeIPv6 = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(selectLoopbackHost(probeIPv6)).resolves.toBe("127.0.0.1");
    expect(probeIPv6).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[test-loopback] QUORUM_FORCE_IPV4_TEST_LOOPBACK=1; using 127.0.0.1");
  });

  it("waits for the selected loopback listener and requests its assigned host and port", async () => {
    let boundAddress: AddressInfo | undefined;
    const app = createServer((_request, response) => {
      const address = app.address();
      if (address && typeof address !== "string") boundAddress = address;
      response.end("ok");
    });
    const test = new Test(app, "GET", "/");

    expect(app.address()).toBeNull();

    const response = await test.expect(200);
    const url = new URL(test.url);
    const requestHost = url.hostname.replace(/^\[(.*)\]$/, "$1");

    expect(response.text).toBe("ok");
    expect(boundAddress).toBeDefined();
    expect(["::1", "127.0.0.1"]).toContain(boundAddress?.address);
    expect(requestHost).toBe(boundAddress?.address);
    expect(Number(url.port)).toBe(boundAddress?.port);
    expect(Number(url.port)).toBeGreaterThan(0);
  });
});
