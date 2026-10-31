'use client';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type Campaign = { id: string; name: string; templateName: string; status: string; createdAt: string; recipientIds?: string[]; connectionId?:string|null;templateLanguage?:string|null;templateComponents?:unknown[] };
type Contact = { id: string; name: string | null; phone: string };
type Audience = { eligible: number; optedOut: number; total: number };
type WhatsAppConnection = {id:string;label:string;displayPhoneNumber:string|null;status:string};
type ApprovedTemplate = {id:string;name:string;language:string;category:string;parameterized:boolean};
type MockAnalytics = {mode:string;campaigns:{total:number;completed:number;partial:number;failed:number;queued:number};deliveries:{mockSent:number;failed:number;skipped:number;queued:number;active:number}};
const input: CSSProperties = { padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', boxSizing: 'border-box' };

export default function CampaignsManager({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [audience, setAudience] = useState<Audience | null>(null);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateLanguage,setTemplateLanguage]=useState('en_US');
  const [templateComponents,setTemplateComponents]=useState('[]');
  const [verification,setVerification]=useState('');
  const [liveHistory,setLiveHistory]=useState<Record<string,string>>({});
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [approvedTemplates, setApprovedTemplates] = useState<ApprovedTemplate[]>([]);
  const [templateLookupNote, setTemplateLookupNote] = useState('');
  const [templateLookupLoading, setTemplateLookupLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mockEnabled, setMockEnabled] = useState(false);
  const [livePilotEnabled,setLivePilotEnabled]=useState(false);
  const [analytics, setAnalytics] = useState<MockAnalytics|null>(null);
  const [mockProgress, setMockProgress] = useState<Record<string,string>>({});
  const [mockHistory, setMockHistory] = useState<Record<string, Array<{contactId:string;status:string;attempts:number;lastError:string|null}>>>({});
  const [openHistory, setOpenHistory] = useState<string|null>(null);
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(API + path, { ...init, headers: {
      Authorization: 'Bearer ' + token,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed: ' + response.status);
    return data;
  }, [token]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [items, counts, eligibleContacts] = await Promise.all([
        request('/api/v1/campaigns', { signal }),
        request('/api/v1/campaigns/audience-preview', { signal }),
        request('/api/v1/campaigns/eligible-contacts', { signal }),
      ]);
      if (!signal?.aborted) { setCampaigns(items); setAudience(counts); setContacts(eligibleContacts); }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Failed to load campaigns'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [request]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    let cancelled=false;
    void request('/api/v1/whatsapp/connections').then((items: WhatsAppConnection[]) => {
      if (!cancelled) setConnections(items);
    }).catch(() => { if (!cancelled) setConnections([]); });
    return () => { cancelled=true; };
  },[request]);
  async function verifyPhone() {
    if(!connectionId)return;
    setVerification('Checking phone with Meta…');
    try {
      const x=await request('/api/v1/whatsapp/connections/'+encodeURIComponent(connectionId)+'/verify-phone',{method:'POST'});
      setVerification(x.verified?'Verified and ACTIVE: '+(x.displayPhoneNumber||'business number'):
        'Not active: Meta status '+(x.metaStatus||'unknown')+'; verification '+(x.codeVerificationStatus||'unknown'));
      const items=await request('/api/v1/whatsapp/connections');
      setConnections(items);
    }catch(e){setVerification(e instanceof Error?e.message:'Verification failed')}
  }
  async function checkLiveProgress(c:Campaign) {
    try {
      const x=await request('/api/v1/campaigns/'+encodeURIComponent(c.id)+'/live-progress');
      setLiveHistory(prev=>({...prev,[c.id]:(x.deliveries||[]).map((d:any)=>
        d.status+' · Contact '+String(d.contactId).slice(0,8)+' · Attempts '+d.attempts).join(' | ')||'No live sends'}));
    }catch(e){setError(e instanceof Error?e.message:'Live history unavailable')}
  }
  async function lookUpApprovedTemplates() {
    if (!connectionId) return;
    setTemplateLookupLoading(true);
    setTemplateLookupNote('');
    setApprovedTemplates([]);
    try {
      const data=await request('/api/v1/whatsapp/connections/'+encodeURIComponent(connectionId)+'/approved-templates');
      setApprovedTemplates(data.templates||[]);
      setTemplateLookupNote((data.templates||[]).length
        ? 'Approved templates loaded. '+(data.hasMore ? 'Only first 100 fetched. ' : '')+'Live sending remains disabled.'
        : 'No approved templates returned for this connection; check WABA, token and permissions.');
    } catch(e) {
      setTemplateLookupNote(e instanceof Error?e.message:'Template lookup failed');
    } finally { setTemplateLookupLoading(false); }
  }
  function reset() { setEditing(null); setName(''); setTemplateName(''); setTemplateLanguage('en_US'); setTemplateComponents('[]'); setConnectionId(''); setSelected([]); setComposerOpen(false); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    let parsedComponents:Record<string,unknown>[];
    try {
      const value=JSON.parse(templateComponents);
      if(!Array.isArray(value)||value.length>10||value.some(x=>!x||typeof x!=='object'||Array.isArray(x))) throw Error();
      parsedComponents=value;
    } catch {setError('Template components must be a JSON array (e.g. []), maximum 10 objects');return;}
    const payload = { name: name.trim(), templateName: templateName.trim(), recipientIds: selected,
      ...(connectionId?{connectionId,templateLanguage,templateComponents:parsedComponents}:{}) };
    if (payload.name.length < 2 || !/^[a-z0-9_]+$/.test(payload.templateName)) {
      setError('Enter a campaign name and a lowercase template identifier (letters, digits, underscores)'); return;
    }
    if (!selected.length) { setError('Select at least one opted-in customer'); return; }
    setSaving(true);
    try {
      await request(editing ? '/api/v1/campaigns/' + encodeURIComponent(editing) : '/api/v1/campaigns', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      setMessage(editing ? 'Draft updated' : 'Draft campaign created');
      reset(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  async function remove(campaign: Campaign) {
    if (!window.confirm('Delete draft "' + campaign.name + '"?')) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await request('/api/v1/campaigns/' + encodeURIComponent(campaign.id), { method: 'DELETE' });
      if (editing === campaign.id) reset();
      setMessage('Draft deleted'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    void request('/api/v1/campaigns/live-mode').then(x=>setLivePilotEnabled(Boolean(x.enabled))).catch(()=>setLivePilotEnabled(false));
  },[request]);
  useEffect(() => {
    void request('/api/v1/campaigns/mock-mode').then(data=>setMockEnabled(Boolean(data.enabled))).catch(()=>setMockEnabled(false));
  },[request]);
  async function mockStart(c:Campaign) {
    setSaving(true); setError(''); setMessage('');
    try {
      await request('/api/v1/campaigns/'+encodeURIComponent(c.id)+'/mock-start',{method:'POST'});
      setMessage('Mock campaign queued; no real WhatsApp message sent');
      await load(); await checkMock(c.id);
    } catch(e) { setError(e instanceof Error ? e.message : 'Mock start failed'); }
    finally { setSaving(false); }
  }
  async function checkMock(id:string) {
    try {
      const r=await request('/api/v1/campaigns/'+encodeURIComponent(id)+'/mock-progress');
      const c=r.counts||{};
      setMockProgress(p=>({...p,[id]:'MOCK_SENT '+(c.MOCK_SENT||0)+'/'+r.total+' | Active '+(c.active||0)+' | Failed '+(c.failed||0)}));
    } catch(e) { setError(e instanceof Error ? e.message : 'Progress check failed'); }
  }
  const refreshAnalytics = useCallback(async () => {
    try {
      const data=await request('/api/v1/campaigns/mock-analytics');
      if (data?.mode==='MOCK_ONLY') setAnalytics(data);
    } catch { setAnalytics(null); }
  },[request]);
  useEffect(() => { if (mockEnabled) void refreshAnalytics(); },[mockEnabled, refreshAnalytics, campaigns.map(c=>c.id+':'+c.status).join('|')]);
  async function historyMock(c:Campaign) {
    if (openHistory===c.id) { setOpenHistory(null);return; }
    setError('');
    try {
      const result=await request('/api/v1/campaigns/'+encodeURIComponent(c.id)+'/mock-history');
      setMockHistory(prev=>({...prev,[c.id]:result.history||[]}));
      setOpenHistory(c.id);
    } catch(e) {setError(e instanceof Error?e.message:'History unavailable');}
  }
  async function startPilot(c:Campaign){
    if(!livePilotEnabled||!c.connectionId)return;
    if(!window.confirm('Send REAL approved template to '+(c.recipientIds?.length||0)+' opted-in contacts? This is billable and cannot be undone.'))return;
    setSaving(true);setError('');
    try{
      await request('/api/v1/campaigns/'+encodeURIComponent(c.id)+'/live-pilot-start',{method:'POST'});
      setMessage('Live pilot queued. Meta acceptance is NOT delivery confirmation.');
      await load();await checkLiveProgress(c);
    }catch(e){setError(e instanceof Error?e.message:'Live pilot unavailable')}
    finally{setSaving(false)}
  }
  async function retryMock(c:Campaign) {
    setSaving(true); setError(''); setMessage('');
    try {
      const result=await request('/api/v1/campaigns/'+encodeURIComponent(c.id)+'/mock-retry',{method:'POST'});
      setMessage('Retried '+result.retried+' failed mock job(s)');
      await load(); await checkMock(c.id);
    } catch(e) { setError(e instanceof Error ? e.message : 'Retry failed'); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    if (!mockEnabled || !campaigns.some(c => c.status === 'QUEUED')) return;
    let cancelled=false;
    let busy=false;
    const refresh=async () => {
      if (busy || cancelled) return;
      busy=true;
      try {
        const queued=campaigns.filter(c=>c.status==='QUEUED');
        await Promise.all(queued.map(c=>checkMock(c.id)));
        if (!cancelled) await load();
      } finally { busy=false; }
    };
    const id=setInterval(() => { void refresh(); },3000);
    return () => {cancelled=true;clearInterval(id);};
  }, [mockEnabled, campaigns.map(c=>c.id+':'+c.status).join('|')]);
  const filtered = campaigns.filter(c =>
    (filter === 'ALL' || c.status === filter) &&
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.templateName.toLowerCase().includes(search.toLowerCase()))
  );
  return <section className="campaigns-page">
    <header className="manager-page-heading">
      <div>
        <span className="manager-eyebrow">MESSAGING</span>
        <h1>Campaigns</h1>
        <p>Prepare WhatsApp campaign drafts for your opted-in audience.</p>
      </div>
      <div className="campaign-heading-actions">
        <span className="campaigns-paused-badge"><span /> Sending disabled</span>
        <button type="button" className="manager-primary-button" onClick={() => { reset(); setComposerOpen(true); }}>
          <span aria-hidden="true">+</span> New campaign draft
        </button>
      </div>
    </header>

    {error && <p className="manager-feedback manager-feedback-error" role="alert">{error}</p>}
    {message && <p className="manager-feedback manager-feedback-success" role="status">{message}</p>}

    {mockEnabled && analytics && (
      <div className="campaign-stats" aria-label="Mock-only analytics">
        <div className="manager-metric-card"><span className="manager-metric-copy"><small>Simulated messages</small><strong>{analytics.deliveries.mockSent}</strong></span></div>
        <div className="manager-metric-card"><span className="manager-metric-copy"><small>Failed mock attempts</small><strong>{analytics.deliveries.failed}</strong></span></div>
        <div className="manager-metric-card"><span className="manager-metric-copy"><small>Completed mock campaigns</small><strong>{analytics.campaigns.completed}</strong></span></div>
        <div className="manager-metric-card"><span className="manager-metric-copy"><small>Partial / failed campaigns</small><strong>{analytics.campaigns.partial+analytics.campaigns.failed}</strong></span></div>
      </div>
    )}
    <div className="campaign-stats">
      <div className="manager-metric-card">
        <span className="manager-metric-icon metric-icon-violet" aria-hidden="true">▤</span>
        <span className="manager-metric-copy"><small>Saved drafts</small><strong>{loading && !campaigns.length ? '…' : campaigns.length}</strong></span>
      </div>
      <div className="manager-metric-card">
        <span className="manager-metric-icon metric-icon-green" aria-hidden="true">✓</span>
        <span className="manager-metric-copy"><small>Eligible opted-in contacts</small><strong>{audience?.eligible ?? '—'}</strong></span>
      </div>
      <div className="manager-metric-card">
        <span className="manager-metric-icon metric-icon-amber" aria-hidden="true">−</span>
        <span className="manager-metric-copy"><small>Opted-out contacts</small><strong>{audience?.optedOut ?? '—'}</strong></span>
      </div>
    </div>

    {composerOpen && (
      <div
        className="campaign-modal-backdrop"
        onClick={event => {
          if (event.target === event.currentTarget) reset();
        }}
      >
      <form className="campaign-composer" role="dialog" aria-modal="true" aria-labelledby="campaign-composer-title" onSubmit={save}>
        <div className="manager-card-heading">
          <div>
            <span className="manager-eyebrow">{editing ? 'UPDATE DRAFT' : 'NEW DRAFT'}</span>
            <h2 id="campaign-composer-title">{editing ? 'Edit campaign' : 'Build a campaign'}</h2>
            <p>Set up the details and choose your audience.</p>
          </div>
          <button type="button" className="manager-icon-button" aria-label="Close campaign form" onClick={reset}>×</button>
        </div>

        <div className="campaign-form-fields">
          <label className="manager-field">
            Campaign name
            <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer updates" minLength={2} maxLength={120} required />
          </label>
          <label className="manager-field">
            WhatsApp business connection (read-only lookup)
            <select style={input} value={connectionId} onChange={e=>{setConnectionId(e.target.value);setApprovedTemplates([]);setTemplateLookupNote('');}}>
              <option value="">Choose connected number</option>
              {connections.map(c=><option key={c.id} value={c.id}>{c.label} — {c.displayPhoneNumber||'Number pending'} ({c.status})</option>)}
            </select>
          </label>
          <div>
            <button type="button" className="manager-secondary-button" disabled={!connectionId||templateLookupLoading}
              onClick={()=>void lookUpApprovedTemplates()}>{templateLookupLoading?'Checking Meta…':'Load approved templates'}</button>
            <button type="button" className="manager-secondary-button" disabled={!connectionId}
              onClick={()=>void verifyPhone()}>Verify phone status</button>
            {verification&&<p role="status" className="manager-field-hint">{verification}</p>}
            {templateLookupNote && <p role="status" className="manager-field-hint">{templateLookupNote}</p>}
            {approvedTemplates.length>0 && <label className="manager-field">
              Approved Meta template
              <select style={input} value="" onChange={e=>{const t=approvedTemplates.find(x=>x.id===e.target.value);if(t){setTemplateName(t.name);setTemplateLanguage(t.language);}}}>
                <option value="">Select a template for this draft</option>
                {approvedTemplates.map(t=><option key={t.id} value={t.id}>{t.name} ({t.language}, {t.category}{t.parameterized?', variables required':''})</option>)}
              </select>
            </label>}
          </div>
          <label className="manager-field">
            WhatsApp template identifier
            <input style={input} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. customer_update" maxLength={120} required />
            <span className="manager-field-hint">Select your approved template and matching language. Live pilot is separately gated.</span>
          </label>
          <label className="manager-field">Template language
            <input style={input} value={templateLanguage} onChange={e=>setTemplateLanguage(e.target.value)} placeholder="en_US" />
          </label>
          <label className="manager-field">Template component JSON (advanced; leave [] for no variables)
            <textarea style={input} rows={3} value={templateComponents} onChange={e=>setTemplateComponents(e.target.value)} />
            <span className="manager-field-hint">Use Meta's template components schema. Do not include secrets. Variable templates require correct component mapping.</span>
          </label>
        </div>

        <div className="campaign-audience">
          <div className="campaign-audience-heading">
            <div>
              <h3>Choose recipients</h3>
              <p>Only opted-in contacts are available.</p>
            </div>
            <span className="campaign-selected-count">{selected.length} selected</span>
          </div>
          <label className="campaign-contact-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search eligible contacts" placeholder="Search by name or number" value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
          </label>
          <div className="campaign-selection-actions">
            <button type="button" className="manager-text-button" onClick={() => setSelected(contacts.map(c => c.id))}>Select all</button>
            <button type="button" className="manager-text-button" onClick={() => setSelected([])}>Clear selection</button>
          </div>
          <div className="campaign-contact-list">
            {contacts.filter(c => (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch)).map(c =>
              <label className="campaign-contact-option" key={c.id}>
                <input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))} />
                <span className="campaign-contact-avatar">{(c.name || c.phone).charAt(0).toUpperCase()}</span>
                <span className="campaign-contact-details"><strong>{c.name || 'Unnamed contact'}</strong><small>{c.phone}</small></span>
                <span className="campaign-consent-label"><span /> Opted in</span>
              </label>
            )}
            {!contacts.length && <div className="campaign-contact-empty">No opted-in contacts available. Add contacts before creating a draft.</div>}
            {!!contacts.length && !contacts.some(c => (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) || c.phone.includes(contactSearch)) && (
              <div className="campaign-contact-empty">No contacts match your search.</div>
            )}
          </div>
          <p className="campaign-contact-footnote">Up to 500 eligible contacts are available for selection.</p>
        </div>

        <div className="campaign-preview">
          <div className="campaign-preview-icon" aria-hidden="true">▤</div>
          <div className="campaign-preview-copy">
            <strong>Draft preview</strong>
            <span>{name.trim() || 'Campaign name'} <code>{templateName || 'template_id'}</code></span>
          </div>
          <span className="campaign-preview-recipients">{selected.length} recipients</span>
        </div>
        <p className="campaign-template-note">Message content will be available when approved template details are connected. Saving a draft does not send messages.</p>
        <div className="campaign-form-actions">
          <button type="submit" disabled={saving} className="manager-primary-button">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save as draft'}
          </button>
          <button type="button" className="manager-secondary-button" onClick={reset}>Cancel</button>
        </div>
      </form>
      </div>
    )}

    <section className="campaign-list-card">
        <div className="manager-card-heading">
          <div>
            <h2>Saved campaigns</h2>
            <p>Create drafts, run safe mock tests and review progress.</p>
          </div>
          <span className="campaign-list-count">{campaigns.length}</span>
        </div>

        <div className="campaign-toolbar">
          <label className="contact-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          <select aria-label="Campaign status" className="contact-filter" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Drafts</option>
            <option value="QUEUED">Queued</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIAL">Partial</option>
            <option value="FAILED">Failed</option>
          </select>
          <button type="button" className="manager-secondary-button campaign-refresh" disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        <div className="campaign-table-wrap">
          <table className="manager-table campaign-table">
            <thead><tr>{['Campaign name', 'WhatsApp template', 'Audience', 'Status', 'Created', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map(c => (
              <tr key={c.id}>
                <td><strong className="campaign-table-name">{c.name}</strong></td>
                <td><code className="campaign-table-template">{c.templateName}</code></td>
                <td>{Array.isArray(c.recipientIds) ? c.recipientIds.length : '—'}</td>
                <td><span className="campaign-status-badge">{c.status}</span></td>
                <td className="contact-date-cell">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td>
                  {c.status === 'DRAFT' && (
                    <div className="campaign-list-actions">
                      <button aria-label={`Edit ${c.name}`} disabled={saving} onClick={() => { setEditing(c.id); setName(c.name); setTemplateName(c.templateName); setConnectionId(c.connectionId||'');setTemplateLanguage(c.templateLanguage||'en_US');setTemplateComponents(JSON.stringify(c.templateComponents||[])); setSelected(Array.isArray(c.recipientIds) ? c.recipientIds : []); setComposerOpen(true); }}>Edit</button>
                      {mockEnabled && <button disabled={saving} onClick={() => void mockStart(c)}>Start Mock</button>}
                      {livePilotEnabled && Boolean(c.connectionId) && (c.recipientIds?.length||0)<=2 &&
                        <button disabled={saving} onClick={()=>void startPilot(c)}>Start REAL pilot (1–2)</button>}
                      <button aria-label={`Delete ${c.name}`} disabled={saving} onClick={() => void remove(c)}>Delete</button>
                    </div>
                  )}
                  {mockEnabled && c.status === 'QUEUED' && <button disabled={saving} onClick={()=>void checkMock(c.id)}>Check Mock Progress</button>}
                  {mockEnabled && ['FAILED','PARTIAL'].includes(c.status) && <button disabled={saving} onClick={()=>void retryMock(c)}>Retry Failed Mock</button>}
                  {mockEnabled && c.status !== 'DRAFT' && <button disabled={saving} onClick={()=>void historyMock(c)}>{openHistory===c.id?'Hide History':'Mock History'}</button>}
                  {c.connectionId && c.status !== 'DRAFT' && <button disabled={saving} onClick={()=>void checkLiveProgress(c)}>Live status</button>}
                  {liveHistory[c.id] && <small role="status">{liveHistory[c.id]}</small>}
                  {openHistory===c.id && <div role="region" aria-label={c.name+' mock delivery history'} style={{maxHeight:260,overflow:'auto',minWidth:250}}>
                    {(mockHistory[c.id]||[]).map(h=><div key={h.contactId} style={{borderBottom:'1px solid #ddd',padding:'6px 0',fontSize:12}}>
                      <strong>{h.status}</strong> · Contact {h.contactId.slice(0,8)} · Attempts {h.attempts}
                      {h.lastError && <div role="alert">{h.lastError}</div>}
                    </div>)}
                    {(mockHistory[c.id]||[]).length===0 && <small>No history recorded for this campaign</small>}
                  </div>}
                  {mockProgress[c.id] && <small role="status">{mockProgress[c.id]}</small>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !filtered.length && (
            <div className="manager-empty-state">
              <span className="manager-empty-icon" aria-hidden="true">▤</span>
              <strong>{campaigns.length ? 'No matching campaigns' : 'No campaign drafts yet'}</strong>
              <p>{campaigns.length ? 'Try another search or status filter.' : 'Create a draft using the form to get started.'}</p>
            </div>
          )}
          {loading && !campaigns.length && <p className="manager-empty-state">Loading campaigns…</p>}
        </div>
        <p className="campaign-list-footnote">Audience counts are estimates. Mock simulation does not send WhatsApp messages.</p>
    </section>
    <p className="manager-compliance-note"><span aria-hidden="true">i</span> Campaign sending is disabled until Meta integration and compliance checks are ready.</p>
  </section>;
}
