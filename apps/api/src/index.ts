import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
const db = new PrismaClient();
const app = express();
app.use(cors({origin: process.env.WEB_ORIGIN || 'http://localhost:3000'}));
app.use(express.json({limit:'1mb'}));
const secret=process.env.JWT_SECRET;
if (!secret || secret.length<32) throw new Error('Set JWT_SECRET (at least 32 characters)');
const handler=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);
function auth(req:any,res:any,next:any){try{const token=(req.headers.authorization||'').replace(/^Bearer /,'');const payload=jwt.verify(token,secret!) as any;req.user=payload;next()}catch{return res.status(401).json({error:'Unauthorized'})}}
app.get('/health',(_req,res)=>res.json({status:'ok'}));
app.post('/api/v1/auth/register',handler(async(req:any,res:any)=>{
 const parsed=z.object({business:z.string().min(2),email:z.string().email(),password:z.string().min(10)}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid registration data'});
 const {business,email,password}=parsed.data;
 if(await db.user.findUnique({where:{email}}))return res.status(409).json({error:'Email already registered'});
 const user=await db.$transaction(async tx=>{const tenant=await tx.tenant.create({data:{name:business}});return tx.user.create({data:{email,passwordHash:await bcrypt.hash(password,12),memberships:{create:{tenantId:tenant.id,role:'OWNER'}}}})});
 res.status(201).json({userId:user.id});
}));
app.post('/api/v1/auth/login',handler(async(req:any,res:any)=>{
 const parsed=z.object({email:z.string().email(),password:z.string(),tenantId:z.string().optional()}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid credentials'});
 const user=await db.user.findUnique({where:{email:parsed.data.email},include:{memberships:true}});
 if(!user||!await bcrypt.compare(parsed.data.password,user.passwordHash))return res.status(401).json({error:'Invalid credentials'});
 const membership=user.memberships.find(m=>m.tenantId===parsed.data.tenantId) || (!req.body.tenantId && user.memberships.length===1 ? user.memberships[0] : undefined);if(!membership)return res.status(403).json({error:'Select an authorized company using tenantId'});
 res.json({token:jwt.sign({sub:user.id,tenantId:membership.tenantId,role:membership.role},secret!,{expiresIn:'8h'})});
}));
app.get('/api/v1/companies',auth,handler(async(req:any,res:any)=>{const memberships=await db.membership.findMany({where:{userId:req.user.sub},include:{tenant:true}});res.json(memberships.map(m=>({id:m.tenant.id,name:m.tenant.name,role:m.role})));}));
app.get('/api/v1/whatsapp/connections',auth,handler(async(req:any,res:any)=>res.json(await db.whatsAppConnection.findMany({where:{tenantId:req.user.tenantId},select:{id:true,label:true,wabaId:true,phoneNumberId:true,displayPhoneNumber:true,status:true,createdAt:true}}))));
app.get('/api/v1/contacts',auth,handler(async(req:any,res:any)=>res.json(await db.contact.findMany({where:{tenantId:req.user.tenantId},orderBy:{createdAt:'desc'},take:100}))));
app.post('/api/v1/contacts',auth,handler(async(req:any,res:any)=>{
 const parsed=z.object({name:z.string().max(120).optional(),phone:z.string().regex(/^\+[1-9]\d{7,14}$/),consent:z.literal(true)}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Valid E.164 phone and explicit consent required'});
 const contact=await db.contact.upsert({where:{tenantId_phone:{tenantId:req.user.tenantId,phone:parsed.data.phone}},create:{tenantId:req.user.tenantId,...parsed.data},update:{name:parsed.data.name,consent:true}});
 res.status(201).json(contact);
}));
app.post('/api/v1/contacts/import',auth,handler(async(req:any,res:any)=>{
 const parsed=z.object({contacts:z.array(z.object({phone:z.string().regex(/^\\+[1-9]\\d{7,14}$/),name:z.string().max(120).optional(),consent:z.literal(true)})).min(1).max(500)}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Provide up to 500 opted-in contacts with valid E.164 numbers'});
 const unique=[...new Map(parsed.data.contacts.map(c=>[c.phone,c])).values()];
 let imported=0;
 for(const c of unique){await db.contact.upsert({where:{tenantId_phone:{tenantId:req.user.tenantId,phone:c.phone}},create:{...c,tenantId:req.user.tenantId},update:{name:c.name,consent:true}});imported++}
 res.json({imported,duplicates:parsed.data.contacts.length-imported});
}));
app.post('/api/v1/contacts/:id/opt-out',auth,handler(async(req:any,res:any)=>{
 const result=await db.contact.updateMany({where:{id:req.params.id,tenantId:req.user.tenantId},data:{consent:false}});
 if(!result.count)return res.status(404).json({error:'Contact not found'});
 res.json({suppressed:true});
}));
app.get('/api/v1/campaigns',auth,handler(async(req:any,res:any)=>res.json(await db.campaign.findMany({where:{tenantId:req.user.tenantId},orderBy:{createdAt:'desc'},take:100}))));
app.post('/api/v1/campaigns',auth,handler(async(req:any,res:any)=>{
 const parsed=z.object({name:z.string().min(2),templateName:z.string().min(1)}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid campaign'});
 res.status(201).json(await db.campaign.create({data:{tenantId:req.user.tenantId,...parsed.data,status:'DRAFT'}}));
}));
app.post('/api/v1/campaigns/:id/start',auth,(_req,res)=>res.status(501).json({error:'Sending disabled until official provider, template validation, opt-out and durable queue are configured'}));
app.use((err:any,_req:any,res:any,_next:any)=>{console.error(err);res.status(500).json({error:'Internal server error'})});
app.listen(Number(process.env.PORT||4000),()=>console.log('API listening'));
