import {describe,it,expect,vi} from 'vitest';
import {LocationLookup,publicIp,validTimeZone} from '../../src/modules/quotes/location.js';
import {dateInZone,dailyPerspective} from '../../src/modules/quotes/daily.js';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
describe('IP-local daily perspective',()=>{
 it('rotates at local midnight, stays stable on reload and never repeats on adjacent dates',()=>{
  const instant=new Date('2026-10-23T21:30:00Z');
  expect(dateInZone(instant,'Asia/Dubai')).toBe('2026-10-24');
  expect(dateInZone(instant,'America/New_York')).toBe('2026-10-23');
  expect(dailyPerspective('2026-10-23','admin')).toEqual(dailyPerspective('2026-10-23','admin'));
  expect(dailyPerspective('2026-10-24','admin').id).not.toBe(dailyPerspective('2026-10-23','admin').id);
  expect(validTimeZone('Mars/Test')).toBe(false);
 });
 it('never resolves local, reserved, malformed or caller-supplied URL addresses',()=>{
  for(const value of ['localhost','http://example.com','127.0.0.1','10.0.0.1','172.20.0.2','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1'])expect(publicIp(value)).toBeNull();
  expect(publicIp('::ffff:8.8.8.8')).toBe('8.8.8.8');expect(publicIp('2606:4700:4700::1111')).toBeTruthy();
 });
 it('deduplicates and caches lookups without returning IPs or coordinates',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>response({ip:'8.8.8.8',city:'Dubai',country:'United Arab Emirates',timezone:'Asia/Dubai',lat:25,lon:55}));
  const lookup=new LocationLookup(fetcher);const values=await Promise.all([lookup.resolve('8.8.8.8'),lookup.resolve('8.8.8.8')]);
  expect(values[0]).toEqual({city:'Dubai',country:'United Arab Emirates',time_zone:'Asia/Dubai'});expect(values[1]).toEqual(values[0]);
  await lookup.resolve('8.8.8.8');expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.ipapi.is/');
 });
 it('falls back on invalid data and stops contacting a rate-limited provider',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>response({},429)),lookup=new LocationLookup(fetcher);
  expect(await lookup.resolve('8.8.8.8')).toBeNull();expect(await lookup.resolve('1.1.1.1')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
  const invalid=new LocationLookup(vi.fn(async()=>response({ip:'8.8.8.8',timezone:'Invalid/Zone',city:'Dubai',country:'AE'})));
  expect(await invalid.resolve('8.8.8.8')).toBeNull();
  const failed=new LocationLookup(vi.fn(async()=>{throw new Error('timeout')}));expect(await failed.resolve('8.8.8.8')).toBeNull();
 });
});
