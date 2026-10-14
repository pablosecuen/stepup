/**
 * Límite de frecuencia de la recepción de avisos — PURO e inyectable (reloj y claves). Ventana fija por clave, con memoria acotada.
 *
 * Es la PRIMERA barrera, por instancia del servidor: corta el abuso barato antes de leer o interpretar el cuerpo. No reemplaza a una
 * regla de red de la plataforma (WAF): en serverless cada instancia tiene su propio contador, así que el tope efectivo global es
 * `límite × instancias`. La defensa que NO depende de esto está aguas abajo: deduplicación en la base, identidad del suscriptor
 * resuelta ANTES de consultar al proveedor, y un presupuesto de consultas por corrida (ver `docs/billing/M2_ARQUITECTURA.md`).
 */
export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateDecision;
}

export interface FixedWindowOptions {
  readonly limit: number;
  readonly windowMs: number;
  /** Tope de claves en memoria: ante abuso con claves distintas, se descartan las más viejas (nunca crece sin límite). */
  readonly maxKeys: number;
  readonly now: () => number;
}

export class FixedWindowLimiter implements RateLimiter {
  private readonly options: FixedWindowOptions;
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(options: FixedWindowOptions) {
    this.options = options;
  }

  check(key: string): RateDecision {
    const { limit, windowMs, maxKeys } = this.options;
    const now = this.options.now();
    let entry = this.windows.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (!entry && this.windows.size >= maxKeys) this.evict(now);
      entry = { start: now, count: 0 };
      this.windows.delete(key);
      this.windows.set(key, entry); // reinserta: queda al final (más reciente)
    }
    entry.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000));
    return { allowed: entry.count <= limit, retryAfterSeconds };
  }

  private evict(now: number): void {
    for (const [key, entry] of this.windows) {
      if (now - entry.start >= this.options.windowMs) this.windows.delete(key);
    }
    // Sigue lleno (todas las ventanas vigentes): se descartan las más viejas hasta dejar lugar.
    while (this.windows.size >= this.options.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

/** Límite por cliente Y global: el cliente abusivo se corta solo; un enjambre de clientes distintos topa con el límite global. */
export class CompositeLimiter implements RateLimiter {
  private readonly perClient: RateLimiter;
  private readonly global: RateLimiter;

  constructor(perClient: RateLimiter, global: RateLimiter) {
    this.perClient = perClient;
    this.global = global;
  }

  check(key: string): RateDecision {
    const client = this.perClient.check(key);
    if (!client.allowed) return client;
    return this.global.check("*");
  }
}

export const DEFAULT_NOTICE_LIMITS = { perClientPerMinute: 120, globalPerMinute: 1_500, maxKeys: 2_000 } as const;

export function createNoticeLimiter(now: () => number = Date.now): RateLimiter {
  return new CompositeLimiter(
    new FixedWindowLimiter({ limit: DEFAULT_NOTICE_LIMITS.perClientPerMinute, windowMs: 60_000, maxKeys: DEFAULT_NOTICE_LIMITS.maxKeys, now }),
    new FixedWindowLimiter({ limit: DEFAULT_NOTICE_LIMITS.globalPerMinute, windowMs: 60_000, maxKeys: 2, now }),
  );
}
