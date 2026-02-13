const { createTestDb } = require('./db');

let _currentDb = createTestDb();

const proxy = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__resetTestDb') {
      return function () {
        try { _currentDb.close(); } catch (_e) { /* ignore */ }
        _currentDb = createTestDb();
      };
    }
    if (prop === '__getCurrentDb') {
      return function () {
        return _currentDb;
      };
    }
    const val = _currentDb[prop];
    if (typeof val === 'function') {
      return val.bind(_currentDb);
    }
    return val;
  },
});

module.exports = proxy;
