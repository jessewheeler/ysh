document.querySelector('.nav-toggle').addEventListener('click', function () {
    document.querySelector('.nav-menu').classList.toggle('active');
});

const navbar = document.querySelector('.navbar');
const SCROLL_THRESHOLD = 60;

function onScroll() {
    navbar.classList.toggle('navbar--scrolled', window.scrollY > SCROLL_THRESHOLD);
}

window.addEventListener('scroll', onScroll, {passive: true});
onScroll();
