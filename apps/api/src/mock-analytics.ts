export type StatusRow = { status: string; _count: { _all: number } };
export function aggregateMockStats(campaignRows: StatusRow[], deliveryRows: StatusRow[]) {
 const sum=(rows:StatusRow[],status:string)=>rows.find(x=>x.status===status)?._count._all||0;
 return {
  mode:'MOCK_ONLY' as const,
  campaigns:{
   total:campaignRows.reduce((n,row)=>n+row._count._all,0),
   completed:sum(campaignRows,'COMPLETED'),
   partial:sum(campaignRows,'PARTIAL'),
   failed:sum(campaignRows,'FAILED'),
   queued:sum(campaignRows,'QUEUED')
  },
  deliveries:{
   mockSent:sum(deliveryRows,'MOCK_SENT'),
   failed:sum(deliveryRows,'FAILED'),
   skipped:sum(deliveryRows,'SKIPPED'),
   queued:sum(deliveryRows,'QUEUED'),
   active:sum(deliveryRows,'ACTIVE')
  }
 };
}
