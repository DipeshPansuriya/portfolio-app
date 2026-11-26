/**
 * Cap on password hashing for requests. scrypt runs on the same thread pool that
 * reads the static files, and shares the container's CPU, so only one request
 * hashes at a time and only a few may wait. State is per process.
 *
 * Two waiting lanes, so strangers cannot shut the owner out: `trusted` is for a
 * browser that has signed in before and for a signed-in password change, and it
 * goes first. A browser without that proof competes in the anonymous lane.
 */
export function createHashGate({ anonymous = 8, trusted = 4 } = {}) {
  const lanes = { trusted: [], anonymous: [] }
  const limits = { trusted, anonymous }
  let running = null

  function next() {
    if (running) return
    running = lanes.trusted.shift() ?? lanes.anonymous.shift() ?? null
    running?.start()
  }

  /**
   * `null` when the lane is full. Otherwise a ticket: await `turn`, hash, then
   * call `done()`, which also gives up a place that is still waiting.
   */
  return function enter(isTrusted) {
    const name = isTrusted ? 'trusted' : 'anonymous'
    const lane = lanes[name]
    if (running && lane.length >= limits[name]) return null
    const ticket = {}
    ticket.turn = new Promise((start) => {
      ticket.start = start
    })
    ticket.done = () => {
      if (running === ticket) running = null
      else {
        const at = lane.indexOf(ticket)
        if (at >= 0) lane.splice(at, 1)
      }
      next()
    }
    lane.push(ticket)
    next()
    return ticket
  }
}
