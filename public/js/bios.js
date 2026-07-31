(function () {
  const modal = document.getElementById('bio-modal');
  if (!modal) return;

  const body = document.getElementById('bio-modal-body');
  const closeBtn = modal.querySelector('.bio-modal-close');
  let lastFocused = null;

  function openModal(card) {
    const tpl = document.getElementById('bio-tpl-' + card.dataset.bioIndex);
    if (!tpl) return;
    body.replaceChildren(tpl.content.cloneNode(true));
    lastFocused = card;
    modal.classList.add('bio-modal--open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function closeModal() {
    modal.classList.remove('bio-modal--open');
    document.body.style.overflow = '';
    body.replaceChildren();
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('.bio-card').forEach(function (card) {
    card.addEventListener('click', function () {
      openModal(card);
    });
  });

  closeBtn.addEventListener('click', closeModal);
  modal.querySelector('.bio-modal-backdrop').addEventListener('click', closeModal);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('bio-modal--open')) closeModal();
  });
})();
