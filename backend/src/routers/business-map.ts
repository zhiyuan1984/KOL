import { Hono } from 'hono';
import { requireTicketPrincipal } from '../ticket-domain/auth.js';
import { HttpFail } from '../host/errors.js';
import { BusinessMapService } from '../business-map/service.js';

export const businessMapRouter = new Hono();

businessMapRouter.use('/business-map/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  requireTicketPrincipal();
  try {
    await next();
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    if (['42P01', '42703'].includes((error as { code?: string }).code || '')) {
      throw new HttpFail(503, { code: 'business_map_read_unavailable', message: '资料暂时无法读取，请联系管理员' });
    }
    // Catalog and records must never surface a database/schema/driver message
    // in the business-reading UI.  Expected authorization and validation
    // failures above retain their existing public contracts.
    throw new HttpFail(502, { code: 'business_map_read_unavailable', message: '资料暂时无法读取，请稍后重试' });
  }
});

const service = (companyId?: string) => new BusinessMapService(requireTicketPrincipal(), companyId);

/** Company is optional only when the existing ontology context has one valid company. */
businessMapRouter.get('/business-map/catalog', async (c) => c.json(await service(c.req.query('companyId')).catalog()));

businessMapRouter.get('/business-map/records', async (c) => c.json(await service(c.req.query('companyId')).records({
  companyId: c.req.query('companyId'),
  entityCode: c.req.query('entityCode'),
  source: c.req.query('source'),
  page: c.req.query('page'),
  pageSize: c.req.query('pageSize'),
  q: c.req.query('q'),
  unit: c.req.query('unit'),
})));
