import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transaction, SqlQuery } from "@prisma/driver-adapter-utils";
import { serializeTransaction } from "../src/server/postgres-adapter";

const query = (sql: string): SqlQuery => ({ sql, args: [], argTypes: [] });
function fixture() {
  const calls: string[] = [];
  let active = 0;
  const transaction: Transaction = {
    provider: "postgres",
    adapterName: "test",
    options: { usePhantomQuery: false },
    async queryRaw(q) {
      assert.equal(
        active++,
        0,
        "Only one query can execute on a transaction client",
      );
      calls.push(q.sql);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      if (q.sql === "FAIL") throw new Error("database failure");
      return { columnNames: [], columnTypes: [], rows: [] };
    },
    async executeRaw(q) {
      await this.queryRaw(q);
      return 1;
    },
    async commit() {
      assert.equal(active, 0);
      calls.push("release:commit");
    },
    async rollback() {
      assert.equal(active, 0);
      calls.push("release:rollback");
    },
  };
  // Real pg.executeRaw performs IO directly, rather than calling queryRaw.
  const rawQuery = transaction.queryRaw.bind(transaction);
  transaction.executeRaw = async (q) => {
    await rawQuery(q);
    return 1;
  };
  transaction.createSavepoint = async function (name) {
    await this.executeRaw(query(`SAVEPOINT ${name}`));
  };
  return { transaction, calls };
}

test("transaction queries and connection release are ordered without overlap", async () => {
  const { transaction, calls } = fixture();
  const tx = serializeTransaction(transaction);
  await Promise.all([
    tx.queryRaw(query("read")),
    tx.executeRaw(query("write")),
    tx.commit(),
  ]);
  assert.deepEqual(calls, ["read", "write", "release:commit"]);
});

test("database errors reach callers and rollback still releases the connection", async () => {
  const { transaction, calls } = fixture();
  const tx = serializeTransaction(transaction);
  const failure = tx.queryRaw(query("FAIL"));
  const rollback = tx.rollback();
  await assert.rejects(failure, /database failure/);
  await rollback;
  assert.deepEqual(calls, ["FAIL", "release:rollback"]);
});

test("separate transactions remain parallel and savepoints use their own queue", async () => {
  const a = fixture(),
    b = fixture();
  const txA = serializeTransaction(a.transaction),
    txB = serializeTransaction(b.transaction);
  await Promise.all([
    txA.queryRaw(query("a")),
    txA.createSavepoint!("safe"),
    txB.queryRaw(query("b")),
  ]);
  assert.deepEqual(a.calls, ["a", "SAVEPOINT safe"]);
  assert.deepEqual(b.calls, ["b"]);
});
