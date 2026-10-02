import { describe, expect, it } from "vitest";
import { migrationFingerprint, type MigrationFingerprintColumn } from "../src/postgres/sqlite-migration.js";

const COLUMNS: MigrationFingerprintColumn[] = [
  { name: "id", type: "TEXT" },
  { name: "followers", type: "INTEGER" },
  { name: "score", type: "REAL" },
  { name: "payload", type: "TEXT" },
];

describe("SQLite to PostgreSQL migration fingerprint", () => {
  it("normalizes lossless pg integer and float reader representations", () => {
    const sqliteRows = [{
      id: "creator_1",
      followers: 9_007_199_254_740_992n,
      score: "0.7500",
      payload: '{"platform":"youtube"}',
    }];
    const postgresRows = [{
      id: "creator_1",
      followers: "9007199254740992",
      score: 0.75,
      payload: '{"platform":"youtube"}',
    }];

    expect(migrationFingerprint(sqliteRows, COLUMNS)).toBe(migrationFingerprint(postgresRows, COLUMNS));
  });

  it("still rejects changed text payloads", () => {
    const source = [{ id: "creator_1", followers: 12, score: 0.75, payload: '{"handle":"source"}' }];
    const target = [{ id: "creator_1", followers: "12", score: "0.75", payload: '{"handle":"changed"}' }];

    expect(migrationFingerprint(source, COLUMNS)).not.toBe(migrationFingerprint(target, COLUMNS));
  });

  it("ignores source and target text collation order differences", () => {
    const source = [
      { id: "creator_中文", followers: 12, score: 0.75, payload: "{}" },
      { id: "creator_Z", followers: 13, score: 0.8, payload: "{}" },
    ];
    const target = [
      { id: "creator_Z", followers: "13", score: "0.8", payload: "{}" },
      { id: "creator_中文", followers: "12", score: "0.75", payload: "{}" },
    ];

    expect(migrationFingerprint(source, COLUMNS)).toBe(migrationFingerprint(target, COLUMNS));
  });
});
