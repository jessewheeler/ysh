document.querySelector('.nav-toggle').addEventListener('click', function () {
    document.querySelector('.nav-menu').classList.toggle('active');
});

const navbar = document.querySelector('.navbar');
const SCROLL_ADD = 70;
const SCROLL_REMOVE = 50;

function onScroll() {
    const y = window.scrollY;
    if (y > SCROLL_ADD) {
        navbar.classList.add('navbar--scrolled');
    } else if (y < SCROLL_REMOVE) {
        navbar.classList.remove('navbar--scrolled');
    }
}

window.addEventListener('scroll', onScroll, {passive: true});
onScroll();
