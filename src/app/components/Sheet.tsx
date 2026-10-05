import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../ui';

export function Sheet({ title, onClose, children, className = '', headingAside, bottomSlide = false }: {
  title: string; onClose: () => void; children: ReactNode; className?: string; headingAside?: ReactNode; bottomSlide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef<Animation | null>(null);
  const returning = useRef<Animation | null>(null);
  const drag = useRef<{ id: number; start: number; distance: number; time: number } | null>(null);
  const dragged = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { closing.current?.cancel(); returning.current?.cancel(); dialog?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  const close = () => {
    const dialog = ref.current;
    if (closing.current) return;
    if (!dialog?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    const initial = { opacity: getComputedStyle(dialog).opacity, transform: getComputedStyle(dialog).transform };
    dialog.getAnimations().forEach((animation) => animation.cancel());
    dialog.style.transform = '';
    dialog.dataset.closing = 'true';
    const animation = dialog.animate([initial, { opacity: bottomSlide ? 1 : 0, transform: bottomSlide ? 'translate3d(0,100%,0)' : 'translate3d(0,12px,0)' }], { duration: bottomSlide ? 180 : 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    closing.current = animation;
    void animation.finished.then(() => { if (dialog.isConnected) onClose(); }).catch(() => {});
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = drag.current;
    const dialog = ref.current;
    if (!gesture || gesture.id !== event.pointerId || !dialog) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && (gesture.distance > 72 || (gesture.distance > 24 && gesture.distance / Math.max(1, performance.now() - gesture.time) > .5))) { close(); return; }
    const transform = dialog.style.transform;
    dialog.style.transform = '';
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) returning.current = dialog.animate([{ transform }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' });
  };
  return createPortal(
    <dialog ref={ref} aria-label={title} className={`app-sheet ${className}`} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => {
      if (e.target === e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) close();
      }
    }}>
      {bottomSlide ? <div className="sheet-grip" onPointerDown={(event) => {
        if (event.button !== 0 || closing.current) return;
        const dialog = ref.current;
        if (!dialog) return;
        const transform = getComputedStyle(dialog).transform;
        const distance = Math.max(0, new DOMMatrixReadOnly(transform === 'none' ? undefined : transform).m42);
        dialog.getAnimations().forEach((animation) => animation.cancel());
        dialog.style.transform = `translate3d(0,${distance}px,0)`;
        dragged.current = false;
        drag.current = { id: event.pointerId, start: event.clientY - distance, distance, time: performance.now() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId || !ref.current) return;
        gesture.distance = Math.max(0, event.clientY - gesture.start);
        if (gesture.distance > 6) dragged.current = true;
        ref.current.style.transform = `translate3d(0,${gesture.distance}px,0)`;
      }} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)} onClick={() => {
        if (dragged.current) { dragged.current = false; return; }
        close();
      }}><button type="button" className="sheet-handle" aria-label="Zamknij" title="Zamknij" /></div> : <div className="sheet-handle" aria-hidden="true" />}
      <header className="sheet-heading"><h2>{title}</h2>{headingAside}{!bottomSlide && <button type="button" className="icon-btn" onClick={close} aria-label="Zamknij" title="Zamknij"><Ic n="x" /></button>}</header>
      <div className="sheet-content">{children}</div>
    </dialog>, document.body,
  );
}
