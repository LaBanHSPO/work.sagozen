import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';

import type { ProtectedTableApiService } from './service/index.js';

type Column = { id: string; name: string; canWrite: boolean };
type Row = {
  id: string;
  canWrite: boolean;
  values: Record<string, string>;
};
type Table = {
  exists?: boolean;
  canManage: boolean;
  columns: Column[];
  rows: Row[];
};
type Member = { id: string; name: string; email: string };
type Grant = {
  scope: 'row' | 'column';
  resourceId: string;
  userId: string;
  canRead: boolean;
  canWrite: boolean;
};

export class ProtectedTableComponent extends LitElement {
  static override styles = css`
    :host { display: block; color: var(--affine-text-primary-color); }
    .heading, .actions, .permissions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .heading { margin: 8px 0 12px; justify-content: space-between; }
    .heading strong { font-size: 16px; }
    .hint { color: var(--affine-text-secondary-color); font-size: 12px; }
    .error { color: var(--affine-error-color, #b42318); margin: 8px 0; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    th, td { border: 1px solid var(--affine-border-color); padding: 6px; text-align: left; }
    th { background: var(--affine-hover-color); font-weight: 500; }
    input, select, button { font: inherit; }
    input { box-sizing: border-box; width: 100%; min-width: 90px; border: 0; background: transparent; color: inherit; }
    input:focus { outline: 2px solid var(--affine-primary-color); }
    button, select { border: 1px solid var(--affine-border-color); border-radius: 4px; padding: 4px 8px; background: var(--affine-background-primary-color); color: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    .permissions { border-top: 1px solid var(--affine-border-color); margin-top: 14px; padding-top: 12px; }
    .permissions label { font-size: 12px; }
  `;

  @property({ attribute: false }) accessor workspaceId = '';
  @property({ attribute: false }) accessor docId = '';
  @property({ attribute: false }) accessor blockId = '';
  @property({ attribute: false }) accessor apiRequest:
    | ProtectedTableApiService['fetch']
    | undefined = undefined;

  @state() private accessor table: Table | null = null;
  @state() private accessor members: Member[] = [];
  @state() private accessor grants: Grant[] = [];
  @state() private accessor error = '';
  @state() private accessor busy = false;
  @state() private accessor userId = '';
  @state() private accessor scope: 'row' | 'column' = 'row';
  @state() private accessor resourceId = '';
  @state() private accessor permission: 'none' | 'read' | 'write' = 'none';

  private refreshTimer: number | undefined;
  private retryTimer: number | undefined;
  private loadRetries = 0;

  private readonly refresh = () => void this.load();

  override connectedCallback() {
    super.connectedCallback();
    this.refreshTimer = window.setInterval(this.refresh, 30000);
    window.addEventListener('focus', this.refresh);
  }

  override disconnectedCallback() {
    window.clearInterval(this.refreshTimer);
    window.clearTimeout(this.retryTimer);
    window.removeEventListener('focus', this.refresh);
    super.disconnectedCallback();
  }

  private get baseUrl() {
    return `/api/workspaces/${encodeURIComponent(this.workspaceId)}/docs/${encodeURIComponent(this.docId)}/protected-tables/${encodeURIComponent(this.blockId)}`;
  }

  protected override updated(changed: PropertyValues<this>) {
    if (
      changed.has('workspaceId') ||
      changed.has('docId') ||
      changed.has('blockId') ||
      changed.has('apiRequest')
    ) {
      this.loadRetries = 0;
      void this.load();
    }
  }

  private async request(path = '', method = 'GET', body?: unknown) {
    const response = await (this.apiRequest ?? fetch)(`${this.baseUrl}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers:
        method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return (await response.json()) as unknown;
  }

  private async load() {
    if (!this.workspaceId || !this.docId || !this.blockId) return;
    try {
      this.error = '';
      const table = (await this.request()) as Table;
      this.table = table;
      this.loadRetries = 0;
      if (table.canManage && table.exists !== false) {
        const [members, grants] = await Promise.all([
          this.request('/members'),
          this.request('/grants'),
        ]);
        this.members = members as Member[];
        this.grants = grants as Grant[];
        this.userId ||= this.members[0]?.id ?? '';
        this.resourceId ||= table.rows[0]?.id ?? '';
        this.syncPermission();
      }
    } catch (error) {
      this.table = null;
      this.error = error instanceof Error ? error.message : 'Could not load table';
      if (this.isConnected && this.loadRetries < 2) {
        this.loadRetries++;
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => void this.load(), 1500);
      }
    }
  }

  private async mutate(path: string, method: string, body?: unknown) {
    this.busy = true;
    try {
      this.error = '';
      await this.request(path, method, body);
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Request failed';
    } finally {
      this.busy = false;
    }
  }

  private readonly initialize = () => this.mutate('', 'POST');

  private readonly addColumn = () => {
    const name = window.prompt('Column name')?.trim();
    if (name) void this.mutate('/columns', 'POST', { name });
  };

  private readonly addRow = () => this.mutate('/rows', 'POST');

  private readonly saveCell = (event: Event, rowId: string, columnId: string) => {
    const value = (event.target as HTMLInputElement).value;
    void this.mutate(
      `/cells/${encodeURIComponent(rowId)}/${encodeURIComponent(columnId)}`,
      'PUT',
      { value }
    );
  };

  private get resources() {
    const titleColumnId = this.table?.columns[0]?.id;
    return this.scope === 'row'
      ? (this.table?.rows.map((row, index) => ({
          id: row.id,
          name: (titleColumnId && row.values[titleColumnId]) || `Row ${index + 1}`,
        })) ?? [])
      : (this.table?.columns.map(column => ({ id: column.id, name: column.name })) ?? []);
  }

  private syncPermission() {
    const grant = this.grants.find(
      item =>
        item.userId === this.userId &&
        item.scope === this.scope &&
        item.resourceId === this.resourceId
    );
    this.permission = grant?.canWrite
      ? 'write'
      : grant?.canRead
        ? 'read'
        : 'none';
  }

  private readonly saveGrant = () => {
    if (!this.userId || !this.resourceId) return;
    void this.mutate('/grants', 'PUT', {
      scope: this.scope,
      resourceId: this.resourceId,
      userId: this.userId,
      canRead: this.permission !== 'none',
      canWrite: this.permission === 'write',
    });
  };

  override render() {
    const table = this.table;
    return html`
      <div class="heading">
        <strong>Protected task table</strong>
        <div class="actions">
          <span class="hint">Row and column access is checked by the server.</span>
          <button @click=${this.refresh}>Refresh</button>
        </div>
      </div>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${!table
        ? html`<p class="hint">Loading table...</p>`
        : table.exists === false
          ? html`<p>Table is not initialized.</p>
              ${table.canManage
                ? html`<button ?disabled=${this.busy} @click=${this.initialize}>Initialize table</button>`
                : html`<p class="hint">Ask a workspace admin or document owner to initialize it.</p>`}`
          : html`
              ${table.canManage
                ? html`<div class="actions">
                    <button ?disabled=${this.busy} @click=${this.addColumn}>Add column</button>
                    <button ?disabled=${this.busy} @click=${this.addRow}>Add row</button>
                  </div>`
                : nothing}
              <table>
                <thead><tr>${table.columns.map(column => html`<th>${column.name}</th>`)}</tr></thead>
                <tbody>
                  ${table.rows.map(row => html`<tr>
                    ${table.columns.map(column => html`<td>
                      <input
                        aria-label=${`${column.name} for task ${row.id}`}
                        .value=${row.values[column.id] ?? ''}
                        ?disabled=${this.busy || !row.canWrite || !column.canWrite}
                        @change=${(event: Event) => this.saveCell(event, row.id, column.id)}
                      />
                    </td>`)}
                  </tr>`)}
                </tbody>
              </table>
              ${table.canManage ? this.renderPermissions() : nothing}
            `}
    `;
  }

  private renderPermissions() {
    return html`<div class="permissions">
      <strong>Member permissions</strong>
      <label>User
        <select @change=${(event: Event) => {
          this.userId = (event.target as HTMLSelectElement).value;
          this.syncPermission();
        }}>
          ${this.members.map(member => html`<option value=${member.id} ?selected=${member.id === this.userId}>${member.name || member.email}</option>`)}
        </select>
      </label>
      <label>Applies to
        <select @change=${(event: Event) => {
          this.scope = (event.target as HTMLSelectElement).value as 'row' | 'column';
          this.resourceId = this.resources[0]?.id ?? '';
          this.syncPermission();
        }}>
          <option value="row">Row</option><option value="column">Column</option>
        </select>
      </label>
      <label>${this.scope === 'row' ? 'Row' : 'Column'}
        <select @change=${(event: Event) => {
          this.resourceId = (event.target as HTMLSelectElement).value;
          this.syncPermission();
        }}>
          ${this.resources.map(resource => html`<option value=${resource.id} ?selected=${resource.id === this.resourceId}>${resource.name}</option>`)}
        </select>
      </label>
      <label>Access
        <select @change=${(event: Event) => {
          this.permission = (event.target as HTMLSelectElement).value as 'none' | 'read' | 'write';
        }}>
          <option value="none" ?selected=${this.permission === 'none'}>None</option>
          <option value="read" ?selected=${this.permission === 'read'}>Read</option>
          <option value="write" ?selected=${this.permission === 'write'}>Read and write</option>
        </select>
      </label>
      <button ?disabled=${this.busy || !this.userId || !this.resourceId} @click=${this.saveGrant}>Save access</button>
      <span class="hint">A member needs access to both the row and the column to see or edit a cell.</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-protected-table': ProtectedTableComponent;
  }
}
