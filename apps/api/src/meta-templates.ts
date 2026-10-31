// Read-only WhatsApp template discovery for a verified, tenant-owned connection.
// Live campaign sending remains disabled.
export type TemplateSummary = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: 'APPROVED';
  parameterized: boolean;
};
const TEMPLATE_NAME=/^[a-z0-9_]{1,120}$/;
export function normalizeApprovedTemplates(data: unknown): TemplateSummary[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((t: any) => {
    if (!t || t.status !== 'APPROVED' || typeof t.name !== 'string'
      || !TEMPLATE_NAME.test(t.name) || typeof t.language !== 'string'
      || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(t.language)) return [];
    // Flag variable templates: draft UI cannot safely build components yet.
    const components: any[] = Array.isArray(t.components) ? t.components : [];
    const parameterized = components.some((c: any) =>
      typeof c?.text === 'string' && /{{\s*\d+\s*}}/.test(c.text) ||
      Array.isArray(c?.buttons) && c.buttons.some((b:any) => typeof b?.text==='string' && /{{\s*\d+\s*}}/.test(b.text))
    );
    return [{
      id: String(t.id || ''),
      name: t.name,
      language: t.language,
      category: typeof t.category === 'string' ? t.category : 'UNKNOWN',
      status: 'APPROVED' as const,
      parameterized,
    }];
  });
}
export function metaGraphVersion(version: string | undefined): string {
  const v=version || 'v23.0';
  if (!/^v\d+\.\d+$/.test(v)) throw new Error('Invalid Meta Graph API version');
  return v;
}
