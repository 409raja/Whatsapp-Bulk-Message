
import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { encryptToken } from './encryption';

const router = Router();
const db = new PrismaClient();

type AuthUser = {
  sub: string;
  tenantId: string;
};

const asyncHandler = (
  fn: (req: Request, res: Response) => Promise<unknown>
) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

function getUser(req: Request): AuthUser | null {
  const user = (req as any).user;

  if (
    !user ||
    typeof user.sub !== 'string' ||
    typeof user.tenantId !== 'string'
  ) {
    return null;
  }

  return {
    sub: user.sub,
    tenantId: user.tenantId,
  };
}

async function isWhatsAppAdmin(user: AuthUser): Promise<boolean> {
  const membership = await db.membership.findFirst({
    where: {
      userId: user.sub,
      tenantId: user.tenantId,
    },
    select: {
      role: true,
    },
  });

  return (
    !!membership &&
    ['OWNER', 'ADMIN'].includes(membership.role)
  );
}

function hashState(state: string): string {
  return createHash('sha256')
    .update(state)
    .digest('hex');
}

function getMetaConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const configId = process.env.META_CONFIG_ID;
  const version = process.env.META_GRAPH_VERSION || 'v23.0';

  if (
    !appId ||
    !appSecret ||
    !configId ||
    !/^v\d+\.\d+$/.test(version)
  ) {
    throw new Error('Invalid Meta configuration');
  }

  return { appId, appSecret, configId, version };
}

async function metaGet(
  path: string,
  accessToken: string,
  version: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(
    `https://graph.facebook.com/${version}/${path}`
  );

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  const body: any = await response.json();

  if (!response.ok || body.error) {
    throw new Error('Meta API verification failed');
  }

  return body;
}

// Create short-lived signup session
router.post(
  '/start',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    if (!(await isWhatsAppAdmin(user))) {
      return res.status(403).json({
        error: 'OWNER or ADMIN access required',
      });
    }

    const config = getMetaConfig();

    const state = randomBytes(32).toString('hex');
    const stateHash = hashState(state);

    const expiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    );

    await db.whatsAppSignupSession.create({
      data: {
        stateHash,
        userId: user.sub,
        tenantId: user.tenantId,
        expiresAt,
      },
    });

    return res.json({
      state,
      expiresAt,
      appId: config.appId,
      configId: config.configId,
      graphVersion: config.version,
    });
  })
);

// Complete Meta Embedded Signup
const completeSchema = z.object({
  state: z.string().regex(/^[0-9a-f]{64}$/),
  code: z.string().min(1).max(4096),
  wabaId: z.string().regex(/^\d+$/),
  phoneNumberId: z.string().regex(/^\d+$/),
});

router.post(
  '/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    if (!(await isWhatsAppAdmin(user))) {
      return res.status(403).json({
        error: 'OWNER or ADMIN access required',
      });
    }

    const parsed = completeSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid signup completion data',
      });
    }

    const { state, code, wabaId, phoneNumberId } =
      parsed.data;

    const stateHash = hashState(state);
    const now = new Date();

    // Atomic one-time session claim.
    // A second concurrent request cannot claim the same session.
    const claimed = await db.whatsAppSignupSession.updateMany({
      where: {
        stateHash,
        userId: user.sub,
        tenantId: user.tenantId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
      },
    });

    if (claimed.count !== 1) {
      return res.status(400).json({
        error: 'Signup session expired, invalid or already used',
      });
    }

    const config = getMetaConfig();

    // Exchange the single-use Meta authorization code.
    // Never accept an access token directly from the browser.
    const tokenUrl = new URL(
      `https://graph.facebook.com/${config.version}/oauth/access_token`
    );

    tokenUrl.searchParams.set('client_id', config.appId);
    tokenUrl.searchParams.set('client_secret', config.appSecret);
    tokenUrl.searchParams.set('code', code);

    let accessToken: string;

    try {
      const tokenResponse = await fetch(tokenUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      });

      const tokenData: any = await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        typeof tokenData.access_token !== 'string' ||
        !tokenData.access_token
      ) {
        return res.status(400).json({
          error: 'Meta authorization code exchange failed',
        });
      }

      accessToken = tokenData.access_token;
    } catch {
      return res.status(502).json({
        error: 'Could not contact Meta authorization service',
      });
    }

    // Verify that the token can access the supplied WABA.
    // Client-provided IDs are never treated as proof of ownership.
    let waba: any;
    let verifiedPhone: any = null;

    try {
      waba = await metaGet(
        wabaId,
        accessToken,
        config.version,
        { fields: 'id,name' }
      );

      if (String(waba.id) !== wabaId) {
        throw new Error('WABA mismatch');
      }

      // Verify the phone belongs to this WABA.
      let nextUrl: string | undefined =
        `https://graph.facebook.com/${config.version}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`;

      // Follow Meta's paginated phone-number results.
      // Only allow pagination URLs from Graph API.
      for (let page = 0; page < 20 && nextUrl; page++) {
        const pageUrl = new URL(nextUrl);

        if (
          pageUrl.protocol !== 'https:' ||
          pageUrl.hostname !== 'graph.facebook.com'
        ) {
          throw new Error('Invalid Meta pagination URL');
        }

        const phoneResponse = await fetch(pageUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(15000),
        });

        const phoneData: any = await phoneResponse.json();

        if (!phoneResponse.ok || !Array.isArray(phoneData.data)) {
          throw new Error('Phone verification failed');
        }

        verifiedPhone = phoneData.data.find(
          (phone: any) =>
            String(phone.id) === phoneNumberId
        );

        if (verifiedPhone) {
          break;
        }

        nextUrl =
          typeof phoneData.paging?.next === 'string'
            ? phoneData.paging.next
            : undefined;
      }

      if (!verifiedPhone) {
        return res.status(400).json({
          error: 'Phone number does not belong to authorized WABA',
        });
      }
    } catch {
      return res.status(400).json({
        error: 'Meta WABA or phone verification failed',
      });
    }

    // Never reassign an existing phone connection
    // to another tenant automatically.
    const existing = await db.whatsAppConnection.findUnique({
      where: { phoneNumberId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (existing) {
      return res.status(409).json({
        error: 'WhatsApp phone number is already connected',
      });
    }

    const encryptedToken = encryptToken(accessToken);

    try {
      const connection = await db.whatsAppConnection.create({
        data: {
          tenantId: user.tenantId,
          label:
            typeof waba.name === 'string'
              ? waba.name
              : 'WhatsApp Business',
          wabaId,
          phoneNumberId,
          displayPhoneNumber:
            verifiedPhone.display_phone_number || null,
          accessTokenEncrypted: encryptedToken,
          // Additional onboarding checks are still required.
          status: 'PENDING',
        },
        select: {
          id: true,
          label: true,
          wabaId: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          status: true,
        },
      });

      return res.status(201).json({
        message: 'WhatsApp connection saved; activation pending',
        connection,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'WhatsApp connection already exists',
        });
      }

      throw error;
    }
  })
);


const existingAccountSchema = z.object({
  wabaId: z.string().regex(/^\\d{8,25}$/),
  phoneNumberId: z.string().regex(/^\\d{8,25}$/),
  accessToken: z.string().min(30).max(4096),
}).strict();

// Manually link an already registered Meta Cloud API phone; no registration,
// migration, webhook mutation or outgoing message is performed here.
router.post('/existing', asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await isWhatsAppAdmin(user))) return res.status(403).json({ error: 'OWNER or ADMIN access required' });
  const parsed = existingAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    // Return only field names and issue codes; never echo access tokens or request values.
    const fields = [...new Set(parsed.error.issues.map(issue =>
      issue.path.length ? String(issue.path[0]) : 'request'
    ))];
    return res.status(400).json({
      error: `Invalid connection fields: ${fields.join(', ')}`,
      invalidFields: fields,
    });
  }
  const { wabaId, phoneNumberId, accessToken } = parsed.data;
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  if (!/^v\\d+\\.\\d+$/.test(version)) return res.status(500).json({ error: 'Meta Graph version is not configured' });

  let waba: any;
  let verifiedPhone: any;
  try {
    waba = await metaGet(wabaId, accessToken, version, { fields: 'id,name' });
    if (String(waba.id) !== wabaId) throw new Error('WABA mismatch');
    let nextUrl: string | undefined = `https://graph.facebook.com/${version}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`;
    for (let page = 0; page < 20 && nextUrl; page++) {
      const url: URL = new URL(nextUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com' || !url.pathname.startsWith(`/${version}/${wabaId}/phone_numbers`)) throw new Error('Invalid Meta pagination');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
      const data: any = await response.json();
      if (!response.ok || !Array.isArray(data.data)) throw new Error('Phone verification failed');
      verifiedPhone = data.data.find((p: any) => String(p.id) === phoneNumberId);
      if (verifiedPhone) break;
      nextUrl = typeof data.paging?.next === 'string' ? data.paging.next : undefined;
    }
    if (!verifiedPhone) return res.status(400).json({ error: 'Phone number does not belong to this accessible WABA' });
  } catch {
    return res.status(400).json({ error: 'Meta could not verify this token, WABA and phone number. Check permissions and IDs.' });
  }

  const existing = await db.whatsAppConnection.findUnique({ where: { phoneNumberId }, select: { id: true, tenantId: true } });
  if (existing) return res.status(409).json({ error: existing.tenantId === user.tenantId ? 'This number is already connected to your company' : 'This number is already assigned to another company' });
  try {
    const connection = await db.whatsAppConnection.create({
      data: {
        tenantId: user.tenantId,
        label: typeof waba.name === 'string' ? waba.name : 'WhatsApp Business',
        wabaId, phoneNumberId,
        displayPhoneNumber: typeof verifiedPhone.display_phone_number === 'string' ? verifiedPhone.display_phone_number : null,
        accessTokenEncrypted: encryptToken(accessToken),
        status: 'PENDING',
      },
      select: { id: true, label: true, wabaId: true, phoneNumberId: true, displayPhoneNumber: true, status: true },
    });
    return res.status(201).json({ connection, message: 'Existing account verified and saved; activation checks pending' });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'This phone number is already connected' });
    throw error;
  }
}));

export default router;
