import { createRequire } from "node:module";
import { Server } from "node:https";
import net from "node:net";

// Bind supertest's listener and request URL to the same loopback family. This avoids
// cross-family port collisions while keeping IPv6 loopback as the macOS preference.
const Test = createRequire(import.meta.url)("supertest/lib/test.js");

export type LoopbackHost = "::1" | "127.0.0.1";

type LoopbackListenResult = {
  address?: import("node:net").AddressInfo;
  error?: Error;
};

export async function selectLoopbackHost(probeIPv6: () => Promise<void>): Promise<LoopbackHost> {
  if (process.env.QUORUM_FORCE_IPV4_TEST_LOOPBACK === "1") {
    console.log("[test-loopback] QUORUM_FORCE_IPV4_TEST_LOOPBACK=1; using 127.0.0.1");
    return "127.0.0.1";
  }

  try {
    await probeIPv6();
    return "::1";
  } catch {
    return "127.0.0.1";
  }
}

function probeIPv6Loopback(): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "::1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

const loopbackHost = await selectLoopbackHost(probeIPv6Loopback);
const originalEnd = Test.prototype.end;

function loopbackUrl(protocol: string, path: string, port: number): string {
  const host = loopbackHost === "::1" ? "[::1]" : loopbackHost;
  return `${protocol}://${host}:${port}${path}`;
}

Test.prototype.serverAddress = function (app: import("node:http").Server, path: string) {
  const protocol = app instanceof Server ? "https" : "http";
  const address = app.address();

  if (address) return loopbackUrl(protocol, path, (address as import("node:net").AddressInfo).port);

  this._loopbackProtocol = protocol;
  this._loopbackPath = path;

  try {
    this._server = app.listen(0, loopbackHost);
    this._loopbackReady = new Promise((resolve: (result: LoopbackListenResult) => void) => {
      const server = this._server;
      const cleanup = () => {
        server.removeListener("listening", onListening);
        server.removeListener("error", onError);
      };
      const onListening = () => {
        cleanup();
        const address = server.address();
        resolve(address && typeof address !== "string"
          ? { address }
          : { error: new Error("Test server started without a TCP address") });
      };
      const onError = (error: Error) => {
        cleanup();
        resolve({ error });
      };

      server.once("listening", onListening);
      server.once("error", onError);
      if (server.listening) onListening();
    });
  } catch (error) {
    this._loopbackReady = Promise.resolve({ error: error as Error });
  }

  // Test's constructor needs a URL synchronously. end() replaces port 0 after
  // the explicit-host listener reports its assigned port.
  return loopbackUrl(protocol, path, 0);
};

Test.prototype.end = function (fn?: (error: Error | null, response?: unknown) => void) {
  if (!this._loopbackReady) return originalEnd.call(this, fn);
  if (this._loopbackEndCalled) throw new Error(".end() was called twice. This is not supported in superagent");
  this._loopbackEndCalled = true;

  this._loopbackReady.then(({ address, error }: LoopbackListenResult) => {
    if (!error && address) {
      this.url = loopbackUrl(this._loopbackProtocol, this._loopbackPath, address.port);
      originalEnd.call(this, fn);
      return;
    }

    const listenError = error || new Error("Test server did not start listening");
    const finish = () => this.assert(listenError, undefined, fn);
    const server = this._server;
    if (server && server._handle) {
      server.close(() => finish());
    } else {
      finish();
    }
  });

  return this;
};
