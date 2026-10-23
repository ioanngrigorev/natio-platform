import { ReceiptReview } from "@/components/receipts/receipt-review";
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ReceiptReview id={params.id} />;
}
