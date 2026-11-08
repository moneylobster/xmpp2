/**
 * Resize a textarea to fit its content, capped by its CSS `max-height`.
 *
 * The inline height must include the border: `scrollHeight` covers the padding
 * and content, but not the border, and the textarea is `box-sizing: border-box`.
 * `overflow-y` is toggled so a capped textarea scrolls instead of clipping.
 */
export function autoResizeTextarea(el: HTMLTextAreaElement | null | undefined): void {
  if (!el) return;

  // Collapse first so the scroll height reflects the current content rather than
  // the previous inline height.
  el.style.height = 'auto';

  const border = Math.max(0, el.offsetHeight - el.clientHeight);
  const maxHeight = Number.parseFloat(getComputedStyle(el).maxHeight);
  const contentHeight = el.scrollHeight + border;
  const capped = Number.isFinite(maxHeight) ? Math.min(contentHeight, maxHeight) : contentHeight;

  el.style.height = `${capped}px`;
  el.style.overflowY = contentHeight > capped ? 'auto' : 'hidden';
}
