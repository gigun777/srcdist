const modalRoot = document.getElementById('modalRoot');
const openBtn = document.getElementById('openBtn');
const closeBtn = document.getElementById('closeBtn');
const cancelBtn = document.getElementById('cancelBtn');

function openModal() {
  modalRoot.hidden = false;
  // focus close button for accessibility
  closeBtn.focus();
}

function closeModal() {
  modalRoot.hidden = true;
  openBtn.focus();
}

openBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

// click outside to close
modalRoot.addEventListener('click', (e) => {
  if (e.target === modalRoot) closeModal();
});

// escape to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalRoot.hidden) closeModal();
});
