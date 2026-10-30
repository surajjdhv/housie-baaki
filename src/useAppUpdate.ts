import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

async function finishInstalling(worker: ServiceWorker) {
  if (worker.state === "installed" || worker.state === "activated") return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "The download is taking longer than expected. Try again shortly.",
        ),
      );
    }, 20_000);
    function cleanup() {
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
    }
    function changed() {
      if (worker.state === "installed" || worker.state === "activated") {
        cleanup();
        resolve();
      } else if (worker.state === "redundant") {
        cleanup();
        reject(
          new Error(
            "Could not download the update. Your saved games are unchanged.",
          ),
        );
      }
    }
    worker.addEventListener("statechange", changed);
    changed();
  });
}

export function useAppUpdate(blocked: boolean) {
  const loadedController = useRef(navigator.serviceWorker?.controller ?? null);
  const [pendingReload, setPendingReload] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const blockReload = useRef(blocked);
  blockReload.current = blocked;
  const running = useRef(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, value) {
      registration.current = value;
    },
    // Manual activation below handles reloads, including updates during the first visit.
    onNeedReload() {
      setPendingReload(true);
    },
  });
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const changed = () => {
      if (!loadedController.current)
        loadedController.current = navigator.serviceWorker.controller;
      else if (loadedController.current !== navigator.serviceWorker.controller)
        setPendingReload(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
  }, []);
  function deferredMessage() {
    setMessage(
      "An update is ready. Finish or cancel the current round, then tap Update app. Your games stay saved.",
    );
  }
  async function activateUpdate() {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Could not activate the update."));
      }, 10_000);
      function cleanup() {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
      }
      function changed() {
        cleanup();
        if (blockReload.current) deferredMessage();
        else window.location.reload();
        resolve();
      }
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      void updateServiceWorker(true).catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }
  async function updateApp() {
    if (running.current) return;
    setMessage("");
    if (!("serviceWorker" in navigator)) {
      setMessage(
        "This browser does not support app updates. Open the app in a supported browser.",
      );
      return;
    }
    running.current = true;
    setChecking(true);
    try {
      const current =
        registration.current ??
        (await navigator.serviceWorker.getRegistration(
          import.meta.env.BASE_URL,
        ));
      if (!current) {
        setMessage(
          "The app is getting ready for offline use. Try again shortly.",
        );
        return;
      }
      registration.current = current;
      if (!current.waiting && !pendingReload) {
        if (!navigator.onLine) {
          setMessage(
            "You’re offline. Connect to the internet to check for an update.",
          );
          return;
        }
        await current.update();
        if (current.installing) await finishInstalling(current.installing);
      }
      if (current.waiting || pendingReload) {
        if (blockReload.current) {
          deferredMessage();
          return;
        }
        setMessage("Updating the app. Your games stay saved…");
        if (current.waiting) await activateUpdate();
        else window.location.reload();
      } else {
        setMessage("You’re using the latest app.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.startsWith("The download")
          ? error.message
          : "Could not check for updates. Check your connection and try again. Your games stay saved.",
      );
    } finally {
      running.current = false;
      setChecking(false);
    }
  }
  return {
    needRefresh: needRefresh || pendingReload,
    checking,
    message,
    updateApp,
  };
}
export type AppUpdate = ReturnType<typeof useAppUpdate>;
