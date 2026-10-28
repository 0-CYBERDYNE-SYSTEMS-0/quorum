import { createRequire } from "node:module";
import { Server } from "node:https";

// supertest binds the app to the `::` wildcard on an ephemeral port, then dials 127.0.0.1:<port>.
// On macOS another process can hold that same port on IPv4 only, so requests intermittently
// reach a foreign server. Dialing [::1] can only reach the dual-stack listener we just opened.
const Test = createRequire(import.meta.url)("supertest/lib/test.js");
Test.prototype.serverAddress = function (app: import("node:http").Server, path: string) {
  if (!app.address()) this._server = app.listen(0);
  const { port } = app.address() as import("node:net").AddressInfo;
  return `${app instanceof Server ? "https" : "http"}://[::1]:${port}${path}`;
};
