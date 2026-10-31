
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import whatsappSignupRouter from './whatsapp-signup';
import { enqueueCampaign, getMockCampaignProgress, getMockDeliveryHistory, retryFailedMockCampaign } from './queue';
import { aggregateMockStats } from './mock-analytics';
import { liveEnabled, startLivePilot, liveProgress } from './live-pilot';
import { liveWebhookGet, liveWebhookPost } from './live-webhook';
import { decryptToken } from './encryption';
import { normalizeApprovedTemplates, metaGraphVersion } from './meta-templates';


const db = new PrismaClient();
const app = express();

app.disable('x-powered-by');

app.use(
  cors({
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  })
);

// Register isolated callback before JSON parsing, to verify the exact signed bytes.
app.get('/api/v1/standalone/meta-webhook', liveWebhookGet);
app.post('/api/v1/standalone/meta-webhook', express.raw({type:'application/json',limit:'256kb'}),
  (req,res,next)=>{void Promise.resolve(liveWebhookPost(req,res)).catch(next)});
app.use(express.json({ limit: '1mb' }));

const secret = process.env.JWT_SECRET;

if (!secret || secret.length < 32) {
  throw new Error('Set JWT_SECRET (at least 32 characters)');
}

// Async route error handler
const handler =
  (fn: any) =>
  (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// JWT authentication
function auth(req: any, res: any, next: any) {
  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization token required',
      });
    }

    const token = header.slice(7);

    const payload = jwt.verify(token, secret!) as any;

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string'
    ) {
      return res.status(401).json({
        error: 'Invalid authentication token',
      });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({
      error: 'Unauthorized',
    });
  }
}

// Company OWNER/ADMIN authorization
// Apply this middleware to future WhatsApp management endpoints.
const requireWhatsAppAdmin = handler(
  async (req: any, res: any, next: any) => {
    const userId = req.user?.sub;
    const tenantId = req.user?.tenantId;

    if (
      typeof userId !== 'string' ||
      typeof tenantId !== 'string'
    ) {
      return res.status(401).json({
        error: 'Invalid authentication context',
      });
    }

    const membership = await db.membership.findFirst({
      where: {
        userId,
        tenantId,
      },
      select: {
        role: true,
      },
    });

    if (
      !membership ||
      !['OWNER', 'ADMIN'].includes(membership.role)
    ) {
      return res.status(403).json({
        error: 'Company OWNER or ADMIN access required',
      });
    }

    next();
  }
);

app.use('/api/v1/whatsapp/signup', auth, whatsappSignupRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Register user and company
app.post(
  '/api/v1/auth/register',
  handler(async (req: any, res: any) => {
    const parsed = z
      .object({
        business: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(10),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid registration data',
      });
    }

    const { business, email, password } = parsed.data;

    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: business,
        },
      });

      return tx.user.create({
        data: {
          email,
          passwordHash,
          memberships: {
            create: {
              tenantId: tenant.id,
              role: 'OWNER',
            },
          },
        },
      });
    });

    return res.status(201).json({
      userId: user.id,
    });
  })
);

// Login
app.post(
  '/api/v1/auth/login',
  handler(async (req: any, res: any) => {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string(),
        tenantId: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid credentials',
      });
    }

    const user = await db.user.findUnique({
      where: {
        email: parsed.data.email,
      },
      include: {
        memberships: true,
      },
    });

    if (
      !user ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        error: 'Invalid credentials',
      });
    }

    const membership = parsed.data.tenantId
      ? user.memberships.find(
          (m) => m.tenantId === parsed.data.tenantId
        )
      : user.memberships.length === 1
        ? user.memberships[0]
        : undefined;

    if (!membership) {
      return res.status(403).json({
        error: 'Select an authorized company using tenantId',
      });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        tenantId: membership.tenantId,
        role: membership.role,
      },
      secret!,
      {
        expiresIn: '8h',
      }
    );

    return res.json({ token });
  })
);

// List companies for authenticated user
app.get(
  '/api/v1/companies',
  auth,
  handler(async (req: any, res: any) => {
    const memberships = await db.membership.findMany({
      where: {
        userId: req.user.sub,
      },
      include: {
        tenant: true,
      },
    });

    return res.json(
      memberships.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        role: m.role,
      }))
    );
  })
);

// List WhatsApp connections
// Never return encrypted access tokens to frontend.
app.get(
  '/api/v1/whatsapp/connections',
  auth,
  handler(async (req: any, res: any) => {
    const membership = await db.membership.findFirst({
      where: {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
      },
    });

    if (!membership) {
      return res.status(403).json({
        error: 'Company access denied',
      });
    }

    const connections = await db.whatsAppConnection.findMany({
      where: {
        tenantId: req.user.tenantId,
      },
      select: {
        id: true,
        label: true,
        wabaId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        status: true,
        createdAt: true,
      },
    });

    return res.json(connections);
  })
);

// Read-only template discovery. Never send credentials to the browser or enable live sends.
app.get('/api/v1/whatsapp/connections/:id/approved-templates', auth, requireWhatsAppAdmin,
  handler(async (req: any, res: any) => {
    const conn = await db.whatsAppConnection.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true, label: true, wabaId: true, status: true, accessTokenEncrypted: true },
    });
    if (!conn) return res.status(404).json({ error: 'Connection not found for this company' });
    if (!conn.accessTokenEncrypted) return res.status(409).json({ error: 'Connection requires reauthorization' });
    let token: string;
    try { token = decryptToken(conn.accessTokenEncrypted); }
    catch { return res.status(409).json({ error: 'Connection credentials unavailable; reauthorize securely' }); }
    const version = metaGraphVersion(process.env.META_GRAPH_VERSION);
    const url = new URL('https://graph.facebook.com/' + version + '/' + encodeURIComponent(conn.wabaId) + '/message_templates');
    url.searchParams.set('fields', 'id,name,status,language,category,components');
    url.searchParams.set('limit', '100');
    // The initial page is deliberately bounded; no automatic untrusted pagination.
    try {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return res.status(502).json({
        error: 'Meta template lookup failed; check connection permissions and authorization',
      });
      const body: any = await response.json();
      if (!Array.isArray(body.data)) return res.status(502).json({ error: 'Invalid Meta template response' });
      const templates = normalizeApprovedTemplates(body.data);
      return res.json({
        connection: { id: conn.id, label: conn.label, status: conn.status },
        templates, hasMore: Boolean(body.paging?.next),
        liveSendingEnabled: false,
        note: 'Read-only approved template discovery. Campaigns remain mock-only.',
      });
    } catch {
      return res.status(502).json({ error: 'Meta template lookup temporarily unavailable' });
    }
  })
);

// Verify a specific company's Meta phone before allowing activation.
app.post('/api/v1/whatsapp/connections/:id/verify-phone', auth, requireWhatsAppAdmin,
 handler(async(req:any,res:any)=>{
  const conn=await db.whatsAppConnection.findFirst({where:{id:req.params.id,tenantId:req.user.tenantId}});
  if(!conn)return res.status(404).json({error:'Connection not found'});
  if(!conn.accessTokenEncrypted)return res.status(409).json({error:'Connection token missing'});
  let token:string;
  try{token=decryptToken(conn.accessTokenEncrypted)}
  catch{return res.status(409).json({error:'Unable to decrypt connection token'})}
  const version=metaGraphVersion(process.env.META_GRAPH_VERSION);
  const url=new URL('https://graph.facebook.com/'+version+'/'+encodeURIComponent(conn.phoneNumberId));
  url.searchParams.set('fields','id,display_phone_number,verified_name,quality_rating,code_verification_status,status,platform_type');
  try{
   const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
   if(!response.ok)return res.status(502).json({error:'Meta phone verification failed; review token permissions'});
   const data:any=await response.json();
   if(String(data.id)!==conn.phoneNumberId)return res.status(409).json({error:'Meta phone mismatch'});
   const connected=data.status==='CONNECTED' && data.code_verification_status==='VERIFIED'
      && data.platform_type==='CLOUD_API';
   // Activation is only based on live Meta response, never user-supplied status.
   await db.whatsAppConnection.updateMany({where:{id:conn.id,tenantId:req.user.tenantId},
    data:{status:connected?'ACTIVE':'PENDING'}});
   return res.json({connectionId:conn.id,verified:connected,metaStatus:data.status||null,
    codeVerificationStatus:data.code_verification_status||null,platformType:data.platform_type||null,
    qualityRating:data.quality_rating||null,displayPhoneNumber:data.display_phone_number||null});
  }catch{return res.status(502).json({error:'Meta phone verification temporarily unavailable'})}
 }));
 
// Contacts: tenant-scoped search, pagination and safe consent handling
app.get('/api/v1/contacts', auth, handler(async (req: any, res: any) => {
  const query = z.object({
    search: z.string().max(120).optional(),
    consent: z.enum(['all', 'true', 'false']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Invalid contact filters' });
  const { search, consent, page, limit } = query.data;
  const where: any = {
    tenantId: req.user.tenantId,
    ...(consent !== 'all' ? { consent: consent === 'true' } : {}),
    ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ] } : {}),
  };
  const [total, contacts] = await db.$transaction([
    db.contact.count({ where }),
    db.contact.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  return res.json({ contacts, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
}));

app.post('/api/v1/contacts', auth, handler(async (req: any, res: any) => {
  const parsed = z.object({
    name: z.string().max(120).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    consent: z.literal(true),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid E.164 phone and explicit consent required' });
  const existing = await db.contact.findUnique({ where: { tenantId_phone: {
    tenantId: req.user.tenantId, phone: parsed.data.phone,
  } } });
  if (existing) return res.status(409).json({ error: existing.consent
    ? 'This phone number already exists' : 'Contact opted out. Do not re-subscribe without verified new consent.' });
  const contact = await db.contact.create({ data: { ...parsed.data, tenantId: req.user.tenantId } });
  return res.status(201).json(contact);
}));

app.post('/api/v1/contacts/import', auth, handler(async (req: any, res: any) => {
  const parsed = z.object({ contacts: z.array(z.object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    name: z.string().max(120).optional(),
    consent: z.literal(true),
  })).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide up to 500 explicitly opted-in contacts with valid E.164 numbers' });
  const unique = [...new Map(parsed.data.contacts.map(c => [c.phone, c])).values()];
  let imported = 0, skipped = 0;
  for (const contact of unique) {
    const existing = await db.contact.findUnique({ where: { tenantId_phone: {
      tenantId: req.user.tenantId, phone: contact.phone,
    } } });
    if (existing) { skipped++; continue; }
    await db.contact.create({ data: { ...contact, tenantId: req.user.tenantId } });
    imported++;
  }
  return res.json({ imported, skipped, duplicates: parsed.data.contacts.length - unique.length });
}));

app.patch('/api/v1/contacts/:id', auth, handler(async (req: any, res: any) => {
  const parsed = z.object({
    name: z.string().max(120).nullable().optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) return res.status(400).json({ error: 'Invalid contact update' });
  const existing = await db.contact.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Contact not found' });
  if (parsed.data.phone && parsed.data.phone !== existing.phone) {
    const duplicate = await db.contact.findUnique({ where: { tenantId_phone: {
      tenantId: req.user.tenantId, phone: parsed.data.phone,
    } } });
    if (duplicate) return res.status(409).json({ error: 'Phone already exists in this company' });
  }
  const updated = await db.contact.update({ where: { id: existing.id }, data: parsed.data });
  return res.json(updated);
}));

app.delete('/api/v1/contacts/:id', auth, handler(async (req: any, res: any) => {
  const result = await db.contact.deleteMany({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!result.count) return res.status(404).json({ error: 'Contact not found' });
  return res.json({ deleted: true });
}));

app.post('/api/v1/contacts/:id/opt-out', auth, handler(async (req: any, res: any) => {
  const result = await db.contact.updateMany({ where: {
    id: req.params.id, tenantId: req.user.tenantId,
  }, data: { consent: false } });
  if (!result.count) return res.status(404).json({ error: 'Contact not found' });
  return res.json({ suppressed: true });
}));

// Search consented contacts for explicit campaign recipient selection.
app.get('/api/v1/campaigns/eligible-contacts', auth, handler(async (req: any, res: any) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const contacts = await db.contact.findMany({
    where: { tenantId: req.user.tenantId, consent: true,
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) },
    select: { id: true, name: true, phone: true }, orderBy: { createdAt: 'desc' }, take: 500,
  });
  return res.json(contacts);
}));

// Campaign drafts are tenant-scoped. No messages are sent by these endpoints.
app.get('/api/v1/campaigns', auth, handler(async (req: any, res: any) => {
  const campaigns = await db.campaign.findMany({
    where: { tenantId: req.user.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json(campaigns);
}));

app.get('/api/v1/campaigns/audience-preview', auth, handler(async (req: any, res: any) => {
  const [eligible, optedOut] = await db.$transaction([
    db.contact.count({ where: { tenantId: req.user.tenantId, consent: true } }),
    db.contact.count({ where: { tenantId: req.user.tenantId, consent: false } }),
  ]);
  return res.json({ eligible, optedOut, total: eligible + optedOut, note: 'Estimate only; no contacts selected or messages queued' });
}));

const campaignDraftSchema = z.object({
  recipientIds: z.array(z.string().min(1)).min(1).max(500),
  name: z.string().trim().min(2).max(120),
  templateName: z.string().trim().min(1).max(120).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
  connectionId: z.string().min(1).optional(),
  templateLanguage: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).optional(),
  templateComponents: z.array(z.record(z.unknown())).max(10).optional(),
}).strict();

app.post('/api/v1/campaigns', auth, handler(async (req: any, res: any) => {
  const parsed = campaignDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign name or template identifier' });
  const recipientIds = [...new Set(parsed.data.recipientIds || [])];
  {
    const count = await db.contact.count({ where: { tenantId: req.user.tenantId, id: { in: recipientIds }, consent: true } });
    if (count !== recipientIds.length) return res.status(400).json({ error: 'Select only opted-in contacts from your company' });
  }
  if(parsed.data.connectionId){
    const conn=await db.whatsAppConnection.findFirst({where:{id:parsed.data.connectionId,tenantId:req.user.tenantId}});
    if(!conn)return res.status(400).json({error:'Connection does not belong to this company'});
    if(!parsed.data.templateLanguage)return res.status(400).json({error:'Template language required'});
  }
  const campaign = await db.campaign.create({ data: {
    tenantId: req.user.tenantId, name: parsed.data.name, templateName: parsed.data.templateName,
    connectionId:parsed.data.connectionId||null,templateLanguage:parsed.data.templateLanguage||null,
    templateComponents:parsed.data.templateComponents||[],recipientIds, status: 'DRAFT',
  } });
  return res.status(201).json(campaign);
}));

app.patch('/api/v1/campaigns/:id', auth, handler(async (req: any, res: any) => {
  const parsed = campaignDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign name or template identifier' });
  const recipientIds = [...new Set(parsed.data.recipientIds || [])];
  {
    const count = await db.contact.count({ where: { tenantId: req.user.tenantId, id: { in: recipientIds }, consent: true } });
    if (count !== recipientIds.length) return res.status(400).json({ error: 'Select only opted-in contacts from your company' });
  }
  if(parsed.data.connectionId){
    const conn=await db.whatsAppConnection.findFirst({where:{id:parsed.data.connectionId,tenantId:req.user.tenantId}});
    if(!conn)return res.status(400).json({error:'Connection does not belong to this company'});
    if(!parsed.data.templateLanguage)return res.status(400).json({error:'Template language required'});
  }
  const updated = await db.campaign.updateMany({
    where: { id: req.params.id, tenantId: req.user.tenantId, status: 'DRAFT' },
    data: { name: parsed.data.name, templateName: parsed.data.templateName, recipientIds,
      connectionId:parsed.data.connectionId||null,templateLanguage:parsed.data.templateLanguage||null,
      templateComponents:parsed.data.templateComponents||[] },
  });
  if (!updated.count) return res.status(404).json({ error: 'Editable draft not found' });
  return res.json(await db.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } }));
}));

app.delete('/api/v1/campaigns/:id', auth, handler(async (req: any, res: any) => {
  const deleted = await db.campaign.deleteMany({
    where: { id: req.params.id, tenantId: req.user.tenantId, status: 'DRAFT' },
  });
  if (!deleted.count) return res.status(404).json({ error: 'Deletable draft not found' });
  return res.json({ deleted: true });
}));

// Standalone local mock-only API. Live Meta sending is never enabled here.
const mockEnabled = () => process.env.SEND_MODE === 'mock' && process.env.META_CAMPAIGN_SEND_ENABLED !== 'true';
app.get('/api/v1/campaigns/mock-mode', auth, requireWhatsAppAdmin, (_req, res) => {
  res.json({ enabled: mockEnabled() });
});
app.post('/api/v1/campaigns/:id/mock-start', auth, requireWhatsAppAdmin, handler(async (req: any, res: any) => {
  if (!mockEnabled()) return res.status(403).json({ error: 'Mock mode required' });
  const campaign = await db.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId, status: 'DRAFT' } });
  if (!campaign) return res.status(404).json({ error: 'Draft campaign not found' });
  const result = await enqueueCampaign(campaign.id, req.user.tenantId);
  return res.status(202).json({ ...result, mode: 'mock' });
}));
app.get('/api/v1/campaigns/:id/mock-progress', auth, requireWhatsAppAdmin, handler(async(req: any, res: any) => {
  if (!mockEnabled()) return res.status(403).json({ error: 'Mock mode required' });
  const campaign = await db.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  return res.json(await getMockCampaignProgress(campaign.id, req.user.tenantId));
}));
// Tenant-scoped mock analytics. These are simulations, not WhatsApp delivery receipts.
app.get('/api/v1/campaigns/mock-analytics', auth, requireWhatsAppAdmin, handler(async (req: any, res: any) => {
  if (!mockEnabled()) return res.status(403).json({ error: 'Mock mode required' });
  const tenantId = req.user.tenantId;
  const [campaigns, grouped] = await db.$transaction([
    db.campaign.groupBy({ by: ['status'], where: { tenantId }, orderBy: { status: 'asc' }, _count: { _all: true } }),
    db.mockCampaignDelivery.groupBy({ by: ['status'], where: { tenantId }, orderBy: { status: 'asc' }, _count: { _all: true } }),
  ]);
  return res.json(aggregateMockStats(campaigns, grouped));
}));

app.get('/api/v1/campaigns/:id/mock-history', auth, requireWhatsAppAdmin, handler(async (req: any, res: any) => {
  if (!mockEnabled()) return res.status(403).json({ error: 'Mock mode required' });
  const history = await getMockDeliveryHistory(req.params.id, req.user.tenantId);
  return res.json({ history });
}));
app.post('/api/v1/campaigns/:id/mock-retry', auth, requireWhatsAppAdmin, handler(async(req: any, res: any) => {
  if (!mockEnabled()) return res.status(403).json({ error: 'Mock mode required' });
  try {
    return res.status(202).json(await retryFailedMockCampaign(req.params.id, req.user.tenantId));
  } catch(error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Retry failed' });
  }
}));

// Live sending requires explicit pilot flags. Normal campaign start remains disabled.
app.get('/api/v1/campaigns/live-mode',auth,requireWhatsAppAdmin,(_req,res)=>res.json({enabled:liveEnabled(),maxRecipients:2}));
app.get('/api/v1/campaigns/:id/live-progress',auth,requireWhatsAppAdmin,handler(async(req:any,res:any)=>{
 return res.json(await liveProgress(req.params.id,req.user.tenantId));
}));
app.post('/api/v1/campaigns/:id/live-pilot-start',auth,requireWhatsAppAdmin,handler(async(req:any,res:any)=>{
 if(!liveEnabled())return res.status(403).json({error:'Live pilot feature disabled'});
 try{return res.status(202).json(await startLivePilot(req.params.id,req.user.tenantId))}
 catch(err){return res.status(409).json({error:err instanceof Error?err.message:'Live pilot not available'})}
}));

// Do not enable sending without approved templates, audience selection,
// consent checks, a durable per-number queue, rate limits and webhook reporting.
app.post('/api/v1/campaigns/:id/start', auth, (_req, res) => {
  return res.status(501).json({ error: 'Campaign sending is not configured yet' });
});

// Centralized error handler
app.use(
  (err: any, _req: any, res: any, _next: any) => {
    console.error(err);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
);

// Start server
const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
