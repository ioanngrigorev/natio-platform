import {getI18n} from '@/lib/i18n/server';

import Link from "next/link";
import { Card, Table } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Quote } from "./strategy-types";
export async function PaymentPricing({ id }: { id: string }) {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  const r = await (await serverApi()).get<{
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
      title={translateUi("Tariff & margin evidence")}
      description={translateUi("Pricing terms are frozen when an attempt is created. Recorded historical transactions are not repriced.")}
    >
      {translateUi(!frozen.length ? (
        <p className="text-sm text-ink-500">{translateUi("Historical record: merchant fee")}{translateUi(" ")}
          {translateUi(formatMoney(r.merchant_fee, r.currency))}{translateUi(". No versioned tariff snapshot was recorded for this payment.")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{translateUi("Attempt")}</th>
              <th>{translateUi("Merchant fee")}</th>
              <th>{translateUi("PSP cost")}</th>
              <th>{translateUi("Gross margin")}</th>
              <th>{translateUi("Versions")}</th>
            </tr>
          </thead>
          <tbody>
            {translateUi(frozen.map((a, i) => {
              const q = a.captured_pricing ?? a.pricing!;
              return (
                <tr key={a.id}>
                  <td>
                    {translateUi(i + 1)} · {translateUi(a.status)}
                    <p className="text-xs text-ink-500">
                      {translateUi(a.captured_pricing ? translateUi("Captured") : translateUi("Quoted, not settled"))}
                    </p>
                  </td>
                  <td>{translateUi(formatMoney(q.merchant.amount, r.currency))}</td>
                  <td>{translateUi(formatMoney(q.provider.amount, r.currency))}</td>
                  <td>{translateUi(formatMoney(q.margin, r.currency))}</td>
                  <td>
                    {translateUi([q.merchant, q.provider].map((f, j) => (
                      <div key={j}>
                        {translateUi(f.planId ? (
                          <Link
                            className="text-brand-600 hover:underline"
                            href={`/admin/pricing?plan=${f.planId}`}
                          >
                            {f.name}{translateUi(" v")}{translateUi(f.revision)}
                          </Link>
                        ) : (
                          f.name
                        ))}
                      </div>
                    )))}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </Table>
      ))}
    </Card>
  );
}
