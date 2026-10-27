/*
 * Silent auction pages (issue #119): photo gallery, countdown, and the bid form posted with
 * fetch() so the page doesn't reload. Everything here is an enhancement — without JavaScript
 * the bid form posts normally and the server redirects back with a confirmation.
 *
 * No inline handlers: helmet sends script-src-attr 'none' (see CLAUDE.md).
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-auction-id]');
  if (!root) return;

  var serverOffsetMs = 0;
  var myPaddle = root.getAttribute('data-my-paddle') || '';
  // Each item's high paddle as last seen, so polling can tell when this bidder lost the lead.
  var highByItem = {};

  function dollars(cents) {
    return '$' + (Number(cents) / 100).toLocaleString('en-US');
  }

  // ── Gallery ────────────────────────────────────────────────────────────────
  var mainImg = document.querySelector('[data-gallery-main]');
  document.querySelectorAll('[data-gallery-thumb]').forEach(function (thumb) {
    thumb.addEventListener('click', function () {
      if (!mainImg) return;
      mainImg.src = thumb.getAttribute('data-gallery-thumb');
      document.querySelectorAll('[data-gallery-thumb]').forEach(function (t) {
        t.removeAttribute('aria-current');
      });
      thumb.setAttribute('aria-current', 'true');
    });
  });

  // ── Countdown ──────────────────────────────────────────────────────────────
  var endsAt = Date.parse(root.getAttribute('data-ends-at'));
  var countdowns = document.querySelectorAll('[data-countdown]');

  function formatRemaining(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h left';
    if (h > 0) return h + 'h ' + m + 'm left';
    return m + ':' + String(sec).padStart(2, '0') + ' left';
  }

  function markClosed() {
    if (root.getAttribute('data-phase') === 'closed') return;
    root.setAttribute('data-phase', 'closed');
    root.classList.add('auction-closed');
    document.querySelectorAll('[data-bid-form] button[type="submit"]').forEach(function (b) {
      b.disabled = true;
    });
    countdowns.forEach(function (el) { el.textContent = 'Bidding has closed'; });
  }

  var startsAt = Date.parse(root.getAttribute('data-starts-at'));
  var reloadedForStart = false;

  function tick() {
    // An upcoming auction reloads once when bidding opens, so the bid form appears.
    if (root.getAttribute('data-phase') === 'upcoming' && startsAt && !reloadedForStart
        && Date.now() + serverOffsetMs >= startsAt + 1000) {
      reloadedForStart = true;
      window.location.reload();
      return;
    }
    if (root.getAttribute('data-phase') !== 'live' || !endsAt) return;
    var remaining = endsAt - (Date.now() + serverOffsetMs);
    if (remaining <= 0) {
      markClosed();
      return;
    }
    countdowns.forEach(function (el) { el.textContent = ' · ' + formatRemaining(remaining); });
  }
  tick();
  setInterval(tick, 1000);

  // ── Item state rendering (shared with live updates) ────────────────────────
  function setField(scope, name, text) {
    scope.querySelectorAll('[data-field="' + name + '"]').forEach(function (el) {
      el.textContent = text;
    });
  }

  function flash(el) {
    el.classList.remove('auction-flash');
    // Restart the animation.
    void el.offsetWidth;
    el.classList.add('auction-flash');
  }

  function applyState(state) {
    highByItem[state.item_id] = state.high_paddle == null ? '' : String(state.high_paddle);
    document.querySelectorAll('[data-item-id="' + state.item_id + '"]').forEach(function (scope) {
      var shown = state.current_bid_cents != null ? state.current_bid_cents : state.starting_bid_cents;
      var before = (scope.querySelector('[data-field="current"]') || {}).textContent;
      setField(scope, 'current', dollars(shown));
      setField(scope, 'current-label', state.current_bid_cents != null ? 'Current bid' : 'Starting bid');
      setField(scope, 'bid-count', String(state.bid_count));
      setField(scope, 'bid-noun', state.bid_count === 1 ? ' bid' : ' bids');
      setField(scope, 'min-next', (state.min_next_cents / 100).toLocaleString('en-US'));
      setField(scope, 'high-paddle', state.high_paddle ? ' · High bidder #' + state.high_paddle : '');
      var amount = scope.querySelector('[data-field="amount"]');
      if (amount) {
        amount.min = state.min_next_cents / 100;
        amount.placeholder = state.min_next_cents / 100;
      }
      var mine = myPaddle && String(state.high_paddle) === String(myPaddle);
      setField(scope, 'mine', mine ? ' · You\'re winning' : '');
      // A "your bid is the high bid" confirmation is stale once someone else leads.
      if (!mine) {
        scope.querySelectorAll('.auction-confirmation').forEach(function (el) { el.hidden = true; });
      }
      // Back in the lead (an admin removed the bid that beat them): the outbid banner is stale.
      if (mine && banner && !banner.hidden && banner.getAttribute('data-item') === String(state.item_id)) {
        banner.hidden = true;
      }
      var status = scope.querySelector('[data-field="status"]');
      if (status) {
        status.classList.toggle('is-outbid', false);
        status.textContent = mine ? 'You\'re the high bidder.' : '';
      }
      if (before !== dollars(shown)) flash(scope.querySelector('[data-field="current"]') || scope);
    });
  }

  // ── Bid form ───────────────────────────────────────────────────────────────
  function fetchToken() {
    return fetch('/auctions/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.token; });
  }

  document.querySelectorAll('[data-bid-form]').forEach(function (form) {
    var errorEl = form.querySelector('[data-bid-error]');
    var button = form.querySelector('button[type="submit"]');
    var confirmation = document.querySelector('[data-bid-confirmation]');

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = !message;
    }

    form.addEventListener('submit', function (e) {
      if (!window.fetch || !window.URLSearchParams) return; // let the browser post it
      e.preventDefault();
      showError('');

      var amountInput = form.querySelector('[data-field="amount"]');
      var amount = Number(amountInput && amountInput.value);
      var min = Number(amountInput && amountInput.min);
      if (min && amount >= min * 2 && !window.confirm('Bid ' + dollars(amount * 100) + '? That is at least twice the minimum bid.')) {
        return;
      }

      var label = button.textContent;
      button.disabled = true;
      button.textContent = 'Bidding…';

      fetchToken()
        .then(function (token) {
          var body = new URLSearchParams(new FormData(form));
          body.set('_csrf', token);
          return fetch(form.action, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-csrf-token': token,
            },
            body: body.toString(),
          });
        })
        .then(function (res) {
          return res.json().then(function (data) { return { status: res.status, data: data }; });
        })
        .then(function (r) {
          var data = r.data;
          if (data.ok) {
            myPaddle = String(data.paddle);
            root.setAttribute('data-my-paddle', myPaddle);
            var ack = form.querySelector('[data-field="ack"]');
            if (ack) {
              ack.closest('label').remove();
            }
            if (amountInput) amountInput.value = '';
            applyState(data.state);
            if (confirmation) {
              confirmation.innerHTML = '';
              var p = document.createElement('p');
              var strong = document.createElement('strong');
              strong.textContent = data.message;
              p.appendChild(strong);
              p.appendChild(document.createTextNode(' You are Bidder #' + data.paddle + '.'));
              var notice = document.createElement('aside');
              notice.className = 'auction-shipping auction-shipping--compact';
              notice.setAttribute('role', 'note');
              var label2 = document.createElement('strong');
              label2.textContent = 'Shipping & handling:';
              notice.appendChild(label2);
              notice.appendChild(document.createTextNode(' ' + data.shipping_notice));
              confirmation.appendChild(p);
              confirmation.appendChild(notice);
              confirmation.hidden = false;
            }
            return;
          }
          if (data.code === 'login_required' && data.loginUrl) {
            window.location.href = data.loginUrl;
            return;
          }
          if (data.min_next_cents && amountInput) {
            amountInput.min = data.min_next_cents / 100;
            amountInput.placeholder = data.min_next_cents / 100;
            setField(document, 'min-next', (data.min_next_cents / 100).toLocaleString('en-US'));
          }
          if (data.code === 'closed') markClosed();
          showError(data.message || 'Your bid could not be placed.');
        })
        .catch(function () {
          // Network trouble or a non-JSON response: fall back to a normal post.
          form.submit();
        })
        .then(function () {
          button.disabled = root.getAttribute('data-phase') === 'closed';
          button.textContent = label;
        });
    });
  });

  // ── Live updates (Server-Sent Events) ──────────────────────────────────────
  var streamUrl = root.getAttribute('data-auction-stream');
  var banner = document.querySelector('[data-live-status]');
  var historyList = document.querySelector('[data-bid-history]');
  var source = null;

  function showBanner(text, href, itemId) {
    if (!banner) return;
    banner.setAttribute('data-item', itemId == null ? '' : String(itemId));
    banner.textContent = '';
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      banner.appendChild(a);
    } else {
      banner.textContent = text;
    }
    banner.setAttribute('role', 'alert');
    banner.hidden = false;
  }

  function addHistoryRow(data) {
    if (!historyList || data.removed || !data.high_paddle) return;
    var scope = document.querySelector('.auction-item[data-item-id="' + data.item_id + '"]');
    if (!scope) return;
    var empty = document.querySelector('[data-bid-history-empty]');
    if (empty) empty.remove();
    var li = document.createElement('li');
    var who = document.createElement('span');
    who.textContent = 'Bidder #' + data.high_paddle;
    var amount = document.createElement('strong');
    amount.textContent = dollars(data.current_bid_cents);
    var when = document.createElement('time');
    when.textContent = 'just now';
    li.appendChild(who);
    li.appendChild(amount);
    li.appendChild(when);
    historyList.insertBefore(li, historyList.firstChild);
    flash(li);
  }

  // ── Polling fallback ──────────────────────────────────────────────────────
  // Some networks (a work PC behind a proxy, at the 2026-10-26 test) hold the event stream
  // open without passing events through. The server sends a named ping every 20s, so silence
  // means the stream is blocked: poll /state instead, and keep trying the stream.
  var stateUrl = streamUrl ? streamUrl.replace(/\/stream$/, '/state') : null;
  var POLL_MS = 10000;
  var FIRST_EVENT_MS = 10000;
  var SILENCE_MS = 60000;
  var connectedAt = 0;
  var streamHeardAt = 0;
  var pollTimer = null;
  var forcePolling = /[?&]live=poll(&|$)/.test(window.location.search);
  // Stream attempts that never delivered anything. After a few, stop reopening it and just
  // poll: behind a proxy that never closes them, each attempt could linger on the server.
  var MAX_SILENT_STREAMS = 3;
  var silentStreams = 0;
  var lastPolled = {};

  // Start from the high bidders the server rendered, so the first poll can spot an outbid.
  document.querySelectorAll('[data-item-id] [data-field="high-paddle"]').forEach(function (el) {
    var scope = el.closest('[data-item-id]');
    var m = /#(\d+)/.exec(el.textContent || '');
    highByItem[scope.getAttribute('data-item-id')] = m ? m[1] : '';
  });

  function withdrawItem(itemId) {
    document.querySelectorAll('.auction-card[data-item-id="' + itemId + '"]').forEach(function (el) { el.remove(); });
    if (document.querySelector('.auction-item[data-item-id="' + itemId + '"]')) {
      showBanner('This item has been withdrawn from the auction.');
      document.querySelectorAll('[data-bid-form], .auction-mobile-bar').forEach(function (f) { f.remove(); });
    }
  }

  function itemTitle(itemId) {
    var el = document.querySelector('[data-item-id="' + itemId + '"][data-item-title]');
    return el ? el.getAttribute('data-item-title') : 'an item';
  }

  // The stream tells a bidder they were outbid; polling has to work it out from the high paddle.
  function applyPolledState(state) {
    // Unchanged since the last poll: leave the page alone, so an "outbid" status stays put.
    var key = JSON.stringify(state);
    if (lastPolled[state.item_id] === key) return;
    lastPolled[state.item_id] = key;
    var before = highByItem[state.item_id];
    var now = state.high_paddle == null ? '' : String(state.high_paddle);
    applyState(state);
    if (myPaddle && before === String(myPaddle) && now && now !== String(myPaddle)) {
      showBanner('You\'ve been outbid on ' + itemTitle(state.item_id) + ' \u2014 it\'s now '
        + dollars(state.current_bid_cents) + '. Bid ' + dollars(state.min_next_cents) + ' or more to retake the lead.',
        '/auctions/' + root.getAttribute('data-auction-id') + '/items/' + state.item_id, state.item_id);
      document.querySelectorAll('[data-item-id="' + state.item_id + '"] [data-field="status"]').forEach(function (el) {
        el.textContent = 'You\'ve been outbid.';
        el.classList.add('is-outbid');
      });
    }
    highByItem[state.item_id] = now;
  }

  function poll() {
    if (!stateUrl || root.getAttribute('data-phase') === 'closed') return;
    fetch(stateUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        serverOffsetMs = Date.parse(data.server_now) - Date.now();
        if (data.my_paddle) {
          myPaddle = String(data.my_paddle);
          root.setAttribute('data-my-paddle', myPaddle);
        }
        if (data.auction) {
          endsAt = Date.parse(data.auction.ends_at);
          if (data.auction.phase === 'closed') {
            markClosed();
            stopPolling();
          } else if (data.auction.phase !== root.getAttribute('data-phase')) {
            // An admin moved the dates; the stream's 'auction' event reloads the same way.
            window.location.reload();
            return;
          }
        }
        var items = data.items || [];
        items.forEach(applyPolledState);
        // /state leaves withdrawn items out; anything shown here but missing from it is gone.
        var present = {};
        items.forEach(function (it) { present[it.item_id] = true; });
        document.querySelectorAll('.auction-card[data-item-id], .auction-item[data-item-id]').forEach(function (el) {
          var id = el.getAttribute('data-item-id');
          if (!present[id]) withdrawItem(id);
        });
      })
      .catch(function () { /* try again next round */ });
  }

  function startPolling() {
    if (pollTimer || !stateUrl) return;
    root.setAttribute('data-live-mode', 'polling');
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    root.setAttribute('data-live-mode', 'stream');
  }

  function heardStream() {
    streamHeardAt = Date.now();
    silentStreams = 0;
    stopPolling();
  }

  // Every few seconds: is the stream alive? If not, poll, and reopen the stream now and then.
  setInterval(function () {
    if (!streamUrl || !window.EventSource || forcePolling || root.getAttribute('data-phase') === 'closed') return;
    var now = Date.now();
    var silent = streamHeardAt
      ? now - streamHeardAt > SILENCE_MS
      : connectedAt && now - connectedAt > FIRST_EVENT_MS;
    if (!silent) return;
    startPolling();
    if (now - connectedAt <= SILENCE_MS) return;
    if (!streamHeardAt) silentStreams += 1;
    if (silentStreams >= MAX_SILENT_STREAMS) {
      // Give up on the stream for this page; polling carries on.
      if (source) source.close();
      return;
    }
    connect();
  }, 5000);

  function connect() {
    if (!streamUrl) return;
    // ?live=poll forces the fallback, for tests and for anyone the stream never reaches.
    if (!window.EventSource || forcePolling) {
      startPolling();
      return;
    }
    if (source) source.close();
    source = new window.EventSource(streamUrl);
    connectedAt = Date.now();
    streamHeardAt = 0;

    source.addEventListener('ping', heardStream);

    source.addEventListener('snapshot', function (e) {
      heardStream();
      var data = JSON.parse(e.data);
      serverOffsetMs = Date.parse(data.server_now) - Date.now();
      if (data.my_paddle) {
        myPaddle = String(data.my_paddle);
        root.setAttribute('data-my-paddle', myPaddle);
      }
      if (data.auction) {
        endsAt = Date.parse(data.auction.ends_at);
        if (data.auction.phase === 'closed') markClosed();
      }
      (data.items || []).forEach(applyState);
    });

    source.addEventListener('bid', function (e) {
      heardStream();
      var data = JSON.parse(e.data);
      applyState(data);
      addHistoryRow(data);
    });

    source.addEventListener('outbid', function (e) {
      heardStream();
      var data = JSON.parse(e.data);
      showBanner('You\'ve been outbid on ' + data.item_title + ' — it\'s now ' + dollars(data.current_bid_cents)
        + '. Bid ' + dollars(data.min_next_cents) + ' or more to retake the lead.', data.url, data.item_id);
      document.querySelectorAll('[data-item-id="' + data.item_id + '"] [data-field="status"]').forEach(function (el) {
        el.textContent = 'You\'ve been outbid.';
        el.classList.add('is-outbid');
      });
    });

    source.addEventListener('item', function (e) {
      heardStream();
      var data = JSON.parse(e.data);
      if (data.withdrawn) withdrawItem(data.item_id);
    });

    source.addEventListener('auction', function (e) {
      var data = JSON.parse(e.data);
      endsAt = Date.parse(data.ends_at);
      if (data.phase === 'closed') markClosed();
      else if (data.phase !== root.getAttribute('data-phase')) window.location.reload();
    });

    source.addEventListener('closed', function () {
      markClosed();
      source.close();
    });
  }

  connect();

  // Phones suspend background tabs and the browser gives up on the stream; reconnect (and get
  // a fresh snapshot) as soon as the page is visible again.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !source) return;
    if (source.readyState === window.EventSource.CLOSED && root.getAttribute('data-phase') !== 'closed') connect();
  });
})();
