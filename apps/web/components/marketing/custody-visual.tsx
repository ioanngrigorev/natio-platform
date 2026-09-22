/**
 * Where the money actually goes.
 *
 * The single most important claim on the wallet and business pages is that
 * funds move payer → merchant and never through NATIO. A paragraph saying so
 * is easy to disbelieve; a diagram where NATIO sits visibly off the money path
 * makes the architecture self-evident. The settlement line is lime and
 * unbroken; every line touching NATIO is dashed, because it carries data only.
 */
export function CustodyVisual({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 300"
      className={className}
      role="img"
      aria-label="Payer pays a one-time address derived from the merchant's own extended public key; funds settle directly to the merchant wallet. NATIO observes the chain and emits webhooks but never holds funds or keys."
    >
      <defs>
        <marker id="cv-arrow-lime" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#C2F04B" />
        </marker>
        <marker id="cv-arrow-mist" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#5C6270" />
        </marker>
      </defs>

      {/* --- the money path: one unbroken lime line, payer to merchant ----- */}
      <g>
        <rect x="8" y="118" width="122" height="64" rx="10" fill="#101218" stroke="#2A2E3A" />
        <text x="69" y="144" textAnchor="middle" fill="#E8EAF0" fontSize="13" fontFamily="ui-sans-serif, system-ui">
          Payer
        </text>
        <text x="69" y="163" textAnchor="middle" fill="#8A909E" fontSize="10.5" fontFamily="ui-monospace, monospace">
          own wallet
        </text>

        <rect x="199" y="118" width="122" height="64" rx="10" fill="#101218" stroke="#2A2E3A" />
        <text x="260" y="142" textAnchor="middle" fill="#E8EAF0" fontSize="12" fontFamily="ui-sans-serif, system-ui">
          One-time address
        </text>
        <text x="260" y="161" textAnchor="middle" fill="#8A909E" fontSize="10" fontFamily="ui-monospace, monospace">
          derived from xpub
        </text>

        <rect x="390" y="118" width="122" height="64" rx="10" fill="#101218" stroke="#C2F04B" strokeOpacity="0.45" />
        <text x="451" y="144" textAnchor="middle" fill="#E8EAF0" fontSize="13" fontFamily="ui-sans-serif, system-ui">
          Merchant
        </text>
        <text x="451" y="163" textAnchor="middle" fill="#C2F04B" fontSize="10.5" fontFamily="ui-monospace, monospace">
          own wallet
        </text>

        <line x1="132" y1="150" x2="195" y2="150" stroke="#C2F04B" strokeWidth="1.5" markerEnd="url(#cv-arrow-lime)" />
        <line x1="323" y1="150" x2="386" y2="150" stroke="#C2F04B" strokeWidth="1.5" markerEnd="url(#cv-arrow-lime)" />
        <text x="163" y="139" textAnchor="middle" fill="#C2F04B" fontSize="9.5" fontFamily="ui-monospace, monospace">
          pays
        </text>
        <text x="354" y="139" textAnchor="middle" fill="#C2F04B" fontSize="9.5" fontFamily="ui-monospace, monospace">
          settles
        </text>
      </g>

      {/* --- NATIO: off the money path, dashed data links only ------------- */}
      <g>
        <rect x="180" y="238" width="160" height="52" rx="10" fill="#0D0F14" stroke="#7C8CFF" strokeOpacity="0.4" />
        <text x="260" y="259" textAnchor="middle" fill="#7C8CFF" fontSize="12" fontFamily="ui-monospace, monospace" letterSpacing="1.4">
          NATIO
        </text>
        <text x="260" y="277" textAnchor="middle" fill="#8A909E" fontSize="9.5" fontFamily="ui-monospace, monospace">
          watches · notifies
        </text>

        <line x1="260" y1="186" x2="260" y2="234" stroke="#5C6270" strokeWidth="1" strokeDasharray="3 3" markerEnd="url(#cv-arrow-mist)" />
        <path d="M451 186 L451 212 L344 212 L344 250" fill="none" stroke="#5C6270" strokeWidth="1" strokeDasharray="3 3" />
        <path d="M176 264 L120 264 L120 186" fill="none" stroke="#5C6270" strokeWidth="1" strokeDasharray="3 3" markerEnd="url(#cv-arrow-mist)" />
      </g>

      {/* --- the claim, stated on the diagram itself ----------------------- */}
      <g>
        <line x1="8" y1="208" x2="132" y2="208" stroke="#2A2E3A" strokeWidth="1" />
        <text x="8" y="226" fill="#5C6270" fontSize="9.5" fontFamily="ui-monospace, monospace">
          NO CUSTODY · NO KEYS
        </text>
        <text x="8" y="60" fill="#8A909E" fontSize="10" fontFamily="ui-monospace, monospace" letterSpacing="1.2">
          SOLID = FUNDS
        </text>
        <line x1="8" y1="70" x2="86" y2="70" stroke="#C2F04B" strokeWidth="1.5" />
        <text x="8" y="92" fill="#8A909E" fontSize="10" fontFamily="ui-monospace, monospace" letterSpacing="1.2">
          DASHED = DATA
        </text>
        <line x1="8" y1="102" x2="86" y2="102" stroke="#5C6270" strokeWidth="1" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}
