import type {PrismaClient} from '@prisma/client';
export async function dashboardSummary(db:PrismaClient,tenantId:string){
 const [contacts,optedIn,campaigns,drafts,queued]=await Promise.all([
 db.contact.count({where:{tenantId}}),
 db.contact.count({where:{tenantId,consent:true}}),
 db.campaign.count({where:{tenantId}}),
 db.campaign.count({where:{tenantId,status:'DRAFT'}}),
 db.campaign.count({where:{tenantId,status:'QUEUED'}})
 ]);
 return {contacts,optedIn,campaigns,drafts,queued,deliveryStatsAvailable:false};
}
