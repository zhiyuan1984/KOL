import { useLayoutEffect, type RefObject } from "react";

/** Place the browser's actual scrollbar inside a pane gutter, without taking
 * width from its content. Overlay scrollbars naturally report zero. */
export function useInsetScrollbar(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = `${el.offsetWidth - el.clientWidth}px`;
      if (el.style.getPropertyValue("--inset-scrollbar-width") !== width) {
        el.style.setProperty("--inset-scrollbar-width", width);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
