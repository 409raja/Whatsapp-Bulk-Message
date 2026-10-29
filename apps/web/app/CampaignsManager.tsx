
'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Campaign = {
  id: string;
  name: string;
  templateName: string;
  status: string;
  createdAt: string;
};

export default function CampaignsManager({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCampaigns = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API}/api/v1/campaigns`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load campaigns');
      }

      if (!Array.isArray(data)) {
        throw new Error('Invalid campaigns response');
      }

      if (!signal?.aborted) {
        setCampaigns(data);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(
          err instanceof Error ? err.message : 'Unable to load campaigns'
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
    loadCampaigns(controller.signal);

    return () => controller.abort();
  }, [loadCampaigns]);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const campaignName = name.trim();
    const template = templateName.trim();

    if (campaignName.length < 2 || !template) {
      setError('Enter a campaign name and template name');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/v1/campaigns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: campaignName,
          templateName: template,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create campaign');
      }

      setName('');
      setTemplateName('');
      setMessage('Campaign created successfully as DRAFT');
      await loadCampaigns();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to create campaign'
      );
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: CSSProperties = {
    padding: 11,
    border: '1px solid #ccc',
    borderRadius: 6,
    width: '100%',
    boxSizing: 'border-box',
  };

  const buttonStyle: CSSProperties = {
    padding: '11px 16px',
    background: '#1769aa',
    color: 'white',
    border: 0,
    borderRadius: 6,
    cursor: 'pointer',
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
      <h2>Campaign Management</h2>

      <p>Create and manage WhatsApp campaign drafts.</p>

      <form onSubmit={createCampaign} style={{ maxWidth: 450 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Campaign Name
            <input
              style={inputStyle}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Customer Updates"
              minLength={2}
              required
            />
          </label>

          <label>
            WhatsApp Template Name
            <input
              style={inputStyle}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Example: customer_update"
              required
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={buttonStyle}
          >
            {saving ? 'Creating...' : 'Create Campaign'}
          </button>
        </div>
      </form>

      {message && (
        <p role="status" style={{ color: 'green' }}>
          {message}
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      <h3>Saved Campaigns ({campaigns.length})</h3>

      <button onClick={() => loadCampaigns()} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh Campaigns'}
      </button>

      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr>
              {['Campaign', 'Template', 'Status', 'Created'].map(
                (heading) => (
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
                )
              )}
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td style={{ padding: 12 }}>{campaign.name}</td>
                <td style={{ padding: 12 }}>
                  {campaign.templateName}
                </td>
                <td style={{ padding: 12 }}>
                  <span
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      background: '#fff3cd',
                      color: '#795900',
                    }}
                  >
                    {campaign.status}
                  </span>
                </td>
                <td style={{ padding: 12 }}>
                  {new Date(campaign.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !error && campaigns.length === 0 && (
          <p>No campaigns found. Create your first campaign draft.</p>
        )}
      </div>

      <p style={{ fontSize: 13, color: '#666' }}>
        Campaigns are saved as drafts. Sending is disabled until
        the official WhatsApp provider, template validation,
        opt-out handling and durable queue are configured.
      </p>
    </section>
  );
}
