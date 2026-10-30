'use client';
import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type Contact = { id: string; name: string | null; phone: string; consent: boolean; createdAt: string };
type Listing = { contacts: Contact[]; total: number; page: number; pages: number; limit: number };
const field: React.CSSProperties = { padding: '11px 12px', border: '1px solid #d5deea', borderRadius: 8, width: '100%', boxSizing: 'border-box' };
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
  const [formOpen, setFormOpen] = useState(false);
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
  function clearForm() { setEditing(null); setName(''); setPhone(''); setConsent(false); setFormOpen(false); }
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
  return <section className="contacts-page">
    <header className="manager-page-heading">
      <div>
        <span className="manager-eyebrow">AUDIENCE</span>
        <h1>Contacts</h1>
        <p>Keep your audience organized and respect every contact’s preferences.</p>
      </div>
      <button
        type="button"
        className="manager-primary-button"
        onClick={() => {
          if (formOpen && !editing) clearForm();
          else setFormOpen(true);
        }}
      >
        <span aria-hidden="true">{formOpen && !editing ? '−' : '+'}</span>
        {formOpen && !editing ? 'Close form' : 'Add contact'}
      </button>
    </header>

    {error && <p className="manager-feedback manager-feedback-error" role="alert">{error}</p>}
    {message && <p className="manager-feedback manager-feedback-success" role="status">{message}</p>}

    {formOpen && (
      <form className="contact-form-card" onSubmit={save}>
        <div className="manager-card-heading">
          <div>
            <h2>{editing ? 'Edit contact' : 'Add a contact'}</h2>
            <p>{editing ? 'Update this contact’s details.' : 'Add someone who has agreed to receive WhatsApp messages.'}</p>
          </div>
          <button type="button" className="manager-icon-button" aria-label="Close form" onClick={clearForm}>×</button>
        </div>
        <div className="contact-form-fields">
          <label className="manager-field">
            Name <span className="manager-optional">Optional</span>
            <input style={field} value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="e.g. Alex Morgan" autoComplete="name" />
          </label>
          <label className="manager-field">
            WhatsApp number
            <input style={field} value={phone} maxLength={16} onChange={e => setPhone(e.target.value)} placeholder="+1 555 123 4567" autoComplete="tel" required />
            <span className="manager-field-hint">Include country code, for example +919876543210.</span>
          </label>
        </div>
        {!editing && (
          <label className="contact-consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span><strong>WhatsApp consent confirmed</strong><small>This contact explicitly agreed to receive messages.</small></span>
          </label>
        )}
        <div className="contact-form-actions">
          <button disabled={busy} type="submit" className="manager-primary-button">
            {busy ? 'Working...' : editing ? 'Save changes' : 'Add contact'}
          </button>
          <button type="button" onClick={clearForm} className="manager-secondary-button">Cancel</button>
        </div>
      </form>
    )}

    <section className="manager-list-card">
      <div className="manager-card-heading contact-list-heading">
        <div>
          <h2>Contact list</h2>
          <p>Search, filter, and manage your saved audience.</p>
        </div>
        <div className="contact-import-actions">
          <button type="button" className="manager-secondary-button" onClick={() => void exportCsv()} disabled={busy}>
            Export CSV
          </button>
          <label className={`manager-secondary-button contact-import-button${busy ? ' is-disabled' : ''}`}>
            Import CSV
            <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void importCsv(file); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="contact-toolbar">
        <label className="contact-search">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search contacts" placeholder="Search by name or number" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </label>
        <select aria-label="Consent filter" className="contact-filter" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
          <option value="all">All consent statuses</option>
          <option value="true">Opted in</option>
          <option value="false">Opted out</option>
        </select>
        <button type="button" className="manager-secondary-button contact-refresh" onClick={() => void load()} disabled={busy || loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="contact-import-hint">CSV columns: name, phone, consent. Every imported contact must have explicit consent.</p>

      <div className="manager-table-wrap">
        <table className="manager-table">
          <thead><tr>{['Contact', 'WhatsApp number', 'Consent', 'Date added', ''].map((h, index) => <th key={h || index}>{h}</th>)}</tr></thead>
          <tbody>{items.map(c => (
            <tr key={c.id}>
              <td>
                <span className="contact-person-cell">
                  <span className="contact-person-avatar">{(c.name || c.phone).charAt(0).toUpperCase()}</span>
                  <span><strong>{c.name || 'Unnamed contact'}</strong><small>{c.name ? c.phone : 'Contact'}</small></span>
                </span>
              </td>
              <td className="contact-phone-cell">{c.phone}</td>
              <td><span className={`consent-badge ${c.consent ? 'consent-active' : 'consent-inactive'}`}><span />{c.consent ? 'Opted in' : 'Opted out'}</span></td>
              <td className="contact-date-cell">{new Date(c.createdAt).toLocaleDateString()}</td>
              <td>
                <div className="contact-row-actions">
                  <button disabled={busy} className="manager-row-button" onClick={() => { setEditing(c); setName(c.name || ''); setPhone(c.phone); setFormOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                  {c.consent && <button disabled={busy} className="manager-row-button" onClick={() => void act(c, 'opt-out')}>Opt out</button>}
                  <button disabled={busy} className="manager-row-button manager-row-danger" onClick={() => void act(c, 'delete')}>Delete</button>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {loading && !items.length && <p className="manager-empty-state">Loading contacts…</p>}
        {!loading && !items.length && (
          <div className="manager-empty-state">
            <span className="manager-empty-icon" aria-hidden="true">♙</span>
            <strong>No contacts found</strong>
            <p>Try changing your search or add a new opted-in contact.</p>
          </div>
        )}
      </div>

      <footer className="manager-pagination">
        <span>Showing {items.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total} contacts</span>
        <div>
          <button className="manager-secondary-button" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="manager-secondary-button" disabled={loading || page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </footer>
    </section>

    <p className="manager-compliance-note"><span aria-hidden="true">i</span> Messaging is disabled. Opted-out contacts cannot be re-subscribed from this page.</p>
  </section>;
}
