import 'dotenv/config';
import express from 'express';
import cors from 'cors';
const app=express();app.use(cors({origin:process.env.WEB_ORIGIN||'http://localhost:3000'}));app.use(express.json());
app.get('/health',(_req,res)=>res.json({status:'ok'}));
app.post('/api/v1/campaigns/:id/start',(_req,res)=>res.status(501).json({error:'Sending disabled pending provider and compliance checks'}));
app.listen(Number(process.env.PORT||4000),()=>console.log('API ready'));
