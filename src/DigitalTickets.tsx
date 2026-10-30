import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import QrScanner from "qr-scanner";
import {
  ArrowRight,
  Camera,
  Check,
  Copy,
  Share2,
  ImagePlus,
  QrCode,
  ChevronLeft,
  RotateCw,
  Ticket,
  X,
} from "lucide-react";
import { awardDigitalTicket, db, joinRound, toggleTicketMark } from "./db";
import { type Gathering, type Prize, type Round } from "./domain";
import {
  encodeRoundLink,
  generateTicket,
  parseRoundLink,
  type PlayerTicket,
  type TicketGrid,
} from "./tickets";
import { Modal, type Act } from "./ui";

const go = (path: string) => {
  window.location.hash = path;
};
const appUrl = () =>
  new URL(import.meta.env.BASE_URL, window.location.origin).href;

export function TicketGridView({
  grid,
  marks = [],
  onToggle,
  disabled = false,
}: {
  grid: TicketGrid;
  marks?: number[];
  onToggle?: (number: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="digital-ticket-grid"
      role="group"
      aria-label="Housie ticket"
    >
      {grid.flat().map((number, index) =>
        number === null ? (
          <span className="ticket-blank" key={index} aria-hidden="true" />
        ) : onToggle ? (
          <button
            key={index}
            type="button"
            className={marks.includes(number) ? "marked" : ""}
            aria-label={`${marks.includes(number) ? "Unmark" : "Mark"} number ${number}`}
            aria-pressed={marks.includes(number)}
            disabled={disabled}
            onClick={() => onToggle(number)}
          >
            <span>{number}</span>
          </button>
        ) : (
          <span
            key={index}
            className={`ticket-number${marks.includes(number) ? " marked" : ""}`}
            role="img"
            aria-label={`Number ${number}, ${marks.includes(number) ? "called" : "not called"}`}
          >
            {number}
          </span>
        ),
      )}
    </div>
  );
}

export function RoundQrModal({
  g,
  round,
  close,
}: {
  g: Gathering;
  round: Round;
  close: () => void;
}) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const link = encodeRoundLink(
    {
      version: 1,
      algorithm: 1,
      roundId: round.id,
      key: round.digital!.key,
      name: g.name,
      roundNumber: round.number,
    },
    appUrl(),
  );
  async function shareLink() {
    if (sharing) return;
    setError("");
    setCopied(false);
    setManualCopy(false);
    setSharing(true);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${g.name} · Round ${round.number}`,
            text: "Join my Housie Baaki round",
            url: link,
          });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      } catch {
        setManualCopy(true);
        setError(
          "Sharing and copying are unavailable. Select and copy the round link below.",
        );
      }
    } finally {
      setSharing(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then((QRCode) =>
        QRCode.toDataURL(link, {
          width: 640,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#263b36", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (alive) setImage(value);
      })
      .catch(() => {
        if (alive)
          setError(
            "Could not draw the QR. Players can still paste the round link.",
          );
      });
    return () => {
      alive = false;
    };
  }, [link]);
  return (
    <Modal
      title="A ticket for every phone."
      description={`${g.name} · Round ${round.number}`}
      close={close}
    >
      {image ? (
        <img
          className="round-qr"
          src={image}
          alt={`Round ${round.number} QR code`}
        />
      ) : (
        <p className="form-hint" role="status">
          Preparing your round QR…
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="qr-instructions">
        Players open <strong>My tickets → Scan round QR</strong>. Each phone
        saves one ticket with its own four-digit ID.
      </p>
      <button
        type="button"
        className="button primary full"
        disabled={sharing}
        onClick={() => void shareLink()}
      >
        {copied ? <Copy size={17} /> : <Share2 size={17} />}
        {sharing ? "Sharing…" : "Share link"}
      </button>
      {copied && (
        <p className="share-link-status" role="status">
          Round link copied. Paste it into your preferred app.
        </p>
      )}
      {manualCopy && (
        <label className="round-link-label manual-round-link">
          Round link
          <textarea
            readOnly
            value={link}
            aria-label="Round link"
            rows={3}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      <p className="form-hint">
        No connection between phones is needed. Joining does not update the
        host’s purchase log. Everyone must cache the app before going offline.
      </p>
    </Modal>
  );
}

function Scanner({
  onJoin,
  busy,
}: {
  onJoin: (value: string) => Promise<boolean>;
  busy: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const handling = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  function stop() {
    sequence.current++;
    scanner.current?.destroy();
    scanner.current = null;
    const stream = video.current?.srcObject;
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop());
    setScanning(false);
    setStarting(false);
  }
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      sequence.current++;
      scanner.current?.destroy();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  async function receive(value: string) {
    if (handling.current) return;
    handling.current = true;
    stop();
    setError("");
    try {
      parseRoundLink(value);
      if (!(await onJoin(value)))
        setError("Could not open the ticket. Check the message and try again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      handling.current = false;
    }
  }
  async function start() {
    stop();
    setError("");
    setScanning(true);
    setStarting(true);
    const token = sequence.current;
    const instance = new QrScanner(
      video.current!,
      (result) => {
        void receive(result.data);
      },
      {
        preferredCamera: "environment",
        returnDetailedScanResult: true,
        maxScansPerSecond: 5,
      },
    );
    scanner.current = instance;
    try {
      await instance.start();
      if (token !== sequence.current) {
        instance.destroy();
        return;
      }
      setStarting(false);
    } catch {
      if (token === sequence.current) {
        stop();
        setError(
          "Camera unavailable or permission denied. Choose a QR image or paste the round link below.",
        );
      }
    }
  }
  async function readImage(image?: File) {
    if (!image) return;
    stop();
    setError("");
    if (image.size > 10 * 1024 * 1024) {
      setError("Choose a QR image smaller than 10 MB.");
      return;
    }
    let value: string;
    try {
      value = (
        await QrScanner.scanImage(image, { returnDetailedScanResult: true })
      ).data;
    } catch {
      setError(
        "No readable QR found. Try a clearer image or paste the round link.",
      );
      return;
    }
    await receive(value);
    if (file.current) file.current.value = "";
  }
  return (
    <section className="panel scan-panel">
      <div className="scan-intro">
        <span className="stat-icon mint">
          <QrCode size={25} />
        </span>
        <h2>Your seat at the table.</h2>
        <p>
          Scan the host’s round QR to save your ticket. No sign-in. No sending
          anything back.
        </p>
      </div>
      <div className={`camera-preview ${scanning ? "active" : ""}`}>
        <video ref={video} muted playsInline aria-label="Round QR camera" />
        {starting && <p role="status">Starting camera…</p>}
      </div>
      {scanning ? (
        <button type="button" className="button secondary full" onClick={stop}>
          <X size={17} /> Stop camera
        </button>
      ) : (
        <button
          type="button"
          className="button primary full"
          disabled={busy}
          onClick={() => void start()}
        >
          <Camera size={18} /> Start camera
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={file}
        className="sr-only"
        type="file"
        accept="image/*"
        aria-label="Choose round QR image"
        onChange={(e) => void readImage(e.target.files?.[0])}
      />
      <button
        type="button"
        className="button secondary full"
        disabled={busy || starting}
        onClick={() => file.current?.click()}
      >
        <ImagePlus size={18} /> Choose QR image
      </button>
      <div className="scan-divider">or paste a round link</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void receive(link);
        }}
      >
        <label>
          Round link
          <textarea
            value={link}
            onChange={(e) => setLink(e.target.value)}
            rows={3}
            maxLength={4096}
            placeholder="Paste the host’s Housie Baaki round link"
            required
          />
        </label>
        <button className="button dark full" disabled={busy || !link.trim()}>
          Open my ticket <ArrowRight size={17} />
        </button>
      </form>
      <p className="form-hint">
        Camera images are processed on your phone. This works offline once the
        updated app is cached.
      </p>
    </section>
  );
}

function PlayerTicketView({
  ticket,
  act,
  busy,
}: {
  ticket: PlayerTicket;
  act: Act;
  busy: boolean;
}) {
  const [grid, setGrid] = useState<TicketGrid | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void generateTicket(
      ticket.payload.key,
      ticket.ticketId,
      ticket.payload.algorithm,
    )
      .then((value) => {
        if (alive) setGrid(value);
      })
      .catch(() => {
        if (alive)
          setError(
            "Could not recreate this ticket. Your saved ticket has not been changed.",
          );
      });
    return () => {
      alive = false;
    };
  }, [ticket.payload.key, ticket.ticketId, ticket.payload.algorithm]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") go("/tickets");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <section className="ticket-stage" aria-label="Your digital ticket">
      <header className="ticket-stage-toolbar">
        <a href="#/tickets" className="ticket-back">
          <ChevronLeft size={18} /> Back to my tickets
        </a>
        <span className="ticket-saved">
          <Check size={14} /> Saved on this phone
        </span>
      </header>
      <div className="ticket-stage-content">
        <p className="ticket-rotate-hint">
          <RotateCw size={16} /> Turn your phone sideways for a bigger ticket.
        </p>
        <article
          className="paper-ticket"
          aria-label={`Round ${ticket.payload.roundNumber}, ticket ${ticket.ticketId}`}
        >
          <header className="paper-ticket-header">
            <div className="paper-ticket-title">
              <span className="paper-ticket-brand">HOUSIE BAAKI</span>
              <h1>{ticket.payload.name}</h1>
              <p>Round {ticket.payload.roundNumber}</p>
            </div>
            <div className="ticket-code">
              <span>TICKET NO.</span>
              <strong>{ticket.ticketId}</strong>
            </div>
          </header>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {grid ? (
            <TicketGridView
              grid={grid}
              marks={ticket.marks}
              disabled={busy}
              onToggle={(n) =>
                void act(() => toggleTicketMark(ticket.roundId, n))
              }
            />
          ) : (
            <p className="form-hint" role="status">
              Recreating your ticket…
            </p>
          )}
          <footer className="paper-ticket-footer">
            <span>90 BALL · 15 NUMBERS</span>
            <span className="ticket-mark-count" role="status">
              {ticket.marks.length} marked · {15 - ticket.marks.length} to go
            </span>
          </footer>
        </article>
        <p className="ticket-player-hint">
          Tap a number to stamp it. Tap again to undo. Your marks are saved on
          this phone.
        </p>
      </div>
    </section>
  );
}

export function TicketWallet({
  route,
  joining,
  act,
  busy,
}: {
  route: string[];
  joining: boolean;
  act: Act;
  busy: boolean;
}) {
  const tickets = useLiveQuery(
    () => db.playerTickets.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const [error, setError] = useState("");
  const token = route[0] || "";
  useEffect(() => {
    if (!joining) return;
    let alive = true;
    void (async () => {
      try {
        const payload = parseRoundLink(token);
        const ticket = await joinRound(payload);
        if (alive) go(`/tickets/${ticket.roundId}`);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [joining, token]);
  async function join(value: string) {
    return act(async () => {
      const ticket = await joinRound(parseRoundLink(value));
      go(`/tickets/${ticket.roundId}`);
    });
  }
  const selected = tickets?.find((t) => t.roundId === token);
  if (selected && !joining && token !== "scan")
    return (
      <PlayerTicketView
        key={selected.roundId}
        ticket={selected}
        act={act}
        busy={busy}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE LUCK IN YOUR POCKET</p>
          <h1>
            My <span className="serif-accent">tickets.</span>
          </h1>
          <p className="subtitle">
            One round. One phone. Your little piece of luck.
          </p>
        </div>
      </div>
      {joining ? (
        error ? (
          <div className="inline-error" role="alert">
            {error}
            <a className="button secondary full" href="#/tickets/scan">
              Scan another round QR
            </a>
          </div>
        ) : (
          <p role="status">Opening your saved ticket…</p>
        )
      ) : token === "scan" ? (
        <Scanner onJoin={join} busy={busy} />
      ) : token ? (
        <p className="inline-error" role="alert">
          Ticket not found. <a href="#/tickets">Back to my tickets</a>
        </p>
      ) : (
        <>
          <a className="button primary full wallet-scan" href="#/tickets/scan">
            <QrCode size={19} /> Scan round QR <ArrowRight size={17} />
          </a>
          {tickets?.length ? (
            <div className="wallet-list">
              {tickets.map((t) => (
                <a
                  key={t.roundId}
                  className="panel wallet-ticket"
                  href={`#/tickets/${t.roundId}`}
                >
                  <span className="stat-icon peach">
                    <Ticket size={22} />
                  </span>
                  <div>
                    <strong>{t.payload.name}</strong>
                    <small>
                      Round {t.payload.roundNumber} · {t.marks.length} marked
                    </small>
                  </div>
                  <span>#{t.ticketId}</span>
                  <ArrowRight size={17} />
                </a>
              ))}
            </div>
          ) : (
            <div className="empty">
              <span className="empty-icon">
                <Ticket size={30} />
              </span>
              <h2>Your first ticket is waiting.</h2>
              <p>
                Scan the QR on the host’s phone. Reopening a round restores the
                same ticket and your marks.
              </p>
            </div>
          )}
          <p className="form-hint">
            Each browser profile saves one ticket per round. Four-digit IDs can
            coincide. Keep the host’s ticket purchases separate.
          </p>
        </>
      )}
    </>
  );
}

export function DigitalClaimPanel({
  g,
  round,
  prize,
  editable,
  act,
  close,
}: {
  g: Gathering;
  round: Round;
  prize: Prize;
  editable: boolean;
  act: Act;
  close: () => void;
}) {
  const [playerId, setPlayerId] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [preview, setPreview] = useState<{
    grid: TicketGrid;
    playerId: string;
    ticketId: string;
  } | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const calledOnTicket = preview
    ? preview.grid
        .flat()
        .filter((number) => number !== null && round.called.includes(number))
        .length
    : 0;
  const duplicate = round.prizes
    .flatMap((p) => p.winners)
    .find(
      (w) =>
        (w.ticketId ?? w.verification?.ticketId) === ticketId &&
        w.playerId !== playerId,
    );
  const sharedPrize = prize.winners.some(
    (w) =>
      (w.ticketId ?? w.verification?.ticketId) === ticketId &&
      w.playerId !== playerId,
  );
  const unavailable = !round.digital
    ? "Open Show round QR first to create this round’s ticket key."
    : round.status !== "playing"
      ? "This round has finished. Use the manual correction flow."
      : "";
  function clearPreview() {
    request.current++;
    setPreview(null);
    setError("");
  }
  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPreview(null);
    const token = ++request.current;
    await act(async () => {
      const grid = await generateTicket(
        round.digital!.key,
        ticketId,
        round.digital!.algorithm,
      );
      if (token === request.current) setPreview({ grid, playerId, ticketId });
    });
  }
  async function confirm() {
    if (!preview) return;
    setError("");
    if (
      await act(() =>
        awardDigitalTicket(
          g.id,
          round.id,
          prize.id,
          preview.playerId,
          preview.ticketId,
        ),
      )
    )
      close();
    else setError("The award was not saved. Check the message and try again.");
  }
  return (
    <div className="digital-claim-panel">
      {unavailable ? (
        <p className="info-box">{unavailable}</p>
      ) : (
        <>
          <form onSubmit={lookup}>
            <label>
              Winner
              <select
                aria-label="Winner"
                value={playerId}
                required
                disabled={!editable}
                onChange={(e) => {
                  setPlayerId(e.target.value);
                  clearPreview();
                }}
              >
                <option value="">Choose a player</option>
                {g.players
                  .filter((p) => round.tickets[p.id] > 0)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Four-digit ticket ID
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                placeholder="0427"
                value={ticketId}
                required
                disabled={!editable}
                autoComplete="off"
                onChange={(e) => {
                  setTicketId(e.target.value.replace(/\D/g, "").slice(0, 4));
                  clearPreview();
                }}
              />
            </label>
            {duplicate && (
              <p className="info-box">
                This ID is also used by{" "}
                {g.players.find((p) => p.id === duplicate.playerId)?.name}. The
                tickets are identical
                {sharedPrize
                  ? "; both winners will share this prize."
                  : ". IDs can coincide."}
              </p>
            )}
            <button
              className="button secondary full"
              disabled={!editable || !playerId || !/^\d{4}$/.test(ticketId)}
            >
              <Ticket size={17} /> Show ticket
            </button>
          </form>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <div className="claim-result">
              <div className="paper-ticket host-ticket-preview">
                <header className="paper-ticket-header">
                  <div className="paper-ticket-title">
                    <span className="paper-ticket-brand">
                      ROUND {round.number}
                    </span>
                    <p>
                      {g.players.find((p) => p.id === preview.playerId)?.name}
                    </p>
                  </div>
                  <div className="ticket-code">
                    <span>TICKET NO.</span>
                    <strong>{preview.ticketId}</strong>
                  </div>
                </header>
                <TicketGridView grid={preview.grid} marks={round.called} />
                <div className="comparison-called" role="status">
                  <span
                    className="comparison-called-symbol"
                    aria-hidden="true"
                  />
                  {round.called.length
                    ? `${calledOnTicket} of 15 called · Circled numbers were called by the host.`
                    : "No numbers have been called in the app."}
                </div>
              </div>
              <p className="claim-manual-hint">
                Compare this ticket with the player’s screen and check their
                claim manually.
              </p>
              <p className="form-hint">
                Four digits show this round’s ticket. They do not prove which QR
                was scanned. Winning claims are approved manually.
              </p>
              <button
                type="button"
                className="button primary full"
                disabled={!editable}
                onClick={() => void confirm()}
              >
                <Check size={17} /> Confirm & award
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
