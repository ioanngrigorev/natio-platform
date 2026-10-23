import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../guards.js';
import { parse } from '../validate.js';
import { fxQuery,fxRates,newsFeed } from '../../modules/market/service.js';
export async function registerMarketRoutes(app:FastifyInstance){
 const guard=requireAdmin();
 app.get('/admin/market/fx',{preHandler:guard},async req=>{const q=parse(fxQuery,req.query);return fxRates(q.base,q.quote)});
 app.get('/admin/market/news',{preHandler:guard},async()=>newsFeed());
}
