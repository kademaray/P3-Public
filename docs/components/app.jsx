/* global React */
const { useState, useEffect, useRef, useMemo } = React;

// ————————————————————————————————————————————————————————
// Mock data — mirrors the shapes I saw in the P3 repo
// ————————————————————————————————————————————————————————

const INITIAL_LEDGER = [
  { t: "06:42:11", kind: "ok",   msg: "Chat-0004  InternetSearch  complete",  ms: 4820 },
  { t: "06:41:47", kind: "ok",   msg: "Chat-0004  3-InvokeOrch    dispatched", ms: 210 },
  { t: "06:40:04", kind: "ok",   msg: "Daily snapshot  P3-Snapshot-20260424-064004.zip" },
  { t: "06:39:58", kind: "warn", msg: "Cerebras  rate-limited  fell back to Groq" },
  { t: "06:38:22", kind: "ok",   msg: "GV-Memory  6787758155.json  merged 3 entries" },
  { t: "06:37:10", kind: "ok",   msg: "Chat-0003  ReplyToSender   complete", ms: 910 },
  { t: "06:35:01", kind: "err",  msg: "Local gpt-oss-120b  timeout after 30s" },
  { t: "06:34:40", kind: "ok",   msg: "Tracker  Chat-0003  stage 3/5" },
  { t: "06:32:19", kind: "ok",   msg: "Packager  bundle  7 files  2.1 MB" },
  { t: "06:30:00", kind: "ok",   msg: "Heartbeat  OK  uptime 11d 04:12" },
];

const INITIAL_SESSIONS = [
  { id: "Chat-0004", topic: "Flight rebooking — LAX→JFK May 12", stage: "4/5", status: "active",  ago: "2m" },
  { id: "Chat-0003", topic: "Bill audit — Comcast, PG&E",         stage: "5/5", status: "done",    ago: "1h" },
  { id: "Chat-0002", topic: "Kyoto trip itinerary draft",         stage: "5/5", status: "done",    ago: "3h" },
  { id: "Chat-0001", topic: "Credit card dispute — $142.18",      stage: "3/5", status: "stalled", ago: "1d" },
  { id: "Chat-0020", topic: "Apartment lease renewal review",     stage: "5/5", status: "done",    ago: "2d" },
];

const TASKS = [
  { key: "Chat",        desc: "Full orchestrated chat session",   icon: "◆" },
  { key: "QuickChat",   desc: "One-shot prompt, no tracker",      icon: "›" },
  { key: "StageTester", desc: "Replay a single stage in isolation", icon: "◎" },
  { key: "Testing",     desc: "Run the test battery",             icon: "▥" },
  { key: "Utilities",   desc: "Housekeeping scripts",             icon: "⚙" },
];

const PROVIDERS = [
  { name: "Cerebras",   model: "llama-3.3-70b",      status: "primary" },
  { name: "Groq",       model: "llama-3.3-70b",      status: "fallback" },
  { name: "OpenRouter", model: "anthropic/sonnet-4", status: "available" },
  { name: "Gemini",     model: "gemini-2.5-pro",     status: "available" },
  { name: "Local",      model: "gpt-oss-120b",       status: "degraded" },
];

const LIFE_FEED = [
  { label: "Next trip",       value: "Kyoto",        sub: "in 18 days  ·  May 12 → May 21" },
  { label: "SFO weather",     value: "62° cloudy",   sub: "tomorrow  ·  high 64, low 54" },
  { label: "Bills due (7d)",  value: "$284.19",      sub: "Comcast $89  ·  PG&E $142  ·  Spotify $17" },
  { label: "Unread inbox",    value: "3 flagged",    sub: "1 urgent  ·  1 travel  ·  1 billing" },
];

const LLM_IO_SAMPLE = {
  session: "Chat-0004",
  stage:   "3-InternetSearch",
  provider:"Cerebras · llama-3.3-70b",
  started: "2026-04-24 06:41:47",
  elapsed: "4.82s",
  tokens:  { in: 3184, out: 412 },
  prompt: `You are P3's InternetSearch stage. You have been given the following tracker state and must emit a JSON action that either performs a search or marks the step complete.

Tracker:
  session:  Chat-0004
  goal:     Rebook flight LAX→JFK on May 12, aisle seat, under $420
  stage:    3 of 5
  prior:    ReadFile('0-Mock-Data.txt') → returned 4 fare options
  history:  [UserChain.json:2 messages]

User's latest message:
> "the 7am one is fine, go ahead — and see if you can get seat 14C"

Emit ONLY a JSON object matching the action schema in 0-Action-Menu.txt.`,
  response: `{
  "action": "InternetSearch",
  "query": "United UA1142 May 12 seat 14C availability",
  "rationale": "User confirmed 7am option and requested specific seat. Need live seat-map data before proceeding to 3-ExecuteCommand.",
  "next_stage": "3-ExecuteCommand",
  "tracker_update": {
    "selected_fare": "UA1142 07:05 LAX→JFK $389",
    "seat_request":  "14C"
  }
}`,
};

// ————————————————————————————————————————————————————————
// Small presentational helpers
// ————————————————————————————————————————————————————————

function Dot({ tone = "ok" }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true"></span>;
}

function Card({ title, subtitle, right, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-h">
        <div className="card-h-l">
          <h3 className="card-title">{title}</h3>
          {subtitle && <span className="card-sub">{subtitle}</span>}
        </div>
        {right && <div className="card-h-r">{right}</div>}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Pill({ tone = "neutral", children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

// ————————————————————————————————————————————————————————
// Ticker — updates the "ago" and heartbeat
// ————————————————————————————————————————————————————————

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function fmtTime(d) {
  return d.toTimeString().slice(0, 8);
}

// ————————————————————————————————————————————————————————
// Submission state machine
// ————————————————————————————————————————————————————————
// idle → staged (committing to inbox.txt)
//      → polled (P3 picked it up)
//      → running (stage 1..N)
//      → done (response written back)

const PIPELINE = [
  { key: "stage-commit",  label: "git commit  inbox.txt",              dur: 900  },
  { key: "stage-poll",    label: "P3 repo poll  (every 15s)",          dur: 1600 },
  { key: "stage-read",    label: "3-ReadFile    inbox.txt",            dur: 1100 },
  { key: "stage-invoke",  label: "3-InvokeOrch  Chat-0005",            dur: 1800 },
  { key: "stage-search",  label: "3-InternetSearch  context gather",   dur: 2600 },
  { key: "stage-edit",    label: "3-EditFile    outbox.md",            dur: 1400 },
  { key: "stage-commit2", label: "git push      outbox.md",            dur: 900  },
  { key: "stage-ui",      label: "browser poll  detected change",      dur: 1100 },
];

function useSubmissionMachine() {
  const [state, setState] = useState({ phase: "idle", stageIdx: -1, prompt: "", response: null, startedAt: null });
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const submit = (prompt) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const startedAt = new Date();
    setState({ phase: "running", stageIdx: 0, prompt, response: null, startedAt });

    let acc = 0;
    PIPELINE.forEach((s, i) => {
      acc += s.dur;
      const t = setTimeout(() => {
        if (i < PIPELINE.length - 1) {
          setState(prev => ({ ...prev, stageIdx: i + 1 }));
        } else {
          setState(prev => ({
            ...prev,
            phase: "done",
            stageIdx: PIPELINE.length,
            response: generateResponse(prompt),
          }));
        }
      }, acc);
      timers.current.push(t);
    });
  };

  const cancel = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState(s => ({ ...s, phase: "idle", stageIdx: -1 }));
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState({ phase: "idle", stageIdx: -1, prompt: "", response: null, startedAt: null });
  };

  return { state, submit, cancel, reset };
}

function generateResponse(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes("trip") || p.includes("flight") || p.includes("kyoto"))
    return `Pulled your Kyoto itinerary (May 12–21). Booked seat 14C on UA1142, added JR Pass reminder to tracker, flagged $89 Comcast bill due May 11 so it won't autopay while you're away. Wrote updates to Chat-0005/outbox.md and appended to GV-Memory.`;
  if (p.includes("bill") || p.includes("comcast") || p.includes("pg&e"))
    return `Audited 3 bills: Comcast $89 (expected), PG&E $142.19 (up 18% vs last month — weather driven, confirmed), Spotify $17 (canceled duplicate family plan, saving $17/mo). Draft dispute letter staged in Chat-0005/outbox.md.`;
  return `Processed. Wrote response to Chat-0005/outbox.md and updated tracker. Stage 5/5 complete, 1.42k tokens in / 310 out, Cerebras primary. Ledger appended. Snapshot scheduled for 07:00.`;
}

// ————————————————————————————————————————————————————————
// Top bar / header
// ————————————————————————————————————————————————————————

function TopBar({ repoStatus, now }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M8 17V7h4.5a3 3 0 1 1 0 6H8"/>
          </svg>
        </span>
        <div className="brand-text">
          <span className="brand-name">P3</span>
          <span className="brand-sub">personal pipeline processor</span>
        </div>
      </div>
      <nav className="topnav">
        <a className="on" href="#">Dashboard</a>
        <a href="#">Sessions</a>
        <a href="#">Ledger</a>
        <a href="#">Config</a>
      </nav>
      <div className="topright">
        <span className="repo">
          <Dot tone={repoStatus === "ok" ? "ok" : "warn"} />
          <span className="mono">kademaray/P3-Public</span>
          <span className="muted">·</span>
          <span className="muted mono">main</span>
        </span>
        <span className="clock mono">{fmtTime(now)}</span>
      </div>
    </header>
  );
}

// ————————————————————————————————————————————————————————
// Composer (input)
// ————————————————————————————————————————————————————————

function Composer({ machine, onOpenIO }) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState("Chat"); // Chat | QuickChat
  const ta = useRef(null);

  const canSend = value.trim().length > 0 && machine.state.phase !== "running";

  const handleSend = () => {
    if (!canSend) return;
    machine.submit(value.trim());
    setValue("");
  };

  const handleKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSend(); }
  };

  const running  = machine.state.phase === "running";
  const done     = machine.state.phase === "done";
  const activeIx = machine.state.stageIdx;

  return (
    <section className="composer">
      <div className="composer-head">
        <div className="composer-tabs">
          {["Chat", "QuickChat"].map(m => (
            <button key={m}
              className={`tab ${mode === m ? "on" : ""}`}
              onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="composer-meta mono">
          <span>writes → <span className="hl">0-Chat-Sessions/inbox.txt</span></span>
          <span className="muted">·</span>
          <span>polls ← <span className="hl">outbox.md</span></span>
        </div>
      </div>

      <div className={`composer-body ${running ? "is-running" : ""}`}>
        <textarea
          ref={ta}
          placeholder={mode === "Chat"
            ? "Tell P3 what to do — e.g. 'rebook my May 12 flight, aisle under $420' or 'audit this month's bills'…"
            : "One-shot prompt (no tracker, no history)…"}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          disabled={running}
        />
        <div className="composer-foot">
          <div className="composer-hints mono">
            <kbd>⌘</kbd><kbd>↵</kbd> <span className="muted">send</span>
            <span className="muted">·</span>
            <span className="muted">commit→push→poll takes ~20s before P3 picks up</span>
          </div>
          <div className="composer-actions">
            {running && (
              <button className="btn btn-ghost" onClick={machine.cancel}>Cancel</button>
            )}
            {done && (
              <>
                <button className="btn btn-ghost" onClick={() => onOpenIO()}>View I/O</button>
                <button className="btn btn-ghost" onClick={machine.reset}>New prompt</button>
              </>
            )}
            <button className="btn btn-primary" disabled={!canSend} onClick={handleSend}>
              {running ? "P3 is working…" : "Send to P3"}
            </button>
          </div>
        </div>
      </div>

      {(running || done) && (
        <div className="pipeline">
          {PIPELINE.map((s, i) => {
            const state = i < activeIx ? "done" : i === activeIx ? "active" : "pending";
            return (
              <div key={s.key} className={`pl-step pl-${state}`}>
                <span className="pl-bullet" aria-hidden="true">
                  {state === "done"   && "✓"}
                  {state === "active" && <span className="pl-spin" />}
                  {state === "pending"&& "·"}
                </span>
                <span className="pl-label mono">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {done && (
        <div className="response mono">
          <div className="response-h">
            <span className="hl">outbox.md</span>
            <span className="muted">·</span>
            <span className="muted">Chat-0005</span>
            <span className="muted">·</span>
            <span className="muted">just now</span>
          </div>
          <div className="response-body">{machine.state.response}</div>
        </div>
      )}
    </section>
  );
}

// ————————————————————————————————————————————————————————
// Dashboard cards
// ————————————————————————————————————————————————————————

function LastRunCard({ machine, onReRun, onOpenIO, onReplay }) {
  const { phase } = machine.state;
  const running = phase === "running";
  const status  = running ? "running" : phase === "done" ? "success" : "success";
  const label   = running ? "running" : "success";
  return (
    <Card
      title="Last run"
      right={<Pill tone={status === "success" ? "ok" : status === "running" ? "info" : "err"}>{label}</Pill>}
    >
      <div className="lastrun">
        <div className="lastrun-id mono">
          <span className="muted">session</span> <span className="hl">{running ? "Chat-0005" : "Chat-0004"}</span>
        </div>
        <div className="lastrun-goal">
          {running ? machine.state.prompt : "Rebook flight LAX→JFK on May 12, aisle seat, under $420"}
        </div>
        <dl className="kv mono">
          <div><dt>stage</dt><dd>{running ? `${Math.min(machine.state.stageIdx + 1, PIPELINE.length)}/${PIPELINE.length}` : "5/5"}</dd></div>
          <div><dt>provider</dt><dd>Cerebras · llama-3.3-70b</dd></div>
          <div><dt>tokens</dt><dd>3,184 in · 412 out</dd></div>
          <div><dt>elapsed</dt><dd>{running ? "…" : "4.82s"}</dd></div>
        </dl>
        <div className="lastrun-actions">
          <button className="btn btn-ghost btn-sm" onClick={onOpenIO}>View LLM I/O</button>
          <button className="btn btn-ghost btn-sm" onClick={onReplay}>Replay from step…</button>
          <button className="btn btn-ghost btn-sm" onClick={onReRun}>Re-run w/ provider…</button>
        </div>
      </div>
    </Card>
  );
}

function StageCard({ machine }) {
  const running = machine.state.phase === "running";
  const idx = running ? machine.state.stageIdx : PIPELINE.length - 1;
  const current = PIPELINE[Math.min(idx, PIPELINE.length - 1)];
  const pct = running ? ((idx) / PIPELINE.length) * 100 : 100;
  return (
    <Card title="Current stage" subtitle={running ? "in-flight" : "idle"}>
      <div className="stage">
        <div className="stage-name mono">{current.label}</div>
        <div className="stage-bar">
          <div className="stage-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="stage-meta mono">
          <span>step <span className="hl">{Math.min(idx + 1, PIPELINE.length)}</span> / {PIPELINE.length}</span>
          <span className="muted">·</span>
          <span>{running ? "elapsed 00:04" : "last complete 06:41:47"}</span>
        </div>
      </div>
    </Card>
  );
}

function SessionsCard({ sessions, onOpenTracker }) {
  return (
    <Card title="Recent sessions" subtitle={`${sessions.length} tracked`}>
      <ul className="sessions">
        {sessions.map(s => (
          <li key={s.id} className="sess">
            <div className="sess-l">
              <Dot tone={s.status === "active" ? "info" : s.status === "stalled" ? "warn" : "ok"} />
              <div>
                <div className="sess-id mono">{s.id}</div>
                <div className="sess-topic">{s.topic}</div>
              </div>
            </div>
            <div className="sess-r mono">
              <span>{s.stage}</span>
              <span className="muted">·</span>
              <span className="muted">{s.ago}</span>
              <button className="icon-btn" title="Open tracker" onClick={() => onOpenTracker(s)}>→</button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProvidersCard() {
  const tones = { primary: "ok", fallback: "info", available: "neutral", degraded: "warn" };
  return (
    <Card title="Providers" subtitle="llm-config · 5 configured">
      <ul className="providers">
        {PROVIDERS.map(p => (
          <li key={p.name} className="prov">
            <span className="prov-name">{p.name}</span>
            <span className="prov-model mono">{p.model}</span>
            <Pill tone={tones[p.status]}>{p.status}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LedgerCard() {
  return (
    <Card title="Ledger" subtitle="tail  ·  last 10" right={<button className="icon-btn">⟳</button>}>
      <ul className="ledger mono">
        {INITIAL_LEDGER.map((l, i) => (
          <li key={i} className={`ledg ledg-${l.kind}`}>
            <span className="ledg-t">{l.t}</span>
            <span className="ledg-dot" aria-hidden="true">{l.kind === "ok" ? "✓" : l.kind === "warn" ? "!" : "✗"}</span>
            <span className="ledg-msg">{l.msg}</span>
            {l.ms != null && <span className="ledg-ms muted">{l.ms}ms</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HealthCard() {
  const [hb, setHb] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHb(h => h + 1), 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <Card title="System health" right={<Pill tone="ok">online</Pill>}>
      <div className="health">
        <dl className="kv mono">
          <div><dt>uptime</dt><dd>11d 04:12</dd></div>
          <div><dt>last heartbeat</dt><dd>{hb % 2 === 0 ? "just now" : "1s ago"}</dd></div>
          <div><dt>snapshot</dt><dd>06:40:04 · 14.2 MB</dd></div>
          <div><dt>disk</dt><dd>2.1 GB logs · 48 sessions</dd></div>
        </dl>
        <div className="spark">
          <svg viewBox="0 0 120 28" preserveAspectRatio="none">
            <polyline
              fill="none" stroke="currentColor" strokeWidth="1.25"
              points="0,20 10,18 20,21 30,14 40,16 50,10 60,12 70,8 80,11 90,6 100,9 110,5 120,7"
            />
          </svg>
          <span className="mono muted spark-l">24h latency · p50 1.9s</span>
        </div>
      </div>
    </Card>
  );
}

function LifeCard() {
  return (
    <Card title="Life feed" subtitle="from GV-Memory · auto">
      <ul className="life">
        {LIFE_FEED.map(l => (
          <li key={l.label}>
            <div className="life-label mono muted">{l.label}</div>
            <div className="life-value">{l.value}</div>
            <div className="life-sub mono muted">{l.sub}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TaskLauncher({ onLaunch }) {
  return (
    <Card title="Activate task" subtitle="launches a menu script" className="tasks-card">
      <ul className="tasks">
        {TASKS.map(t => (
          <li key={t.key}>
            <button className="task" onClick={() => onLaunch(t)}>
              <span className="task-icon" aria-hidden="true">{t.icon}</span>
              <span className="task-text">
                <span className="task-key mono">0-Menu-{t.key}</span>
                <span className="task-desc">{t.desc}</span>
              </span>
              <span className="task-arrow" aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ————————————————————————————————————————————————————————
// Drawers: LLM I/O  and  Tracker
// ————————————————————————————————————————————————————————

function Drawer({ open, onClose, title, sub, children, width = 560 }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <>
      <div className={`scrim ${open ? "on" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "on" : ""}`} style={{ width }}>
        <header className="drawer-h">
          <div>
            <h3 className="drawer-title">{title}</h3>
            {sub && <div className="drawer-sub mono muted">{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

function IODrawer({ open, onClose }) {
  return (
    <Drawer open={open} onClose={onClose}
      title="Last LLM I/O"
      sub={`${LLM_IO_SAMPLE.session}  ·  ${LLM_IO_SAMPLE.stage}  ·  ${LLM_IO_SAMPLE.provider}`}
      width={640}
    >
      <div className="io-meta mono">
        <span>started <span className="hl">{LLM_IO_SAMPLE.started}</span></span>
        <span className="muted">·</span>
        <span>elapsed <span className="hl">{LLM_IO_SAMPLE.elapsed}</span></span>
        <span className="muted">·</span>
        <span>{LLM_IO_SAMPLE.tokens.in} in / {LLM_IO_SAMPLE.tokens.out} out</span>
      </div>

      <div className="io-actions">
        <button className="btn btn-ghost btn-sm">Copy prompt</button>
        <button className="btn btn-ghost btn-sm">Copy response</button>
        <button className="btn btn-ghost btn-sm">Re-run this stage</button>
        <button className="btn btn-ghost btn-sm">Replay from here</button>
      </div>

      <div className="io-block">
        <div className="io-label mono">▸ prompt  (system + user)</div>
        <pre className="io-pre mono">{LLM_IO_SAMPLE.prompt}</pre>
      </div>
      <div className="io-block">
        <div className="io-label mono">◂ response</div>
        <pre className="io-pre io-pre-res mono">{LLM_IO_SAMPLE.response}</pre>
      </div>
    </Drawer>
  );
}

function TrackerDrawer({ open, onClose, session }) {
  const s = session || INITIAL_SESSIONS[0];
  const stages = [
    { n: 1, name: "ReadFile",       status: "done",    note: "0-Mock-Data.txt  ·  4 fare options" },
    { n: 2, name: "InvokeOrch",     status: "done",    note: "dispatched" },
    { n: 3, name: "InternetSearch", status: "done",    note: "UA1142 seat map" },
    { n: 4, name: "ExecuteCommand", status: "active",  note: "booking call in-flight" },
    { n: 5, name: "ReplyToSender",  status: "pending", note: "" },
  ];
  return (
    <Drawer open={open} onClose={onClose}
      title={`Tracker · ${s.id}`}
      sub={s.topic}
      width={520}
    >
      <div className="tracker">
        <dl className="kv mono">
          <div><dt>goal</dt><dd>{s.topic}</dd></div>
          <div><dt>stage</dt><dd>{s.stage}</dd></div>
          <div><dt>status</dt><dd>{s.status}</dd></div>
          <div><dt>file</dt><dd className="hl">0-Chat-Sessions/{s.id}.json</dd></div>
        </dl>
        <div className="tk-title mono">stages</div>
        <ol className="tk-stages">
          {stages.map(st => (
            <li key={st.n} className={`tk-stage tk-${st.status}`}>
              <span className="tk-n mono">{st.n}</span>
              <span className="tk-name">{st.name}</span>
              <span className="tk-note mono muted">{st.note}</span>
              <span className="tk-status mono">{st.status}</span>
            </li>
          ))}
        </ol>
        <div className="tk-actions">
          <button className="btn btn-ghost btn-sm">Replay from stage…</button>
          <button className="btn btn-ghost btn-sm">Export tracker</button>
        </div>
      </div>
    </Drawer>
  );
}

function ReRunModal({ open, onClose, onConfirm }) {
  const [pick, setPick] = useState("Groq");
  if (!open) return null;
  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <div className="modal">
        <h3 className="modal-t">Re-run with different provider</h3>
        <p className="modal-sub mono muted">session Chat-0004 · stage 3-InternetSearch</p>
        <ul className="rr-list">
          {PROVIDERS.map(p => (
            <li key={p.name}>
              <label className={`rr ${pick === p.name ? "on" : ""}`}>
                <input type="radio" name="prov" checked={pick === p.name} onChange={() => setPick(p.name)} />
                <span className="rr-name">{p.name}</span>
                <span className="rr-model mono muted">{p.model}</span>
                <Pill tone={p.status === "degraded" ? "warn" : "neutral"}>{p.status}</Pill>
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-a">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { onConfirm(pick); onClose(); }}>Re-run on {pick}</button>
        </div>
      </div>
    </>
  );
}

function Toast({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className="toast mono">
          <span className={`toast-dot dot dot-${t.tone || "ok"}`} aria-hidden="true" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ————————————————————————————————————————————————————————
// App
// ————————————————————————————————————————————————————————

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "cyan",
  "density": "balanced",
  "layout": "grid"
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweaks] = window.useTweaks(TWEAK_DEFAULTS);
  const now = useClock();
  const machine = useSubmissionMachine();

  const [ioOpen, setIoOpen]       = useState(false);
  const [trOpen, setTrOpen]       = useState(false);
  const [trSess, setTrSess]       = useState(null);
  const [rrOpen, setRrOpen]       = useState(false);
  const [toasts, setToasts]       = useState([]);

  const pushToast = (msg, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, msg, tone }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3200);
  };

  const openTracker = (sess) => { setTrSess(sess); setTrOpen(true); };
  const launchTask  = (t) => pushToast(`launched 0-Menu-${t.key}.py  ·  pid ${Math.floor(Math.random()*9000+1000)}`, "info");

  // Apply accent via CSS variable
  useEffect(() => {
    const accentMap = {
      cyan:   "oklch(0.82 0.11 210)",
      green:  "oklch(0.82 0.14 150)",
      amber:  "oklch(0.82 0.13 80)",
      violet: "oklch(0.78 0.12 295)",
      coral:  "oklch(0.76 0.14 25)",
    };
    document.documentElement.style.setProperty("--accent", accentMap[tweaks.accent] || accentMap.cyan);
  }, [tweaks.accent]);

  useEffect(() => {
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.dataset.layout  = tweaks.layout;
  }, [tweaks.density, tweaks.layout]);

  // Handy "done" toast
  useEffect(() => {
    if (machine.state.phase === "done") pushToast("P3 pushed outbox.md  ·  Chat-0005 complete", "ok");
  }, [machine.state.phase]);

  return (
    <div className="app">
      <TopBar repoStatus="ok" now={now} />

      <main className="main" data-screen-label="01 P3 Dashboard">
        <Composer machine={machine} onOpenIO={() => setIoOpen(true)} />

        <div className="grid">
          <LastRunCard
            machine={machine}
            onOpenIO={() => setIoOpen(true)}
            onReRun={() => setRrOpen(true)}
            onReplay={() => { setTrSess(INITIAL_SESSIONS[0]); setTrOpen(true); }}
          />
          <StageCard machine={machine} />
          <ProvidersCard />
          <LedgerCard />
          <TaskLauncher onLaunch={launchTask} />
        </div>

        <footer className="foot mono muted">
          <span>P3  ·  pushed to <span className="hl">kademaray/P3-Public</span></span>
          <span>·</span>
          <span>polling every 15s</span>
          <span>·</span>
          <span>build 20260424-064004</span>
        </footer>
      </main>

      <IODrawer open={ioOpen} onClose={() => setIoOpen(false)} />
      <TrackerDrawer open={trOpen} onClose={() => setTrOpen(false)} session={trSess} />
      <ReRunModal open={rrOpen} onClose={() => setRrOpen(false)} onConfirm={(p) => pushToast(`re-queued on ${p}`, "info")} />
      <Toast toasts={toasts} />

      {/* Tweaks */}
      <window.TweaksPanel>
        <window.TweakSection title="Visual">
          <window.TweakRadio
            label="Accent"
            value={tweaks.accent}
            onChange={v => setTweaks({ accent: v })}
            options={[
              { value: "cyan",   label: "Cyan"   },
              { value: "green",  label: "Green"  },
              { value: "amber",  label: "Amber"  },
              { value: "violet", label: "Violet" },
              { value: "coral",  label: "Coral"  },
            ]}
          />
          <window.TweakRadio
            label="Density"
            value={tweaks.density}
            onChange={v => setTweaks({ density: v })}
            options={[
              { value: "compact",  label: "Compact" },
              { value: "balanced", label: "Balanced" },
              { value: "roomy",    label: "Roomy" },
            ]}
          />
          <window.TweakRadio
            label="Layout"
            value={tweaks.layout}
            onChange={v => setTweaks({ layout: v })}
            options={[
              { value: "grid",     label: "Grid" },
              { value: "two-col",  label: "Two-col" },
              { value: "stacked",  label: "Stacked" },
            ]}
          />
        </window.TweakSection>
        <window.TweakSection title="Demo">
          <window.TweakButton onClick={() => machine.submit("rebook my May 12 flight, aisle under $420, seat 14C")}>
            Simulate submit
          </window.TweakButton>
          <window.TweakButton onClick={machine.reset}>
            Reset composer
          </window.TweakButton>
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
