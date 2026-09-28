async function withTransactionRetry(session, fn, { maxAttempts = 5 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      session.startTransaction();
      const result = await fn();
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction().catch(() => {});

      const isTransient = error?.errorLabels?.includes("TransientTransactionError");
      if (isTransient && attempt < maxAttempts) {
        continue; 
      }
      throw error;
    }
  }
}

module.exports = { withTransactionRetry };
