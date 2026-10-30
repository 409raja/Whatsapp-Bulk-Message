'use client';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type Campaign = { id: string; name: string; templateName: string; status: string; createdAt: string };
type Audience = { eligible: number; optedOut: number; total: number };
const input: CSSProperties = { padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', boxSizing: 'border-box' };
const btn: CSSProperties = { padding: '10px 15px', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', background: '#fff' };

export default function CampaignsManager({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
      const [items, counts] = await Promise.all([
        request('/api/v1/campaigns', { signal }),
        request('/api/v1/campaigns/audience-preview', { signal }),
      ]);
      if (!signal?.aborted) { setCampaigns(items); setAudience(counts); }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Failed to load campaigns'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [request]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function reset() { setEditing(null); setName(''); setTemplateName(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    const payload = { name: name.trim(), templateName: templateName.trim() };
    if (payload.name.length < 2 || !/^[a-z0-9_]+$/.test(payload.templateName)) {
      setError('Enter a campaign name and a lowercase template identifier (letters, digits, underscores)'); return;
    }
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
  const filtered = campaigns.filter(c =>
    (filter === 'ALL' || c.status === filter) &&
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.templateName.toLowerCase().includes(search.toLowerCase()))
  );
  return <section style={{ padding: 24, border: '1px solid #e2e8f0', borderRadius: 14, background: 'white', marginTop: 24 }}>
    <h2>Campaign Management</h2>
    <p style={{ color: '#64748b' }}>Create and manage campaign drafts. Sending is disabled until Meta integration and compliance checks are ready.</p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#047857' }}>{message}</p>}
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '18px 0' }}>
      {[
        ['Saved Campaigns', campaigns.length],
        ['Eligible Opted-in Contacts', audience?.eligible ?? '—'],
        ['Opted-out Contacts', audience?.optedOut ?? '—'],
      ].map(([label, value]) => <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, minWidth: 175, flex: 1 }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>{label}</div><strong style={{ fontSize: 25 }}>{value}</strong>
      </div>)}
    </div>
    <form onSubmit={save} style={{ display: 'grid', gap: 12, maxWidth: 520, marginBottom: 26 }}>
      <h3 style={{ margin: '0 0 3px' }}>{editing ? 'Edit Campaign Draft' : 'New Campaign Draft'}</h3>
      <label>Campaign Name<input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="Customer Updates" minLength={2} maxLength={120} required /></label>
      <label>WhatsApp Template Identifier<input style={input} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="customer_update" maxLength={120} required /></label>
      <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>Template name is saved as a draft reference. Meta approval is not yet verified here.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...btn, background: '#1769aa', color: 'white' }}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Campaign'}</button>
        {editing && <button type="button" style={btn} onClick={reset}>Cancel</button>}
      </div>
    </form>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <input aria-label="Search campaigns" style={{ ...input, maxWidth: 320 }} placeholder="Search campaign or template" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Campaign status" style={{ ...input, width: 160 }} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="ALL">All statuses</option><option value="DRAFT">Drafts</option>
      </select>
      <button type="button" disabled={loading} onClick={() => void load()} style={btn}>{loading ? 'Loading...' : 'Refresh'}</button>
    </div>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left' }}>
        <thead><tr>{['Campaign', 'Template', 'Status', 'Created', 'Actions'].map(h => <th key={h} style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map(c => <tr key={c.id}>
          <td style={{ padding: 12 }}>{c.name}</td><td style={{ padding: 12 }}>{c.templateName}</td>
          <td style={{ padding: 12 }}>{c.status}</td><td style={{ padding: 12 }}>{new Date(c.createdAt).toLocaleString()}</td>
          <td style={{ padding: 12 }}>{c.status === 'DRAFT' && <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} disabled={saving} onClick={() => { setEditing(c.id); setName(c.name); setTemplateName(c.templateName); }}>Edit</button>
            <button style={btn} disabled={saving} onClick={() => void remove(c)}>Delete</button>
          </div>}</td>
        </tr>)}</tbody>
      </table>
      {!loading && !filtered.length && <p>No matching campaigns.</p>}
    </div>
    <p style={{ color: '#64748b', fontSize: 13, marginTop: 20 }}>Audience counts are estimates, not a selected recipient list. No campaign messages are queued or sent.</p>
  </section>;
}
