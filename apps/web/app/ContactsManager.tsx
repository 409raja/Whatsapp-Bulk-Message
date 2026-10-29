
'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Contact = {
  id: string;
  name: string | null;
  phone: string;
  consent: boolean;
  createdAt: string;
};

export default function ContactsManager({ token }: { token: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadContacts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API}/api/v1/contacts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load contacts');
      }

      if (!Array.isArray(data)) {
        throw new Error('Invalid contacts response');
      }

      if (!signal?.aborted) {
        setContacts(data);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(
          err instanceof Error ? err.message : 'Unable to load contacts'
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    loadContacts(controller.signal);
    return () => controller.abort();
  }, [loadContacts]);

  async function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError('Enter a valid international number, e.g. +919876543210');
      return;
    }

    if (!consent) {
      setError('Explicit messaging consent is required');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() || undefined,
          phone: phone.trim(),
          consent: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add contact');
      }

      setName('');
      setPhone('');
      setConsent(false);
      setMessage('Contact saved successfully');
      await loadContacts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save contact'
      );
    } finally {
      setSaving(false);
    }
  }

  async function optOut(contact: Contact) {
    if (!window.confirm(`Opt out ${contact.phone} from messaging?`)) {
      return;
    }

    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${API}/api/v1/contacts/${encodeURIComponent(contact.id)}/opt-out`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Opt-out failed');
      }

      setMessage('Contact opted out successfully');
      await loadContacts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to opt out'
      );
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: 11,
    border: '1px solid #ccc',
    borderRadius: 6,
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <section
      style={{
        background: 'white',
        padding: 24,
        borderRadius: 12,
        boxShadow: '0 3px 16px #ddd',
        marginTop: 24,
      }}
    >
      <h2>Contacts Management</h2>
      <p>Manage contacts who have explicitly agreed to receive messages.</p>

      <form onSubmit={addContact} style={{ maxWidth: 450 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Contact Name
            <input
              style={inputStyle}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact name"
            />
          </label>

          <label>
            WhatsApp Number
            <input
              style={inputStyle}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
              required
            />
          </label>

          <label style={{ display: 'flex', gap: 10 }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Contact has explicitly agreed to receive WhatsApp messages.
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: 12,
              background: '#1769aa',
              color: 'white',
              border: 0,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Add Contact'}
          </button>
        </div>
      </form>

      {message && <p role="status" style={{ color: 'green' }}>{message}</p>}
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      <h3>Saved Contacts ({contacts.length})</h3>

      <button onClick={() => loadContacts()} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh Contacts'}
      </button>

      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Phone', 'Consent', 'Action'].map((heading) => (
                <th
                  key={heading}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderBottom: '1px solid #ddd',
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td style={{ padding: 12 }}>{contact.name || '—'}</td>
                <td style={{ padding: 12 }}>{contact.phone}</td>
                <td style={{ padding: 12 }}>
                  {contact.consent ? 'Opted in' : 'Opted out'}
                </td>
                <td style={{ padding: 12 }}>
                  {contact.consent && (
                    <button onClick={() => optOut(contact)}>
                      Opt out
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && contacts.length === 0 && !error && (
          <p>No contacts found. Add your first opted-in contact.</p>
        )}
      </div>

      <p style={{ fontSize: 13, color: '#666' }}>
        The backend currently returns up to 100 recent contacts.
        Message sending remains disabled.
      </p>
    </section>
  );
}
