/**
 * Infinite scroll for the Man Crush Monday wall.
 *
 * Fetches pre-rendered HTML fragments from /man-crush-monday/frames and appends them, so
 * frame markup stays in mcm-frames.pug. No inline handlers — CSP blocks those.
 */
(function () {
    const wall = document.getElementById('mcm-wall');
    const sentinel = document.getElementById('mcm-sentinel');
    const end = document.getElementById('mcm-end');
    if (!wall || !sentinel) return;

    const totalPages = parseInt(sentinel.dataset.totalPages, 10) || 1;
    let next = parseInt(sentinel.dataset.nextPage, 10) || 2;
    let loading = false;

    function finish() {
        sentinel.hidden = true;
        if (end) end.hidden = false;
    }

    if (next > totalPages) {
        finish();
        return;
    }

    function loadNext(observer) {
        if (loading) return;
        loading = true;

        fetch('/man-crush-monday/frames?page=' + next)
            .then(function (res) {
                if (!res.ok) throw new Error('frames ' + res.status);
                const more = res.headers.get('X-MCM-Has-More') === 'true';
                return res.text().then(function (html) {
                    wall.insertAdjacentHTML('beforeend', html);
                    next += 1;
                    if (!more || next > totalPages) {
                        observer.disconnect();
                        finish();
                    }
                });
            })
            .catch(function () {
                // Don't leave a spinner promising frames that aren't coming.
                observer.disconnect();
                finish();
            })
            .finally(function () {
                loading = false;
            });
    }

    const observer = new IntersectionObserver(
        function (entries) {
            if (entries.some(function (e) {
                return e.isIntersecting;
            })) loadNext(observer);
        },
        {rootMargin: '600px'}
    );

    observer.observe(sentinel);
})();
