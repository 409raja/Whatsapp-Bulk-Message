import { describe, it, expect } from 'vitest';
import { normalizeApprovedTemplates, metaGraphVersion } from './meta-templates';

describe('Meta approved template discovery', () => {
  it('returns approved metadata without private components', () => {
    const templates=normalizeApprovedTemplates([
      {id:'1',name:'hello_world',status:'APPROVED',language:'en_US',category:'UTILITY',
       components:[{type:'BODY',text:'Hello {{1}}'}]},
      {id:'2',name:'rejected',status:'REJECTED',language:'en_US',category:'MARKETING'},
      {id:'3',name:'tricky name',status:'APPROVED',language:'en_US'},
    ]);
    expect(templates).toEqual([{id:'1',name:'hello_world',language:'en_US',status:'APPROVED',
      category:'UTILITY',parameterized:true}]);
  });
  it('handles invalid responses and rejects invalid graph versions',()=>{
    expect(normalizeApprovedTemplates(null)).toEqual([]);
    expect(metaGraphVersion('v23.0')).toBe('v23.0');
    expect(()=>metaGraphVersion('https://example.com')).toThrow();
  });
});
