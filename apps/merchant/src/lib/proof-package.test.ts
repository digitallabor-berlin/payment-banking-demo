import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { verifierEvents } from "../db/schema.js";
import { proofPackageFor } from "./proof-package.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-proof-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function requestEvent(txId: string, jws: string | null, receivedAt: number): void {
  db.insert(verifierEvents)
    .values({
      txId,
      event: "presentation_request_delivered",
      transport: "request_uri",
      signedRequest: jws,
      vpTokenJson: null,
      receivedAt,
    })
    .run();
}

function completionEvent(txId: string, vpToken: unknown, receivedAt: number): void {
  db.insert(verifierEvents)
    .values({
      txId,
      event: "verification_completed",
      transport: null,
      signedRequest: null,
      vpTokenJson: vpToken === null ? null : JSON.stringify(vpToken),
      receivedAt,
    })
    .run();
}

describe("proofPackageFor", () => {
  it("returns null when nothing has arrived", () => {
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns null with only a signed request", () => {
    // PaSO §4.1 makes BOTH members REQUIRED. Half a package is not a package.
    requestEvent("ver_1", "a.b.c", 10);
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns null with only a vp_token", () => {
    completionEvent("ver_1", { dpc: ["x"] }, 10);
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns both members once both have arrived", () => {
    requestEvent("ver_1", "a.b.c", 10);
    completionEvent("ver_1", { dpc: ["x"] }, 11);

    expect(proofPackageFor(db, "ver_1")).toEqual({
      signedRequest: "a.b.c",
      vpToken: { dpc: ["x"] },
    });
  });

  it("prefers the NEWEST signed request when several were delivered", () => {
    // Design D6. On request_uri the event fires per fetch and ECDSA is
    // randomized, so each copy is different bytes. Nothing tells us which the
    // wallet consumed; the last one served is the closest thing to an answer.
    requestEvent("ver_1", "first.b.c", 10);
    requestEvent("ver_1", "second.b.c", 20);
    completionEvent("ver_1", { dpc: ["x"] }, 30);

    expect(proofPackageFor(db, "ver_1")!.signedRequest).toBe("second.b.c");
  });

  it("skips a request event that carried no artefact", () => {
    // foundry's include_raw_artifacts is off by default: the event still fires,
    // it just carries nothing. A NULL must not shadow a real JWS that arrived
    // earlier.
    requestEvent("ver_1", "real.b.c", 10);
    requestEvent("ver_1", null, 20);
    completionEvent("ver_1", { dpc: ["x"] }, 30);

    expect(proofPackageFor(db, "ver_1")!.signedRequest).toBe("real.b.c");
  });

  it("returns null when the completion carried no vp_token", () => {
    requestEvent("ver_1", "a.b.c", 10);
    completionEvent("ver_1", null, 20);

    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("never mixes two transactions", () => {
    requestEvent("ver_1", "mine.b.c", 10);
    completionEvent("ver_2", { dpc: ["theirs"] }, 20);

    expect(proofPackageFor(db, "ver_1")).toBeNull();
    expect(proofPackageFor(db, "ver_2")).toBeNull();
  });

  it("returns null rather than throwing when the stored token is not JSON", () => {
    requestEvent("ver_1", "a.b.c", 10);
    db.insert(verifierEvents)
      .values({
        txId: "ver_1",
        event: "verification_completed",
        transport: null,
        signedRequest: null,
        vpTokenJson: "{ not json",
        receivedAt: 20,
      })
      .run();

    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });
});