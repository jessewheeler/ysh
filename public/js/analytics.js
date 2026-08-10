// Google Analytics 4 bootstrap.
//
// This lives in a served file rather than an inline <script> in layout.pug because
// helmet's CSP has no 'unsafe-inline' in script-src — an inline bootstrap is silently
// refused by the browser with nothing in the console to explain the missing data.
// public/ is served from 'self', which the CSP allows. Same reasoning as the
// data-attribute hooks in admin.js. See CLAUDE.md.
//
// The measurement ID arrives as data-ga-id on <body>, set from res.locals.gaMeasurementId
// (empty string when GA_MEASUREMENT_ID is unset, in which case this file does nothing).
(function () {
  var gaId = document.body && document.body.dataset.gaId;
  if (!gaId) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag('js', new Date());
  // Google Signals and ad personalization make GA4 beacon to www.google.com/g/collect for
  // remarketing audiences. YSH uses GA4 for reporting only (the admin campaign dashboard is
  // authoritative for attribution), so we turn them off rather than widen connect-src to
  // www.google.com. Standard reporting hits still go to *.google-analytics.com.
  gtag('config', gaId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  // Injected rather than written as a <script> tag in the template so that the
  // dataLayer shim above is guaranteed to exist first, whatever the load order.
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
  document.head.appendChild(s);
})();
