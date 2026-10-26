export type Plan='TRIAL'|'STARTER'|'GROWTH'|'BUSINESS';
export const planLimits:Record<Plan,{contacts:number;campaignsPerMonth:number}>={
 TRIAL:{contacts:100,campaignsPerMonth:2},
 STARTER:{contacts:1000,campaignsPerMonth:20},
 GROWTH:{contacts:10000,campaignsPerMonth:100},
 BUSINESS:{contacts:100000,campaignsPerMonth:1000}
};
export function canCreateCampaign(plan:Plan,used:number){return used<planLimits[plan].campaignsPerMonth}
