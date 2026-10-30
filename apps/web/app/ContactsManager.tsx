'use client';
import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type Contact = { id: string; name: string | null; phone: string; consent: boolean; createdAt: string };
type Listing = { contacts: Contact[]; total: number; page: number; pages: number; limit: number };
const field: React.CSSProperties = { padding: '11px 12px', border: '1px solid #d5deea', borderRadius: 8, width: '100%', boxSizing: 'border-box' };
const button: React.CSSProperties = { padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: 'white', cursor: 'pointer' };
function csvCell(value: unknown) { const s = String(value ?? ''); return '"' + s.replace(/"/g, '""') + '"'; }
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
export default function ContactsManager({ token }: { token: string }) {
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
    return data;
  }, [token]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ search, consent: filter, page: String(page), limit: '20' });
      const response = await request('/api/v1/contacts?' + qs.toString(), { signal });
      if (!signal?.aborted) {
        const data = response as Listing;
        setItems(data.contacts); setTotal(data.total); setPages(data.pages);
        if (page > data.pages) setPage(data.pages);
      }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Unable to load contacts'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [request, search, filter, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function clearForm() { setEditing(null); setName(''); setPhone(''); setConsent(false); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) { setError('Use E.164 phone format, e.g. +919876543210'); return; }
    if (!editing && !consent) { setError('Explicit WhatsApp consent is required'); return; }
    setBusy(true);
    try {
      await request(editing ? '/api/v1/contacts/' + encodeURIComponent(editing.id) : '/api/v1/contacts', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(editing ? { name: name.trim() || null, phone: phone.trim() } : { name: name.trim() || undefined, phone: phone.trim(), consent: true }),
      });
      setMessage(editing ? 'Contact updated' : 'Contact added'); clearForm(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  async function act(contact: Contact, action: 'delete' | 'opt-out') {
    if (!window.confirm(action === 'delete' ? 'Permanently delete ' + contact.phone + '?' : 'Opt out ' + contact.phone + '?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request('/api/v1/contacts/' + encodeURIComponent(contact.id) + (action === 'opt-out' ? '/opt-out' : ''), { method: action === 'delete' ? 'DELETE' : 'POST' });
      setMessage(action === 'delete' ? 'Contact deleted' : 'Contact opted out'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }
  async function importCsv(file: File) {
    setBusy(true); setError(''); setMessage('');
    try {
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      const headers = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
      const phoneIndex = headers.indexOf('phone'), nameIndex = headers.indexOf('name'), consentIndex = headers.indexOf('consent');
      if (phoneIndex < 0 || consentIndex < 0) throw new Error('CSV requires phone and consent columns (name optional)');
      const contacts = rows.map((row, i) => {
        const permission = (row[consentIndex] || '').trim().toLowerCase();
        if (!['true', 'yes', '1', 'opted in'].includes(permission)) throw new Error('Row ' + (i + 2) + ': explicit consent required for every imported contact');
        const phone = (row[phoneIndex] || '').trim();
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Row ' + (i + 2) + ': invalid international phone');
        return { phone, name: nameIndex < 0 ? undefined : (row[nameIndex] || '').trim(), consent: true };
      });
      if (!contacts.length) throw new Error('No contacts in CSV');
      let imported = 0, skipped = 0;
      for (let i = 0; i < contacts.length; i += 500) {
        const result = await request('/api/v1/contacts/import', { method: 'POST', body: JSON.stringify({ contacts: contacts.slice(i, i + 500) }) });
        imported += result.imported; skipped += result.skipped + result.duplicates;
      }
      setMessage('Imported ' + imported + ' contacts; skipped ' + skipped + ' duplicates/existing records'); setPage(1); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    setBusy(true); setError(''); setMessage('');
    try {
      const contacts: Contact[] = [];
      for (let p = 1; p <= 10000; p++) {
        const data = await request('/api/v1/contacts?' + new URLSearchParams({ page: String(p), limit: '100', search, consent: filter }));
        contacts.push(...data.contacts);
        if (p >= data.pages) break;
      }
      const csv = [['name', 'phone', 'consent', 'createdAt'].join(','), ...contacts.map(c => [c.name, c.phone, c.consent, c.createdAt].map(csvCell).join(','))].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click(); URL.revokeObjectURL(url);
      setMessage('Exported ' + contacts.length + ' contacts');
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setBusy(false); }
  }
  return <section style={{ background: '#fff', padding: 24, borderRadius: 12, marginTop: 24, border: '1px solid #e2e8f0' }}>
    <h2>Contacts Management</h2>
    <p style={{ color: '#64748b' }}>Manage opted-in contacts, imports and suppression safely.</p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#047857' }}>{message}</p>}
    <form onSubmit={save} style={{ maxWidth: 520, display: 'grid', gap: 12, marginBottom: 28 }}>
      <h3 style={{ marginBottom: 0 }}>{editing ? 'Edit contact' : 'Add contact'}</h3>
      <label>Name<input style={field} value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="Contact name" /></label>
      <label>WhatsApp number<input style={field} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" required /></label>
      {!editing && <label style={{ display: 'flex', gap: 10 }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Contact explicitly agreed to receive WhatsApp messages.</label>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy} type="submit" style={{ ...button, background: '#1769aa', color: 'white' }}>{busy ? 'Working...' : editing ? 'Save changes' : 'Add Contact'}</button>
        {editing && <button type="button" onClick={clearForm} style={button}>Cancel</button>}
      </div>
    </form>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <input aria-label="Search contacts" placeholder="Search name or phone" style={{ ...field, width: 260 }} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <select aria-label="Consent filter" style={{ ...field, width: 155 }} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
        <option value="all">All contacts</option><option value="true">Opted in</option><option value="false">Opted out</option>
      </select>
      <button style={button} onClick={() => void load()} disabled={busy || loading}>Refresh</button>
      <button style={button} onClick={() => void exportCsv()} disabled={busy}>Export CSV</button>
      <label style={{ ...button, display: 'inline-block', opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>Import CSV
        <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) void importCsv(file); e.target.value = ''; }} />
      </label>
    </div>
    <p style={{ color: '#64748b' }}>CSV format: name,phone,consent — consent must be true/yes/1 for each row. Only import contacts with verified permission.</p>
    <h3>Saved Contacts ({total})</h3>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
      <thead><tr>{['Name', 'Phone', 'Consent', 'Added', 'Actions'].map(h => <th key={h} style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
      <tbody>{items.map(c => <tr key={c.id}>
        <td style={{ padding: 12 }}>{c.name || '—'}</td><td style={{ padding: 12 }}>{c.phone}</td>
        <td style={{ padding: 12 }}>{c.consent ? 'Opted in' : 'Opted out'}</td>
        <td style={{ padding: 12 }}>{new Date(c.createdAt).toLocaleDateString()}</td>
        <td style={{ padding: 12 }}><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button disabled={busy} style={button} onClick={() => { setEditing(c); setName(c.name || ''); setPhone(c.phone); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
          {c.consent && <button disabled={busy} style={button} onClick={() => void act(c, 'opt-out')}>Opt out</button>}
          <button disabled={busy} style={button} onClick={() => void act(c, 'delete')}>Delete</button>
        </div></td>
      </tr>)}</tbody>
    </table>{!loading && !items.length && <p>No contacts found.</p>}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
      <button style={button} disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button style={button} disabled={loading || page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
    </div>
    <p style={{ fontSize: 13, color: '#64748b' }}>Message sending remains disabled. Opted-out contacts cannot be re-subscribed through this page.</p>
  </section>;
}
