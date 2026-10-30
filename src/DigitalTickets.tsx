import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import QrScanner from "qr-scanner";
import {
  ArrowRight,
  Camera,
  Check,
  Copy,
  ImagePlus,
  QrCode,
  ShieldCheck,
  Ticket,
  X,
} from "lucide-react";
import { awardDigitalClaim, db, joinRound, toggleTicketMark } from "./db";
import {
  ClaimVerificationError,
  type Gathering,
  type Prize,
  type Round,
} from "./domain";
import {
  encodeRoundLink,
  generateTicket,
  inferredRule,
  parseRoundLink,
  RULE_LABELS,
  type PlayerTicket,
  type TicketGrid,
  type VerificationResult,
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
  result,
  disabled = false,
}: {
  grid: TicketGrid;
  marks?: number[];
  onToggle?: (number: number) => void;
  result?: VerificationResult;
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
            {number}
          </button>
        ) : (
          <span
            key={index}
            className={
              result?.matched.includes(number)
                ? "called-match"
                : result?.required.includes(number)
                  ? "missing-number"
                  : "ticket-neutral"
            }
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
      <label className="round-link-label">
        Round link
        <textarea readOnly value={link} aria-label="Round link" rows={3} />
      </label>
      <button
        className="button secondary full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setError("Select and copy the round link above.");
          }
        }}
      >
        <Copy size={16} /> {copied ? "Copied round link" : "Copy round link"}
      </button>
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
  return (
    <section className="panel player-ticket-panel">
      <div className="player-ticket-heading">
        <span className="badge green">Saved on this phone</span>
        <p>{ticket.payload.name}</p>
        <h2>Round {ticket.payload.roundNumber}</h2>
      </div>
      <div className="ticket-code">
        <span>YOUR TICKET ID</span>
        <strong>{ticket.ticketId}</strong>
        <small>Tell the host these four digits when you claim.</small>
      </div>
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
          onToggle={(n) => void act(() => toggleTicketMark(ticket.roundId, n))}
        />
      ) : (
        <p className="form-hint" role="status">
          Recreating your ticket…
        </p>
      )}
      <div className="ticket-mark-count">
        <span>
          <Check size={15} /> {ticket.marks.length} marked
        </span>
        <span>{15 - ticket.marks.length} to go</span>
      </div>
      <p className="ticket-player-hint">
        Listen to the caller and tap a number to mark it. Tap again to undo.
        Your marks stay on this phone; the host checks against their own call
        history.
      </p>
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
      ) : selected ? (
        <>
          <a className="ticket-back" href="#/tickets">
            All my tickets
          </a>
          <PlayerTicketView
            key={selected.roundId}
            ticket={selected}
            act={act}
            busy={busy}
          />
          <a
            className="button secondary full wallet-scan"
            href="#/tickets/scan"
          >
            <QrCode size={18} /> Scan another round QR
          </a>
        </>
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
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const rule = inferredRule(prize);
  const duplicate = prize.winners.find(
    (w) => w.verification?.ticketId === ticketId && w.playerId !== playerId,
  );
  const unavailable =
    rule === "manual"
      ? "This custom prize uses manual awards. Switch to Manual award."
      : !round.digital
        ? "Open Show round QR first to create this round’s ticket key."
        : !round.caller || !round.called.length
          ? "No called numbers are saved for this round. Use Manual award or start recording calls."
          : round.status !== "playing"
            ? "This round has finished. Use the manual correction flow."
            : "";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    const saved = await act(async () => {
      try {
        await awardDigitalClaim(g.id, round.id, prize.id, playerId, ticketId);
      } catch (e) {
        if (e instanceof ClaimVerificationError) {
          setResult(e.result);
          setError(e.message);
          return;
        }
        throw e;
      }
      close();
    });
    if (!saved)
      setError("The claim was not saved. Check the message and try again.");
  }
  return (
    <div className="digital-claim-panel">
      <p className="verification-rule">
        <ShieldCheck size={17} /> Rule: <strong>{RULE_LABELS[rule]}</strong>
      </p>
      {unavailable ? (
        <p className="info-box">{unavailable}</p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Winner
            <select
              aria-label="Winner"
              value={playerId}
              onChange={(e) => {
                setPlayerId(e.target.value);
                setError("");
                setResult(null);
              }}
              required
              disabled={!editable}
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
              maxLength={4}
              minLength={4}
              placeholder="0427"
              value={ticketId}
              onChange={(e) => {
                setTicketId(e.target.value.replace(/\D/g, "").slice(0, 4));
                setResult(null);
                setError("");
              }}
              required
              disabled={!editable}
              autoComplete="off"
            />
          </label>
          {duplicate && (
            <p className="info-box">
              This ID is also used by{" "}
              {g.players.find((p) => p.id === duplicate.playerId)?.name}. The
              tickets are identical; both winners will share this prize.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="claim-result">
              <TicketGridView grid={result.grid} result={result} />
              <p className="form-hint">
                Green numbers were called. Orange numbers are still missing for
                this rule
                {rule === "earlyFive" ? `; ${result.needed} more needed` : ""}.
                No award has been changed.
              </p>
            </div>
          )}
          <button
            className="button primary full"
            disabled={!editable || !playerId || !/^\d{4}$/.test(ticketId)}
          >
            <ShieldCheck size={17} /> Verify & award
          </button>
          <p className="form-hint">
            Checks the selected prize against the host’s call history and
            records one winning ticket only on success. Existing awards are
            never silently replaced.
          </p>
        </form>
      )}
    </div>
  );
}
