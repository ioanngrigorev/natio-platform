import { ReceiptReview } from "@/components/receipts/receipt-review";
export default function Page({ params }: { params: { id: string } }) { return <ReceiptReview id={params.id} />; }
