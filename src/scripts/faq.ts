// FAQ accordion — one answer open at a time. Questions are real <button>s so
// Enter/Space work natively; the open height is measured from the content.
export function initFaq(): void {
  const questions = Array.from(document.querySelectorAll<HTMLButtonElement>('.faq-question'));
  if (!questions.length) return;
  const answers = Array.from(document.querySelectorAll<HTMLElement>('.faq-answer'));

  const closeAll = () => {
    answers.forEach((a) => {
      a.classList.remove('show');
      a.style.maxHeight = '0px';
    });
    questions.forEach((q) => {
      q.classList.remove('active');
      q.setAttribute('aria-expanded', 'false');
    });
  };

  questions.forEach((question) => {
    const answer = question.nextElementSibling as HTMLElement | null;
    if (!answer) return;
    question.addEventListener('click', () => {
      const wasOpen = answer.classList.contains('show');
      closeAll();
      if (!wasOpen) {
        answer.classList.add('show');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        question.classList.add('active');
        question.setAttribute('aria-expanded', 'true');
      }
    });
  });

  window.addEventListener('resize', () => {
    answers.forEach((a) => {
      if (a.classList.contains('show')) a.style.maxHeight = a.scrollHeight + 'px';
    });
  });
}
