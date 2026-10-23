"use client";
import {useI18n} from '@/lib/i18n/provider';

/** Payment status machine, drawn from PAYMENT_TRANSITIONS in the API state machine. */

type Tone = "flow" | "ok" | "bad" | "muted";

/* Dark-surface palette: flat night fills, hairline strokes, accent only where the
   state carries a meaning (settled = lime, failed = rose). */
const FILL: Record<Tone, string> = { flow: "#151922", ok: "#151922", bad: "#151922", muted: "#101319" };
const STROKE: Record<Tone, string> = { flow: "#2A3040", ok: "#C2F04B", bad: "#FDA4AF", muted: "#1D2230" };
const TEXT: Record<Tone, string> = { flow: "#C6CAD4", ok: "#C2F04B", bad: "#FDA4AF", muted: "#8A91A0" };

const EDGE = "#5C6373";
const EDGE_DASHED = "#3A4152";

function Node({ x, y, w = 112, label, tone = "flow", size = 11 }: { x: number; y: number; w?: number; label: string; tone?: Tone; size?: number }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const accent = tone === "ok" || tone === "bad";
  return (
    <g>
      <rect x={x} y={y} width={w} height={34} rx={6} fill={FILL[tone]} stroke={STROKE[tone]} strokeOpacity={accent ? 0.5 : 1} />
      <text x={x + w / 2} y={y + 21} textAnchor="middle" fontSize={size} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={TEXT[tone]}>
        {translateUi(label)}
      </text>
    </g>
  );
}

function Edge({ d, dashed, label, lx, ly }: { d: string; dashed?: boolean; label?: string; lx?: number; ly?: number }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={dashed ? EDGE_DASHED : EDGE}
        strokeWidth={1.25}
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd={dashed ? "url(#natio-arrow-dim)" : "url(#natio-arrow)"}
      />
      {translateUi(label && lx !== undefined && ly !== undefined ? (
        <text x={lx} y={ly} textAnchor="middle" fontSize={9.5} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#8A91A0">
          {translateUi(label)}
        </text>
      ) : null)}
    </g>
  );
}

export function PaymentLifecycle() {
 const {t:translateUi,locale:uiLocale}=useI18n();

  return (
    <figure className="mb-6 overflow-x-auto rounded-xl border border-night-700 bg-night-900 p-5">
      <svg viewBox="0 -18 680 232" role="img" aria-label={translateUi("Payment status machine: created leads to processing, which leads to authorized and then successful; refunds move successful to partially refunded and refunded; created, pending, processing and authorized can end as failed or cancelled.")} className="block h-auto w-full min-w-[620px]">
        <defs>
          <marker id="natio-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE} />
          </marker>
          <marker id="natio-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_DASHED} />
          </marker>
        </defs>

        {/* main path */}
        <Node x={8} y={16} label={translateUi("created")} />
        <Node x={176} y={16} label={translateUi("processing")} />
        <Node x={344} y={16} label={translateUi("authorized")} />
        <Node x={512} y={16} label={translateUi("successful")} tone="ok" />

        {/* second row */}
        <Node x={8} y={82} label={translateUi("pending")} />
        <Node x={344} y={82} label={translateUi("captured")} />
        <Node x={470} y={82} w={196} label={translateUi("partially_refunded")} tone="muted" size={10.5} />

        {/* terminal row */}
        <Node x={176} y={168} label={translateUi("failed")} tone="bad" />
        <Node x={344} y={168} label={translateUi("cancelled")} tone="muted" />
        <Node x={554} y={168} w={112} label={translateUi("refunded")} tone="muted" />

        {/* main horizontal flow */}
        <Edge d="M120,33 L172,33" />
        <Edge d="M288,33 L340,33" />
        <Edge d="M456,33 L508,33" />

        {/* automatic capture shortcut */}
        <Edge d="M232,16 C 300,-14 500,-14 568,12" label={translateUi("capture_method = automatic")} lx={400} ly={-6} />

        {/* pending loop */}
        <Edge d="M64,50 L64,78" />
        <Edge d="M120,99 L232,99 L232,54" />

        {/* manual capture */}
        <Edge d="M400,50 L400,78" label={translateUi("capture")} lx={434} ly={68} />
        <Edge d="M456,84 L516,54" />

        {/* refunds */}
        <Edge d="M590,50 L590,78" label={translateUi("refund")} lx={622} ly={68} />
        <Edge d="M610,116 L610,164" label={translateUi("full refund")} lx={648} ly={144} />

        {/* failure / cancellation rail */}
        <Edge d="M110,50 L160,146" dashed />
        <Edge d="M264,50 L264,146" dashed />
        <Edge d="M344,50 L310,146" dashed />
        <path d="M160,148 L400,148" fill="none" stroke={EDGE_DASHED} strokeWidth={1.25} strokeDasharray="4 3" />
        <Edge d="M232,148 L232,164" dashed />
        <Edge d="M400,148 L400,164" dashed />
      </svg>
      <figcaption className="mt-3 border-t border-night-700 pt-3 text-[12px] leading-5 text-mist-400">{translateUi("Solid arrows are the ordinary path. The dashed rail is the failure and cancellation path: ")}<span className="font-mono">{translateUi("created")}</span>,{translateUi(" ")}
        <span className="font-mono">{translateUi("pending")}</span>, <span className="font-mono">{translateUi("processing")}</span>{translateUi(" and ")}<span className="font-mono">{translateUi("authorized")}</span>{translateUi(" can all end as")}{translateUi(" ")}
        <span className="font-mono">{translateUi("failed")}</span>{translateUi(" or ")}<span className="font-mono">{translateUi("cancelled")}</span>{translateUi(". A refund for the full amount moves")}{translateUi(" ")}
        <span className="font-mono">{translateUi("successful")}</span>{translateUi(" straight to ")}<span className="font-mono">{translateUi("refunded")}</span>.{translateUi(" ")}
        <span className="font-mono">{translateUi("failed")}</span>, <span className="font-mono">{translateUi("cancelled")}</span>{translateUi(" and ")}<span className="font-mono">{translateUi("refunded")}</span>{translateUi(" are terminal.")}</figcaption>
    </figure>
  );
}
