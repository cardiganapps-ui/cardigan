/* ── swipeRevealCoordinator ──
   Tiny module-level pubsub that enforces "only one row can be open at
   a time". When a row opens, it calls `claim(id, closeFn)` — if some
   other row was open, its closeFn is invoked. When a row is closed
   (programmatically, by tap-outside, or by swiping it back), it calls
   `release(id)`.

   Separate from swipeCoordinator.js because the contract is different:
   that one is "only one horizontal-swipe handler may track the active
   touch", this one is "only one row may be in a revealed-actions state
   at rest". Both can be active simultaneously (e.g. a row is open,
   then user swipes on a different row — the new row claims swipe and
   the old row gets a programmatic close). */

let _openId = null;
let _closeFn = null;

export function claim(id, closeFn) {
  if (_openId && _openId !== id && _closeFn) {
    const prev = _closeFn;
    _openId = id;
    _closeFn = closeFn;
    prev();
    return;
  }
  _openId = id;
  _closeFn = closeFn;
}

export function release(id) {
  if (_openId === id) {
    _openId = null;
    _closeFn = null;
  }
}

export function closeOpen() {
  if (_closeFn) {
    const fn = _closeFn;
    _openId = null;
    _closeFn = null;
    fn();
  }
}

export function isOpen() {
  return _openId !== null;
}

export function __resetForTests() {
  _openId = null;
  _closeFn = null;
}
