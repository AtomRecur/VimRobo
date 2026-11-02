import { useEffect, useRef, useState } from "react";
export function useReducedMotion() {
  const [reduced, set] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => set(q.matches);
    q.addEventListener("change", listener);
    return () => q.removeEventListener("change", listener);
  }, []);
  return reduced;
}
export function useVisibility<T extends HTMLElement>(margin = "160px") {
  const ref = useRef<T>(null);
  const [visible, set] = useState(false);
  const [everVisible, setEver] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        set(entry.isIntersecting);
        if (entry.isIntersecting) setEver(true);
      },
      { rootMargin: margin },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [margin]);
  return { ref, visible, everVisible };
}
