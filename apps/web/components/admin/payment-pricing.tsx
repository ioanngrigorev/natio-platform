import Link from "next/link";
import { Card, Table } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Quote } from "./strategy-types";
export async function PaymentPricing({ id }: { id: string }) {
  const r = await serverApi().get<{
    currency: string;
    merchant_fee: number;
    data: {
      id: string;
      status: string;
      providerCost: number;
      pricing: Quote | null;
      captured_pricing: Quote | null;
    }[];
  }>(`/admin/payments/${id}/pricing`);
  const frozen = r.data.filter((a) => a.pricing);
  return (
    <Card
      title="Tariff & margin evidence"
      description="Pricing terms are frozen when an attempt is created. Recorded historical transactions are not repriced."
    >
      {!frozen.length ? (
        <p className="text-sm text-ink-500">
          Historical record: merchant fee{" "}
          {formatMoney(r.merchant_fee, r.currency)}. No versioned tariff
          snapshot was recorded for this payment.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Merchant fee</th>
              <th>PSP cost</th>
              <th>Gross margin</th>
              <th>Versions</th>
            </tr>
          </thead>
          <tbody>
            {frozen.map((a, i) => {
              const q = a.captured_pricing ?? a.pricing!;
              return (
                <tr key={a.id}>
                  <td>
                    {i + 1} · {a.status}
                    <p className="text-xs text-ink-500">
                      {a.captured_pricing ? "Captured" : "Quoted, not settled"}
                    </p>
                  </td>
                  <td>{formatMoney(q.merchant.amount, r.currency)}</td>
                  <td>{formatMoney(q.provider.amount, r.currency)}</td>
                  <td>{formatMoney(q.margin, r.currency)}</td>
                  <td>
                    {[q.merchant, q.provider].map((f, j) => (
                      <div key={j}>
                        {f.planId ? (
                          <Link
                            className="text-brand-600 hover:underline"
                            href={`/admin/pricing?plan=${f.planId}`}
                          >
                            {f.name} v{f.revision}
                          </Link>
                        ) : (
                          f.name
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
