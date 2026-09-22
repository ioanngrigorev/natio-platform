/**
 * Hero visual: one merchant request entering NATIO and fanning out to providers,
 * with the failover hop drawn as the live path. Pure inline SVG — no images, no
 * runtime cost. Decorative, so it is hidden from assistive tech; the same
 * information is stated in the surrounding copy and in the flow diagram below.
 */
const PROVIDERS = [
  { y: 20, label: "ACQUIRER A", status: "DECLINED", state: "declined" as const },
  { y: 84, label: "ACQUIRER B", status: "SETTLED", state: "settled" as const },
  { y: 148, label: "LOCAL QR", status: "", state: "idle" as const },
  { y: 212, label: "OPEN BANKING", status: "", state: "idle" as const },
  { y: 276, label: "WALLET", status: "", state: "idle" as const },
];

const BOX_X = 392;
const BOX_W = 168;
const CENTER_Y = 170;

export function RoutingVisual({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <svg viewBox="0 0 570 330" className="h-auto w-full" role="presentation">
        <defs>
          <linearGradient id="rv-live" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7C8CFF" stopOpacity="0.2" />
            <stop offset="60%" stopColor="#7C8CFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#C2F04B" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="rv-fail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7C8CFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#5C6373" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="rv-dim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2A3040" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#2A3040" stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="rv-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7C8CFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7C8CFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="236" cy={CENTER_Y} r="128" fill="url(#rv-core)" />

        {/* merchant */}
        <rect x="2" y={CENTER_Y - 21} width="118" height="42" rx="10" fill="#101319" stroke="#2A3040" />
        <text x="61" y={CENTER_Y - 4} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="8" letterSpacing="1.7" fill="#5C6373">
          MERCHANT
        </text>
        <text x="61" y={CENTER_Y + 11} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="9" fill="#C6CAD4">
          POST /v1/payments
        </text>

        <path d={`M120 ${CENTER_Y} H172`} stroke="url(#rv-live)" strokeWidth="1.5" fill="none" />

        {/* engine */}
        <rect x="172" y={CENTER_Y - 48} width="128" height="96" rx="14" fill="#0B0D12" stroke="#7C8CFF" strokeOpacity="0.4" />
        <text x="236" y={CENTER_Y - 30} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="8.5" letterSpacing="2" fill="#7C8CFF">
          NATIO
        </text>
        {["ROUTING", "RISK", "FAILOVER"].map((t, i) => (
          <g key={t}>
            <rect x="187" y={CENTER_Y - 20 + i * 20} width="98" height="15" rx="4" fill="#151922" />
            <text x="195" y={CENTER_Y - 9 + i * 20} fontFamily="ui-monospace, Menlo, monospace" fontSize="7.5" letterSpacing="1.2" fill="#8A91A0">
              {t}
            </text>
            <circle cx="277" cy={CENTER_Y - 12.5 + i * 20} r="2.2" fill={i === 2 ? "#C2F04B" : "#7C8CFF"} />
          </g>
        ))}

        {/* engine → providers */}
        {PROVIDERS.map((p) => {
          const targetY = p.y + 17;
          const stroke = p.state === "settled" ? "url(#rv-live)" : p.state === "declined" ? "url(#rv-fail)" : "url(#rv-dim)";
          return (
            <path
              key={p.label}
              d={`M300 ${CENTER_Y} C 346 ${CENTER_Y}, 346 ${targetY}, ${BOX_X} ${targetY}`}
              stroke={stroke}
              strokeWidth={p.state === "idle" ? 1 : 1.5}
              strokeDasharray={p.state === "declined" ? "3 4" : undefined}
              fill="none"
            />
          );
        })}

        {/* providers */}
        {PROVIDERS.map((p) => {
          const settled = p.state === "settled";
          const declined = p.state === "declined";
          return (
            <g key={p.label}>
              <rect
                x={BOX_X}
                y={p.y}
                width={BOX_W}
                height="34"
                rx="9"
                fill={settled ? "#101319" : "#0B0D12"}
                stroke={settled ? "#C2F04B" : "#1D2230"}
                strokeOpacity={settled ? 0.5 : 1}
              />
              <circle cx={BOX_X + 14} cy={p.y + 17} r="3" fill={settled ? "#C2F04B" : declined ? "#5C6373" : "#2A3040"} />
              <text x={BOX_X + 26} y={p.y + 20.5} fontFamily="ui-monospace, Menlo, monospace" fontSize="8" letterSpacing="1.2" fill={settled ? "#C6CAD4" : "#5C6373"}>
                {p.label}
              </text>
              {p.status ? (
                <text
                  x={BOX_X + BOX_W - 12}
                  y={p.y + 20.5}
                  textAnchor="end"
                  fontFamily="ui-monospace, Menlo, monospace"
                  fontSize="7"
                  letterSpacing="1.1"
                  fill={settled ? "#C2F04B" : "#5C6373"}
                >
                  {p.status}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
