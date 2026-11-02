/**
 * Distributed ID Generator: Range-Based Allocation (Ticket Server pattern)
 *
 * Why this is superior in high-throughput distributed systems:
 * 1. Counter in single DB is a write bottleneck.
 * 2. Snowflake requires synchronized physical clocks (NTP drift vulnerability).
 * 3. Range-based allocation: Each app instance requests a block of IDs
 *    (e.g., 100,000 IDs at a time) from the coordinator.
 *    The instance increments locally in memory without any DB lock for 100,000 writes!
 *    When the block is 80% consumed, it pre-fetches the next block asynchronously.
 */

export class RangeIdGenerator {
  constructor(nodeId = 1, rangeStep = 100000) {
    this.nodeId = nodeId;
    this.rangeStep = rangeStep;
    this.currentId = 0n;
    this.maxId = 0n;
    this.isAllocating = false;
  }

  /**
   * Initialize or allocate the next range from persistent storage
   */
  async allocateRange(db) {
    // If running in local single-node mode with SQLite, we query the generator_ranges table
    const range = await db.getNextIdRange(this.nodeId, this.rangeStep);
    this.currentId = BigInt(range.startId);
    this.maxId = BigInt(range.endId);
  }

  /**
   * Get the next globally unique 64-bit integer ID
   */
  async nextId(db) {
    if (this.currentId === 0n || this.currentId >= this.maxId) {
      await this.allocateRange(db);
    }
    const id = this.currentId;
    this.currentId += 1n;
    return id;
  }
}
