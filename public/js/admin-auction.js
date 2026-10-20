/*
 * Admin auction dashboard (issue #119): countdown, and live updates from the admin event stream
 * — KPI cards, the recent-bids feed and the item leaderboard update as bids arrive. Without
 * JavaScript the Refresh link reloads the page.
 *
 * No inline handlers: helmet sends script-src-attr 'none' (see CLAUDE.md).
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-admin-auction-stream]');
  if (!root) return;

  var endsAt = Date.parse(root.getAttribute('data-ends-at'));
  var offset = 0;
  var countdown = root.querySelector('[data-countdown]');
  var indicator = root.querySelector('[data-live-status]');
  var feed = root.querySelector('[data-recent-bids]');
  var leaderboard = root.querySelector('#item-leaderboard tbody');

  function dollars(cents) {
    return '$' + (Number(cents) / 100).toLocaleString('en-US');
  }

  function tick() {
    if (!countdown || root.getAttribute('data-phase') !== 'live') return;
    var s = Math.max(0, Math.floor((endsAt - (Date.now() + offset)) / 1000));
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var text = d ? d + 'd ' + h + 'h' : (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's';
    countdown.textContent = s === 0 ? ' · closed' : ' · ' + text + ' left';
  }
  tick();
  setInterval(tick, 1000);

  function flash(el) {
    if (!el) return;
    el.classList.remove('auction-flash');
    void el.offsetWidth;
    el.classList.add('auction-flash');
  }

  function setStat(name, value) {
    var el = root.querySelector('[data-stat="' + name + '"]');
    if (el && el.textContent !== String(value)) {
      el.textContent = value;
      flash(el.closest('.stat-card'));
    }
  }

  function applyTotals(t) {
    if (!t) return;
    setStat('committed', dollars(t.committedCents));
    setStat('bids', t.bids);
    setStat('bidders', t.bidders);
    setStat('items-with-bids', t.itemsWithBids);
    setStat('avg-bids', t.avgBidsPerItem);
    setStat('outbid-emails', t.outbidEmails);
  }

  function applyItem(item) {
    if (!item || !leaderboard) return;
    var row = leaderboard.querySelector('tr[data-item-id="' + item.item_id + '"]');
    if (!row) return;
    var set = function (field, text) {
      var cell = row.querySelector('[data-field="' + field + '"]');
      if (cell) cell.textContent = text;
    };
    set('current', item.current_bid_cents != null ? dollars(item.current_bid_cents) : '—');
    set('over', item.over_starting_pct != null ? item.over_starting_pct + '%' : '—');
    set('bid-count', item.bid_count);
    set('high-bidder', item.high_bidder_name ? '#' + item.high_paddle + ' ' + item.high_bidder_name : 'No bids');
    row.classList.toggle('auction-no-bids', item.current_bid_cents == null);
    flash(row);
  }

  function applyTopBidders(list) {
    var body = root.querySelector('[data-top-bidders]');
    if (!body || !list) return;
    body.textContent = '';
    list.forEach(function (t) {
      var tr = document.createElement('tr');
      ['#' + t.paddle + ' ' + t.name, String(t.items), dollars(t.cents)].forEach(function (text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    body.closest('table').hidden = list.length === 0;
    var empty = root.querySelector('[data-top-bidders-empty]');
    if (empty) empty.hidden = list.length > 0;
  }

  function prependBid(bid) {
    if (!feed) return;
    var empty = root.querySelector('[data-recent-bids-empty]');
    if (empty) empty.remove();
    var base = window.location.pathname.replace(/\/dashboard$/, '');
    var tr = document.createElement('tr');
    var cells = [bid.placed_at_label, null, dollars(bid.amount_cents), '#' + bid.paddle_number + ' ' + bid.bidder_name];
    cells.forEach(function (text, i) {
      var td = document.createElement('td');
      if (i === 1) {
        var a = document.createElement('a');
        a.href = base + '/items/' + bid.item_id + '/bids';
        a.title = 'Manage bids';
        a.textContent = bid.item_title;
        td.appendChild(a);
      } else {
        td.textContent = text;
        if (i !== 3) td.className = 'nowrap';
      }
      tr.appendChild(td);
    });
    feed.insertBefore(tr, feed.firstChild);
    while (feed.children.length > 25) feed.removeChild(feed.lastChild);
    flash(tr);
  }

  if (!window.EventSource) return;
  var source;

  function setLive(ok) {
    if (!indicator) return;
    indicator.hidden = false;
    indicator.textContent = ok ? 'Connected' : 'Reconnecting…';
    indicator.classList.toggle('is-reconnecting', !ok);
  }

  function connect() {
    source = new window.EventSource(root.getAttribute('data-admin-auction-stream'));
    source.onopen = function () { setLive(true); };
    source.onerror = function () { setLive(false); };
    source.addEventListener('snapshot', function (e) {
      var data = JSON.parse(e.data);
      offset = Date.parse(data.server_now) - Date.now();
      applyTotals(data.totals);
    });
    source.addEventListener('admin_bid', function (e) {
      var data = JSON.parse(e.data);
      applyTotals(data.totals);
      applyItem(data.item);
      applyTopBidders(data.topBidders);
      prependBid(data.bid);
    });
    source.addEventListener('admin_refresh', function (e) {
      var data = JSON.parse(e.data);
      applyTotals(data.totals);
      applyItem(data.item);
      applyTopBidders(data.topBidders);
    });
    source.addEventListener('auction', function (e) {
      var data = JSON.parse(e.data);
      endsAt = Date.parse(data.ends_at);
      if (data.phase !== root.getAttribute('data-phase')) window.location.reload();
    });
    source.addEventListener('closed', function () {
      window.location.reload();
    });
  }

  connect();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && source && source.readyState === window.EventSource.CLOSED) connect();
  });
})();
