import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const db = new PrismaClient();

router.post('/events', async (req, res) => {
  const secret = process.env.CRM_WEBHOOK_BRIDGE_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: 'Bridge not configured' });
  const timestamp = String(req.header('x-bridge-timestamp') || '');
  const signature = String(req.header('x-bridge-signature') || '');
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > 5 * 60_000 || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    return res.status(401).json({ error: 'Invalid bridge authentication' });
  }
  const expected = 'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + JSON.stringify(req.body)).digest('hex');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return res.status(401).json({ error: 'Invalid bridge authentication' });
  const body = req.body;
  if (!body || body.type !== 'whatsapp.status' || typeof body.phoneNumberId !== 'string' ||
      typeof body.messageId !== 'string' || !/^wamid\./.test(body.messageId) ||
      !['sent','delivered','read','failed'].includes(body.status) ||
      typeof body.eventTime !== 'string' || !/^[0-9]{1,15}$/.test(body.eventTime)) {
    return res.status(400).json({ error: 'Invalid status event' });
  }
  const connection = await db.whatsAppConnection.findUnique({ where: { phoneNumberId: body.phoneNumberId }, select: { id: true } });
  if (!connection) return res.status(202).json({ accepted: false });
  const eventKey = createHmac('sha256', secret).update(JSON.stringify([connection.id, body.messageId, body.status, body.eventTime])).digest('hex');
  await db.whatsAppDeliveryEvent.upsert({
    where: { eventKey },
    create: { eventKey, connectionId: connection.id, messageId: body.messageId, status: body.status, eventTime: body.eventTime },
    update: {},
  });
  return res.json({ accepted: true });
});

export default router;
