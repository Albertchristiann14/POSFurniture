export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, code = "APP_ERROR", details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TenantMismatchError extends AppError {
  constructor(message = "Akses ditolak: Batas isolasi tenant terlanggar") {
    super(message, 403, "TENANT_MISMATCH");
  }
}

export class UnauthorizedAccessError extends AppError {
  constructor(message = "Akses tidak diizinkan untuk peran (role) ini") {
    super(message, 403, "UNAUTHORIZED_ROLE");
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` dengan ID ${id}` : ""} tidak ditemukan`, 404, "NOT_FOUND");
  }
}

export class CreditLimitExceededError extends AppError {
  constructor(requested: bigint, limit: bigint) {
    super(
      `Plafon kredit terlampaui: Pengajuan ${requested.toString()} melebihi sisa plafon ${limit.toString()}`,
      422,
      "CREDIT_LIMIT_EXCEEDED"
    );
  }
}

export class DuplicateCustomerError extends AppError {
  constructor(message = "Pelanggan dengan NIK ini sudah terdaftar pada outlet/tenant ini") {
    super(message, 409, "DUPLICATE_CUSTOMER");
  }
}

export class InvalidDocumentError extends AppError {
  constructor(message: string) {
    super(message, 422, "INVALID_DOCUMENT");
  }
}

