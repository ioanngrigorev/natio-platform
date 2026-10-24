import {it,expect} from 'vitest';
import {z} from 'zod';
import {metadataSchema} from '../../src/modules/payments/schemas.js';
it('rejects oversized constrained arrays without building an issue per element',()=>{
 const result=z.array(z.object({id:z.string()})).max(2).safeParse(Array.from({length:10000},()=>({id:123})));
 expect(result.success).toBe(false);
 if(!result.success){expect(result.error.issues).toHaveLength(1);expect(result.error.issues[0].code).toBe('too_big')}
});
it('preserves supported payment metadata values after the validation library upgrade',()=>{
 const value={label:'reviewed',attempt:1,enabled:true,optional:null};
 expect(metadataSchema.parse(value)).toEqual(value);
 expect(metadataSchema.safeParse({nested:{private:'unsupported'}}).success).toBe(false);
});
