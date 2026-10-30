import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coins,
  Download,
  Flag,
  Gift,
  History,
  House,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Trophy,
  Upload,
  Users,
  Wallet,
  WifiOff,
  X,
  Pencil,
  Dices,
  CircleCheck,
  Archive,
} from "lucide-react";
import {
  db,
  changeGathering,
  createGathering,
  exportBackup,
  restoreBackup,
} from "./db";
import {
  type Gathering,
  type Round,
  type Prize,
  type Transfer,
  type Backup,
  uid,
  rupees,
  parseMoney,
  pool,
  prizeAmounts,
  prizeShares,
  balances,
  settlements,
  playerEntries,
  newRound,
  nextCalled,
  validateBudget,
  validateBackupContents,
} from "./domain";
import { Modal, type Act, type Change } from "./ui";
import {
  TicketWallet,
  RoundQrModal,
  DigitalClaimPanel,
} from "./DigitalTickets";
import { createRoundKey, RULE_LABELS } from "./tickets";
import { useEditorLock } from "./useEditorLock";

const date = (n: number) =>
  new Date(n).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const time = (n: number) =>
  new Date(n).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
const navigate = (path: string) => {
  window.location.hash = path;
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
const roundLink = (g: Gathering, r: Round) => `/g/${g.id}/round/${r.id}`;
const roundTotal = (g: Gathering) =>
  g.rounds.filter((r) => r.status === "completed").length;

function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span className={`avatar avatar-${index % 5} ${small ? "small" : ""}`}>
      {initials(name)}
    </span>
  );
}
function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function TicketArt() {
  return (
    <div className="ticket-art" aria-hidden="true">
      <span className="art-star star-one">✳</span>
      <span className="art-star star-two">✳</span>
      <div className="floating-ball ball-7">7</div>
      <div className="floating-ball ball-42">42</div>
      <div className="art-ticket">
        <div className="art-ticket-head">
          <span>GOOD TIMES CLUB</span>
          <Sparkles size={17} />
        </div>
        <div className="art-ticket-grid">
          {[
            7,
            "",
            23,
            "",
            42,
            "",
            61,
            "",
            88,
            "",
            15,
            "",
            34,
            "",
            56,
            "",
            72,
            90,
            3,
            "",
            29,
            "",
            47,
            58,
            "",
            79,
            "",
          ].map((n, i) => (
            <span
              key={i}
              className={[0, 4, 14, 25].includes(i) ? "marked" : ""}
            >
              {n}
            </span>
          ))}
        </div>
        <div className="art-ticket-foot">
          A LITTLE LUCK. A LOT OF FUN.<span>№ 001</span>
        </div>
      </div>
      <div className="art-label">
        <CheckCheck size={15} /> Hisaab? Sorted.
      </div>
    </div>
  );
}

function Toast({
  message,
  error,
  dismiss,
}: {
  message: string;
  error: boolean;
  dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current?.showPopover && !ref.current.matches(":popover-open"))
      ref.current.showPopover();
  }, [message]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`toast ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ? <CircleHelp size={19} /> : <CircleCheck size={19} />}
      <span>{message}</span>
      <button aria-label="Dismiss notification" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export default function App() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || "/");
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const all = useLiveQuery(
    () => db.gatherings.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const parts = hash.split("/").filter(Boolean);
  const gatheringId = parts[0] === "g" ? parts[1] : undefined;
  const current = all?.find((g) => g.id === gatheringId);
  const activeRound = all?.some((g) =>
    g.rounds.some((r) => r.status === "playing"),
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash.slice(1) || "/");
      setToast(null);
      window.scrollTo(0, 0);
    };
    const onNetwork = () => setOffline(!navigator.onLine);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const act: Act = async (task, success) => {
    if (busy) return false;
    setBusy(true);
    try {
      await task();
      if (success) setToast({ message: success, error: false });
      return true;
    } catch (e) {
      setToast({
        message:
          e instanceof Error
            ? e.name === "ZodError"
              ? "Please check the entered values. Names and prize labels cannot be empty."
              : e.message
            : "Could not save. Please try again.",
        error: true,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const page = parts[0] || "home";
  const ticketScreen = page === "tickets" && !!parts[1] && parts[1] !== "scan";

  return (
    <div className={`app-shell ${ticketScreen ? "ticket-screen" : ""}`}>
      <div className="workspace">
        <header className="topbar">
          <a
            className={`brand ${current ? "context-brand" : ""}`}
            href={
              current && parts[2] === "round"
                ? `#/g/${current.id}/overview`
                : "#/"
            }
            aria-label={
              current && parts[2] === "round"
                ? "Back to players"
                : "Housie Baaki home"
            }
          >
            <span className="brand-icon">
              {current ? <ChevronLeft size={22} /> : <Ticket size={23} />}
            </span>
            <span>
              {current ? (
                parts[2] === "round" ? (
                  current.name
                ) : (
                  "All gatherings"
                )
              ) : (
                <>
                  housie{" "}
                  <span className="brand-baaki">
                    baaki<span className="brand-dot">.</span>
                  </span>
                </>
              )}
            </span>
          </a>
          <div className="topbar-right">
            {install && (
              <button
                className="install-button"
                onClick={() =>
                  void act(async () => {
                    await install.prompt();
                    await install.userChoice;
                    setInstall(null);
                  })
                }
              >
                <Download size={15} /> Install app
              </button>
            )}
            <span className="local-pill">
              {offline ? (
                <WifiOff size={13} />
              ) : (
                <span className="status-dot" />
              )}
              {offline ? "Offline" : "On this device"}
            </span>
            <button
              className="icon-button help-top"
              onClick={() => setHelp(true)}
              aria-label="How it works"
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        {needRefresh && !activeRound && !ticketScreen && (
          <div className="notice update-notice">
            A fresh version is ready. Your games stay saved.
            <button onClick={() => void updateServiceWorker(true)}>
              Update app <RotateCcw size={14} />
            </button>
          </div>
        )}
        <main id="main-content">
          {!all ? (
            <div className="loading">Getting your game table ready…</div>
          ) : gatheringId ? (
            current ? (
              <GatheringView
                key={gatheringId}
                g={current}
                tab={parts[2] || "overview"}
                roundId={parts[3]}
                act={act}
                busy={busy}
              />
            ) : (
              <Empty
                icon={<Ticket />}
                title="Gathering not found"
                text="It may have been replaced by a restored backup."
              >
                <a className="button primary" href="#/">
                  Back home
                </a>
              </Empty>
            )
          ) : page === "tickets" || page === "join" ? (
            <TicketWallet
              route={parts.slice(1)}
              joining={page === "join"}
              act={act}
              busy={busy}
            />
          ) : page === "backup" ? (
            <BackupView act={act} busy={busy} />
          ) : (
            <Home
              gatherings={all}
              history={page === "history"}
              act={act}
              busy={busy}
            />
          )}
        </main>
        {!current && !ticketScreen && (
          <nav
            className="app-navigation global-navigation"
            aria-label="Main navigation"
          >
            {[
              ["home", "/", "Home", House],
              ["history", "/history", "Gatherings", History],
              ["tickets", "/tickets", "My tickets", Ticket],
              ["backup", "/backup", "Backup & restore", Download],
            ].map(([value, href, label, Icon]) => {
              const I = Icon as typeof House;
              return (
                <a
                  key={String(value)}
                  href={`#${href}`}
                  aria-current={
                    page === value || (value === "tickets" && page === "join")
                      ? "page"
                      : undefined
                  }
                  className={
                    page === value || (value === "tickets" && page === "join")
                      ? "selected"
                      : ""
                  }
                >
                  <I size={22} />
                  <span>{String(label)}</span>
                </a>
              );
            })}
          </nav>
        )}
      </div>
      {toast && (
        <Toast
          message={toast.message}
          error={toast.error}
          dismiss={() => setToast(null)}
        />
      )}
      {help && (
        <Modal title="More housie, less hisaab." close={() => setHelp(false)}>
          <div className="help-steps">
            {[
              [
                "01",
                "Bring your people",
                "Start a gathering and add everyone’s name. One phone keeps the score.",
              ],
              [
                "02",
                "Set the stakes",
                "Log ticket purchases and divide the pool into your favourite prizes. Share the round QR for digital tickets.",
              ],
              [
                "03",
                "Celebrate the wins",
                "Check claims yourself, preview digital tickets by ID, and record winners. Shared wins split by winning tickets.",
              ],
              [
                "04",
                "Settle when you’re ready",
                "Completed rounds turn into a simple who-pays-whom list. Record payments and keep playing.",
              ],
            ].map(([n, title, text]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </section>
              </div>
            ))}
          </div>
          <p className="info-box">
            <LockKeyhole size={18} /> Games live in this browser. Export a
            backup to keep a copy before clearing browser data or changing
            devices.
          </p>
          <button
            className="button primary full"
            onClick={() => setHelp(false)}
          >
            Got it. Let’s play <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}

function Home({
  gatherings,
  history,
  act,
  busy,
}: {
  gatherings: Gathering[];
  history: boolean;
  act: Act;
  busy: boolean;
}) {
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("all");
  const shown = gatherings.filter(
    (g) => filter === "all" || g.status === filter,
  );
  const completed = gatherings.reduce((a, g) => a + roundTotal(g), 0);
  const players = gatherings.reduce((a, g) => a + g.players.length, 0);
  const recent = gatherings.find((g) => g.status === "active");
  const recentRound = recent?.rounds.find(
    (r) => r.status === "playing" || r.status === "draft",
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      await navigator.locks.request(
        "housie-storage",
        { mode: "shared" },
        async () => {
          const g = await createGathering(name);
          setCreate(false);
          navigate(`/g/${g.id}/overview`);
        },
      );
    }, "Your gathering is ready. Add your people!");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {history
              ? "EVERY GAME HAS A STORY"
              : "GOOD COMPANY. GREAT GAME NIGHTS."}
          </p>
          <h1>
            {history ? (
              "Your gatherings"
            ) : (
              <>
                Your game <span className="serif-accent">night.</span>
              </>
            )}
          </h1>
          <p className="subtitle">
            {history
              ? "All your rounds, little victories, and settled scores."
              : "Play a little. Leave nothing baaki."}
          </p>
        </div>
        {history && (
          <button className="button primary" onClick={() => setCreate(true)}>
            <Plus size={18} /> New gathering
          </button>
        )}
      </div>
      {!history && recent && (
        <a
          className="resume-card"
          href={`#${recentRound ? roundLink(recent, recentRound) : `/g/${recent.id}/overview`}`}
          aria-label={`Resume ${recent.name}`}
        >
          <span className="resume-icon">
            <Ticket size={24} />
          </span>
          <div>
            <small>BACK TO THE GOOD TIMES</small>
            <strong>{recent.name}</strong>
            <p>
              {recent.players.length} players ·{" "}
              {recentRound
                ? `Round ${recentRound.number} ${recentRound.status === "playing" ? "in play" : "ready to set up"}`
                : `${roundTotal(recent)} rounds played`}
            </p>
          </div>
          <ArrowRight size={22} />
        </a>
      )}
      {!history && (
        <div className={`home-feature-grid ${recent ? "compact" : ""}`}>
          <section className="hero-card">
            <div className="hero-copy">
              <span className="tiny-tag">
                <Sparkles size={13} /> GAME NIGHT, SIMPLIFIED
              </span>
              <h2>
                Play now.
                <em>Settle later.</em>
              </h2>
              <p>Tickets, little wins, and who owes whom. All in one place.</p>
              <button className="button dark" onClick={() => setCreate(true)}>
                <Plus size={18} /> Start a gathering <ArrowRight size={17} />
              </button>
              <span className="hero-footnote">
                No signup. Just names and good vibes.
              </span>
            </div>
            <TicketArt />
          </section>
        </div>
      )}
      {!history && (
        <a
          className="join-shortcut button secondary full"
          href="#/tickets/scan"
        >
          <Ticket size={19} /> Scan round QR <ArrowRight size={17} />
        </a>
      )}
      {!history && (
        <div className="stats-strip">
          <div>
            <span className="stat-icon peach">
              <Users size={19} />
            </span>
            <strong>
              {gatherings.length}
              <small>gatherings</small>
            </strong>
          </div>
          <div>
            <span className="stat-icon mint">
              <Ticket size={19} />
            </span>
            <strong>
              {completed}
              <small>rounds played</small>
            </strong>
          </div>
          <div>
            <span className="stat-icon lilac">
              <Trophy size={19} />
            </span>
            <strong>
              {players}
              <small>players joined</small>
            </strong>
          </div>
          <div className="stats-note">
            <span className="little-star">✳</span> Less counting.
            <br />
            More celebrating.
          </div>
        </div>
      )}
      <section className="gatherings-section">
        <div className="section-heading">
          <h2>
            {history ? "The game-night archive" : "Your table"}
            <span className="heading-count">{gatherings.length}</span>
          </h2>
          <div className="segmented" aria-label="Filter gatherings">
            {[
              ["all", "All"],
              ["active", "Active"],
              ["closed", "Finished"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="gathering-grid">
            {shown.map((g) => {
              const pending = settlements(g).reduce((a, p) => a + p.amount, 0);
              const playing = g.rounds.find((r) => r.status === "playing");
              return (
                <a
                  className="gathering-card"
                  href={`#/g/${g.id}/overview`}
                  key={g.id}
                >
                  <div className="gathering-card-top">
                    <span className="gathering-symbol">
                      <Ticket size={22} />
                    </span>
                    <span
                      className={`badge ${g.status === "active" ? "green" : "neutral"}`}
                    >
                      {g.status === "active" && <span className="status-dot" />}
                      {g.status === "active" ? "At the table" : "Finished"}
                    </span>
                  </div>
                  <h3>{g.name}</h3>
                  <p className="muted small-text">
                    {date(g.createdAt)} · {g.players.length} players ·{" "}
                    {roundTotal(g)} rounds played
                  </p>
                  <div className="gathering-card-bottom">
                    <span>
                      {playing ? (
                        <>
                          <span className="live-dot" /> Round {playing.number}{" "}
                          in play
                        </>
                      ) : pending ? (
                        <>{rupees(pending)} to settle</>
                      ) : g.rounds.length ? (
                        "All squared up"
                      ) : (
                        "Ready for your first round"
                      )}
                    </span>
                    <ArrowRight size={18} />
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="home-empty">
            <div className="empty-ticket">
              <Ticket size={33} />
              <span>✦</span>
            </div>
            <div>
              <h3>
                {gatherings.length
                  ? "No gatherings here yet"
                  : "Your next good time starts here."}
              </h3>
              <p>
                {gatherings.length
                  ? "Try a different filter, or start something new."
                  : "Add your people, play a round, settle up together."}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => setCreate(true)}
            >
              <Plus size={17} /> New gathering
            </button>
          </div>
        )}
      </section>
      {!history && (
        <p className="creator-credit">
          Created by{" "}
          <a
            href="https://surajjadhav.me"
            target="_blank"
            rel="noopener noreferrer"
          >
            Suraj Jadhav
          </a>
        </p>
      )}
      {create && (
        <Modal
          title="Make room for a good time."
          description="Give your gathering a name. You can add everyone next."
          close={() => !busy && setCreate(false)}
        >
          <form onSubmit={submit}>
            <label>
              Gathering name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Diwali with the gang"
                maxLength={80}
                required
              />
            </label>
            <p className="form-hint">
              <LockKeyhole size={14} /> Saved only on this device. No signup
              needed.
            </p>
            <button
              className="button primary full"
              disabled={busy || !name.trim()}
            >
              {busy ? "Setting the table…" : "Start gathering"}{" "}
              <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function GatheringView({
  g,
  tab,
  roundId,
  act,
  busy,
}: {
  g: Gathering;
  tab: string;
  roundId?: string;
  act: Act;
  busy: boolean;
}) {
  const lock = useEditorLock(g.id);
  const editable = lock === "held";
  const [confirm, setConfirm] = useState<null | {
    title: string;
    text: string;
    action: () => Promise<boolean>;
  }>(null);
  const change: Change = (fn, kind, message, id) =>
    act(async () => {
      if (!editable)
        throw new Error("This gathering is read-only in this tab.");
      await changeGathering(g.id, fn, kind, message, id);
    });
  const current = g.rounds.find((r) => ["draft", "playing"].includes(r.status));
  const selected = roundId
    ? g.rounds.find((r) => r.id === roundId)
    : current || g.rounds.at(-1);
  const values = balances(g),
    outstanding = Object.values(values)
      .filter((v) => v > 0)
      .reduce((a, n) => a + n, 0);
  async function addRound() {
    const r = newRound(g);
    if (
      await change(
        (s) => {
          s.rounds.push(r);
        },
        "round",
        `Created round ${r.number}${r.number > 1 ? " using previous round settings" : ""}.`,
        r.id,
      )
    )
      navigate(roundLink(g, r));
  }
  return (
    <>
      <a className="back-link" href="#/">
        <ChevronLeft size={16} /> Back to your table
      </a>
      <div className="page-heading gathering-heading">
        <div>
          <div className="eyebrow">
            {date(g.createdAt)}{" "}
            <span
              className={`badge ${g.status === "active" ? "green" : "neutral"}`}
            >
              {g.status === "active" ? "At the table" : "Finished"}
            </span>
          </div>
          <h1>{g.name}</h1>
          <p className="subtitle">
            {g.players.length} people. {roundTotal(g)} rounds. Plenty of good
            times.
          </p>
        </div>
        <div className="heading-actions gathering-actions">
          {g.status === "active" ? (
            <>
              <button
                className="button secondary"
                aria-label="Finish gathering"
                title="Finish gathering"
                disabled={!editable || busy}
                onClick={() =>
                  setConfirm({
                    title: "Call it a night?",
                    text: "Your gathering moves to history. You can still record payments or reopen it later.",
                    action: () =>
                      change(
                        (s) => {
                          s.status = "closed";
                        },
                        "gathering",
                        "Closed the gathering.",
                      ),
                  })
                }
              >
                <Flag size={18} />
                <span>Finish gathering</span>
              </button>
              {tab !== "round" && (
                <button
                  className="button primary"
                  disabled={
                    !editable || busy || !g.players.some((p) => p.active)
                  }
                  onClick={() =>
                    current ? navigate(roundLink(g, current)) : void addRound()
                  }
                >
                  {current ? (
                    <>
                      <ArrowRight size={17} />{" "}
                      {current.status === "draft"
                        ? "Set up round"
                        : "Continue round"}
                    </>
                  ) : (
                    <>
                      <Plus size={17} /> New round
                    </>
                  )}
                </button>
              )}
            </>
          ) : (
            <button
              className="button secondary"
              disabled={!editable || busy}
              onClick={() =>
                void change(
                  (s) => {
                    s.status = "active";
                  },
                  "gathering",
                  "Reopened the gathering.",
                )
              }
            >
              <RotateCcw size={16} /> Reopen gathering
            </button>
          )}
        </div>
      </div>
      {lock === "readonly" && (
        <div className="notice">
          <LockKeyhole size={18} /> Another tab is managing this gathering. This
          tab shows live, read-only updates. Close the other tab and refresh
          here to take over.
        </div>
      )}
      {lock === "unsupported" && (
        <div className="notice">
          <LockKeyhole size={18} /> Safe editing needs a browser with Web Locks.
          Open this app in a current browser over HTTPS or localhost.
        </div>
      )}
      <nav
        className="gathering-tabs app-navigation"
        aria-label="Gathering sections"
      >
        {[
          ["overview", "The table", Users],
          ["round", "Rounds & caller", Ticket],
          ["dues", "Settle up", Wallet],
          ["activity", "Activity", History],
        ].map(([value, label, Icon]) => {
          const I = Icon as typeof Users;
          return (
            <a
              key={String(value)}
              href={`#/g/${g.id}/${value}`}
              className={tab === value ? "active" : ""}
              aria-current={tab === value ? "page" : undefined}
              aria-label={String(label)}
            >
              <I size={17} />
              <span>
                {value === "overview"
                  ? "Players"
                  : value === "round"
                    ? "Play"
                    : value === "dues"
                      ? "Dues"
                      : "Activity"}
              </span>
              {value === "dues" && outstanding > 0 && (
                <span className="tab-dot" />
              )}
            </a>
          );
        })}
      </nav>
      {tab === "overview" ? (
        <TableView
          g={g}
          change={change}
          editable={editable && !busy}
          onRound={() =>
            current ? navigate(roundLink(g, current)) : void addRound()
          }
        />
      ) : tab === "round" ? (
        selected ? (
          <RoundView
            key={selected.id}
            g={g}
            round={selected}
            act={act}
            change={change}
            editable={editable && !busy}
          />
        ) : (
          <Empty
            icon={<Ticket size={30} />}
            title="A fresh round awaits"
            text="Set the ticket price, pick your prizes, and let the good times begin."
          >
            {g.status === "active" && (
              <button
                className="button primary"
                disabled={!editable || busy || !g.players.some((p) => p.active)}
                onClick={() => void addRound()}
              >
                Set up first round <ArrowRight size={17} />
              </button>
            )}
          </Empty>
        )
      ) : tab === "dues" ? (
        <DuesView
          g={g}
          change={change}
          editable={editable && !busy}
          act={act}
        />
      ) : (
        <ActivityView g={g} />
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          description={confirm.text}
          close={() => !busy && setConfirm(null)}
        >
          {current && (
            <p className="inline-error">
              Finish or cancel round {current.number} before closing this
              gathering.
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              Keep playing
            </button>
            <button
              className="button primary"
              disabled={busy || !!current}
              onClick={async () => {
                if (await confirm.action()) setConfirm(null);
              }}
            >
              Finish gathering
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function TableView({
  g,
  change,
  editable,
  onRound,
}: {
  g: Gathering;
  change: Change;
  editable: boolean;
  onRound: () => void;
}) {
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const values = balances(g);
  const totalPool = g.rounds
    .filter((r) => r.status === "completed")
    .reduce((a, r) => a + pool(r), 0);
  async function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (
      await change(
        (s) => {
          s.players.push({ id: uid(), name: trimmed, active: true });
        },
        "player",
        `Added ${trimmed} to the table.`,
      )
    )
      setName("");
  }
  return (
    <div className="table-layout">
      <div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                The good company{" "}
                <span className="heading-count">{g.players.length}</span>
              </h2>
              <p>Everyone at the table, all in one place.</p>
            </div>
            <Users size={22} className="muted" />
          </div>
          {g.status === "active" && (
            <form className="add-player-form" onSubmit={add}>
              <label className="sr-only" htmlFor="player-name">
                Player name
              </label>
              <input
                id="player-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who’s joining? Enter a name"
                required
                maxLength={80}
                disabled={!editable}
              />
              <button
                className="button primary"
                disabled={!editable || !name.trim()}
              >
                <Plus size={17} /> Add player
              </button>
            </form>
          )}
          {g.players.length ? (
            <div className="player-list">
              {g.players.map((p, i) => (
                <div
                  className={`player-row ${!p.active ? "inactive" : ""}`}
                  key={p.id}
                >
                  <Avatar name={p.name} index={i} />
                  <div className="player-info">
                    <strong>{p.name}</strong>
                    <small>
                      {!p.active
                        ? "Sitting out future rounds"
                        : "Ready to play"}
                    </small>
                  </div>
                  <span
                    className={`player-net ${values[p.id] > 0 ? "positive" : ""}`}
                  >
                    {values[p.id] === 0 ? (
                      <small>All square</small>
                    ) : (
                      <>
                        {rupees(Math.abs(values[p.id]))}
                        <small>{values[p.id] > 0 ? "gets back" : "owes"}</small>
                      </>
                    )}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Rename ${p.name}`}
                    disabled={!editable}
                    onClick={() => setEdit({ id: p.id, name: p.name })}
                  >
                    <Pencil size={15} />
                  </button>
                  {g.status === "active" && (
                    <button
                      className={`seat-button ${!p.active ? "is-out" : ""}`}
                      disabled={!editable}
                      onClick={() =>
                        void change(
                          (s) => {
                            const x = s.players.find((x) => x.id === p.id)!;
                            x.active = !x.active;
                          },
                          "player",
                          `${p.name} ${p.active ? "will sit out future rounds" : "is back at the table"}.`,
                        )
                      }
                    >
                      {p.active ? "Sit out" : "Join in"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<Users size={28} />}
              title="Every great game starts with your people."
              text="Add a few names above. No phone numbers, no accounts — just your gang."
            />
          )}
          <div className="panel-footnote">
            <ShieldCheck size={14} /> Sitting out keeps all past tickets, wins,
            and dues.
          </div>
        </section>
        <section className="panel rounds-panel">
          <div className="panel-heading">
            <div>
              <h2>One more round?</h2>
              <p>Your evening, round by round.</p>
            </div>
            {g.status === "active" && (
              <button
                className="text-button"
                disabled={!editable || !g.players.some((p) => p.active)}
                onClick={onRound}
              >
                <Plus size={16} />{" "}
                {g.rounds.some((r) => ["draft", "playing"].includes(r.status))
                  ? "Continue"
                  : "New round"}
              </button>
            )}
          </div>
          {g.rounds.length ? (
            [...g.rounds].reverse().map((r) => (
              <a
                className="round-list-row"
                href={`#${roundLink(g, r)}`}
                key={r.id}
              >
                <span className={`round-number ${r.status}`}>
                  {r.number.toString().padStart(2, "0")}
                </span>
                <div>
                  <strong>Round {r.number}</strong>
                  <small>
                    {Object.values(r.tickets).reduce((a, n) => a + n, 0)}{" "}
                    tickets · {rupees(pool(r))} pool
                  </small>
                </div>
                <span
                  className={`badge ${r.status === "playing" ? "green" : r.status === "draft" ? "orange" : "neutral"}`}
                >
                  {r.status === "playing"
                    ? "In play"
                    : r.status === "draft"
                      ? "Setting up"
                      : r.status === "cancelled"
                        ? "Cancelled"
                        : "Completed"}
                </span>
                <ChevronRight size={17} />
              </a>
            ))
          ) : (
            <div className="rounds-placeholder">
              <Ticket size={23} />
              <p>Add your people, then set up your first round.</p>
            </div>
          )}
        </section>
      </div>
      <aside className="table-summary">
        <section className="summary-card">
          <span className="eyebrow">THE EVENING SO FAR</span>
          <h3>
            Little wins.
            <br />
            Lovely memories.
          </h3>
          <div>
            <span>Rounds completed</span>
            <strong>{roundTotal(g)}</strong>
          </div>
          <div>
            <span>Total prize pools</span>
            <strong>{rupees(totalPool)}</strong>
          </div>
          <div>
            <span>Payments recorded</span>
            <strong>{g.payments.filter((p) => !p.reversedAt).length}</strong>
          </div>
          <a href={`#/g/${g.id}/dues`}>
            Check the hisaab <ArrowRight size={17} />
          </a>
        </section>
        <div className="table-tip">
          <Sparkles size={19} />
          <p>
            <strong>Your house, your rules.</strong>
            <br />
            Add any prize you like — corners, lucky seven, or something only
            your gang understands.
          </p>
        </div>
      </aside>
      {edit && (
        <Modal title="What should we call them?" close={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await change(
                  (s) => {
                    s.players.find((p) => p.id === edit.id)!.name =
                      edit.name.trim();
                  },
                  "player",
                  `Renamed ${g.players.find((p) => p.id === edit.id)?.name} to ${edit.name.trim()}.`,
                )
              )
                setEdit(null);
            }}
          >
            <label>
              Player name
              <input
                autoFocus
                maxLength={80}
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <button
              className="button primary full"
              disabled={!editable || !edit.name.trim()}
            >
              Save name <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function RoundView({
  g,
  round,
  change,
  editable,
  act,
}: {
  g: Gathering;
  round: Round;
  change: Change;
  editable: boolean;
  act: Act;
}) {
  const [award, setAward] = useState<Prize | null>(null);
  const [cancel, setCancel] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [playMode, setPlayMode] = useState<"prizes" | "caller">(
    round.called.length ? "caller" : "prizes",
  );
  const amounts = prizeAmounts(round);
  const awarded = round.prizes
    .filter((p) => p.winners.length)
    .reduce((a, p) => a + (amounts[p.id] || 0), 0);
  const current = round.status === "playing";
  if (round.status === "draft")
    return (
      <RoundSetup g={g} round={round} change={change} editable={editable} />
    );
  return (
    <>
      <div className="round-toolbar">
        <div>
          <div className="eyebrow">
            {round.status === "playing"
              ? "LET’S PLAY"
              : "FROM THE GAME-NIGHT ARCHIVE"}
          </div>
          <h2>
            Round {round.number}
            <span className={`badge ${current ? "green" : "neutral"}`}>
              {current
                ? "In play"
                : round.status === "completed"
                  ? "Completed"
                  : "Cancelled"}
            </span>
          </h2>
        </div>
        <div className="heading-actions">
          {g.rounds.length > 1 && (
            <label className="sr-label">
              View round
              <select
                aria-label="View round"
                value={round.id}
                onChange={(e) => navigate(`/g/${g.id}/round/${e.target.value}`)}
              >
                {g.rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    Round {r.number} · {r.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          {current && (
            <>
              <button
                className="button secondary"
                disabled={!editable}
                onClick={async () => {
                  if (round.digital) {
                    setSharing(true);
                    return;
                  }
                  if (
                    await change(
                      (s) => {
                        const r = s.rounds.find((r) => r.id === round.id)!;
                        if (!r.digital)
                          r.digital = { algorithm: 1, key: createRoundKey() };
                      },
                      "round",
                      `Enabled offline digital tickets for round ${round.number}.`,
                      round.id,
                    )
                  )
                    setSharing(true);
                }}
              >
                Show round QR
              </button>
              <button
                className="button secondary"
                disabled={!editable}
                onClick={() => setCancel(true)}
              >
                Cancel round
              </button>
              <div className="round-complete-bar">
                <div>
                  <strong>
                    {round.prizes.filter((p) => p.winners.length).length} of{" "}
                    {round.prizes.length} prizes awarded
                  </strong>
                  <small>
                    {round.prizes.every((p) => p.winners.length)
                      ? "All wins recorded. Ready to wrap up?"
                      : "Record the wins, then finish this round."}
                  </small>
                </div>{" "}
                <button
                  className="button primary"
                  disabled={
                    !editable || round.prizes.some((p) => !p.winners.length)
                  }
                  onClick={() =>
                    void change(
                      (s) => {
                        const r = s.rounds.find((r) => r.id === round.id)!;
                        r.status = "completed";
                        r.completedAt = Date.now();
                      },
                      "round",
                      `Finished round ${round.number}. Ticket costs and prizes are now included in dues.`,
                      round.id,
                    )
                  }
                >
                  <CheckCheck size={17} /> Finish round
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {round.status === "cancelled" && (
        <div className="notice">
          This round was cancelled. Its tickets and prizes do not affect
          anyone’s dues.
        </div>
      )}
      <div className="round-stat-strip">
        <div>
          <Ticket size={18} />
          <span>
            <small>Tickets in play</small>
            <strong>
              {Object.values(round.tickets).reduce((a, n) => a + n, 0)}{" "}
              <em>× {rupees(round.ticketPrice)}</em>
            </strong>
          </span>
        </div>
        <div>
          <Coins size={18} />
          <span>
            <small>Prize pool</small>
            <strong>{rupees(pool(round))}</strong>
          </span>
        </div>
        <div>
          <Trophy size={18} />
          <span>
            <small>{current ? "Awarded so far" : "Prizes awarded"}</small>
            <strong>
              {rupees(awarded)} <em>/ {rupees(pool(round))}</em>
            </strong>
          </span>
        </div>
      </div>
      {current && (
        <div className="provisional-note">
          <Clock3 size={15} /> {rupees(pool(round) - awarded)} still to award.
          Dues update when the round ends.
        </div>
      )}
      <div className="play-switch segmented" aria-label="Round view">
        <button
          type="button"
          aria-label="Prizes"
          aria-pressed={playMode === "prizes"}
          onClick={() => setPlayMode("prizes")}
        >
          <Trophy size={17} /> Prizes <span>{round.prizes.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={playMode === "caller"}
          onClick={() => setPlayMode("caller")}
        >
          <Dices size={17} /> Number caller
        </button>
      </div>
      <div className={`play-layout mode-${playMode}`}>
        <section className="panel prizes-panel">
          <div className="panel-heading">
            <div>
              <h2>The little victories</h2>
              <p>
                {current
                  ? "Check the claim. Crown the winner."
                  : "Every winner, every share."}
              </p>
            </div>
            <Trophy className="muted" size={21} />
          </div>
          <div className="prize-list">
            {round.prizes.map((p, i) => (
              <div
                className={`prize-card ${p.winners.length ? "awarded" : ""}`}
                key={p.id}
              >
                <div className="prize-card-heading">
                  <span className={`prize-medal medal-${i % 3}`}>
                    {p.name.toLowerCase().includes("house") ? (
                      <House size={19} />
                    ) : (
                      <Trophy size={19} />
                    )}
                  </span>
                  <div>
                    <h3>{p.name}</h3>
                    <small>
                      {p.winners.length
                        ? `${p.winners.reduce((a, w) => a + w.tickets, 0)} winning ticket${p.winners.reduce((a, w) => a + w.tickets, 0) === 1 ? "" : "s"}`
                        : "Waiting for a little luck"}
                    </small>
                  </div>
                  <strong>{rupees(amounts[p.id] || 0)}</strong>
                </div>
                {p.winners.length > 0 && (
                  <div className="winner-chips">
                    {p.winners.map((w) => (
                      <span key={w.playerId}>
                        <Check size={13} />
                        {g.players.find((x) => x.id === w.playerId)?.name}
                        {(w.ticketId ?? w.verification?.ticketId) &&
                          ` · #${w.ticketId ?? w.verification?.ticketId}`}
                        <strong>
                          {rupees(prizeShares(round, p)[w.playerId])}
                        </strong>
                      </span>
                    ))}
                  </div>
                )}
                {round.status !== "cancelled" && (
                  <button
                    className={`button ${p.winners.length ? "ghost" : "secondary"} full`}
                    disabled={!editable}
                    onClick={() => setAward(p)}
                  >
                    {p.winners.length ? (
                      <>
                        <Pencil size={14} />{" "}
                        {current ? "Edit winners" : "Correct winners"}
                      </>
                    ) : (
                      <>
                        <Plus size={16} /> Add winner
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
          {current && round.prizes.some((p) => !p.winners.length) && (
            <div className="panel-footnote">
              <Gift size={14} /> Award every prize to finish this round.
            </div>
          )}
        </section>
        <div className="caller-content">
          {round.caller ? (
            <Caller
              round={round}
              change={change}
              editable={editable && current}
            />
          ) : current ? (
            <section className="panel caller-off">
              <Dices size={34} />
              <h3>Calling numbers your way?</h3>
              <p>
                Keep using your own caller, or switch on the built-in 1–90
                board.
              </p>
              <button
                className="button secondary"
                disabled={!editable}
                onClick={() =>
                  void change(
                    (s) => {
                      s.rounds.find((r) => r.id === round.id)!.caller = true;
                    },
                    "caller",
                    `Enabled the number caller for round ${round.number}.`,
                    round.id,
                  )
                }
              >
                Enable number caller
              </button>
            </section>
          ) : (
            <section className="panel caller-off">
              <Dices size={32} />
              <h3>No caller used this round.</h3>
              <p>Claims and prizes are saved in the prize view.</p>
            </section>
          )}
        </div>
      </div>
      <details className="panel ticket-details">
        <summary>
          <Ticket size={18} /> Tickets at the table{" "}
          <span>
            {Object.values(round.tickets).filter((n) => n > 0).length} players
          </span>
        </summary>
        <div className="ticket-detail-grid">
          {g.players
            .filter((p) => round.tickets[p.id])
            .map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <strong>
                  {round.tickets[p.id]} × {rupees(round.ticketPrice)} ={" "}
                  {rupees(round.tickets[p.id] * round.ticketPrice)}
                </strong>
              </div>
            ))}
        </div>
      </details>
      {sharing && round.digital && (
        <RoundQrModal g={g} round={round} close={() => setSharing(false)} />
      )}
      {award && (
        <AwardModal
          key={award.id}
          g={g}
          round={round}
          prize={award}
          act={act}
          change={change}
          editable={editable}
          close={() => setAward(null)}
        />
      )}
      {cancel && (
        <Modal
          title="Cancel this round?"
          description="The caller and prize history stay in the archive. No costs or wins from this round will count towards dues."
          close={() => setCancel(false)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setCancel(false)}
            >
              Keep playing
            </button>
            <button
              className="button danger"
              disabled={!editable}
              onClick={async () => {
                if (
                  await change(
                    (s) => {
                      s.rounds.find((r) => r.id === round.id)!.status =
                        "cancelled";
                    },
                    "round",
                    `Cancelled round ${round.number}; no balances were changed.`,
                    round.id,
                  )
                )
                  setCancel(false);
              }}
            >
              Cancel round
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function RoundSetup({
  g,
  round,
  change,
  editable,
}: {
  g: Gathering;
  round: Round;
  change: Change;
  editable: boolean;
}) {
  const [draft, setDraft] = useState<Round>(structuredClone(round));
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [cancel, setCancel] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [priceInput, setPriceInput] = useState(String(round.ticketPrice / 100));
  const [valueInputs, setValueInputs] = useState<Record<string, string>>(
    Object.fromEntries(round.prizes.map((p) => [p.id, String(p.value / 100)])),
  );
  // Read-only tabs follow saved draft changes. The editor keeps its local unsaved form.
  useEffect(() => {
    if (!dirty) {
      setDraft(structuredClone(round));
      setPriceInput(String(round.ticketPrice / 100));
      setValueInputs(
        Object.fromEntries(
          round.prizes.map((p) => [p.id, String(p.value / 100)]),
        ),
      );
    }
  }, [round, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const links = (e: MouseEvent) => {
      const a = (e.target as Element).closest("a");
      if (
        a &&
        a.getAttribute("href")?.startsWith("#") &&
        !window.confirm(
          "You have unsaved round settings. Leave without saving?",
        )
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", links, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", links, true);
    };
  }, [dirty]);
  function update(fn: (d: Round) => void) {
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
    setDirty(true);
    setError("");
  }
  const total = pool(draft),
    allocated = draft.prizes.reduce((a, p) => a + p.value, 0);
  const remainder = (draft.mode === "percent" ? 10_000 : total) - allocated;
  const budgetError = (() => {
    try {
      validateBudget(draft);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  })();
  function materialize(): Round {
    const d = structuredClone(draft);
    d.ticketPrice = parseMoney(priceInput);
    d.prizes = d.prizes.map((p) => ({
      ...p,
      name: p.name.trim(),
      value: parseMoney(valueInputs[p.id] ?? String(p.value / 100)),
    }));
    return d;
  }
  async function save(start: boolean) {
    try {
      const d = materialize();
      if (start) {
        validateBudget(d);
        d.status = "playing";
      }
      if (
        await change(
          (s) => {
            s.rounds[s.rounds.findIndex((r) => r.id === round.id)] = d;
          },
          "round",
          `Round ${round.number}: ${start ? "started" : "saved draft"} with ${Object.values(d.tickets).reduce((a, n) => a + n, 0)} tickets at ${rupees(d.ticketPrice)}; pool ${rupees(pool(d))}. Tickets: ${
            g.players
              .filter((p) => d.tickets[p.id] > 0)
              .map((p) => `${p.name} × ${d.tickets[p.id]}`)
              .join(", ") || "none"
          }. Prizes: ${d.prizes.map((p) => `${p.name} ${d.mode === "percent" ? `${p.value / 100}%` : rupees(p.value)}`).join(", ")}.`,
          round.id,
        )
      )
        setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="round-toolbar">
        <div>
          <p className="eyebrow">SET THE STAGE</p>
          <h2>
            Round {round.number}
            <span className="badge orange">
              Draft{dirty ? " · Unsaved" : ""}
            </span>
          </h2>
        </div>
        <button
          className="text-button muted"
          disabled={!editable}
          onClick={() => setCancel(true)}
        >
          Discard round
        </button>
      </div>
      <nav className="setup-steps" aria-label="Round setup steps">
        {["Tickets", "Prizes", "Review"].map((label, i) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={step === i ? "step" : undefined}
            className={step === i ? "active" : step > i ? "done" : ""}
            onClick={() => {
              setStep(i);
              window.scrollTo(0, 0);
            }}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className={`setup-layout setup-step-${step}`}>
        <div>
          <section className="panel setup-panel tickets-step">
            <div className="panel-heading">
              <div>
                <h2>
                  <span className="step-number">1</span> Tickets, please
                </h2>
                <p>Choose who’s playing and how many tickets they’re taking.</p>
              </div>
              <Ticket size={23} className="muted" />
            </div>
            <fieldset disabled={!editable}>
              <label className="ticket-price-label">
                Price per ticket
                <div className="input-affix">
                  <span>₹</span>
                  <input
                    aria-label="Price per ticket"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000000"
                    value={priceInput}
                    onChange={(e) => {
                      setPriceInput(e.target.value);
                      update((d) => {
                        try {
                          d.ticketPrice = parseMoney(e.target.value);
                        } catch {
                          d.ticketPrice = 0;
                        }
                      });
                    }}
                  />
                </div>
              </label>
              <div className="quantity-list">
                {g.players
                  .filter((p) => p.active || (draft.tickets[p.id] || 0) > 0)
                  .map((p, i) => (
                    <div className="quantity-row" key={p.id}>
                      <Avatar name={p.name} index={i} small />
                      <strong>
                        {p.name}
                        {!p.active && <small> · sitting out next round</small>}
                      </strong>
                      <div className="stepper">
                        <button
                          type="button"
                          aria-label={`Remove a ticket for ${p.name}`}
                          disabled={!draft.tickets[p.id]}
                          onClick={() =>
                            update((d) => {
                              d.tickets[p.id] = Math.max(
                                0,
                                (d.tickets[p.id] || 0) - 1,
                              );
                            })
                          }
                        >
                          −
                        </button>
                        <input
                          aria-label={`Tickets for ${p.name}`}
                          type="number"
                          min="0"
                          max="10000"
                          value={draft.tickets[p.id] || 0}
                          onChange={(e) =>
                            update((d) => {
                              d.tickets[p.id] = Math.max(
                                0,
                                Math.min(
                                  10000,
                                  Math.floor(Number(e.target.value)),
                                ),
                              );
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Add a ticket for ${p.name}`}
                          disabled={draft.tickets[p.id] >= 10000}
                          onClick={() =>
                            update((d) => {
                              d.tickets[p.id] = (d.tickets[p.id] || 0) + 1;
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                      <span className="quantity-cost">
                        {rupees((draft.tickets[p.id] || 0) * draft.ticketPrice)}
                      </span>
                    </div>
                  ))}
              </div>
            </fieldset>
          </section>
          <section className="panel setup-panel prizes-step">
            <div className="panel-heading">
              <div>
                <h2>
                  <span className="step-number">2</span> Your house, your prizes
                </h2>
                <p>Keep the classics or make up your own.</p>
              </div>
              <Trophy size={23} className="muted" />
            </div>
            <fieldset disabled={!editable}>
              <div className="prize-mode">
                <span>Set prizes as</span>
                <div className="segmented">
                  {[
                    ["percent", "Percentages"],
                    ["amount", "₹ Amounts"],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={draft.mode === value ? "active" : ""}
                      aria-pressed={draft.mode === value}
                      onClick={() => {
                        const computed = prizeAmounts(draft);
                        const newValues: Record<string, string> = {};
                        update((d) => {
                          d.mode = value as Round["mode"];
                          d.prizes.forEach((p) => {
                            p.value =
                              value === "amount" ? computed[p.id] || 0 : 0;
                            newValues[p.id] = String(p.value / 100);
                          });
                        });
                        setValueInputs(newValues);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="prize-input-list">
                {draft.prizes.map((p, i) => (
                  <div className="prize-setup-item" key={p.id}>
                    <div className="prize-input-row">
                      <span className="prize-input-icon">
                        <Gift size={17} />
                      </span>
                      <input
                        aria-label={`Prize ${i + 1} name`}
                        value={p.name}
                        maxLength={80}
                        onChange={(e) =>
                          update((d) => {
                            d.prizes[i].name = e.target.value;
                          })
                        }
                        placeholder="Prize name"
                      />
                      <div className="input-affix prize-value">
                        <span>{draft.mode === "percent" ? "%" : "₹"}</span>
                        <input
                          aria-label={`Value for prize ${i + 1}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={draft.mode === "percent" ? 100 : 1000000000}
                          value={valueInputs[p.id] ?? String(p.value / 100)}
                          onChange={(e) => {
                            setValueInputs((v) => ({
                              ...v,
                              [p.id]: e.target.value,
                            }));
                            update((d) => {
                              try {
                                d.prizes[i].value = parseMoney(e.target.value);
                              } catch {
                                d.prizes[i].value = 0;
                              }
                            });
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${p.name || "prize"}`}
                        onClick={() =>
                          update((d) => {
                            d.prizes.splice(i, 1);
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="prize-presets">
                {["Corners", "Edges", "Early five", "Full house"]
                  .filter(
                    (n) =>
                      !draft.prizes.some(
                        (p) => p.name.toLowerCase() === n.toLowerCase(),
                      ),
                  )
                  .map((n) => (
                    <button
                      type="button"
                      className="preset-chip"
                      key={n}
                      onClick={() =>
                        update((d) => {
                          d.prizes.push({
                            id: uid(),
                            name: n,
                            value: 0,
                            winners: [],
                          });
                        })
                      }
                    >
                      <Plus size={12} />
                      {n}
                    </button>
                  ))}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    update((d) => {
                      d.prizes.push({
                        id: uid(),
                        name: "",
                        value: 0,
                        winners: [],
                      });
                    })
                  }
                >
                  <Plus size={15} /> Custom prize
                </button>
              </div>
              <div
                className={`allocation-note ${remainder === 0 && total > 0 ? "balanced" : ""}`}
              >
                <span>
                  {remainder === 0 && total > 0 ? (
                    <CheckCheck size={17} />
                  ) : (
                    <Coins size={17} />
                  )}
                  {remainder === 0
                    ? "Every bit of the pool has a home."
                    : remainder > 0
                      ? `${draft.mode === "percent" ? `${remainder / 100}%` : rupees(remainder)} left to allocate`
                      : `${draft.mode === "percent" ? `${-remainder / 100}%` : rupees(-remainder)} over the pool`}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={!draft.prizes.length || total <= 0}
                  onClick={() => {
                    const i = draft.prizes.length - 1;
                    const last = Math.max(0, draft.prizes[i].value + remainder);
                    setValueInputs((v) => ({
                      ...v,
                      [draft.prizes[i].id]: String(last / 100),
                    }));
                    update((d) => {
                      d.prizes[i].value = last;
                    });
                  }}
                >
                  Balance last prize
                </button>
              </div>
            </fieldset>
          </section>
          <section className="panel caller-choice">
            <div className="stat-icon mint">
              <Dices size={22} />
            </div>
            <div>
              <h3>A caller, if you need one.</h3>
              <p>Draw from 1–90 and keep a called-number board.</p>
            </div>
            <label className="toggle">
              <input
                aria-label="Enable number caller"
                type="checkbox"
                checked={draft.caller}
                disabled={!editable}
                onChange={(e) =>
                  update((d) => {
                    d.caller = e.target.checked;
                  })
                }
              />
              <span />
            </label>
          </section>
        </div>
        <aside>
          <section className="setup-summary">
            <span className="eyebrow">ROUND {round.number} AT A GLANCE</span>
            <div className="pool-big">{rupees(total)}</div>
            <p>in the prize pool</p>
            <div className="summary-line">
              <span>Players joining</span>
              <strong>
                {Object.values(draft.tickets).filter((n) => n > 0).length}
              </strong>
            </div>
            <div className="summary-line">
              <span>Tickets in play</span>
              <strong>
                {Object.values(draft.tickets).reduce((a, n) => a + n, 0)}
              </strong>
            </div>
            <div className="summary-line">
              <span>Prizes to win</span>
              <strong>{draft.prizes.length}</strong>
            </div>
            <div className="summary-prizes">
              {draft.prizes.map((p) => (
                <div key={p.id}>
                  <span>{p.name || "Custom prize"}</span>
                  <strong>{rupees(prizeAmounts(draft)[p.id] || 0)}</strong>
                </div>
              ))}
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {budgetError && <p className="budget-hint">{budgetError}</p>}
            <p className="summary-hint">
              <LockKeyhole size={13} /> Ticket counts and prize values lock when
              the round starts.
            </p>
          </section>
        </aside>
      </div>
      <div className="setup-actions">
        {" "}
        {step === 2 ? (
          <button
            className="button primary full"
            disabled={
              !editable ||
              !!budgetError ||
              draft.prizes.some((p) => !p.name.trim())
            }
            onClick={() => void save(true)}
          >
            Let’s play <ArrowRight size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            disabled={
              !editable ||
              (step === 0
                ? total <= 0 || draft.ticketPrice <= 0
                : !!budgetError || draft.prizes.some((p) => !p.name.trim()))
            }
            onClick={() => {
              setStep(step + 1);
              window.scrollTo(0, 0);
            }}
          >
            {step === 0 ? "Next: prizes" : "Review round"}
            <ArrowRight size={18} />
          </button>
        )}
        <button
          className="button ghost full"
          disabled={!editable}
          onClick={() => void save(false)}
        >
          <span>Save draft for later</span>
        </button>
      </div>
      {error && step !== 2 && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {cancel && (
        <Modal
          title="Discard this round?"
          description="The draft will stay in your history as cancelled. Everyone’s dues stay the same."
          close={() => setCancel(false)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setCancel(false)}
            >
              Keep setting up
            </button>
            <button
              className="button danger"
              disabled={!editable}
              onClick={async () => {
                if (
                  await change(
                    (s) => {
                      s.rounds.find((r) => r.id === round.id)!.status =
                        "cancelled";
                    },
                    "round",
                    `Discarded draft round ${round.number}.`,
                    round.id,
                  )
                ) {
                  setDirty(false);
                  setCancel(false);
                }
              }}
            >
              Discard round
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function AwardModal({
  g,
  round,
  prize,
  change,
  editable,
  close,
  act,
}: {
  g: Gathering;
  round: Round;
  prize: Prize;
  change: Change;
  editable: boolean;
  close: () => void;
  act: Act;
}) {
  const [mode, setMode] = useState<"manual" | "digital">("manual");
  const [counts, setCounts] = useState<Record<string, number>>(
    Object.fromEntries(prize.winners.map((w) => [w.playerId, w.tickets])),
  );
  const winners = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([playerId, tickets]) => {
      const previous = prize.winners.find((w) => w.playerId === playerId);
      return {
        playerId,
        tickets,
        ...(previous?.ticketId && previous.tickets === tickets
          ? { ticketId: previous.ticketId }
          : {}),
        ...(previous?.verification && previous.tickets === tickets
          ? { verification: previous.verification }
          : {}),
      };
    });
  const shares = winners.length
    ? prizeShares(round, { ...prize, winners })
    : {};
  async function save(e: FormEvent) {
    e.preventDefault();
    const old = prize.winners
      .map(
        (w) =>
          `${g.players.find((p) => p.id === w.playerId)?.name} (${w.tickets})`,
      )
      .join(", ");
    const result = winners
      .map(
        (w) =>
          `${g.players.find((p) => p.id === w.playerId)?.name} (${w.tickets} ticket${w.tickets === 1 ? "" : "s"}, ${rupees(shares[w.playerId])})`,
      )
      .join(", ");
    if (
      await change(
        (s) => {
          s.rounds
            .find((r) => r.id === round.id)!
            .prizes.find((p) => p.id === prize.id)!.winners = winners;
        },
        "award",
        `${round.status === "completed" ? "Corrected" : old ? "Updated" : "Awarded"} ${prize.name} in round ${round.number}: ${result || "cleared winners"}${old ? `. Previously: ${old}` : ""}. Host manually checked the claim.`,
        round.id,
      )
    )
      close();
  }
  return (
    <Modal
      title={`${prize.winners.length ? "Edit" : "Who won"} ${prize.name}${prize.winners.length ? "" : "?"}`}
      description={`${rupees(prizeAmounts(round)[prize.id])} to share. Choose winners and the number of winning tickets each holds.`}
      close={close}
    >
      <div className="segmented award-mode">
        <button
          type="button"
          aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}
        >
          Manual award
        </button>
        <button
          type="button"
          aria-pressed={mode === "digital"}
          onClick={() => setMode("digital")}
        >
          Check digital ticket
        </button>
      </div>
      {mode === "digital" ? (
        <DigitalClaimPanel
          g={g}
          round={round}
          prize={prize}
          editable={editable}
          act={act}
          close={close}
        />
      ) : (
        <form onSubmit={save}>
          <div className="award-players">
            {g.players
              .filter((p) => round.tickets[p.id] > 0)
              .map((p, i) => (
                <div
                  className={`award-player ${counts[p.id] ? "chosen" : ""}`}
                  key={p.id}
                >
                  <label className="winner-label">
                    <input
                      type="checkbox"
                      checked={!!counts[p.id]}
                      disabled={!editable}
                      onChange={(e) =>
                        setCounts((c) => ({
                          ...c,
                          [p.id]: e.target.checked ? 1 : 0,
                        }))
                      }
                    />
                    <Avatar name={p.name} index={i} small />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {round.tickets[p.id]} bought ·{" "}
                        {counts[p.id]
                          ? rupees(shares[p.id] || 0)
                          : "Not selected"}
                      </small>
                    </span>
                  </label>
                  {counts[p.id] > 0 && (
                    <label className="winning-count">
                      Winning tickets
                      <input
                        type="number"
                        min="1"
                        max={round.tickets[p.id]}
                        value={counts[p.id]}
                        required
                        disabled={!editable}
                        onChange={(e) =>
                          setCounts((c) => ({
                            ...c,
                            [p.id]: Math.max(
                              1,
                              Math.min(
                                round.tickets[p.id],
                                Math.floor(Number(e.target.value)),
                              ),
                            ),
                          }))
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
          </div>
          <p className="form-hint">
            A tie? Each winning ticket gets an equal share. You check physical
            claims.
          </p>
          {round.status === "completed" && (
            <p className="info-box">
              <History size={17} /> This correction updates dues. Recorded
              payments stay unchanged.
            </p>
          )}
          <button
            className="button primary full"
            disabled={
              !editable || (round.status === "completed" && !winners.length)
            }
          >
            <Check size={17} />{" "}
            {winners.length ? "Save winners" : "Clear winners"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function Caller({
  round,
  change,
  editable,
}: {
  round: Round;
  change: Change;
  editable: boolean;
}) {
  const latest = round.called.at(-1);
  const [manual, setManual] = useState(false);
  async function draw(number?: number) {
    await change(
      (s) => {
        const r = s.rounds.find((r) => r.id === round.id)!;
        r.called.push(nextCalled(r.called, number));
      },
      "caller",
      (s) =>
        `Round ${round.number}: ${number ? "manually marked" : "called"} ${s.rounds.find((r) => r.id === round.id)!.called.at(-1)}.`,
      round.id,
    );
  }
  return (
    <section className="panel caller-panel">
      <div className="panel-heading">
        <div>
          <h2>A little luck, on tap</h2>
          <p>Your 1–90 number caller.</p>
        </div>
        <span className="badge neutral">{round.called.length} / 90</span>
      </div>
      <div className="caller-stage">
        <span className="eyebrow">
          {latest ? "THE LATEST NUMBER" : "READY WHEN YOU ARE"}
        </span>
        <div
          className={`number-ball ${latest ? "has-number" : ""}`}
          key={latest || "empty"}
          role="status"
          aria-live="polite"
          aria-label={latest ? `Latest number ${latest}` : "No numbers called"}
        >
          {latest || <Sparkles size={45} strokeWidth={1.5} />}
        </div>
        <button
          className="button dark"
          disabled={!editable || round.called.length === 90}
          onClick={() => void draw()}
        >
          <Dices size={18} />
          {round.called.length === 90
            ? "All numbers called"
            : latest
              ? "Call next number"
              : "Call first number"}
        </button>
        <div className="caller-links">
          <button
            disabled={!editable || !round.called.length}
            onClick={() =>
              void change(
                (s) => {
                  s.rounds.find((r) => r.id === round.id)!.called.pop();
                },
                "caller",
                `Round ${round.number}: undid the call for ${latest}.`,
                round.id,
              )
            }
          >
            <RotateCcw size={13} /> Undo last
          </button>
          <span>·</span>
          <button
            className={manual ? "on" : ""}
            aria-pressed={manual}
            disabled={!editable}
            onClick={() => setManual(!manual)}
          >
            {manual ? <Check size={13} /> : <Pencil size={12} />} Manual marking{" "}
            {manual ? "on" : ""}
          </button>
        </div>
      </div>
      <div className="board-heading">
        <strong>THE NUMBER BOARD</strong>
        <span>{90 - round.called.length} left to call</span>
      </div>
      {manual && (
        <p className="manual-note">Tap an uncalled number below to mark it.</p>
      )}
      <div
        className={`number-board ${manual ? "manual" : ""}`}
        role="group"
        aria-label="Numbers 1 to 90"
      >
        {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={`${round.called.includes(n) ? "called" : ""} ${latest === n ? "latest" : ""}`}
            disabled={!manual || !editable || round.called.includes(n)}
            aria-label={`Number ${n}${round.called.includes(n) ? ", called" : ", not called"}`}
            onClick={() => void draw(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <details className="call-history">
        <summary>
          Call order <span>{round.called.length} numbers</span>
        </summary>
        <p>
          {round.called.length
            ? round.called.map((n, i) => (
                <span key={n}>
                  <small>{i + 1}.</small> {n}
                </span>
              ))
            : "The first number is waiting for you."}
        </p>
      </details>
    </section>
  );
}

function DuesView({
  g,
  change,
  editable,
  act,
}: {
  g: Gathering;
  change: Change;
  editable: boolean;
  act: Act;
}) {
  const transfers = settlements(g),
    values = balances(g);
  const [payment, setPayment] = useState<Transfer | null>(null);
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);
  const pending = transfers.reduce((a, p) => a + p.amount, 0);
  const active = g.rounds.find((r) => r.status === "playing");
  const paid = g.payments
    .filter((p) => !p.reversedAt)
    .reduce((a, p) => a + p.amount, 0);
  const name = (id: string) => g.players.find((p) => p.id === id)!.name;
  async function copy() {
    const text = `${g.name} — Housie Baaki\n${roundTotal(g)} completed rounds\n\n${transfers.length ? transfers.map((p) => `${name(p.from)} pays ${name(p.to)} ${rupees(p.amount)}`).join("\n") : "All squared up!"}${active ? `\n\nRound ${active.number} is still in progress and excluded.` : ""}`;
    await act(
      () => navigator.clipboard.writeText(text),
      "Settlement summary copied.",
    );
  }
  return (
    <>
      <div className="section-heading dues-heading">
        <div>
          <p className="eyebrow">NO AWKWARD MATHS</p>
          <h2>Time to square up.</h2>
          <p className="muted">
            Based on {roundTotal(g)} completed round
            {roundTotal(g) === 1 ? "" : "s"}. Every paise accounted for.
          </p>
        </div>
        <button className="button secondary" onClick={() => void copy()}>
          <Upload size={16} /> Copy summary
        </button>
      </div>
      {active && (
        <div className="notice">
          <Clock3 size={18} />
          <span>
            Round {active.number} is still playing. Its {rupees(pool(active))}{" "}
            pool is provisional and excluded from these payments.{" "}
            <a href={`#${roundLink(g, active)}`}>
              View active round <ArrowRight size={13} />
            </a>
          </span>
        </div>
      )}
      <div className="dues-stats">
        <div>
          <span className="stat-icon peach">
            <Wallet size={22} />
          </span>
          <section>
            <small>LEFT TO SETTLE</small>
            <strong>{rupees(pending)}</strong>
          </section>
        </div>
        <div>
          <span className="stat-icon mint">
            <CheckCheck size={22} />
          </span>
          <section>
            <small>PAYMENTS RECORDED</small>
            <strong>{rupees(paid)}</strong>
          </section>
        </div>
        <div>
          <span className="stat-icon lilac">
            <ArrowRight size={22} />
          </span>
          <section>
            <small>SUGGESTED TRANSFERS</small>
            <strong>{transfers.length}</strong>
          </section>
        </div>
      </div>
      <div className="dues-layout">
        <div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {transfers.length
                    ? "A little this way, a little that way."
                    : "All squared up."}
                </h2>
                <p>
                  {transfers.length
                    ? "These transfers clear the outstanding balances."
                    : "Good games. Clear accounts."}
                </p>
              </div>
              <Coins className="muted" size={22} />
            </div>
            {transfers.length ? (
              <div className="transfer-list">
                {transfers.map((p, i) => (
                  <div className="transfer-row" key={`${p.from}-${p.to}`}>
                    <div className="transfer-people">
                      <Avatar
                        name={name(p.from)}
                        index={g.players.findIndex((x) => x.id === p.from)}
                        small
                      />
                      <div>
                        <strong>
                          {name(p.from)} <ArrowRight size={14} /> {name(p.to)}
                        </strong>
                        <small>pays directly · no middleman</small>
                      </div>
                    </div>
                    <strong className="transfer-amount">
                      {rupees(p.amount)}
                    </strong>
                    <button
                      className="button secondary"
                      disabled={!editable}
                      onClick={() => {
                        setPayment(p);
                        setAmount(String(p.amount / 100));
                      }}
                    >
                      <Check size={15} /> Record payment
                      <span className="sr-only"> {i + 1}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={<CheckCheck size={34} />}
                title={
                  roundTotal(g) ? "Nothing baaki. Nice." : "A clean slate."
                }
                text={
                  roundTotal(g)
                    ? "Everyone’s balances are settled. Time for chai — or one more round?"
                    : "Finish your first round to see who owes whom."
                }
              />
            )}
          </section>
          <section className="panel payments-panel">
            <div className="panel-heading">
              <div>
                <h2>The payment trail</h2>
                <p>Only mark a payment after the money has changed hands.</p>
              </div>
              <History size={20} className="muted" />
            </div>
            {g.payments.length ? (
              [...g.payments].reverse().map((p) => (
                <div
                  key={p.id}
                  className={`payment-row ${p.reversedAt ? "reversed" : ""}`}
                >
                  <span className="payment-check">
                    {p.reversedAt ? (
                      <RotateCcw size={17} />
                    ) : (
                      <Check size={17} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {name(p.from)} paid {name(p.to)}
                    </strong>
                    <small>
                      {date(p.createdAt)} · {time(p.createdAt)}
                      {p.reversedAt ? " · Reversed" : ""}
                    </small>
                  </div>
                  <strong>{rupees(p.amount)}</strong>
                  {!p.reversedAt && (
                    <button
                      className="icon-button"
                      disabled={!editable}
                      onClick={() => setReverse(p.id)}
                      aria-label={`Reverse payment from ${name(p.from)} to ${name(p.to)}`}
                    >
                      <RotateCcw size={16} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="panel-empty-text">
                No payments yet. Enjoy the game — settle when you’re ready.
              </p>
            )}
          </section>
        </div>
        <aside className="panel player-balances">
          <div className="panel-heading">
            <div>
              <h2>Everyone’s hisaab</h2>
              <p>Tap a player to see the details.</p>
            </div>
          </div>
          {g.players.map((p, i) => (
            <button
              className="balance-row"
              key={p.id}
              onClick={() => setDetail(p.id)}
            >
              <Avatar name={p.name} index={i} small />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {values[p.id] > 0
                    ? "gets back"
                    : values[p.id] < 0
                      ? "owes"
                      : "all square"}
                </small>
              </span>
              <strong className={values[p.id] > 0 ? "positive" : ""}>
                {rupees(Math.abs(values[p.id]))}
              </strong>
              <ChevronRight size={14} />
            </button>
          ))}
        </aside>
      </div>
      {payment && (
        <Modal
          title="A little less baaki."
          description={`${name(payment.from)} → ${name(payment.to)}`}
          close={() => setPayment(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              let value: number;
              try {
                value = parseMoney(amount);
                if (value <= 0 || value > payment.amount)
                  throw new Error(
                    "Enter a positive amount no higher than the suggested payment.",
                  );
              } catch (error) {
                await act(async () => {
                  throw error;
                });
                return;
              }
              const p = {
                id: uid(),
                from: payment.from,
                to: payment.to,
                amount: value,
                createdAt: Date.now(),
              };
              if (
                await change(
                  (s) => {
                    s.payments.push(p);
                  },
                  "payment",
                  `${name(p.from)} paid ${name(p.to)} ${rupees(value)}.`,
                )
              )
                setPayment(null);
            }}
          >
            <label>
              Amount actually paid
              <div className="input-affix">
                <span>₹</span>
                <input
                  autoFocus
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={payment.amount / 100}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </label>
            <p className="form-hint">
              Full or partial is fine. Remaining dues will recalculate.
            </p>
            <p className="info-box">
              <Wallet size={18} /> This records a transfer you made separately.
              The app does not move money.
            </p>
            <button className="button primary full" disabled={!editable}>
              <CheckCheck size={17} /> Confirm payment received
            </button>
          </form>
        </Modal>
      )}
      {reverse && (
        <Modal
          title="Undo this payment record?"
          description="The amount will return to the outstanding balances. The original payment stays in history as reversed."
          close={() => setReverse(null)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setReverse(null)}
            >
              Keep record
            </button>
            <button
              className="button danger"
              disabled={!editable}
              onClick={async () => {
                const p = g.payments.find((p) => p.id === reverse)!;
                if (
                  await change(
                    (s) => {
                      s.payments.find((x) => x.id === reverse)!.reversedAt =
                        Date.now();
                    },
                    "payment",
                    `Reversed payment: ${name(p.from)} to ${name(p.to)}, ${rupees(p.amount)}.`,
                  )
                )
                  setReverse(null);
              }}
            >
              Reverse payment
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          title={`${name(detail)}’s hisaab`}
          description="Winnings − tickets + sent payments − received payments"
          close={() => setDetail(null)}
        >
          <div className="breakdown-net">
            <span>
              {values[detail] > 0
                ? "Gets back"
                : values[detail] < 0
                  ? "Owes"
                  : "All square"}
            </span>
            <strong>{rupees(Math.abs(values[detail]))}</strong>
          </div>
          <div className="breakdown-entries">
            {playerEntries(g, detail).length ? (
              playerEntries(g, detail).map((e, i) => (
                <div key={i}>
                  <span>{e.label}</span>
                  <strong className={e.amount > 0 ? "positive" : ""}>
                    {e.amount > 0 ? "+" : "−"}
                    {rupees(Math.abs(e.amount))}
                  </strong>
                </div>
              ))
            ) : (
              <p className="muted">No completed-round activity yet.</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function ActivityView({ g }: { g: Gathering }) {
  const [filter, setFilter] = useState("all");
  const activities = useLiveQuery(
    () =>
      db.activities
        .where("gatheringId")
        .equals(g.id)
        .reverse()
        .sortBy("createdAt"),
    [g.id],
  );
  const filtered = activities?.filter(
    (a) => filter === "all" || a.kind === filter,
  );
  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div>
          <h2>The story of your evening</h2>
          <p>Tickets, little wins, settled scores. It’s all here.</p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter activities"
        >
          <option value="all">All activity</option>
          <option value="round">Rounds & tickets</option>
          <option value="award">Winners</option>
          <option value="payment">Payments</option>
          <option value="caller">Number calls</option>
          <option value="player">Players</option>
          <option value="gathering">Gathering</option>
        </select>
      </div>
      <div className="activity-list">
        {filtered?.length ? (
          filtered.map((a) => (
            <div className="activity-row" key={a.id}>
              <span className={`activity-icon ${a.kind}`}>
                {a.kind === "award" ? (
                  <Trophy size={17} />
                ) : a.kind === "payment" ? (
                  <Wallet size={17} />
                ) : a.kind === "player" ? (
                  <Users size={17} />
                ) : a.kind === "caller" ? (
                  <Dices size={17} />
                ) : (
                  <Ticket size={17} />
                )}
              </span>
              <div>
                <p>{a.message}</p>
                {a.verification && (
                  <details className="activity-verification">
                    <summary>
                      Historical automatic check · ticket #
                      {a.verification.ticketId} ·{" "}
                      {RULE_LABELS[a.verification.rule]}
                    </summary>
                    <p>
                      Automatically checked before the manual-claim update.
                      Called numbers at award:{" "}
                      {a.verification.called.join(", ")}
                    </p>
                  </details>
                )}
                <small>
                  {date(a.createdAt)} · {time(a.createdAt)}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="panel-empty-text">Nothing in this chapter yet.</p>
        )}
      </div>
    </section>
  );
}

function BackupView({ act, busy }: { act: Act; busy: boolean }) {
  const [backup, setBackup] = useState<Backup | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function download() {
    await act(async () => {
      const b = await exportBackup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `housie-baaki-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "Your backup is ready to download.");
  }
  async function read(file?: File) {
    if (!file) return;
    await act(async () => {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 20 MB.");
      try {
        setBackup(await validateBackupContents(JSON.parse(await file.text())));
      } catch {
        throw new Error(
          "This backup is invalid or unsupported. Your games have not been changed.",
        );
      }
    });
    if (input.current) input.current.value = "";
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KEEP THE GOOD TIMES SAFE</p>
          <h1>
            Your memories. <span className="serif-accent">Yours to keep.</span>
          </h1>
          <p className="subtitle">A little backup goes a long way.</p>
        </div>
      </div>
      <div className="backup-banner">
        <ShieldCheck size={28} />
        <div>
          <h2>Everything stays on this device.</h2>
          <p>
            Your games are saved in this browser. Export a backup before
            clearing browser data, changing browsers, or switching phones.
          </p>
        </div>
      </div>
      <div className="backup-grid">
        <section className="panel backup-card">
          <span className="backup-icon peach">
            <Download size={28} />
          </span>
          <h2>Take your table with you.</h2>
          <p>
            Download all gatherings, players, rounds, payments, activity, and
            saved digital tickets as one JSON file.
          </p>
          <button
            className="button primary"
            onClick={() => void download()}
            disabled={busy}
          >
            <Download size={17} /> Export backup
          </button>
        </section>
        <section className="panel backup-card">
          <span className="backup-icon mint">
            <Upload size={28} />
          </span>
          <h2>Pick up where you left off.</h2>
          <p>
            Restore a previously exported backup. You’ll review it before it
            replaces anything.
          </p>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose backup file"
            onChange={(e) => void read(e.target.files?.[0])}
          />
          <button
            className="button secondary"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <Upload size={17} /> Choose backup
          </button>
        </section>
      </div>
      <section className="install-guide panel">
        <Sparkles size={22} />
        <div>
          <h3>Make it feel right at home.</h3>
          <p>
            Install Housie Baaki from your browser’s app menu. On iPhone, use
            Safari’s Share → Add to Home Screen. Open the app online once to get
            ready for offline game nights.
          </p>
        </div>
      </section>
      {backup && (
        <Modal
          title="Bring back this table?"
          description={`Backup from ${date(backup.exportedAt)} · ${backup.gatherings.length} gatherings · ${backup.gatherings.reduce((a, g) => a + g.rounds.length, 0)} rounds · ${backup.playerTickets.length} saved tickets`}
          close={() => !busy && setBackup(null)}
        >
          <p className="info-box">
            <Archive size={19} /> This replaces all games currently on this
            device. Export your current data first if you want to keep it.
          </p>
          <p className="form-hint">
            Close any gathering open in another tab before restoring.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setBackup(null)}
            >
              Keep current games
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await navigator.locks.request(
                    "housie-storage",
                    { mode: "exclusive", ifAvailable: true },
                    async (lock) => {
                      if (!lock)
                        throw new Error(
                          "A gathering is open in another tab. Close that tab before restoring.",
                        );
                      await restoreBackup(backup);
                      setBackup(null);
                    },
                  );
                }, "Backup restored. Your table is back.")
              }
            >
              Replace & restore
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
