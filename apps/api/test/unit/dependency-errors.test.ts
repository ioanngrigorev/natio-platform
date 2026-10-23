import {describe,expect,it} from 'vitest';
import {isDependencyUnavailable} from '../../src/lib/dependency-errors.js';
describe('dependency error boundary',()=>{
 it.each(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','57P01','57P03','53300'])('recognizes %s through a driver wrapper',code=>expect(isDependencyUnavailable({cause:{code}})).toBe(true));
 it('does not hide a query bug or integrity violation as a temporary outage',()=>{for(const code of ['23505','23503','42601'])expect(isDependencyUnavailable({code})).toBe(false)});
 it('bounds circular error chains',()=>{const error:{cause?:unknown}={};error.cause=error;expect(isDependencyUnavailable(error)).toBe(false)});
});
