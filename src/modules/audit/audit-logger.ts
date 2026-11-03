export interface AuditLogEntry {
  id?: string;
  tenantId: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
}

export interface IAuditRepository {
  create(entry: AuditLogEntry): Promise<AuditLogEntry>;
  list(filter: {
    tenantId: string;
    resource?: string;
    resourceId?: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]>;
}

export class InMemoryAuditRepository implements IAuditRepository {
  private logs: AuditLogEntry[] = [];

  async create(entry: AuditLogEntry): Promise<AuditLogEntry> {
    const record: AuditLogEntry = {
      ...entry,
      id: entry.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: entry.createdAt || new Date(),
    };
    this.logs.push(record);
    return record;
  }

  async list(filter: {
    tenantId: string;
    resource?: string;
    resourceId?: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    let result = this.logs.filter((l) => l.tenantId === filter.tenantId);
    if (filter.resource) result = result.filter((l) => l.resource === filter.resource);
    if (filter.resourceId) result = result.filter((l) => l.resourceId === filter.resourceId);
    if (filter.action) result = result.filter((l) => l.action === filter.action);
    return result.slice(0, filter.limit || 50);
  }
}

export class AuditLogger {
  constructor(private repo: IAuditRepository = new InMemoryAuditRepository()) {}

  async log(params: {
    tenantId: string;
    userId?: string;
    action: string;
    resource: string;
    resourceId: string;
    payload?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLogEntry> {
    return await this.repo.create({
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      payload: params.payload,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  async getResourceHistory(tenantId: string, resource: string, resourceId: string): Promise<AuditLogEntry[]> {
    return await this.repo.list({ tenantId, resource, resourceId });
  }
}

export const auditLogger = new AuditLogger();

