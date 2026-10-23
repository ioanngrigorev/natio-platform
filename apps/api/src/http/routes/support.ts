import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { safeEqual } from '../../lib/crypto.js';
import { Errors } from '../../lib/errors.js';
import { requireAdmin } from '../guards.js';
import { parse } from '../validate.js';
import { createLink,createTicket,replyTicket,ticketAccess,ticketInput,isSupportStaff,receiveTelegram,flushSupportOutbox } from '../../modules/support/service.js';
export async function registerSupportRoutes(app:FastifyInstance){
 const guard=requireAdmin(),p=getPool(),param=z.object({id:z.string().uuid()});
 app.get('/admin/support',{preHandler:guard},async req=>{const admin=req.admin!.admin,staff=isSupportStaff(admin.role);return {staff,bot_username:loadConfig().TELEGRAM_SUPPORT_USERNAME,configured:!!loadConfig().TELEGRAM_BOT_TOKEN,linked:!!(await p.query('SELECT 1 FROM support_telegram_accounts WHERE admin_id=$1',[admin.id])).rowCount,data:(await p.query('SELECT t.*,a.name AS owner_name FROM support_tickets t JOIN admin_users a ON a.id=t.owner_id WHERE t.owner_id=$1 OR $2 ORDER BY t.updated_at DESC LIMIT 100',[admin.id,staff])).rows}});
 app.post('/admin/support/connect',{preHandler:guard,config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async req=>createLink(req.admin!.admin.id));
 app.post('/admin/support/disconnect',{preHandler:guard},async req=>{await p.query("UPDATE support_outbox SET status='failed',updated_at=now() WHERE chat_id IN (SELECT chat_id FROM support_telegram_accounts WHERE admin_id=$1) AND status IN ('pending','sending')",[req.admin!.admin.id]);await p.query('DELETE FROM support_telegram_accounts WHERE admin_id=$1',[req.admin!.admin.id]);await p.query('DELETE FROM support_telegram_links WHERE admin_id=$1',[req.admin!.admin.id]);return {disconnected:true}});
 app.post('/admin/support',{preHandler:guard,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>createTicket(req.admin!.admin.id,parse(ticketInput,req.body),req.dashboardMode!));
 app.get('/admin/support/:id',{preHandler:guard},async req=>{const {id}=parse(param,req.params),a=req.admin!.admin,ticket=await ticketAccess(id,a.id,a.role);return {ticket,messages:(await p.query('SELECT m.*,a.name AS author_name FROM support_messages m JOIN admin_users a ON a.id=m.author_id WHERE ticket_id=$1 ORDER BY m.created_at LIMIT 200',[id])).rows}});
 app.post('/admin/support/:id/reply',{preHandler:guard},async req=>{const {id}=parse(param,req.params),a=req.admin!.admin,b=parse(z.object({id:z.string().uuid(),body:z.string().trim().min(1).max(3800)}).strict(),req.body);return replyTicket(id,a.id,a.role,b.body,b.id)});
 app.post('/admin/support/:id/status',{preHandler:guard},async req=>{const {id}=parse(param,req.params),a=req.admin!.admin,b=parse(z.object({status:z.enum(['open','in_progress','resolved'])}).strict(),req.body);await ticketAccess(id,a.id,a.role);if(b.status==='in_progress'&&!isSupportStaff(a.role))throw Errors.forbidden('Support staff only');await p.query('UPDATE support_tickets SET status=$2,updated_at=now() WHERE id=$1',[id,b.status]);return {status:b.status}});
 app.post('/integrations/telegram/support',{config:{rateLimit:{max:100,timeWindow:'1 minute'}},bodyLimit:32768},async(req)=>{const secret=loadConfig().TELEGRAM_WEBHOOK_SECRET;if(!secret||!safeEqual(String(req.headers['x-telegram-bot-api-secret-token']||''),secret))throw Errors.forbidden();return receiveTelegram(req.body)});
 if(!loadConfig().isTest){const timer=setInterval(()=>void flushSupportOutbox().catch(()=>undefined),20000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer))}
}
