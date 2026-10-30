import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Gathering } from "./domain";

export type Act = (
  task: () => Promise<unknown>,
  success?: string,
) => Promise<boolean>;
export type Change = (
  change: (g: Gathering) => void | Promise<void>,
  kind: string,
  message: string | ((g: Gathering) => string),
  roundId?: string,
) => Promise<boolean>;

export function Modal({
  title,
  description,
  children,
  close,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-top">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
