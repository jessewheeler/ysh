const {AsyncLocalStorage} = require('node:async_hooks');

const als = new AsyncLocalStorage();

/**
 * Returns the current actor (who is making the DB change).
 * Returns { id: null, email: null } outside of a request context.
 */
function getActor() {
    return als.getStore() || {id: null, email: null};
}

/**
 * Runs fn() inside an AsyncLocalStorage context for the given actor.
 * Used by Express middleware to propagate actor through the request lifecycle.
 */
function runWithActor(actor, fn) {
    return als.run(actor, fn);
}

module.exports = {getActor, runWithActor};
