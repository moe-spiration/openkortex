import { useEffect } from "react";
import { Check, TriangleAlert } from "lucide-react";

export interface ToastMessage {
  text: string;
  tone?: "success" | "error";
}

/** Bottom-centre confirmation, auto-dismissed after 2.4s like the prototype. */
export function Toast({ message, onDone, ms = 2400 }: { message: ToastMessage | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [message, onDone, ms]);
  if (!message) return null;
  const tone = message.tone ?? "success";
  const Icon = tone === "success" ? Check : TriangleAlert;
  return (
    <div className={`kx-toast kx-toast--${tone} kx-slide-up`} role="status">
      <Icon className="size-4 shrink-0 [stroke-width:1.6]" aria-hidden />
      <span>{message.text}</span>
    </div>
  );
}
