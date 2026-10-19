const mongoose = require('mongoose')

/**
 * ==============================================================================
 * ATOMIC SEQUENCE COUNTER
 * ==============================================================================
 *
 * Incident reference numbers were generated from countDocuments() + 1, which is
 * unsafe in two ways:
 *
 *   1. Concurrency. Two reports arriving together both read the same count and
 *      derive the same number. The unique index then rejects one of them with a
 *      500 — an emergency report dropped because another arrived at the same
 *      moment.
 *
 *   2. Deletion. Removing any incident lowers the count, so the next number
 *      collides with one already issued, and every subsequent create fails.
 *
 * findOneAndUpdate with $inc and upsert is atomic at the document level, so
 * each caller gets a distinct value regardless of concurrency, and the sequence
 * never moves backwards when rows are deleted.
 * ==============================================================================
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'incident-20261019'
  seq: { type: Number, default: 0 },
})

/**
 * Reserve the next value in a named sequence.
 * @param {string} key
 * @returns {Promise<number>}
 */
counterSchema.statics.next = async function (key) {
  const doc = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  return doc.seq
}

module.exports = mongoose.model('Counter', counterSchema)
