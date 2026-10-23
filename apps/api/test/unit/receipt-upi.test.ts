import {describe,it,expect} from 'vitest';
import {extractClaim,assessReceipt} from '../../src/modules/receipts/analysis.js';
// Fictional values exercise the shape of a mobile receipt, never customer data.
const receipt=`SYNTHETIC DEMO
Transaction Successful
04:25 PM on 22 October 2026
Paid to
Alex Example
₹5,000
Banking Name : Alex Example
Sent to : Demo-10000000001@examplebank
Transaction ID
T261022000000000000000001
Debited from
XXXXXXXX4321
₹5,000
UTR: 123456789012`;
describe('mobile bank receipt fields',()=>{
 it('keeps bank UTR distinct from the app ID and extracts amount, local date and masked account',()=>{
  expect(extractClaim(receipt)).toMatchObject({reference:'123456789012',app_transaction_id:'T261022000000000000000001',amount:500000,currency:'INR',date:'2026-10-22',account_last4:'4321',recipient:'Alex Example',recipient_address:'Demo-10000000001@examplebank',local_time:'04:25 PM',time_zone:null,ambiguous:false});
 });
 it('handles Indian grouping but does not guess malformed amounts',()=>{
  expect(extractClaim(receipt.replaceAll('₹5,000','₹1,25,000.50')).amount).toBe(12500050);
  expect(extractClaim(receipt.replaceAll('₹5,000','₹5,00')).ambiguous).toBe(true);
 });
 it('does not turn a success label into independent payment evidence',()=>{
  const r=assessReceipt({text:receipt,ocr:receipt,expected:{amount:500000,currency:'INR'},evidence:null});
  expect(r.outcome).toBe('awaiting_psp');expect(r.findings.map(f=>f.code)).toEqual(expect.arrayContaining(['psp_unavailable','time_zone_unknown','status_is_a_claim']));
 });
 it('does not replace a missing bank reference with the app transaction ID',()=>{
  expect(extractClaim(receipt.replace('UTR: 123456789012','')).reference).toBeNull();
 });
 it('flags conflicting duplicated amounts and invalid dates',()=>{
  expect(extractClaim(receipt.replace('₹5,000','₹6,000')).ambiguous).toBe(true);
  expect(extractClaim(receipt.replace('22 October','31 February')).date).toBeNull();
 });
});
