
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import whatsappSignupRouter from './whatsapp-signup';


const db = new PrismaClient();
const app = express();

app.disable('x-powered-by');

app.use(
  cors({
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  })
);

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

// List contacts
app.get(
  '/api/v1/contacts',
  auth,
  handler(async (req: any, res: any) => {
    const contacts = await db.contact.findMany({
      where: {
        tenantId: req.user.tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    return res.json(contacts);
  })
);

// Create contact
app.post(
  '/api/v1/contacts',
  auth,
  handler(async (req: any, res: any) => {
    const parsed = z
      .object({
        name: z.string().max(120).optional(),
        phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
        consent: z.literal(true),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Valid E.164 phone and explicit consent required',
      });
    }

    const contact = await db.contact.upsert({
      where: {
        tenantId_phone: {
          tenantId: req.user.tenantId,
          phone: parsed.data.phone,
        },
      },
      create: {
        tenantId: req.user.tenantId,
        ...parsed.data,
      },
      update: {
        name: parsed.data.name,
        consent: true,
      },
    });

    return res.status(201).json(contact);
  })
);

// Import opted-in contacts
app.post(
  '/api/v1/contacts/import',
  auth,
  handler(async (req: any, res: any) => {
    const parsed = z
      .object({
        contacts: z
          .array(
            z.object({
              phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
              name: z.string().max(120).optional(),
              consent: z.literal(true),
            })
          )
          .min(1)
          .max(500),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error:
          'Provide up to 500 opted-in contacts with valid E.164 numbers',
      });
    }

    const unique = [
      ...new Map(
        parsed.data.contacts.map((c) => [c.phone, c])
      ).values(),
    ];

    let imported = 0;

    for (const contact of unique) {
      await db.contact.upsert({
        where: {
          tenantId_phone: {
            tenantId: req.user.tenantId,
            phone: contact.phone,
          },
        },
        create: {
          ...contact,
          tenantId: req.user.tenantId,
        },
        update: {
          name: contact.name,
          consent: true,
        },
      });

      imported++;
    }

    return res.json({
      imported,
      duplicates: parsed.data.contacts.length - imported,
    });
  })
);

// Opt out contact
app.post(
  '/api/v1/contacts/:id/opt-out',
  auth,
  handler(async (req: any, res: any) => {
    const result = await db.contact.updateMany({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
      },
      data: {
        consent: false,
      },
    });

    if (!result.count) {
      return res.status(404).json({
        error: 'Contact not found',
      });
    }

    return res.json({
      suppressed: true,
    });
  })
);

// List campaigns
app.get(
  '/api/v1/campaigns',
  auth,
  handler(async (req: any, res: any) => {
    const campaigns = await db.campaign.findMany({
      where: {
        tenantId: req.user.tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    return res.json(campaigns);
  })
);

// Create draft campaign
app.post(
  '/api/v1/campaigns',
  auth,
  handler(async (req: any, res: any) => {
    const parsed = z
      .object({
        name: z.string().min(2),
        templateName: z.string().min(1),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid campaign',
      });
    }

    const campaign = await db.campaign.create({
      data: {
        tenantId: req.user.tenantId,
        ...parsed.data,
        status: 'DRAFT',
      },
    });

    return res.status(201).json(campaign);
  })
);

// Campaign sending remains disabled until provider setup,
// approved templates, consent enforcement, and queue are ready.
app.post(
  '/api/v1/campaigns/:id/start',
  auth,
  (_req, res) => {
    return res.status(501).json({
      error:
        'Sending disabled until official provider, template validation, opt-out and durable queue are configured',
    });
  }
);

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
