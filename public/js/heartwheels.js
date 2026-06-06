(function () {
  const modal = document.getElementById('address-modal');
  if (!modal) return;

  function openModal() {
    modal.classList.add('hw-modal--open');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.hw-modal-close').focus();
  }

  function closeModal() {
    modal.classList.remove('hw-modal--open');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-modal="address-modal"]').forEach(function (btn) {
    btn.addEventListener('click', openModal);
  });

  modal.querySelector('.hw-modal-close').addEventListener('click', closeModal);
  modal.querySelector('.hw-modal-backdrop').addEventListener('click', closeModal);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('hw-modal--open')) closeModal();
  });

  const shareBtn = document.getElementById('hw-share-btn');
  if (shareBtn && navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', function () {
      navigator.share({
        title: 'Heartwheels – Yellowstone Sea Hawkers',
        text: 'Taku Hanson started Heartwheels to bring Hot Wheels cars to kids undergoing cancer treatment. Help keep his legacy going.',
        url: window.location.href,
      });
    });
  }
})();
