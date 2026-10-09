import { PrismaPg } from "@prisma/adapter-pg";
import type { Transaction } from "@prisma/driver-adapter-utils";

/** One transaction owns one pg client, including Prisma-generated relation queries. */
export function serializeTransaction(transaction: Transaction): Transaction {
  let tail: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    // Keep the queue usable for ROLLBACK after a failed query. The caller still
    // receives the original rejection; this does not hide database errors.
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  const queryRaw = transaction.queryRaw.bind(transaction);
  const executeRaw = transaction.executeRaw.bind(transaction);
  const commit = transaction.commit.bind(transaction);
  const rollback = transaction.rollback.bind(transaction);
  transaction.queryRaw = (query) => enqueue(() => queryRaw(query));
  transaction.executeRaw = (query) => enqueue(() => executeRaw(query));
  // Never release the dedicated connection while a queued operation is pending.
  transaction.commit = () => enqueue(commit);
  transaction.rollback = () => enqueue(rollback);
  // Savepoint methods call executeRaw on this same transaction and therefore
  // share its queue. Pool queries outside transactions remain parallel.
  return transaction;
}

export class SerializedPrismaPg extends PrismaPg {
  async connect() {
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel) =>
      serializeTransaction(await startTransaction(isolationLevel));
    return adapter;
  }
}
