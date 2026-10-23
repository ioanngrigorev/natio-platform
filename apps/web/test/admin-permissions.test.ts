import {describe,it,expect} from 'vitest';
import {ADMIN_PERMISSIONS,ADMIN_ROLES,adminReadPermission as apiRead,hasAdminPermission} from '../../api/src/modules/auth/permissions';
import {adminCan,adminReadPermission} from '../lib/admin-permissions';
describe('UI and API role contract',()=>{
 it('keeps every permission aligned for every supported role',()=>{
  for(const role of ADMIN_ROLES)for(const permission of ADMIN_PERMISSIONS)expect(adminCan(role,permission),role+':'+permission).toBe(hasAdminPermission(role,permission));
 });
 it('matches direct route boundaries including queries and nested resources',()=>{
  for(const p of ['/admin/pricing?mode=live','/admin/receipts/case','/admin/users','/admin/routing/rules','/admin/bi','/admin/plans','/admin/assistant/chat','/admin/payments/pay_test/pricing'])expect(adminReadPermission(p)).toBe(apiRead(p));
 });
});
