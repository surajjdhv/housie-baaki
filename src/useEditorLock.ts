import { useEffect, useState } from "react";

export function useEditorLock(id: string) {
  const [state, setState] = useState<
    "loading" | "held" | "readonly" | "unsupported"
  >("loading");
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    setState("loading");
    if (!navigator.locks) {
      setState("unsupported");
      return;
    }
    const controller = new AbortController();
    void navigator.locks
      .request(
        "housie-storage",
        { mode: "shared", signal: controller.signal },
        async () => {
          if (disposed) return;
          await navigator.locks.request(
            `housie-editor:${id}`,
            { ifAvailable: true },
            async (lock) => {
              if (disposed) return;
              if (!lock) {
                setState("readonly");
                return;
              }
              setState("held");
              await new Promise<void>((resolve) => {
                release = resolve;
                if (disposed) resolve();
              });
            },
          );
        },
      )
      .catch((error) => {
        if (error.name !== "AbortError" && !disposed) setState("unsupported");
      });
    return () => {
      disposed = true;
      controller.abort();
      release?.();
    };
  }, [id]);
  return state;
}
