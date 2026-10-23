import { z } from 'zod';
import { biQuery } from '../analytics/bi.js';
export const widgets = ['volume','outcomes','activity','methods','countries'] as const;
export const dashboardSpec = z.object({
  name:z.string().trim().min(2).max(100),
  filters:biQuery,
  widgets:z.array(z.enum(widgets)).min(1).max(5).transform(a=>[...new Set(a)]),
}).strict();
export type DashboardSpec = z.infer<typeof dashboardSpec>;
export const connectionSpec = z.object({
 name:z.string().trim().min(2).max(80), adapter:z.enum(['mock_acquirer','mock_qr']),
 currencies:z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(20),
 countries:z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(30),
 methods:z.array(z.enum(['card','bank_transfer','qr','open_banking','wallet','instant','local','crypto'])).min(1).max(8),
 timeout_ms:z.number().int().min(1000).max(30000),
}).strict();
export type ConnectionSpec = z.infer<typeof connectionSpec>;
export const assistantInput = z.object({
 locale:z.enum(['en','ru','es','ar','pt']).default('en'),
 question:z.string().trim().min(2).max(12000), page:z.string().max(160).regex(/^\/(?:admin|dashboard)(?:\/[a-zA-Z0-9_-]+)*$/),
 history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(2000)})).max(6).default([]),
}).strict();
export const assistantOutput = z.object({
 answer:z.string().min(1).max(7000), sources:z.array(z.string()).max(6),
 action:z.enum(['none','dashboard','connection']),
 dashboard:dashboardSpec.nullable(), connection:connectionSpec.nullable(),
}).strict();
